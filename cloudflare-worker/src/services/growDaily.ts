/**
 * D691 (S19-A, #1698), decision 3 — Grow's daily step: obligation reminders
 * and KPI alerts, sent in the app only. `index.ts`'s scheduled handler runs it
 * once a day at 05:35 UTC.
 *
 * REMINDERS. For each N in an obligation's `remind_days_json`, once the day
 * `due_date` − N has come and while the obligation is not completed, one
 * notification goes to `owner_user_id`, else to the venture's founder (the
 * user whose `founder_id` is the project's). N is then appended to
 * `reminders_sent_json`, so it is sent once, and a day the step missed is
 * caught by the next run. A due-date change resets that list to `[]` (the
 * PATCH writer and Mark held), which re-arms every reminder.
 *
 * ALERTS. Each venture with an alert is checked through `checkKpiAlerts`, the
 * same check a KPI write runs at once; this catches Stripe and CSV imports.
 *
 * Channel: `notify()` with `channels: ['in_app']`, category `compliance` for a
 * reminder and `proactive_nudges` for an alert. No email. Build's filing
 * reminders (D690 S18-B) are not read here.
 */
import type { Env } from '../types';
import { notify } from './notify';
import { checkKpiAlerts } from './growKpis';

const DAY = 86_400_000;

/** Whole numbers of days from a stored JSON array; anything else is ignored, never thrown. */
export function dayList(raw: unknown): number[] {
  try {
    const v = JSON.parse(String(raw ?? '[]'));
    return Array.isArray(v) ? [...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 366))] : [];
  } catch { return []; }
}

/** The day a reminder N days before `due` falls on. */
export const remindOn = (due: string, n: number): string => new Date(Date.parse(`${due}T00:00:00Z`) - n * DAY).toISOString().slice(0, 10);

export const reminderLabel = (n: number): string => (n === 0 ? 'On the day' : n === 1 ? 'The day before' : `${n} days before`);

type Obligation = {
  id: number; project_id: number; title: string; due_date: string; remind_days_json: string | null;
  reminders_sent_json: string | null; owner_user_id: number | null; founder_id: number | null;
};

async function founderUser(env: Env, founderId: number | null): Promise<number | null> {
  if (founderId == null) return null;
  const u = await env.DB.prepare(
    "SELECT id FROM users WHERE founder_id = ? AND is_active = 1 ORDER BY (role = 'founder') DESC, id LIMIT 1",
  ).bind(founderId).first<{ id: number }>();
  return u ? Number(u.id) : null;
}

/** Send every reminder whose day has come; returns how many notifications were sent. */
export async function sendObligationReminders(env: Env, now: number): Promise<number> {
  const today = new Date(now).toISOString().slice(0, 10);
  const res = await env.DB.prepare(
    `SELECT e.id, e.project_id, e.title, e.due_date, e.remind_days_json, e.reminders_sent_json, e.owner_user_id, p.founder_id
       FROM compliance_events e JOIN projects p ON p.id = e.project_id
      WHERE e.remind_days_json IS NOT NULL AND e.completion_status <> 'completed'
      ORDER BY e.id`,
  ).all<Obligation>();
  let sent = 0;
  for (const e of res.results || []) {
    const sentDays = dayList(e.reminders_sent_json);
    const due = dayList(e.remind_days_json).filter((n) => !sentDays.includes(n) && remindOn(e.due_date, n) <= today);
    if (!due.length) continue;
    // Claim before sending: a second run sees the list it wrote and sends nothing.
    const claim = await env.DB.prepare(
      'UPDATE compliance_events SET reminders_sent_json = ? WHERE id = ? AND COALESCE(reminders_sent_json, \'[]\') = COALESCE(?, \'[]\')',
    ).bind(JSON.stringify([...sentDays, ...due].sort((a, b) => b - a)), e.id, e.reminders_sent_json).run();
    if (!claim.meta?.changes) continue;
    const to = e.owner_user_id != null ? Number(e.owner_user_id) : await founderUser(env, e.founder_id);
    if (to == null) continue;
    for (const n of due) {
      await notify(env, {
        userId: to, type: 'grow_obligation_reminder', title: `${e.title} is due ${e.due_date}`,
        body: `${reminderLabel(n)}: the reminder you set on this obligation.`,
        link: `/grow/durable-company-building/${e.id}?project_id=${e.project_id}`,
        payload: { project_id: e.project_id, obligation: e.id, days_before: n }, channels: ['in_app'], category: 'compliance',
      });
      sent += 1;
    }
  }
  return sent;
}

/** One run of the daily step. Each half fails alone, and one venture's alert failure never stops the next. */
export async function runGrowDaily(env: Env, now: number = Date.now()): Promise<{ reminders: number; alerts: number }> {
  let reminders = 0; let alerts = 0;
  try { reminders = await sendObligationReminders(env, now); } catch (e) { console.error('[growDaily] reminders failed', (e as Error).message); }
  let projects: number[] = [];
  try {
    const res = await env.DB.prepare('SELECT DISTINCT project_id FROM kpi_alerts ORDER BY project_id').all<{ project_id: number }>();
    projects = (res.results || []).map((r) => Number(r.project_id));
  } catch (e) { console.error('[growDaily] alerts unreadable', (e as Error).message); }
  for (const pid of projects) {
    try { alerts += (await checkKpiAlerts(env, pid, now)).notified; } catch (e) {
      console.error('[growDaily] alert check failed', pid, (e as Error).message);
    }
  }
  return { reminders, alerts };
}
