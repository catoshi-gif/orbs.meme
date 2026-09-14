# Orbs architecture and trust boundaries

This document describes the current repository architecture. Historical milestone notes under `docs/` may describe earlier boundaries and are labeled accordingly.

## System responsibilities

### Browser

The browser renders the product and games, connects the user's wallet, obtains explicit signatures, and submits player input. It is **not** trusted to select a winner or redirect escrow. Funding/claim transaction firewalls inspect expected instructions and accounts before the wallet signs.

### Next.js web/API application

The application owns host creation policy, X/wallet/human qualification, sealed Orb records, price/fee quotes, waiting-room state, analytics, admission tokens, result ingestion, winner locking and settlement orchestration. Durable state uses the configured Upstash/Vercel-KV-compatible REST backend.

### MAZE verifier

MAZE is deterministic. Funded Orbs persist a server-generated secret seed and commitment before launch. At launch the canonical game is revealed; a submitted control/recovery replay is independently simulated server-side against the pinned physics/generator version before it can acquire the winner lock.

### ARENA authority

`arena-server/` is a separate long-running WebSocket process. It owns the authoritative Rapier world, player movement, damage, powers, projectiles, eliminations and winner selection. Clients submit bounded input/action messages only. The service receives an HMAC-verifiable admission token and HMAC-signs result/integrity callbacks. It does not possess Solana custody keys.

### RACE authority

`race-server/` is an independent WebSocket process for the Prismway race. It owns the sealed procedural course, authoritative movement, lap/rank progression, rescue behavior, items and finish ordering. It has the same isolation principle as ARENA: game-result attestation only, no custody credentials.

### Solana Anchor program

`programs/orbs_protocol/` is the custody and settlement boundary. V1 uses the classic SPL Token Program; Token-2022 is intentionally excluded. Native SOL is represented to users as SOL but uses wrapped SOL for classic-SPL custody.

The program's critical invariant is that callers cannot choose arbitrary settlement destinations:

- funding moves the fixed prize into the isolated Orb vault
- a valid pre-expiry claim requires the configured claim authority and the distinct winner, with payout fixed to the winner's canonical ATA
- after expiry, refund execution is permissionless but the destination is fixed to the original host's canonical ATA
- settled temporary custody accounts are closed to the configured rent receiver

### Turnkey / claim authority

The claim signer authorizes the winner selected through the verified application/game path. Turnkey credentials remain server-side. Realtime game authorities never receive them.

## Data and control flow

```text
Host wallet + X
      |
      v
Create / quote / fund ---> Solana Anchor escrow
      |
      v
Sealed Orb record + public commitment
      |
      +--> Player qualification (X + wallet + human + fair play)
      |
      +--> MAZE verifier
      |      or
      +--> ARENA authority
      |      or
      +--> RACE authority
              |
              v
       verified winner result
              |
              v
       atomic winner lock
              |
              v
       claim authorization
              |
              v
       Solana settlement
```

## Fail-closed behavior

Prize-bearing paths are intentionally disabled or rejected when required infrastructure is unavailable or mismatched. Examples include missing durable storage/secrets, unhealthy/mismatched realtime authority versions, absent qualification proofs and game-version mismatches on already-funded Orbs.

## Version pinning

Paid competitions must not silently inherit changed rules. MAZE stores generator/physics versions; ARENA/RACE admission checks compare the Orb's stored game version to the authority/client version. A behavior-changing game update should use a new version and explicit compatibility/migration policy.

## Realtime scaling constraint

ARENA and RACE room state is intentionally held in the authority process rather than persisted at 60 Hz. Deploy one authoritative replica per service until room-aware routing/durable room ownership is implemented; uncoordinated horizontal replicas could split one match across processes.

## Environment boundary

`.env.example` is the canonical inventory. Public `NEXT_PUBLIC_*` values may be bundled into the browser; every other secret should remain server/service-side. Do not give realtime authorities treasury, relayer, Turnkey or vault credentials.
