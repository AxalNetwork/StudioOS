/**
 * D1058 (#2928, part 2 of #2427) — reporting duties, their periods and the
 * daily step, over migration 579.
 *
 * DUTIES COME FROM SIGNED PAPER. `createReportingDuties(env, closingId)` runs
 * when CAPITAL closes a closing (D1215, `completeClosing`) and again in the
 * daily step for any closed closing that has none, so a failed first run is
 * caught. For each RECEIVED line it reads the line's envelope (only when its
 * status is `completed`, so signed) and the closing's template, looks each
 * document up in `INFORMATION_RIGHTS`, and writes one duty per line and kind
 * (`INSERT OR IGNORE` on the unique index, so it is idempotent). A blank term
 * takes owner question 4's default and is named in `defaulted_json`. A
 * document with no information-rights clause (a SAFE, the stub side letter)
 * makes no duty: that is owner question 7's path (Eadwyn proposes, both
 * parties confirm), not a guess here.
 *
 * PERIODS OPEN ON A TIMER. `runReportingDaily` opens each period as it ends
 * (a budget, owed before its year starts, opens 30 days before it is due),
 * sets `due_on`, and sends the venture's team the reminders their settings
 * name, one `reporting_events` row per period and offset. Late and missing
 * are worked out on read (`periodState`), never stored.
 *
 * Every statement is bound. No event holds a figure; a reminder names a
 * period, never an amount.
 */
import type { Env } from '../types';
import { notify } from './notify';

export const DAY = 86_400_000;
export const KINDS = ['monthly_financials', 'quarterly_kpi', 'quarterly_update', 'annual_audited', 'annual_budget'] as const;
export type Kind = typeof KINDS[number];
export type Cadence = 'monthly' | 'quarterly' | 'annual';
export type DueRule = 'after_end' | 'before_start';

/** Owner question 4: a term the paper leaves blank. */
export const DEFAULT_DUE_DAYS: Record<Kind, number> = {
  monthly_financials: 30, quarterly_kpi: 45, quarterly_update: 45, annual_audited: 120, annual_budget: 30,
};

export const KIND_WORDS: Record<Kind, string> = {
  monthly_financials: 'Monthly financial statements',
  quarterly_kpi: 'Quarterly KPI report',
  quarterly_update: 'Quarterly investor update',
  annual_audited: 'Annual audited statements',
  annual_budget: 'Annual budget',
};

type Right = { kind: Kind; cadence: Cadence; due_rule: DueRule; due_days: number | null; documents: string[]; figures: string[]; clause: string };

/**
 * The information-rights clauses in Axal VC's templates, by document type,
 * quoted from `src/templates/legal/` and the generated deal pack. `due_days`
 * is null where the clause names no deadline. No clause names a figure, so
 * `figures` stays empty until part 3's `REPORT_FIGURES` gives a KPI report its
 * keys. The order is the preference when two documents give the same kind.
 */
