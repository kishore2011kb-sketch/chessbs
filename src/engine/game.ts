/**
 * CHESSBS game engine.
 *
 * Pure functions over an immutable `GameState`. The UI never mutates state and
 * never decides rules: it calls `applyAction` and renders what comes back.
 *
 * Turn model: one action per turn (launch / warp / double bounce), configurable
 * per action via `rules.turnCost`. A turn only advances once every queued
 * decision (king succession, pawn promotion) has been resolved.
 */

import { DEFAULT_PHYSICS, DEFAULT_RULES, PIECE_NAMES, PIECE_VALUES, PLAYER_NAMES } from './config';
import {
  centreOf,
  findPiece,
  inBounds,
  other,
  pieceAt,
  promotionRow,
  raySquares,
  squareKey,
  squareName,
  squareOfPoint,
  squareDistance,
  DIRECTION_VECTORS,
} from './board';
import { simulateShot, type CaptureEvent, type Shot, type ShotResult, type ShotSample, type Vec } from './physics';
import type {
  Decision,
  Direction,
  GameRules,
  GameState,
  Piece,
  PieceType,
  Player,
  Position,
} from './types';

const BACK_RANK: PieceType[] = ['rook', 'knight', 'bishop', 'queen', 'king', 'bishop', 'knight', 'rook'];

/**
 * Opening formation: the classic chess setup, unchanged. Back ranks on rows
 * 0/7, pawn screens on rows 1/6.
 */
function buildPieces(): Piece[] {
  const pieces: Piece[] = [];
  const add = (owner: Player, type: PieceType, row: number, col: number, isKing = false) => {
    pieces.push({
      id: `${owner}-${type}-${pieces.length}`,
      owner,
      type,
      row,
      col,
      warpUsed: false,
      isKing,
    });
  };
  BACK_RANK.forEach((type, col) => add('black', type, 0, col, type === 'king'));
  BACK_RANK.forEach((type, col) => add('white', type, 7, col, type === 'king'));
  for (let col = 0; col < 8; col += 1) {
    add('black', 'pawn', 1, col);
    add('white', 'pawn', 6, col);
  }
  return pieces;
}

export function createGame(rules: GameRules = DEFAULT_RULES, physics = DEFAULT_PHYSICS): GameState {
  const base: GameState = {
    pieces: buildPieces(),
    currentPlayer: 'white',
    cooldowns: { white: 0, black: 0 },
    pending: [],
    winner: null,
    turn: 1,
    log: [],
    captured: { white: [], black: [] },
    rules: { ...rules },
    physics: { ...physics, mass: { ...physics.mass } },
    nextLogId: 1,
  };
  return withLog(base, 'white', 'Match started — total elimination only, no checkmate.');
}

/* ------------------------------------------------------------------ helpers */

function withLog(state: GameState, player: Player, text: string): GameState {
  return {
    ...state,
    log: [...state.log, { id: state.nextLogId, turn: state.turn, player, text }],
    nextLogId: state.nextLogId + 1,
  };
}

export const getStatus = (state: GameState): 'playing' | 'decision' | 'game-over' => {
  if (state.winner) return 'game-over';
  return state.pending.length > 0 ? 'decision' : 'playing';
};

export const currentDecision = (state: GameState): Decision | null => state.pending[0] ?? null;

export const piecesOf = (state: GameState, player: Player): Piece[] => state.pieces.filter((p) => p.owner === player);

export const findKing = (state: GameState, player: Player): Piece | undefined =>
  state.pieces.find((p) => p.owner === player && p.isKing);

export function canUseDoubleBounce(state: GameState, player: Player): boolean {
  return state.cooldowns[player] <= 0;
}


/**
 * How far a piece may Warp Jump, in squares. Range is the piece's classic point
 * value, so a pawn hops 1 square, a rook 5 and a queen the whole board.
 */
