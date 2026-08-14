#!/usr/bin/env bash
set -euo pipefail

# The production program intentionally has no local-testing feature. Keep this
# security command deterministic: format, build the exact production artifact,
# and compile its Rust test target without deploying anything.
cargo fmt --check
anchor build
cargo test -p orbs_protocol

if grep -RIn --include='*.rs' 'is_on_curve()' programs/orbs_protocol >/dev/null 2>&1; then
  echo "ERROR: unsupported on-chain Pubkey::is_on_curve() call found" >&2
  exit 1
fi

echo "Anchor production build/security compile passed."
