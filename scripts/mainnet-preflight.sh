#!/usr/bin/env bash
set -euo pipefail

PROGRAM_ID="464cqCX4vMoQFjeuVinz3R6ccrFz68WqEkSvFSGg7Fns"
TREASURY="5mEqxr6McBRL5DGE9dJ2Td3viwhAmRpe4V7pqGTPMtvr"
RELAYER="GMpmAw9JDKhJHo6umea4BsfLHVSqBYXPvv8hTU4t84vN"
PROGRAM_RS="programs/orbs_protocol/src/lib.rs"

for tool in anchor solana cargo node npm; do
  command -v "$tool" >/dev/null 2>&1 || { echo "ERROR: required tool '$tool' is not installed" >&2; exit 1; }
done

grep -q "declare_id!(\"$PROGRAM_ID\")" "$PROGRAM_RS" || { echo "ERROR: deployed program id is not present in lib.rs" >&2; exit 1; }
grep -q "$PROGRAM_ID" Anchor.toml || { echo "ERROR: Anchor.toml does not contain the deployed program id" >&2; exit 1; }
grep -q "$TREASURY" "$PROGRAM_RS" || { echo "ERROR: treasury identity mismatch" >&2; exit 1; }
grep -q "$RELAYER" "$PROGRAM_RS" || { echo "ERROR: relayer identity mismatch" >&2; exit 1; }

for required in NEXT_PUBLIC_SOLANA_RPC_URL HELIUS_RPC_URL ORBS_RELAYER_SECRET_KEY TURNKEY_ORGANIZATION_ID TURNKEY_API_PUBLIC_KEY TURNKEY_API_PRIVATE_KEY TURNKEY_CLAIM_PRIVATE_KEY_ID TURNKEY_CLAIM_ADDRESS; do
  if [ -z "${!required:-}" ]; then
    echo "ERROR: required production environment variable $required is not set" >&2
    exit 1
  fi
done

if [ -n "${ORBS_PROGRAM_ID:-}" ] && [ "$ORBS_PROGRAM_ID" != "$PROGRAM_ID" ]; then echo "ERROR: ORBS_PROGRAM_ID mismatch" >&2; exit 1; fi
if [ -n "${NEXT_PUBLIC_ORBS_PROGRAM_ID:-}" ] && [ "$NEXT_PUBLIC_ORBS_PROGRAM_ID" != "$PROGRAM_ID" ]; then echo "ERROR: NEXT_PUBLIC_ORBS_PROGRAM_ID mismatch" >&2; exit 1; fi

node <<'NODE'
const {Keypair, PublicKey} = require('@solana/web3.js');
const expectedRelayer = new PublicKey('GMpmAw9JDKhJHo6umea4BsfLHVSqBYXPvv8hTU4t84vN');
const expectedClaim = new PublicKey('8aFRPMXaRwpMXErsRALq9eaa71ZvvB3fsuYpC8o5zFuk');
const bs58 = require('bs58').default ?? require('bs58');
const relayerRaw = String(process.env.ORBS_RELAYER_SECRET_KEY || '').trim();
let relayerBytes;
if (relayerRaw.startsWith('[')) {
  relayerBytes = Uint8Array.from(JSON.parse(relayerRaw));
} else {
  relayerBytes = bs58.decode(relayerRaw);
}
const relayer =
  relayerBytes.length === 64
    ? Keypair.fromSecretKey(relayerBytes)
    : relayerBytes.length === 32
      ? Keypair.fromSeed(relayerBytes)
      : (() => { throw new Error(`ORBS_RELAYER_SECRET_KEY decoded to ${relayerBytes.length} bytes`); })();
if (!relayer.publicKey.equals(expectedRelayer)) throw new Error('ORBS_RELAYER_SECRET_KEY public key mismatch');
if (!new PublicKey(process.env.TURNKEY_CLAIM_ADDRESS).equals(expectedClaim)) throw new Error('TURNKEY_CLAIM_ADDRESS mismatch');
NODE

npm run anchor:security
npm run typecheck
npm run build

echo "PRE-FLIGHT PASSED for $PROGRAM_ID"
