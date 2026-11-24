import { useMemo, useRef, useState } from 'react';
import {
  ALL_DIRECTIONS,
  DIRECTION_VECTORS,
  MAX_DRAG_SQUARES,
  PIECE_GLYPHS,
  bouncePreview,
  centreOf,
  dragToShot,
  findPiece,
  legalWarpTargets,
  pieceAt,
  previewLaunch,
  raySquares,
  sampleAt,
  squareOfPoint,
} from '../engine';
import type { Curve, Direction, GameState, Position, Shot } from '../engine';
import type { Vec } from '../engine/physics';
import type { ActiveEffect } from '../hooks/useGame';

export type BoardMode = 'move' | 'warp' | 'bounce';

interface BoardProps {
  state: GameState;
  active: ActiveEffect | null;
  elapsed: number;
  selectedId: string | null;
  mode: BoardMode;
  curve: Curve;
  locked: boolean;
  onSelect: (id: string | null) => void;
  onLaunch: (pieceId: string, shot: Shot) => void;
  onWarp: (pieceId: string, target: Position) => void;
  onBounce: (pieceId: string, direction: Direction) => void;
}

function snapDirection(from: Vec, to: Vec): Direction | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.hypot(dx, dy) < 0.45) return null;
  let best: Direction = ALL_DIRECTIONS[0];
  let bestDot = -Infinity;
  for (const dir of ALL_DIRECTIONS) {
    const v = DIRECTION_VECTORS[dir];
    const len = Math.hypot(v.dr, v.dc) || 1;
    const dot = (dx * v.dc + dy * v.dr) / len;
    if (dot > bestDot) {
      bestDot = dot;
      best = dir;
    }
  }
  return best;
}

