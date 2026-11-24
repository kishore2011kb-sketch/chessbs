import { describe, expect, it } from 'vitest';
import {
  applyAction,
  canUseDoubleBounce,
  createGame,
  getStatus,
  legalWarpTargets,
  previewLaunch,
} from './game';
import { DEFAULT_PHYSICS, DEFAULT_RULES } from './config';
import { dragToShot, simulateShot } from './physics';
import type { GameRules, GameState, Piece, PieceType, Player } from './types';

type Spec = { owner: Player; type: PieceType; row: number; col: number; isKing?: boolean };

/** Build a deterministic state. Both kings exist unless a spec overrides it. */
function makeGame(specs: Spec[], rules: Partial<GameRules> = {}): GameState {
  const pieces: Piece[] = specs.map((s, i) => ({
    id: `p${i}`,
    owner: s.owner,
    type: s.type,
    row: s.row,
    col: s.col,
    warpUsed: false,
    isKing: s.isKing ?? s.type === 'king',
  }));
  return {
    pieces,
    currentPlayer: 'white',
    cooldowns: { white: 0, black: 0 },
    pending: [],
    winner: null,
    turn: 1,
    log: [],
    captured: { white: [], black: [] },
    rules: { ...DEFAULT_RULES, ...rules },
    physics: DEFAULT_PHYSICS,
    nextLogId: 1,
  };
}

const kings: Spec[] = [
  { owner: 'white', type: 'king', row: 7, col: 0 },
  { owner: 'black', type: 'king', row: 0, col: 7 },
];

const idOf = (state: GameState, row: number, col: number): string => {
  const piece = state.pieces.find((p) => p.row === row && p.col === col);
  if (!piece) throw new Error(`no piece at ${row},${col}`);
  return piece.id;
};

const pieceById = (state: GameState, id: string) => state.pieces.find((p) => p.id === id);

describe('setup', () => {
  it('creates 16 pieces per side with one king each', () => {
    const state = createGame();
    expect(state.pieces.filter((p) => p.owner === 'white')).toHaveLength(16);
    expect(state.pieces.filter((p) => p.owner === 'black')).toHaveLength(16);
    expect(state.pieces.filter((p) => p.isKing)).toHaveLength(2);
    expect(getStatus(state)).toBe('playing');
  });

  it('starts from the classic chess position', () => {
    const state = createGame();
    const at = (row: number, col: number) => state.pieces.find((p) => p.row === row && p.col === col);
    expect(at(0, 0)?.type).toBe('rook');
    expect(at(0, 3)?.type).toBe('queen');
    expect(at(0, 4)?.type).toBe('king');
    expect(at(1, 0)?.type).toBe('pawn');
    expect(at(6, 7)?.type).toBe('pawn');
    expect(at(7, 3)?.type).toBe('queen');
    expect(at(7, 4)?.type).toBe('king');
  });
});

describe('1. drag-based launching', () => {
  it('moves the selected piece and consumes the turn', () => {
    const state = makeGame([...kings, { owner: 'white', type: 'pawn', row: 5, col: 3 }]);
    const pawnId = idOf(state, 5, 3);

    const shot = dragToShot(0, 0.9); // drag downwards -> launch upwards
    expect(shot.dirY).toBeLessThan(0);

    const result = applyAction(state, { kind: 'launch', pieceId: pawnId, shot });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const moved = pieceById(result.state, pawnId)!;
    expect(moved.row).toBeLessThan(5);
    expect(result.state.currentPlayer).toBe('black');
    expect(result.effect?.kind).toBe('flight');
  });

  it('rejects launching an opponent piece', () => {
    const state = makeGame([...kings, { owner: 'black', type: 'pawn', row: 2, col: 3 }]);
    const result = applyAction(state, {
      kind: 'launch',
      pieceId: idOf(state, 2, 3),
      shot: { dirX: 0, dirY: 1, power: 0.5 },
    });
    expect(result.ok).toBe(false);
  });
});

