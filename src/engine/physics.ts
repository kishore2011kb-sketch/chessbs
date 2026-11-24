/**
 * CHESSBS physics — pool-style launch simulation.
 *
 * The simulation is fully deterministic: the same state + shot always produces
 * the same trajectory, and the UI preview runs exactly the same code as the
 * committed shot. Skill, not luck, decides where a piece lands.
 *
 * Model:
 *  - launch speed = lerp(minSpeed, maxSpeed, power) / pieceMass, or, when a
 *    `reach` is supplied, the speed that travels exactly `reach * power`
 *    squares — this is how each piece type gets its own launch distance while
 *    every piece keeps the same wall-bounce glide
 *  - velocity is rotated by a constant `curveRate` each step (a spin, so shots
 *    bend clockwise in a predictable arc)
 *  - friction removes a constant amount of speed per second
 *  - walls reflect with restitution, pieces are circles of radius `pieceRadius`
 */

import type { CollisionRule, PieceType, Player } from './types';
import { BOARD_SIZE } from './board';

export interface Vec {
  x: number;
  y: number;
}

/** Aim curve: -1 bends left, 0 flies straight, +1 bends right. */
export type Curve = -1 | 0 | 1;

export interface Shot {
  dirX: number;
  dirY: number;
  /** 0..1 */
  power: number;
  /**
   * Signed curve multiplier. Omitted shots default to +1, the classic
   * clockwise arc, so callers that do not choose an aim mode keep the old feel.
   */
  curve?: Curve;
}

export interface SimObstacle {
  id: string;
  owner: Player;
  x: number;
  y: number;
}

export interface ShotSample {
  t: number;
  x: number;
  y: number;
}

export interface CaptureEvent {
  t: number;
  pieceId: string;
  x: number;
  y: number;
}

export interface PhysicsConfig {
  minSpeed: number;
  maxSpeed: number;
  friction: number;
  curveRate: number;
  stopSpeed: number;
  pieceRadius: number;
  wallRestitution: number;
  /** Wall bounces one shot may use before it glides to the far edge. */
  maxWallBounces: number;
  /** Minimum speed kept after the wall bounce while gliding across. */
  glideSpeed: number;
  friendlyRestitution: number;
  enemySpeedRetention: number;
  maxTime: number;
  step: number;
  sampleEvery: number;
  mass: Record<PieceType, number>;
  /** Full-drag launch distance in squares, per piece type. */
  launchReach?: Record<PieceType, number>;
}

export interface ShotResult {
  samples: ShotSample[];
  captures: CaptureEvent[];
  rest: Vec;
  duration: number;
  bounces: number;
  wallBounces: number;
}

/**
 * Convert a backwards drag into a shot.
 * The piece launches opposite to the drag; drag length becomes power.
 */
export function dragToShot(dragX: number, dragY: number, maxDrag = 2.2, curve: Curve = 1): Shot {
  const len = Math.hypot(dragX, dragY);
  if (len < 1e-6) return { dirX: 0, dirY: 0, power: 0, curve };
  return {
    dirX: -dragX / len,
    dirY: -dragY / len,
    power: Math.min(1, len / maxDrag),
    curve,
  };
}

export function launchSpeed(power: number, mass: number, config: PhysicsConfig, reach?: number): number {
  const p = Math.min(1, Math.max(0, power));
  if (reach !== undefined && reach > 0) {
    // Constant friction removes v^2 / (2 * friction) of travel from speed v, so
    // this speed lands exactly `reach` squares away at full drag and scales
    // linearly with the drag. Only the launch distance is limited here — the
    // wall-bounce glide below is untouched and identical for every piece.
    return Math.sqrt(2 * config.friction * reach * p);
  }
  return (config.minSpeed + p * (config.maxSpeed - config.minSpeed)) / mass;
}

