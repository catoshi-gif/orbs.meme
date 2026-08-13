import type { DifficultyKey, DifficultyProfile, GameStyle } from "./types";

export const DIFFICULTY_PROFILES: Record<DifficultyKey, DifficultyProfile> = {
  quick: {
    key: "quick",
    label: "Quick",
    subtitle: "Easy · ~5 min",
    targetMinutes: 5,
    grid: 11,
    targetPathCells: 58,
    gateCount: 2,
    bumperCount: 2,
    loopCount: 1,
    checkpointCount: 3,
    cellSize: 2.35,
    maxTiltDeg: 12,
  },
  classic: {
    key: "classic",
    label: "Classic",
    subtitle: "Medium · ~10 min",
    targetMinutes: 10,
    grid: 15,
    targetPathCells: 112,
    gateCount: 4,
    bumperCount: 4,
    loopCount: 3,
    checkpointCount: 4,
    cellSize: 2.2,
    maxTiltDeg: 12,
  },
  brutal: {
    key: "brutal",
    label: "Brutal",
    subtitle: "Hard · ~15 min",
    targetMinutes: 15,
    grid: 19,
    targetPathCells: 178,
    gateCount: 6,
    bumperCount: 6,
    loopCount: 5,
    checkpointCount: 5,
    cellSize: 2.08,
    maxTiltDeg: 12,
  },
};

export const DEFAULT_GAME_STYLE: GameStyle = {
  marble: "#5B5CF6",
  marbleSecondary: "#20E3D2",
  walls: "#20E3D2",
  floor: "#0B1020",
  accent: "#9A5CFF",
};

export const BONK_GAME_STYLE: GameStyle = {
  marble: "#4A77FF",
  marbleSecondary: "#20E3D2",
  walls: "#63F38B",
  floor: "#130D0B",
  accent: "#FF8B36",
};

export const GAME_STYLE_PRESETS: ReadonlyArray<{ name: string; style: GameStyle }> = [
  { name: "Orbs", style: DEFAULT_GAME_STYLE },
  { name: "BONK", style: BONK_GAME_STYLE },
  {
    name: "Aurora",
    style: { marble: "#20E3D2", marbleSecondary: "#7EF5FF", walls: "#9A5CFF", floor: "#071126", accent: "#41B7FF" },
  },
  {
    name: "Solar",
    style: { marble: "#FF8B36", marbleSecondary: "#FFE66D", walls: "#FF4FC8", floor: "#160918", accent: "#20E3D2" },
  },
  {
    name: "Obsidian",
    style: { marble: "#7857FF", marbleSecondary: "#D7D1FF", walls: "#6DE5FF", floor: "#030511", accent: "#A975FF" },
  },
];

export const PHYSICS = {
  fixedStep: 1 / 60,
  gravity: 9.81,
  ballRadius: 0.42,
  wallHeight: 0.82,
  wallThickness: 0.16,
  floorThickness: 0.18,
  linearDamping: 0.13,
  angularDamping: 0.12,
  desktopLinearDamping: 0.42,
  desktopDriveForce: 0.95,
  desktopMaxSpeed: 6.4,
  friction: 0.42,
  restitution: 0.08,
  maxSpeed: 8.5,
  tiltSmoothSeconds: 0.115,
} as const;
