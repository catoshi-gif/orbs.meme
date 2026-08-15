import { DIFFICULTY_PROFILES, GAME_GENERATOR_VERSION, GAME_PHYSICS_VERSION, RAPIER_VERSION } from "./constants";
import { hashString, mulberry32, shuffle } from "./prng";
import type { BumperModule, Cell, Checkpoint, DifficultyKey, GameManifest, GameStyle, GateModule, Point2, WallSegment } from "./types";

const N = 1;
const E = 2;
const S = 4;
const W = 8;
const DIRS = [
  { bit: N, opposite: S, dx: 0, dz: -1 },
  { bit: E, opposite: W, dx: 1, dz: 0 },
  { bit: S, opposite: N, dx: 0, dz: 1 },
  { bit: W, opposite: E, dx: -1, dz: 0 },
] as const;

type LogicalMaze = {
  grid: number;
  cells: Cell[];
  startIndex: number;
  goalIndex: number;
  pathIndices: number[];
};

const indexFor = (x: number, z: number, grid: number) => z * grid + x;

function carve(seed: number, grid: number): Cell[] {
  const rng = mulberry32(seed);
  const cells: Cell[] = Array.from({ length: grid * grid }, (_, i) => ({
    x: i % grid,
    z: Math.floor(i / grid),
    openings: 0,
  }));
  const visited = new Uint8Array(cells.length);
  const stack = [indexFor(0, 0, grid)];
  visited[stack[0]!] = 1;

  while (stack.length) {
    const currentIndex = stack[stack.length - 1]!;
    const current = cells[currentIndex]!;
    const options = shuffle(rng, DIRS).filter((dir) => {
      const nx = current.x + dir.dx;
      const nz = current.z + dir.dz;
      return nx >= 0 && nx < grid && nz >= 0 && nz < grid && !visited[indexFor(nx, nz, grid)];
    });
    const dir = options[0];
    if (!dir) {
      stack.pop();
      continue;
    }
    const nx = current.x + dir.dx;
    const nz = current.z + dir.dz;
    const nextIndex = indexFor(nx, nz, grid);
    current.openings |= dir.bit;
    cells[nextIndex]!.openings |= dir.opposite;
    visited[nextIndex] = 1;
    stack.push(nextIndex);
  }
  return cells;
}

function bfs(cells: Cell[], grid: number, start: number) {
  const distance = new Int32Array(cells.length);
  distance.fill(-1);
  const parent = new Int32Array(cells.length);
  parent.fill(-1);
  const queue = new Int32Array(cells.length);
  let head = 0;
  let tail = 0;
  queue[tail++] = start;
  distance[start] = 0;
  let farthest = start;

  while (head < tail) {
    const idx = queue[head++]!;
    const cell = cells[idx]!;
    if (distance[idx]! > distance[farthest]!) farthest = idx;
    for (const dir of DIRS) {
      if ((cell.openings & dir.bit) === 0) continue;
      const nx = cell.x + dir.dx;
      const nz = cell.z + dir.dz;
      const ni = indexFor(nx, nz, grid);
      if (distance[ni] !== -1) continue;
      distance[ni] = distance[idx]! + 1;
      parent[ni] = idx;
      queue[tail++] = ni;
    }
  }
  return { distance, parent, farthest };
}

function findDiameter(cells: Cell[], grid: number) {
  const a = bfs(cells, grid, 0).farthest;
  const fromA = bfs(cells, grid, a);
  const b = fromA.farthest;
  const path: number[] = [];
  let cursor = b;
  while (cursor !== -1) {
    path.push(cursor);
    if (cursor === a) break;
    cursor = fromA.parent[cursor]!;
  }
  path.reverse();
  return { a, b, path };
}


