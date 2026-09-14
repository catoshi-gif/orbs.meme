# Orbs.meme V1 — current product + protocol specification

**Tagline:** Grow your community. Share the love. Join the movement.

**V1 definition:** A host creates a timed MAZE, ARENA, or RACE competition, funds a Solana-token prize, and shares a unique Orb URL. Players qualify by connecting X, completing the host-follow step, connecting a Solana wallet, passing human/abuse checks, and publishing one original entry post containing the Orb link. Game rules are committed/version-pinned before play; winner selection is independently verified or server-authoritative, and the escrowed prize settles through the Anchor program.

**V1 token policy:** Custody uses the classic SPL Token Program. Standard SPL prizes are supported; native SOL is presented as SOL and wrapped into WSOL for the classic-SPL custody path. Token-2022 is out of scope and rejected.

## Product principles
- Consumer game first; crypto mechanics second.
- Free to play; host funds the prize.
- Gameplay determines the winner; no random prize selection.
- Prize is fully funded before launch and cannot be casually withdrawn by the host.
- On-chain program owns custody/settlement; game server owns authoritative gameplay.
- X identity can be verified with OAuth. If Orbs does not pay for X relationship lookups, the Follow Host step must be described as completed/attested, not as a verified follow.

## Global website shell
Desktop header: Orbs logo + wordmark, Live Orbs, How it works, Create, light/dark theme button, Connect Wallet. Connected wallet becomes an identity chip with My Orbs / Disconnect. X connection is contextual to create/qualification, not global navigation.

Mobile header: logo, theme toggle, wallet control, compact menu. The live game hides nonessential navigation.

### Theme
- Deep Orbit `#0B1020`
- Orb Indigo `#5B5CF6`
- Nova Violet `#9A5CFF`
- Signal Aqua `#20E3D2`
- Flux Sky `#41B7FF`
- Cloud `#F7F8FC`
- Gradient: `#5B5CF6 -> #9A5CFF -> #20E3D2`
- Primary font: Lato 600/700
- Secondary font: Inter 400/500/600

## Routes
- `/` home + Orb discovery
- `/create` host wizard
- `/orb/[slug]` lobby/countdown/qualification
- `/orb/[slug]/play` live game
- `/orb/[slug]/results` winner/result
- `/me` hosted/won history
- `/how-it-works`, `/rules`, `/terms`, `/privacy`

## Home
Hero copy: **Put up a reward. Drop an Orb. Grow your community.**
Subhead: Create a live skill game for your followers. Fund the prize with a Solana token. The verified game winner takes the prize.
CTAs: **Create an Orb** / **Find a live Orb**.
Trust line: Free to play · Skill decides · Prize escrowed before launch.

Discovery tabs: Live, Starting Soon, Trending, Big Orbs. Cards show host, token prize, USD estimate, format, launch status, qualified-player count, CTA.

## Create wizard
1. Identity: connect X + wallet.
2. Prize: SOL/standard SPL picker, total creator commitment, USD quote, included same-token $1.15 protocol fee, derived winner prize, balance check.
3. Game: choose MAZE, ARENA, or RACE. MAZE also selects Quick / Classic / Brutal difficulty; each mode exposes its relevant visual configuration.
4. Launch: date/time/timezone and share-card preview.
5. Review + Fund: creator reviews one total wallet debit; the $1.15 fee is carved out and the remainder funds the winner prize; wallet transaction creates/funds Orb.
6. Share: unique URL, copy, X intent, deterministic Open Graph card.

V1 economics: the winner prize must be at least `$5` equivalent. The creator enters the total amount they are willing to debit; the `$1.15` Orbs fee is included in that total and converted into the same asset at funding time. The remainder is the advertised winner prize. The practical minimum total is approximately `$6.15`, subject to the locked asset price and atomic-unit rounding.

A token may be displayed in the picker but cannot fund an Orb if there is no reliable USD price quote, because the V1 minimum and fee are USD-derived.

## Orb lobby + qualification
Show host, prize, USD estimate, game format, countdown, funded badge, registration/qualification card, live waiting-room presence (total / registered / watching), qualified-player count, rules. Registration is required before a competitive game session is issued.

Qualification:
1. Connect X via OAuth.
2. Follow host on X and return to press **I followed**. If no paid X relationship API is used, record click + attestation; do not call it verified.
3. Connect wallet + sign ownership nonce; unique wallet per Orb entrant.
4. Pass Turnstile + abuse-risk policy; validate challenge server-side.
5. Add an original line, publish the Orb link through an explicit X Web Intent, then verify the connected account's recent posts through the official X API. Store the verified post ID once per entrant/Orb. Do not auto-publish or encourage duplicate/near-duplicate contest posts.

Near launch, enter the full-screen game state. MAZE reveals its canonical seed/manifest at T0. ARENA/RACE issue authenticated realtime admission only through their configured authoritative services.

## Live games

### MAZE
Desktop uses WASD/arrow direct steering and mobile uses the onscreen joystick. The browser records a bounded deterministic input/recovery replay; the server independently reconstructs the pinned Rapier simulation and only an accepted replay can acquire the winner lock.

### ARENA
A separate long-running WebSocket authority owns fixed-timestep Rapier physics, health, pickups, powers, projectiles, eliminations and the final surviving winner. The browser submits normalized input/action messages and renders server snapshots.

