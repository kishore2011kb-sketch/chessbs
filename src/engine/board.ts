import type { Direction, Piece, Player, Position } from './types';
import type { Vec } from './physics';

export const BOARD_SIZE = 8;
export const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;

export const other = (p: Player): Player => (p === 'white' ? 'black' : 'white');

export const promotionRow = (p: Player): number => (p === 'white' ? 0 : 7);

export const inBounds = (row: number, col: number): boolean =>
  Number.isInteger(row) && Number.isInteger(col) && row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;

export const clampSquare = (n: number): number => Math.min(BOARD_SIZE - 1, Math.max(0, n));

export const squareKey = (row: number, col: number): string => `${row},${col}`;

export const squareName = (row: number, col: number): string => `${FILES[col] ?? '?'}${8 - row}`;

/** Centre of a square in board units (0..8). */
export const centreOf = (row: number, col: number): Vec => ({ x: col + 0.5, y: row + 0.5 });

/** Nearest square to a continuous board point. */
export const squareOfPoint = (x: number, y: number): Position => ({
  row: clampSquare(Math.round(y - 0.5)),
  col: clampSquare(Math.round(x - 0.5)),
});

export const pieceAt = (pieces: Piece[], row: number, col: number): Piece | undefined =>
  pieces.find((p) => p.row === row && p.col === col);

export const findPiece = (pieces: Piece[], id: string): Piece | undefined => pieces.find((p) => p.id === id);

/** Unit vector for each legal Double Bounce direction: files, ranks and diagonals. */
export const DIRECTION_VECTORS: Record<Direction, { dr: number; dc: number }> = {
  up: { dr: -1, dc: 0 },
  down: { dr: 1, dc: 0 },
  left: { dr: 0, dc: -1 },
  right: { dr: 0, dc: 1 },
  upLeft: { dr: -1, dc: -1 },
  upRight: { dr: -1, dc: 1 },
  downLeft: { dr: 1, dc: -1 },
  downRight: { dr: 1, dc: 1 },
};

export const ALL_DIRECTIONS: Direction[] = [
  'up',
  'upRight',
  'right',
  'downRight',
  'down',
  'downLeft',
  'left',
  'upLeft',
];

/** Squares between two positions, counted the way a king moves (Chebyshev). */
export const squareDistance = (a: Position, b: Position): number =>
  Math.max(Math.abs(a.row - b.row), Math.abs(a.col - b.col));

/** Every square along a ray from `from` to the edge of the board (exclusive). */
export function raySquares(from: Position, direction: Direction): Position[] {
  const { dr, dc } = DIRECTION_VECTORS[direction];
  const out: Position[] = [];
  let row = from.row + dr;
  let col = from.col + dc;
  while (inBounds(row, col)) {
    out.push({ row, col });
    row += dr;
    col += dc;
  }
  return out;
}
