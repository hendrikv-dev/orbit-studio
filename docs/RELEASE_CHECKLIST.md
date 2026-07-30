# Release Checklist

Use this checklist for a public Orbit Studio release candidate.

## Source hygiene

- [ ] Working tree contains no `node_modules`, caches, local catalogs, credentials, or old ZIP handoffs.
- [ ] No duplicate generated review archives are packaged.
- [ ] Approved brand assets and current app captures are present.
- [ ] `npm run release:verify` passes from the exact source revision being released.
- [ ] `npm run source:archive` creates the public source archive.

## Runtime

- [ ] Root URL opens the homepage.
- [ ] Explorer and Playground launch from the homepage.
- [ ] Direct app query URLs work.
- [ ] Shared ellipsis menu labels render in both apps.
- [ ] App switching does not leak selected objects or produce a blank renderer.
- [ ] Playground starts with `Satellite 1` and a fully visible orbit.
- [ ] Hide interface and Show interface work in both apps; Escape restores the interface.
- [ ] Both homepage cards appear side by side on desktop and tablet landscape; phone layouts stack without horizontal overflow.
- [ ] Homepage preview images are the approved centered-Earth captures, remain to the right of the copy, use contained framing, and do not zoom, tint, shift, or recrop on hover.
- [ ] The homepage introduces the platform once with `Welcome to Orbit Studio`; each app is described only within its own card.
- [ ] When `VITE_SUPPORT_URL` is configured, both Support and Donate open the verified hosted provider. When it is unset, neither dead action is rendered.
- [ ] No internal donation form or support route was added.

## Quality

- [ ] `npm test` passes.
- [ ] `npm run build` passes.
- [ ] Browser console contains no new errors or unexplained warnings.
- [ ] Keyboard focus and menu dismissal work.
- [ ] Mobile layout remains usable without horizontal overflow.
- [ ] Catalog source, reconstruction, and attribution language remains accurate.

## Documentation

- [ ] README describes the current platform and setup accurately.
- [ ] Changelog records user-visible changes.
- [ ] `docs/MAINTAINER_HANDOFF.md` matches the current implementation.
- [ ] Attribution and third-party notices are current.
