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

Clients submit only steering/action inputs. The authority owns Rapier physics, health, pickups, powers, projectiles, eliminations, and winner selection. It HMAC-signs the final result back to `/api/arena/runtime/result`; the web app validates that result and uses the existing atomic winner lock / settlement path.

The Arena service must **not** receive Solana, Turnkey, treasury, relayer, or vault keys. Its only trusted capability is attesting the winner of a specific registered Arena match.

## Docker

The included `Dockerfile` runs the service on Node 22. Deploy this directory as a long-running container/service, point `NEXT_PUBLIC_ARENA_REALTIME_URL` at its `wss://` origin, then redeploy the Orbs web app so the Create page sees the configuration.
