/**
 * D6225 (#6225) — `/api/report-questions`: an investor's questions about a
 * sent report and the founders' answers, over `report_questions` (migration
 * 202611272118_6225_report_questions.sql). The owner's answer A (2026-11-27):
 * one private thread per investor per report, between that investor and the
 * venture's founder team. Canvas: D6096 (GRQ22–GRQ27).
 *
 *   GET  /reports/:uid               the caller's view of the report's questions:
 *                                    an investor recipient their own thread, the
 *                                    founders every thread (and the first read
 *                                    marks each unread question read)
 *   POST /reports/:uid               an investor recipient asks ({ body, figure_key? })
 *   POST /questions/:uid/reply       a founder answers, once ({ body })
 *   POST /questions/:uid/withdraw    the asker withdraws a question not yet answered
 *
 * WHO. The report must be sent (`portfolio_updates.kind = 'report'`, `sent_at`).
 *   - An investor recipient of that revision (`update_recipients`, audience
 *     investor) asks, reads and withdraws their own questions, and never sees
 *     another investor's question or name.
 *   - The founders (the owner and accepted co-founders, `founderTeam`; never an
 *     admin) read every thread on the report and answer.
 *   - An admin, or an advisor of the venture (`canAccessProject`), reads the
 *     threads and never writes (D6096 part 2, owner answer 5).
 *   - Anyone else gets 404 `not_found`, the report read's own answer.
 *   - A support session reads what the member would read and writes nothing:
 *     every write is 403 `support_session_refused`.
 *
 * Each write tells the other side through `notify` (the founders on a question,
 * the asker on an answer); a failed notification never undoes the write.
 * Every statement is bound.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { AUTH_ERROR_STATUSES } from '../util/authErrors';
import { refuse } from '../util/refusal';
import { SUPPORT_SESSION_REFUSED_CODE, isSupportSession } from '../services/fundAdminAccess';
import { canAccessProject } from '../services/projectAccess';
import { founderTeam } from '../services/reportingDuties';
import { storedFigures } from '../services/reportFigures';
import { notify } from '../services/notify';
import type { RouteMount } from '../util/routeRegistry';

class Refusal extends Error {
  status: number; code: string; sentence: string;
  constructor(status: number, code: string, sentence: string) { super(code); this.status = status; this.code = code; this.sentence = sentence; }
}

/** The sentence for each refusal this router gives, keyed by its code (the pages keep the same words). */
export const QUESTION_REFUSALS = {
  not_found: 'No such report, or it is not shared with you.',
  question_not_found: 'No such question.',
  invalid_question: 'Write a question of 1 to 600 characters.',
  invalid_reply: 'Write a reply of 1 to 1,200 characters.',
  invalid_figure: 'That figure is not in this report.',
  too_many_questions: 'You have asked 50 questions about this report. The company answers them before you ask more.',
  recipients_only: 'Only an investor who received this report asks about it.',
  founders_only: 'Only the company’s founders answer a question. This view is read only.',
  already_answered: 'This question was already answered. A reply is never edited.',
  question_withdrawn: 'The investor withdrew this question, so it was not answered.',
  support_session_refused: 'A support session cannot ask or answer a question.',
  questions_refused: 'This account cannot do that on report questions.',
  questions_unreadable: 'Unreadable: the questions could not be read. This is not a claim that nobody asked.',
  question_write_failed: 'The question could not be saved. Nothing was changed. Try again.',
} as const;
type Code = keyof typeof QUESTION_REFUSALS;
const no = (status: number, code: Code) => new Refusal(status, code, QUESTION_REFUSALS[code]);

export const QUESTION_MAX = 600;
export const REPLY_MAX = 1200;
export const QUESTIONS_PER_REPORT = 50;
const REPORT_UID = /^[0-9a-f]{32}$/;
const FIGURE_KEY = /^[a-z0-9_]{1,64}$/;

