import type { GameStyle } from "./types";

export const ARENA_GAME_VERSION = "orb-arena-coliseum-v3" as const;
export const ARENA_HARD_CAP_SECONDS = 10 * 60;

export type ArenaPace = "demo" | "production";

export type ArenaConfig = {
  version: typeof ARENA_GAME_VERSION;
  playerCount: number;
  radius: number;
  courseScale: number;
  maxSeconds: number;
  outerCloseAt: number;
  innerCloseAt: number;
  suddenDeathAt: number;
  finalCollapseAt: number;
  jumpImpulse: number;
  jumpCooldownMs: number;
  impactDamageScale: number;
  style: GameStyle;
  seed: string;
};

/** Approximate half-footprint of the authored course. Geometry scales, physics does not. */
export function arenaRadiusForPlayers(playerCount: number) {
  const players = Math.max(2, Math.min(200, Math.floor(playerCount)));
  return Math.min(62, Math.max(24, 20 + Math.sqrt(players) * 2.05));
}

export function buildArenaConfig(input: {
  playerCount: number;
  pace: ArenaPace;
  style: GameStyle;
  seed: string;
}): ArenaConfig {
  const playerCount = Math.max(2, Math.min(200, Math.floor(input.playerCount)));
  const maxSeconds = input.pace === "demo" ? 150 : ARENA_HARD_CAP_SECONDS;
  const radius = arenaRadiusForPlayers(playerCount);
  return {
    version: ARENA_GAME_VERSION,
    playerCount,
    radius,
    courseScale: radius / 26,
    maxSeconds,
    outerCloseAt: maxSeconds * 0.36,
    innerCloseAt: maxSeconds * 0.62,
    suddenDeathAt: maxSeconds * 0.78,
    finalCollapseAt: maxSeconds * 0.92,
    jumpImpulse: 4.8,
    jumpCooldownMs: 760,
    impactDamageScale: 2.15,
    style: input.style,
    seed: input.seed,
  };
}

/** Kept for admin compatibility. Arena V3 is an enclosed coliseum; playable territory closes with gates, never a death edge. */
export function arenaRadiusAt(config: ArenaConfig, _elapsedSeconds: number, _survivors: number) {
  return config.radius;
}
