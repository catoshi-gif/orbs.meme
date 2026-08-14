# orbs.meme

**Play. Win. Grow.**

Orbs is a gamified community-growth protocol built around the **Glass Roller**: a deterministic 3D tilt-maze for desktop and mobile. Hosts will fund timed SPL-token prize games and share one unique Orb URL; every qualified player receives the exact same live challenge.

## Current repository milestone — V0.2

### Website
- Next.js 15.5.9 / React 19
- Light + dark mode
- Solana mainnet wallet connection
- Responsive home, create flow, Orb lobby, live game, result and account routes
- Orbs visual system: Deep Orbit / Indigo / Violet / Aqua / Sky / Cloud
- Per-Orb Open Graph prize cards with token art and year-long CDN caching
- Wallet-indexed hosted Orb dashboard

### Glass Roller vertical slice
- Three.js renderer loaded only on `/orb/[slug]/play`
- Rapier deterministic 3D WASM physics
- Fixed 60 Hz physics step
- Arrow/WASD tilt on desktop
- Device-orientation tilt + calibration on mobile
- Touch tilt-pad fallback
- Seeded deterministic maze generation
- Quick / Classic / Brutal initial difficulty calibration targets (~5 / 10 / 15 min)
- Controlled loops, dead ends, candidate scoring, ordered checkpoints
- Rotating gate modules + static precision bumpers
- Merged wall colliders + instanced rendering for low draw-call count
- Procedural cosmic world + procedural marble shader
- Fully custom game palette with Orbs/BONK/Aurora/Solar presets
- Adaptive pixel-ratio downgrade on slower hardware
- Zero gameplay dependence on Vercel/Upstash frame streaming

See [`docs/GAME_V0_2.md`](docs/GAME_V0_2.md) for the exact production boundary between this local deterministic prototype and the future funded-Orb JIT manifest/replay architecture.

## Local development

```bash
npm install
npm run typecheck
npm run dev
```

Then open:

```text
http://localhost:3000/orb/demo/play
```

Custom deterministic demo example:

```text
/orb/demo/play?difficulty=brutal&marble=%23FF8B36&marble2=%23FFE66D&walls=%2363F38B&floor=%23130D0B&accent=%2320E3D2
```

The Create wizard's Game step also generates these preview URLs for you.


## Operator / eligibility configuration

Production creation and entry require a wallet-bound 18+ eligibility receipt. The date of birth is evaluated server-side and is not stored; the retained receipt contains only the wallet, confirmation time, and current legal-document versions.

The private operator dashboard is available at:

```text
/app/admin
```

Set this server-only Vercel variable to the single Solana wallet allowed to unlock it:

```text
ADMIN_WALLET=<your-admin-solana-public-address>
```

The admin page requires a wallet message signature and then issues a short-lived HttpOnly admin session. Do not prefix `ADMIN_WALLET` with `NEXT_PUBLIC_`.

The dashboard intentionally does not poll X impression metrics automatically. Verified entry-post counts are already stored; automatic impression polling would add X API reads/credits and the current host-share flow does not persist one canonical creator-post ID for every Orb.

## Production security boundary

The local V0.2 play route derives a deterministic development seed from the Orb slug. **Do not use that seed model for funded games.** Production games will use a server-generated hidden seed committed before launch, release one canonical manifest only after the immutable on-chain start time, and verify a compressed deterministic replay before acquiring the first-winner lock.

## V1 sequence

1. Website + wallet — complete
2. Glass Roller vertical slice — current
3. Human playtest + difficulty calibration
4. JIT game manifest + deterministic finish verifier
5. X / follow / wallet / Turnstile / verified entry-post qualification
6. SPL picker + price/fee quote
7. Anchor funding / refund
8. Turnkey winner claim
9. Analytics + share-card measurement
10. Mainnet public beta


### Optional private admin X reach metrics

The private `/app/admin` dashboard can refresh the public reach of creator X posts only when an authenticated admin presses the X refresh button. There is no background polling.

Set this server-only Vercel environment variable to the App Bearer Token from the X Developer Console:

```text
X_BEARER_TOKEN=...
```

Creator posts made after this feature ships can be linked from the creator Share step with **Verify creator post**. For older Orbs, paste the host post URL into the private admin table once. The server verifies that the post author matches the Orb host before attaching it.

Never prefix `X_BEARER_TOKEN` with `NEXT_PUBLIC_`.
