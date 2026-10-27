/**
 * D1059 (#2929, part 3 of #2427) — a report built from the Grow modules, sent
 * with frozen figures, corrected as a new revision, with its statements.
 * Mounted on `/api/reporting` beside part 2's routes (`reporting.ts`).
 *
 *   POST /periods/:uid/draft        the founders open the period's report: the
 *                                   figures assembled from every module
 *                                   (`services/reportFigures.ts`); preparing
 *                                   twice opens the same draft
 *   PUT  /reports/:uid              the founders' choices on a draft: title,
 *                                   words, lines, figures in or out (a required
 *                                   one out needs a reason), a Mercury figure
 *                                   shared, typed figures, the team or not
 *   GET  /reports/:uid/preview?as=  investor | team: exactly what that group
 *                                   reads, and the digest Send needs
 *   POST /reports/:uid/send         { figures_sha256 }: re-reads every sourced
 *                                   figure and refuses on any drift; the
 *                                   privacy check; freezes; marks each due
 *                                   period met; tells the recipients
 *   POST /reports/:uid/correct      { reason }: a new revision of a sent
 *                                   report; its send tells every recipient
 *   GET  /reports/:uid              a report; a recipient's first read is
 *                                   recorded as the open
 *   POST /reports/:uid/documents    a PDF statement on a draft (private R2)
 *   GET  /documents/:uid            the statement, private and no-store
 *
 * WHO. The founders (the owner and accepted co-founders, `founderTeam`) draft,
 * choose and send. An admin opens a sent report read-only and never drafts or
 * sends (#2427 owner question 6). An advisor or partner of the venture reads
 * what was sent. An investor reads only a report they received, and never
 * another recipient's name. A support session writes nothing.
 *
 * TEAM ONLY. A figure from the founder's Mercury is shown only to the
 * venture's team and goes into a report only when the venture's founder ticks
 * it in their own session. Every statement is bound.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { AUTH_ERROR_STATUSES } from '../util/authErrors';
import { refuse } from '../util/refusal';
import { SUPPORT_SESSION_REFUSED_CODE, isSupportSession } from '../services/fundAdminAccess';
import { canAccessProject } from '../services/projectAccess';
import { notify } from '../services/notify';
import { lintForSend } from '../services/telegramRedactCheck';
import { isTeamViewer, isVentureFounder, TEAM_ONLY } from '../services/mercury/growFeeds';
import { cleanLines, LineError, type Line } from '../services/updateShare';
import { founderTeam, KIND_WORDS, type Kind } from '../services/reportingDuties';
import {
  ChoiceError, MODULE_TITLES, applyChoices, assembleReport, choicesOf, cleanTyped, digestFigures, leftOut, readerFigures,
  requiredFiguresOf, storedFigures, type Choice, type ReportFigure, type TypedFigure,
} from '../services/reportFigures';

class Refusal extends Error {
  status: number; code: string; sentence: string; extra: Record<string, unknown>;
  constructor(status: number, code: string, sentence: string, extra: Record<string, unknown> = {}) {
    super(code); this.status = status; this.code = code; this.sentence = sentence; this.extra = extra;
  }
}

const onError = (error: any, c: any) => {
  if (error instanceof Response) return error;
  if (error instanceof Refusal) return refuse(c, error.status, { code: error.code, message: error.sentence, extra: error.extra });
  const status = AUTH_ERROR_STATUSES[error?.message];
  if (status) return refuse(c, status, { code: 'reporting_refused', message: 'This account cannot do that on reporting.' });
  return refuse(c, 503, { code: 'reporting_unreadable', message: 'Unreadable: the report could not be read or saved. Try again.', raw: error });
};

const NO_REPORT = () => new Refusal(404, 'not_found', 'No such report.');
const NO_PERIOD = () => new Refusal(404, 'not_found', 'No such reporting period.');
const FOUNDERS_ONLY = () => new Refusal(403, 'founders_only', 'The founders prepare and send reports. Admins never act for a company.');
const today = () => new Date().toISOString().slice(0, 10);
const nowIso = () => new Date().toISOString();
const newUid = () => crypto.randomUUID().replace(/-/g, '');
const body = async (c: any) => {
  const parsed = await c.req.json().catch(() => null);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
};
const parse = (raw: unknown, fallback: any) => { try { const v = JSON.parse(String(raw ?? '')); return v ?? fallback; } catch { return fallback; } };

/** A report's own audience flags. `investors`, `team` and `network` stay false so D889's grants admit only recorded recipients. */
const REPORT_AUDIENCE = (team: boolean) => JSON.stringify({ investors: false, team: false, network: false, report_team: team });

/** The most a statement may weigh, and how many one report holds. */
export const DOCUMENT_MAX_BYTES = 6 * 1024 * 1024;
export const DOCUMENTS_PER_REPORT = 10;

type ReportRow = {
  id: number; uid: string; project_id: number; author_user_id: number; period: string | null; title: string; body: string | null;
  status: string; submitted_at: string | null; period_start: string; period_end: string; highlights_json: string | null; lowlights_json: string | null;
  audience_json: string | null; sent_at: string | null; kind: string; figures_json: string | null; figures_sha256: string | null;
  revision: number; corrects_update_id: number | null; correction_reason: string | null; created_at: string; updated_at: string;
};
type PeriodRow = {
  id: number; uid: string; duty_id: number; period_label: string; period_start: string; period_end: string; due_on: string;
  waived_at: string | null; met_update_id: number | null; met_at: string | null;
  duty_uid: string; kind: Kind; required_figures: string; holder_user_id: number | null; holder_name: string | null;
};

