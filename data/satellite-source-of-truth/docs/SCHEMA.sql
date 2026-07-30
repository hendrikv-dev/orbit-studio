CREATE INDEX idx_objects_class ON objects(object_class);

CREATE INDEX idx_objects_decay_year ON objects(decay_year);

CREATE INDEX idx_objects_launch_year ON objects(launch_year);

CREATE INDEX idx_objects_satcat ON objects(satcat_number);

CREATE INDEX idx_objects_snapshot_earth ON objects(snapshot_earth_present, object_class);

CREATE INDEX idx_yearly_presence_class_year ON yearly_presence(year, object_class);

CREATE INDEX idx_yearly_presence_jcat ON yearly_presence(jcat);

CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE objects (
            jcat TEXT PRIMARY KEY,
            satcat_number TEXT,
            launch_tag TEXT,
            piece TEXT,
            object_class TEXT NOT NULL CHECK(object_class IN ('payload','rocket_body','component','debris','unknown','spurious')),
            type_raw TEXT,
            name TEXT,
            payload_name TEXT,
            launch_date_raw TEXT,
            launch_date_iso TEXT,
            launch_date_precision TEXT,
            launch_date_uncertain INTEGER NOT NULL,
            launch_year INTEGER,
            separation_date_raw TEXT,
            separation_date_iso TEXT,
            separation_date_precision TEXT,
            separation_date_uncertain INTEGER NOT NULL,
            separation_year INTEGER,
            appearance_year INTEGER,
            decay_date_raw TEXT,
            decay_date_iso TEXT,
            decay_date_precision TEXT,
            decay_date_uncertain INTEGER NOT NULL,
            decay_year INTEGER,
            interval_end_year INTEGER,
            interval_anomaly TEXT,
            primary_body TEXT,
            status_raw TEXT,
            destination_raw TEXT,
            owner_code TEXT,
            state_code TEXT,
            manufacturer TEXT,
            bus TEXT,
            motor TEXT,
            mass_kg REAL,
            dry_mass_kg REAL,
            total_mass_kg REAL,
            length_m REAL,
            diameter_m REAL,
            span_m REAL,
            shape_raw TEXT,
            orbit_epoch_raw TEXT,
            orbit_epoch_iso TEXT,
            orbit_epoch_precision TEXT,
            orbit_epoch_uncertain INTEGER NOT NULL,
            perigee_km REAL,
            apogee_km REAL,
            inclination_deg REAL,
            orbit_class_raw TEXT,
            orbit_quality_raw TEXT,
            alternate_names_raw TEXT,
            snapshot_present INTEGER NOT NULL,
            snapshot_earth_present INTEGER NOT NULL,
            reconstruction_candidate INTEGER NOT NULL,
            source_snapshot_updated_at TEXT NOT NULL,
            source_row_number INTEGER NOT NULL,
            source_row_sha256 TEXT NOT NULL,
            FOREIGN KEY(jcat) REFERENCES source_rows(jcat)
        ) WITHOUT ROWID
    ;

CREATE TABLE quality_issues (
            issue_id INTEGER PRIMARY KEY,
            jcat TEXT,
            issue_code TEXT NOT NULL,
            details TEXT NOT NULL
        );

CREATE TABLE reconstruction_parameters (
            jcat TEXT PRIMARY KEY,
            satcat_number TEXT,
            name TEXT,
            object_class TEXT NOT NULL,
            source_perigee_km REAL NOT NULL,
            source_apogee_km REAL NOT NULL,
            source_inclination_deg REAL NOT NULL,
            source_orbit_epoch_raw TEXT,
            semi_major_axis_km REAL NOT NULL,
            eccentricity REAL NOT NULL,
            inclination_deg REAL NOT NULL,
            raan_deg_reconstructed REAL NOT NULL,
            argument_of_perigee_deg_reconstructed REAL NOT NULL,
            mean_anomaly_deg_reconstructed REAL NOT NULL,
            estimated_period_minutes REAL NOT NULL,
            deterministic_seed_sha256 TEXT NOT NULL,
            membership_provenance TEXT NOT NULL,
            orbit_shape_provenance TEXT NOT NULL,
            orbital_angles_provenance TEXT NOT NULL,
            position_accuracy TEXT NOT NULL,
            reconstruction_version TEXT NOT NULL,
            FOREIGN KEY(jcat) REFERENCES objects(jcat)
        ) WITHOUT ROWID
    ;

