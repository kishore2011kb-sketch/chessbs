import type { GameRules, PieceType } from './types';
import type { PhysicsConfig } from './physics';

export const PIECE_GLYPHS: Record<PieceType, string> = {
  pawn: '\u265F',
  knight: '\u265E',
  bishop: '\u265D',
  rook: '\u265C',
  queen: '\u265B',
  king: '\u265A',
};

export const PIECE_NAMES: Record<PieceType, string> = {
  pawn: 'Pawn',
  knight: 'Knight',
  bishop: 'Bishop',
  rook: 'Rook',
  queen: 'Queen',
  king: 'King',
};

/**
 * Classic chess point values. A piece's Warp Jump range in squares is taken
 * straight from its value, so stronger pieces jump further: pawn 1, knight and
 * bishop 3, rook 5, queen 9 (enough to reach any square). A king has no chess
 * value, so it sits mid-table at 4.
 */
export const PIECE_VALUES: Record<PieceType, number> = {
  pawn: 1,
  knight: 3,
  bishop: 3,
  rook: 5,
  queen: 9,
  king: 4,
};

export const PLAYER_NAMES: Record<'white' | 'black', string> = {
  white: 'White',
  black: 'Black',
};

/**
 * Default rules. Every value here is intentionally configurable — see the
 * in-game Rules panel and README "Documented assumptions".
 */
export const DEFAULT_RULES: GameRules = {
  // Assumption: a launched piece destroys the enemy piece it hits and keeps
  // travelling with reduced speed. Switchable in the Rules panel.
  collisionRule: 'capture-and-continue',
  turnCost: { launch: true, warp: true, doubleBounce: true },
  doubleBounceCooldown: 2,
  promotionChoices: ['queen', 'rook', 'bishop', 'knight'],
  warpJumpsPerPiece: 1,
  // Warp range = the piece's point value in squares (Chebyshev distance).
  warpRange: { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9, king: 4 },
};

/**
 * Launch distance at full drag, in squares, per piece type: the queen throws
 * furthest, then the king, the rook, the bishop and knight (equal), and finally
 * the pawn. A pawn promoted to a queen picks up the queen's reach automatically
 * because its type changes. This limits the launch only — the single wall
 * bounce and its glide across the board stay the same for every piece.
 */
export const LAUNCH_REACH: Record<PieceType, number> = {
  pawn: 2,
  knight: 3.5,
  bishop: 3.5,
  rook: 5,
  king: 6,
  queen: 9,
};

/**
 * Curve is a constant spin rate whose sign comes from the aim mode (left /
 * straight / right), which keeps every shot reproducible and the preview exact.
 */
export const DEFAULT_PHYSICS: PhysicsConfig = {
  minSpeed: 2.2,
  maxSpeed: 8.5,
  friction: 9,
  curveRate: 0.45,
  stopSpeed: 0.32,
  pieceRadius: 0.16,
  wallRestitution: 0.6,
  // One bounce off a wall, then the shot glides across at a minimum speed and
  // stops at the far edge without bouncing again.
  maxWallBounces: 1,
  glideSpeed: 5,
  friendlyRestitution: 0.7,
  enemySpeedRetention: 0.72,
  maxTime: 6,
  step: 1 / 240,
  sampleEvery: 4,
  mass: { pawn: 0.9, knight: 1, bishop: 1, rook: 1.15, queen: 1.05, king: 1.3 },
  launchReach: LAUNCH_REACH,
};

/** Drag distance (in board squares) that maps to full launch power. */
export const MAX_DRAG_SQUARES = 2.2;