async function ownSession(c: any, sentence: string) {
  if (await isSupportSession(c)) throw new Refusal(403, SUPPORT_SESSION_REFUSED_CODE, sentence);
}

/** The venture, its founder team, and whether the caller is one of them (never an admin). */
async function venture(env: Env, user: User, projectId: number) {
  const p = await env.DB.prepare('SELECT id, uid, name, founder_id FROM projects WHERE id = ? AND deleted_at IS NULL').bind(projectId)
    .first<{ id: number; uid: string; name: string; founder_id: number | null }>();
  if (!p) return null;
  const team = await founderTeam(env, p.id);
  return { project: p, team, founder: user.role !== 'admin' && team.includes(Number(user.id)) };
}

async function loadReport(env: Env, uid: string): Promise<ReportRow | null> {
  if (!/^[0-9a-f]{32}$/.test(uid)) return null;
  return env.DB.prepare(`SELECT * FROM portfolio_updates WHERE uid = ? AND kind = 'report'`).bind(uid).first<ReportRow>();
}

/** Every period of the venture's active duties with this window, with its duty's terms and holder. */
async function windowPeriods(env: Env, projectId: number, start: string, end: string): Promise<PeriodRow[]> {
  return (await env.DB.prepare(
    `SELECT p.id, p.uid, p.duty_id, p.period_label, p.period_start, p.period_end, p.due_on, p.waived_at, p.met_update_id, p.met_at,
            d.uid AS duty_uid, d.kind, d.required_figures, d.holder_user_id, u.name AS holder_name
       FROM reporting_periods p JOIN reporting_duties d ON d.id = p.duty_id LEFT JOIN users u ON u.id = d.holder_user_id
      WHERE d.project_id = ? AND d.status = 'active' AND p.period_start = ? AND p.period_end = ? ORDER BY p.id`,
  ).bind(projectId, start, end).all<PeriodRow>()).results || [];
}
const isOpen = (p: PeriodRow) => p.met_update_id == null && !p.waived_at;
const requiredOf = (periods: PeriodRow[]) => new Set(periods.flatMap((p) => requiredFiguresOf(p)));

/** The first revision of a report's chain: the one its periods are met by. */
async function rootOf(env: Env, row: ReportRow): Promise<number> {
  let id = row.id; let up = row.corrects_update_id;
  for (let hop = 0; up != null && hop < 50; hop += 1) {
    const prev = await env.DB.prepare('SELECT id, corrects_update_id FROM portfolio_updates WHERE id = ?').bind(up).first<{ id: number; corrects_update_id: number | null }>();
    if (!prev) break;
    id = prev.id; up = prev.corrects_update_id;
  }
  return id;
}

/** The periods a report covers: those its chain met, and while a first draft, the window's open ones. */
async function reportPeriods(env: Env, row: ReportRow) {
  const all = await windowPeriods(env, row.project_id, row.period_start, row.period_end);
  const root = await rootOf(env, row);
  const met = all.filter((p) => p.met_update_id === root);
  return { all, met, open: all.filter(isOpen), root };
}

/** The figures as the stores hold them now, with the report's choices carried over. */
async function freshFigures(env: Env, row: ReportRow, mayShare: boolean, choices?: Choice[], typed?: TypedFigure[]) {
  const assembled = await assembleReport(env, row.project_id, { start: row.period_start, end: row.period_end }, today());
  const previous = storedFigures(row.figures_json);
  const carried = choicesOf(previous);
  const figures = applyChoices(assembled.figures, choices ?? [], typed ?? carried.typed, mayShare, previous);
  return { figures, unreadable: assembled.unreadable };
}

/** A figure list as the founders see it; a team-only value reads "Team only" to anyone outside the team. */
function teamFigures(figures: ReportFigure[], teamViewer: boolean, required: Set<string>) {
  return figures.map((f) => ({
    ...f,
    value: f.team_only && !teamViewer ? null : f.value,
    reason: f.team_only && !teamViewer ? TEAM_ONLY : f.reason,
    module_title: MODULE_TITLES[f.module] ?? null,
    required: !f.typed && required.has(f.key),
  }));
}

async function documentsOf(env: Env, updateId: number) {
  return ((await env.DB.prepare('SELECT uid, filename, label, size_bytes, created_at FROM report_documents WHERE update_id = ? ORDER BY id')
    .bind(updateId).all<any>()).results || []).map((d: any) => ({ uid: d.uid, filename: d.filename, label: d.label, size_bytes: Number(d.size_bytes), added_at: d.created_at }));
}

/** The revision that corrected this one, if any: the old one reads "Corrected on [date]". */
async function correctedBy(env: Env, id: number) {
  const r = await env.DB.prepare(`SELECT uid, revision, sent_at, correction_reason FROM portfolio_updates WHERE corrects_update_id = ? AND kind = 'report'`)
    .bind(id).first<{ uid: string; revision: number; sent_at: string | null; correction_reason: string | null }>();
  return r && r.sent_at ? { uid: r.uid, revision: Number(r.revision), corrected_on: r.sent_at.slice(0, 10), reason: r.correction_reason } : null;
}

/** What each period of the report needs, and what it would be sent without. */
function meets(periods: PeriodRow[], figures: ReportFigure[], withHolder: boolean) {
  return periods.map((p) => ({
    period_uid: p.uid, label: p.period_label, due_on: p.due_on, duty_uid: p.duty_uid, kind: p.kind, title: KIND_WORDS[p.kind] ?? p.kind,
    without: leftOut(figures, new Set(requiredFiguresOf(p))),
    ...(withHolder ? { holder: p.holder_user_id == null ? null : { name: p.holder_name ?? null } } : {}),
  }));
}

