# Orbs Glass Roller V0.4 — deterministic competition core

This pass freezes the validated V1 control contract and adds the first server-authoritative competition boundary without changing the feel of the game.

## Frozen gameplay contract

- `glass-roller-physics-v1-locked`
- Rapier `0.20.0`
- Quick/Easy generator geometry remains unchanged after the 04:17 human calibration run.
- Desktop uses the validated precision steering profile.
- Mobile onscreen joystick is the only mobile movement input and uses the validated mobile steering profile.

Changing any of those rules for a funded Orb requires a new version string.

## Finish verification

A local goal collision is no longer enough to call a run verified.

1. The browser records quantized controls at 20 Hz plus explicit recovery/reset events.
2. The browser reaches all checkpoints and the goal locally.
3. The run freezes and posts its replay envelope to `POST /api/game/finish`.
4. The Node/Vercel verifier independently regenerates the canonical demo manifest.
5. The verifier rebuilds the Rapier world, applies the same 60 Hz physics contract, dynamic gate schedule, control stream, resets and checkpoint order.
6. Only if the replay reaches the same goal at the same physics tick is it accepted.
7. The server SHA-256 hashes both canonical manifest and replay payloads.

The current demo route still derives its seed from the public slug. That is intentional for testing. Funded Orbs will load a persisted secret-seed manifest instead of accepting difficulty/style from the client.

## Atomic winner lock

If these server-only environment variables exist:

```text
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

`/api/game/finish` executes one Redis `SET key value NX EX ...` operation. Only the first verified finish can acquire the Orb winner key. A competing verified request receives the existing winner instead.

If Upstash is not configured, the demo runs in `verification-only` mode: the full deterministic server replay executes, but no durable winner is claimed.

Never expose the standard Upstash token to the browser.

## JIT manifest foundation

`generateGameManifestFromSecret(...)` is now available for funded Orbs. It accepts a 32-byte secret seed and produces the same deterministic manifest pipeline without exposing that seed on countdown pages.

`src/game/canonical.ts` adds:

- canonical manifest payload
- canonical replay payload
- SHA-256 manifest hash
- SHA-256 replay hash
- `ORBS_GAME_V1` commitment builder

The next persistence/funding pass should create the secret before funding, store it encrypted server-side, put only the commitment + `starts_at` on chain, and refuse the canonical manifest before `starts_at`.

## Important boundary

V0.4 does **not** yet authorize token claims. The current winner record contains replay proof only. Wallet identity, X qualification, Turnkey claim signing and Anchor settlement remain separate later layers.