describe('2. drag distance controls force', () => {
  it('maps longer drags to more power', () => {
    const short = dragToShot(0, 0.5);
    const long = dragToShot(0, 2);
    expect(long.power).toBeGreaterThan(short.power);
    expect(dragToShot(0, 5).power).toBe(1);
  });

  it('launches a piece further with more power', () => {
    const base = makeGame([...kings, { owner: 'white', type: 'pawn', row: 5, col: 3 }]);
    const pawnId = idOf(base, 5, 3);

    const soft = applyAction(base, { kind: 'launch', pieceId: pawnId, shot: { dirX: 0, dirY: -1, power: 0.3 } });
    const hard = applyAction(base, { kind: 'launch', pieceId: pawnId, shot: { dirX: 0, dirY: -1, power: 0.8 } });
    expect(soft.ok && hard.ok).toBe(true);
    if (!soft.ok || !hard.ok) return;

    expect(pieceById(soft.state, pawnId)!.row).toBeGreaterThan(pieceById(hard.state, pawnId)!.row);
  });
});

describe('3. trajectory is curved', () => {
  const start = { x: 3.5, y: 6.5 };
  const shot = { dirX: 0, dirY: -1, power: 1 };

  it('bends away from the straight line', () => {
    const sim = simulateShot({
      shooterId: 'a',
      shooterOwner: 'white',
      start,
      mass: 1,
      obstacles: [],
      shot,
      config: DEFAULT_PHYSICS,
      collisionRule: 'capture-and-continue',
    });

    const end = sim.rest;
    const mid = sim.samples[Math.floor(sim.samples.length / 2)];
    // Perpendicular distance of the midpoint from the straight start->end line.
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const len = Math.hypot(dx, dy);
    const deviation = Math.abs((mid.x - start.x) * dy - (mid.y - start.y) * dx) / len;

    expect(len).toBeGreaterThan(2);
    expect(deviation).toBeGreaterThan(0.1);
  });

  it('is straight when curve rate is zero', () => {
    const straight = simulateShot({
      shooterId: 'a',
      shooterOwner: 'white',
      start,
      mass: 1,
      obstacles: [],
      shot,
      config: { ...DEFAULT_PHYSICS, curveRate: 0 },
      collisionRule: 'capture-and-continue',
    });
    const mid = straight.samples[Math.floor(straight.samples.length / 2)];
    expect(mid.x).toBeCloseTo(start.x, 1);
  });

  it('is deterministic — preview matches the committed shot', () => {
    const state = makeGame([...kings, { owner: 'white', type: 'rook', row: 5, col: 3 }]);
    const rookId = idOf(state, 5, 3);
    const s = { dirX: 0.4, dirY: -1, power: 0.7 };
    const preview = previewLaunch(state, rookId, s)!;
    const committed = applyAction(state, { kind: 'launch', pieceId: rookId, shot: s });
    expect(committed.ok).toBe(true);
    if (!committed.ok || committed.effect?.kind !== 'flight') return;
    expect(committed.effect.samples).toEqual(preview.samples);
    expect(committed.effect.rest).toEqual(preview.rest);
  });
});

describe('4. one Warp Jump per piece', () => {
  it('allows exactly one warp per piece and leaves other pieces alone', () => {
    let state = makeGame([
      ...kings,
      { owner: 'white', type: 'rook', row: 5, col: 0 },
      { owner: 'white', type: 'rook', row: 5, col: 1 },
    ]);
    const first = idOf(state, 5, 0);

    const warped = applyAction(state, { kind: 'warp', pieceId: first, target: { row: 3, col: 3 } });
    expect(warped.ok).toBe(true);
    if (!warped.ok) return;
    state = { ...warped.state, currentPlayer: 'white' };
    expect(pieceById(state, first)!.warpUsed).toBe(true);

    const second = applyAction(state, { kind: 'warp', pieceId: first, target: { row: 2, col: 2 } });
    expect(second.ok).toBe(false);

    const otherPiece = idOf(state, 5, 1);
    const other = applyAction(state, { kind: 'warp', pieceId: otherPiece, target: { row: 4, col: 4 } });
    expect(other.ok).toBe(true);
  });

  it('cannot warp onto a friendly piece', () => {
    const state = makeGame([
      ...kings,
      { owner: 'white', type: 'pawn', row: 5, col: 0 },
      { owner: 'white', type: 'rook', row: 5, col: 1 },
    ]);
    const result = applyAction(state, {
      kind: 'warp',
      pieceId: idOf(state, 5, 0),
      target: { row: 5, col: 1 },
    });
    expect(result.ok).toBe(false);
  });
});

