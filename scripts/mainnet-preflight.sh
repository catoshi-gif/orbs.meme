#!/usr/bin/env bash
set -euo pipefail

PLACEHOLDER_ID="HbBoHU9bT4eFSvGW7zjZFy7nEMN2dPKGt5wCd7ePKbPv"
TREASURY="5mEqxr6McBRL5DGE9dJ2Td3viwhAmRpe4V7pqGTPMtvr"
RELAYER="GMpmAw9JDKhJHo6umea4BsfLHVSqBYXPvv8hTU4t84vN"
ADMIN="EDxq8pn8assS3Zoco5UBm3suPNu6oum3fzEwCsZixWC4"
PROGRAM_RS="programs/orbs_protocol/src/lib.rs"

for tool in anchor solana cargo node npm; do
  command -v "$tool" >/dev/null 2>&1 || { echo "ERROR: required tool '$tool' is not installed" >&2; exit 1; }
done

PROGRAM_ID=$(sed -n 's/.*declare_id!("\([1-9A-HJ-NP-Za-km-z]*\)").*/\1/p' "$PROGRAM_RS" | head -n 1)
MAINNET_ID=$(awk -F'"' '/^orbs_protocol = / { print $2 }' Anchor.toml | tail -n 1)

if [ -z "$PROGRAM_ID" ] || [ "$PROGRAM_ID" = "$PLACEHOLDER_ID" ]; then
  echo "ERROR: placeholder program id is still present. Generate the deployment keypair and run 'anchor keys sync'." >&2
  exit 1
fi
if [ -z "$MAINNET_ID" ] || [ "$MAINNET_ID" != "$PROGRAM_ID" ]; then
  echo "ERROR: Anchor.toml mainnet program id does not match declare_id!. Run 'anchor keys sync'." >&2
  exit 1
fi

for pair in \
  "ORBS_TREASURY:$TREASURY" \
  "ORBS_RENT_RECEIVER:$RELAYER" \
  "ORBS_ADMIN_CREATOR:$ADMIN"; do
  name=${pair%%:*}; value=${pair#*:}
  grep -q "$value" "$PROGRAM_RS" || { echo "ERROR: $name production identity is not the audited address" >&2; exit 1; }
done

if [ -z "${ORBS_PROGRAM_ID:-}" ] || [ "$ORBS_PROGRAM_ID" != "$PROGRAM_ID" ]; then
  echo "ERROR: ORBS_PROGRAM_ID must be exported and equal $PROGRAM_ID" >&2
  exit 1
fi
if [ -z "${NEXT_PUBLIC_ORBS_PROGRAM_ID:-}" ] || [ "$NEXT_PUBLIC_ORBS_PROGRAM_ID" != "$PROGRAM_ID" ]; then
  echo "ERROR: NEXT_PUBLIC_ORBS_PROGRAM_ID must be exported and equal $PROGRAM_ID" >&2
  exit 1
fi

if [ ! -f package-lock.json ]; then
  echo "ERROR: package-lock.json is missing. Run 'npm install' once in Codespaces, review the resolved tree, and commit the lockfile before mainnet preflight." >&2
  exit 1
fi
if [ ! -f anchor-tests/package-lock.json ]; then
  echo "ERROR: anchor-tests/package-lock.json is missing. Run 'npm install' once inside anchor-tests and commit the lockfile before mainnet preflight." >&2
  exit 1
fi

for required in NEXT_PUBLIC_SOLANA_RPC_URL HELIUS_RPC_URL ORBS_RELAYER_SECRET_KEY ORBS_FEE_QUOTE_AUTHORITY_SECRET_KEY ORBS_FUNDING_QUOTE_SIGNING_KEY; do
  if [ -z "${!required:-}" ]; then
    echo "ERROR: required production environment variable $required is not set" >&2
    exit 1
  fi
done

if grep -RIn --exclude='mainnet-preflight.sh' --exclude='anchor-security.sh' --exclude='Cargo.toml' 'features local-testing\|--features local-testing' . >/dev/null 2>&1; then
  echo "ERROR: unexpected local-testing build invocation found outside the audited security script" >&2
  exit 1
fi

echo "==> Running adversarial Anchor security suite and rebuilding the production artifact"
npm run anchor:security

echo "==> Verifying synchronized Anchor keys"
anchor keys list

echo "==> Running web typecheck"
npm run typecheck

echo "==> Building production web app"
npm run build

echo "==> Final production Anchor rebuild"
anchor build

echo

echo "PRE-FLIGHT PASSED: source/build gates are green for program $PROGRAM_ID"
echo "This does NOT deploy the program and does NOT replace an independent security review."
