import type { GameManifest, GameStyle, ReplayEnvelope } from "./types";

const textEncoder = new TextEncoder();

export function canonicalStyle(style: GameStyle) {
  return {
    marble: style.marble.toUpperCase(),
    marbleSecondary: style.marbleSecondary.toUpperCase(),
    walls: style.walls.toUpperCase(),
    floor: style.floor.toUpperCase(),
    accent: style.accent.toUpperCase(),
  };
}

/**
 * Explicit canonical payload for manifest hashing. Field order is intentionally frozen and
 * arrays preserve generator order. Do not silently add/remove fields without bumping the game
 * generator/manifest version.
 */
export function canonicalManifestPayload(manifest: GameManifest) {
  return {
    version: manifest.version,
    generatorVersion: manifest.generatorVersion,
    physicsVersion: manifest.physicsVersion,
    rapierVersion: manifest.rapierVersion,
    slug: manifest.slug,
    seed: manifest.seed,
    difficulty: manifest.difficulty,
    profile: {
      key: manifest.profile.key,
      targetMinutes: manifest.profile.targetMinutes,
      grid: manifest.profile.grid,
      targetPathCells: manifest.profile.targetPathCells,
      gateCount: manifest.profile.gateCount,
      bumperCount: manifest.profile.bumperCount,
      loopCount: manifest.profile.loopCount,
      checkpointCount: manifest.profile.checkpointCount,
      cellSize: manifest.profile.cellSize,
      maxTiltDeg: manifest.profile.maxTiltDeg,
    },
    style: canonicalStyle(manifest.style),
    rows: manifest.rows,
    cols: manifest.cols,
    cellSize: manifest.cellSize,
    width: manifest.width,
    depth: manifest.depth,
    cells: manifest.cells.map((cell) => [cell.x, cell.z, cell.openings]),
    path: manifest.path.map((point) => [point.x, point.z]),
    walls: manifest.walls.map((wall) => [wall.x, wall.z, wall.length, wall.axis]),
    gates: manifest.gates.map((gate) => [gate.id, gate.x, gate.z, gate.phase, gate.speed, gate.length]),
    bumpers: manifest.bumpers.map((bumper) => [bumper.id, bumper.x, bumper.z, bumper.radius]),
    checkpoints: manifest.checkpoints.map((checkpoint) => [checkpoint.index, checkpoint.x, checkpoint.z]),
    start: [manifest.start.x, manifest.start.z],
    goal: [manifest.goal.x, manifest.goal.z],
    manifestId: manifest.manifestId,
  };
}

export function canonicalReplayPayload(replay: ReplayEnvelope) {
  return {
    schemaVersion: replay.schemaVersion,
    replayId: replay.replayId,
    manifestId: replay.manifestId,
    generatorVersion: replay.generatorVersion,
    physicsVersion: replay.physicsVersion,
    rapierVersion: replay.rapierVersion,
    sampleHz: replay.sampleHz,
    driveProfile: replay.driveProfile,
    finishTick: replay.finishTick,
    elapsedMs: replay.elapsedMs,
    resets: replay.resets,
    checkpoints: replay.checkpoints,
    frames: replay.frames.map((frame) => [frame.tick, frame.x, frame.y]),
    events: replay.events.map((event) => [event.tick, event.type]),
  };
}

export async function sha256Hex(value: string): Promise<string> {
  // WebCrypto requires an ArrayBuffer-backed BufferSource. Newer TypeScript DOM
  // typings allow TextEncoder.encode() to be backed by ArrayBufferLike, which
  // includes SharedArrayBuffer and fails the stricter SubtleCrypto overload.
  // Copy into an explicit ArrayBuffer so this is type-safe in both browser and
  // Node/Vercel WebCrypto without relying on an unsafe cast.
  const encoded = textEncoder.encode(value);
  const input = new ArrayBuffer(encoded.byteLength);
  new Uint8Array(input).set(encoded);

  const digest = await crypto.subtle.digest("SHA-256", input);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hashCanonicalManifest(manifest: GameManifest): Promise<string> {
  return sha256Hex(JSON.stringify(canonicalManifestPayload(manifest)));
}

export async function hashCanonicalReplay(replay: ReplayEnvelope): Promise<string> {
  return sha256Hex(JSON.stringify(canonicalReplayPayload(replay)));
}

export type GameCommitmentInput = {
  orbId: string;
  secretSeedHex: string;
  settingsHash: string;
  generatorVersion: string;
};

/**
 * Commitment format reserved for funded Orbs. The secret seed remains server-side before
 * starts_at; only this hash is published. The real creation flow will persist the exact input
 * alongside the Orb record before Anchor funding is wired.
 */
export async function buildGameCommitment(input: GameCommitmentInput): Promise<string> {
  return sha256Hex([
    "ORBS_GAME_V1",
    input.orbId,
    input.settingsHash,
    input.secretSeedHex.toLowerCase(),
    input.generatorVersion,
  ].join("|"));
}
