# Review guide — session ending `e403a08`

Written because the volume of this session outran what a person can review by
reading a diff. 28 commits, 52 hand-edited files, ~9,500 inserted lines, plus one
regenerated 16 MB data artifact that cannot be read at all.

This is not a summary of what changed. Commit messages already do that. It is a
map of **where a human's judgement is actually required**, and what a machine has
already checked so you do not have to.

---

## 1. Run these first

```
npm run satellites:verify     # re-derives the 16 MB catalog and compares checksums
npx vitest run                # 356 tests
npm run build                 # stricter typecheck than `tsc --noEmit`
npm run provenance:validate   # expect 20 failures, all pre-existing
```

The provenance baseline is **20 failures** and has been all session. They are
unclassified brand and home images, predating this work. Any number other than 20
is a regression.

---

## 2. What a machine has already checked

Do not spend review time re-deriving these. They fail loudly if broken.

| Claim | Enforced by |
|---|---|
| The 16 MB catalog matches its canonical source | `satellites:verify`, sha256 |
| Population totals reconcile: 33,489 = 33,468 + 21, and 33,474 = 33,468 + 6 | `explorerCounts.test.ts` |
| Every GCAT state code in the snapshot has a name | `explorerStateNames.test.ts` |
| No orbital angle is ever reported as measured | `explorerElementProvenance.test.ts` |
| Debris cause is only claimed where NASA assessed that exact break-up | `explorerFragmentationCause.test.ts` |
| Orbital lifetime rises monotonically with altitude | `explorerLifetime.test.ts` |
| Transfer budgets match textbook values | `maneuvers.test.ts` |
| Dependency licences, attribution, bundle contents | `provenance:validate` |

---

## 3. Where human judgement is required

Ordered by consequence if wrong.

### 3.1 Element provenance labelling — **review this first**

`src/data/explorerElementProvenance.ts`, surfaced in the inspector.

Decides whether a student is told a number is fabricated. Every orbital angle in
the catalog is generated, not observed (`latestExactStateCount` is 0), so RAAN,
argument of perigee and true anomaly carry a `reconstructed` badge while the
sourced shape does not.

**The judgement:** is the badge wording right, is the absence of a badge on
sourced values a clear enough signal, and is the fallback correct — an unknown
availability is treated as reconstructed rather than measured. Being wrong here
teaches a student that a fabricated value is a measurement.

### 3.2 The state-code table

`src/data/explorerStateNames.ts` — 123 hand-written mappings.

The test proves every code *has* a name. It cannot prove the name is *right*.
I mapped these from GCAT's conventions, and GCAT is not ISO 3166: `I` is Italy,
`E` is Spain, `SU` and `RU` are deliberately different states. Worth a skim by
someone who knows the catalog. `J` was missing until the coverage test caught it.

### 3.3 Ranking and framing choices

Judgement calls with no correct answer, only a defensible one:

- Debris list default sorts by **fragments still in orbit**, not fragments produced
- "Share remaining" ignores break-ups under 25 fragments
- Lifetime bands use **fragment median perigee**, not the parent's
- Search shows the **10** highest-ranked of N matches

### 3.4 Copy

~1,400 lines of stylesheet and a great deal of prose changed. The audit found
mixed British/American spelling and a repeated rhetorical tic; both were fixed,
but nobody has read the result end to end.

---

## 4. What is deliberately not reviewable by reading

`src/data/generated/satelliteCatalog.web.json`, 16 MB. Diffing it is pointless.
It is produced by `scripts/build-satellite-web-catalog.py` from a checksummed
SQLite package. **Review the script, not the output**, then run
`satellites:verify`. Three columns were added this session: `parentJcat`,
`separationDatePrecision`/`Uncertain`, and `stateCode`.

---

## 5. Known-open, by decision rather than oversight

- **HYG v4.1 is CC BY-SA 4.0** — the only ShareAlike dependency. Commercial use
  permitted; adaptations inherit the licence. Tracker's PRD depends on it.
- Isp hardcoded at 320 s in `maneuvers.ts` (no UI currently uses it)
- No TLE or element ingest anywhere
- Population scatter's inclination axis is occluded by the inspector
- Ground-station pass rates are computed for debris fragments
- "Hubble" returns two Lemur-2 satellites below the correct hit

---

## 6. The honest limitation

356 tests prove the system is **self-consistent**. They do not prove it is
**correct**, because the same agent wrote both the code and the tests.

Every genuinely wrong thing this session was caught by a human looking at the
screen, or by comparison against an outside published source — never by the
suite:

- a sky chart mirrored east-for-west, under a comment warning about that error
- lifetime bands keyed to the parent's altitude when fragments decide the outcome
- an inspector showing one object beside a panel describing another
- three population totals that were each correct and collectively baffling
- a "search relevance bug" that was correct behaviour I had misdiagnosed

The suite is a regression net, not a correctness proof. Treat §3 as the review,
and the tests as the thing that stops §3 silently changing later.