function addControlledLoops(cells: Cell[], grid: number, seed: number, loopCount: number, targetPath: number) {
  if (loopCount <= 0) return;
  const rng = mulberry32(hashString(`${seed}:loops`));
  const candidates: { idx: number; dir: (typeof DIRS)[number] }[] = [];
  for (let idx = 0; idx < cells.length; idx += 1) {
    const cell = cells[idx]!;
    for (const dir of [DIRS[1], DIRS[2]]) {
      const nx = cell.x + dir.dx;
      const nz = cell.z + dir.dz;
      if (nx < 0 || nx >= grid || nz < 0 || nz >= grid) continue;
      if ((cell.openings & dir.bit) === 0) candidates.push({ idx, dir });
    }
  }
  let added = 0;
  for (const candidate of shuffle(rng, candidates)) {
    if (added >= loopCount) break;
    const cell = cells[candidate.idx]!;
    const ni = indexFor(cell.x + candidate.dir.dx, cell.z + candidate.dir.dz, grid);
    cell.openings |= candidate.dir.bit;
    cells[ni]!.openings |= candidate.dir.opposite;
    const diameter = findDiameter(cells, grid);
    if (diameter.path.length < targetPath * 0.82) {
      cell.openings &= ~candidate.dir.bit;
      cells[ni]!.openings &= ~candidate.dir.opposite;
      continue;
    }
    added += 1;
  }
}

function mazeMetrics(cells: Cell[], grid: number, path: number[]) {
  const pathSet = new Set(path);
  let deadEnds = 0;
  let junctions = 0;
  let pathDecisions = 0;
  let sideBranchEntrances = 0;
  for (let idx = 0; idx < cells.length; idx += 1) {
    const cell = cells[idx]!;
    let degree = 0;
    let offPathNeighbors = 0;
    for (const dir of DIRS) {
      if ((cell.openings & dir.bit) === 0) continue;
      degree += 1;
      if (pathSet.has(idx)) {
        const nx = cell.x + dir.dx;
        const nz = cell.z + dir.dz;
        const ni = indexFor(nx, nz, grid);
        if (!pathSet.has(ni)) offPathNeighbors += 1;
      }
    }
    if (degree === 1) deadEnds += 1;
    if (degree >= 3) junctions += 1;
    if (pathSet.has(idx) && degree >= 3) pathDecisions += 1;
    sideBranchEntrances += offPathNeighbors;
  }

  let turns = 0;
  let longestStraight = 1;
  let currentStraight = 1;
  let previousDx = 0;
  let previousDz = 0;
  for (let i = 1; i < path.length; i += 1) {
    const a = cells[path[i - 1]!]!;
    const b = cells[path[i]!]!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    if (i > 1 && (dx !== previousDx || dz !== previousDz)) {
      turns += 1;
      currentStraight = 1;
    } else {
      currentStraight += 1;
      longestStraight = Math.max(longestStraight, currentStraight);
    }
    previousDx = dx;
    previousDz = dz;
  }

  const pathEdges = Math.max(1, path.length - 1);
  return {
    deadEnds,
    junctions,
    pathDecisions,
    sideBranchEntrances,
    decisionRatio: pathDecisions / Math.max(1, path.length),
    branchRatio: sideBranchEntrances / Math.max(1, path.length),
    turnRatio: turns / pathEdges,
    longestStraight,
  };
}

