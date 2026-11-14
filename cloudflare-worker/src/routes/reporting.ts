/**
 * D1058 (#2928, part 2 of #2427) — `/api/reporting`: the duties a company owes
 * the investors who signed, their periods, the founder's desk and the
 * investor's view, over migration 579 (`services/reportingDuties.ts`).
 *
 * THE FOUNDER'S DESK (the venture's owner, a co-founder, an advisor reading,
 * an admin reading; never an investor):
 *   GET  /desk?project=           every duty and period of the venture, each
 *                                 period's state worked out now, the asks and
 *                                 the reminder settings
 *   POST /periods/:uid/expected   the owner or a co-founder: an expected date
 *                                 and note the investor sees ({ expected_on, note })
 *   PUT  /reminders               the owner or a co-founder: offsets, channels
 *                                 and team recipients ({ project, offsets,
 *                                 channels, recipient_user_ids })
 *
 * THE INVESTOR (only the duties whose holder is the caller):
 *   GET  /portfolio               each company that owes the caller, its duties
 *                                 and periods
 *   GET  /companies/:projectUid   one company's, or 404
 *   POST /periods/:uid/ask        once per period, while late or missing:
 *                                 writes D464's `portfolio_update_chases` and
 *                                 tells the founder team
 *   POST /periods/:uid/waive      the period is waived by the holder
 *
 * AN INVESTOR NEVER SEES ANOTHER INVESTOR. Every investor read and write is
 * scoped by `holder_user_id = caller`; another investor's duty or period is
 * the same 404 as one that does not exist, and the investor's rows carry no
 * holder, recipient or other name. An admin reads the desk and never writes
 * on a company's behalf (#2427 owner question 6). A support session writes
 * nothing. Every statement is bound.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { AUTH_ERROR_STATUSES } from '../util/authErrors';
import { refuse } from '../util/refusal';
import { SUPPORT_SESSION_REFUSED_CODE, isSupportSession } from '../services/fundAdminAccess';
import { canAccessProject } from '../services/projectAccess';
import { notify } from '../services/notify';
import {
  KIND_WORDS, type Cadence, type DueRule, type Kind, cleanReminders, founderTeam, isDay, nextPeriod, periodState, reminderSettings,
} from '../services/reportingDuties';

class Refusal extends Error {
  status: number; code: string; sentence: string;
  constructor(status: number, code: string, sentence: string) { super(code); this.status = status; this.code = code; this.sentence = sentence; }
}

const onError = (error: any, c: any) => {
  if (error instanceof Response) return error;
  if (error instanceof Refusal) return refuse(c, error.status, { code: error.code, message: error.sentence });
  const status = AUTH_ERROR_STATUSES[error?.message];
  if (status) return refuse(c, status, { code: 'reporting_refused', message: 'This account cannot do that on reporting.' });
  return refuse(c, 503, { code: 'reporting_unreadable', message: 'Unreadable: reporting could not be read or saved. Try again.', raw: error });
};

const NOT_FOUND = () => new Refusal(404, 'not_found', 'No such reporting period.');
const today = () => new Date().toISOString().slice(0, 10);
const body = async (c: any) => {
  const parsed = await c.req.json().catch(() => null);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
};
const parse = (raw: unknown): any[] => { try { const v = JSON.parse(String(raw ?? '[]')); return Array.isArray(v) ? v : []; } catch { return []; } };

async function ownSession(c: any, sentence: string) {
  if (await isSupportSession(c)) throw new Refusal(403, SUPPORT_SESSION_REFUSED_CODE, sentence);
}

type DutyRow = {
  id: number; uid: string; project_id: number; holder_user_id: number | null; holder_name?: string | null; kind: Kind; cadence: Cadence;
  due_rule: DueRule; due_days: number; required_figures: string; required_documents: string; source_document: string; source_clause: string;
  source_kind: string; source_envelope_id: number | null; body_sha256: string | null; defaulted_json: string; starts_on: string; status: string;
  closing_line_uid: string; holding_route?: string | null;
};
type PeriodRow = {
  id: number; uid: string; duty_id: number; period_label: string; period_start: string; period_end: string; due_on: string;
  expected_on: string | null; expected_note: string | null; waived_at: string | null; met_update_id: number | null; met_at: string | null;
  report_uid?: string | null;
};

/** The duty's words and terms. `withHolder` is the founder's view; an investor's never names a holder. */
function dutyDto(d: DutyRow, withHolder: boolean) {
  return {
    uid: d.uid, kind: d.kind, title: KIND_WORDS[d.kind], cadence: d.cadence, due_rule: d.due_rule, due_days: d.due_days,
    required_figures: parse(d.required_figures), required_documents: parse(d.required_documents),
    source: { document: d.source_document, clause: d.source_clause, kind: d.source_kind, body_sha256: d.body_sha256, signed: d.source_kind === 'signed_envelope' },
    defaulted: parse(d.defaulted_json), starts_on: d.starts_on, status: d.status,
    // D1061: the investor reads their own holding's route (direct, syndicate, Axal VC fund, third-party fund), never the line or a name.
    ...(withHolder ? { holder: d.holder_user_id == null ? null : { name: d.holder_name ?? null }, closing_line_uid: d.closing_line_uid } : { holding: { route: d.holding_route ?? null } }),
  };
}

