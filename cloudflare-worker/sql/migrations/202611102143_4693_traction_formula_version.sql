-- Keep the recorded score and its original scale. Only backfill version metadata.
ALTER TABLE metrics_snapshots ADD COLUMN traction_formula_version INTEGER;

UPDATE metrics_snapshots
   SET traction_formula_version = CASE
     WHEN json_valid(key_metrics) THEN
       CASE WHEN json_type(key_metrics, '$._traction_formula') = 'integer'
                  AND json_extract(key_metrics, '$._traction_formula') >= 1
            THEN json_extract(key_metrics, '$._traction_formula') ELSE 1 END
     ELSE 1 END
 WHERE traction_score IS NOT NULL;
