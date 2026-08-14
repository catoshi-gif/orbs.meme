# Orbs.meme V1 Website + Protocol Technical Specification

**Tagline:** Grow your community. Share the love. Join the movement.

**V1 definition:** A host creates a timed 3D marble-tilt challenge, funds a prize using a standard SPL token, and shares a unique Orb URL. Players qualify by connecting X, completing the host-follow step, connecting a Solana wallet, passing anti-automation checks, and publishing one original entry post containing the Orb link. At launch, everyone races through the same committed game. The first server-validated finish wins the escrowed prize.

**V1 token policy:** Standard SPL Token Program only. Token-2022 is out of scope.

## Product principles
- Consumer game first; crypto mechanics second.
- Free to play; host funds the prize.
- Skill determines the winner; no random selection.
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
Subhead: Create a live marble challenge for your followers. Fund the prize with a Solana token. First valid finish wins.
CTAs: **Create an Orb** / **Find a live Orb**.
Trust line: Free to play · Skill decides · Prize escrowed before launch.

Discovery tabs: Live, Starting Soon, Trending, Big Orbs. Cards show host, token prize, USD estimate, format, launch status, qualified-player count, CTA.

## Create wizard
1. Identity: connect X + wallet.
2. Prize: standard SPL token picker, prize amount, USD quote, same-token $1 protocol fee, balance check.
3. Game: Quick ~5m / Classic ~10m / Brutal ~15m, marble color, board color.
4. Launch: date/time/timezone and share-card preview.
5. Review + Fund: prize and fee separate; wallet transaction creates/funds Orb.
6. Share: unique URL, copy, X intent, deterministic Open Graph card.

Recommended V1 economics: advertised prize minimum `$6` equivalent; `$1` fee is added separately and converted into the same token at funding time so the winner receives the full advertised prize.

A token may be displayed in the picker but cannot fund an Orb if there is no reliable USD price quote, because the V1 minimum and fee are USD-derived.

## Orb lobby + qualification
Show host, prize, USD estimate, game format, countdown, funded badge, qualification card, safe game preview, qualified-player count, rules.

Qualification:
1. Connect X via OAuth.
2. Follow host on X and return to press **I followed**. If no paid X relationship API is used, record click + attestation; do not call it verified.
3. Connect wallet + sign ownership nonce; unique wallet per Orb entrant.
4. Pass Turnstile + abuse-risk policy; validate challenge server-side.
5. Add an original line, publish the Orb link through an explicit X Web Intent, then verify the connected account's recent posts through the official X API. Store the verified post ID once per entrant/Orb. Do not auto-publish or encourage duplicate/near-duplicate contest posts.

At T-10 seconds enter full-screen launch state. At T0 reveal the maze seed and enter the game.

## Live game
Desktop: pointer tilt or WASD/arrow fallback. Mobile: device orientation after permission, with touch joystick fallback.

Use a regional persistent WebSocket service with fixed-timestep authoritative physics. Browser predicts/renders; server receives ordered tilt inputs and determines checkpoints/finish. Client never declares the winner.

The challenge should use physics obstacles and timed/moving elements so it is not a trivial static-maze graph-solving problem.

## Fairness commitment
`commitment = SHA256(maze_seed || orb_id || rules_version || salt)`

Publish/store before launch. Reveal `maze_seed` and `salt` at T0. The hash proves the maze was committed before play; authoritative simulation proves who won.

## Results
Hero: **ORB CLEARED**. Show winner identity, wallet, token prize, verified finish time, payout transaction, commitment verification, qualified-player count. CTAs: **Share your win**, **Create an Orb**, **Run it again**.

## My Orbs
Hosted, Upcoming, Winnings, Completed. Show status, prize, launch, players, result, payout signature. V1 analytics: views, qualification funnel, follow-button clicks, qualified players, repeat-host, create-after-play. Do not claim actual new-follower counts unless relationship data is verified.

## Solana program
Standard SPL Token Program only. Reject Token-2022.

Core accounts: ProtocolConfig PDA, isolated Orb PDA, and the Orb PDA's canonical classic-SPL prize ATA.

Core instructions: `fund_orb`, `claim_prize`, `refund_expired`, plus upgrade-authority-only `initialize_protocol` / `rotate_claim_authority`.

On-chain invariants: the host signs funding into the isolated Orb vault; before expiry, the configured Turnkey claim authority and a distinct winner both sign and payout is fixed to the winner's canonical ATA; after expiry, anyone may trigger a refund but the destination is fixed to the original host's canonical ATA; successful settlement drains and closes both temporary custody accounts to the fixed rent receiver.

USD minimums, the same-token Orbs fee, quote freshness, one-active-Orb policy, X qualification, replay verification, and winner selection are server/application policy. Funding is one atomic transaction: idempotent treasury ATA creation, exact same-token `transfer_checked` fee to the fixed treasury ATA, then `fund_orb`. The browser transaction firewall independently checks all three instructions before the host signs.

## Backend boundaries
- Web app: responsive UI, SEO/OG, wallet/X flows, create/lobby/dashboard/results.
- API: sessions, qualification, price quotes, tx orchestration, analytics/admin.
- Game service: WebSockets, synchronized launch, authoritative physics/winner.
- Database: relational durable state.
- Cache/realtime: presence, counts, locks, rate limits.
- Object/CDN: assets where needed. Orb share cards are deterministic responses generated once from the immutable Orb record and cached at the CDN; do not store a separate image record per share.
- RPC: Solana interaction.
- Price adapter: provider-agnostic USD quote layer.

## Core data entities
`users`, `wallets`, `x_accounts`, `orbs`, `orb_entrants`, `game_sessions`, `game_results`, `payout_attempts`, `price_quotes`, `events`.

## Orb state machine
`DRAFT -> AWAITING_FUNDING -> SCHEDULED -> QUALIFYING -> LIVE -> VALIDATING -> WINNER_PENDING -> SETTLED`

No-winner path: `LIVE -> EXPIRED -> REFUND_PENDING -> REFUNDED`.

Use `ERROR_LOCKED` for explicit operator recovery without silently changing custody/winner.

## V1 launch bar
- Complete light/dark mode across every route/state.
- Mobile host creation and mobile play both fully supported.
- Players never pay to enter.
- Token-2022 rejected pre-funding.
- Displayed prize equals settleable vault prize; fee separate.
- Host cannot withdraw a public funded prize.
- Maze seed unavailable before T0.
- Server, not browser, determines finish.
- Duplicate X/wallet entrants rejected.
- Turnstile validated server-side.
- Settlement idempotent.
- Deterministic outage/reschedule policy.
- OG/share cards for every public Orb/result.
- Legal/rules/privacy/jurisdiction review before public prize launch.

## Official implementation references
- X OAuth 2.0 Authorization Code + PKCE: https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code
- X authentication overview: https://docs.x.com/fundamentals/authentication/overview
- Solana core / PDAs: https://solana.com/docs/core
- Solana SPL Token basics: https://solana.com/docs/tokens/basics
- Cloudflare Turnstile server validation: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
- Jupiter developer docs (candidate price/token provider): https://dev.jup.ag/
