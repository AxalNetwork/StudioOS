/**
 * D691 (S19-A, #1698), decision 3 — Grow's daily step: obligation reminders,
 * partner-renewal reminders (D6125) and KPI alerts, sent in the app only. `index.ts`'s scheduled handler runs it
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
 * RENEWALS (D6125, #6125). For each SIGNED partner with a `renewal_on`, the
 * venture's founder is told 30 days and 7 days before (RENEWAL_DAYS), once
 * each. What was sent is `renewal_reminders_sent_json` = `{ on, sent }`, keyed
 * to the renewal date it was sent for, so a changed `renewal_on` re-arms both
 * thresholds with no writer touching the column. A run that finds more than
 * one threshold due (a date entered 5 days out) sends ONE notification, for
 * the nearest, and records every due threshold, so the founder is not told
 * twice in one morning. A renewal day that has passed sends nothing. Paused,
 * ended and not-yet-signed partners send nothing. Claimed before sent, as
 * obligations are.
 *
 * ALERTS. Each venture with an alert is checked through `checkKpiAlerts`, the
 * same check a KPI write runs at once; this catches Stripe and CSV imports.
 *
 * Channel: `notify()` with `channels: ['in_app']`, category `compliance` for an
 * obligation reminder and `proactive_nudges` for a renewal or an alert. No
 * email. Build's filing
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

export async function founderUser(env: Env, founderId: number | null): Promise<number | null> {
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

/** D6125: the thresholds, in days before `renewal_on`, a signed partner's founder is reminded at. */
export const RENEWAL_DAYS = [30, 7] as const;

/** The stored `{ on, sent }` record; `sent` counts only while `on` is the partner's current date. */
export function renewalSent(raw: unknown, renewalOn: string): number[] {
  try {
    const v = JSON.parse(String(raw ?? 'null'));
    return v && typeof v === 'object' && v.on === renewalOn ? dayList(JSON.stringify(v.sent ?? [])) : [];
  } catch { return []; }
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const daysUntil = (today: string, on: string): number => Math.round((Date.parse(`${on}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY);

type RenewalPartner = {
  id: number; uid: string; project_id: number; name: string; renewal_on: string;
  renewal_reminders_sent_json: string | null; founder_id: number | null;
};

/** Send every partner-renewal reminder whose day has come; returns how many notifications were sent. */
export async function sendPartnerRenewalReminders(env: Env, now: number): Promise<number> {
  const today = new Date(now).toISOString().slice(0, 10);
  const res = await env.DB.prepare(
    `SELECT g.id, g.uid, g.project_id, g.name, g.renewal_on, g.renewal_reminders_sent_json, p.founder_id
       FROM growth_partners g JOIN projects p ON p.id = g.project_id
      WHERE g.stage = 'signed' AND g.renewal_on IS NOT NULL AND g.renewal_on >= ?
      ORDER BY g.id`,
  ).bind(today).all<RenewalPartner>();
  let sent = 0;
  for (const g of res.results || []) {
    const on = String(g.renewal_on);
    if (!ISO_DAY.test(on) || !Number.isFinite(Date.parse(`${on}T00:00:00Z`))) continue;
    const already = renewalSent(g.renewal_reminders_sent_json, on);
    const due = RENEWAL_DAYS.filter((n) => !already.includes(n) && remindOn(on, n) <= today);
    if (!due.length) continue;
    // Claim before sending, on the date and stage read: a second run, or a date or stage
    // changed since the read, matches nothing and sends nothing.
    const claim = await env.DB.prepare(
      `UPDATE growth_partners SET renewal_reminders_sent_json = ?
        WHERE id = ? AND stage = 'signed' AND renewal_on = ?
          AND COALESCE(renewal_reminders_sent_json, '') = COALESCE(?, '')`,
    ).bind(JSON.stringify({ on, sent: [...already, ...due].sort((a, b) => b - a) }), g.id, on, g.renewal_reminders_sent_json).run();
    if (!claim.meta?.changes) continue;
    const to = await founderUser(env, g.founder_id);
    if (to == null) continue;
    const left = daysUntil(today, on);
    const nearest = Math.min(...due);
    await notify(env, {
      userId: to, type: 'grow_partner_renewal_reminder', title: `${g.name} renews ${on}`,
      body: left === 0 ? 'The partnership renews today.' : `The partnership renews in ${left} day${left === 1 ? '' : 's'}.`,
      link: `/grow/partner-network/${encodeURIComponent(g.uid)}?project_id=${g.project_id}`,
      payload: { project_id: g.project_id, partner: g.uid, renewal_on: on, days_before: nearest }, channels: ['in_app'], category: 'proactive_nudges',
    });
    sent += 1;
  }
  return sent;
}

/** One run of the daily step. Each part fails alone, and one venture's alert failure never stops the next. */
export async function runGrowDaily(env: Env, now: number = Date.now()): Promise<{ reminders: number; renewals: number; alerts: number }> {
  let reminders = 0; let renewals = 0; let alerts = 0;
  try { reminders = await sendObligationReminders(env, now); } catch (e) { console.error('[growDaily] reminders failed', (e as Error).message); }
  try { renewals = await sendPartnerRenewalReminders(env, now); } catch (e) { console.error('[growDaily] renewals failed', (e as Error).message); }
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
  return { reminders, renewals, alerts };
}
