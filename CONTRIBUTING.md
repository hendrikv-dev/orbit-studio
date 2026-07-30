# Contributing

Thanks for your interest in Orbit Studio. Issues and pull requests are welcome as proposals, but
the official repository, roadmap, releases, and product direction remain under maintainer control.
Submitting a change does not grant write access or guarantee acceptance.

## Required Workflow

Before working in this repository, read:

- [`AGENTS.md`](AGENTS.md), the canonical engineering lifecycle and completion standard;
- [`docs/ORBIT_CONSTITUTION.md`](docs/ORBIT_CONSTITUTION.md), the canonical product principles.

This guide adds contribution-specific setup and repository boundaries. It does not replace either
canonical document.

## Development Setup

```sh
nvm use
npm ci
npm run dev
```

The supported toolchain is pinned in `.nvmrc`, `.npmrc`, and `package.json`. Do not regenerate the
lockfile with a different Node or npm version.

The common application validation commands are:

```sh
npm run build
npm test
npm run review
```

Release candidates additionally run `npm run release:verify` after review generation from a clean
commit. That command is not expected to pass while ordinary development changes are uncommitted.

Which gates apply, and the required investigation, runtime verification, adversarial review, failure
handling, and reporting around them, are defined in `AGENTS.md`. If a change affects a reviewed
workflow, update or add its deterministic scenario in `scripts/review/scenarios/` and verify the
generated package. See `docs/UX_REVIEW_PIPELINE.md`.

## Repository Boundaries

- Keep pull requests focused and scoped to one behavior or maintenance task.
- Do not commit credentials, `.env` files, raw Space-Track exports, temporary screenshots, build
  output, or dependency folders.
- Treat generated catalog artifacts and third-party imagery as data with separate upstream terms.
  Confirm redistribution rights before adding or refreshing data artifacts in public branches.
- Use TypeScript and the existing React component patterns.
- Consult `docs/CODEBASE_GUIDE.md` and `docs/ARCHITECTURE_DECISIONS.md` for current ownership and
  architecture. Confirm active imports rather than treating directory names as permanent policy.

## Reporting Issues

When reporting a bug, include:

- What you expected to happen.
- What happened instead.
- Steps to reproduce.
- Browser and operating system, if the issue is visual or interactive.
- Any relevant console output or failing command output.
