export type OrbGameType = "maze" | "arena";

/**
 * Legacy Orb records predate gameType and are intentionally MAZE.
 * This helper is dependency-free so it is safe in both client and server code.
 */
export function orbGameType(orb: { gameType?: OrbGameType | null }): OrbGameType {
  return orb.gameType === "arena" ? "arena" : "maze";
}