describe('5. Warp Jump capture', () => {
  it('captures an enemy on the target square', () => {
    const state = makeGame([
      ...kings,
      { owner: 'white', type: 'rook', row: 5, col: 0 },
      { owner: 'black', type: 'pawn', row: 2, col: 2 },
    ]);
    const result = applyAction(state, {
      kind: 'warp',
      pieceId: idOf(state, 5, 0),
      target: { row: 2, col: 2 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.state.pieces.some((p) => p.owner === 'black' && p.type === 'pawn')).toBe(false);
    expect(result.state.captured.black).toEqual(['pawn']);
    expect(result.state.pieces.find((p) => p.owner === 'white' && p.type === 'rook')).toMatchObject({
      row: 2,
      col: 2,
      warpUsed: true,
    });
  });
});

describe('6. pawn promotion', () => {
  it('asks for a promotion instead of auto-promoting', () => {
    const state = makeGame([...kings, { owner: 'white', type: 'pawn', row: 1, col: 3 }]);
    const pawnId = idOf(state, 1, 3);

    const result = applyAction(state, {
      kind: 'launch',
      pieceId: pawnId,
      shot: { dirX: 0, dirY: -1, power: 0.5 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const landed = pieceById(result.state, pawnId)!;
    expect(landed.row).toBe(0);
    expect(getStatus(result.state)).toBe('decision');
    expect(result.state.pending[0]).toEqual({ kind: 'promotion', player: 'white', pieceId: pawnId });
    // Not promoted until the player chooses.
    expect(landed.type).toBe('pawn');
    // Turn does not advance while a decision is pending.
    expect(result.state.currentPlayer).toBe('white');
  });

  it('offers a queen and applies the chosen type', () => {
    const state = makeGame([...kings, { owner: 'white', type: 'pawn', row: 1, col: 3 }]);
    const pawnId = idOf(state, 1, 3);
    const launched = applyAction(state, {
      kind: 'launch',
      pieceId: pawnId,
      shot: { dirX: 0, dirY: -1, power: 0.5 },
    });
    if (!launched.ok) throw new Error('launch failed');

    expect(launched.state.rules.promotionChoices).toContain('queen');

    const promoted = applyAction(launched.state, { kind: 'promote', pieceId: pawnId, to: 'queen' });
    expect(promoted.ok).toBe(true);
    if (!promoted.ok) return;
    expect(pieceById(promoted.state, pawnId)!.type).toBe('queen');
    expect(promoted.state.pending).toHaveLength(0);
    expect(promoted.state.currentPlayer).toBe('black');
  });
});

describe('7 & 8. king succession', () => {
  const setup = () =>
    makeGame([
      { owner: 'white', type: 'king', row: 7, col: 0 },
      { owner: 'white', type: 'queen', row: 4, col: 4 },
      { owner: 'black', type: 'king', row: 0, col: 0 },
      { owner: 'black', type: 'rook', row: 0, col: 7 },
    ]);

  it('does not end the game when a king is captured', () => {
    const state = setup();
    const result = applyAction(state, {
      kind: 'warp',
      pieceId: idOf(state, 4, 4),
      target: { row: 0, col: 0 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.state.winner).toBeNull();
    expect(getStatus(result.state)).toBe('decision');
    expect(result.state.pending[0]).toEqual({ kind: 'succession', player: 'black' });
    expect(result.state.pieces.some((p) => p.owner === 'black' && p.isKing)).toBe(false);
  });

  it('promotes a surviving piece to king and play continues', () => {
    const state = setup();
    const captured = applyAction(state, {
      kind: 'warp',
      pieceId: idOf(state, 4, 4),
      target: { row: 0, col: 0 },
    });
    if (!captured.ok) throw new Error('warp failed');

    const rookId = captured.state.pieces.find((p) => p.owner === 'black' && p.type === 'rook')!.id;
    const succeeded = applyAction(captured.state, { kind: 'succeed', pieceId: rookId });
    expect(succeeded.ok).toBe(true);
    if (!succeeded.ok) return;

    const newKing = succeeded.state.pieces.find((p) => p.id === rookId)!;
    expect(newKing.isKing).toBe(true);
    expect(newKing.type).toBe('rook');
    expect(succeeded.state.pieces.filter((p) => p.owner === 'black' && p.isKing)).toHaveLength(1);
    expect(succeeded.state.winner).toBeNull();
    expect(succeeded.state.currentPlayer).toBe('black');
  });
});

describe('9-12. Double Bounce', () => {
  const board = () =>
    makeGame([
      ...kings,
      { owner: 'white', type: 'rook', row: 4, col: 4 },
      { owner: 'black', type: 'pawn', row: 2, col: 4 }, // straight up
      { owner: 'black', type: 'pawn', row: 0, col: 4 }, // further up the same column
      { owner: 'black', type: 'pawn', row: 2, col: 6 }, // diagonal up-right
      { owner: 'white', type: 'pawn', row: 3, col: 3 }, // friendly on the up-left diagonal
    ]);

  it('fires vertically and clears every enemy on the column', () => {
    const state = board();
    const result = applyAction(state, {
      kind: 'doubleBounce',
      pieceId: idOf(state, 4, 4),
      direction: 'up',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const remainingBlack = result.state.pieces.filter((p) => p.owner === 'black');
    expect(remainingBlack.some((p) => p.col === 4 && p.type === 'pawn')).toBe(false);
    expect(result.state.captured.black).toHaveLength(2);
    expect(result.effect?.kind).toBe('beam');
  });

  it('fires diagonally', () => {
    const state = board();
    const result = applyAction(state, {
      kind: 'doubleBounce',
      pieceId: idOf(state, 4, 4),
      direction: 'upRight',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.pieces.some((p) => p.row === 2 && p.col === 6)).toBe(false);
    expect(result.state.captured.black).toEqual(['pawn']);
  });

  it('eliminates enemies only and leaves friendly pieces untouched', () => {
    const state = board();
    const friendlyId = idOf(state, 3, 3);
    const result = applyAction(state, {
      kind: 'doubleBounce',
      pieceId: idOf(state, 4, 4),
      direction: 'upLeft',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(pieceById(result.state, friendlyId)).toBeDefined();
    expect(result.state.captured.white).toEqual([]);
  });

  it('fires horizontally along a rank', () => {
    const state = makeGame([
      ...kings,
      { owner: 'white', type: 'rook', row: 4, col: 4 },
      { owner: 'black', type: 'pawn', row: 4, col: 1 },
      { owner: 'black', type: 'pawn', row: 4, col: 6 },
      { owner: 'black', type: 'pawn', row: 2, col: 4 }, // off the rank: survives
    ]);
    const left = applyAction(state, {
      kind: 'doubleBounce',
      pieceId: idOf(state, 4, 4),
      direction: 'left',
    });
    expect(left.ok).toBe(true);
    if (!left.ok) return;
    expect(left.state.pieces.some((p) => p.row === 4 && p.col === 1)).toBe(false);
    expect(left.state.pieces.some((p) => p.row === 4 && p.col === 6)).toBe(true);
    expect(left.state.pieces.some((p) => p.row === 2 && p.col === 4)).toBe(true);
    expect(left.state.captured.black).toEqual(['pawn']);
  });

  it('fires horizontally to the right too', () => {
    const state = makeGame([
      ...kings,
      { owner: 'white', type: 'rook', row: 4, col: 4 },
      { owner: 'black', type: 'pawn', row: 4, col: 6 },
    ]);
    const right = applyAction(state, {
      kind: 'doubleBounce',
      pieceId: idOf(state, 4, 4),
      direction: 'right',
    });
    expect(right.ok).toBe(true);
    if (!right.ok) return;
    expect(right.state.pieces.some((p) => p.row === 4 && p.col === 6)).toBe(false);
    expect(right.state.captured.black).toEqual(['pawn']);
  });
});

describe('13 & 14. Double Bounce cooldown', () => {
  it('goes on a two-turn cooldown and returns', () => {
    let state = makeGame([
      ...kings,
      { owner: 'white', type: 'rook', row: 4, col: 4 },
      { owner: 'white', type: 'pawn', row: 5, col: 0 },
      { owner: 'black', type: 'queen', row: 2, col: 0 },
      { owner: 'black', type: 'queen', row: 2, col: 1 },
    ]);
    const rookId = idOf(state, 4, 4);

    const fired = applyAction(state, { kind: 'doubleBounce', pieceId: rookId, direction: 'up' });
    expect(fired.ok).toBe(true);
    if (!fired.ok) return;
    state = fired.state;

    expect(state.cooldowns.white).toBe(2);
    expect(canUseDoubleBounce(state, 'white')).toBe(false);
    expect(state.currentPlayer).toBe('black');

    // Black warps (turn passes).
    const blackA = state.pieces.find((p) => p.owner === 'black' && p.col === 0)!.id;
    const step1 = applyAction(state, { kind: 'warp', pieceId: blackA, target: { row: 5, col: 6 } });
    if (!step1.ok) throw new Error(step1.error);
    state = step1.state;

    // White's next turn: still cooling down.
    expect(state.currentPlayer).toBe('white');
    expect(state.cooldowns.white).toBe(1);
    expect(canUseDoubleBounce(state, 'white')).toBe(false);
    const blocked = applyAction(state, { kind: 'doubleBounce', pieceId: rookId, direction: 'up' });
    expect(blocked.ok).toBe(false);

    // White passes with a pawn launch.
    const whitePawn = state.pieces.find((p) => p.owner === 'white' && p.type === 'pawn')!.id;
    const pass = applyAction(state, {
      kind: 'launch',
      pieceId: whitePawn,
      shot: { dirX: 0, dirY: -1, power: 0.4 },
    });
    if (!pass.ok) throw new Error(pass.error);
    state = pass.state;

    // Black warps again.
    const blackB = state.pieces.find((p) => p.owner === 'black' && p.col === 1)!.id;
    const step2 = applyAction(state, { kind: 'warp', pieceId: blackB, target: { row: 5, col: 7 } });
    if (!step2.ok) throw new Error(step2.error);
    state = step2.state;

    // Two turns have passed: ready again.
    expect(state.currentPlayer).toBe('white');
    expect(state.cooldowns.white).toBe(0);
    expect(canUseDoubleBounce(state, 'white')).toBe(true);

    const again = applyAction(state, { kind: 'doubleBounce', pieceId: rookId, direction: 'upLeft' });
    expect(again.ok).toBe(true);
  });
});

describe('15 & 16. victory conditions', () => {
  it('wins by eliminating every opposing piece', () => {
    const state = makeGame([
      { owner: 'white', type: 'king', row: 7, col: 0 },
      { owner: 'white', type: 'queen', row: 4, col: 4 },
      { owner: 'black', type: 'king', row: 0, col: 0 },
    ]);
    const result = applyAction(state, {
      kind: 'warp',
      pieceId: idOf(state, 4, 4),
      target: { row: 0, col: 0 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.state.pieces.filter((p) => p.owner === 'black')).toHaveLength(0);
    expect(result.state.winner).toBe('white');
    expect(getStatus(result.state)).toBe('game-over');
  });

  it('does not win by capturing a king alone', () => {
    const state = makeGame([
      { owner: 'white', type: 'king', row: 7, col: 0 },
      { owner: 'white', type: 'queen', row: 4, col: 4 },
      { owner: 'black', type: 'king', row: 0, col: 0 },
      { owner: 'black', type: 'pawn', row: 2, col: 5 },
    ]);
    const result = applyAction(state, {
      kind: 'warp',
      pieceId: idOf(state, 4, 4),
      target: { row: 0, col: 0 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.winner).toBeNull();
    expect(result.state.pieces.some((p) => p.owner === 'black')).toBe(true);
  });

  it('cannot act once the match is over', () => {
    const state = makeGame([
      { owner: 'white', type: 'king', row: 7, col: 0 },
      { owner: 'white', type: 'queen', row: 4, col: 4 },
      { owner: 'black', type: 'king', row: 0, col: 0 },
    ]);
    const won = applyAction(state, {
      kind: 'warp',
      pieceId: idOf(state, 4, 4),
      target: { row: 0, col: 0 },
    });
    if (!won.ok) throw new Error(won.error);
    const after = applyAction(won.state, {
      kind: 'warp',
      pieceId: idOf(won.state, 7, 0),
      target: { row: 5, col: 5 },
    });
    expect(after.ok).toBe(false);
  });
});

describe('17. aim mode: straight or curved', () => {
  const start = { x: 3.5, y: 6.5 };
  const base = {
    shooterId: 'a',
    shooterOwner: 'white' as const,
    start,
    mass: 1,
    obstacles: [],
    config: DEFAULT_PHYSICS,
    collisionRule: 'capture-and-continue' as const,
  };

  it('flies dead straight when the aim is straight', () => {
    const sim = simulateShot({ ...base, shot: { dirX: 0, dirY: -1, power: 1, curve: 0 } });
    expect(sim.rest.x).toBeCloseTo(start.x, 5);
    expect(sim.rest.y).toBeLessThan(start.y - 2);
  });

  it('bends to opposite sides for left and right', () => {
    const left = simulateShot({ ...base, shot: { dirX: 0, dirY: -1, power: 0.6, curve: -1 } });
    const right = simulateShot({ ...base, shot: { dirX: 0, dirY: -1, power: 0.6, curve: 1 } });
    const l = left.samples[Math.floor(left.samples.length / 2)];
    const r = right.samples[Math.floor(right.samples.length / 2)];
    expect(l.x).toBeLessThan(start.x);
    expect(r.x).toBeGreaterThan(start.x);
  });

  it('carries the chosen curve from the drag into the shot', () => {
    expect(dragToShot(0, 1, 2.2, -1).curve).toBe(-1);
    expect(dragToShot(0, 1, 2.2, 0).curve).toBe(0);
  });
});

describe('18. one wall bounce, then a glide to the far edge', () => {
  it('bounces once and comes to rest at the opposite edge', () => {
    const sim = simulateShot({
      shooterId: 'a',
      shooterOwner: 'white',
      start: { x: 4, y: 4 },
      mass: 1,
      obstacles: [],
      shot: { dirX: 0, dirY: -1, power: 1, curve: 0 },
      config: DEFAULT_PHYSICS,
      collisionRule: 'capture-and-continue',
    });

    expect(sim.wallBounces).toBe(1);
    expect(sim.rest.y).toBeCloseTo(8 - DEFAULT_PHYSICS.pieceRadius, 1);
    expect(sim.duration).toBeLessThan(DEFAULT_PHYSICS.maxTime);
  });

  it('never bounces more than once', () => {
    const sim = simulateShot({
      shooterId: 'a',
      shooterOwner: 'white',
      start: { x: 0.5, y: 0.5 },
      mass: 1,
      obstacles: [],
      shot: { dirX: 0.2, dirY: 1, power: 1, curve: 0 },
      config: DEFAULT_PHYSICS,
      collisionRule: 'capture-and-continue',
    });
    expect(sim.wallBounces).toBeLessThanOrEqual(1);
  });
});

describe('19. warp range follows piece value', () => {
  const targets = (type: PieceType, row: number, col: number) => {
    const state = makeGame([...kings, { owner: 'white', type, row, col }]);
    const id = idOf(state, row, col);
    return { state, id, list: legalWarpTargets(state, id) };
  };
  const reaches = (list: { row: number; col: number }[], row: number, col: number) =>
    list.some((t) => t.row === row && t.col === col);

  it('gives a pawn a single square of range', () => {
    const { list } = targets('pawn', 4, 4);
    expect(reaches(list, 5, 5)).toBe(true);
    expect(reaches(list, 6, 6)).toBe(false);
    expect(reaches(list, 4, 6)).toBe(false);
  });

  it('gives knights and bishops three squares', () => {
    for (const type of ['knight', 'bishop'] as PieceType[]) {
      const { list } = targets(type, 7, 7);
      expect(reaches(list, 4, 4)).toBe(true);
      expect(reaches(list, 3, 3)).toBe(false);
    }
  });

  it('gives a king four, a rook five and a queen the whole board', () => {
    expect(reaches(targets('king', 7, 7).list, 3, 3)).toBe(true);
    expect(reaches(targets('king', 7, 7).list, 2, 2)).toBe(false);
    expect(reaches(targets('rook', 7, 7).list, 2, 2)).toBe(true);
    expect(reaches(targets('rook', 7, 7).list, 1, 1)).toBe(false);
    expect(reaches(targets('queen', 7, 7).list, 0, 7)).toBe(true);
    expect(reaches(targets('queen', 7, 7).list, 0, 0)).toBe(true);
  });

  it('rejects a warp beyond the piece range with a clear message', () => {
    const { state, id } = targets('rook', 7, 7);
    const tooFar = applyAction(state, { kind: 'warp', pieceId: id, target: { row: 0, col: 7 } });
    expect(tooFar.ok).toBe(false);
    if (tooFar.ok) return;
    expect(tooFar.error).toContain('5 squares');

    const allowed = applyAction(state, { kind: 'warp', pieceId: id, target: { row: 2, col: 2 } });
    expect(allowed.ok).toBe(true);
  });

  it('keeps every target inside the range', () => {
    for (const type of ['pawn', 'knight', 'bishop', 'rook', 'king', 'queen'] as PieceType[]) {
      const { list } = targets(type, 7, 7);
      const far = Math.max(...list.map((t) => Math.max(Math.abs(t.row - 7), Math.abs(t.col - 7))));
      expect(far).toBeLessThanOrEqual(Math.min(7, { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9, king: 4 }[type]));
    }
  });
});

describe('20. launch distance follows piece strength', () => {
  const pathLength = (samples: { x: number; y: number }[]) =>
    samples.reduce((sum, p, i) => (i === 0 ? 0 : sum + Math.hypot(p.x - samples[i - 1].x, p.y - samples[i - 1].y)), 0);

  const fly = (type: PieceType) => {
    // Launch from the bottom rank so only the queen's 9 reaches the far wall.
    const state = makeGame([...kings, { owner: 'white', type, row: 7, col: 3 }]);
    const sim = previewLaunch(state, idOf(state, 7, 3), {
      dirX: 0,
      dirY: -1,
      power: 1,
      curve: 0,
    })!;
    return pathLength(sim.samples);
  };

  it('throws the queen furthest, then king, rook, bishop/knight, pawn', () => {
    const queen = fly('queen');
    const king = fly('king');
    const rook = fly('rook');
    const bishop = fly('bishop');
    const knight = fly('knight');
    const pawn = fly('pawn');

    expect(queen).toBeGreaterThan(king);
    expect(king).toBeGreaterThan(rook);
    expect(rook).toBeGreaterThan(bishop);
    expect(bishop).toBeCloseTo(knight, 6);
    expect(knight).toBeGreaterThan(pawn);
    expect(pawn).toBeLessThan(2.5);
  });

  it('gives a promoted pawn the queen launch distance', () => {
    expect(fly('queen')).toBeGreaterThan(fly('pawn') * 3);
  });

  it('keeps the wall-bounce glide identical for every piece', () => {
    const bounce = (type: PieceType) => {
      const state = makeGame([...kings, { owner: 'white', type, row: 0, col: 0 }]);
      const sim = previewLaunch(state, idOf(state, 0, 0), {
        dirX: -1,
        dirY: -1,
        power: 1,
        curve: 0,
      })!;
      return sim.rest;
    };
    const pawn = bounce('pawn');
    const queen = bounce('queen');
    expect(pawn.x).toBeCloseTo(queen.x, 6);
    expect(pawn.y).toBeCloseTo(queen.y, 6);
  });
});

describe('turn integrity', () => {
  it('rejects a second action in the same turn', () => {
    const state = makeGame([
      ...kings,
      { owner: 'white', type: 'pawn', row: 5, col: 0 },
      { owner: 'white', type: 'pawn', row: 5, col: 1 },
    ]);
    const first = applyAction(state, {
      kind: 'launch',
      pieceId: idOf(state, 5, 0),
      shot: { dirX: 0, dirY: -1, power: 0.5 },
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = applyAction(first.state, {
      kind: 'launch',
      pieceId: idOf(first.state, 5, 1),
      shot: { dirX: 0, dirY: -1, power: 0.5 },
    });
    expect(second.ok).toBe(false);
  });

  it('lists warp targets excluding own pieces and out-of-range squares', () => {
    const state = makeGame([
      ...kings,
      { owner: 'white', type: 'pawn', row: 5, col: 0 },
      { owner: 'white', type: 'rook', row: 5, col: 1 },
    ]);
    const targets = legalWarpTargets(state, idOf(state, 5, 0));
    // A pawn reaches one square: (4,0), (4,1), (6,0), (6,1) — (5,1) holds a friend.
    expect(targets).toHaveLength(4);
    expect(targets.some((t) => t.row === 5 && t.col === 1)).toBe(false);
    expect(targets.some((t) => t.row === 7 && t.col === 0)).toBe(false);
  });
});