/** The founders' view of a draft or a sent report. */
async function teamView(env: Env, user: User, row: ReportRow, extra: Record<string, unknown> = {}) {
  const teamViewer = await isTeamViewer(env, user, row.project_id);
  const periods = await reportPeriods(env, row);
  const covered = row.sent_at ? periods.met : periods.open;
  const figures = storedFigures(row.figures_json);
  const required = requiredOf(row.revision > 1 || row.sent_at ? periods.met : periods.open);
  const recipients = row.sent_at ? ((await env.DB.prepare(
    `SELECT r.audience, r.user_id, u.name, r.delivered_via, r.not_delivered_reason, r.opened_at FROM update_recipients r
       LEFT JOIN users u ON u.id = r.user_id WHERE r.update_id = ? ORDER BY r.id`,
  ).bind(row.id).all<any>()).results || []).map((x: any) => ({
    audience: x.audience, name: x.name ?? null, delivered: x.delivered_via != null, not_delivered_reason: x.not_delivered_reason, opened_at: x.opened_at,
  })) : [];
  return {
    ok: true, view: 'team', uid: row.uid, kind: 'report', status: row.sent_at ? 'sent' : 'draft',
    period: { label: row.period, start: row.period_start, end: row.period_end },
    title: row.title, body: row.body, highlights: parse(row.highlights_json, []), lowlights: parse(row.lowlights_json, []),
    include_team: !!parse(row.audience_json, {}).report_team,
    figures: teamFigures(figures, teamViewer, required), figures_sha256: row.figures_sha256,
    meets: meets(covered, figures, true),
    revision: Number(row.revision), correction_reason: row.correction_reason, corrected_by: await correctedBy(env, row.id),
    documents: await documentsOf(env, row.id), sent_at: row.sent_at, recipients,
    ...extra,
  };
}

/** A reader's view of a sent report: an investor sees only what their own duties require, and no other recipient. */
async function readerView(env: Env, row: ReportRow, holderId: number | null) {
  const periods = await reportPeriods(env, row);
  const own = holderId == null ? periods.met : periods.met.filter((p) => p.holder_user_id === holderId);
  const figures = storedFigures(row.figures_json);
  return {
    ok: true, view: 'reader', uid: row.uid, kind: 'report', status: 'sent',
    period: { label: row.period, start: row.period_start, end: row.period_end },
    title: row.title, body: row.body, highlights: parse(row.highlights_json, []), lowlights: parse(row.lowlights_json, []),
    figures: readerFigures(figures, requiredOf(own)),
    meets: own.map((p) => ({ period_uid: p.uid, label: p.period_label, title: KIND_WORDS[p.kind] ?? p.kind, due_on: p.due_on, met_on: p.met_at ? p.met_at.slice(0, 10) : null })),
    revision: Number(row.revision), correction_reason: row.correction_reason, corrected_by: await correctedBy(env, row.id),
    documents: await documentsOf(env, row.id), sent_at: row.sent_at,
  };
}

/** A draft, for the founders only, writable; a support session is refused before anything is read. */
async function ownDraft(c: any, user: User, uid: string, sentence: string) {
  await ownSession(c, sentence);
  const row = await loadReport(c.env, uid);
  if (!row) throw NO_REPORT();
  const v = await venture(c.env, user, row.project_id);
  if (!v) throw NO_REPORT();
  if (!v.founder) throw v.team.length && user.role === 'admin' ? FOUNDERS_ONLY() : NO_REPORT();
  return { row, ...v };
}

const r = new Hono<{ Bindings: Env }>();
r.onError(onError);
r.use('*', async (c, next) => { await next(); c.header('Cache-Control', 'private, no-store'); });

// ---------------------------------------------------------------- draft