export const INFORMATION_RIGHTS: ReadonlyArray<{ document: string; title: string; rights: Right[] }> = [
  { document: 'voting_rights', title: 'Investors’ Rights Agreement', rights: [
    { kind: 'monthly_financials', cadence: 'monthly', due_rule: 'after_end', due_days: 30, documents: ['unaudited_statements'], figures: [], clause: '§1.1(a)' },
    { kind: 'quarterly_kpi', cadence: 'quarterly', due_rule: 'after_end', due_days: null, documents: ['board_approved_statements'], figures: [], clause: '§1.1(b)' },
    { kind: 'annual_audited', cadence: 'annual', due_rule: 'after_end', due_days: 120, documents: ['audited_statements'], figures: [], clause: '§1.1(c)' },
    { kind: 'annual_budget', cadence: 'annual', due_rule: 'before_start', due_days: 30, documents: ['budget'], figures: [], clause: '§1.1(d)' },
  ] },
  { document: 'term_sheet', title: 'Term Sheet', rights: [
    { kind: 'monthly_financials', cadence: 'monthly', due_rule: 'after_end', due_days: null, documents: ['financial_report'], figures: [], clause: '§2.2' },
    { kind: 'annual_audited', cadence: 'annual', due_rule: 'after_end', due_days: null, documents: ['audited_statements'], figures: [], clause: '§2.2' },
    { kind: 'annual_budget', cadence: 'annual', due_rule: 'before_start', due_days: null, documents: ['budget'], figures: [], clause: '§2.2' },
  ] },
  { document: 'deal_pack_term_sheet', title: 'Term Sheet (deal pack)', rights: [
    { kind: 'quarterly_kpi', cadence: 'quarterly', due_rule: 'after_end', due_days: null, documents: ['financial_summary'], figures: [], clause: 'Information rights' },
  ] },
  { document: 'deal_pack_side_letter', title: 'Side Letter (deal pack)', rights: [
    { kind: 'quarterly_update', cadence: 'quarterly', due_rule: 'after_end', due_days: null, documents: [], figures: [], clause: 'Information rights' },
  ] },
];

/** A template slug or document type as a registry key: `voting_rights_v1` → `voting_rights`. */
export const documentKey = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim().toLowerCase().replace(/_v\d+$/, '') : '';
  return s && /^[a-z0-9_]{2,80}$/.test(s) ? s : null;
};

/** The rights a set of documents gives, one per kind, in registry order; each with what was defaulted. */
export function rightsOf(documents: Array<{ key: string | null; envelope?: { id: number; body_sha256: string | null } | null }>) {
  const out = new Map<Kind, Right & { document: string; title: string; envelope: { id: number; body_sha256: string | null } | null; defaulted: string[] }>();
  for (const entry of INFORMATION_RIGHTS) {
    const doc = documents.find((d) => d.key === entry.document);
    if (!doc) continue;
    for (const r of entry.rights) {
      if (out.has(r.kind)) continue;
      const defaulted = r.due_days == null ? ['due_days'] : [];
      out.set(r.kind, { ...r, due_days: r.due_days ?? DEFAULT_DUE_DAYS[r.kind], document: entry.document, title: entry.title, envelope: doc.envelope ?? null, defaulted });
    }
  }
  return [...out.values()];
}

// ---------------------------------------------------------------- periods

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const at = (day: string) => Date.parse(`${day}T00:00:00Z`);
export const addDays = (day: string, n: number) => iso(at(day) + n * DAY);
export const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(at(v)) && iso(at(v)) === v;

export type Period = { label: string; start: string; end: string; due_on: string };

/** The period of `cadence` that contains `day`, with its due day. */
export function periodOf(cadence: Cadence, rule: DueRule, dueDays: number, day: string): Period {
  const d = new Date(at(day));
  const y = d.getUTCFullYear(), m = d.getUTCMonth();
  let start: Date, end: Date, label: string;
  if (cadence === 'monthly') {
    start = new Date(Date.UTC(y, m, 1)); end = new Date(Date.UTC(y, m + 1, 0));
    label = `${y}-${String(m + 1).padStart(2, '0')}`;
  } else if (cadence === 'quarterly') {
    const q = Math.floor(m / 3);
    start = new Date(Date.UTC(y, q * 3, 1)); end = new Date(Date.UTC(y, q * 3 + 3, 0));
    label = `${y}-Q${q + 1}`;
  } else {
    start = new Date(Date.UTC(y, 0, 1)); end = new Date(Date.UTC(y, 11, 31));
    label = rule === 'before_start' ? `B${y}` : `FY${y}`;
  }
  const s = iso(start.getTime()), e = iso(end.getTime());
  return { label, start: s, end: e, due_on: rule === 'before_start' ? addDays(s, -dueDays) : addDays(e, dueDays) };
}

