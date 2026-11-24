# CHESSBS

Physics-driven chess-inspired strategy game. Local two-player, localhost only.

Pieces are launched like pool shots, every piece gets one teleport, kings can be
killed and replaced, and the only way to win is to wipe out every enemy piece.

```bash
cd chessbs
npm install
npm run dev      # http://127.0.0.1:5173
npm test         # engine tests
npm run build    # typecheck + production build
```

## How to play

**Launch (every turn).** Select one of your pieces and drag *backwards* from it.
The drag direction sets the launch direction, the drag length sets the power.
How far a full drag throws depends on the piece: queen 9 squares, king 6, rook
5, bishop and knight 3.5, pawn 2 — the pawn is a short throw until it promotes.
This limits the launch only; a shot that hits a wall bounces and glides the same
distance for every piece. Release to fire. Pick the shot path first — **Curve left**, **Straight** or
**Curve right** — and the preview line bends exactly the way the shot will:
skill, not luck.

**Warp Jump (once per piece, per match).** Arm it in the right panel, pick a
piece, tap a highlighted square. Range is the piece's point value in squares:
pawn 1, knight and bishop 3, king 4, rook 5, queen 9 (anywhere on the board).
Empty squares and enemy squares are both legal; your own pieces are not. A spent
jump is marked with a violet dot under the piece.

**Double Bounce (per player, 2-turn cooldown).** Arm it, pick a piece, aim along
a rank, a file or a diagonal, tap to fire. Every enemy piece on that whole line
is eliminated. Friendly pieces are untouched.

**Promotion.** A pawn that lands on the far rank opens a promotion dialog
(queen / rook / bishop / knight). It is never promoted automatically.

**Succession.** Killing a king does not win the game. The owner picks any
surviving piece to become the new king (crowned marker) and play continues.

**Victory.** Total elimination only. No check, no checkmate, no king capture win.

## Documented assumptions

Everything here is configurable from **Rules & physics** in the top bar. Changing
a value starts a fresh match.

| Assumption | Default | Why |
| --- | --- | --- |
| Collision outcome | `capture-and-continue` — the launched piece destroys the enemy it hits and keeps travelling at 72% speed | The brief said not to lock irreversible capture rules; this is the most satisfying playable default and can be switched to `capture-and-stop` or `block` (deflect only, no captures) |
| Turn cost | Launch, Warp Jump and Double Bounce each consume the turn | Explicitly flagged as unconfirmed for Warp Jump in the brief; applied uniformly, individually toggleable |
| Double Bounce cooldown | 2 of the owner's turns | Counted down at the start of each of that player's turns; the ability is ready when the counter hits 0 |
| Warp Jumps per piece | 1 per match | As specified; stored per piece |
| Warp range | The piece's point value in squares — pawn 1, knight/bishop 3, king 4, rook 5, queen 9 | Higher-value pieces jump further; a queen's 9 covers the whole board |
| Launch distance | Full drag throws queen 9, king 6, rook 5, bishop/knight 3.5, pawn 2 squares | Stronger pieces throw further, as specified; drag power scales the throw between 0 and that reach |
| Wall-bounce distance | Identical for every piece — one bounce, then a glide to the far edge | The launch-distance rule is about the throw, not the bounce, so bouncing is not weakened for pawns |
| Double Bounce line | Rank, file or diagonal — all eight directions | The ability wipes a whole chess line, so the four horizontal directions count too |
| Opening formation | Classic chess setup — back ranks on rows 1/8, pawns on rows 2/7 | The familiar starting position |
| Shot path | Curve left, straight, or curve right; the player picks | Straight is fully deterministic (no spin); left/right apply the same spin rate in opposite directions |
| Wall bounce | Exactly one per shot, then the piece glides across the board and stops at the far edge | A bounced piece should not be stopped halfway by friction, and should not rattle around the walls |
| Board mapping | White at the bottom, promotes toward rank 8 | Conventional orientation |
| Resting square | The launched piece snaps to the nearest free square; if it comes to rest on an enemy square, that piece is captured | Physics runs on continuous coordinates, the engine is square-based |
| Promotion choices | Queen, rook, bishop, knight | Queen is always offered; the list is data, so more choices can be added |
| Friendly fire | Friendly pieces are never captured; they deflect the shot | Keeps collisions readable |

## Architecture

```
src/
  engine/          pure, framework-free game core
    types.ts       domain types
    config.ts      tunable rules + physics constants
    board.ts       board geometry, squares, rays
    physics.ts     deterministic pool-style launch simulation
    game.ts        state machine: actions, decisions, turns, victory
    game.test.ts   the 16 required mechanics + integrity tests
  hooks/useGame.ts React binding: dispatch -> effect playback -> commit
  components/      Board, Panels, Modals
  App.tsx          layout shell
```

The engine is a set of pure functions over an immutable `GameState`. The UI never
mutates state and never decides a rule — it calls `applyAction` and renders the
result. Launch previews and committed shots run the *same* `simulateShot`, so the
trajectory line is guaranteed to match what happens.

State tracked centrally: board positions, piece identity/owner/type, current
player, move history, captured pieces, per-piece Warp Jump usage, per-player
Double Bounce cooldown, current king, pending succession/promotion decisions,
game-over state and winner.

Invalid actions (wrong player's piece, spent warp jump, ability on cooldown,
second action in a turn, action after the match ends, warp onto a friendly piece)
are rejected by the engine with a message surfaced as a toast.

## Effects

Actions return an optional effect (`flight` with the recorded trajectory and
capture timestamps, `beam`, or `warp`). The hook plays it with
`requestAnimationFrame` and commits the new state when it finishes, which keeps
animation and state in lockstep and locks input mid-effect.

## Tested

`npm test` covers: drag launching, drag-length → power → distance, curved path
(and straight aim), left/right curving in opposite directions, a single wall
bounce ending at the far edge, preview/commit determinism, one Warp Jump per
piece, warp capture, warp onto friendly rejected, promotion prompt and choice,
king capture → succession (not victory), successor crowned, Double Bounce
vertical, diagonal, horizontal, enemies-only, friendly immunity, warp range by
point value, launch distance ordered queen → king → rook → bishop/knight → pawn,
identical wall-bounce glide for every piece,
two-turn cooldown start and expiry, total-elimination victory, king-only capture
not winning, and turn integrity.

## Not implemented

Online multiplayer. The engine is transport-agnostic (actions in, state out) so a
server could sit behind it later, but nothing networked exists today.