r.post('/periods/:uid/draft', async (c) => {
  const user = await requireAuth(c);
  await ownSession(c, 'A support session cannot prepare a report.');
  const p = await c.env.DB.prepare(
    `SELECT p.id, p.period_label, p.period_start, p.period_end, d.project_id FROM reporting_periods p JOIN reporting_duties d ON d.id = p.duty_id WHERE p.uid = ?`,
  ).bind(c.req.param('uid')).first<{ id: number; period_label: string; period_start: string; period_end: string; project_id: number }>();
  if (!p) throw NO_PERIOD();
  const v = await venture(c.env, user, Number(p.project_id));
  if (!v || !(await canAccessProject(c.env, user, v.project))) throw NO_PERIOD();
  if (!v.founder) throw FOUNDERS_ONLY();
  const existing = await c.env.DB.prepare(
    `SELECT * FROM portfolio_updates WHERE project_id = ? AND kind = 'report' AND period_start = ? AND period_end = ? AND sent_at IS NULL AND corrects_update_id IS NULL`,
  ).bind(p.project_id, p.period_start, p.period_end).first<ReportRow>();
  if (existing) return c.json(await teamView(c.env, user, existing, { created: false }));
  const assembled = await assembleReport(c.env, Number(p.project_id), { start: p.period_start, end: p.period_end }, today());
  const figures = applyChoices(assembled.figures, [], [], false);
  const { json, sha256 } = await digestFigures(figures);
  const uid = newUid(); const at = nowIso();
  const [ins] = await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT OR IGNORE INTO portfolio_updates (uid, project_id, author_user_id, period, title, body, status, kind, period_start, period_end,
         metrics_json, highlights_json, lowlights_json, audience_json, figures_json, figures_sha256, revision, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, 'draft', 'report', ?, ?, '[]', '[]', '[]', ?, ?, ?, 1, ?, ?)`,
    ).bind(uid, p.project_id, user.id, p.period_label, `${p.period_label} report`, p.period_start, p.period_end, REPORT_AUDIENCE(true), json, sha256, at, at),
    c.env.DB.prepare(
      `INSERT INTO reporting_events (project_id, period_id, actor_user_id, event, ref)
       SELECT ?, ?, ?, 'draft_built', ? WHERE EXISTS (SELECT 1 FROM portfolio_updates WHERE uid = ?)`,
    ).bind(p.project_id, p.id, user.id, `report:${uid}`, uid),
  ]);
  // A second press that lost the race opens the draft the first one wrote.
  const row = Number((ins as any)?.meta?.changes ?? 0) ? await loadReport(c.env, uid) : await c.env.DB.prepare(
    `SELECT * FROM portfolio_updates WHERE project_id = ? AND kind = 'report' AND period_start = ? AND period_end = ? AND sent_at IS NULL AND corrects_update_id IS NULL`,
  ).bind(p.project_id, p.period_start, p.period_end).first<ReportRow>();
  if (!row) throw new Refusal(503, 'reporting_unreadable', 'Unreadable: the report could not be read or saved. Try again.');
  return c.json(await teamView(c.env, user, row, { created: row.uid === uid, unreadable: assembled.unreadable }), row.uid === uid ? 201 : 200);
});

// ---------------------------------------------------------------- choices

r.put('/reports/:uid', async (c) => {
  const user = await requireAuth(c);
  const { row } = await ownDraft(c, user, c.req.param('uid'), 'A support session cannot change a report.');
  if (row.sent_at) throw new Refusal(409, 'report_sent', 'This report was sent. Correct it as a new revision.');
  const b = await body(c);
  const title = b.title === undefined ? row.title : typeof b.title === 'string' ? b.title.trim() : '';
  if (!title || title.length > 160) throw new Refusal(400, 'invalid_title', 'Give the report a title of at most 160 characters.');
  const words = b.body === undefined ? row.body : b.body == null ? null : typeof b.body === 'string' ? b.body.trim() || null : '';
  if (words === '' || (words && words.length > 4000)) throw new Refusal(400, 'invalid_body', 'Keep your own words to 4,000 characters.');
  let highlights: Line[]; let lowlights: Line[];
  try {
    highlights = b.highlights === undefined ? parse(row.highlights_json, []) : cleanLines(b.highlights, 'Highlight');
    lowlights = b.lowlights === undefined ? parse(row.lowlights_json, []) : cleanLines(b.lowlights, 'Lowlight');
  } catch (e) { if (e instanceof LineError) throw new Refusal(400, 'invalid_lines', e.sentence); throw e; }
  let correction = row.correction_reason;
  if (b.correction_reason !== undefined) {
    if (row.revision === 1) throw new Refusal(400, 'not_a_correction', 'Only a correction carries a reason for the change.');
    const said = typeof b.correction_reason === 'string' ? b.correction_reason.trim() : '';
    if (said.length < 3 || said.length > 280) throw new Refusal(400, 'invalid_reason', 'Say what the correction changes, in 3 to 280 characters.');
    correction = said;
  }
  if (b.figures !== undefined && !Array.isArray(b.figures)) throw new Refusal(400, 'invalid_figures', 'Figures must be a list of choices.');
  const choices: Choice[] = (b.figures || []).slice(0, 40).map((x: any) => ({
    key: String(x?.key ?? ''),
    ...(typeof x?.include === 'boolean' ? { include: x.include } : {}),
    ...(x && 'reason' in x ? { reason: x.reason == null ? null : String(x.reason) } : {}),
    ...(typeof x?.share === 'boolean' ? { share: x.share } : {}),
  }));
  const before = storedFigures(row.figures_json);
  let figures: ReportFigure[]; let unreadable;
  try {
    const typed = b.typed === undefined ? undefined : cleanTyped(b.typed);
    const mayShare = !(await isSupportSession(c)) && await isVentureFounder(c.env, user, row.project_id);
    ({ figures, unreadable } = await freshFigures(c.env, row, mayShare, choices, typed));
  } catch (e) { if (e instanceof ChoiceError) throw new Refusal(400, 'invalid_figures', e.sentence, { field: e.field }); throw e; }
  const { json, sha256 } = await digestFigures(figures);
  const team = b.include_team === undefined ? !!parse(row.audience_json, {}).report_team : b.include_team === true;
  const { open } = await reportPeriods(c.env, row);
  const anchor = open[0]?.id ?? null;
  const shared = figures.filter((f) => f.shared && !before.find((o) => o.key === f.key && o.shared));
  const [upd] = await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE portfolio_updates SET title = ?, body = ?, highlights_json = ?, lowlights_json = ?, audience_json = ?, figures_json = ?, figures_sha256 = ?,
         correction_reason = ?, updated_at = ? WHERE id = ? AND sent_at IS NULL`,
    ).bind(title, words, JSON.stringify(highlights), JSON.stringify(lowlights), REPORT_AUDIENCE(team), json, sha256, correction, nowIso(), row.id),
    // Each Mercury figure the founder shares is recorded, by its key and never its value.
    ...shared.map((f) => c.env.DB.prepare(
      `INSERT INTO reporting_events (project_id, period_id, actor_user_id, event, ref)
       SELECT ?, ?, ?, 'mercury_figure_shared', ? WHERE EXISTS (SELECT 1 FROM portfolio_updates WHERE id = ? AND sent_at IS NULL AND figures_sha256 = ?)`,
    ).bind(row.project_id, anchor, user.id, `report:${row.uid}:${f.key}`, row.id, sha256)),
  ]);
  if (!Number((upd as any)?.meta?.changes ?? 0)) throw new Refusal(409, 'report_sent', 'This report was sent. Correct it as a new revision.');
  const fresh = await loadReport(c.env, row.uid);
  return c.json(await teamView(c.env, user, fresh!, { unreadable }));
});

