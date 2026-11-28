-- D9026 (#9026): where each program grant's schedule envelope is read from, once, from the canonical agreement rows.
--
-- D5048 §5 kept `program_grants.schedule_contract_uid` as the read-through for the schedule's envelope "until its
-- callers move". This view is where they move to: the grant routes, the grant read, the branch copy and the
-- completion guard all read `envelope_uuid` here (services/programAgreements.ts `scheduleEnvelopes`,
-- services/programSchedule.ts), and no Worker file reads the column any more.
--
-- THE RULE. A grant's schedule envelope is its NEWEST `licence_program_agreements` version of kind
-- `program_schedule` (by id), when that version is still the grant's:
--   sent, partially signed or executed   its envelope;
--   voided                               its envelope, unless the D4805 schedule row for that envelope was
--                                        superseded by a terms change (a void envelope stays named until the
--                                        schedule is sent again or the terms move, as the column did);
--   superseded                           none: the terms changed or the grant was granted again.
-- That is what the column holds on every path that writes both in one batch (send, resend, terms change,
-- re-grant, completion), and on every grant D5048's backfill reached.
--
-- THE LEGACY FALLBACK. A grant with no schedule version at all reads the column, so a row written outside those
-- paths (none should exist after D5048's backfill) still reads as it did. This is the one place the column is
-- read. The drop migration that retires the column re-runs D5048's column-only backfill first, then replaces
-- this view without the fallback (D9026 §4).
--
-- Additive: a view, no table change. The Worker one version back does not read it.
CREATE VIEW IF NOT EXISTS program_grant_schedule_envelopes AS
  SELECT g.id AS grant_id,
         CASE WHEN EXISTS (SELECT 1 FROM licence_program_agreements a0
                            WHERE a0.program_grant_id = g.id AND a0.agreement_kind = 'program_schedule')
              THEN (SELECT a.envelope_uuid FROM licence_program_agreements a
                     WHERE a.id = (SELECT MAX(n.id) FROM licence_program_agreements n
                                    WHERE n.program_grant_id = g.id AND n.agreement_kind = 'program_schedule')
                       AND (a.status IN ('sent', 'partially_signed', 'executed')
                            OR (a.status = 'voided'
                                AND NOT EXISTS (SELECT 1 FROM program_grant_schedules s
                                                 WHERE s.envelope_uuid = a.envelope_uuid AND s.superseded_at IS NOT NULL))))
              ELSE g.schedule_contract_uid
         END AS envelope_uuid,
         CASE WHEN EXISTS (SELECT 1 FROM licence_program_agreements a1
                            WHERE a1.program_grant_id = g.id AND a1.agreement_kind = 'program_schedule')
              THEN 'agreement' ELSE 'legacy_column'
         END AS source
    FROM program_grants g;