const r = new Hono<{ Bindings: Env }>();
r.onError((error: any, c: any) => {
  if (error instanceof Response) return error;
  if (error instanceof Refusal) return refuse(c, error.status, { code: error.code, message: error.sentence });
  const status = AUTH_ERROR_STATUSES[error?.message];
  if (status) return refuse(c, status, { code: 'questions_refused', message: QUESTION_REFUSALS.questions_refused });
  return refuse(c, 503, c.req.method === 'GET'
    ? { code: 'questions_unreadable', message: QUESTION_REFUSALS.questions_unreadable, raw: error }
    : { code: 'question_write_failed', message: QUESTION_REFUSALS.question_write_failed, raw: error });
});
r.use('*', async (c, next) => { await next(); c.header('Cache-Control', 'private, no-store'); });

const json = async (c: any) => {
  const parsed = await c.req.json().catch(() => null);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
};
const textOf = (raw: unknown, max: number): string | null => {
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  return t.length >= 1 && t.length <= max ? t : null;
};
const nowIso = () => new Date().toISOString();
const newUid = () => crypto.randomUUID().replace(/-/g, '');
const clip = (s: string, n = 200) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

type Report = { id: number; uid: string; project_id: number; period: string | null; title: string; figures_json: string | null; sent_at: string };
type Project = { id: number; uid: string; name: string; founder_id: number | null };
type Role = 'asker' | 'team' | 'read_only';
type Access = { report: Report; project: Project; role: Role; team: number[] };

/**
 * Who the caller is on this sent report, or 404. The order matters: a founder
 * is the team even when also recorded as a recipient (the report's team copy).
 */
async function requireReportQuestionAccess(c: any, user: User, uid: string): Promise<Access> {
  if (!REPORT_UID.test(uid)) throw no(404, 'not_found');
  const report = await c.env.DB.prepare(
    `SELECT id, uid, project_id, period, title, figures_json, sent_at FROM portfolio_updates WHERE uid = ? AND kind = 'report' AND sent_at IS NOT NULL`,
  ).bind(uid).first() as Report | null;
  if (!report) throw no(404, 'not_found');
  const project = await c.env.DB.prepare('SELECT id, uid, name, founder_id FROM projects WHERE id = ? AND deleted_at IS NULL')
    .bind(report.project_id).first() as Project | null;
  if (!project) throw no(404, 'not_found');
  const team = await founderTeam(c.env, project.id);
  if (user.role !== 'admin' && team.includes(Number(user.id))) return { report, project, role: 'team', team };
  const received = await c.env.DB.prepare(
    `SELECT 1 AS ok FROM update_recipients WHERE update_id = ? AND user_id = ? AND audience = 'investor' LIMIT 1`,
  ).bind(report.id, Number(user.id)).first();
  if (received) return { report, project, role: 'asker', team };
  if (user.role === 'admin' || await canAccessProject(c.env, user, project)) return { report, project, role: 'read_only', team };
  throw no(404, 'not_found');
}

type QuestionRow = {
  id: number; uid: string; update_id: number; asker_user_id: number; asker_name: string | null; figure_key: string | null; body: string;
  read_at: string | null; withdrawn_at: string | null; answer_body: string | null; answered_at: string | null; answerer_name: string | null;
  created_at: string;
};
const SELECT_QUESTIONS = `SELECT q.id, q.uid, q.update_id, q.asker_user_id, a.name AS asker_name, q.figure_key, q.body, q.read_at, q.withdrawn_at,
    q.answer_body, q.answered_at, f.name AS answerer_name, q.created_at
  FROM report_questions q LEFT JOIN users a ON a.id = q.asker_user_id LEFT JOIN users f ON f.id = q.answered_by_user_id`;
/** The four reads of it, whole statements so no query text is assembled inside a prepare. */
const Q_BY_UID = SELECT_QUESTIONS + ' WHERE q.uid = ?';
const Q_BY_ID = SELECT_QUESTIONS + ' WHERE q.id = ?';
const Q_OF_ASKER = SELECT_QUESTIONS + ' WHERE q.update_id = ? AND q.asker_user_id = ? ORDER BY q.id';
const Q_OF_REPORT = SELECT_QUESTIONS + ' WHERE q.update_id = ? ORDER BY q.id';

/** sent (not yet read by the founders) → read → answered; or withdrawn. */
const stateOf = (q: QuestionRow) => (q.withdrawn_at ? 'withdrawn' : q.answered_at ? 'answered' : q.read_at ? 'read' : 'sent');

