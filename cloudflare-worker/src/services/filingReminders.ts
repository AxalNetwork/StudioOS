/** D6039: calculate filing reminder dates and find the eligible founder recipients for a UTC day. */
import type { Env } from '../types';
import { remindOn } from './growDaily';
import { isIsoDay } from './licenceTerms';
import { notify } from './notify';
import { founderTeam } from './reportingDuties';

type DueFiling = { source: 'step' | 'obligation'; id: number; project_id: number; title: string; due_date: string };

export function filingReminderDates(dueDate: string | null, leadDays: number): string[] {
  return isIsoDay(dueDate) ? [remindOn(dueDate, leadDays), dueDate] : [];
}

/** Select only open records due on a reminder date, collecting each active founder once per filing and window. */
export async function filingReminderCandidates(env: Env, today: string, leadDays: number) {
  const futureDueDate = remindOn(today, -leadDays);
  const { results } = await env.DB.prepare(
    `SELECT 'step' AS source, f.id AS id, p.id AS project_id, f.title, f.due_date
       FROM formation_steps f JOIN projects p ON p.id = f.project_id
      WHERE f.state IN ('todo', 'doing') AND f.due_date IN (?, ?) AND p.deleted_at IS NULL
      UNION ALL
     SELECT 'obligation' AS source, o.id AS id, p.id AS project_id, o.title, o.due_date
       FROM entity_obligations o JOIN projects p ON p.entity_id = o.entity_id
      WHERE o.status = 'open' AND o.due_date IN (?, ?) AND p.deleted_at IS NULL
      ORDER BY project_id, source, id`,
  ).bind(today, futureDueDate, today, futureDueDate).all<DueFiling>();
  const teams = new Map<number, number[]>();
  const seen = new Set<string>();
  const candidates: Array<DueFiling & { userId: number; reminderDate: string }> = [];
  for (const filing of results ?? []) {
    let team = teams.get(filing.project_id);
    if (!team) {
      const founderIds = await founderTeam(env, filing.project_id);
      const active = await env.DB.prepare(
        'SELECT id FROM users WHERE is_active = 1 AND id IN (SELECT value FROM json_each(?)) ORDER BY id',
      ).bind(JSON.stringify(founderIds)).all<{ id: number }>();
      team = (active.results ?? []).map(({ id }) => id);
      teams.set(filing.project_id, team);
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

/** The scheduler supplies the approved lead time. Claim each recipient before invoking notify. */
export async function sendFilingReminders(env: Env, today: string, leadDays: number, deliver = notify): Promise<number> {
  let sent = 0;
  for (const filing of await filingReminderCandidates(env, today, leadDays)) {
    const identity = [filing.source, filing.id, filing.userId, filing.due_date, filing.reminderDate] as const;
    const claim = await env.DB.prepare(
      `INSERT OR IGNORE INTO filing_reminder_deliveries
        (source, filing_id, user_id, due_date, reminder_date, project_id) VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(...identity, filing.project_id).run();
    if (!claim.meta?.changes) continue;
    const notification = await deliver(env, {
      userId: filing.userId,
      type: 'filing_reminder',
      title: `${filing.title} is due ${filing.due_date}`,
      body: filing.due_date === today ? 'This filing is due today.' : `This filing is due in ${leadDays} days.`,
      link: `/build/company-creation/${filing.source}-${filing.id}?project_id=${filing.project_id}`,
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
