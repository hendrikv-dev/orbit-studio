#!/bin/zsh
set -euo pipefail
cd "$(dirname "$0")/../.."

BRANCH="${1:-integrate-release-candidate}"
REMOTE="origin"

echo "Orbit Studio — verify and push"
echo "Repository: $PWD"
echo "Branch: $BRANCH"

if [[ ! -d .git ]]; then
  echo "ERROR: This script must remain inside the Orbit Studio repository."
  exit 1
fi

current_branch="$(git branch --show-current)"
if [[ "$current_branch" != "$BRANCH" ]]; then
  echo "ERROR: Current branch is '$current_branch'; expected '$BRANCH'."
  exit 1
fi

dirty="$(git status --porcelain | grep -v '^ M data/satellite-source-of-truth/data/orbit-studio-satellites.sqlite$' || true)"
if [[ -n "$dirty" ]]; then
  echo "ERROR: Commit the intended changes before pushing. Working tree is not clean."
  print -r -- "$dirty"
  exit 1
fi

git fetch "$REMOTE" "$BRANCH"
if ! git merge-base --is-ancestor "$REMOTE/$BRANCH" HEAD; then
  echo "ERROR: Local branch is not a clean fast-forward from $REMOTE/$BRANCH."
  exit 1
fi

npm ci
npm run build
npm test
npm run satellites:verify
npm run release:verify

echo "All checks passed. Pushing $BRANCH..."
git push "$REMOTE" "$BRANCH"
echo "Push complete."
