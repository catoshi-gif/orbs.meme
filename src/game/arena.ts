import type { GameStyle } from "./types";

export const ARENA_GAME_VERSION = "orb-arena-v1" as const;
export const ARENA_HARD_CAP_SECONDS = 10 * 60;

export type ArenaPace = "demo" | "production";

export type ArenaConfig = {
  version: typeof ARENA_GAME_VERSION;
  playerCount: number;
  radius: number;
  maxSeconds: number;
  shrinkStartsAt: number;
  suddenDeathAt: number;
  minimumRadius: number;
  bumpImpulse: number;
  bumpCooldownMs: number;
  voidPulseInterval: number;
  style: GameStyle;
  seed: string;
};

export function arenaRadiusForPlayers(playerCount: number) {
  const players = Math.max(2, Math.min(200, Math.floor(playerCount)));
  return Math.min(27, Math.max(8.5, 6.4 + Math.sqrt(players) * 1.38));
}

export function buildArenaConfig(input: {
  playerCount: number;
  pace: ArenaPace;
  style: GameStyle;
  seed: string;
}): ArenaConfig {
  const playerCount = Math.max(2, Math.min(200, Math.floor(input.playerCount)));
  const maxSeconds = input.pace === "demo" ? 105 : ARENA_HARD_CAP_SECONDS;
  return {
    version: ARENA_GAME_VERSION,
    playerCount,
    radius: arenaRadiusForPlayers(playerCount),
    maxSeconds,
    shrinkStartsAt: maxSeconds * 0.18,
    suddenDeathAt: maxSeconds * 0.68,
    minimumRadius: 2.35,
    bumpImpulse: 3.25,
    bumpCooldownMs: 1450,
    voidPulseInterval: input.pace === "demo" ? 7 : 18,
    style: input.style,
    seed: input.seed,
  };
}

export function arenaRadiusAt(config: ArenaConfig, elapsedSeconds: number, survivors: number) {
  if (elapsedSeconds <= config.shrinkStartsAt) return config.radius;
  const survivorPressure = Math.max(0, 1 - survivors / Math.max(2, config.playerCount));
  const timeProgress = Math.max(0, Math.min(1, (elapsedSeconds - config.shrinkStartsAt) / Math.max(1, config.maxSeconds - config.shrinkStartsAt)));
  const eased = 1 - Math.pow(1 - timeProgress, 1.55);
  const pressure = Math.min(1, eased * 0.84 + survivorPressure * 0.16);
  return config.radius + (config.minimumRadius - config.radius) * pressure;
}
