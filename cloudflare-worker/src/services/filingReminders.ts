/** D6039: calculate filing reminder dates and find the eligible recipients (venture founders, company admins) for a UTC day. */
import type { Env } from '../types';
import { remindOn } from './growDaily';
import { isIsoDay } from './licenceTerms';
import { notify } from './notify';
import { founderTeam } from './reportingDuties';

type DueFiling = {
  source: 'step' | 'obligation' | 'event'; id: number; project_id: number | null; company_id: number | null;
  company_uid: string | null; pack_item_key: string | null; title: string; due_date: string;
};
export const FILING_REMINDER_LEAD_DAYS = 14;
/** D1614: the company seats that may change a company compliance task are the ones reminded of it. */
const COMPANY_ADMIN_ROLES = ['Owner', 'Admin', 'Founder'];

export function filingReminderDates(dueDate: string | null, leadDays = FILING_REMINDER_LEAD_DAYS): string[] {
  return isIsoDay(dueDate) ? [remindOn(dueDate, leadDays), dueDate] : [];
}

async function activeIds(env: Env, ids: number[]): Promise<number[]> {
  const active = await env.DB.prepare(
    'SELECT id FROM users WHERE is_active = 1 AND id IN (SELECT value FROM json_each(?)) ORDER BY id',
  ).bind(JSON.stringify(ids)).all<{ id: number }>();
  return (active.results ?? []).map(({ id }) => Number(id));
}

async function companyAdmins(env: Env, companyId: number): Promise<number[]> {
  const rows = await env.DB.prepare(
    `SELECT user_id FROM user_company_links
      WHERE company_id = ? AND (is_primary_admin = 1 OR role_in_company IN (SELECT value FROM json_each(?)))`,
  ).bind(companyId, JSON.stringify(COMPANY_ADMIN_ROLES)).all<{ user_id: number }>();
  return activeIds(env, (rows.results ?? []).map(({ user_id }) => Number(user_id)));
}

/**
 * Select only open records due on a reminder date, collecting each active recipient once per filing and window.
 * Three sources: a venture's formation steps and entity obligations (its founders), and a company's own
 * compliance events with no project (its admins, D6039 part 2). A company event whose pack item key (D6713) is
 * also on a live venture's formation step is that step's reminder, so the event is left out; the ledger's
 * unique pack item index holds the same rule if both ever arrive.
 */
export async function filingReminderCandidates(env: Env, today: string, leadDays: number) {
  const futureDueDate = remindOn(today, -leadDays);
  const { results } = await env.DB.prepare(
    `SELECT 0 AS rank, 'step' AS source, f.id AS id, p.id AS project_id, NULL AS company_id, NULL AS company_uid,
            f.pack_item_key, f.title, f.due_date
       FROM formation_steps f JOIN projects p ON p.id = f.project_id
      WHERE f.state IN ('todo', 'doing') AND f.due_date IN (?, ?) AND p.deleted_at IS NULL
      UNION ALL
     SELECT 0 AS rank, 'obligation' AS source, o.id AS id, p.id AS project_id, NULL AS company_id, NULL AS company_uid,
            NULL AS pack_item_key, o.title, o.due_date
       FROM entity_obligations o JOIN projects p ON p.entity_id = o.entity_id
      WHERE o.status = 'open' AND o.due_date IN (?, ?) AND p.deleted_at IS NULL
      UNION ALL
     SELECT 1 AS rank, 'event' AS source, e.id AS id, NULL AS project_id, e.company_id, c.uid AS company_uid,
            e.pack_item_key, e.title, e.due_date
       FROM compliance_events e JOIN company_profiles c ON c.id = e.company_id
      WHERE e.project_id IS NULL AND e.completion_status = 'pending' AND e.due_date IN (?, ?)
        AND NOT (e.pack_item_key IS NOT NULL AND EXISTS (
          SELECT 1 FROM formation_steps s JOIN projects sp ON sp.id = s.project_id
           WHERE s.pack_item_key = e.pack_item_key AND sp.deleted_at IS NULL))
      ORDER BY rank, project_id, company_id, source, id`,
  ).bind(today, futureDueDate, today, futureDueDate, today, futureDueDate).all<DueFiling & { rank: number }>();
  const teams = new Map<string, number[]>();
  const seen = new Set<string>();
  const candidates: Array<DueFiling & { userId: number; reminderDate: string }> = [];
  for (const filing of results ?? []) {
    const teamKey = filing.source === 'event' ? `company:${filing.company_id}` : `project:${filing.project_id}`;
    let team = teams.get(teamKey);
    if (!team) {
      team = filing.source === 'event'
        ? await companyAdmins(env, Number(filing.company_id))
        : await activeIds(env, await founderTeam(env, Number(filing.project_id)));
      teams.set(teamKey, team);
    }
    for (const userId of team) {
      const key = `${filing.source}:${filing.id}:${userId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({ ...filing, userId, reminderDate: today });
    }
  }
  return candidates;
}

function reminderLink(filing: DueFiling): string {
  return filing.source === 'event'
    ? `/account/companies/${encodeURIComponent(String(filing.company_uid))}/settings/compliance`
    : `/build/company-creation/${filing.source}-${filing.id}?project_id=${filing.project_id}`;
}

/** The scheduler supplies the approved lead time. Claim each recipient before invoking notify. */
export async function sendFilingReminders(env: Env, today: string, leadDays = FILING_REMINDER_LEAD_DAYS, deliver = notify): Promise<number> {
  let sent = 0;
  for (const filing of await filingReminderCandidates(env, today, leadDays)) {
    const identity = [filing.source, filing.id, filing.userId, filing.due_date, filing.reminderDate] as const;
    // INSERT OR IGNORE honours both keys: the source row's, and one per pack item across sources.
    const claim = await env.DB.prepare(
      `INSERT OR IGNORE INTO filing_reminder_deliveries
        (source, filing_id, user_id, due_date, reminder_date, project_id, company_id, pack_item_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(...identity, filing.project_id, filing.company_id, filing.pack_item_key).run();
    if (!claim.meta?.changes) continue;
    const notification = await deliver(env, {
      userId: filing.userId,
      type: 'filing_reminder',
      title: `${filing.title} is due ${filing.due_date}`,
      body: filing.due_date === today ? 'This filing is due today.' : `This filing is due in ${leadDays} days.`,
      link: reminderLink(filing),
      channels: ['in_app'],
      category: 'compliance',
    });
    if (notification == null) continue;
    await env.DB.prepare(
      `UPDATE filing_reminder_deliveries SET sent_at = CURRENT_TIMESTAMP
        WHERE source = ? AND filing_id = ? AND user_id = ? AND due_date = ? AND reminder_date = ?`,
    ).bind(...identity).run();
    sent += 1;
  }
  return sent;
}

export async function filingReminderHistory(env: Env, projectId: number, source: DueFiling['source'], id: number) {
  const { results } = await env.DB.prepare(
    `SELECT due_date, reminder_date, MAX(sent_at) AS sent_at
       FROM filing_reminder_deliveries
      WHERE project_id = ? AND source = ? AND filing_id = ? AND sent_at IS NOT NULL
      GROUP BY due_date, reminder_date ORDER BY sent_at`,
  ).bind(projectId, source, id).all<{ due_date: string; reminder_date: string; sent_at: string }>();
  return results ?? [];
}