function selectCandidate(baseSeed: number, difficulty: DifficultyKey): LogicalMaze {
  const profile = DIFFICULTY_PROFILES[difficulty];
  let best: LogicalMaze | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  const tries = difficulty === "quick" ? 38 : difficulty === "classic" ? 46 : 54;

  // The target route length establishes the broad 5/10/15 minute bands. These shape
  // targets stop the generator from satisfying that number with a boring snake: harder
  // boards deliberately contain more turns, route-adjacent false branches and decisions.
  const desiredTurns = difficulty === "quick" ? 0.43 : difficulty === "classic" ? 0.47 : 0.50;
  const desiredDecisionRatio = difficulty === "quick" ? 0.12 : difficulty === "classic" ? 0.16 : 0.20;
  const desiredBranchRatio = difficulty === "quick" ? 0.16 : difficulty === "classic" ? 0.21 : 0.25;
  const maxComfortStraight = difficulty === "quick" ? 9 : difficulty === "classic" ? 8 : 7;

  for (let i = 0; i < tries; i += 1) {
    const seed = hashString(`${baseSeed}:${difficulty}:candidate:${i}`);
    const cells = carve(seed, profile.grid);
    addControlledLoops(cells, profile.grid, seed, profile.loopCount, profile.targetPathCells);
    const { a, b, path } = findDiameter(cells, profile.grid);
    const metrics = mazeMetrics(cells, profile.grid, path);

    const targetError = Math.abs(path.length - profile.targetPathCells) * 1.18;
    const turnPenalty = Math.abs(metrics.turnRatio - desiredTurns) * 34;
    const decisionPenalty = Math.abs(metrics.decisionRatio - desiredDecisionRatio) * 70;
    const branchPenalty = Math.abs(metrics.branchRatio - desiredBranchRatio) * 42;
    const straightPenalty = Math.max(0, metrics.longestStraight - maxComfortStraight) * 1.45;
    const desiredDeadEnds = profile.grid * (difficulty === "quick" ? 1.2 : difficulty === "classic" ? 1.38 : 1.52);
    const deadEndPenalty = Math.abs(metrics.deadEnds - desiredDeadEnds) * 0.11;
    const junctionReward = Math.min(metrics.junctions, Math.ceil(profile.grid * 1.2)) * -0.08;
    const edgePenalty = Math.min(
      cells[a]!.x,
      cells[a]!.z,
      profile.grid - 1 - cells[a]!.x,
      profile.grid - 1 - cells[a]!.z,
    ) * 0.24;

    const score = targetError + turnPenalty + decisionPenalty + branchPenalty + straightPenalty + deadEndPenalty + junctionReward + edgePenalty;
    if (score < bestScore) {
      bestScore = score;
      best = { grid: profile.grid, cells, startIndex: a, goalIndex: b, pathIndices: path };
    }
  }
  if (!best) throw new Error("Maze generator failed to produce a candidate");
  return best;
}

function worldPoint(cell: Cell, grid: number, cellSize: number): Point2 {
  const half = (grid * cellSize) / 2;
  return {
    x: -half + cellSize * (cell.x + 0.5),
    z: -half + cellSize * (cell.z + 0.5),
  };
}

type RawWall = WallSegment & { key: string };

function buildWalls(cells: Cell[], grid: number, cellSize: number): WallSegment[] {
  const raw: RawWall[] = [];
  const half = (grid * cellSize) / 2;
  const add = (axis: "x" | "z", x: number, z: number) => raw.push({ axis, x, z, length: cellSize, key: `${axis}:${x.toFixed(4)}:${z.toFixed(4)}` });

  for (const cell of cells) {
    const cx = -half + cellSize * (cell.x + 0.5);
    const cz = -half + cellSize * (cell.z + 0.5);
    if ((cell.openings & N) === 0) add("x", cx, cz - cellSize / 2);
    if ((cell.openings & W) === 0) add("z", cx - cellSize / 2, cz);
    if (cell.x === grid - 1 && (cell.openings & E) === 0) add("z", cx + cellSize / 2, cz);
    if (cell.z === grid - 1 && (cell.openings & S) === 0) add("x", cx, cz + cellSize / 2);
  }

  // Merge collinear unit walls. This cuts hundreds of render instances/colliders into long rails.
  const horizontal = raw.filter((w) => w.axis === "x").sort((a, b) => a.z - b.z || a.x - b.x);
  const vertical = raw.filter((w) => w.axis === "z").sort((a, b) => a.x - b.x || a.z - b.z);

  const merge = (items: RawWall[], axis: "x" | "z") => {
    const out: WallSegment[] = [];
    for (const item of items) {
      const last = out[out.length - 1];
      if (!last || last.axis !== axis) {
        out.push({ axis, x: item.x, z: item.z, length: item.length });
        continue;
      }
      const sameLane = axis === "x" ? Math.abs(last.z - item.z) < 1e-5 : Math.abs(last.x - item.x) < 1e-5;
      const lastEnd = axis === "x" ? last.x + last.length / 2 : last.z + last.length / 2;
      const itemStart = axis === "x" ? item.x - item.length / 2 : item.z - item.length / 2;
      if (sameLane && Math.abs(lastEnd - itemStart) < 1e-4) {
        const newLength = last.length + item.length;
        if (axis === "x") last.x = last.x - last.length / 2 + newLength / 2;
        else last.z = last.z - last.length / 2 + newLength / 2;
        last.length = newLength;
      } else {
        out.push({ axis, x: item.x, z: item.z, length: item.length });
      }
    }
    return out;
  };

  return [...merge(horizontal, "x"), ...merge(vertical, "z")];
}

