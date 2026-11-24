/**
 * CHESSBS — core domain types.
 *
 * Coordinate system: row 0 is the top rank (rank 8), row 7 is the bottom rank
 * (rank 1). col 0 is file 'a'. White starts at the bottom and promotes upward
 * (towards row 0); black starts at the top and promotes towards row 7.
 */

export type Player = 'white' | 'black';

export type PieceType = 'pawn' | 'knight' | 'bishop' | 'rook' | 'queen' | 'king';


/**
 * What happens when a launched piece touches another piece.
 * Kept configurable on purpose — the final collision rules are not yet locked.
 */
export type CollisionRule =
  /** Enemy pieces are eliminated and the shot keeps travelling (default). */
  | 'capture-and-continue'
  /** Enemy piece is eliminated and the shot stops there. */
  | 'capture-and-stop'
  /** Nothing is captured; every piece (friendly or enemy) just deflects the shot. */
  | 'block';

export type Direction =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'upLeft'
  | 'upRight'
  | 'downLeft'
  | 'downRight';

export interface Position {
  row: number;
  col: number;
}

export interface Piece {
  id: string;
  owner: Player;
  type: PieceType;
  row: number;
  col: number;
  /** Warp Jump is per-piece and single use for the whole match. */
  warpUsed: boolean;
  /** Set on the original king and on any successor chosen after a king falls. */
  isKing: boolean;
}

/** A decision the game is waiting on before the turn can continue. */
export type Decision =
  | { kind: 'succession'; player: Player }
  | { kind: 'promotion'; player: Player; pieceId: string };

export interface LogEntry {
  id: number;
  turn: number;
  player: Player;
  text: string;
}

export interface GameRules {
  collisionRule: CollisionRule;
  /** Which actions consume the player's turn. */
  turnCost: {
    launch: boolean;
    warp: boolean;
    doubleBounce: boolean;
  };
  /** Double Bounce is a per-player cooldown, measured in that player's turns. */
  doubleBounceCooldown: number;
  /** Choices offered by the promotion dialog. Queen must always be present. */
  promotionChoices: PieceType[];
  /** Warp Jumps each piece gets per match. */
  warpJumpsPerPiece: number;
  /**
   * Warp range in squares, per piece type. Omitted entries fall back to the
   * piece's classic point value (see PIECE_VALUES).
   */
  warpRange?: Partial<Record<PieceType, number>>;
}

export interface GameState {
  pieces: Piece[];
  currentPlayer: Player;
  /** Remaining Double Bounce cooldown turns, per player. 0 = ready. */
  cooldowns: Record<Player, number>;
  /** Ordered queue of decisions blocking the game. Empty = normal play. */
  pending: Decision[];
  winner: Player | null;
  turn: number;
  log: LogEntry[];
  /** Pieces of each player that have been eliminated. */
  captured: Record<Player, PieceType[]>;
  rules: GameRules;
  physics: import('./physics').PhysicsConfig;
  nextLogId: number;
}
