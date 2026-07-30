#!/bin/zsh
set -euo pipefail
cd "$(dirname "$0")"

if [[ ! -d .git ]]; then
  echo "Run this from the root of the cloned orbit-studio Git repository."
  read -r "?Press Return to close."
  exit 1
fi

branch="$(git branch --show-current)"
if [[ -z "$branch" ]]; then
  echo "No active Git branch."
  read -r "?Press Return to close."
  exit 1
fi

if [[ "$branch" == "main" ]]; then
  echo "Refusing to push directly to main. Switch to the release-candidate branch first."
  read -r "?Press Return to close."
  exit 1
fi

echo "Orbit Studio Playground isolation fix"
echo "Branch: $branch"
echo

npm ci
npm run build

if grep -q '/src/main.tsx' dist/index.html; then
  echo "Build verification failed: dist/index.html still references /src/main.tsx"
  exit 1
fi

if ! grep -q '/assets/' dist/index.html; then
  echo "Build verification failed: no hashed /assets/ entry in dist/index.html"
  exit 1
fi

npm test -- --run src/lib/playgroundIsolation.test.ts src/data/explorerStudioHandoff.test.ts

git add -A
if git diff --cached --quiet; then
  echo "No changes to commit."
else
  git commit -m "fix: isolate Playground from Explorer catalog state"
fi

git push origin "$branch"
echo
echo "Pushed $branch. Netlify can now rebuild this branch."
read -r "?Press Return to close."