/** Each period with its state now; a duty's next period, opened or not, decides missing. */
function periodsWithState(duties: DutyRow[], periods: PeriodRow[], day: string) {
  const byDuty = new Map<number, DutyRow>(duties.map((d) => [d.id, d]));
  return periods.map((p) => {
    const d = byDuty.get(p.duty_id)!;
    const next = nextPeriod(d.cadence, d.due_rule, d.due_days, { label: p.period_label, start: p.period_start, end: p.period_end, due_on: p.due_on });
    const s = periodState(p, next.due_on, day);
    return {
      uid: p.uid, duty_uid: d.uid, label: p.period_label, start: p.period_start, end: p.period_end, due_on: p.due_on,
      expected_on: p.expected_on, expected_note: p.expected_note, waived_at: p.waived_at, sent_at: p.met_at, ...s,
      // D1061: the report that met it, so the reader can open it; null until it is sent.
      report_uid: p.report_uid ?? null,
    };
  });
}

function record(periods: Array<{ duty_uid: string; state: string }>) {
  const out: Record<string, { sent: number; late: number; missing: number; waived: number }> = {};
  for (const p of periods) {
    const r = (out[p.duty_uid] ||= { sent: 0, late: 0, missing: 0, waived: 0 });
    if (p.state === 'sent') r.sent += 1; else if (p.state === 'late') r.late += 1; else if (p.state === 'missing') r.missing += 1; else if (p.state === 'waived') r.waived += 1;
  }
  return out;
}

async function periodsOf(env: Env, dutyIds: number[]): Promise<PeriodRow[]> {
  if (!dutyIds.length) return [];
  const rows = (await env.DB.prepare(
    `SELECT id, uid, duty_id, period_label, period_start, period_end, due_on, expected_on, expected_note, waived_at, met_update_id, met_at,
            (SELECT u.uid FROM portfolio_updates u WHERE u.id = reporting_periods.met_update_id) AS report_uid
       FROM reporting_periods WHERE duty_id IN (SELECT value FROM json_each(?)) ORDER BY period_start, duty_id`,
  ).bind(JSON.stringify(dutyIds)).all<PeriodRow>()).results || [];
  return rows;
}

/** The project for a desk read, and whether the caller may write on it (owner or co-founder, never an admin). */
async function deskProject(c: any, user: User, raw: unknown) {
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Refusal(400, 'project_required', 'Name the venture.');
  const p = await c.env.DB.prepare('SELECT id, uid, name, founder_id FROM projects WHERE id = ?').bind(id).first();
  if (!p || !(await canAccessProject(c.env, user, p as any))) throw new Refusal(404, 'not_found', 'No such venture.');
  const team = await founderTeam(c.env, Number(p.id));
  return { project: p as { id: number; uid: string; name: string; founder_id: number | null }, canWrite: user.role !== 'admin' && team.includes(Number(user.id)), team };
}

const r = new Hono<{ Bindings: Env }>();
r.onError(onError);

// ---------------------------------------------------------------- the founder's desk