### RACE
A separate WebSocket authority owns the sealed procedural Prismway, authoritative racer motion, recovery, items, lap progression, finish ordering and winner. The current race is three laps.

Realtime authorities are result-attestation services only: they do not receive treasury, relayer, Turnkey or vault credentials.

## Fairness commitment
MAZE uses a SHA-256 game commitment derived from the sealed seed/Orb/rules inputs and stores it before launch; the canonical seed/manifest is unavailable to players before T0. ARENA and RACE likewise pin the funded Orb to a specific authoritative game version/configuration so paid rules cannot be silently changed after funding.

## Results
Hero: **ORB CLEARED**. Show winner identity, wallet, token prize, verified finish time, payout transaction, commitment verification, qualified-player count. CTAs: **Share your win**, **Create an Orb**, **Run it again**.

## My Orbs
Hosted, Upcoming, Winnings, Completed. Show status, prize, launch, players, result, payout signature. V1 analytics: views, qualification funnel, follow-button clicks, qualified players, repeat-host, create-after-play. Do not claim actual new-follower counts unless relationship data is verified.

## Solana program
Classic SPL Token Program custody only. Standard SPL prizes are supported; native SOL uses the WSOL mint for custody and can be unwrapped after claim. Reject Token-2022.

Core accounts: ProtocolConfig PDA, isolated Orb PDA, and the Orb PDA's canonical classic-SPL prize ATA.

Core instructions: `fund_orb`, `claim_prize`, `refund_expired`, plus upgrade-authority-only `initialize_protocol` / `rotate_claim_authority`.

On-chain invariants: the host signs funding into the isolated Orb vault; before expiry, the configured Turnkey claim authority and a distinct winner both sign and payout is fixed to the winner's canonical ATA; after expiry, anyone may trigger a refund but the destination is fixed to the original host's canonical ATA; successful settlement drains and closes both temporary custody accounts to the fixed rent receiver.

USD minimums, the same-token Orbs fee, quote freshness, one-active-Orb policy, X qualification, replay verification, and winner selection are server/application policy. Funding is one atomic transaction: idempotent treasury ATA creation, exact same-token `transfer_checked` fee to the fixed treasury ATA, then `fund_orb`. The browser transaction firewall independently checks all three instructions before the host signs.

## Backend boundaries
- Web app: responsive UI, SEO/OG, wallet/X flows, create/lobby/dashboard/results.
- API: sessions, qualification, price quotes, tx orchestration, analytics/admin.
- Game services: separate ARENA and RACE WebSocket authorities with synchronized launch and authoritative physics/winner selection; MAZE uses deterministic server replay verification.
- Durable application state: Upstash/Vercel-KV-compatible REST storage for Orb records, qualification proofs, winner locks, analytics, presence/chat metadata and rate limits.
- Realtime simulation state: held in the dedicated ARENA/RACE authority process; not written to Redis at 60 Hz.
- Object/CDN: assets where needed. Orb share cards are deterministic responses generated once from the immutable Orb record and cached at the CDN; do not store a separate image record per share.
- RPC: Solana interaction.
- Price adapter: provider-agnostic USD quote layer.

## Current durable records
The implementation stores versioned Orb records plus separate qualification, presence/chat, entrant-profile, winner/result, analytics, claim/refund and abuse-control records. Public Orb records intentionally omit the encrypted game seed. Legacy records without `gameType` are interpreted as MAZE for backward compatibility.

## Orb lifecycle
Creation starts as `funding-pending`. Only an Orb whose funding transaction has been verified against the deployed Anchor program is promoted to public `scheduled` status and discovery. Launch/live/result presentation is derived from the immutable schedule, verified winner/result records and on-chain settlement state rather than trusting a browser-selected status. Expired funded Orbs follow the fixed on-chain refund path. Historical `*-test` statuses remain readable for legacy development records but are not admitted to current public funded discovery.


## V1 launch bar
- Complete light/dark mode across every route/state.
- Mobile host creation and mobile play both fully supported.
- Players never pay to enter.
- Token-2022 rejected pre-funding.
- Displayed total commitment equals the intended wallet debit; the disclosed fee is included in that total; displayed winner prize equals the settleable vault prize.
- Host cannot withdraw a public funded prize.
- MAZE seed unavailable before T0; funded game rules/version are pinned before play.
- Browser alone cannot determine a prize winner: MAZE is server-replayed; ARENA/RACE are server-authoritative.
- Duplicate X/wallet entrants rejected.
- Turnstile validated server-side.
- Settlement idempotent.
- Deterministic outage/reschedule policy.
- OG/share cards for every public Orb/result.
- Maintain counsel-reviewed rules, terms, privacy disclosures, supported jurisdictions, and promotion-specific compliance before broad public prize launch.

## Official implementation references
- X OAuth 2.0 Authorization Code + PKCE: https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code
- X authentication overview: https://docs.x.com/fundamentals/authentication/overview
- Solana core / PDAs: https://solana.com/docs/core
- Solana SPL Token basics: https://solana.com/docs/tokens/basics
- Cloudflare Turnstile server validation: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
- Jupiter developer docs (candidate price/token provider): https://dev.jup.ag/
