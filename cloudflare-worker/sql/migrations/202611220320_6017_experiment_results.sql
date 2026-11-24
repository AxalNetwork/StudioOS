-- D6017: V9 stopped and observed result metadata; legacy results retain unknown dates/directions.
ALTER TABLE hypothesis_experiments ADD COLUMN stopped_at TEXT;
ALTER TABLE hypothesis_experiments ADD COLUMN result_recorded_at TEXT;
ALTER TABLE hypothesis_experiments ADD COLUMN result_direction TEXT CHECK (result_direction IS NULL OR result_direction IN ('supports', 'contradicts', 'inconclusive'));
