import { PHYSICS } from "./constants";
import type { DriveProfile, GateModule } from "./types";

export type PlanarVelocity = {
  x: number;
  z: number;
};

export function clampUnitInput(x: number, y: number): { x: number; y: number } {
  let nx = Math.max(-1, Math.min(1, x));
  let ny = Math.max(-1, Math.min(1, y));
  const magnitude = Math.hypot(nx, ny);
  if (magnitude > 1) {
    nx /= magnitude;
    ny /= magnitude;
  }
  return { x: nx, y: ny };
}

/**
 * Shared, version-locked steering model used by both the browser and server replay verifier.
 * Keep this function mathematically identical for the lifetime of GAME_PHYSICS_VERSION.
 */
export function nextPlanarVelocity(
  current: PlanarVelocity,
  inputX: number,
  inputY: number,
  profile: DriveProfile,
): PlanarVelocity {
  const input = clampUnitInput(inputX, inputY);
  const maxDriveSpeed = profile === "desktop" ? PHYSICS.desktopMaxSpeed : PHYSICS.mobileMaxSpeed;
  const desiredX = input.x * maxDriveSpeed;
  const desiredZ = -input.y * maxDriveSpeed;
  const desiredMagnitude = Math.hypot(desiredX, desiredZ);
  const planarBeforeStep = Math.hypot(current.x, current.z);
  const directionDot = current.x * desiredX + current.z * desiredZ;
  const reversing = desiredMagnitude > 0.05 && planarBeforeStep > 0.18 && directionDot < 0;
  const response = desiredMagnitude < 0.05
    ? (profile === "desktop" ? PHYSICS.desktopCoastResponse : PHYSICS.mobileCoastResponse)
    : reversing
      ? (profile === "desktop" ? PHYSICS.desktopReverseResponse : PHYSICS.mobileReverseResponse)
      : (profile === "desktop" ? PHYSICS.desktopResponse : PHYSICS.mobileResponse);
  const steeringBlend = 1 - Math.exp(-response * PHYSICS.fixedStep);

  return {
    x: current.x + (desiredX - current.x) * steeringBlend,
    z: current.z + (desiredZ - current.z) * steeringBlend,
  };
}

export function clampPlanarSpeed(velocity: PlanarVelocity, profile: DriveProfile): PlanarVelocity {
  const limit = profile === "desktop" ? PHYSICS.desktopMaxSpeed : PHYSICS.mobileMaxSpeed;
  const speed = Math.hypot(velocity.x, velocity.z);
  if (speed <= limit || speed <= 1e-9) return velocity;
  const factor = limit / speed;
  return { x: velocity.x * factor, z: velocity.z * factor };
}

export function gateRotation(gate: GateModule, simTimeSeconds: number) {
  const angle = gate.phase + simTimeSeconds * gate.speed;
  const half = angle / 2;
  return { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) };
}