export function warpRange(rules: GameRules, type: PieceType): number {
  const override = rules.warpRange?.[type];
  return override ?? PIECE_VALUES[type];
}

/** Every square a piece may Warp Jump to (in range, not its own, no own pieces). */
export function legalWarpTargets(state: GameState, pieceId: string): Position[] {
  const piece = findPiece(state.pieces, pieceId);
  if (!piece || piece.warpUsed) return [];
  const range = warpRange(state.rules, piece.type);
  const out: Position[] = [];
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      if (squareDistance(piece, { row, col }) > range) continue;
      const occupant = pieceAt(state.pieces, row, col);
      if (occupant && occupant.owner === piece.owner) continue;
      out.push({ row, col });
    }
  }
  return out;
}

/** Enemy pieces that a Double Bounce in `direction` would eliminate. */
export function bouncePreview(state: GameState, pieceId: string, direction: Direction): Piece[] {
  const piece = findPiece(state.pieces, pieceId);
  if (!piece || !(direction in DIRECTION_VECTORS)) return [];
  return raySquares(piece, direction)
    .map((sq) => pieceAt(state.pieces, sq.row, sq.col))
    .filter((p): p is Piece => Boolean(p) && p!.owner !== piece.owner);
}

export function previewLaunch(state: GameState, pieceId: string, shot: Shot): ShotResult | null {
  const shooter = findPiece(state.pieces, pieceId);
  if (!shooter) return null;
  return runShot(state, shooter, shot);
}

function runShot(state: GameState, shooter: Piece, shot: Shot): ShotResult {
  const obstacles = state.pieces
    .filter((p) => p.id !== shooter.id)
    .map((p) => {
      const c = centreOf(p.row, p.col);
      return { id: p.id, owner: p.owner, x: c.x, y: c.y };
    });
  return simulateShot({
    shooterId: shooter.id,
    shooterOwner: shooter.owner,
    start: centreOf(shooter.row, shooter.col),
    mass: state.physics.mass[shooter.type],
    // Each piece throws its own distance; the wall bounce stays default.
    reach: state.physics.launchReach?.[shooter.type],
    obstacles,
    shot,
    config: state.physics,
    collisionRule: state.rules.collisionRule,
  });
}

function nearestFreeSquare(occupied: Map<string, Piece>, from: Vec): Position | null {
  let best: Position | null = null;
  let bestDist = Infinity;
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      if (occupied.has(squareKey(row, col))) continue;
      const c = centreOf(row, col);
      const d = Math.hypot(c.x - from.x, c.y - from.y);
      if (d < bestDist - 1e-9) {
        bestDist = d;
        best = { row, col };
      }
    }
  }
  return best;
}

/**
 * Where the launched piece ends up, and everything it eliminated.
 * A shot that comes to rest on a square held by an enemy takes it too.
 */
function resolveLanding(
  state: GameState,
  shooter: Piece,
  sim: ShotResult,
): { landing: Position; capturedIds: string[] } {
  const captured = new Set(sim.captures.map((c) => c.pieceId));
  const occupied = new Map<string, Piece>();
  for (const p of state.pieces) {
    if (p.id === shooter.id || captured.has(p.id)) continue;
    occupied.set(squareKey(p.row, p.col), p);
  }

  const primary = squareOfPoint(sim.rest.x, sim.rest.y);
  const occupant = occupied.get(squareKey(primary.row, primary.col));

  if (!occupant) return { landing: primary, capturedIds: [...captured] };
  if (occupant.owner !== shooter.owner) {
    captured.add(occupant.id);
    return { landing: primary, capturedIds: [...captured] };
  }
  const free = nearestFreeSquare(occupied, sim.rest);
  return { landing: free ?? { row: shooter.row, col: shooter.col }, capturedIds: [...captured] };
}

