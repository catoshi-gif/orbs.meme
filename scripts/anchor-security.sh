#!/usr/bin/env bash
set -u

# Integration tests use deterministic local-only identities and shortened timing.
# Always rebuild the default production artifact afterward, even when tests fail,
# so target/deploy cannot accidentally be left holding a local-testing binary.
anchor build -- --features local-testing
build_status=$?
if [ "$build_status" -ne 0 ]; then
  anchor build
  exit "$build_status"
fi

(
  cd anchor-tests
  if [ ! -d node_modules ]; then npm install; fi
)
install_status=$?
if [ "$install_status" -eq 0 ]; then
  anchor test --skip-build
  test_status=$?
else
  test_status=$install_status
fi

anchor build
production_build_status=$?
if [ "$production_build_status" -ne 0 ]; then
  exit "$production_build_status"
fi
exit "$test_status"