export function simulateShot(args: {
  shooterId: string;
  shooterOwner: Player;
  start: Vec;
  mass: number;
  obstacles: SimObstacle[];
  shot: Shot;
  config: PhysicsConfig;
  collisionRule: CollisionRule;
  /** Full-drag launch distance in squares. Omit to fall back to mass-only speed. */
  reach?: number;
}): ShotResult {
  const { config, collisionRule } = args;
  const R = config.pieceRadius;
  const dirLen = Math.hypot(args.shot.dirX, args.shot.dirY);

  const stationary: ShotResult = {
    samples: [{ t: 0, x: args.start.x, y: args.start.y }],
    captures: [],
    rest: { x: args.start.x, y: args.start.y },
    duration: 0,
    bounces: 0,
    wallBounces: 0,
  };
  if (dirLen < 1e-6 || args.shot.power <= 0) return stationary;

  const curve = args.shot.curve ?? 1;
  const speed = launchSpeed(args.shot.power, args.mass, config, args.reach);
  let vx = (args.shot.dirX / dirLen) * speed;
  let vy = (args.shot.dirY / dirLen) * speed;

  let x = args.start.x;
  let y = args.start.y;
  let t = 0;
  let bounces = 0;

  const alive = new Map(args.obstacles.map((o) => [o.id, { ...o }]));
  const samples: ShotSample[] = [{ t: 0, x, y }];
  const captures: CaptureEvent[] = [];

  const dt = config.step;
  const minB = R;
  const maxB = BOARD_SIZE - R;
  const maxWallBounces = Math.max(0, config.maxWallBounces);
  let steps = 0;
  let stopped = false;
  let wallBounces = 0;

  while (t < config.maxTime) {
    const sp = Math.hypot(vx, vy);
    if (sp <= config.stopSpeed) break;

    // Spin: rotate velocity a fixed amount per step, signed by the aim mode.
    const angle = config.curveRate * curve * dt;
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    const rvx = vx * ca - vy * sa;
    const rvy = vx * sa + vy * ca;
    vx = rvx;
    vy = rvy;

    // Friction: constant deceleration along the velocity. A shot that has used
    // its wall bounce glides instead, so it always reaches the far edge.
    if (wallBounces === 0) {
      const decay = Math.max(0, sp - config.friction * dt) / sp;
      vx *= decay;
      vy *= decay;
    }

    x += vx * dt;
    y += vy * dt;
    t += dt;
    steps += 1;

    // Walls: exactly one bounce, then the shot glides across the board and
    // comes to rest at the far edge instead of bouncing again.
    if (x < minB || x > maxB || y < minB || y > maxB) {
      if (wallBounces < maxWallBounces) {
        if (x < minB) {
          x = minB + (minB - x);
          vx = -vx * config.wallRestitution;
        } else if (x > maxB) {
          x = maxB - (x - maxB);
          vx = -vx * config.wallRestitution;
        }
        if (y < minB) {
          y = minB + (minB - y);
          vy = -vy * config.wallRestitution;
        } else if (y > maxB) {
          y = maxB - (y - maxB);
          vy = -vy * config.wallRestitution;
        }
        wallBounces += 1;
        bounces += 1;
        const afterBounce = Math.hypot(vx, vy);
        if (afterBounce > 1e-6 && afterBounce < config.glideSpeed) {
          const boost = config.glideSpeed / afterBounce;
          vx *= boost;
          vy *= boost;
        }
      } else {
        x = Math.min(maxB, Math.max(minB, x));
        y = Math.min(maxB, Math.max(minB, y));
        vx = 0;
        vy = 0;
        stopped = true;
      }
    }

    // Piece collisions.
    for (const obstacle of alive.values()) {
      const dx = obstacle.x - x;
      const dy = obstacle.y - y;
      const dist = Math.hypot(dx, dy);
      if (dist > 2 * R) continue;

      const isEnemy = obstacle.owner !== args.shooterOwner;
      if (isEnemy && collisionRule !== 'block') {
        captures.push({ t, pieceId: obstacle.id, x: obstacle.x, y: obstacle.y });
        alive.delete(obstacle.id);
        if (collisionRule === 'capture-and-stop') {
          stopped = true;
          break;
        }
        vx *= config.enemySpeedRetention;
        vy *= config.enemySpeedRetention;
      } else {
        // Friendly pieces (and enemies under the 'block' rule) deflect the shot.
        const nx = dist > 1e-6 ? dx / dist : 1;
        const ny = dist > 1e-6 ? dy / dist : 0;
        const overlap = 2 * R - dist;
        x -= nx * overlap;
        y -= ny * overlap;
        const dot = vx * nx + vy * ny;
        vx = (vx - 2 * dot * nx) * config.friendlyRestitution;
        vy = (vy - 2 * dot * ny) * config.friendlyRestitution;
        bounces += 1;
      }
    }

    if (stopped) break;
    if (steps % config.sampleEvery === 0) samples.push({ t, x, y });
  }

  samples.push({ t, x, y });
  return { samples, captures, rest: { x, y }, duration: t, bounces, wallBounces };
}

/** Interpolate the position along a recorded trajectory. */
export function sampleAt(samples: ShotSample[], time: number): Vec {
  if (samples.length === 0) return { x: 0, y: 0 };
  if (time <= samples[0].t) return { x: samples[0].x, y: samples[0].y };
  for (let i = 1; i < samples.length; i += 1) {
    const prev = samples[i - 1];
    const next = samples[i];
    if (time <= next.t) {
      const span = next.t - prev.t || 1;
      const k = (time - prev.t) / span;
      return { x: prev.x + (next.x - prev.x) * k, y: prev.y + (next.y - prev.y) * k };
    }
  }
  const last = samples[samples.length - 1];
  return { x: last.x, y: last.y };
}
