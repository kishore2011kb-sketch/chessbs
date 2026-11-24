import { useState } from 'react';
import { PIECE_GLYPHS, PIECE_NAMES, PLAYER_NAMES, squareName } from '../engine';
import type { GameRules, GameState, PieceType, Player } from '../engine';
import type { PhysicsConfig } from '../engine/physics';
import type { CollisionRule } from '../engine/types';

export function PromotionModal({
  state,
  player,
  pieceId,
  onChoose,
}: {
  state: GameState;
  player: Player;
  pieceId: string;
  onChoose: (type: PieceType) => void;
}) {
  const pawn = state.pieces.find((p) => p.id === pieceId);
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <span className="modal-kicker">{PLAYER_NAMES[player]} promotion</span>
        <h2>Promote the pawn</h2>
        <p className="modal-copy">
          The pawn reached {pawn ? squareName(pawn.row, pawn.col) : 'the far rank'}. Choose what it
          becomes.
        </p>
        <div className="promo-grid">
          {state.rules.promotionChoices.map((type) => (
            <button key={type} type="button" className="promo-option" onClick={() => onChoose(type)}>
              <span className="promo-glyph">{PIECE_GLYPHS[type]}</span>
              <span>{PIECE_NAMES[type]}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function SuccessionModal({
  state,
  player,
  onChoose,
}: {
  state: GameState;
  player: Player;
  onChoose: (pieceId: string) => void;
}) {
  const survivors = state.pieces.filter((p) => p.owner === player);
  return (
    <div className="modal-backdrop">
      <div className="modal wide">
        <span className="modal-kicker">{PLAYER_NAMES[player]}</span>
        <h2>The king has fallen</h2>
        <p className="modal-copy">
          The match continues. Pick any surviving piece to carry the crown.
        </p>
        <div className="successor-grid">
          {survivors.map((piece) => (
            <button
              key={piece.id}
              type="button"
              className={`successor ${player}`}
              onClick={() => onChoose(piece.id)}
            >
              <span className="successor-glyph">{PIECE_GLYPHS[piece.type]}</span>
              <span className="successor-meta">
                {PIECE_NAMES[piece.type]}
                <em>{squareName(piece.row, piece.col)}</em>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function GameOverModal({ state, onRestart }: { state: GameState; onRestart: () => void }) {
  const winner = state.winner!;
  return (
    <div className="modal-backdrop">
      <div className={`modal game-over ${winner}`}>
        <span className="modal-kicker">Match complete</span>
        <h2>{PLAYER_NAMES[winner]} wins</h2>
        <p className="modal-copy">
          The {PLAYER_NAMES[winner === 'white' ? 'black' : 'white'].toLowerCase()} army is fully
          eliminated after {state.turn} turns.
        </p>
        <div className="modal-actions">
          <button type="button" className="primary-button" onClick={onRestart}>
            New match
          </button>
        </div>
      </div>
    </div>
  );
}

export function RulesModal({
  rules,
  physics,
  onApply,
  onClose,
}: {
  rules: GameRules;
  physics: PhysicsConfig;
  onApply: (rules: GameRules, physics: PhysicsConfig) => void;
  onClose: () => void;
}) {
  const [draftRules, setDraftRules] = useState<GameRules>(structuredClone(rules));
  const [draftPhysics, setDraftPhysics] = useState<PhysicsConfig>(structuredClone(physics));

  const setCollision = (value: CollisionRule) =>
    setDraftRules((r) => ({ ...r, collisionRule: value }));

  const setTurnCost = (key: keyof GameRules['turnCost'], value: boolean) =>
    setDraftRules((r) => ({ ...r, turnCost: { ...r.turnCost, [key]: value } }));

  return (
    <div className="modal-backdrop">
      <div className="modal wide rules">
        <span className="modal-kicker">Rules &amp; physics</span>
        <h2>Configurable assumptions</h2>
        <p className="modal-copy">
          CHESSBS rules are explicit and tunable. Changing anything here starts a fresh match.
        </p>

        <div className="rule-row">
          <label htmlFor="collision">Collision outcome</label>
          <select
            id="collision"
            value={draftRules.collisionRule}
            onChange={(e) => setCollision(e.target.value as CollisionRule)}
          >
            <option value="capture-and-continue">Capture and keep travelling</option>
            <option value="capture-and-stop">Capture and stop</option>
            <option value="block">Never capture, only deflect</option>
          </select>
        </div>

        <div className="rule-row">
          <span>Turn cost</span>
          <div className="check-row">
            {(['launch', 'warp', 'doubleBounce'] as const).map((key) => (
              <label key={key} className="check">
                <input
                  type="checkbox"
                  checked={draftRules.turnCost[key]}
                  onChange={(e) => setTurnCost(key, e.target.checked)}
                />
                {key === 'doubleBounce' ? 'Double Bounce' : key}
              </label>
            ))}
          </div>
        </div>

        <div className="rule-row">
          <label htmlFor="cooldown">Double Bounce cooldown (turns)</label>
          <input
            id="cooldown"
            type="number"
            min={1}
            max={6}
            value={draftRules.doubleBounceCooldown}
            onChange={(e) =>
              setDraftRules((r) => ({
                ...r,
                doubleBounceCooldown: Math.max(1, Number(e.target.value) || 1),
              }))
            }
          />
        </div>

        <div className="rule-row">
          <label htmlFor="curve">Shot curve (rad/s)</label>
          <input
            id="curve"
            type="range"
            min={0}
            max={1.2}
            step={0.05}
            value={draftPhysics.curveRate}
            onChange={(e) =>
              setDraftPhysics((p) => ({ ...p, curveRate: Number(e.target.value) }))
            }
          />
          <span className="rule-value">{draftPhysics.curveRate.toFixed(2)}</span>
        </div>

        <div className="rule-row">
          <label htmlFor="friction">Board friction</label>
          <input
            id="friction"
            type="range"
            min={5}
            max={16}
            step={0.5}
            value={draftPhysics.friction}
            onChange={(e) => setDraftPhysics((p) => ({ ...p, friction: Number(e.target.value) }))}
          />
          <span className="rule-value">{draftPhysics.friction.toFixed(1)}</span>
        </div>

        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => onApply(draftRules, draftPhysics)}
          >
            Apply &amp; restart
          </button>
        </div>
      </div>
    </div>
  );
}