// ---------------------------------------------------------------- preview

r.get('/reports/:uid/preview', async (c) => {
  const user = await requireAuth(c);
  const row = await loadReport(c.env, c.req.param('uid'));
  if (!row) throw NO_REPORT();
  const v = await venture(c.env, user, row.project_id);
  if (!v || !v.founder) throw NO_REPORT();
  const as = c.req.query('as') || 'investor';
  if (as !== 'investor' && as !== 'team') throw new Refusal(400, 'invalid_as', 'Preview as investor or team.');
  const { all, open, met } = await reportPeriods(c.env, row);
  const covered = row.sent_at ? met : open;
  const figures = storedFigures(row.figures_json);
  // Would Send refuse? The stores are read again now, with the same choices.
  const now = await freshFigures(c.env, row, false);
  const stale = !row.sent_at && (await digestFigures(now.figures)).json !== row.figures_json;
  if (!(await isSupportSession(c))) {
    await c.env.DB.prepare(`INSERT INTO reporting_events (project_id, period_id, actor_user_id, event, ref) VALUES (?, ?, ?, 'preview_opened', ?)`)
      .bind(row.project_id, covered[0]?.id ?? all[0]?.id ?? null, user.id, `report:${row.uid}:${as}`).run();
  }
  const teamViewer = await isTeamViewer(c.env, user, row.project_id);
  return c.json({
    ok: true, as, uid: row.uid, title: row.title, body: row.body, period: { label: row.period, start: row.period_start, end: row.period_end },
    highlights: parse(row.highlights_json, []), lowlights: parse(row.lowlights_json, []),
    figures: as === 'investor' ? readerFigures(figures, requiredOf(covered)) : teamFigures(figures, teamViewer, requiredOf(covered)),
    meets: meets(covered, figures, true), documents: await documentsOf(c.env, row.id),
    figures_sha256: row.figures_sha256, stale,
    stale_reason: stale ? 'A figure in the Grow modules changed since this draft was saved. Save the draft again before you send.' : null,
  });
});

// ---------------------------------------------------------------- send

/** Every text a report sends, for the privacy check, each with where it is. */
function sendTexts(row: ReportRow, figures: ReportFigure[]) {
  const lines = (raw: string | null, k: string) => (parse(raw, []) as Line[]).map((l, i) => ({ key: `${k}_${i + 1}`, text: `${l.text} ${l.source?.label ?? ''}` }));
  return [
    { key: 'title', text: row.title }, { key: 'body', text: row.body ?? '' },
    ...lines(row.highlights_json, 'highlight'), ...lines(row.lowlights_json, 'lowlight'),
    ...figures.filter((f) => f.left_out_reason).map((f) => ({ key: `reason_${f.key}`, text: String(f.left_out_reason) })),
    ...figures.filter((f) => f.typed).map((f) => ({ key: f.key, text: f.label })),
    { key: 'correction_reason', text: row.correction_reason ?? '' },
  ].filter((t) => t.text.trim());
}

/** #2411's check before any send: a finding names its kind and where, never the words it caught. */
async function privacyCheck(env: Env, texts: { key: string; text: string }[]) {
  const sep = '\n\n';
  const res = await lintForSend(env, texts.map((t) => t.text).join(sep), 'investors');
  if (res.ok) return;
  const starts: number[] = []; let at = 0;
  for (const t of texts) { starts.push(at); at += t.text.length + sep.length; }
  const where = (offset?: number) => {
    if (offset == null) return null;
    let k = 0; while (k + 1 < starts.length && starts[k + 1] <= offset) k += 1;
    return texts[k]?.key ?? null;
  };
  throw new Refusal(422, 'pii_found',
    'This report holds an email, a phone number, a person’s name or another private detail, so it was not sent. Edit it and send again.',
    { findings: res.findings.map((f) => ({ kind: f.kind, in: where(f.offset) })) });
}

