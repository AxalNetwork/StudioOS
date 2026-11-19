/**
 * D6008 (#6008) — `/api/cycles/validate/interview-guide`: the venture's
 * interview guide (`services/interviewGuide.ts`), drawn in the recording
 * lightbox and as Customer research's Prepare questions sheet (D5995, V27–V29).
 *
 *   GET  /?project=                       { material, guide, defaults, ai, can_write }
 *   PUT  /?project=                       { questions, version } the whole guide, in order
 *   POST /draft/quote?project=            { segment_id? } Eadwyn's hold; runs nothing
 *   POST /draft?project=                  { segment_id?, quote } the draft and its receipt; stores nothing
 *   POST /draft/accept?project=           { receipt, ids, edits?, version } the picked questions join the guide
 *   GET  /copy/:interviewId?project=      the copy on that interview, or null
 *   POST /copy/:interviewId?project=      take the copy (once); a second call answers the first
 *   PUT  /copy/:interviewId/asked?project= { question_id, asked } on the copy only
 *
 * WHO. Reading is the founder board's audience (`canReadBoard`): a partner
 * reads the guide with no write tools. Every write, the draft included, is the
 * venture's own or an admin's (`canWrite`), and never a support session.
 * AI off for Customer research (`assist_off`) refuses only the draft: the guide
 * stays writable by hand, and the read says which (`ai.assist`).
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { refuse } from '../util/refusal';
import { railFor, refuseRun } from '../util/railContext';
import { canReadBoard, canWrite, type ProjectRef } from './_founder_validate_helpers';
import { assistOff, quoteRun, run, type RunOptions } from '../services/aiRouter';
import { AI_SURFACE } from '../services/aiSurfaces';
import { isSupportSession } from '../services/companyAccess';
import {
  DEFAULT_QUESTIONS, GUIDE_OPTION, GUIDE_PAGE, GuideError, acceptInto, copyOnto, draftPrompt, draftReceipt, guideMaterial,
  markAsked, mergeSave, openReceipt, parseDraft, readCopy, readGuide, writeGuide, interviewOf, type Material,
} from '../services/interviewGuide';

const router = new Hono<{ Bindings: Env }>();
type C = Context<{ Bindings: Env }>;
type Scope = { user: User; projectId: number; project: ProjectRef; writer: boolean };

/** Seams for the tests: the model run and its quote. */
export const guideDeps = { run, quoteRun };

const today = () => new Date().toISOString().slice(0, 10);
const body = async (c: C): Promise<Record<string, any>> => {
  const b = await c.req.json().catch(() => null);
  return b && typeof b === 'object' && !Array.isArray(b) ? b : {};
};

async function scope(c: C, write: boolean): Promise<Scope | Response> {
  let user: User;
  try { user = (await requireAuth(c)) as User; } catch { return c.json({ detail: 'Unauthorized' }, 401); }
  const raw = String(c.req.query('project') ?? '');
  if (!/^[1-9][0-9]{0,9}$/.test(raw)) return refuse(c, 400, { code: 'project_required', message: 'Choose a venture.' });
  const projectId = Number(raw);
  const project = await c.env.DB.prepare('SELECT id, founder_id FROM projects WHERE id = ? AND deleted_at IS NULL')
    .bind(projectId).first<ProjectRef>();
  if (!project) return refuse(c, 404, { code: 'project_not_found', message: 'That venture was not found.' });
  if (!canReadBoard(project, user)) return refuse(c, 403, { code: 'forbidden', message: 'This guide belongs to the venture.' });
  const writer = canWrite(project, user);
  if (write && !writer) return refuse(c, 403, { code: 'read_only', message: 'You can read this guide but not change it.' });
  if (write && await isSupportSession(c)) return refuse(c, 403, { code: 'support_session', message: 'A support session cannot change the guide.' });
  return { user, projectId, project, writer };
}