r.get('/desk', async (c) => {
  const user = await requireAuth(c);
  c.header('Cache-Control', 'no-store');
  const { project, canWrite, team } = await deskProject(c, user, c.req.query('project') ?? c.req.query('project_id'));
  const duties = (await c.env.DB.prepare(
    `SELECT d.id, d.uid, d.project_id, d.holder_user_id, d.kind, d.cadence, d.due_rule, d.due_days, d.required_figures, d.required_documents,
            d.source_document, d.source_clause, d.source_kind, d.source_envelope_id, d.body_sha256, d.defaulted_json, d.starts_on, d.status,
            d.closing_line_uid, u.name AS holder_name FROM reporting_duties d LEFT JOIN users u ON u.id = d.holder_user_id
      WHERE d.project_id = ? ORDER BY d.id`,
  ).bind(project.id).all<DutyRow>()).results || [];
  const day = today();
  const periods = periodsWithState(duties, await periodsOf(c.env, duties.map((d) => d.id)), day);
  const asks = (await c.env.DB.prepare(
    `SELECT p.uid AS period_uid, e.created_at AS asked_at FROM reporting_events e JOIN reporting_periods p ON p.id = e.period_id
      WHERE e.project_id = ? AND e.event = 'asked' ORDER BY e.id DESC LIMIT 100`,
  ).bind(project.id).all<any>()).results || [];
  const rec = record(periods);
  const reminders = await reminderSettings(c.env, project.id);
  const names = team.length ? ((await c.env.DB.prepare('SELECT id, name FROM users WHERE id IN (SELECT value FROM json_each(?))')
    .bind(JSON.stringify(team)).all<any>()).results || []) : [];
  return c.json({
    ok: true, today: day, project: { id: project.id, uid: project.uid, name: project.name }, can_write: canWrite,
    duties: duties.map((d) => ({ ...dutyDto(d, true), record: rec[d.uid] || { sent: 0, late: 0, missing: 0, waived: 0 } })),
    periods, asks,
    reminders: {
      offsets: reminders.offsets, channels: reminders.channels, recipient_user_ids: reminders.recipients, saved: reminders.saved,
      team: names.map((u: any) => ({ id: Number(u.id), name: u.name ?? null })),
    },
  });
});

r.post('/periods/:uid/expected', async (c) => {
  const user = await requireAuth(c);
  await ownSession(c, 'A support session cannot give an expected date.');
  const p = await c.env.DB.prepare(
    `SELECT p.id, p.duty_id, p.waived_at, p.met_update_id, d.project_id FROM reporting_periods p JOIN reporting_duties d ON d.id = p.duty_id WHERE p.uid = ?`,
  ).bind(c.req.param('uid')).first<any>();
  if (!p) throw NOT_FOUND();
  const { canWrite } = await deskProject(c, user, p.project_id).catch(() => { throw NOT_FOUND(); });
  if (!canWrite) throw new Refusal(403, 'founders_only', 'The founders give an expected date. Admins never act for a company.');
  if (p.met_update_id != null || p.waived_at) throw new Refusal(409, 'period_closed', 'This period was sent or waived, so it needs no expected date.');
  const b = await body(c);
  if (!isDay(b.expected_on) || b.expected_on < today()) throw new Refusal(400, 'invalid_expected_on', 'Give a date from today on.');
  const note = typeof b.note === 'string' ? b.note.trim() : '';
  if (note.length > 280) throw new Refusal(400, 'note_too_long', 'Keep the note to 280 characters.');
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE reporting_periods SET expected_on = ?, expected_note = ?, expected_by = ? WHERE id = ?').bind(b.expected_on, note || null, user.id, p.id),
    c.env.DB.prepare(`INSERT INTO reporting_events (project_id, duty_id, period_id, actor_user_id, event, ref) VALUES (?, ?, ?, ?, 'expected_set', ?)`)
      .bind(p.project_id, p.duty_id, p.id, user.id, `expected:${b.expected_on}`),
  ]);
  return c.json({ ok: true, expected_on: b.expected_on, expected_note: note || null });
});