r.post('/reports/:uid/send', async (c) => {
  const user = await requireAuth(c);
  const { row, project, team } = await ownDraft(c, user, c.req.param('uid'), 'A support session cannot send a report.');
  if (row.sent_at) throw new Refusal(409, 'report_sent', 'This report was already sent.');
  const b = await body(c);
  // The draft the founder read is the one stored (D712's contentChanged).
  if (typeof b.figures_sha256 !== 'string' || b.figures_sha256 !== row.figures_sha256) {
    throw new Refusal(409, 'content_changed', 'The report changed since you read it. Open it again before you send.');
  }
  // Every sourced figure is read again from its store: a value the browser holds is never what is sent.
  const now = await freshFigures(c.env, row, false);
  if ((await digestFigures(now.figures)).json !== row.figures_json) {
    throw new Refusal(409, 'figures_changed', 'A figure in the Grow modules changed since this draft was saved. Save the draft again, check it, then send.');
  }
  const figures = storedFigures(row.figures_json);
  const periods = await reportPeriods(c.env, row);
  const covered = row.revision > 1 ? periods.met : periods.open;
  if (row.revision === 1 && !covered.length) throw new Refusal(409, 'nothing_due', 'Every period of this report was already sent or waived.');
  if (row.revision > 1 && !row.correction_reason) throw new Refusal(400, 'reason_required', 'Say what the correction changes before you send it.');
  const missing = leftOut(figures, requiredOf(covered)).filter((x) => !x.reason);
  if (missing.length) {
    throw new Refusal(400, 'reason_required', `Say why the report leaves out ${missing.map((m) => m.label).join(', ')}. The investors read the reason.`,
      { figures: missing.map((m) => m.key) });
  }
  await privacyCheck(c.env, sendTexts(row, figures));

  // Who receives it: each holder owed a covered period, the team if chosen, and on a correction everyone the last revision reached.
  const people = new Map<number, 'investor' | 'team'>();
  for (const p of covered) if (p.holder_user_id != null) people.set(Number(p.holder_user_id), 'investor');
  if (parse(row.audience_json, {}).report_team) for (const id of team) if (id !== Number(user.id) && !people.has(id)) people.set(id, 'team');
  if (row.corrects_update_id != null) {
    const prior = (await c.env.DB.prepare(`SELECT user_id, audience FROM update_recipients WHERE update_id = ? AND user_id IS NOT NULL`)
      .bind(row.corrects_update_id).all<{ user_id: number; audience: 'investor' | 'team' }>()).results || [];
    for (const x of prior) if (!people.has(Number(x.user_id))) people.set(Number(x.user_id), x.audience === 'investor' ? 'investor' : 'team');
  }
  people.delete(Number(user.id));
  const recipients = [...people.entries()];
  if (!recipients.length) throw new Refusal(400, 'no_recipients', 'Nobody receives this report yet: no investor is owed it and your team is not included.');

  const sentAt = nowIso();
  const left = leftOut(figures, requiredOf(covered));
  const stmts = [
    // The send itself carries every precondition; every later statement requires its row.
    c.env.DB.prepare(`UPDATE portfolio_updates SET status = 'submitted', submitted_at = ?, sent_at = ?, updated_at = ?
       WHERE id = ? AND sent_at IS NULL AND figures_sha256 = ?`).bind(sentAt, sentAt, sentAt, row.id, row.figures_sha256),
    ...recipients.map(([id, audience]) => c.env.DB.prepare(
      `INSERT INTO update_recipients (update_id, audience, user_id) SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM portfolio_updates WHERE id = ? AND sent_at = ?)`,
    ).bind(row.id, audience, id, row.id, sentAt)),
  ];
  if (row.revision === 1) {
    stmts.push(c.env.DB.prepare(
      `UPDATE reporting_periods SET met_update_id = ?, met_at = ? WHERE id IN (SELECT value FROM json_each(?)) AND met_update_id IS NULL AND waived_at IS NULL
         AND EXISTS (SELECT 1 FROM portfolio_updates WHERE id = ? AND sent_at = ?)`,
    ).bind(row.id, sentAt, JSON.stringify(covered.map((p) => p.id)), row.id, sentAt));
  }
  for (const p of covered) {
    stmts.push(c.env.DB.prepare(
      `INSERT INTO reporting_events (project_id, duty_id, period_id, actor_user_id, event, ref)
       SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM portfolio_updates WHERE id = ? AND sent_at = ?)`,
    ).bind(row.project_id, p.duty_id, p.id, user.id, row.revision === 1 ? 'sent' : 'corrected',
      `report:${row.uid}:r${row.revision}:sha256:${String(row.figures_sha256).slice(0, 16)}:recipients:${recipients.length}`, row.id, sentAt));
  }
  for (const f of left) {
    stmts.push(c.env.DB.prepare(
      `INSERT INTO reporting_events (project_id, period_id, actor_user_id, event, ref)
       SELECT ?, ?, ?, 'figure_left_out', ? WHERE EXISTS (SELECT 1 FROM portfolio_updates WHERE id = ? AND sent_at = ?)`,
    ).bind(row.project_id, covered[0]?.id ?? null, user.id, `${f.key}: ${String(f.reason)}`.slice(0, 200), row.id, sentAt));
  }
  const results = await c.env.DB.batch(stmts);
  if (Number((results[0] as any)?.meta?.changes ?? 0) !== 1) throw new Refusal(409, 'content_changed', 'The report changed since you read it. Open it again before you send.');

  // The record is written; each recipient is told through their notification settings.
  let delivered = 0;
  for (const [id, audience] of recipients) {
    const note = await notify(c.env, {
      userId: id, type: 'reporting_report_sent',
      title: row.revision === 1 ? `${project.name} sent its ${row.period ?? ''} report`.replace(/\s+/g, ' ') : `${project.name} corrected its ${row.period ?? ''} report`.replace(/\s+/g, ' '),
      body: row.revision === 1 ? row.title : `Corrected: ${row.correction_reason}`,
      link: audience === 'investor' ? `/portfolio/companies/${project.uid}` : `/grow/reporting?project_id=${row.project_id}`,
      payload: { report_uid: row.uid, revision: row.revision }, channels: ['in_app', 'email'], category: 'portfolio',
    }).catch(() => null);
    const via = note != null ? 'notification' : null;
    if (via) delivered += 1;
    await c.env.DB.prepare(`UPDATE update_recipients SET delivered_via = ?, not_delivered_reason = ? WHERE update_id = ? AND user_id = ?`)
      .bind(via, via ? null : 'Not delivered: their notification settings or the inbox refused it', row.id, id).run().catch(() => null);
  }
  const after = await reportPeriods(c.env, (await loadReport(c.env, row.uid))!);
  return c.json({
    ok: true, uid: row.uid, revision: Number(row.revision), sent_at: sentAt, figures_sha256: row.figures_sha256,
    recipients: recipients.length, delivered, not_delivered: recipients.length - delivered,
    meets: meets(row.revision === 1 ? after.met : covered, figures, true),
    // A period waived between the read and the send is not met by this report, and says so.
    not_met: row.revision === 1 ? covered.filter((p) => !after.met.find((m) => m.id === p.id)).map((p) => ({ period_uid: p.uid, label: p.period_label })) : [],
  });
});

// ---------------------------------------------------------------- correct

