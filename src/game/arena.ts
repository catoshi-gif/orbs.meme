import type { GameStyle } from "./types";

export const ARENA_GAME_VERSION = "orb-arena-course-v2" as const;
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
  return Math.min(35, Math.max(13, 10.5 + Math.sqrt(players) * 1.72));
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
    courseScale: radius / 17.5,
    maxSeconds,
    outerCloseAt: maxSeconds * 0.36,
    innerCloseAt: maxSeconds * 0.62,
    suddenDeathAt: maxSeconds * 0.78,
    finalCollapseAt: maxSeconds * 0.92,
    jumpImpulse: 4.9,
    jumpCooldownMs: 760,
    impactDamageScale: 4.5,
    style: input.style,
    seed: input.seed,
  };
}

/** Kept for admin compatibility. Arena V2 closes authored sectors instead of shrinking a circle. */
export function arenaRadiusAt(config: ArenaConfig, _elapsedSeconds: number, _survivors: number) {
  return config.radius;
}
