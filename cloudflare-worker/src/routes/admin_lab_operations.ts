/** D971 (#2756): read-only Lab settings and one filtered, paged history.
 * Mounted by admin_cohort at /api/admin/cohort. No bootstrap or read-time writes.
 * Staff identities and free-form audit payloads never enter the public projection.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin } from '../auth';
import { readCohortSizeSettings } from '../services/cohortApplications';
import { LAB_PARTICIPANT_IDS } from '../services/labParticipants';
import { mapError } from './_t13t14t15_helpers';

const r = new Hono<{ Bindings: Env }>();
r.onError((e, c) => mapError(c, e));

r.get('/settings', async (c) => {
  await requireAdmin(c);
  const settings = await readCohortSizeSettings(c.env);
  if (!settings) return c.json({ error: 'The cohort size could not be read. Try again.' }, 503);
  return c.json({ settings });
});

// Safe, fixed summaries: legacy reasons can contain staff names. Interview rows
// and stage transitions are identified as records, never invented event history.
const HISTORY = `WITH history AS (
  SELECT 'cycle:' || e.id AS id, e.created_at AS at,
    CASE WHEN e.event_type LIKE 'applicant_%' THEN 'decisions' ELSE 'cohort' END AS type,
    e.event_type AS event, c.year || '-' || printf('%02d', c.month) AS cohort,
    NULL AS about, CASE WHEN e.actor = 'scheduler' THEN 'clock' ELSE 'admin' END AS by,
    'Recorded cohort event' AS detail, NULL AS scheduled_at
    FROM cohort_cycle_events e LEFT JOIN cohort_cycles c ON c.id = e.cohort_cycle_id
  UNION ALL
  SELECT 'message:' || n.id, n.sent_at, 'messages', n.notif_type,
    c.year || '-' || printf('%02d', c.month),
    CASE WHEN u.role = 'admin' THEN 'Admin account' ELSE u.name END, 'clock', n.status, NULL
    FROM cohort_app_notification_ledger n LEFT JOIN cohort_cycles c ON c.id = n.cohort_cycle_id
    LEFT JOIN users u ON u.id = n.user_id
  UNION ALL
  SELECT 'week:' || s.id, s.created_at, 'weeks', 'Week ' || s.week_number || ' · ' || s.to_status,
    c.year || '-' || printf('%02d', c.month),
    CASE WHEN u.role = 'admin' THEN 'Admin account' ELSE u.name END,
    CASE WHEN s.triggered_by = 'scheduler' THEN 'clock' ELSE 'admin' END, 'Recorded week transition', NULL
    FROM stage_transition_log s LEFT JOIN cohort_cycles c ON c.id = s.cohort_cycle_id
    LEFT JOIN users u ON u.id = s.user_id WHERE s.cohort_cycle_id IS NOT NULL
  UNION ALL
  SELECT 'interview:' || i.id, i.updated_at, 'interviews', 'Interview · ' || i.status,
    (SELECT CASE WHEN COUNT(*) = 1 THEN c.year || '-' || printf('%02d', c.month) END FROM cohort_applicants ca
      JOIN cohort_cycles c ON c.id = ca.cohort_cycle_id WHERE ca.application_id = i.application_id),
    CASE WHEN u.role = 'admin' THEN 'Admin account' ELSE u.name END, 'admin',
    'Latest interview record', i.scheduled_at
    FROM spinout_application_interviews i LEFT JOIN users u ON u.id = i.user_id
  UNION ALL
  SELECT 'audit:' || a.id, a.exported_at,
    CASE WHEN a.action LIKE 'lab_host.%' THEN 'hosts'
      WHEN a.action LIKE 'spinout_certificate_%' THEN 'certificates' ELSE 'playbook' END,
    a.action, NULL, CASE WHEN u.role = 'admin' THEN 'Admin account' ELSE u.name END, 'admin',
    'Recorded admin action', NULL
    FROM admin_audit_log a LEFT JOIN users u ON u.id = a.viewed_user_id
    WHERE a.action IN ('lab_host.approve', 'lab_host.reject', 'lab_host.revoke',
      'spinout_certificate_issued', 'spinout_certificate_revoked')
      OR (a.action IN ('program.playbook.edit', 'program.playbook.publish', 'program.registry.update')
        AND json_extract(CASE WHEN json_valid(a.filters_json) THEN a.filters_json ELSE '{}' END, '$.program_key') = 'spinout-lab')
  UNION ALL
  SELECT 'formation:' || a.id, a.exported_at, 'formation', a.action, NULL, p.name, 'admin', 'Recorded formation action; cohort not recorded', NULL
    FROM admin_audit_log a
    LEFT JOIN incorporations i ON i.id = json_extract(CASE WHEN json_valid(a.filters_json) THEN a.filters_json ELSE '{}' END, '$.incorporation_id')
    LEFT JOIN projects p ON p.id = coalesce(i.project_id, json_extract(CASE WHEN json_valid(a.filters_json) THEN a.filters_json ELSE '{}' END, '$.project_id'))
    WHERE a.action IN ('incorporation_packet_ready', 'incorporation_filed', 'section_83b_operator_assigned', 'section_83b_operator_review_recorded')
      AND (i.user_id IN (${LAB_PARTICIPANT_IDS}) OR p.founder_id IN
        (SELECT lu.founder_id FROM users lu WHERE lu.id IN (${LAB_PARTICIPANT_IDS})))
), labelled AS (
  SELECT *, CASE event
    WHEN 'applicant_approved' THEN 'Application approved'
    WHEN 'applicant_rejected' THEN 'Application declined'
    WHEN 'applicant_waitlisted' THEN 'Application waitlisted'
    WHEN 'applications_closed' THEN 'Applications closed'
    WHEN 'capacity_ok' THEN 'Capacity checked'
    WHEN 'cycle_postponed' THEN 'Cohorts combined'
    WHEN 'cycle_activated' THEN 'Cohort started'
    WHEN 'force_proceed' THEN 'Run below the minimum'
    WHEN 'settings_updated' THEN 'Cohort size changed'
    WHEN 'lab_host.approve' THEN 'Host approved'
    WHEN 'lab_host.reject' THEN 'Host declined'
    WHEN 'lab_host.revoke' THEN 'Host removed'
    WHEN 'spinout_certificate_issued' THEN 'Certificate issued'
    WHEN 'spinout_certificate_revoked' THEN 'Certificate revoked'
    WHEN 'program.playbook.edit' THEN 'Playbook draft edited'
    WHEN 'program.playbook.publish' THEN 'Playbook published'
    WHEN 'program.registry.update' THEN 'Program updated'
    ELSE replace(event, '_', ' ') END AS event_label FROM history
), filtered AS (
  SELECT * FROM labelled WHERE (? = '' OR type = ?) AND (? = '' OR cohort = ?)
    AND (? = '' OR by = ?) AND (? = '' OR instr(lower(coalesce(event, '') || ' ' || event_label || ' ' || coalesce(about, '') || ' ' || detail), lower(?)) > 0)
) SELECT
      (SELECT COUNT(*) FROM filtered) AS total,
      (SELECT json_group_array(json_object('id', id, 'at', at, 'type', type, 'event', event, 'label', event_label,
        'cohort', cohort, 'about', about, 'by', by, 'detail', detail, 'scheduled_at', scheduled_at)) FROM
        (SELECT * FROM filtered ORDER BY
          CASE WHEN ? = 'newest' THEN julianday(at) END DESC,
          CASE WHEN ? = 'oldest' THEN julianday(at) END ASC, id ASC LIMIT ? OFFSET ?)) AS items`;
const COVERAGE = 'Recorded cohort events, messages, week transitions, the latest interview records, hosts, certificates and playbook changes. Formation actions cover Lab ventures under the current participant rule; their historical cohort is Not recorded. History never names an admin.';

r.get('/activity', async (c) => {
  await requireAdmin(c);
  const type = c.req.query('type') || '';
  const cohort = c.req.query('cohort') || '';
  const by = c.req.query('by') || '';
  const q = (c.req.query('q') || '').trim();
  const sort = c.req.query('sort') || 'newest';
  const rawLimit = c.req.query('limit') || '25';
  const rawOffset = c.req.query('offset') || '0';
  if (!['', 'decisions', 'cohort', 'messages', 'weeks', 'interviews', 'hosts', 'certificates', 'playbook', 'formation'].includes(type)
    || (cohort && !/^\d{4}-(0[1-9]|1[0-2])$/.test(cohort)) || !['', 'clock', 'admin'].includes(by)
    || !['newest', 'oldest'].includes(sort) || q.length > 200
    || !/^\d+$/.test(rawLimit) || !/^\d+$/.test(rawOffset)
    || Number(rawLimit) < 1 || Number(rawLimit) > 100 || !Number.isSafeInteger(Number(rawOffset))) {
    return c.json({ error: 'Choose valid activity filters and a page of 1 to 100 rows.' }, 400);
  }
  const limit = Number(rawLimit), offset = Number(rawOffset);
  const binds = [type, type, cohort, cohort, by, by, q, q];
  try {
    // One statement gives the count and page from the same snapshot, even past the last row.
    const result = await c.env.DB.prepare(HISTORY)
      .bind(...binds, sort, sort, limit, offset).first<{ total: number; items: string }>();
    if (!result) throw new Error('No activity result');
    return c.json({ items: JSON.parse(result.items), total: result.total, limit, offset, coverage: COVERAGE });
  } catch (e) {
    console.warn('[admin-lab:activity] read failed', e);
    return c.json({ error: 'The Lab activity could not be read. Try again.' }, 503);
  }
});

export default r;
