/**
 * D1351 (#3566, part 2 of #3564) — the member's own contacts: LinkedIn's
 * Connections.csv imported on the server, the suggested duplicates it leaves
 * for the member to decide, and notes and follow-ups on a row of the book.
 * Mounted at `/api/contacts` ahead of the founder CRM (`contacts.ts`), on
 * paths that router does not use.
 *
 *   POST  /import/linkedin-csv[?preview=1]     multipart `file`; preview writes nothing
 *   GET   /import/reviews                       the member's pending suggestions
 *   POST  /import/reviews/:uid/:decision        merge | keep | dismiss
 *   GET   /book[?q=&page=]                         the member's own book, with each row's sources (D1352)
 *   GET   /book/:id/notes, POST /book/:id/notes        { body }
 *   GET   /book/:id/tasks, POST /book/:id/tasks        { title, due_on? }
 *   PATCH /book/:id/tasks/:uid                         { done }
 *
 * WHO. Any signed-in member, on their own book only: every statement binds
 * their id, and a row of anyone else's reads as not found. A support session
 * may not import or decide for the member it is looking at.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { refuse } from '../util/refusal';
import { isSupportSession } from '../integrations/providers/mercury';
import {
  MAX_CSV_BYTES, ReviewRefusal, addNote, addTask, bookOf, commitPlan, decideReview, notesOf, ownContact, ownRecords, parseConnectionsCsv,
  pendingReviews, planRows, previewOf, setTaskDone, tasksOf,
} from '../services/linkedinCsvImport';

const r = new Hono<{ Bindings: Env }>();

type Ctx = { user: User; support: boolean };
const handle = (fn: (c: any, ctx: Ctx) => Promise<Response>) => async (c: any) => {
  let user: User;
  try { user = (await requireAuth(c)) as User; } catch { return c.json({ detail: 'Unauthorized' }, 401); }
  try {
    return await fn(c, { user, support: await isSupportSession(c) });
  } catch (e) {
    if (e instanceof ReviewRefusal) return refuse(c, e.status, { code: e.code, message: e.sentence, audience: 'member' });
    console.error('[contact_imports] request failed', (e as Error)?.name);
    return refuse(c, 500, { code: 'contacts_failed', message: 'That could not finish. Nothing more was changed.', raw: e, audience: 'member' });
  }
};
const no = (c: any, status: number, code: string, message: string) => refuse(c, status, { code, message, audience: 'member' });
const writer = (c: any, ctx: Ctx) => (ctx.support ? no(c, 403, 'support_session', 'A support session cannot change this member’s contacts.') : null);
const idOf = (v: unknown) => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null; };

// ---------------------------------------------------------------- import

r.post('/import/linkedin-csv', handle(async (c, ctx) => {
  const preview = c.req.query('preview') === '1';
  if (!preview) { const w = writer(c, ctx); if (w) return w; }
  const declared = Number(c.req.header('content-length') || 0);
  if (declared > MAX_CSV_BYTES + 64 * 1024) return no(c, 413, 'file_too_large', 'That file is larger than 5 MB. Export Connections only, then try again.');
  let form: FormData;
  try { form = await c.req.formData(); } catch { return no(c, 400, 'no_file', 'Choose your Connections.csv file to import.'); }
  const file = form.get('file');
  if (!file || typeof file === 'string') return no(c, 400, 'no_file', 'Choose your Connections.csv file to import.');
  if (file.size > MAX_CSV_BYTES) return no(c, 413, 'file_too_large', 'That file is larger than 5 MB. Export Connections only, then try again.');
  const parsed = parseConnectionsCsv(await file.text());
  if (!parsed.header) return no(c, 422, 'not_linkedin_csv', 'That is not LinkedIn’s Connections.csv: it has no First Name and Last Name header.');
  const plan = planRows(parsed.rows, await ownRecords(c.env, ctx.user));
  if (preview) return c.json({ preview: previewOf(plan, parsed.truncated) });
  const job = await commitPlan(c.env, Number(ctx.user.id), plan);
  return c.json({ job, preview: previewOf(plan, parsed.truncated) }, 201);
}));

r.get('/import/reviews', handle(async (c, ctx) => c.json({ reviews: await pendingReviews(c.env, Number(ctx.user.id)) })));

r.post('/import/reviews/:uid/:decision', handle(async (c, ctx) => {
  const w = writer(c, ctx); if (w) return w;
  const decision = c.req.param('decision');
  if (!['merge', 'keep', 'dismiss'].includes(decision)) return no(c, 400, 'invalid', 'Merge, keep both or dismiss.');
  return c.json(await decideReview(c.env, Number(ctx.user.id), String(c.req.param('uid')), decision as 'merge' | 'keep' | 'dismiss'));
}));

// ---------------------------------------------------------------- notes and follow-ups

async function contactOr404(c: any, ctx: Ctx) {
  const id = idOf(c.req.param('id'));
  const row = id ? await ownContact(c.env, Number(ctx.user.id), id) : null;
  return row ? { id: Number(row.id) } : null;
}
const missing = (c: any) => no(c, 404, 'not_found', 'That contact is not in your book.');
const body = async (c: any): Promise<Record<string, any>> => { const b = await c.req.json().catch(() => ({})); return b && typeof b === 'object' && !Array.isArray(b) ? b : {}; };

// D1352 (#3567): the book itself, for Network › Relationships.
r.get('/book', handle(async (c, ctx) => {
  const page = idOf(c.req.query('page')) ?? 1;
  return c.json(await bookOf(c.env, Number(ctx.user.id), String(c.req.query('q') ?? ''), page));
}));
r.get('/book/:id/notes', handle(async (c, ctx) => {
  const k = await contactOr404(c, ctx); if (!k) return missing(c);
  return c.json({ notes: await notesOf(c.env, Number(ctx.user.id), k.id) });
}));
r.post('/book/:id/notes', handle(async (c, ctx) => {
  const w = writer(c, ctx); if (w) return w;
  const k = await contactOr404(c, ctx); if (!k) return missing(c);
  const text = String((await body(c)).body ?? '').trim();
  if (!text || text.length > 4000) return no(c, 400, 'invalid', 'A note is between 1 and 4,000 characters.');
  const uid = await addNote(c.env, Number(ctx.user.id), k.id, text);
  return c.json({ uid, notes: await notesOf(c.env, Number(ctx.user.id), k.id) }, 201);
}));

r.get('/book/:id/tasks', handle(async (c, ctx) => {
  const k = await contactOr404(c, ctx); if (!k) return missing(c);
  return c.json({ tasks: await tasksOf(c.env, Number(ctx.user.id), k.id) });
}));
r.post('/book/:id/tasks', handle(async (c, ctx) => {
  const w = writer(c, ctx); if (w) return w;
  const k = await contactOr404(c, ctx); if (!k) return missing(c);
  const b = await body(c);
  const title = String(b.title ?? '').trim();
  if (!title || title.length > 300) return no(c, 400, 'invalid', 'A follow-up needs a title of up to 300 characters.');
  const due = b.due_on == null || b.due_on === '' ? null : String(b.due_on);
  if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) return no(c, 400, 'invalid', 'A due date is written as YYYY-MM-DD.');
  const uid = await addTask(c.env, Number(ctx.user.id), k.id, title, due);
  return c.json({ uid, tasks: await tasksOf(c.env, Number(ctx.user.id), k.id) }, 201);
}));
r.patch('/book/:id/tasks/:uid', handle(async (c, ctx) => {
  const w = writer(c, ctx); if (w) return w;
  const k = await contactOr404(c, ctx); if (!k) return missing(c);
  const b = await body(c);
  if (typeof b.done !== 'boolean') return no(c, 400, 'invalid', 'Say whether the follow-up is done.');
  if (!(await setTaskDone(c.env, Number(ctx.user.id), k.id, String(c.req.param('uid')), b.done))) return no(c, 404, 'not_found', 'That follow-up is not here.');
  return c.json({ tasks: await tasksOf(c.env, Number(ctx.user.id), k.id) });
}));

export default r;