const ctxOf = (c: C, projectId: number) => ({ env: c.env, projectId, today: today() });
const refsOf = (m: Material) => new Set([...m.hypotheses.map((h) => h.ref), ...m.themes.map((t) => t.ref)]);
const interviewParam = (v: string | undefined) => (/^[1-9][0-9]{0,9}$/.test(String(v ?? '')) ? Number(v) : null);

function failed(c: C, e: unknown, unreadable: string) {
  if (e instanceof GuideError) return refuse(c, e.status as any, { code: e.code, message: e.sentence });
  return refuse(c, 503, { code: 'guide_unavailable', message: unreadable, raw: e });
}

function runOptions(c: C, s: Scope, m: Material, segmentId: number | null): RunOptions {
  return {
    task: 'workspace_explain', userId: Number(s.user.id), text: draftPrompt(m, segmentId), maxTokens: 900,
    surface: AI_SURFACE.validateInterviews, rail: railFor(c, { page: GUIDE_PAGE, option: GUIDE_OPTION }, `project:${s.projectId}`),
  };
}

function segmentOf(b: Record<string, any>, m: Material): number | null {
  if (b.segment_id == null || b.segment_id === '') return null;
  const id = Number(b.segment_id);
  if (!m.segments.some((s) => s.id === id)) throw new GuideError(400, 'segment_not_found', 'Choose one of this venture\'s segments.');
  return id;
}

router.get('/', async (c) => {
  const s = await scope(c, false); if (s instanceof Response) return s;
  try {
    const [material, guide] = await Promise.all([guideMaterial(ctxOf(c, s.projectId)), readGuide(c.env, s.projectId)]);
    let assist: 'on' | 'off' | 'unknown';
    try { assist = (await assistOff(c.env, Number(s.user.id), GUIDE_PAGE)) ? 'off' : 'on'; } catch { assist = 'unknown'; }
    return c.json({
      material, guide,
      // V27 C: the labelled defaults, only while no hypothesis is open.
      defaults: material.hypotheses.length === 0 ? DEFAULT_QUESTIONS : [],
      ai: { assist }, can_write: s.writer,
    });
  } catch (e) { return failed(c, e, 'The guide couldn\'t be read. Recording still works.'); }
});

router.put('/', async (c) => {
  const s = await scope(c, true); if (s instanceof Response) return s;
  const b = await body(c);
  try {
    const [material, stored] = await Promise.all([guideMaterial(ctxOf(c, s.projectId)), readGuide(c.env, s.projectId)]);
    const questions = mergeSave(stored.questions, b.questions, refsOf(material));
    return c.json({ guide: await writeGuide(c.env, s.projectId, Number(s.user.id), questions, b.version) });
  } catch (e) { return failed(c, e, 'Couldn\'t save. Your questions are kept here.'); }
});

router.post('/draft/quote', async (c) => {
  const s = await scope(c, true); if (s instanceof Response) return s;
  try {
    const material = await guideMaterial(ctxOf(c, s.projectId));
    if (!material.hypotheses.length && !material.themes.length) throw new GuideError(409, 'nothing_to_draft', 'Eadwyn drafts from open hypotheses and themes. Use the default questions, or write your own.');
    const q = await guideDeps.quoteRun(c.env, runOptions(c, s, material, segmentOf(await body(c), material)));
    if (!q.ok) return refuseRun(c, q) ?? refuse(c, 503, { code: 'estimate_unreadable', message: 'The cost of this draft could not be worked out. Try again.' });
    return c.json({ estimate: { hold_microusd: q.hold_microusd, model: q.model } });
  } catch (e) { return failed(c, e, 'The cost of this draft could not be worked out. Try again.'); }
});