const toPath = (points: { x: number; y: number }[]): string =>
  points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(3)} ${p.y.toFixed(3)}`).join(' ');

export default function Board({
  state,
  active,
  elapsed,
  selectedId,
  mode,
  curve,
  locked,
  onSelect,
  onLaunch,
  onWarp,
  onBounce,
}: BoardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: string; from: Vec; to: Vec } | null>(null);
  const [hover, setHover] = useState<Vec | null>(null);

  const selected = selectedId ? findPiece(state.pieces, selectedId) ?? null : null;
  const current = state.currentPlayer;

  const pointOf = (e: React.PointerEvent): Vec => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: ((e.clientX - rect.left) / rect.width) * 8,
      y: ((e.clientY - rect.top) / rect.height) * 8,
    };
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (locked) return;
    const p = pointOf(e);
    const square = squareOfPoint(p.x, p.y);
    const piece = pieceAt(state.pieces, square.row, square.col);
    const own = piece && piece.owner === current ? piece : null;

    if (mode === 'move') {
      if (own) {
        onSelect(own.id);
        e.currentTarget.setPointerCapture(e.pointerId);
        setDrag({ id: own.id, from: centreOf(own.row, own.col), to: p });
      } else {
        onSelect(null);
      }
      return;
    }

    if (mode === 'warp') {
      if (own && own.id !== selectedId) {
        onSelect(own.id);
        return;
      }
      if (selectedId) {
        const legal = legalWarpTargets(state, selectedId).some(
          (t) => t.row === square.row && t.col === square.col,
        );
        if (legal) onWarp(selectedId, square);
      }
      return;
    }

    // bounce
    if (own && own.id !== selectedId) {
      onSelect(own.id);
      setHover(p);
      return;
    }
    if (selected) {
      const dir = snapDirection(centreOf(selected.row, selected.col), p);
      if (dir) onBounce(selected.id, dir);
    } else if (own) {
      onSelect(own.id);
      setHover(p);
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (locked) return;
    const p = pointOf(e);
    if (drag) {
      setDrag({ ...drag, to: p });
      return;
    }
    if (mode === 'bounce' && selected) setHover(p);
  };

  const handlePointerUp = () => {
    if (!drag) return;
    const shot = dragToShot(
      drag.to.x - drag.from.x,
      drag.to.y - drag.from.y,
      MAX_DRAG_SQUARES,
      curve,
    );
    setDrag(null);
    if (shot.power < 0.06) return;
    onLaunch(drag.id, shot);
  };

  const preview = useMemo(() => {
    if (!drag) return null;
    const shot = dragToShot(
      drag.to.x - drag.from.x,
      drag.to.y - drag.from.y,
      MAX_DRAG_SQUARES,
      curve,
    );
    if (shot.power < 0.06) return null;
    return previewLaunch(state, drag.id, shot);
  }, [drag, state, curve]);

  const dragShot = drag
    ? dragToShot(drag.to.x - drag.from.x, drag.to.y - drag.from.y, MAX_DRAG_SQUARES)
    : null;

  const beamPreview = useMemo(() => {
    if (mode !== 'bounce' || !selected || !hover) return null;
    const dir = snapDirection(centreOf(selected.row, selected.col), hover);
    if (!dir) return null;
    const hits = bouncePreview(state, selected.id, dir);
    const line = raySquares(selected, dir);
    const last = line[line.length - 1] ?? selected;
    return {
      dir,
      from: centreOf(selected.row, selected.col),
      to: centreOf(last.row, last.col),
      hits: hits.map((h) => ({ id: h.id, ...centreOf(h.row, h.col) })),
    };
  }, [mode, selected, hover, state]);

  const warpTargets = useMemo(() => {
    if (mode !== 'warp' || !selected) return new Set<string>();
    return new Set(legalWarpTargets(state, selected.id).map((t) => `${t.row},${t.col}`));
  }, [mode, selected, state]);


  const flight = active?.effect.kind === 'flight' ? active.effect : null;
  const flyingPos = flight ? sampleAt(flight.samples, elapsed) : null;
  const hidden = new Set<string>();
  if (flight) {
    for (const c of flight.captures) if (elapsed >= c.t) hidden.add(c.pieceId);
  }

  const beam = active?.effect.kind === 'beam' ? active.effect : null;
  const warpFx = active?.effect.kind === 'warp' ? active.effect : null;

  return (
    <div className="board-frame">
      <div
        className={`board mode-${mode}${locked ? ' locked' : ''}`}
        ref={ref}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <div className="squares">
          {Array.from({ length: 64 }, (_, i) => {
            const row = Math.floor(i / 8);
            const col = i % 8;
            const dark = (row + col) % 2 === 1;
            const isSelected = selected?.row === row && selected?.col === col;
            const isTarget = warpTargets.has(`${row},${col}`);
            return (
              <div
                key={i}
                className={`square ${dark ? 'dark' : 'light'}${isSelected ? ' selected' : ''}`}
              >
                {col === 0 && <span className="rank">{8 - row}</span>}
                {row === 7 && <span className="file">{'abcdefgh'[col]}</span>}
                {isTarget && <span className="target-dot" />}
              </div>
            );
          })}
        </div>

        <svg className="overlay" viewBox="0 0 8 8">
          {dragShot && dragShot.power >= 0.06 && drag && (
            <>
              <line
                className="pull-line"
                x1={drag.from.x}
                y1={drag.from.y}
                x2={drag.to.x}
                y2={drag.to.y}
              />
              <circle className="power-ring" cx={drag.to.x} cy={drag.to.y} r={0.18 + dragShot.power * 0.26} />
            </>
          )}

          {preview && (
            <>
              <path className="trajectory-shadow" d={toPath(preview.samples)} />
              <path className="trajectory" d={toPath(preview.samples)} />
              {preview.captures.map((c) => (
                <circle key={`cap-${c.pieceId}`} className="impact" cx={c.x} cy={c.y} r={0.2} />
              ))}
              <circle className="landing" cx={preview.rest.x} cy={preview.rest.y} r={0.17} />
            </>
          )}

          {beamPreview && (
            <>
              <line
                className="beam-preview"
                x1={beamPreview.from.x}
                y1={beamPreview.from.y}
                x2={beamPreview.to.x}
                y2={beamPreview.to.y}
              />
              {beamPreview.hits.map((h) => (
                <circle key={`hit-${h.id}`} className="impact" cx={h.x} cy={h.y} r={0.24} />
              ))}
            </>
          )}

          {beam && (
            <line
              className="beam"
              x1={beam.from.x}
              y1={beam.from.y}
              x2={beam.to.x}
              y2={beam.to.y}
            />
          )}

          {warpFx && (
            <>
              <circle className="warp-ring" cx={warpFx.from.x} cy={warpFx.from.y} r={0.3} />
              <circle className="warp-ring" cx={warpFx.to.x} cy={warpFx.to.y} r={0.3} />
            </>
          )}
        </svg>

        <div className="pieces">
          {state.pieces.map((piece) => {
            if (hidden.has(piece.id)) return null;
            const isFlying = flight?.pieceId === piece.id && flyingPos !== null;
            const pos = isFlying ? flyingPos! : centreOf(piece.row, piece.col);
            const isHit =
              beam !== null && elapsed > 0.2 && beam.hits.some((h) => h.id === piece.id);
            const classes = [
              'piece',
              piece.owner,
              piece.isKing ? 'is-king' : '',
              selected?.id === piece.id ? 'is-selected' : '',
              isFlying ? 'is-flying' : '',
              isHit ? 'is-hit' : '',
            ]
              .filter(Boolean)
              .join(' ');

            return (
              <div
                key={piece.id}
                className={classes}
                style={{ left: `${(pos.x / 8) * 100}%`, top: `${(pos.y / 8) * 100}%` }}
                aria-label={`${piece.owner} ${piece.type}`}
              >
                <span className="glyph">{PIECE_GLYPHS[piece.type]}</span>
                {piece.isKing && <span className="crown" aria-hidden />}
                {piece.warpUsed && <span className="warp-used" aria-hidden />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