/** The period after `p`. */
export const nextPeriod = (cadence: Cadence, rule: DueRule, dueDays: number, p: Period) => periodOf(cadence, rule, dueDays, addDays(p.end, 1));

/** The first period a duty owes: the one containing its start, or for a budget, the next year's. */
export function firstPeriod(cadence: Cadence, rule: DueRule, dueDays: number, startsOn: string): Period {
  const p = periodOf(cadence, rule, dueDays, startsOn);
  return rule === 'before_start' && p.due_on < startsOn ? nextPeriod(cadence, rule, dueDays, p) : p;
}

/** When a period opens: the day after it ends, or for a budget, 30 days before it is due. */
export const opensOn = (rule: DueRule, p: Period) => (rule === 'before_start' ? addDays(p.due_on, -30) : addDays(p.end, 1));

/** Every period of a duty that should be open by `today`, oldest first, at most `cap`. */
export function periodsDue(d: { cadence: Cadence; due_rule: DueRule; due_days: number; starts_on: string }, today: string, cap = 36): Period[] {
  const out: Period[] = [];
  let p = firstPeriod(d.cadence, d.due_rule, d.due_days, d.starts_on);
  while (opensOn(d.due_rule, p) <= today && out.length < cap) {
    out.push(p);
    p = nextPeriod(d.cadence, d.due_rule, d.due_days, p);
  }
  return out;
}

export type PeriodState = 'sent' | 'waived' | 'upcoming' | 'due' | 'late' | 'missing';

/**
 * A period's state, on read. Sent and waived are stored facts. Otherwise: due
 * from 14 days before its due day, late after it, and missing once the next
 * period is due too. A missing period stays in the record.
 */
export function periodState(p: { due_on: string; met_update_id?: number | null; waived_at?: string | null }, nextDueOn: string | null, today: string) {
  if (p.met_update_id != null) return { state: 'sent' as PeriodState, days_late: null, days_left: null };
  if (p.waived_at) return { state: 'waived' as PeriodState, days_late: null, days_left: null };
  const diff = Math.round((at(today) - at(p.due_on)) / DAY);
  if (diff <= 0) return { state: (diff >= -14 ? 'due' : 'upcoming') as PeriodState, days_late: null, days_left: diff === 0 ? 0 : -diff };
  if (nextDueOn && nextDueOn <= today) return { state: 'missing' as PeriodState, days_late: diff, days_left: null };
  return { state: 'late' as PeriodState, days_late: diff, days_left: null };
}

// ---------------------------------------------------------------- reminders

/** RPT7's defaults: 14 and 3 days before, on the day, and 7 days late; in the app and by email. */
export const DEFAULT_REMINDERS = { offsets: [14, 3, 0, -7], channels: ['in_app', 'email'] as Array<'in_app' | 'email'> };
export const MAX_OFFSETS = 6;

/** The venture's founder team: its owner and accepted co-founders. Advisors and investors are never in it. */
export async function founderTeam(env: Env, projectId: number): Promise<number[]> {
  const rows = (await env.DB.prepare(
    `SELECT u.id FROM projects p JOIN users u ON u.founder_id = p.founder_id AND u.is_active = 1 WHERE p.id = ? AND p.founder_id IS NOT NULL
     UNION
     SELECT m.user_id FROM project_members m WHERE m.project_id = ? AND m.status = 'accepted' AND m.role IN ('owner', 'cofounder')`,
  ).bind(projectId, projectId).all<{ id: number }>()).results || [];
  return [...new Set(rows.map((r) => Number(r.id)).filter(Number.isSafeInteger))].sort((a, b) => a - b);
}

