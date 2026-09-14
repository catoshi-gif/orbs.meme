# Orbs Glass Roller V0.2

> **Historical engineering milestone.** This document describes an earlier implementation stage and is retained to show project evolution. It is **not** the current production boundary. See [`../README.md`](../README.md), [`ARCHITECTURE.md`](ARCHITECTURE.md), and [`V1_SPEC.md`](V1_SPEC.md) for the current repository state.


This repository now contains the first real deterministic Glass Roller vertical slice described by the V1 game build plan.

## Implemented now

- Three.js 0.185.1 rendering loaded only by the live `/orb/[slug]/play` route.
- Rapier 3D compat 0.20.0 deterministic WASM physics.
- Fixed 60 Hz physics step; rendering runs independently.
- Steering is direct and deterministic: keyboard or joystick input converges the marble toward a bounded planar velocity while Rapier owns rolling, collisions, and obstacle impulses.
- Arrow keys and WASD on desktop.
- Mobile uses the always-on onscreen joystick as its only movement control.
- Seeded deterministic maze generator with three initial solve-time profiles.
- Candidate-search difficulty shaping around target main-path lengths.
- Long collinear maze walls merged before rendering and physics creation.
- Instanced wall rendering: the maze remains cheap even on Brutal.
- Deterministic rotating gate modules.
- Ordered checkpoints and recovery to the latest checkpoint.
- Follow-camera designed to reveal only a few junctions at a time.
- Custom host palette for marble core/glow, glass rails, floor/world and goal/accent.
- Orbs/BONK/Aurora/Solar visual presets.
- Procedural sky, stars and low-poly horizon; no large gameplay textures.
- Premium procedural marble shader without texture downloads or real-time refraction.
- No post-processing stack, dynamic shadows, frame streaming, Redis or Vercel gameplay traffic.

## Initial difficulty targets

| Mode | Product label | Grid | Target main path | Skill modules | Checkpoints | Intended median |
|---|---|---:|---:|---:|---:|---:|
| Quick | Easy | 11×11 | ~58 cells | 2 gates + 2 bumpers | 3 | ~2 min |
| Classic | Medium | 15×15 | ~112 cells | 4 gates + 4 bumpers | 4 | ~4 min |
| Brutal | Hard | 19×19 | ~178 cells | 6 gates + 6 bumpers | 5 | ~6 min |

The 5 / 10 / 15 minute values are calibration targets, not mathematical guarantees. Human telemetry must tune future generator versions. Never silently change a generator version for an already funded Orb.

## Important production boundary

At the V0.2 milestone, the demo intentionally derived its local deterministic seed from the URL slug. This makes development/test runs reproducible but is **not** the funded-Orb reveal mechanism.

Before real prizes are wired in:

1. Creation stores a server-generated random secret seed, host settings hash, generator version and commitment.
2. Countdown/share pages receive no seed or geometry.
3. At the immutable on-chain `starts_at`, the backend releases one canonical signed manifest to all qualified players.
4. Finish submissions contain the quantized input/replay stream.
5. The backend replays the canonical manifest with the pinned Rapier version before acquiring the first-winner lock.

Never treat hiding JavaScript, blocking screenshots or trusting a client goal event as contest security.

## Performance shape

The generator merges contiguous walls. On the current `demo` seed this yields roughly:

- Quick: ~60 merged wall colliders
- Classic: ~100 merged wall colliders
- Brutal: ~175 merged wall colliders

The renderer uses two instanced draw calls for all static maze walls (glass body + luminous cap), regardless of the wall count. The rest of the scene is intentionally small: floor, underlay, marble, gates, checkpoint rings, goal, two mountain rings, sky and one starfield.

## Next game milestone

Do not add backend frame streaming. Next game work should be:

1. Playtest physics feel on real desktop + iPhone/Android hardware.
2. Tune terminal speed, damping, steering response, gate speed and camera distance.
3. Collect human solve-time samples across at least 20-30 seeds per profile.
4. Add production JIT manifest/replay boundaries without changing the local physics rules.

## Safe color derivation

Host colors are semantic inputs, not raw shader controls. The renderer preserves the requested hue while automatically lifting very dark rail/accent colors and darkening overly bright floor colors toward Deep Orbit. This keeps custom community palettes recognizable without allowing a host to accidentally make walls invisible or destroy marble/goal contrast.
