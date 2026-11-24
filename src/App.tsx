import { useEffect, useState } from 'react';
import Board, { type BoardMode } from './components/Board';
import {
  AbilityPanel,
  AimBar,
  BottomBar,
  HistoryPanel,
  PlayerCard,
  StatusPanel,
  TopBar,
} from './components/Panels';
import {
  GameOverModal,
  PromotionModal,
  RulesModal,
  SuccessionModal,
} from './components/Modals';
import { useGame } from './hooks/useGame';
import { currentDecision, findPiece, getStatus } from './engine';
import type { Curve, GameRules } from './engine';
import type { PhysicsConfig } from './engine/physics';

export default function App() {
  const game = useGame();
  const { state, active } = game;

  const [mode, setMode] = useState<BoardMode>('move');
  const [curve, setCurve] = useState<Curve>(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showRules, setShowRules] = useState(false);

  const decision = currentDecision(state);
  const status = getStatus(state);
  const selected = selectedId ? findPiece(state.pieces, selectedId) ?? null : null;
  const locked = status !== 'playing' || active !== null;

  // A new turn always disarms the current tool and drops the selection.
  useEffect(() => {
    setMode('move');
    setSelectedId(null);
  }, [state.turn, state.currentPlayer]);

  const handleMode = (next: BoardMode) => {
    setMode((current) => (current === next ? 'move' : next));
  };

  const handleRestart = () => {
    setMode('move');
    setSelectedId(null);
    game.restart();
  };

  const handleApplyRules = (rules: GameRules, physics: PhysicsConfig) => {
    setShowRules(false);
    setMode('move');
    setSelectedId(null);
    game.restart(rules, physics);
  };

  return (
    <div className="app">
      <TopBar state={state} onRules={() => setShowRules(true)} />

      <main className="layout">
        <aside className="panel left">
          <PlayerCard player="black" state={state} />
          <div className="panel-sep">
            <span>vs</span>
          </div>
          <PlayerCard player="white" state={state} />
          <div className="legend">
            <div>
              <span className="legend-key">♛</span> Crown marks the current king
            </div>
            <div>
              <span className="legend-key dot" /> Dot under a piece = Warp Jump spent
            </div>
            <div>
              <span className="legend-key">✧</span> One Warp Jump per piece · range = its point value
            </div>
            <div>
              <span className="legend-key">↗</span> Launch reach: pawn &lt; knight/bishop &lt; rook
              &lt; king &lt; queen
            </div>
          </div>
        </aside>

        <section className="center">
          <Board
            state={state}
            active={active}
            elapsed={game.elapsed}
            selectedId={selectedId}
            mode={mode}
            curve={curve}
            locked={locked}
            onSelect={setSelectedId}
            onLaunch={(pieceId, shot) => {
              setSelectedId(null);
              game.dispatch({ kind: 'launch', pieceId, shot });
            }}
            onWarp={(pieceId, target) => {
              setSelectedId(null);
              setMode('move');
              game.dispatch({ kind: 'warp', pieceId, target });
            }}
            onBounce={(pieceId, direction) => {
              setSelectedId(null);
              setMode('move');
              game.dispatch({ kind: 'doubleBounce', pieceId, direction });
            }}
          />
          <AimBar curve={curve} onChange={setCurve} />
        </section>

        <aside className="panel right">
          <AbilityPanel state={state} selected={selected} mode={mode} onMode={handleMode} />
          <StatusPanel state={state} mode={mode} />
          <HistoryPanel state={state} />
        </aside>
      </main>

      <BottomBar
        state={state}
        canUndo={game.canUndo}
        onUndo={game.undo}
        onRestart={handleRestart}
        onResign={() => game.resign(state.currentPlayer)}
      />

      {decision?.kind === 'promotion' && (
        <PromotionModal
          state={state}
          player={decision.player}
          pieceId={decision.pieceId}
          onChoose={(to) => game.dispatch({ kind: 'promote', pieceId: decision.pieceId, to })}
        />
      )}

      {decision?.kind === 'succession' && (
        <SuccessionModal
          state={state}
          player={decision.player}
          onChoose={(pieceId) => game.dispatch({ kind: 'succeed', pieceId })}
        />
      )}

      {state.winner && <GameOverModal state={state} onRestart={handleRestart} />}

      {showRules && (
        <RulesModal
          rules={state.rules}
          physics={state.physics}
          onApply={handleApplyRules}
          onClose={() => setShowRules(false)}
        />
      )}

      {game.toast && <div className="toast">{game.toast}</div>}
    </div>
  );
}
