# ORBS RACE authority

Separate Railway service for prize-bearing RACE matches. It intentionally does not share a process with ARENA.

Required environment:
- `RACE_RUNTIME_HMAC_KEY` — same >=32-char secret as Vercel.
- `ORBS_SITE_URL` — canonical `https://orbs.meme` site URL.
- `PORT` — supplied by Railway.

Vercel also needs `NEXT_PUBLIC_RACE_REALTIME_URL=wss://<this-service>` and the same `RACE_RUNTIME_HMAC_KEY`.

Health endpoint: `/health`. WebSocket endpoint: `/race`.
