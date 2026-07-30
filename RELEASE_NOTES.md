# Orbit Studio 0.2.2 Release Candidate

This source package integrates the approved Orbit Studio homepage into the current Explorer and Playground project without replacing or duplicating the existing application architecture.

## Homepage

- Uses the approved Orbit Studio, Explorer, and Playground logo assets.
- Uses the approved centered-Earth Explorer and Playground images.
- Keeps the two environment cards side by side on desktop and tablet landscape, with stable contained images on the right.
- Introduces the platform once with **Welcome to Orbit Studio** and concise, non-repetitive copy.
- Includes factual About, documentation, data, source, issue-reporting, and donation sections below the fold.
- Links donations directly to a hosted provider through `VITE_SUPPORT_URL`; no payment form or separate support page is included.
- Hides donation actions when no verified provider URL is configured.

## Preserved application work

- Explorer and Playground remain the two current apps within the Orbit Studio platform.
- The shared ellipsis menu, interface hide/show behavior, neutral `Satellite 1` Playground start, scene remounting, catalog data, renderer, and app routes are unchanged.
- Obsolete homepage captures were removed rather than carried forward.

## Validation required before publishing

```sh
npm ci
npm test
npm run build
npm run release:verify
```

Complete `docs/RELEASE_CHECKLIST.md` on the target Mac and configure a real `VITE_SUPPORT_URL` before advertising donations.