const ints = (raw: unknown): number[] => {
  try { const v = JSON.parse(String(raw ?? '[]')); return Array.isArray(v) ? v.map(Number).filter(Number.isSafeInteger) : []; } catch { return []; }
};
const strs = (raw: unknown): string[] => {
  try { const v = JSON.parse(String(raw ?? '[]')); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch { return []; }
};

/** A venture's reminder settings, or the defaults with the whole founder team. Recipients outside the team are dropped. */
export async function reminderSettings(env: Env, projectId: number) {
  const team = await founderTeam(env, projectId);
  const row = await env.DB.prepare('SELECT offsets_json, channels_json, recipients_json, updated_at FROM reporting_reminder_settings WHERE project_id = ?')
    .bind(projectId).first<any>();
  if (!row) return { offsets: DEFAULT_REMINDERS.offsets, channels: DEFAULT_REMINDERS.channels, recipients: team, team, saved: false, updated_at: null };
  return {
    offsets: ints(row.offsets_json), channels: strs(row.channels_json).filter((c) => c === 'in_app' || c === 'email') as Array<'in_app' | 'email'>,
    recipients: ints(row.recipients_json).filter((id) => team.includes(id)), team, saved: true, updated_at: row.updated_at,
  };
}

/** Validates a reminders body; throws a `[status, code, message]` tuple on a refusal. */
export function cleanReminders(body: any, team: number[]) {
  const offsets = Array.isArray(body?.offsets) ? body.offsets.map(Number) : null;
  if (!offsets || offsets.length > MAX_OFFSETS || offsets.some((n: number) => !Number.isInteger(n) || n < -30 || n > 60)) {
    throw [400, 'invalid_offsets', `Choose up to ${MAX_OFFSETS} reminders, each from 60 days before to 30 days after the due day.`];
  }
  const channels = Array.isArray(body?.channels) ? [...new Set(body.channels.map(String))] : null;
  if (!channels || !channels.length || channels.some((c) => c !== 'in_app' && c !== 'email')) throw [400, 'invalid_channels', 'Choose in the app, email or both.'];
  const recipients = Array.isArray(body?.recipient_user_ids) ? [...new Set(body.recipient_user_ids.map(Number))] : null;
  if (!recipients || !recipients.length || recipients.some((id) => !Number.isSafeInteger(id) || !team.includes(id as number))) {
    throw [400, 'invalid_recipients', 'Reminders go to your team only: choose its members.'];
  }
  return { offsets: [...new Set(offsets as number[])].sort((a, b) => b - a), channels: channels as string[], recipients: (recipients as number[]).sort((a, b) => a - b) };
}

// ---------------------------------------------------------------- creation

type ClosingRow = { id: number; project_id: number; status: string; closed_at: string | null; template_slug: string | null };
type LineRow = { id: number; uid: string; investor_user_id: number | null; status: string; envelope_id: number | null; env_type: string | null; env_status: string | null; env_sha: string | null };

/**
 * The duties a closed closing owes, written once. Returns how many were
 * created and, when none could be, why: the closing is not closed, no line was
 * received, or no signed document carries an information-rights clause.
 */
export async function createReportingDuties(env: Env, closingId: number): Promise<{ created: number; reason: string | null }> {
  const closing = await env.DB.prepare('SELECT id, project_id, status, closed_at, template_slug FROM closings WHERE id = ?').bind(closingId).first<ClosingRow>();
  if (!closing || closing.status !== 'closed' || !closing.closed_at) return { created: 0, reason: 'closing_not_closed' };
  const lines = (await env.DB.prepare(
    `SELECT l.id, l.uid, l.investor_user_id, l.status, l.envelope_id, e.document_type AS env_type, e.status AS env_status, e.body_sha256 AS env_sha
       FROM closing_lines l LEFT JOIN esign_envelopes e ON e.id = l.envelope_id
      WHERE l.closing_id = ? AND l.status = 'received' ORDER BY l.id`,
  ).bind(closing.id).all<LineRow>()).results || [];
  if (!lines.length) return { created: 0, reason: 'no_received_line' };
  const startsOn = String(closing.closed_at).slice(0, 10);
  const template = documentKey(closing.template_slug);
  const statements: D1PreparedStatement[] = [];
  let rights = 0;
  for (const line of lines) {
    const signed = line.envelope_id != null && line.env_status === 'completed';
    const docs = [
      ...(signed ? [{ key: documentKey(line.env_type), envelope: { id: Number(line.envelope_id), body_sha256: line.env_sha } }] : []),
      ...(template ? [{ key: template, envelope: null }] : []),
    ];
    for (const r of rightsOf(docs)) {
      rights += 1;
      const recipients = line.investor_user_id != null ? [Number(line.investor_user_id)] : [];
      statements.push(env.DB.prepare(
        `INSERT OR IGNORE INTO reporting_duties (closing_id, closing_line_id, closing_line_uid, project_id, holder_user_id, kind, cadence, due_rule, due_days,
           required_figures, required_documents, recipients_json, source_envelope_id, source_document, source_clause, body_sha256, source_kind, defaulted_json, starts_on)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(closing.id, line.id, line.uid, closing.project_id, line.investor_user_id, r.kind, r.cadence, r.due_rule, r.due_days,
        JSON.stringify(r.figures), JSON.stringify(r.documents), JSON.stringify(recipients), r.envelope?.id ?? null, r.document,
        `${r.title} ${r.clause}`, r.envelope?.body_sha256 ?? null, r.envelope ? 'signed_envelope' : 'closing_template', JSON.stringify(r.defaulted), startsOn));
      // The event follows its duty in the same batch, and only for a duty this batch wrote.
      statements.push(env.DB.prepare(
        `INSERT INTO reporting_events (project_id, duty_id, actor_user_id, event, ref)
         SELECT project_id, id, NULL, 'duty_created', ? FROM reporting_duties
          WHERE closing_line_id = ? AND kind = ? AND changes() = 1`,
      ).bind(r.envelope ? `envelope:${r.envelope.id}` : `template:${r.document}`, line.id, r.kind));
    }
  }
  if (!rights) return { created: 0, reason: 'no_information_rights' };
  const results = await env.DB.batch(statements);
  const created = results.filter((_, i) => i % 2 === 0).reduce((n, r: any) => n + Number(r?.meta?.changes ?? 0), 0);
  return { created, reason: null };
}

// ---------------------------------------------------------------- the daily step

type DutyRow = { id: number; project_id: number; kind: Kind; cadence: Cadence; due_rule: DueRule; due_days: number; starts_on: string };

/** Open every period that has come, oldest first. Returns how many were opened. */
export async function openPeriods(env: Env, today: string): Promise<number> {
  const duties = (await env.DB.prepare(
    "SELECT id, project_id, kind, cadence, due_rule, due_days, starts_on FROM reporting_duties WHERE status = 'active' ORDER BY id",
  ).all<DutyRow>()).results || [];
  let opened = 0;
  for (const d of duties) {
    const due = periodsDue(d, today);
    if (!due.length) continue;
    const statements: D1PreparedStatement[] = [];
    for (const p of due) {
      statements.push(env.DB.prepare(
        'INSERT OR IGNORE INTO reporting_periods (duty_id, period_label, period_start, period_end, due_on) VALUES (?, ?, ?, ?, ?)',
      ).bind(d.id, p.label, p.start, p.end, p.due_on));
      statements.push(env.DB.prepare(
        `INSERT INTO reporting_events (project_id, duty_id, period_id, actor_user_id, event, ref)
         SELECT ?, duty_id, id, NULL, 'period_opened', period_label FROM reporting_periods WHERE duty_id = ? AND period_label = ? AND changes() = 1`,
      ).bind(d.project_id, d.id, p.label));
    }
    const res = await env.DB.batch(statements);
    opened += res.filter((_, i) => i % 2 === 0).reduce((n, r: any) => n + Number(r?.meta?.changes ?? 0), 0);
  }
  return opened;
}

/** "Due 14 Nov", "due today", "7 days late". */
export function reminderWords(offset: number, dueOn: string) {
  const d = new Date(at(dueOn));
  const day = `${d.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]}`;
  if (offset > 0) return `is due ${day}, in ${offset} day${offset === 1 ? '' : 's'}`;
  if (offset === 0) return 'is due today';
  return `was due ${day}: ${-offset} day${offset === -1 ? '' : 's'} late`;
}

/**
 * Send each reminder whose day has come in the last three days, once: the
 * event row is claimed first (its partial unique index refuses a second), and
 * only a claimed reminder is sent. A period already sent or waived gets none.
 * An older reminder (a period opened late, or a run missed for days) is
 * skipped, never sent in a burst.
 */
export async function sendReminders(env: Env, today: string): Promise<number> {
  const periods = (await env.DB.prepare(
    `SELECT p.id, p.period_label, p.due_on, d.id AS duty_id, d.kind, d.project_id, pr.name AS project_name
       FROM reporting_periods p JOIN reporting_duties d ON d.id = p.duty_id JOIN projects pr ON pr.id = d.project_id
      WHERE p.met_update_id IS NULL AND p.waived_at IS NULL AND d.status = 'active' AND p.due_on >= ? AND p.due_on <= ?
      ORDER BY p.id`,
  ).bind(addDays(today, -40), addDays(today, 70)).all<any>()).results || [];
  const settings = new Map<number, Awaited<ReturnType<typeof reminderSettings>>>();
  let sent = 0;
  for (const p of periods) {
    if (!settings.has(p.project_id)) settings.set(p.project_id, await reminderSettings(env, p.project_id));
    const s = settings.get(p.project_id)!;
    if (!s.recipients.length || !s.channels.length) continue;
    for (const n of s.offsets) {
      const day = addDays(p.due_on, -n);
      if (day > today || day < addDays(today, -2)) continue;
      const claim = await env.DB.prepare(
        `INSERT OR IGNORE INTO reporting_events (project_id, duty_id, period_id, actor_user_id, event, ref) VALUES (?, ?, ?, NULL, 'reminder_sent', ?)`,
      ).bind(p.project_id, p.duty_id, p.id, `offset:${n}`).run();
      if (!Number(claim.meta?.changes ?? 0)) continue;
      for (const userId of s.recipients) {
        await notify(env, {
          userId, type: 'reporting_reminder',
          title: `${KIND_WORDS[p.kind as Kind] || 'A report'} for ${p.period_label} ${reminderWords(n, p.due_on)}`,
          body: 'A reminder from your reporting settings. Reminders go to your team only.',
          link: `/grow/reporting?project_id=${p.project_id}`,
          payload: { project_id: p.project_id, period_label: p.period_label, offset: n }, channels: s.channels, category: 'compliance',
        });
      }
      sent += 1;
    }
  }
  return sent;
}

/** Closed closings with no duty yet: their duties are created, so a failed first run is caught. */
export async function backfillDuties(env: Env, today: string): Promise<number> {
  // The last 45 days only: a closing whose papers carry no information right is
  // looked at for six weeks, never forever, and never crowds out a newer one.
  const rows = (await env.DB.prepare(
    `SELECT c.id FROM closings c WHERE c.status = 'closed' AND substr(c.closed_at, 1, 10) >= ?
        AND NOT EXISTS (SELECT 1 FROM reporting_duties d WHERE d.closing_id = c.id)
      ORDER BY c.id LIMIT 200`,
  ).bind(addDays(today, -45)).all<{ id: number }>()).results || [];
  let created = 0;
  for (const r of rows) created += (await createReportingDuties(env, Number(r.id))).created;
  return created;
}

/** The daily step: duties for closings that missed theirs, then periods, then reminders. */
export async function runReportingDaily(env: Env, now: number) {
  const today = iso(now);
  const duties = await backfillDuties(env, today);
  const periods = await openPeriods(env, today);
  const reminders = await sendReminders(env, today);
  return { duties, periods, reminders };
}
