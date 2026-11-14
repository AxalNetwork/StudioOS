-- D5676: independent metadata only; raw logs and exact object pointers never leave privileged reads.
CREATE TABLE IF NOT EXISTS cf_archive_batches (
 batch_id TEXT PRIMARY KEY,object_key TEXT NOT NULL,events INTEGER NOT NULL,bytes INTEGER NOT NULL,
 attempt INTEGER NOT NULL,state TEXT NOT NULL,first_ms INTEGER NOT NULL,observed_ms INTEGER NOT NULL,verified_ms INTEGER,lost_events INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_cf_archive_observed ON cf_archive_batches(observed_ms);
CREATE TABLE IF NOT EXISTS cf_archive_canaries (
 marker TEXT PRIMARY KEY,expected_ms INTEGER NOT NULL,due_ms INTEGER NOT NULL,batch_id TEXT,verified_ms INTEGER
);
CREATE INDEX IF NOT EXISTS idx_cf_archive_expected ON cf_archive_canaries(expected_ms);

CREATE TABLE IF NOT EXISTS cf_archive_check_clock (clock_key TEXT PRIMARY KEY,last_ms INTEGER NOT NULL DEFAULT 0);
