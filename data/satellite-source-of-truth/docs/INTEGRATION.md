# Orbit Studio Integration

Recommended repository placement:

```text
data/satellite-source-of-truth/
```

The application build should consume a generated web-optimized artifact from this package, not duplicate the transformation logic in React or renderer code.

## Recommended pipeline

1. Query `snapshot_present_earth_objects` or `yearly_presence`.
2. Join `reconstruction_parameters` for records lacking exact orbit states.
3. Export deterministic chunks grouped by year and/or object class.
4. Retain `jcat`, `object_class`, and provenance fields in every chunk.
5. Validate rendered population counts against the database before release.

## Release gates

- Database verification passes.
- Generated web artifacts reconcile to SQL counts.
- Default view has a substantial visible orbital population.
- Historical years reconcile to `yearly_presence`.
- UI labels reconstruction honestly.
- Attribution is shipped.
- No prohibited source is bundled.

A sample or curated-reference layer may exist for tutorials or search shortcuts, but it must never replace the canonical population.
