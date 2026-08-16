import type { GameStyle } from "./types";

export const ARENA_GAME_VERSION = "orb-arena-coliseum-v5" as const;
export const ARENA_HARD_CAP_SECONDS = 10 * 60;

export type ArenaPace = "demo" | "production";
export type ArenaPowerKind = "kinetic" | "slam" | "shield" | "superjump" | "blaster" | "explosion";

export type ArenaConfig = {
  version: typeof ARENA_GAME_VERSION;
  playerCount: number;
  radius: number;
  courseScale: number;
  maxSeconds: number;
  suddenDeathAt: number;
  overchargeAt: number;
  jumpImpulse: number;
  jumpCooldownMs: number;
  impactDamageScale: number;
  weaponLifetimeMs: number;
  ringRespawnMs: number;
  pedestalRespawnMs: number;
  recoveryAmount: number;
  style: GameStyle;
  seed: string;
};

/** Approximate half-footprint of the continuous coliseum. Physics stays fixed as geometry scales. */
export function arenaRadiusForPlayers(playerCount: number) {
  const players = Math.max(2, Math.min(200, Math.floor(playerCount)));
  return Math.min(74, Math.max(30, 25 + Math.sqrt(players) * 2.35));
}

export function buildArenaConfig(input: {
  playerCount: number;
  pace: ArenaPace;
  style: GameStyle;
  seed: string;
}): ArenaConfig {
  const playerCount = Math.max(2, Math.min(200, Math.floor(input.playerCount)));
  const maxSeconds = input.pace === "demo" ? 135 : ARENA_HARD_CAP_SECONDS;
  const radius = arenaRadiusForPlayers(playerCount);
  return {
    version: ARENA_GAME_VERSION,
    playerCount,
    radius,
    courseScale: radius / 32,
    maxSeconds,
    suddenDeathAt: maxSeconds * 0.72,
    overchargeAt: maxSeconds * 0.88,
    jumpImpulse: 7.35,
    jumpCooldownMs: 720,
    impactDamageScale: 0.72,
    weaponLifetimeMs: 5000,
    ringRespawnMs: input.pace === "demo" ? 5200 : 8500,
    pedestalRespawnMs: input.pace === "demo" ? 7200 : 11500,
    recoveryAmount: 28,
    style: input.style,
    seed: input.seed,
  };
}

/** Arena V5 is physically contained; this is retained for admin compatibility only. */
export function arenaRadiusAt(config: ArenaConfig, _elapsedSeconds: number, _survivors: number) {
  return config.radius;
}
