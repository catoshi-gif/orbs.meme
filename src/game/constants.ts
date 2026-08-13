import type { DifficultyKey, DifficultyProfile, GameStyle } from "./types";

export const GAME_GENERATOR_VERSION = "glass-roller-gen-v2.2" as const;
export const GAME_PHYSICS_VERSION = "glass-roller-physics-v1-locked" as const;
export const RAPIER_VERSION = "0.20.0" as const;


export const DIFFICULTY_PROFILES: Record<DifficultyKey, DifficultyProfile> = {
  quick: {
    key: "quick",
    label: "Quick",
    subtitle: "Easy · ~5 min",
    targetMinutes: 5,
    grid: 17,
    targetPathCells: 128,
    gateCount: 4,
    bumperCount: 5,
    loopCount: 2,
    checkpointCount: 4,
    cellSize: 1.95,
    maxTiltDeg: 6,
  },
  classic: {
    key: "classic",
    label: "Classic",
    subtitle: "Medium · ~10 min",
    targetMinutes: 10,
    grid: 23,
    targetPathCells: 252,
    gateCount: 7,
    bumperCount: 8,
    loopCount: 5,
    checkpointCount: 6,
    cellSize: 1.78,
    maxTiltDeg: 6,
  },
  brutal: {
    key: "brutal",
    label: "Brutal",
    subtitle: "Hard · ~15 min",
    targetMinutes: 15,
    grid: 29,
    targetPathCells: 378,
    gateCount: 10,
    bumperCount: 12,
    loopCount: 8,
    checkpointCount: 8,
    cellSize: 1.62,
    maxTiltDeg: 6,
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
  wallThickness: 0.17,
  floorThickness: 0.18,
  linearDamping: 0.5,
  angularDamping: 0.18,

  // V0.2.2 steering deliberately favors precision over momentum. The rigid body still
  // owns collision/rolling, but input converges toward a bounded desired planar velocity.
  desktopMaxSpeed: 4.65,
  desktopResponse: 5.4,
  desktopReverseResponse: 10.5,
  desktopCoastResponse: 4.2,

  // Device tilt/touch uses the same steering model as desktop so mobile does not depend
  // on slowly accumulating gravity momentum. The board still tilts visually for feel.
  mobileMaxSpeed: 4.55,
  mobileResponse: 4.8,
  mobileReverseResponse: 8.6,
  mobileCoastResponse: 3.5,
  mobileVisualTiltDeg: 5.5,
  sensorFullScaleDeg: 19,
  sensorDeadzoneDeg: 1.6,

  friction: 0.44,
  restitution: 0.055,
  maxSpeed: 5.1,
  tiltSmoothSeconds: 0.105,
} as const;