router.post('/draft', async (c) => {
  const s = await scope(c, true); if (s instanceof Response) return s;
  const b = await body(c);
  try {
    const material = await guideMaterial(ctxOf(c, s.projectId));
    if (!material.hypotheses.length && !material.themes.length) throw new GuideError(409, 'nothing_to_draft', 'Eadwyn drafts from open hypotheses and themes. Use the default questions, or write your own.');
    const segmentId = segmentOf(b, material);
    const opts = runOptions(c, s, material, segmentId);
    const q = await guideDeps.quoteRun(c.env, opts);
    if (!q.ok) return refuseRun(c, q) ?? refuse(c, 503, { code: 'estimate_unreadable', message: 'The cost of this draft could not be worked out. Try again.' });
    // The hold shown is the hold run: a draft without the current quote runs nothing.
    if (!b.quote || b.quote.hold_microusd !== q.hold_microusd || b.quote.model !== q.model) {
      return refuse(c, 409, { code: 'quote_changed', message: 'Read the current hold before drafting.', extra: { estimate: { hold_microusd: q.hold_microusd, model: q.model } } });
    }
    const out = await guideDeps.run(c.env, { ...opts, pinMicrousd: q.hold_microusd });
    const refused = refuseRun(c, out); if (refused) return refused;
    if (!out.ok) return refuse(c, 503, { code: 'draft_failed', message: 'Eadwyn couldn\'t draft questions. The held credit is released. Your questions are unchanged.' });
    const questions = parseDraft(String(out.output ?? ''), material);
    if (!questions) return refuse(c, 503, { code: 'draft_failed', message: 'Eadwyn couldn\'t draft questions. The run may still be charged. Your questions are unchanged.' });
    const { draft, receipt } = await draftReceipt(c.env, Number(s.user.id), s.projectId, segmentId, questions);
    return c.json({ draft: { questions: draft.questions, segment_id: segmentId }, receipt });
  } catch (e) { return failed(c, e, 'Eadwyn couldn\'t draft questions. Your questions are unchanged.'); }
});

router.post('/draft/accept', async (c) => {
  const s = await scope(c, true); if (s instanceof Response) return s;
  const b = await body(c);
  try {
    const p = await openReceipt(c.env, Number(s.user.id), s.projectId, b.receipt);
    const [material, stored] = await Promise.all([guideMaterial(ctxOf(c, s.projectId)), readGuide(c.env, s.projectId)]);
    const questions = acceptInto(stored.questions, p, b.ids, b.edits, refsOf(material));
    return c.json({ guide: await writeGuide(c.env, s.projectId, Number(s.user.id), questions, b.version) });
  } catch (e) { return failed(c, e, 'Couldn\'t save. Your questions are kept here.'); }
});

router.get('/copy/:interviewId', async (c) => {
  const s = await scope(c, false); if (s instanceof Response) return s;
  const id = interviewParam(c.req.param('interviewId'));
  if (id == null) return refuse(c, 400, { code: 'interview_required', message: 'Choose an interview.' });
  try { await interviewOf(c.env, s.projectId, id); return c.json({ copy: await readCopy(c.env, s.projectId, id) }); }
  catch (e) { return failed(c, e, 'The guide couldn\'t be read. Recording still works.'); }
});

router.post('/copy/:interviewId', async (c) => {
  const s = await scope(c, true); if (s instanceof Response) return s;
  const id = interviewParam(c.req.param('interviewId'));
  if (id == null) return refuse(c, 400, { code: 'interview_required', message: 'Choose an interview.' });
  try {
    const [material, guide] = await Promise.all([guideMaterial(ctxOf(c, s.projectId)), readGuide(c.env, s.projectId)]);
    return c.json({ copy: await copyOnto(c.env, s.projectId, id, Number(s.user.id), guide, material.hypotheses.length === 0) });
  } catch (e) { return failed(c, e, 'The guide couldn\'t be read. Recording still works.'); }
});

router.put('/copy/:interviewId/asked', async (c) => {
  const s = await scope(c, true); if (s instanceof Response) return s;
  const id = interviewParam(c.req.param('interviewId'));
  if (id == null) return refuse(c, 400, { code: 'interview_required', message: 'Choose an interview.' });
  const b = await body(c);
  try { return c.json({ copy: await markAsked(c.env, s.projectId, id, b.question_id, b.asked) }); }
  catch (e) { return failed(c, e, 'Couldn\'t mark it. Try again.'); }
});

export const mount = { path: '/api/cycles/validate/interview-guide', router: router };
export default router;
