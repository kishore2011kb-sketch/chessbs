import { useEffect, useRef } from 'react';
import {
  PIECE_GLYPHS,
  PIECE_NAMES,
  PIECE_VALUES,
  PLAYER_NAMES,
  canUseDoubleBounce,
  other,
  squareName,
  warpRange,
} from '../engine';
import type { Curve, GameState, Piece, Player } from '../engine';
import type { BoardMode } from './Board';

export function TopBar({ state, onRules }: { state: GameState; onRules: () => void }) {
  const turnLabel = state.winner
    ? `${PLAYER_NAMES[state.winner]} wins`
    : `${PLAYER_NAMES[state.currentPlayer]} to move`;

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">♛</span>
        <span className="brand-name">
          CHESS<span>BS</span>
        </span>
        <span className="brand-tag">warp chess</span>
      </div>

      <div className="topbar-mid">
        <span className="chip">Local · 2 players</span>
        <span className={`chip turn-chip ${state.winner ? 'won' : state.currentPlayer}`}>{turnLabel}</span>
        <span className="chip muted">Turn {state.turn}</span>
      </div>

      <button className="ghost-button" onClick={onRules} type="button">
        Rules &amp; physics
      </button>
    </header>
  );
}

export function PlayerCard({ player, state }: { player: Player; state: GameState }) {
  const mine = state.pieces.filter((p) => p.owner === player);
  const king = mine.find((p) => p.isKing);
  const takenFromOpponent = state.captured[other(player)];
  const isTurn = state.currentPlayer === player && !state.winner;
  const awaitingSuccession = state.pending.some(
    (d) => d.kind === 'succession' && d.player === player,
  );
  const isWinner = state.winner === player;

  return (
    <div className={`player-card ${player}${isTurn ? ' is-turn' : ''}${isWinner ? ' is-winner' : ''}`}>
      <div className="player-head">
        <span className={`avatar ${player}`}>{PIECE_GLYPHS.king}</span>
        <div className="player-meta">
          <span className="player-name">{PLAYER_NAMES[player]}</span>
          <span className="player-sub">
            {mine.length} piece{mine.length === 1 ? '' : 's'} left
          </span>
        </div>
        {isTurn && <span className="turn-dot" aria-label="to move" />}
      </div>

      <div className="player-row">
        <span className="label">King</span>
        <span className={king ? 'value' : 'value danger'}>
          {awaitingSuccession
            ? 'Succession pending'
            : king
              ? `${PIECE_GLYPHS[king.type]} ${squareName(king.row, king.col)}`
              : 'None'}
        </span>
      </div>

      <div className="player-row captured-row">
        <span className="label">Captured</span>
        <span className="captured-list">
          {takenFromOpponent.length === 0 && <span className="value dim">—</span>}
          {takenFromOpponent.map((type, i) => (
            <span key={`${type}-${i}`} className={`mini ${other(player)}`}>
              {PIECE_GLYPHS[type]}
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}

export function AbilityPanel({
  state,
  selected,
  mode,
  onMode,
}: {
  state: GameState;
  selected: Piece | null;
  mode: BoardMode;
  onMode: (mode: BoardMode) => void;
}) {
  const player = state.currentPlayer;
  const cd = state.cooldowns[player];
  const ready = canUseDoubleBounce(state, player);
  const active = mode === 'bounce';

  return (
    <section className="panel-block">
      <h2 className="panel-title">Abilities</h2>

      <button
        type="button"
        className={`ability ${active ? 'is-armed' : ''}${ready ? '' : ' is-cooling'}`}
        onClick={() => onMode('bounce')}
        disabled={!ready || Boolean(state.winner)}
      >
        <span className="ability-icon">⇅</span>
        <span className="ability-body">
          <span className="ability-name">Double Bounce</span>
          <span className="ability-desc">
            Wipe every enemy on a rank, file or diagonal line.
          </span>
        </span>
        <span className="ability-state">
          {ready ? (active ? 'Pick a line' : 'Ready') : `${cd} turn${cd === 1 ? '' : 's'}`}
        </span>
      </button>
      <div className="cooldown-track" aria-hidden>
        <div
          className={`cooldown-fill ${player}`}
          style={{
            width: `${100 - (cd / Math.max(1, state.rules.doubleBounceCooldown)) * 100}%`,
          }}
        />
      </div>

      <button
        type="button"
        className={`ability ${mode === 'warp' ? 'is-armed' : ''}`}
        onClick={() => onMode('warp')}
        disabled={Boolean(state.winner)}
      >
        <span className="ability-icon">✧</span>
        <span className="ability-body">
          <span className="ability-name">Warp Jump</span>
          <span className="ability-desc">
            {selected
              ? selected.warpUsed
                ? `${PIECE_NAMES[selected.type]} has spent its jump.`
                : `Warp the ${PIECE_NAMES[selected.type].toLowerCase()} up to ${warpRange(state.rules, selected.type)} square${warpRange(state.rules, selected.type) === 1 ? '' : 's'} (${PIECE_VALUES[selected.type]} pts).`
              : 'Select a piece, then choose a target square.'}
          </span>
        </span>
        <span className="ability-state">
          {selected ? (selected.warpUsed ? 'Spent' : `${warpRange(state.rules, selected.type)} sq`) : '—'}
        </span>
      </button>
    </section>
  );
}

export function StatusPanel({ state, mode }: { state: GameState; mode: BoardMode }) {
  const hint = state.winner
    ? 'Match complete.'
    : state.pending[0]?.kind === 'succession'
      ? 'A king has fallen — choose a successor.'
      : state.pending[0]?.kind === 'promotion'
        ? 'A pawn reached the far rank — choose its promotion.'
        : mode === 'warp'
          ? 'Warp Jump armed: tap a highlighted square inside the piece\u2019s range.'
          : mode === 'bounce'
            ? 'Double Bounce armed: aim along a rank, file or diagonal, then tap.'
            : 'Drag backwards from one of your pieces to launch it — straight or curved.';

  return (
    <section className="panel-block status">
      <h2 className="panel-title">Status</h2>
      <p className="status-hint">{hint}</p>
      <ul className="status-list">
        <li>
          <span>Win condition</span>
          <strong>Total elimination</strong>
        </li>
        <li>
          <span>Check / checkmate</span>
          <strong>Not used</strong>
        </li>
        <li>
          <span>Collision</span>
          <strong>{state.rules.collisionRule.replace(/-/g, ' ')}</strong>
        </li>
      </ul>
    </section>
  );
}

export function HistoryPanel({ state }: { state: GameState }) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [state.log.length]);

  return (
    <section className="panel-block history">
      <h2 className="panel-title">Move history</h2>
      <ol className="history-list">
        {state.log.map((entry) => (
          <li key={entry.id} className={entry.player}>
            <span className="history-turn">{entry.turn}</span>
            <span className="history-text">{entry.text}</span>
          </li>
        ))}
        <div ref={endRef} />
      </ol>
    </section>
  );
}

export function AimBar({ curve, onChange }: { curve: Curve; onChange: (curve: Curve) => void }) {
  const options: { value: Curve; icon: string; label: string }[] = [
    { value: -1, icon: '\u21B0', label: 'Curve left' },
    { value: 0, icon: '\u2191', label: 'Straight' },
    { value: 1, icon: '\u21B1', label: 'Curve right' },
  ];

  return (
    <div className="aim-bar" role="group" aria-label="Shot path">
      <span className="aim-label">Shot path</span>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`aim-option${curve === option.value ? ' on' : ''}`}
          aria-pressed={curve === option.value}
          onClick={() => onChange(option.value)}
        >
          <span className="aim-icon" aria-hidden>
            {option.icon}
          </span>
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function BottomBar({
  state,
  canUndo,
  onUndo,
  onRestart,
  onResign,
}: {
  state: GameState;
  canUndo: boolean;
  onUndo: () => void;
  onRestart: () => void;
  onResign: () => void;
}) {
  return (
    <footer className="bottombar">
      <div className="bottom-left">
        <span className="hint">
          Drag back to launch · release to fire · pick a straight or curved shot path
        </span>
      </div>
      <div className="bottom-actions">
        <button className="ghost-button" type="button" onClick={onUndo} disabled={!canUndo}>
          Undo
        </button>
        <button className="ghost-button" type="button" onClick={onRestart}>
          Restart
        </button>
        <button
          className="ghost-button danger"
          type="button"
          onClick={onResign}
          disabled={Boolean(state.winner)}
        >
          Resign
        </button>
      </div>
    </footer>
  );
}
