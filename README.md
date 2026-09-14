# orbs.meme

**Gamified community growth on Solana.**

Orbs is a full-stack Solana competition platform where a host funds a token prize, shares one Orb link, and lets a qualified community compete for the escrowed reward. The repository includes the web product, Solana Anchor program, deterministic MAZE game, and separate authoritative realtime services for ARENA and RACE.

> Portfolio/open-source note: this repository contains the application and protocol source code, but no production secrets or private keys. Prize competitions can have legal and regulatory requirements that vary by jurisdiction; the included product copy is not legal advice.

## What is in this repository

### Product
- Next.js 15 / React 19 responsive web application
- Solana wallet connection and wallet-bound eligibility / fair-play receipts
- X OAuth identity flow and host-follow / entry-post qualification
- Cloudflare Turnstile human-verification boundary
- Host creation wizard, public Orb pages, waiting rooms, results, winner cards and account history
- Upstash-backed competition state, presence, chat, analytics, rate limits and atomic winner locks
- Jupiter-backed token metadata / USD pricing
- Native SOL presented in the picker and settled through classic-SPL WSOL custody
- Standard SPL Token Program prizes; Token-2022 is intentionally rejected

### Three competition modes

**MAZE — Glass Roller**
- Three.js rendering + Rapier 3D physics
- deterministic procedural course generation
- sealed server-side game seed and pre-launch commitment
- fixed-step replay capture and independent server verification
- desktop keyboard and mobile joystick controls

**ARENA**
- separate long-running Node/WebSocket authority
- authoritative 60 Hz Rapier simulation
- movement, health, pickups, powers, projectiles, eliminations and winner selection owned by the server
- HMAC-authenticated admission/result boundary with the web application

**RACE — Prismway**
- separate Node/WebSocket authority
- sealed procedural course generation and three-lap realtime racing
- server-authoritative movement, recovery, items, ranking and winner selection
- HMAC-authenticated result/integrity callbacks

### Solana protocol
The Anchor program uses isolated Orb PDAs and canonical classic-SPL token accounts for prize custody. The core settlement model is:

- host signs and funds the Orb
- fee + winner prize are checked before signing by the browser transaction firewall
- prize custody is controlled by the program, not the game server
- before expiry, the configured claim authority and the distinct winner authorize payout to the winner's canonical ATA
- after expiry, anyone may trigger the fixed refund path back to the original host's canonical ATA
- successful settlement drains and closes temporary custody accounts

The realtime game services never receive treasury, relayer, Turnkey or vault keys. They can only attest game outcomes for authenticated matches.

## Architecture

```text
Browser / Wallet
      |
      v
Next.js web + API (Vercel)
  |       |        |
  |       |        +--> X / Turnstile / Jupiter / Solana RPC
  |       +------------> Upstash durable state + atomic locks
  |
  +--> MAZE deterministic verifier
  +--> ARENA authority (WebSocket / Railway)
  +--> RACE authority  (WebSocket / Railway)
  |
  +--> Turnkey-backed claim authorization
  |
  v
Solana Anchor escrow / settlement program
```

For the security and trust boundaries, see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Repository layout

```text
src/                     Next.js application, APIs, game clients and shared libraries
programs/orbs_protocol/  Anchor/Rust Solana program
anchor-tests/             protocol/security test support
arena-server/             authoritative ARENA WebSocket service
race-server/              authoritative RACE WebSocket service
scripts/                  security and mainnet preflight scripts
docs/                     product, architecture and historical engineering notes
```

## Local development

Requirements:

- Node.js 22
- npm
- Rust / Cargo + Anchor CLI only if building/testing the on-chain program

```bash
git clone <your-fork-or-repository-url>
cd orbs.meme
cp .env.example .env.local
npm install
npm run typecheck
npm run dev
```

Then open `http://localhost:3000`. A deterministic MAZE development route is available at `http://localhost:3000/orb/demo/play`.

Only configure the integrations you are actively testing. Prize-bearing creation intentionally fails closed when required storage, signing, RPC or realtime-authority configuration is absent.

## Environment configuration

Use [`.env.example`](.env.example) as the canonical variable inventory. Important rules:

- never expose server secrets with a `NEXT_PUBLIC_` prefix
- use independent, high-entropy values for each application/HMAC signing secret
- never commit Solana keypairs, Turnkey private credentials, Redis tokens or X client secrets
- `ADMIN_WALLET` controls the private operator dashboard
- `ORBS_ADMIN_WALLETS` is an optional comma-separated list of additional wallets exempt from the one-active-Orb creation policy; there are no hard-coded operator wallets

## Validation

Web application:

```bash
npm run typecheck
npm run build
```

Protocol/security preflight:

```bash
npm run anchor:security
npm run anchor:preflight
```

Realtime services each have their own `package.json` and deployment README:

- [`arena-server/README.md`](arena-server/README.md)
- [`race-server/README.md`](race-server/README.md)

See [`BUILD_STATUS.md`](BUILD_STATUS.md) for what was and was not independently validated in the published source snapshot.

## Security model highlights

- funded game rules are version-pinned; paid competitions are not silently upgraded to newer game logic
- MAZE seeds remain sealed until the scheduled launch
- winner acquisition uses a durable first-writer lock
- browser funding/claim firewalls independently inspect transaction intent before signing
- game authorities are isolated from custody credentials
- realtime authority callbacks are HMAC authenticated
- X/wallet/human proofs are bound to competition entry
- Token-2022 is rejected by the V1 custody path
- refunds have fixed destinations rather than caller-selected recipients

Please report security issues privately as described in [`SECURITY.md`](SECURITY.md).

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — current system architecture and trust boundaries
- [`docs/V1_SPEC.md`](docs/V1_SPEC.md) — current V1 product/protocol specification
- [`docs/GAME_V0_2.md`](docs/GAME_V0_2.md) — historical Glass Roller vertical-slice note
- [`docs/COMPETITION_CORE_V0_4.md`](docs/COMPETITION_CORE_V0_4.md) — historical deterministic-verifier milestone
- [`docs/BRAND.md`](docs/BRAND.md) — visual/brand notes

Historical milestone documents are retained because they show the engineering progression; they are explicitly marked as historical and should not be read as the current production boundary.

## Open-source license

MIT — see [`LICENSE`](LICENSE).

Contributions are welcome; see [`CONTRIBUTING.md`](CONTRIBUTING.md).
