# Orbs Arena Authority

Long-running authoritative realtime service for prize-bearing **ARENA** games.

## Required environment

- `ARENA_RUNTIME_HMAC_KEY` — the same 32+ character secret configured on the Orbs web app.
- `ORBS_SITE_URL` — canonical site origin, e.g. `https://www.orbs.meme`.
- `PORT` — supplied by the host (defaults to `8080`).

On the Orbs web app configure:

- `NEXT_PUBLIC_ARENA_REALTIME_URL` — secure WebSocket origin for this service, e.g. `wss://arena.example.com`.
- `ARENA_RUNTIME_HMAC_KEY` — same secret as the Arena authority.

Once both web-app variables are present, the existing Create page automatically unlocks **ARENA** creation. Without them, Arena creation remains fail-closed while MAZE is unaffected.

## First live-test deployment

Run **exactly one Arena authority replica** for the first live tests. Match simulation state is intentionally held in the authoritative process at 60 Hz rather than written to Redis every physics tick. Multiple uncoordinated replicas could split entrants for the same room. Add sticky room routing / durable room ownership before horizontally scaling the authority service.

The server has a `GET /health` endpoint and accepts WebSocket connections at `/arena`.

## Security boundary

Clients submit only steering/action inputs. Desktop input comes from keyboard controls; mobile input comes from the onscreen joystick. The authority receives normalized planar input only and never depends on a browser movement mode. The authority owns Rapier physics, health, pickups, powers, projectiles, eliminations, and winner selection. It HMAC-signs the final result back to `/api/arena/runtime/result`; the web app validates that result and uses the existing atomic winner lock / settlement path.

The Arena service must **not** receive Solana, Turnkey, treasury, relayer, or vault keys. Its only trusted capability is attesting the winner of a specific registered Arena match.

## Docker

The included `Dockerfile` runs the service on Node 22. Deploy this directory as a long-running container/service, point `NEXT_PUBLIC_ARENA_REALTIME_URL` at its `wss://` origin, then redeploy the Orbs web app so the Create page sees the configuration.

## Why this is a separate long-running runtime

The Arena authority remains in this repository, but it must run as a process with stable room ownership. Vercel WebSocket Functions have a maximum invocation duration and separate function instances need an external shared state layer. A 60 Hz Rapier room cannot safely assume that every entrant connection lands in the same Function process, and writing the full physics world to Redis on every tick would add latency/cost while weakening the single-authority model.

The web app therefore performs admission, identity, escrow, winner-lock and settlement duties, while this process owns only the transient Arena simulation. Increasing Vercel Function CPU does not change Function lifetime or process-affinity guarantees.

## Production preflight

Before enabling a real-money Arena:

1. Run one authority replica with restart-on-crash enabled.
2. Set `ORBS_SITE_URL` to the exact production origin (the WebSocket server rejects other browser origins).
3. Set the same 32+ character `ARENA_RUNTIME_HMAC_KEY` on the authority and web app.
4. Set `NEXT_PUBLIC_ARENA_REALTIME_URL` to the authority's public `wss://` origin.
5. Confirm `GET /health` returns `{ ok: true, version: "orb-arena-v9" }` from the public internet.
6. Redeploy the web app. Arena creation now performs a live health/version preflight and fails closed if the authority is unavailable or mismatched.
7. Run a two-wallet, zero/low-value operational rehearsal before increasing prize sizes.

If fewer than two entrants connect within two minutes after the scheduled launch, the authority aborts the match without recording a winner. Existing on-chain refund timing remains the source of truth for recovering the escrowed prize.


## Production operating rules

- Keep the authority at **one replica** until room-aware routing/durable ownership is implemented.
- Configure the Railway service Root Directory as `/arena-server` and Config File path as `/arena-server/railway.json`.
- The included Railway config watches only `/arena-server/**`, health-checks `/health`, and restarts on crashes.
- **Do not intentionally redeploy the Arena authority while `liveRooms > 0`.** A deploy replaces the in-memory physics authority for an active match. Check `/health` first.
- Clients get a 20-second reconnect grace period. After that, a disconnected Orb is eliminated instead of being able to AFK-disconnect and remain alive indefinitely.
- There is no competitive match timer. A healthy match continues until one Orb remains. Power availability accelerates later in the match; the only operational ceiling is the Orb refund window, which aborts safely with no winner rather than inventing one.
- The server sends WebSocket heartbeats so dead connections are detected promptly.
- Redis is intentionally **not** used for 60 Hz physics state. The existing Orbs web app remains responsible for entrant profiles, qualification, winner locking, and durable records.