/** A question as the caller may see it: the asker's name only to the founders and a read-only reader. */
function dto(q: QuestionRow, role: Role) {
  return {
    uid: q.uid, figure_key: q.figure_key, body: q.body, asked_at: q.created_at, state: stateOf(q),
    read_at: q.read_at, withdrawn_at: q.withdrawn_at,
    answer: q.answered_at ? { body: q.answer_body, by: q.answerer_name ?? null, at: q.answered_at } : null,
    ...(role === 'asker' ? {} : { asker: { name: q.asker_name ?? null } }),
  };
}

async function writable(c: any) {
  if (await isSupportSession(c)) throw no(403, SUPPORT_SESSION_REFUSED_CODE);
}

/** One question by uid with its report's access, for a write. */
async function questionFor(c: any, user: User, uid: string) {
  if (!REPORT_UID.test(uid)) throw no(404, 'question_not_found');
  const q = await c.env.DB.prepare(Q_BY_UID).bind(uid).first() as QuestionRow | null;
  if (!q) throw no(404, 'question_not_found');
  const report = await c.env.DB.prepare('SELECT uid FROM portfolio_updates WHERE id = ?').bind(q.update_id).first() as { uid: string } | null;
  if (!report) throw no(404, 'question_not_found');
  let access: Access;
  try { access = await requireReportQuestionAccess(c, user, report.uid); } catch (e) {
    if (e instanceof Refusal && e.code === 'not_found') throw no(404, 'question_not_found');
    throw e;
  }
  // An investor reaches only their own question: another investor's is the same 404 as none.
  if (access.role === 'asker' && Number(q.asker_user_id) !== Number(user.id)) throw no(404, 'question_not_found');
  return { q, access };
}

const reload = async (c: any, id: number) => c.env.DB.prepare(Q_BY_ID).bind(id).first() as Promise<QuestionRow>;
const periodWords = (r: Report) => (r.period ? `${r.period} report` : 'report');

// ---------------------------------------------------------------- read

r.get('/reports/:uid', async (c) => {
  const user = await requireAuth(c);
  const access = await requireReportQuestionAccess(c, user, c.req.param('uid'));
  const { report, role } = access;
  const support = await isSupportSession(c);
  const rows = ((await (role === 'asker'
    ? c.env.DB.prepare(Q_OF_ASKER).bind(report.id, Number(user.id))
    : c.env.DB.prepare(Q_OF_REPORT).bind(report.id)
  ).all()).results || []) as QuestionRow[];
  // The founders' first read marks each unread question read; this response still shows them as they were (Unread).
  if (role === 'team' && !support && rows.some((q) => !q.read_at && !q.withdrawn_at)) {
    await c.env.DB.prepare('UPDATE report_questions SET read_at = ? WHERE update_id = ? AND read_at IS NULL AND withdrawn_at IS NULL')
      .bind(nowIso(), report.id).run();
  }
  const canWrite = !support && role !== 'read_only';
  return c.json({
    ok: true, report_uid: report.uid, view: role,
    can_ask: canWrite && role === 'asker', can_reply: canWrite && role === 'team',
    write_refusal: support ? QUESTION_REFUSALS.support_session_refused : role === 'read_only' ? QUESTION_REFUSALS.founders_only : null,
    limits: { question: QUESTION_MAX, reply: REPLY_MAX },
    questions: rows.map((q) => dto(q, role)),
  });
});

// ---------------------------------------------------------------- ask

