# Orbs.meme — V1 web starter

Clean Next.js 15.5.9 starter for the Orbs.meme protocol.

## Functional now
- Responsive light/dark website shell
- Mainnet Solana wallet connection using the proven wallet-adapter pattern from the supplied repo
- Phantom, Solflare, Ledger, and Mobile Wallet Adapter support
- Wallet menu: address, one lightweight SOL balance read, copy, change wallet, disconnect
- V1 route/page scaffolding
- Interactive local Create Orb wizard shell
- Optimized Orbs logo assets

## Deliberately not live yet
- X OAuth / follow attestation
- SPL token picker / price quotes
- Upstash/database/indexer
- Anchor funding / escrow / refund / claims
- Turnkey claim signer
- Glass Roller game + physics
- Real discovery data / countdown / analytics

The UI labels those areas as future integration rather than pretending they are secure/live.

## Run
```bash
npm install
cp .env.example .env.local
npm run dev
```

Production should set `NEXT_PUBLIC_SOLANA_RPC_URL` to a private mainnet RPC.

## Routes
- `/`
- `/create`
- `/orb/demo-orb`
- `/orb/demo-orb/play`
- `/orb/demo-orb/results`
- `/me`
- `/how-it-works`
- `/rules`
- `/terms`
- `/privacy`

## Source references
- `docs/V1_SPEC.md`
- `docs/BRAND.md`
