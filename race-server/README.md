# Orbs RACE Authority

Long-running authoritative realtime service for prize-bearing **RACE** games. It intentionally runs as a separate service from ARENA so each game has independent room ownership and deployment/version boundaries.

## Required environment

On this service:

- `RACE_RUNTIME_HMAC_KEY` — same 32+ character secret configured on the Orbs web app
- `ORBS_SITE_URL` — canonical web origin, e.g. `https://orbs.meme`
- `PORT` — supplied by the host; defaults to `8080`

On the Orbs web app:

- `NEXT_PUBLIC_RACE_REALTIME_URL` — public secure WebSocket origin for this service
- `RACE_RUNTIME_HMAC_KEY` — the same shared secret

The web app performs a live health/version preflight and keeps prize-bearing RACE creation fail-closed when the authority is unavailable or mismatched.

## Endpoints

- `GET /health` — health/version/room summary
- WebSocket `/race` — authenticated realtime game connection
- `POST /admin/control` — HMAC-authenticated competition restriction control

## Security boundary

Clients receive a short-lived HMAC-authenticated admission token only after application-level qualification. They submit bounded steering/action messages; the authority owns the procedural course, Rapier world, racer state, items, recovery behavior, lap/rank progression, finish ordering and winner selection.

The service signs integrity/result callbacks to the web application with `RACE_RUNTIME_HMAC_KEY`. It must **not** receive Solana, treasury, relayer, Turnkey or vault private credentials. Its trusted capability is limited to attesting the outcome of an authenticated RACE match.

## Deployment / scaling

The included Dockerfile/Railway configuration runs the service on Node 22. Use **one authority replica** until room-aware routing or durable room ownership is implemented. Match simulation is intentionally process-local; uncoordinated replicas could split entrants from the same Orb.

Do not intentionally redeploy while `liveRooms > 0`. Check `/health` before deployments. The server uses heartbeats, bounded message/action rates, reconnect handling and post-match room cleanup.

## Production preflight

1. Deploy one authority replica with restart-on-crash enabled.
2. Set `ORBS_SITE_URL` to the exact production origin. Browser WebSocket origins outside the allowed site origin(s) are rejected.
3. Configure the same 32+ character `RACE_RUNTIME_HMAC_KEY` on the authority and web app.
4. Set `NEXT_PUBLIC_RACE_REALTIME_URL` to the public `wss://` origin.
5. Confirm `/health` reports `ok: true` and the expected `orb-race-v1` version.
6. Redeploy the web app and confirm RACE creation passes its health/version preflight.
7. Run a two-wallet zero/low-value rehearsal before increasing prize sizes.

The authority never invents a custody outcome: if a match cannot produce a valid winner, the existing on-chain expiry/refund path remains the recovery mechanism.
