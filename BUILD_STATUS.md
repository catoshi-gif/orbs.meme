# Source snapshot validation status

This file records validation of the **open-source repository snapshot**, not the operational health of any live deployment. Production health, configuration and legal readiness must be checked independently.

## Repository-level review performed for public release

- reviewed source tree for committed `.env` files, private-key material, obvious API tokens/passwords and personal filesystem paths; none were intentionally included in this snapshot
- removed the historical hard-coded test/operator wallet exemption; creation-policy exemptions now come only from `ADMIN_WALLET` / `ORBS_ADMIN_WALLETS`
- added `.gitignore`, `.env.example`, MIT `LICENSE`, `SECURITY.md` and `CONTRIBUTING.md`
- refreshed the root README and current architecture documentation to describe MAZE, ARENA, RACE, Anchor custody, qualification and settlement boundaries
- marked early V0.2/V0.4 engineering notes as historical rather than current product status

## Required verification before publishing/deploying

Run from the repository root with dependencies available:

```bash
npm install
npm run typecheck
npm run build
```

For the Anchor program, use the project's security/preflight scripts in an environment with Rust, Cargo, Solana and Anchor installed:

```bash
npm run anchor:security
npm run anchor:preflight
```

For `arena-server/` and `race-server/`, install each service's dependencies and perform its documented health/version preflight before enabling prize-bearing creation.

## Git-history warning

A source ZIP cannot prove that an older commit in the original Git repository never contained a secret. Before changing an existing private GitHub repository to public, scan the **full Git history** with a credential scanner such as Gitleaks or TruffleHog. If preservation of private history is unnecessary, publishing this sanitized snapshot as a fresh public history is the lowest-risk option.

## What this status does not certify

This document is not a security audit, legal opinion, smart-contract audit, bug bounty report or guarantee that a production deployment is correctly configured. It records repository hygiene and the validation commands expected before release.
