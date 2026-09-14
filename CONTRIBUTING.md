# Contributing

Thanks for taking an interest in Orbs. Changes should preserve the separation between game authority, application policy and on-chain custody.

## Development workflow

1. Fork/branch from the current repository state.
2. Copy `.env.example` to `.env.local` and add only the integrations needed for your test.
3. Keep secrets and keypairs out of Git.
4. Make the smallest change that solves the issue.
5. Run `npm run typecheck` and `npm run build`.
6. For protocol changes, also run `npm run anchor:security` and the relevant Anchor tests/preflight.
7. For ARENA/RACE authority changes, validate the service health/version contract and web-app compatibility.

## Compatibility rules

Funded competitions pin their gameplay/protocol versions. Do not silently change rules for an already-funded Orb. Changes that alter deterministic MAZE physics/generation or authoritative ARENA/RACE behavior require deliberate versioning and compatibility handling.

## Pull requests

Describe the user-visible behavior, security implications, validation performed and any required environment/deployment changes. Avoid drive-by formatting or unrelated refactors in security-sensitive code.
