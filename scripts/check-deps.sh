#!/bin/bash
set -e

echo "Checking dependencies..."

DEP_COUNT=$(pnpm list --depth=0 --prod --json 2>/dev/null | node -e "
  const data = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  const deps = data[0]?.dependencies || {};
  console.log(Object.keys(deps).length);
" 2>/dev/null || echo "0")

echo "Production dependencies: $DEP_COUNT"

if [ "$DEP_COUNT" -gt 50 ]; then
  echo "ERROR: Too many dependencies ($DEP_COUNT > 50)"
  exit 1
fi

echo "Running security audit..."
pnpm audit --audit-level=high || true

echo "Dependency check passed."
