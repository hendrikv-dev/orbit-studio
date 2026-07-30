# Playground isolation deploy

This patch fixes the production bug where Playground could inherit Vanguard I or other Explorer catalog objects.

## What changed

- Explorer and Playground now use separate Zustand store instances.
- Playground opens from its own neutral `Satellite 1` scenario.
- Explorer catalog selections cannot populate the Playground selector.
- Direct Playground loads, Home → Playground, Explorer → Playground, and Safari page restoration reassert the Playground boundary.
- The legacy Explorer-to-Playground helper now returns a clean Playground rather than silently importing a catalog object.
- Scenario metadata records whether a scenario belongs to Explorer or Playground.

## Apply

Copy the patch contents into the root of the existing `orbit-studio` Git repository, replacing matching files. Do not replace `.git`.

Then run:

```bash
npm ci
npm run build
npm test -- --run src/lib/playgroundIsolation.test.ts src/data/explorerStudioHandoff.test.ts
```

A correct build must transform the full application and `dist/index.html` must reference `/assets/`, not `/src/main.tsx`.

## Commit and deploy

```bash
git add -A
git commit -m "fix: isolate Playground from Explorer catalog state"
git push origin "$(git branch --show-current)"
```

Netlify should redeploy automatically from the configured branch. Clear its build cache once if the previous broken bundle remains active.

## Acceptance checks

Test all of these in a normal browser and a private/incognito window:

1. Open `/?app=playground` directly: selector shows `Satellite 1` only.
2. Open Explorer, select Vanguard I, then open Playground: selector still shows `Satellite 1` only.
3. Return Home, reopen Playground: selector shows `Satellite 1` only.
4. Reload and open a new browser window: no Explorer catalog objects appear in Playground.
5. Add a satellite in Playground: it remains a Playground-authored object and no catalog list appears.