r.put('/reminders', async (c) => {
  const user = await requireAuth(c);
  await ownSession(c, 'A support session cannot change reminders.');
  const b = await body(c);
  const { project, canWrite, team } = await deskProject(c, user, b.project ?? b.project_id);
  if (!canWrite) throw new Refusal(403, 'founders_only', 'The founders set their reminders. Admins never act for a company.');
  let clean;
  try { clean = cleanReminders(b, team); } catch (e: any) { if (Array.isArray(e)) throw new Refusal(e[0], e[1], e[2]); throw e; }
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO reporting_reminder_settings (project_id, offsets_json, channels_json, recipients_json, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(project_id) DO UPDATE SET offsets_json = excluded.offsets_json, channels_json = excluded.channels_json,
         recipients_json = excluded.recipients_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    ).bind(project.id, JSON.stringify(clean.offsets), JSON.stringify(clean.channels), JSON.stringify(clean.recipients), user.id),
    c.env.DB.prepare(`INSERT INTO reporting_events (project_id, actor_user_id, event, ref) VALUES (?, ?, 'reminders_set', ?)`)
      .bind(project.id, user.id, `offsets:${clean.offsets.join(',')}`),
  ]);
  return c.json({ ok: true, offsets: clean.offsets, channels: clean.channels, recipient_user_ids: clean.recipients });
});

// ---------------------------------------------------------------- the investor

/** The caller's own duties, optionally of one project; with each company's name and uid. */
async function ownDuties(env: Env, userId: number, projectId: number | null) {
  return ((await env.DB.prepare(
    `SELECT d.id, d.uid, d.project_id, d.holder_user_id, d.kind, d.cadence, d.due_rule, d.due_days, d.required_figures, d.required_documents,
            d.source_document, d.source_clause, d.source_kind, d.source_envelope_id, d.body_sha256, d.defaulted_json, d.starts_on, d.status,
            d.closing_line_uid, p.uid AS project_uid, p.name AS project_name,
            (SELECT l.route FROM closing_lines l WHERE l.uid = d.closing_line_uid) AS holding_route
       FROM reporting_duties d JOIN projects p ON p.id = d.project_id
      WHERE d.holder_user_id = ? AND (? IS NULL OR d.project_id = ?) ORDER BY p.name, d.id`,
  ).bind(userId, projectId, projectId).all<DutyRow & { project_uid: string; project_name: string }>()).results || []);
}

async function companies(env: Env, userId: number, projectId: number | null) {
  const duties = await ownDuties(env, userId, projectId);
  const day = today();
  const periods = periodsWithState(duties, await periodsOf(env, duties.map((d) => d.id)), day);
  const asked = new Set(((await env.DB.prepare(
    `SELECT p.uid FROM reporting_events e JOIN reporting_periods p ON p.id = e.period_id WHERE e.event = 'asked' AND e.actor_user_id = ?`,
  ).bind(userId).all<any>()).results || []).map((x: any) => x.uid));
  const rec = record(periods);
  const byProject = new Map<number, any>();
  for (const d of duties) {
    const co = byProject.get(d.project_id) || { uid: d.project_uid, name: d.project_name, duties: [], periods: [] };
    co.duties.push({ ...dutyDto(d, false), record: rec[d.uid] || { sent: 0, late: 0, missing: 0, waived: 0 } });
    byProject.set(d.project_id, co);
  }
  for (const p of periods) {
    const d = duties.find((x) => x.uid === p.duty_uid)!;
    byProject.get(d.project_id).periods.push({ ...p, asked: asked.has(p.uid) });
  }
  return { today: day, companies: [...byProject.values()] };
}

r.get('/portfolio', async (c) => {
  const user = await requireAuth(c);
  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true, ...(await companies(c.env, Number(user.id), null)) });
});

r.get('/companies/:projectUid', async (c) => {
  const user = await requireAuth(c);
  c.header('Cache-Control', 'no-store');
  const uid = c.req.param('projectUid');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(uid)) throw new Refusal(404, 'not_found', 'No such company.');
  const p = await c.env.DB.prepare('SELECT id FROM projects WHERE uid = ?').bind(uid).first<{ id: number }>();
  const out = p ? await companies(c.env, Number(user.id), Number(p.id)) : null;
  if (!out || !out.companies.length) throw new Refusal(404, 'not_found', 'No such company.');
  return c.json({ ok: true, today: out.today, company: out.companies[0] });
});