function pickCheckpoints(path: Point2[], count: number): Checkpoint[] {
  const out: Checkpoint[] = [];
  for (let i = 1; i <= count; i += 1) {
    const t = i / (count + 1);
    const idx = Math.min(path.length - 2, Math.max(1, Math.round(t * (path.length - 1))));
    const p = path[idx]!;
    out.push({ ...p, index: i });
  }
  return out;
}

function pickGates(pathCells: Cell[], path: Point2[], checkpoints: Checkpoint[], count: number, cellSize: number, seed: number): GateModule[] {
  const rng = mulberry32(hashString(`${seed}:gates`));
  const checkpointPoints = new Set(checkpoints.map((cp) => `${cp.x.toFixed(3)}:${cp.z.toFixed(3)}`));
  const straight: number[] = [];
  for (let i = 2; i < pathCells.length - 2; i += 1) {
    if (checkpointPoints.has(`${path[i]!.x.toFixed(3)}:${path[i]!.z.toFixed(3)}`)) continue;
    const a = pathCells[i - 1]!;
    const b = pathCells[i]!;
    const c = pathCells[i + 1]!;
    const straightX = a.x === b.x && b.x === c.x;
    const straightZ = a.z === b.z && b.z === c.z;
    if (straightX || straightZ) straight.push(i);
  }
  const candidates = shuffle(rng, straight);
  const selected: number[] = [];
  for (const idx of candidates) {
    if (selected.every((other) => Math.abs(other - idx) > Math.max(5, Math.floor(path.length / (count * 2.4))))) {
      selected.push(idx);
      if (selected.length >= count) break;
    }
  }
  selected.sort((a, b) => a - b);
  return selected.map((idx, i) => ({
    ...path[idx]!,
    id: `gate-${i + 1}`,
    phase: rng() * Math.PI * 2,
    speed: 0.72 + rng() * 0.62,
    length: cellSize * 0.62,
  }));
}

function pickBumpers(pathCells: Cell[], path: Point2[], gates: GateModule[], checkpoints: Checkpoint[], count: number, cellSize: number, seed: number, generatorVersion: string): BumperModule[] {
  const rng = mulberry32(hashString(`${seed}:bumpers`));
  const gatePoints = new Set(gates.map((g) => `${g.x.toFixed(3)}:${g.z.toFixed(3)}`));
  const checkpointPoints = new Set(checkpoints.map((cp) => `${cp.x.toFixed(3)}:${cp.z.toFixed(3)}`));
  const candidates: number[] = [];
  for (let i = 3; i < pathCells.length - 3; i += 1) {
    const p = path[i]!;
    const pointKey = `${p.x.toFixed(3)}:${p.z.toFixed(3)}`;
    if (gatePoints.has(pointKey) || checkpointPoints.has(pointKey)) continue;
    const prev = pathCells[i - 1]!;
    const here = pathCells[i]!;
    const next = pathCells[i + 1]!;
    const straightX = prev.x === here.x && here.x === next.x;
    const straightZ = prev.z === here.z && here.z === next.z;
    if (!straightX && !straightZ) continue;
    candidates.push(i);
  }
  const selected: number[] = [];
  for (const idx of shuffle(rng, candidates)) {
    if (selected.every((other) => Math.abs(other - idx) > Math.max(4, Math.floor(path.length / (count * 2.8))))) {
      selected.push(idx);
      if (selected.length >= count) break;
    }
  }
  selected.sort((a,b) => a-b);
  return selected.map((idx, i) => {
    const prev = pathCells[idx - 1]!;
    const next = pathCells[idx + 1]!;
    const horizontal = prev.z === next.z;
    const sign = rng() > 0.5 ? 1 : -1;
    // v2.2 used 0.17 / 0.115. On Brutal's 1.62-cell corridor that leaves
    // less physical clearance than the 0.42-radius marble requires, so a
    // route bumper can mathematically seal the canonical path. v2.3 moves
    // route bumpers slightly toward one rail and trims their radius while
    // preserving the obstacle feel. Keep v2.2 exact for already-funded
    // committed Orbs whose generator version is frozen on creation.
    const legacy = generatorVersion === "glass-roller-gen-v2.2";
    const offset = cellSize * (legacy ? 0.17 : 0.20) * sign;
    return {
      id: `bumper-${i + 1}`,
      x: path[idx]!.x + (horizontal ? 0 : offset),
      z: path[idx]!.z + (horizontal ? offset : 0),
      radius: cellSize * (legacy ? 0.115 : 0.10),
    };
  });
}

