import { PHYSICS, RAPIER_VERSION } from "./constants";
import { REPLAY_SAMPLE_HZ, REPLAY_SCHEMA_VERSION } from "./replay";
import { clampPlanarSpeed, gateRotation, nextPlanarVelocity } from "./simulation";
import type { GameManifest, ReplayEnvelope } from "./types";

const MAX_RUN_SECONDS = 45 * 60;
const MAX_TICKS = Math.ceil(MAX_RUN_SECONDS / PHYSICS.fixedStep);
const GOAL_RADIUS = 0.64;

export type ReplayVerification = {
  verified: boolean;
  reason?: string;
  finishTick?: number;
  verifiedElapsedMs?: number;
  checkpoints?: number;
  resets?: number;
};

let rapierPromise: Promise<any> | null = null;

async function getRapier() {
  if (!rapierPromise) {
    rapierPromise = import("@dimforge/rapier3d-compat").then(async (module) => {
      const api = module.default ?? module;
      await api.init();
      return api;
    });
  }
  return rapierPromise;
}

function validateReplayShape(manifest: GameManifest, replay: ReplayEnvelope): string | null {
  if (!replay || replay.schemaVersion !== REPLAY_SCHEMA_VERSION) return "unsupported replay schema";
  if (replay.manifestId !== manifest.manifestId) return "manifest mismatch";
  if (replay.generatorVersion !== manifest.generatorVersion) return "generator version mismatch";
  if (replay.physicsVersion !== manifest.physicsVersion) return "physics version mismatch";
  if (replay.rapierVersion !== RAPIER_VERSION || replay.rapierVersion !== manifest.rapierVersion) return "Rapier version mismatch";
  if (replay.sampleHz !== REPLAY_SAMPLE_HZ) return "sample rate mismatch";
  if (replay.driveProfile !== "desktop" && replay.driveProfile !== "mobile") return "invalid drive profile";
  if (!Number.isInteger(replay.finishTick) || replay.finishTick < 0 || replay.finishTick > MAX_TICKS) return "invalid finish tick";
  if (!Number.isFinite(replay.elapsedMs) || replay.elapsedMs < 0 || replay.elapsedMs > MAX_RUN_SECONDS * 1000 + 30_000) return "invalid elapsed time";
  if (!Number.isInteger(replay.resets) || replay.resets < 0 || replay.resets > 10_000) return "invalid reset count";
  if (!Number.isInteger(replay.checkpoints) || replay.checkpoints < 0 || replay.checkpoints > manifest.checkpoints.length) return "invalid checkpoint count";
  if (!Array.isArray(replay.frames) || replay.frames.length === 0) return "missing input frames";
  if (replay.frames.length > MAX_RUN_SECONDS * REPLAY_SAMPLE_HZ + 10) return "replay too large";
  if (!Array.isArray(replay.events) || replay.events.length > 10_000) return "invalid replay events";

  let previousTick = -1;
  let cadenceOffset: number | null = null;
  for (const frame of replay.frames) {
    if (!Number.isInteger(frame.tick) || frame.tick < 0 || frame.tick > replay.finishTick) return "invalid input tick";
    if (!Number.isInteger(frame.x) || !Number.isInteger(frame.y) || frame.x < -127 || frame.x > 127 || frame.y < -127 || frame.y > 127) return "invalid input value";
    if (frame.tick <= previousTick) return "input ticks must increase";
    if (cadenceOffset === null) cadenceOffset = frame.tick % 3;
    if (frame.tick % 3 !== cadenceOffset) return "invalid input cadence";
    if (previousTick >= 0 && frame.tick - previousTick !== 3) return "missing input sample";
    previousTick = frame.tick;
  }
  if (replay.frames[0]!.tick > 2) return "late first input sample";
  if (replay.finishTick - replay.frames[replay.frames.length - 1]!.tick > 3) return "replay ends before finish";

  previousTick = -1;
  for (const event of replay.events) {
    if (event.type !== "reset") return "unsupported replay event";
    if (!Number.isInteger(event.tick) || event.tick < 0 || event.tick > replay.finishTick) return "invalid event tick";
    if (event.tick < previousTick) return "event ticks must not go backwards";
    previousTick = event.tick;
  }
  if (replay.events.length !== replay.resets) return "reset count mismatch";
  return null;
}