function describeCaptures(state: GameState, ids: string[]): string {
  const names = ids
    .map((id) => findPiece(state.pieces, id))
    .filter((p): p is Piece => Boolean(p))
    .map((p) => `${PIECE_NAMES[p.type]} ${squareName(p.row, p.col)}`);
  if (names.length === 0) return '';
  return ` — eliminated ${names.join(', ')}`;
}

function applyCaptures(state: GameState, ids: string[]): GameState {
  if (ids.length === 0) return state;
  const captured = { white: [...state.captured.white], black: [...state.captured.black] };
  for (const id of ids) {
    const piece = findPiece(state.pieces, id);
    if (piece) captured[piece.owner].push(piece.type);
  }
  return {
    ...state,
    pieces: state.pieces.filter((p) => !ids.includes(p.id)),
    captured,
  };
}

function endTurn(state: GameState): GameState {
  const nextPlayer = other(state.currentPlayer);
  return {
    ...state,
    currentPlayer: nextPlayer,
    turn: state.turn + 1,
    cooldowns: {
      ...state.cooldowns,
      [nextPlayer]: Math.max(0, state.cooldowns[nextPlayer] - 1),
    },
  };
}

/**
 * Post-action resolution: total-elimination victory, king succession, pawn
 * promotion, then the turn advance.
 */
function settle(state: GameState, actingPlayer: Player, costsTurn: boolean): GameState {
  for (const player of ['white', 'black'] as Player[]) {
    if (!state.pieces.some((p) => p.owner === player)) {
      const winner = other(player);
      const won = withLog(state, winner, `${PLAYER_NAMES[player]} army eliminated — ${PLAYER_NAMES[winner]} wins.`);
      return { ...won, pending: [], winner };
    }
  }

  const pending: Decision[] = [];
  for (const player of ['white', 'black'] as Player[]) {
    const hasKing = state.pieces.some((p) => p.owner === player && p.isKing);
    if (!hasKing) pending.push({ kind: 'succession', player });
  }
  for (const p of state.pieces) {
    if (p.owner === actingPlayer && p.type === 'pawn' && p.row === promotionRow(actingPlayer)) {
      pending.push({ kind: 'promotion', player: p.owner, pieceId: p.id });
    }
  }

  const next: GameState = { ...state, pending };
  if (pending.length > 0) return next;
  return costsTurn ? endTurn(next) : next;
}

/** Voluntary resignation: the opponent wins the match. */
export function resign(state: GameState, player: Player): GameState {
  if (state.winner) return state;
  const winner = other(player);
  return {
    ...withLog(state, winner, `${PLAYER_NAMES[player]} resigned — ${PLAYER_NAMES[winner]} wins.`),
    winner,
    pending: [],
  };
}

/* ------------------------------------------------------------------ actions */

export type GameAction =
  | { kind: 'launch'; pieceId: string; shot: Shot }
  | { kind: 'warp'; pieceId: string; target: Position }
  | { kind: 'doubleBounce'; pieceId: string; direction: Direction }
  | { kind: 'promote'; pieceId: string; to: PieceType }
  | { kind: 'succeed'; pieceId: string };

export interface FlightEffect {
  kind: 'flight';
  pieceId: string;
  samples: ShotSample[];
  captures: CaptureEvent[];
  duration: number;
  rest: Vec;
}

export interface BeamEffect {
  kind: 'beam';
  pieceId: string;
  direction: Direction;
  from: Vec;
  to: Vec;
  hits: { id: string; x: number; y: number }[];
}

export interface WarpEffect {
  kind: 'warp';
  pieceId: string;
  from: Vec;
  to: Vec;
}

export type Effect = FlightEffect | BeamEffect | WarpEffect;

export type ActionResult =
  | { ok: true; state: GameState; effect?: Effect }
  | { ok: false; error: string };

const err = (error: string): ActionResult => ({ ok: false, error });

function guard(state: GameState): ActionResult | null {
  if (state.winner) return err('The match is already over.');
  if (state.pending.length > 0) return err('Finish the pending decision first.');
  return null;
}

