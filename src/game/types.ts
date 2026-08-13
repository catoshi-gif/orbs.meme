export type DifficultyKey = "quick" | "classic" | "brutal";

export type GameStyle = {
  marble: string;
  marbleSecondary: string;
  walls: string;
  floor: string;
  accent: string;
};

export type Cell = {
  x: number;
  z: number;
  openings: number;
};

export type WallSegment = {
  x: number;
  z: number;
  length: number;
  axis: "x" | "z";
};

export type Point2 = { x: number; z: number };

export type BumperModule = Point2 & {
  id: string;
  radius: number;
};

export type GateModule = Point2 & {
  id: string;
  phase: number;
  speed: number;
  length: number;
};

export type Checkpoint = Point2 & {
  index: number;
};

export type DifficultyProfile = {
  key: DifficultyKey;
  label: string;
  subtitle: string;
  targetMinutes: number;
  grid: number;
  targetPathCells: number;
  gateCount: number;
  bumperCount: number;
  loopCount: number;
  checkpointCount: number;
  cellSize: number;
  maxTiltDeg: number;
};

export type ReplayFrame = { tick: number; x: number; y: number };
export type ReplayEvent = { tick: number; type: "reset" };

export type ReplayEnvelope = {
  schemaVersion: 1;
  replayId: string;
  manifestId: string;
  generatorVersion: string;
  physicsVersion: string;
  rapierVersion: string;
  sampleHz: 20;
  elapsedMs: number;
  resets: number;
  checkpoints: number;
  frames: ReplayFrame[];
  events: ReplayEvent[];
};

export type GameManifest = {
  version: "glass-roller-local-v3";
  generatorVersion: string;
  physicsVersion: string;
  rapierVersion: string;
  slug: string;
  seed: number;
  difficulty: DifficultyKey;
  profile: DifficultyProfile;
  style: GameStyle;
  rows: number;
  cols: number;
  cellSize: number;
  width: number;
  depth: number;
  cells: Cell[];
  path: Point2[];
  walls: WallSegment[];
  gates: GateModule[];
  bumpers: BumperModule[];
  checkpoints: Checkpoint[];
  start: Point2;
  goal: Point2;
  manifestId: string;
};
