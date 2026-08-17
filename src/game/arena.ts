import type { GameStyle } from "./types";

export const ARENA_GAME_VERSION = "orb-arena-v10" as const;

export const ARENA_CLOAK_DURATION_MS = 12_000;
export const ARENA_BOMB_LIFETIME_MS = 20_000;
export const ARENA_BOMB_ARM_MS = 1_000;
export const ARENA_BOMB_DAMAGE = 75;
export const ARENA_BLASTER_VOLLEY_MS = 280;
export const ARENA_BLASTER_LIFE_MS = 1_800;

export type ArenaPace = "demo" | "production";
export type ArenaPowerKind = "superjump" | "blaster" | "superspeed" | "cloak" | "bomb";

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

/** Approximate radius of the circular coliseum floor. Physics stays fixed as geometry scales. */
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
  const maxSeconds = input.pace === "demo" ? 135 : 0;
  const radius = arenaRadiusForPlayers(playerCount);
  return {
    version: ARENA_GAME_VERSION,
    playerCount,
    radius,
    courseScale: radius / 32,
    maxSeconds,
    // Production has no competitive hard cap. These fixed thresholds only accelerate power respawns.
    suddenDeathAt: input.pace === "demo" ? maxSeconds * 0.72 : 7 * 60 + 12,
    overchargeAt: input.pace === "demo" ? maxSeconds * 0.88 : 8 * 60 + 48,
    jumpImpulse: 7.35,
    jumpCooldownMs: 720,
    impactDamageScale: 0.72,
    weaponLifetimeMs: 8000,
    ringRespawnMs: input.pace === "demo" ? 5200 : 8500,
    pedestalRespawnMs: input.pace === "demo" ? 7200 : 11500,
    recoveryAmount: 28,
    style: input.style,
    seed: input.seed,
  };
}

/** Arena radius is fixed for a given roster; retained for admin compatibility. */
export function arenaRadiusAt(config: ArenaConfig, _elapsedSeconds: number, _survivors: number) {
  return config.radius;
}