r.post('/reports/:uid/correct', async (c) => {
  const user = await requireAuth(c);
  const { row } = await ownDraft(c, user, c.req.param('uid'), 'A support session cannot correct a report.');
  if (!row.sent_at) throw new Refusal(409, 'report_not_sent', 'This report is still a draft: change it before you send.');
  const b = await body(c);
  const reason = typeof b.reason === 'string' ? b.reason.trim() : '';
  if (reason.length < 3 || reason.length > 280) throw new Refusal(400, 'invalid_reason', 'Say what the correction changes, in 3 to 280 characters.');
  if (await c.env.DB.prepare('SELECT 1 FROM portfolio_updates WHERE corrects_update_id = ?').bind(row.id).first()) {
    throw new Refusal(409, 'already_corrected', 'This revision was already corrected. Correct the latest revision.');
  }
  const { figures } = await freshFigures(c.env, row, false);
  const { json, sha256 } = await digestFigures(figures);
  const uid = newUid(); const at = nowIso();
  const [ins] = await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT OR IGNORE INTO portfolio_updates (uid, project_id, author_user_id, period, title, body, status, kind, period_start, period_end,
         metrics_json, highlights_json, lowlights_json, audience_json, figures_json, figures_sha256, revision, corrects_update_id, correction_reason, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'draft', 'report', ?, ?, '[]', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(uid, row.project_id, user.id, row.period, row.title, row.body, row.period_start, row.period_end, row.highlights_json ?? '[]',
      row.lowlights_json ?? '[]', row.audience_json, json, sha256, Number(row.revision) + 1, row.id, reason, at, at),
    // The statements go with the revision; their files stay where they are.
    c.env.DB.prepare(
      `INSERT INTO report_documents (update_id, project_id, file_key, filename, content_type, size_bytes, sha256, label, uploaded_by, created_at)
       SELECT (SELECT id FROM portfolio_updates WHERE uid = ?), project_id, file_key, filename, content_type, size_bytes, sha256, label, uploaded_by, created_at
         FROM report_documents WHERE update_id = ? AND EXISTS (SELECT 1 FROM portfolio_updates WHERE uid = ?)`,
    ).bind(uid, row.id, uid),
  ]);
  if (!Number((ins as any)?.meta?.changes ?? 0)) throw new Refusal(409, 'already_corrected', 'This revision was already corrected. Correct the latest revision.');
  return c.json(await teamView(c.env, user, (await loadReport(c.env, uid))!, { created: true }), 201);
});

// ---------------------------------------------------------------- read

r.get('/reports/:uid', async (c) => {
  const user = await requireAuth(c);
  const row = await loadReport(c.env, c.req.param('uid'));
  if (!row) throw NO_REPORT();
  const v = await venture(c.env, user, row.project_id);
  if (!v) throw NO_REPORT();
  if (v.founder) return c.json(await teamView(c.env, user, row));
  if (!row.sent_at) throw NO_REPORT();
  // A recipient: the first read is the open, recorded once.
  const mine = await c.env.DB.prepare('SELECT id, audience, opened_at FROM update_recipients WHERE update_id = ? AND user_id = ? ORDER BY id LIMIT 1')
    .bind(row.id, user.id).first<{ id: number; audience: string; opened_at: string | null }>();
  if (mine) {
    if (!mine.opened_at && !(await isSupportSession(c))) {
      const at = nowIso();
      await c.env.DB.batch([
        c.env.DB.prepare('UPDATE update_recipients SET opened_at = ? WHERE id = ? AND opened_at IS NULL').bind(at, mine.id),
        c.env.DB.prepare(`INSERT INTO reporting_events (project_id, actor_user_id, event, ref)
          SELECT ?, ?, 'opened', ? WHERE EXISTS (SELECT 1 FROM update_recipients WHERE id = ? AND opened_at = ?)`)
          .bind(row.project_id, user.id, `report:${row.uid}`, mine.id, at),
      ]);
    }
    return c.json(await readerView(c.env, row, mine.audience === 'investor' ? Number(user.id) : null));
  }
  // An admin, or an advisor or partner of the venture, reads what was sent (owner question 6).
  if (user.role === 'admin' || await canAccessProject(c.env, user, v.project)) {
    return c.json({ ...(await readerView(c.env, row, null)), read_only: true });
  }
  throw NO_REPORT();
});

/**
 * D1061 (#2931): the frozen figures of every report this investor received
 * from one company, for the company page's Figures (RPT10). The latest sent
 * revision of each chain stands, marked `corrected` when it is not the first.
 * Each report's figures are what the caller's own duties require, exactly as
 * the reader shows them. Reading this records no open: only the reader does.
 * A company that sent the caller no report is the same 404 as none.
 */
r.get('/companies/:projectUid/figures', async (c) => {
  const user = await requireAuth(c);
  const projectUid = c.req.param('projectUid');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(projectUid)) throw NO_REPORT();
  const rows = (await c.env.DB.prepare(
    `SELECT u.* FROM portfolio_updates u
       JOIN projects p ON p.id = u.project_id AND p.deleted_at IS NULL
      WHERE p.uid = ? AND u.kind = 'report' AND u.sent_at IS NOT NULL
        AND EXISTS (SELECT 1 FROM update_recipients r WHERE r.update_id = u.id AND r.user_id = ? AND r.audience = 'investor')
      ORDER BY u.period_start, u.revision`,
  ).bind(projectUid, user.id).all<ReportRow>()).results || [];
  if (!rows.length) throw NO_REPORT();
  const latest = new Map<number, ReportRow>();
  for (const row of rows) {
    const root = await rootOf(c.env, row);
    const held = latest.get(root);
    if (!held || Number(row.revision) > Number(held.revision)) latest.set(root, row);
  }
  const reports = [];
  for (const row of latest.values()) {
    const periods = await reportPeriods(c.env, row);
    const own = periods.met.filter((p) => p.holder_user_id === Number(user.id));
    reports.push({
      uid: row.uid,
      period: { label: row.period, start: row.period_start, end: row.period_end },
      sent_at: row.sent_at,
      revision: Number(row.revision),
      corrected: Number(row.revision) > 1,
      figures: readerFigures(storedFigures(row.figures_json), requiredOf(own)),
    });
  }
  reports.sort((a, b) => String(a.period.start).localeCompare(String(b.period.start)));
  return c.json({ ok: true, reports });
});

