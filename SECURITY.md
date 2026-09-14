# Security policy

Orbs combines public blockchain settlement with web, identity and realtime game infrastructure. Please do not publish an exploitable vulnerability before maintainers have had a reasonable opportunity to investigate it.

## Reporting

If you discover a vulnerability, report it privately to the repository owner/maintainer through the private contact method listed on the GitHub profile or repository security-advisory interface. Include:

- affected component and commit
- reproduction steps or proof of concept
- expected vs. observed behavior
- potential impact
- any suggested mitigation

Do not include production private keys, access tokens, personal data or funds in a report.

## Particularly sensitive areas

Extra care is warranted around:

- Anchor funding, claim and refund invariants
- transaction firewalls and account derivation
- Turnkey / relayer authorization
- winner locking and idempotency
- MAZE replay verification
- ARENA / RACE join tokens and HMAC callbacks
- X/wallet qualification binding
- server-only environment variables

## Secret handling

No production credential should be committed to this repository. Use `.env.example` only as a variable-name reference. If a secret is ever committed, rotate it immediately and remove it from Git history; deleting the current file alone is not sufficient.