export async function verifyReplay(manifest: GameManifest, replay: ReplayEnvelope): Promise<ReplayVerification> {
  const shapeError = validateReplayShape(manifest, replay);
  if (shapeError) return { verified: false, reason: shapeError };

  const RAPIER = await getRapier();
  const world = new RAPIER.World({ x: 0, y: -PHYSICS.gravity, z: 0 });
  world.timestep = PHYSICS.fixedStep;

  world.createCollider(
    RAPIER.ColliderDesc.cuboid(manifest.width / 2, PHYSICS.floorThickness / 2, manifest.depth / 2)
      .setTranslation(0, -PHYSICS.floorThickness / 2, 0)
      .setFriction(PHYSICS.friction)
      .setRestitution(0.02),
  );

  for (const wall of manifest.walls) {
    const hx = wall.axis === "x" ? wall.length / 2 : PHYSICS.wallThickness / 2;
    const hz = wall.axis === "z" ? wall.length / 2 : PHYSICS.wallThickness / 2;
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, PHYSICS.wallHeight / 2, hz)
        .setTranslation(wall.x, PHYSICS.wallHeight / 2, wall.z)
        .setFriction(0.3)
        .setRestitution(0.05),
    );
  }

  for (const bumper of manifest.bumpers) {
    world.createCollider(
      RAPIER.ColliderDesc.cylinder(0.28, bumper.radius)
        .setTranslation(bumper.x, 0.28, bumper.z)
        .setFriction(0.28)
        .setRestitution(0.16),
    );
  }

  const ballBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(manifest.start.x, PHYSICS.ballRadius + 0.06, manifest.start.z)
      .setLinearDamping(PHYSICS.linearDamping)
      .setAngularDamping(PHYSICS.angularDamping)
      .setCanSleep(false)
      .setCcdEnabled(true),
  );
  world.createCollider(
    RAPIER.ColliderDesc.ball(PHYSICS.ballRadius)
      .setDensity(1.15)
      .setFriction(PHYSICS.friction)
      .setRestitution(PHYSICS.restitution),
    ballBody,
  );

  const gateBodies = manifest.gates.map((gate) => {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(gate.x, 0.32, gate.z));
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(gate.length / 2, 0.23, 0.08)
        .setFriction(0.3)
        .setRestitution(0.04),
      body,
    );
    return body;
  });

  const framesByTick = new Map(replay.frames.map((frame) => [frame.tick, frame] as const));
  const resetTicks = new Set(replay.events.filter((event) => event.type === "reset").map((event) => event.tick));
  let sampledInputX = 0;
  let sampledInputY = 0;
  let simTime = 0;
  let nextCheckpoint = 0;
  let lastSafe = { ...manifest.start };
  let resetsApplied = 0;
  let actualFinishTick: number | null = null;

  const resetBall = () => {
    ballBody.setTranslation({ x: lastSafe.x, y: PHYSICS.ballRadius + 0.08, z: lastSafe.z }, true);
    ballBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    ballBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    resetsApplied += 1;
  };

  try {
    for (let tick = 0; tick <= replay.finishTick; tick += 1) {
      const frame = framesByTick.get(tick);
      if (frame) {
        sampledInputX = frame.x / 127;
        sampledInputY = frame.y / 127;
      }

      world.gravity.x = 0;
      world.gravity.y = -PHYSICS.gravity;
      world.gravity.z = 0;
      ballBody.setLinearDamping(PHYSICS.linearDamping);

      const before = ballBody.linvel();
      const steered = nextPlanarVelocity(
        { x: before.x, z: before.z },
        sampledInputX,
        sampledInputY,
        replay.driveProfile,
      );
      ballBody.setLinvel({ x: steered.x, y: before.y, z: steered.z }, true);

      manifest.gates.forEach((gate, index) => {
        gateBodies[index]!.setNextKinematicRotation(gateRotation(gate, simTime));
      });

      world.step();
      simTime += PHYSICS.fixedStep;

      const after = ballBody.linvel();
      const clamped = clampPlanarSpeed({ x: after.x, z: after.z }, replay.driveProfile);
      if (clamped.x !== after.x || clamped.z !== after.z) {
        ballBody.setLinvel({ x: clamped.x, y: after.y, z: clamped.z }, true);
      }

      const position = ballBody.translation();
      const fell = position.y < -2.2;
      const resetRequested = resetTicks.has(tick);
      if (fell && !resetRequested) {
        return { verified: false, reason: `missing fall reset at tick ${tick}` };
      }
      if (resetRequested) resetBall();

      const current = ballBody.translation();
      if (nextCheckpoint < manifest.checkpoints.length) {
        const checkpoint = manifest.checkpoints[nextCheckpoint]!;
        if (Math.hypot(current.x - checkpoint.x, current.z - checkpoint.z) < manifest.cellSize * 0.38) {
          lastSafe = { x: checkpoint.x, z: checkpoint.z };
          nextCheckpoint += 1;
        }
      }

      if (nextCheckpoint >= manifest.checkpoints.length && Math.hypot(current.x - manifest.goal.x, current.z - manifest.goal.z) < GOAL_RADIUS) {
        actualFinishTick = tick;
        break;
      }
    }
  } finally {
    world.free();
  }

  if (actualFinishTick === null) return { verified: false, reason: "replay did not reach the goal" };
  if (actualFinishTick !== replay.finishTick) return { verified: false, reason: `finish tick mismatch (${actualFinishTick} != ${replay.finishTick})` };
  if (nextCheckpoint !== manifest.checkpoints.length || replay.checkpoints !== manifest.checkpoints.length) return { verified: false, reason: "checkpoint chain incomplete" };
  if (resetsApplied !== replay.resets) return { verified: false, reason: "verified reset count mismatch" };

  return {
    verified: true,
    finishTick: actualFinishTick,
    verifiedElapsedMs: Math.round((actualFinishTick + 1) * PHYSICS.fixedStep * 1000),
    checkpoints: nextCheckpoint,
    resets: resetsApplied,
  };
}
