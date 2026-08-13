import { DEFAULT_GAME_STYLE } from "./constants";
import type { GameStyle } from "./types";

const HEX = /^#[0-9a-fA-F]{6}$/;

export function safeColor(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback;
  const decoded = value.startsWith("%23") ? `#${value.slice(3)}` : value;
  return HEX.test(decoded) ? decoded.toUpperCase() : fallback;
}

export function gameStyleFromSearch(search: URLSearchParams): GameStyle {
  return {
    marble: safeColor(search.get("marble"), DEFAULT_GAME_STYLE.marble),
    marbleSecondary: safeColor(search.get("marble2"), DEFAULT_GAME_STYLE.marbleSecondary),
    walls: safeColor(search.get("walls"), DEFAULT_GAME_STYLE.walls),
    floor: safeColor(search.get("floor"), DEFAULT_GAME_STYLE.floor),
    accent: safeColor(search.get("accent"), DEFAULT_GAME_STYLE.accent),
  };
}

export function hexToRgb(hex: string): [number, number, number] {
  const v = Number.parseInt(hex.slice(1), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}
