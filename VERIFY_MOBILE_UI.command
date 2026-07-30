#!/bin/zsh
set -euo pipefail
cd "${0:A:h}"
print "Orbit Studio mobile UI verification"
print "Branch: $(git branch --show-current 2>/dev/null || print unknown)"

npm ci
npm run build

if ! grep -Eq 'src="/assets/[^\"]+\.js"' dist/index.html; then
  print -u2 "Production verification failed: dist/index.html does not reference a hashed /assets JavaScript bundle."
  exit 1
fi

npx vitest run --run src/lib/playgroundIsolation.test.ts src/data/explorerStudioHandoff.test.ts

print ""
print "Build and isolation tests passed. Review the mobile interface before committing."
print "Suggested commit: feat: simplify mobile Explorer controls"