// ---------------------------------------------------------------- documents

r.post('/reports/:uid/documents', async (c) => {
  const user = await requireAuth(c);
  const { row, project } = await ownDraft(c, user, c.req.param('uid'), 'A support session cannot attach a statement.');
  if (row.sent_at) throw new Refusal(409, 'report_sent', 'This report was sent. Correct it as a new revision to change its statements.');
  if (!c.env.FILES) throw new Refusal(503, 'storage_unavailable', 'Statements cannot be stored here yet. Nothing was attached.');
  const b = await body(c);
  const filename = typeof b.filename === 'string' ? b.filename.trim().replace(/[^\w .()-]/g, '_').slice(0, 160) : '';
  if (!filename) throw new Refusal(400, 'invalid_filename', 'Name the statement.');
  const label = typeof b.label === 'string' && b.label.trim() ? b.label.trim().slice(0, 120) : null;
  const match = typeof b.data === 'string' ? /^data:application\/pdf;base64,([A-Za-z0-9+/=]+)$/.exec(b.data) : null;
  if (!match) throw new Refusal(400, 'invalid_document', 'Attach a PDF.');
  if (match[1].length > Math.ceil(DOCUMENT_MAX_BYTES / 3) * 4 + 4) throw new Refusal(413, 'document_too_large', 'A statement is at most 6 MB.');
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(match[1]), (ch) => ch.charCodeAt(0)); } catch { throw new Refusal(400, 'invalid_document', 'Attach a PDF.'); }
  if (!bytes.length || bytes.length > DOCUMENT_MAX_BYTES) throw new Refusal(413, 'document_too_large', 'A statement is at most 6 MB.');
  if (String.fromCharCode(...bytes.slice(0, 5)) !== '%PDF-') throw new Refusal(400, 'invalid_document', 'Attach a PDF.');
  const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM report_documents WHERE update_id = ?').bind(row.id).first<{ n: number }>();
  if (Number(count?.n ?? 0) >= DOCUMENTS_PER_REPORT) throw new Refusal(409, 'too_many_documents', 'A report holds at most ten statements.');
  const docUid = newUid();
  const key = `reports/${project.uid}/${row.uid}/${docUid}.pdf`;
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((x) => x.toString(16).padStart(2, '0')).join('');
  await c.env.FILES.put(key, bytes, { httpMetadata: { contentType: 'application/pdf' } });
  try {
    await c.env.DB.prepare(
      `INSERT INTO report_documents (uid, update_id, project_id, file_key, filename, content_type, size_bytes, sha256, label, uploaded_by)
       SELECT ?, ?, ?, ?, ?, 'application/pdf', ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM portfolio_updates WHERE id = ? AND sent_at IS NULL)`,
    ).bind(docUid, row.id, row.project_id, key, filename, bytes.length, digest, label, user.id, row.id).run();
  } catch (e) {
    await c.env.FILES.delete(key).catch(() => null);
    throw e;
  }
  if (!(await c.env.DB.prepare('SELECT 1 FROM report_documents WHERE uid = ?').bind(docUid).first())) {
    await c.env.FILES.delete(key).catch(() => null);
    throw new Refusal(409, 'report_sent', 'This report was sent. Correct it as a new revision to change its statements.');
  }
  return c.json({ ok: true, document: { uid: docUid, filename, label, size_bytes: bytes.length } }, 201);
});

r.get('/documents/:uid', async (c) => {
  const user = await requireAuth(c);
  const uid = c.req.param('uid');
  if (!/^[0-9a-f]{32}$/.test(uid)) throw new Refusal(404, 'not_found', 'No such statement.');
  const doc = await c.env.DB.prepare(
    `SELECT d.file_key, d.filename, d.update_id, u.project_id, u.sent_at FROM report_documents d JOIN portfolio_updates u ON u.id = d.update_id
      WHERE d.uid = ? AND u.kind = 'report'`,
  ).bind(uid).first<{ file_key: string; filename: string; update_id: number; project_id: number; sent_at: string | null }>();
  const NONE = () => new Refusal(404, 'not_found', 'No such statement.');
  if (!doc || !doc.file_key.startsWith('reports/')) throw NONE();
  const v = await venture(c.env, user, doc.project_id);
  if (!v) throw NONE();
  const allowed = v.founder || (doc.sent_at != null && (
    !!(await c.env.DB.prepare('SELECT 1 FROM update_recipients WHERE update_id = ? AND user_id = ?').bind(doc.update_id, user.id).first())
    || user.role === 'admin' || await canAccessProject(c.env, user, v.project)));
  if (!allowed) throw NONE();
  const obj = c.env.FILES ? await c.env.FILES.get(doc.file_key) : null;
  if (!obj) throw new Refusal(404, 'not_found', 'This statement is no longer stored.');
  return new Response(obj.body as any, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${doc.filename.replace(/["\\\r\n]/g, '_')}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "sandbox; default-src 'none'",
    },
  });
});

export default r;