/** The caller's own period, with its duty's terms; another investor's is the same 404 as none. */
async function ownPeriod(env: Env, userId: number, uid: string) {
  const row = await env.DB.prepare(
    `SELECT p.id, p.uid, p.duty_id, p.period_label, p.period_start, p.period_end, p.due_on, p.waived_at, p.met_update_id,
            d.project_id, d.kind, d.cadence, d.due_rule, d.due_days, pr.name AS project_name, pr.founder_id
       FROM reporting_periods p JOIN reporting_duties d ON d.id = p.duty_id JOIN projects pr ON pr.id = d.project_id
      WHERE p.uid = ? AND d.holder_user_id = ?`,
  ).bind(uid, userId).first<any>();
  if (!row) throw NOT_FOUND();
  const next = nextPeriod(row.cadence, row.due_rule, row.due_days, { label: row.period_label, start: row.period_start, end: row.period_end, due_on: row.due_on });
  return { ...row, ...periodState(row, next.due_on, today()) };
}

r.post('/periods/:uid/ask', async (c) => {
  const user = await requireAuth(c);
  await ownSession(c, 'A support session cannot ask for a report.');
  const p = await ownPeriod(c.env, Number(user.id), c.req.param('uid'));
  if (p.state !== 'late' && p.state !== 'missing') throw new Refusal(409, 'not_late', 'You can ask for a report once it is late.');
  const chaseUid = crypto.randomUUID().replace(/-/g, '');
  const [chase] = await c.env.DB.batch([
    // The chase is written only if this investor has not asked for this period: the ask's unique index holds the second.
    c.env.DB.prepare(
      `INSERT INTO portfolio_update_chases (uid, project_id, chased_by, created_at)
       SELECT ?, ?, ?, datetime('now') WHERE NOT EXISTS (
         SELECT 1 FROM reporting_events WHERE period_id = ? AND actor_user_id = ? AND event = 'asked')`,
    ).bind(chaseUid, p.project_id, user.id, p.id, user.id),
    c.env.DB.prepare(
      `INSERT OR IGNORE INTO reporting_events (project_id, duty_id, period_id, actor_user_id, event, ref) VALUES (?, ?, ?, ?, 'asked', ?)`,
    ).bind(p.project_id, p.duty_id, p.id, user.id, `chase:${chaseUid}`),
  ]);
  if (!Number((chase as any)?.meta?.changes ?? 0)) throw new Refusal(409, 'already_asked', 'You already asked for this period’s report.');
  // The founder team is told. Best-effort: the chase and the event are the record.
  try {
    for (const userId of await founderTeam(c.env, Number(p.project_id))) {
      await notify(c.env, {
        userId, type: 'reporting_asked', title: `An investor asked for the ${p.period_label} ${KIND_WORDS[p.kind as Kind]?.toLowerCase() || 'report'}`,
        body: 'Prepare it from Reporting, or give an expected date.', link: `/grow/reporting?project_id=${p.project_id}`,
        payload: { project_id: p.project_id, period_label: p.period_label }, channels: ['in_app', 'email'], category: 'portfolio',
      });
    }
  } catch { console.warn('[reporting] ask notify failed'); }
  return c.json({ ok: true, asked: true, chase_uid: chaseUid });
});

r.post('/periods/:uid/waive', async (c) => {
  const user = await requireAuth(c);
  await ownSession(c, 'A support session cannot waive a period.');
  const p = await ownPeriod(c.env, Number(user.id), c.req.param('uid'));
  if (p.state === 'sent') throw new Refusal(409, 'period_sent', 'This period’s report was sent, so there is nothing to waive.');
  if (p.state === 'waived') throw new Refusal(409, 'already_waived', 'You already waived this period.');
  const [upd] = await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE reporting_periods SET waived_at = datetime('now'), waived_by = ? WHERE id = ? AND waived_at IS NULL AND met_update_id IS NULL`)
      .bind(user.id, p.id),
    c.env.DB.prepare(
      `INSERT INTO reporting_events (project_id, duty_id, period_id, actor_user_id, event, ref)
       SELECT ?, ?, ?, ?, 'waived', NULL WHERE changes() = 1`,
    ).bind(p.project_id, p.duty_id, p.id, user.id),
  ]);
  if (!Number((upd as any)?.meta?.changes ?? 0)) throw new Refusal(409, 'already_waived', 'You already waived this period.');
  return c.json({ ok: true, waived: true });
});

export default r;