export function applyAction(state: GameState, action: GameAction): ActionResult {
  switch (action.kind) {
    case 'launch':
      return doLaunch(state, action.pieceId, action.shot);
    case 'warp':
      return doWarp(state, action.pieceId, action.target);
    case 'doubleBounce':
      return doDoubleBounce(state, action.pieceId, action.direction);
    case 'promote':
      return doPromote(state, action.pieceId, action.to);
    case 'succeed':
      return doSucceed(state, action.pieceId);
    default:
      return err('Unknown action.');
  }
}

function doLaunch(state: GameState, pieceId: string, shot: Shot): ActionResult {
  const blocked = guard(state);
  if (blocked) return blocked;

  const shooter = findPiece(state.pieces, pieceId);
  if (!shooter) return err('That piece does not exist.');
  if (shooter.owner !== state.currentPlayer) return err("That piece is not yours to launch.");

  const sim = runShot(state, shooter, shot);
  const { landing, capturedIds } = resolveLanding(state, shooter, sim);

  const stayedPut = landing.row === shooter.row && landing.col === shooter.col;
  if (stayedPut && capturedIds.length === 0) {
    return err('That launch had no effect — pull back further.');
  }

  const fromSquare = squareName(shooter.row, shooter.col);
  const moved = state.pieces.map((p) =>
    p.id === shooter.id ? { ...p, row: landing.row, col: landing.col } : p,
  );

  let next: GameState = applyCaptures({ ...state, pieces: moved }, capturedIds);
  next = withLog(
    next,
    shooter.owner,
    `${PIECE_NAMES[shooter.type]} ${fromSquare} \u2192 ${squareName(landing.row, landing.col)}${describeCaptures(state, capturedIds)}`,
  );
  next = settle(next, shooter.owner, state.rules.turnCost.launch);

  return {
    ok: true,
    state: next,
    effect: {
      kind: 'flight',
      pieceId: shooter.id,
      samples: sim.samples,
      captures: sim.captures,
      duration: sim.duration,
      rest: sim.rest,
    },
  };
}

function doWarp(state: GameState, pieceId: string, target: Position): ActionResult {
  const blocked = guard(state);
  if (blocked) return blocked;

  const piece = findPiece(state.pieces, pieceId);
  if (!piece) return err('That piece does not exist.');
  if (piece.owner !== state.currentPlayer) return err("That piece is not yours to warp.");
  if (piece.warpUsed) return err('That piece has already spent its Warp Jump.');
  if (!inBounds(target.row, target.col)) return err('That square is off the board.');
  if (target.row === piece.row && target.col === piece.col) return err('That piece is already there.');

  const range = warpRange(state.rules, piece.type);
  if (squareDistance(piece, target) > range) {
    return err(
      `A ${PIECE_NAMES[piece.type].toLowerCase()} (${PIECE_VALUES[piece.type]} pts) can only warp ${range} square${range === 1 ? '' : 's'}.`,
    );
  }

  const occupant = pieceAt(state.pieces, target.row, target.col);
  if (occupant && occupant.owner === piece.owner) return err('You cannot warp onto your own piece.');

  const from = centreOf(piece.row, piece.col);
  const to = centreOf(target.row, target.col);
  const capturedIds = occupant ? [occupant.id] : [];

  const moved = state.pieces.map((p) =>
    p.id === piece.id ? { ...p, row: target.row, col: target.col, warpUsed: true } : p,
  );
  let next = applyCaptures({ ...state, pieces: moved }, capturedIds);
  next = withLog(
    next,
    piece.owner,
    `Warp Jump: ${PIECE_NAMES[piece.type]} ${squareName(piece.row, piece.col)} \u2192 ${squareName(target.row, target.col)}${describeCaptures(state, capturedIds)}`,
  );
  next = settle(next, piece.owner, state.rules.turnCost.warp);

  return { ok: true, state: next, effect: { kind: 'warp', pieceId: piece.id, from, to } };
}

