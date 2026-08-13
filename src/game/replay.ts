import { hashString } from "./prng";
import type { GameManifest, ReplayEnvelope, ReplayEvent, ReplayFrame } from "./types";

export const REPLAY_SCHEMA_VERSION = 1 as const;
export const REPLAY_SAMPLE_HZ = 20 as const;

/**
 * Local deterministic replay envelope. This is scaffolding for V0.3 verification.
 * `replayId` is an inexpensive local fingerprint, NOT a security proof; the server-side
 * competition layer will SHA-256 the canonical payload and sign/session-bind it.
 */
export function buildReplayEnvelope(
  manifest: GameManifest,
  frames: ReplayFrame[],
  events: ReplayEvent[],
  elapsedMs: number,
  resets: number,
  checkpoints: number,
): ReplayEnvelope {
  const canonicalFrames = frames.map((frame) => `${frame.tick}:${frame.x}:${frame.y}`).join("|");
  const canonicalEvents = events.map((event) => `${event.tick}:${event.type}`).join("|");
  const replayId = hashString([
    REPLAY_SCHEMA_VERSION,
    manifest.manifestId,
    manifest.physicsVersion,
    manifest.rapierVersion,
    Math.round(elapsedMs),
    resets,
    checkpoints,
    canonicalFrames,
    canonicalEvents,
  ].join("::")).toString(16).padStart(8, "0").toUpperCase();

  return {
    schemaVersion: REPLAY_SCHEMA_VERSION,
    replayId,
    manifestId: manifest.manifestId,
    generatorVersion: manifest.generatorVersion,
    physicsVersion: manifest.physicsVersion,
    rapierVersion: manifest.rapierVersion,
    sampleHz: REPLAY_SAMPLE_HZ,
    elapsedMs: Math.max(0, Math.round(elapsedMs)),
    resets,
    checkpoints,
    frames: frames.map((frame) => ({ ...frame })),
    events: events.map((event) => ({ ...event })),
  };
}