r.post('/reports/:uid', async (c) => {
  const user = await requireAuth(c);
  await writable(c);
  const { report, project, role, team } = await requireReportQuestionAccess(c, user, c.req.param('uid'));
  if (role !== 'asker') throw no(403, 'recipients_only');
  const b = await json(c);
  const text = textOf(b.body, QUESTION_MAX);
  if (!text) throw no(400, 'invalid_question');
  let figureKey: string | null = null;
  if (b.figure_key != null && b.figure_key !== '') {
    const key = String(b.figure_key);
    if (!FIGURE_KEY.test(key) || !storedFigures(report.figures_json).some((f) => f.key === key)) throw no(400, 'invalid_figure');
    figureKey = key;
  }
  const uid = newUid();
  const at = nowIso();
  // The cap is in the INSERT itself, so two sends at once cannot pass it together.
  const res: any = await c.env.DB.prepare(
    `INSERT INTO report_questions (uid, update_id, project_id, asker_user_id, figure_key, body, created_at)
     SELECT ?, ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM report_questions WHERE update_id = ? AND asker_user_id = ?) < ?`,
  ).bind(uid, report.id, project.id, Number(user.id), figureKey, text, at, report.id, Number(user.id), QUESTIONS_PER_REPORT).run();
  if (!Number(res?.meta?.changes ?? 0)) throw no(409, 'too_many_questions');
  const q = await c.env.DB.prepare(Q_BY_UID).bind(uid).first() as QuestionRow;

  // The record is written; each founder is told through their notification settings.
  const asker = (await c.env.DB.prepare('SELECT name FROM users WHERE id = ?').bind(Number(user.id)).first() as { name: string | null } | null)?.name;
  let told = 0;
  for (const id of team) {
    const note = await notify(c.env, {
      userId: id, type: 'reporting_question_asked',
      title: `${asker || 'An investor'} asked about your ${periodWords(report)}`,
      body: clip(text),
      link: `/grow/reporting/${report.uid}?project_id=${project.id}#questions`,
      payload: { report_uid: report.uid, question_uid: uid }, channels: ['in_app', 'email'], category: 'portfolio',
    }).catch(() => null);
    if (note != null) told += 1;
  }
  return c.json({ ok: true, question: dto(q, 'asker'), founders_told: told }, 201);
});

// ---------------------------------------------------------------- reply

r.post('/questions/:uid/reply', async (c) => {
  const user = await requireAuth(c);
  await writable(c);
  const { q, access } = await questionFor(c, user, c.req.param('uid'));
  if (access.role !== 'team') throw no(403, 'founders_only');
  const b = await json(c);
  const text = textOf(b.body, REPLY_MAX);
  if (!text) throw no(400, 'invalid_reply');
  if (q.withdrawn_at) throw no(409, 'question_withdrawn');
  if (q.answered_at) throw no(409, 'already_answered');
  const at = nowIso();
  const res: any = await c.env.DB.prepare(
    `UPDATE report_questions SET answer_body = ?, answered_by_user_id = ?, answered_at = ?, read_at = COALESCE(read_at, ?)
      WHERE id = ? AND answered_at IS NULL AND withdrawn_at IS NULL`,
  ).bind(text, Number(user.id), at, at, q.id).run();
  if (!Number(res?.meta?.changes ?? 0)) {
    const now = await reload(c, q.id);
    throw no(409, now?.withdrawn_at ? 'question_withdrawn' : 'already_answered');
  }
  const after = await reload(c, q.id);
  const note = await notify(c.env, {
    userId: Number(q.asker_user_id), type: 'reporting_question_answered',
    title: `${access.project.name} answered your question on its ${periodWords(access.report)}`,
    body: clip(text),
    link: `/portfolio/companies/${access.project.uid}/reports`,
    payload: { report_uid: access.report.uid, question_uid: q.uid }, channels: ['in_app', 'email'], category: 'portfolio',
  }).catch(() => null);
  return c.json({ ok: true, question: dto(after, 'team'), asker_told: note != null });
});

// ---------------------------------------------------------------- withdraw

r.post('/questions/:uid/withdraw', async (c) => {
  const user = await requireAuth(c);
  await writable(c);
  const { q, access } = await questionFor(c, user, c.req.param('uid'));
  if (access.role !== 'asker') throw no(404, 'question_not_found');
  if (q.answered_at) throw no(409, 'already_answered');
  if (!q.withdrawn_at) {
    await c.env.DB.prepare('UPDATE report_questions SET withdrawn_at = ? WHERE id = ? AND answered_at IS NULL AND withdrawn_at IS NULL')
      .bind(nowIso(), q.id).run();
  }
  const after = await reload(c, q.id);
  if (after.answered_at && !after.withdrawn_at) throw no(409, 'already_answered');
  return c.json({ ok: true, question: dto(after, 'asker') });
});

export default r;
export const mount: RouteMount = { path: '/api/report-questions', router: r };
