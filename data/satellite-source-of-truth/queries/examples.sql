-- Orbit Studio satellite source-of-truth examples

-- 1. Dense default public Earth population.
SELECT object_class, COUNT(*) AS objects
FROM snapshot_present_earth_objects
GROUP BY object_class
ORDER BY objects DESC;

-- 2. Spacecraft/payloads only.
SELECT jcat, satcat_number, name, launch_year, owner_code, perigee_km, apogee_km, inclination_deg
FROM snapshot_present_earth_objects
WHERE object_class = 'payload'
ORDER BY launch_year, jcat;

-- 3. Population present at the end of 1990.
SELECT o.object_class, COUNT(*) AS objects
FROM yearly_presence y
JOIN objects o USING (jcat)
WHERE y.year = 1990
  AND y.present_at_period_end = 1
GROUP BY o.object_class
ORDER BY objects DESC;

-- 4. Objects that appeared during a year.
SELECT o.jcat, o.name, o.object_class, o.launch_date_raw, o.separation_date_raw
FROM yearly_presence y
JOIN objects o USING (jcat)
WHERE y.year = 1957
  AND y.appeared_during_period = 1
ORDER BY o.jcat;

-- 5. Rendering inputs with explicit reconstruction provenance.
SELECT
  jcat,
  name,
  object_class,
  semi_major_axis_km,
  eccentricity,
  inclination_deg,
  raan_deg_reconstructed,
  argument_of_perigee_deg_reconstructed,
  mean_anomaly_deg_reconstructed,
  position_accuracy
FROM reconstruction_candidates
LIMIT 100;

-- 6. Review normalization anomalies rather than silently hiding them.
SELECT * FROM quality_issues ORDER BY issue_code, jcat;