function localManifestId(parts: string): string {
  return hashString(parts).toString(16).padStart(8, "0").toUpperCase();
}

export function normalizeDifficulty(value?: string | null): DifficultyKey {
  const v = (value ?? "classic").toLowerCase();
  if (v === "quick" || v === "easy") return "quick";
  if (v === "brutal" || v === "hard" || v === "epic") return "brutal";
  return "classic";
}

function generateManifestWithBaseSeed(slug: string, difficulty: DifficultyKey, style: GameStyle, baseSeed: number, generatorVersion: string = GAME_GENERATOR_VERSION): GameManifest {
  const profile = DIFFICULTY_PROFILES[difficulty];
  const logical = selectCandidate(baseSeed, difficulty);
  const path = logical.pathIndices.map((idx) => worldPoint(logical.cells[idx]!, logical.grid, profile.cellSize));
  const pathCells = logical.pathIndices.map((idx) => logical.cells[idx]!);
  const start = path[0]!;
  const goal = path[path.length - 1]!;
  const walls = buildWalls(logical.cells, logical.grid, profile.cellSize);
  const checkpoints = pickCheckpoints(path, profile.checkpointCount);
  const gates = pickGates(pathCells, path, checkpoints, profile.gateCount, profile.cellSize, baseSeed);
  const bumpers = pickBumpers(pathCells, path, gates, checkpoints, profile.bumperCount, profile.cellSize, baseSeed, generatorVersion);
  const fingerprint = `${generatorVersion}|${GAME_PHYSICS_VERSION}|${RAPIER_VERSION}|${slug}|${difficulty}|${baseSeed}|${path.length}|${walls.length}|${bumpers.length}|${gates.map((g) => `${g.x},${g.z},${g.phase.toFixed(4)}`).join(";")}|${style.marble}|${style.marbleSecondary}|${style.walls}|${style.floor}|${style.accent}`;

  return {
    version: "glass-roller-local-v3",
    generatorVersion,
    physicsVersion: GAME_PHYSICS_VERSION,
    rapierVersion: RAPIER_VERSION,
    slug,
    seed: baseSeed,
    difficulty,
    profile,
    style,
    rows: logical.grid,
    cols: logical.grid,
    cellSize: profile.cellSize,
    width: logical.grid * profile.cellSize,
    depth: logical.grid * profile.cellSize,
    cells: logical.cells,
    path,
    walls,
    gates,
    bumpers,
    checkpoints,
    start,
    goal,
    manifestId: localManifestId(fingerprint),
  };
}

/** Current public/demo generator. The seed is derivable from the URL and is therefore not secret. */
export function generateGameManifest(slug: string, difficulty: DifficultyKey, style: GameStyle): GameManifest {
  const baseSeed = hashString(`orbs-glass-roller:${slug}:${difficulty}:v2`);
  return generateManifestWithBaseSeed(slug, difficulty, style, baseSeed);
}

/**
 * Funded-Orb JIT entry point. The secret seed source is persisted encrypted server-side before
 * starts_at and never sent to the countdown client. This preserves the already-calibrated maze
 * algorithm while allowing the future canonical manifest service to reveal one deterministic
 * board only when the Orb goes live.
 */
export function generateGameManifestFromSecret(
  slug: string,
  difficulty: DifficultyKey,
  style: GameStyle,
  secretSeedHex: string,
  generatorVersion: string = GAME_GENERATOR_VERSION,
): GameManifest {
  if (!/^[0-9a-fA-F]{64}$/.test(secretSeedHex)) throw new Error("secretSeedHex must be 32 bytes encoded as hex");
  const baseSeed = hashString(`orbs-glass-roller:${slug}:${difficulty}:secret:${secretSeedHex.toLowerCase()}:v2`);
  return generateManifestWithBaseSeed(slug, difficulty, style, baseSeed, generatorVersion);
}

