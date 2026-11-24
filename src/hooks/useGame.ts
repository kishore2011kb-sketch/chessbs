import { useCallback, useEffect, useRef, useState } from 'react';
import { applyAction, createGame, resign as resignGame, type Effect, type GameAction } from '../engine/game';
import type { PhysicsConfig } from '../engine/physics';
import type { GameRules, GameState, Player } from '../engine/types';

export interface ActiveEffect {
  effect: Effect;
  next: GameState;
  duration: number;
}

function effectDuration(effect: Effect): number {
  if (effect.kind === 'flight') return effect.duration + 0.25;
  if (effect.kind === 'beam') return 0.85;
  return 0.6;
}

export interface GameApi {
  state: GameState;
  active: ActiveEffect | null;
  elapsed: number;
  toast: string | null;
  canUndo: boolean;
  dispatch: (action: GameAction) => void;
  undo: () => void;
  restart: (rules?: GameRules, physics?: PhysicsConfig) => void;
  resign: (player: Player) => void;
}

/**
 * Binds the pure engine to React: applies actions, plays the returned effect,
 * then commits the resulting state. Input is locked while an effect plays.
 */
export function useGame(): GameApi {
  const [state, setState] = useState<GameState>(() => createGame());
  const [active, setActive] = useState<ActiveEffect | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const undoRef = useRef<GameState[]>([]);

  const dispatch = useCallback(
    (action: GameAction) => {
      if (active) return;
      const result = applyAction(state, action);
      if (!result.ok) {
        setToast(result.error);
        return;
      }
      undoRef.current.push(structuredClone(state));
      if (undoRef.current.length > 60) undoRef.current.shift();
      setCanUndo(true);

      if (result.effect) {
        setActive({ effect: result.effect, next: result.state, duration: effectDuration(result.effect) });
        setElapsed(0);
      } else {
        setState(result.state);
      }
    },
    [state, active],
  );

  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = (now - start) / 1000;
      setElapsed(t);
      if (t >= active.duration) {
        setState(active.next);
        setActive(null);
        setElapsed(0);
      } else {
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(id);
  }, [toast]);

  const undo = useCallback(() => {
    if (active) return;
    const prev = undoRef.current.pop();
    if (!prev) return;
    setState(prev);
    setCanUndo(undoRef.current.length > 0);
  }, [active]);

  const restart = useCallback(
    (rules?: GameRules, physics?: PhysicsConfig) => {
      undoRef.current = [];
      setCanUndo(false);
      setActive(null);
      setElapsed(0);
      setToast(null);
      setState(createGame(rules ?? state.rules, physics ?? state.physics));
    },
    [state.rules, state.physics],
  );

  const resign = useCallback(
    (player: Player) => {
      if (active || state.winner) return;
      undoRef.current.push(structuredClone(state));
      setCanUndo(true);
      setState(resignGame(state, player));
    },
    [state, active],
  );

  return { state, active, elapsed, toast, canUndo, dispatch, undo, restart, resign };
}