function doDoubleBounce(state: GameState, pieceId: string, direction: Direction): ActionResult {
  const blocked = guard(state);
  if (blocked) return blocked;

  const piece = findPiece(state.pieces, pieceId);
  if (!piece) return err('That piece does not exist.');
  if (piece.owner !== state.currentPlayer) return err("That piece is not yours to fire.");
  if (!(direction in DIRECTION_VECTORS)) {
    return err('Double Bounce fires along a rank, a file or a diagonal.');
  }
  if (!canUseDoubleBounce(state, piece.owner)) {
    const left = state.cooldowns[piece.owner];
    return err(`Double Bounce is cooling down (${left} turn${left === 1 ? '' : 's'} left).`);
  }

  const hits = bouncePreview(state, pieceId, direction);
  const hitIds = hits.map((p) => p.id);
  const line = raySquares(piece, direction);
  const last = line[line.length - 1] ?? { row: piece.row, col: piece.col };
  const from = centreOf(piece.row, piece.col);
  const to = centreOf(last.row, last.col);

  let next: GameState = applyCaptures(state, hitIds);
  next = {
    ...next,
    cooldowns: { ...next.cooldowns, [piece.owner]: state.rules.doubleBounceCooldown },
  };
  next = withLog(
    next,
    piece.owner,
    `Double Bounce (${direction}) from ${squareName(piece.row, piece.col)}${describeCaptures(state, hitIds) || ' — no targets hit'}`,
  );
  next = settle(next, piece.owner, state.rules.turnCost.doubleBounce);

  return {
    ok: true,
    state: next,
    effect: {
      kind: 'beam',
      pieceId: piece.id,
      direction,
      from,
      to,
      hits: hits.map((p) => {
        const c = centreOf(p.row, p.col);
        return { id: p.id, x: c.x, y: c.y };
      }),
    },
  };
}

function doPromote(state: GameState, pieceId: string, to: PieceType): ActionResult {
  const decision = currentDecision(state);
  if (!decision || decision.kind !== 'promotion') return err('No promotion is pending.');
  if (decision.pieceId !== pieceId) return err('Promote the pawn that reached the far rank.');
  if (!state.rules.promotionChoices.includes(to)) return err('That promotion is not available.');
  if (to === 'king' || to === 'pawn') return err('Choose a non-pawn, non-king promotion.');

  const pawn = findPiece(state.pieces, pieceId);
  if (!pawn) return err('That piece does not exist.');

  const pieces = state.pieces.map((p) => (p.id === pieceId ? { ...p, type: to } : p));
  let next: GameState = { ...state, pieces, pending: state.pending.slice(1) };
  next = withLog(next, pawn.owner, `${PIECE_NAMES[pawn.type]} on ${squareName(pawn.row, pawn.col)} promoted to ${PIECE_NAMES[to]}.`);
  if (next.pending.length === 0) next = endTurn(next);
  return { ok: true, state: next };
}

function doSucceed(state: GameState, pieceId: string): ActionResult {
  const decision = currentDecision(state);
  if (!decision || decision.kind !== 'succession') return err('No succession is pending.');

  const piece = findPiece(state.pieces, pieceId);
  if (!piece) return err('That piece does not exist.');
  if (piece.owner !== decision.player) return err('Choose one of your own surviving pieces.');
  if (piece.isKing) return err('That piece is already the king.');

  const pieces = state.pieces.map((p) =>
    p.owner === decision.player ? { ...p, isKing: p.id === piece.id } : p,
  );
  let next: GameState = { ...state, pieces, pending: state.pending.slice(1) };
  next = withLog(
    next,
    decision.player,
    `Succession: ${PIECE_NAMES[piece.type]} on ${squareName(piece.row, piece.col)} rises as the new king.`,
  );
  if (next.pending.length === 0) next = endTurn(next);
  return { ok: true, state: next };
}
