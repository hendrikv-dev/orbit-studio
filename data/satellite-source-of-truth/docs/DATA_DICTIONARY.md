# Data Dictionary

## Core database

`data/orbit-studio-satellites.sqlite`

### `source_rows`

Lossless text representation of every field in the upstream GCAT `satcat` snapshot. Field names are normalized to snake_case, but values are unchanged.

### `objects`

One normalized row per GCAT object.

Key fields:

| Field | Meaning |
|---|---|
| `jcat` | Stable GCAT identifier; primary key. |
| `satcat_number` | Normalized US SATCAT identifier where present. |
| `object_class` | `payload`, `rocket_body`, `component`, `debris`, `unknown`, or `spurious`. |
| `launch_*` | Parsed and raw launch date fields. |
| `separation_*` | Parsed and raw separation/appearance date fields. |
| `appearance_year` | Year used to begin annual membership; separation year when valid, otherwise launch year. |
| `decay_*` | Parsed and raw descent/end date fields. |
| `interval_end_year` | End year used for annual membership after documented anomaly handling. |
| `interval_anomaly` | Non-null only when the source dates require conservative interval handling. |
| `snapshot_present` | No recorded descent/end date in this snapshot. |
| `snapshot_earth_present` | `snapshot_present = 1` and `primary_body = Earth`. |
| `reconstruction_candidate` | Earth-associated present object with source-backed perigee, apogee, and inclination. |
| `source_row_sha256` | Hash of the exact source TSV row. |

### `yearly_presence`

One row per object per year in which the object was present for any part of that period.

| Field | Meaning |
|---|---|
| `year` | Calendar year. |
| `period_end_date` | December 31, except the snapshot year, which ends on the snapshot date. |
| `is_partial_year` | `1` for the snapshot year. |
| `appeared_during_period` | Object's modeled appearance year equals this year. |
| `ended_during_period` | Object's recorded/model-valid end year equals this year. |
| `present_any_time_during_period` | Always `1` for included rows. |
| `present_at_period_end` | Object remained present at the end of the period. |

### `reconstruction_parameters`

Source-backed orbit shape plus deterministic reconstructed angles. These rows are suitable for a dense educational visualization but are not live orbital solutions.

### `quality_issues`

Explicit source/date anomalies encountered during normalization. No anomaly is silently discarded.

## Views

- `snapshot_present_objects`
- `snapshot_present_earth_objects`
- `payloads`
- `reconstruction_candidates`
- `yearly_totals`

## Exchange files

- `objects.csv.gz`: normalized records
- `objects.ndjson.gz`: normalized records for streaming/web tooling
- `snapshot_present_earth_objects.csv.gz`: public Earth population at snapshot
- `yearly_object_presence.csv.gz`: annual membership
- `yearly_summary.csv` and `.json`: annual aggregate counts
- `reconstruction_candidates.csv.gz`: deterministic rendering inputs
- `quality_issues.csv`: normalization anomalies
