-- D6686 (#6686, E6 of #6680): one legacy case for every paid order.
--
-- An order at paid, packet_processing, packet_ready or filed gets one case on
-- track legacy_v1, at the stage its status projects from, with its timeline
-- synthesised from the dates already on the order (kind 'backfill').
-- pending_payment orders get no case. An order with any other status gets no
-- case and is listed in formation_backfill_skips.
--
-- Nothing on incorporations is written. Every statement is guarded by
-- NOT EXISTS or OR IGNORE, so running the file twice changes nothing. The
-- case uid is 'fc_legacy_<order id>', the same uid the Worker's ensureCase
-- uses for an order paid after this ran (services/formationCase.ts).

INSERT OR IGNORE INTO formation_cases
  (uid, user_id, intent, project_id, company_id, track, path, stage, stage_entered_at, waiting_on, revision, created_at, updated_at)
SELECT
  'fc_legacy_' || i.id,
  i.user_id,
  'convert_project',
  i.project_id,
  i.company_id,
  'legacy_v1',
  NULL,
  CASE i.status
    WHEN 'paid' THEN 'paid'
    WHEN 'packet_processing' THEN 'preparing'
    WHEN 'packet_ready' THEN 'ready_to_file'
    WHEN 'filed' THEN 'registered'
  END,
  COALESCE(
    CASE i.status
      WHEN 'paid' THEN i.paid_at
      WHEN 'packet_processing' THEN i.updated_at
      WHEN 'packet_ready' THEN i.packet_ready_at
      WHEN 'filed' THEN i.filed_recorded_at
    END,
    i.updated_at, i.paid_at, i.created_at, datetime('now')),
  CASE i.status WHEN 'filed' THEN 'nobody' ELSE 'hq' END,
  0,
  COALESCE(i.paid_at, i.created_at, datetime('now')),
  datetime('now')
FROM incorporations i
WHERE i.status IN ('paid', 'packet_processing', 'packet_ready', 'filed')
  AND NOT EXISTS (SELECT 1 FROM formation_case_orders o WHERE o.incorporation_id = i.id);

INSERT OR IGNORE INTO formation_case_orders (case_id, incorporation_id)
SELECT c.id, i.id
FROM incorporations i
JOIN formation_cases c ON c.uid = 'fc_legacy_' || i.id
WHERE i.status IN ('paid', 'packet_processing', 'packet_ready', 'filed');

-- The timeline, from the dates the order already carries.
INSERT INTO formation_case_events (case_id, at, actor_user_id, party, kind, from_stage, to_stage, visibility, detail_json)
SELECT c.id, i.paid_at, NULL, 'system', 'backfill', NULL, 'paid', 'hq_only',
       json_object('incorporation_id', i.id, 'source', 'paid_at')
FROM incorporations i
JOIN formation_cases c ON c.uid = 'fc_legacy_' || i.id
WHERE i.status IN ('paid', 'packet_processing', 'packet_ready', 'filed')
  AND i.paid_at IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM formation_case_events e WHERE e.case_id = c.id AND e.to_stage = 'paid');

INSERT INTO formation_case_events (case_id, at, actor_user_id, party, kind, from_stage, to_stage, visibility, detail_json)
SELECT c.id, i.packet_ready_at, i.packet_ready_by, 'hq', 'backfill', NULL, 'ready_to_file', 'hq_only',
       json_object('incorporation_id', i.id, 'source', 'packet_ready_at', 'document_id', i.packet_document_id)
FROM incorporations i
JOIN formation_cases c ON c.uid = 'fc_legacy_' || i.id
WHERE i.status IN ('packet_ready', 'filed')
  AND i.packet_ready_at IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM formation_case_events e WHERE e.case_id = c.id AND e.to_stage = 'ready_to_file');

INSERT INTO formation_case_events (case_id, at, actor_user_id, party, kind, from_stage, to_stage, visibility, detail_json)
SELECT c.id, i.filed_recorded_at, i.filed_by, 'hq', 'backfill', NULL, 'registered', 'hq_only',
       json_object('incorporation_id', i.id, 'source', 'filed_recorded_at', 'filed_on', i.filed_on)
FROM incorporations i
JOIN formation_cases c ON c.uid = 'fc_legacy_' || i.id
WHERE i.status = 'filed'
  AND i.filed_recorded_at IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM formation_case_events e WHERE e.case_id = c.id AND e.to_stage = 'registered');

-- The report: orders whose status is none of the five, which get no case.
INSERT OR IGNORE INTO formation_backfill_skips (incorporation_id, status)
SELECT i.id, i.status
FROM incorporations i
WHERE i.status IS NULL
   OR i.status NOT IN ('pending_payment', 'paid', 'packet_processing', 'packet_ready', 'filed');
