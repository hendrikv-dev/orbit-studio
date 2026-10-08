# Fragmentation causes — provenance

## What this is

`nasa-hoosf-16e-causes.csv` is the **assessed cause** column of NASA's standing
reference on satellite break-ups, extracted so Orbit Studio can say *why* an
object fragmented. GCAT — the source for everything else in the catalog —
records parentage and separation dates but has no cause field, so cause is the
one fact in the debris view that cannot come from the primary source.

This is therefore a **curated reference** layer. It is attributed separately, it
never overwrites a GCAT value, and it is absent for most events.

## Source

| | |
|---|---|
| Title | *History of On-orbit Satellite Fragmentations*, 16th Edition |
| Report number | NASA/TP-20220019160 |
| Authors | Phillip Anz-Meador, John Opiela (Jacobs); Jer-Chyi Liou (NASA JSC) |
| Publisher | NASA Orbital Debris Program Office, Lyndon B. Johnson Space Center |
| Published | December 2022 |
| Retrieved | 2026-08-13 from <https://orbitaldebris.jsc.nasa.gov/library/hoosf_16e.pdf> |
| PDF SHA-256 | `3c82039474625f321a1ed12556adbb8ea62ce149e1f052b8a41e81ba5914a61b` |
| Rights | Work of the U.S. Government, prepared by NASA. Not subject to copyright protection in the United States. |

Only the factual cause assessment is taken. No text, figure, or table layout
from the document is reproduced.

## What was extracted, and what was deliberately not

**Taken:** international designator, NORAD catalogue number, break-up date,
assessed cause.

**Not taken:** the document's `DEBRIS CATALOGED` and `DEBRIS LEFT` counts, other
than for auditing. Those are correct as of December 2022 and would contradict
the GCAT snapshot — Kosmos-1408 shows 990 fragments remaining in the report and
7 in the 2026-06-27 GCAT snapshot. Both are right for their epoch. Mixing them
would produce a view that is wrong for every epoch, so fragment counts always
come from GCAT and the cause always comes from here.

## Assessed-cause values

`PROPULSION` (103) · `UNKNOWN` (70) · `DELIBERATE` (49) · `BATTERY` (11) ·
`COLLISION, DELIBERATE` (8) · `COLLISION, ACCIDENTAL` (7) — 248 events.

`UNKNOWN` is a NASA assessment meaning *investigated and undetermined*. It is
not the same as an event this table does not cover, and the two must never be
merged in the interface.

## Extraction method and its limits

Text extracted from the PDF, then the break-up table parsed on record
boundaries. The cause value wraps across lines in the source
(`COLLISION,\nACCIDENTAL`), so a line-oriented parse silently drops precisely
the collision events; the parser reads between record anchors instead. The table
appears twice in the document — ordered by launch date and by break-up date —
so rows are de-duplicated on (NORAD number, break-up date).

**Known limitation:** the parse recovers 248 events, which is not claimed to be
every break-up the document describes. Events it misses are absent rather than
wrong, and absence is rendered as "not assessed in this edition".

**Publication cutoff:** the 16th edition predates later events. The two
Long March 6A upper-stage break-ups (2022-11-12, 793 fragments; 2024-08-06, 705
fragments) are the largest events with no cause here for that reason.

## Join

Joined to GCAT on NORAD catalogue number **and** exact break-up date. A cause is
attached only when both match, so a parent that fragmented more than once never
inherits the wrong event's cause. Current result: 198 of 1,034 GCAT
fragmentation events (19.1%), covering 22,078 of 27,681 debris objects (79.8%).

## Regenerating

```
npm run fragmentation:build
```

Reads this CSV and the web catalog, and writes
`src/data/generated/fragmentationCauses.json`. Re-extracting from a new edition
means replacing the CSV and updating the source block above.