CREATE TABLE source_rows ("jcat" TEXT, "satcat" TEXT, "launch_tag" TEXT, "piece" TEXT, "type" TEXT, "name" TEXT, "plname" TEXT, "ldate" TEXT, "parent" TEXT, "sdate" TEXT, "primary" TEXT, "ddate" TEXT, "status" TEXT, "dest" TEXT, "owner" TEXT, "state" TEXT, "manufacturer" TEXT, "bus" TEXT, "motor" TEXT, "mass" TEXT, "mass_flag" TEXT, "dry_mass" TEXT, "dry_flag" TEXT, "tot_mass" TEXT, "tot_flag" TEXT, "length" TEXT, "lflag" TEXT, "diameter" TEXT, "dflag" TEXT, "span" TEXT, "span_flag" TEXT, "shape" TEXT, "odate" TEXT, "perigee" TEXT, "pf" TEXT, "apogee" TEXT, "af" TEXT, "inc" TEXT, "if" TEXT, "op_orbit" TEXT, "oqual" TEXT, "alt_names" TEXT, PRIMARY KEY ("jcat")) WITHOUT ROWID;

CREATE TABLE sqlite_stat1(tbl,idx,stat);

CREATE TABLE yearly_presence (
            year INTEGER NOT NULL,
            period_end_date TEXT NOT NULL,
            is_partial_year INTEGER NOT NULL,
            jcat TEXT NOT NULL,
            object_class TEXT NOT NULL,
            appeared_during_period INTEGER NOT NULL,
            ended_during_period INTEGER NOT NULL,
            present_any_time_during_period INTEGER NOT NULL,
            present_at_period_end INTEGER NOT NULL,
            PRIMARY KEY(year, jcat),
            FOREIGN KEY(jcat) REFERENCES objects(jcat)
        ) WITHOUT ROWID
    ;

CREATE VIEW payloads AS
        SELECT * FROM objects WHERE object_class = 'payload';

CREATE VIEW reconstruction_candidates AS
        SELECT
            o.*,
            r.semi_major_axis_km,
            r.eccentricity,
            r.raan_deg_reconstructed,
            r.argument_of_perigee_deg_reconstructed,
            r.mean_anomaly_deg_reconstructed,
            r.estimated_period_minutes,
            r.deterministic_seed_sha256,
            r.membership_provenance,
            r.orbit_shape_provenance,
            r.orbital_angles_provenance,
            r.position_accuracy,
            r.reconstruction_version
        FROM objects o
        JOIN reconstruction_parameters r USING (jcat)
        WHERE o.reconstruction_candidate = 1;

CREATE VIEW snapshot_present_earth_objects AS
        SELECT * FROM objects
        WHERE snapshot_earth_present = 1 AND object_class <> 'spurious';

CREATE VIEW snapshot_present_objects AS
        SELECT * FROM objects WHERE snapshot_present = 1 AND object_class <> 'spurious';

CREATE VIEW yearly_totals AS
        SELECT
            year,
            period_end_date,
            is_partial_year,
            object_class,
            SUM(appeared_during_period) AS appeared_count,
            SUM(ended_during_period) AS ended_count,
            SUM(present_any_time_during_period) AS present_any_time_count,
            SUM(present_at_period_end) AS present_at_period_end_count
        FROM yearly_presence
        GROUP BY year, period_end_date, is_partial_year, object_class;
