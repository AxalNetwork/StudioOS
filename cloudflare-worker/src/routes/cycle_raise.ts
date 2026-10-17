/**
 * D663 — `/api/cycles/raise`: the Raise cycle's shared read (#1469's
 * contract) and the writes for the records migration 442 added.
 *
 *   GET /overview?project=:pid
 *     → { cycle, question, figures: [Figure ×4], cards: [Card ×7], focus, meter, index }
 *       (D692: the phone's parts, in the shape all four cycles share; services/cycleFocus.ts)
 *   GET /modules/:slug?project=:pid&q=&filter=&sort=&page=
 *     → { module: { slug, name, records_title }, card: Card,
 *         records: { cols, rows, total, page, page_size, filters?, sorts?, add? } }
 *     The first sort is the default. Row ids are D691's (#1699): an item key,
 *     a version, a link, file or prospect id, a cap-table `h-`/`e-` key or
 *     `pool`, or a use-of-funds section key.
 *
 *   PUT  /readiness/:key            { score, evidence, missing? }
 *   POST /readiness/rescore
 *   POST /narrative-versions        { investor_type }
 *   PUT  /data-room/files/:id/checklist  { item | null }
 *   PUT  /prospects/:id/next-step   { next_step, next_step_due, warm_path }
 *
 * The reads are `services/raiseCycle.ts`; the writes are
 * `services/raiseWriters.ts`, each recording its actor.
 *
 * WHO. Reading and writing are both the venture's own or an admin's
 * (`canWrite`). Unlike Validate's board, the Raise cards carry the cap table,
 * the investor pipeline and who opened the data room: what the pipeline, cap
 * table and data-room tools already keep to the venture and admins. An
 * investor or a partner reaches nothing here.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { canWrite, type ProjectRef } from './_founder_validate_helpers';
import { CYCLE, QUESTION, MODULES, CARD_FOR, RECORDS_FOR, figures, cards, callsHistory, recordQuery, type Ctx, type ModuleSlug } from '../services/raiseCycle';
import {
  WriterError, scoreReadinessItem, rescoreReadiness, saveNarrativeVersion, setFileChecklistItem, setProspectNextStep,
} from '../services/raiseWriters';
import { raisePhone } from '../services/cycleFocus';

const cycleRaise = new Hono<{ Bindings: Env }>();

const today = () => new Date().toISOString().slice(0, 10);

/** The project in `?project=`, and the caller, or the Response that refuses them. */
async function scope(c: any): Promise<{ user: User; projectId: number } | Response> {
  let user: User;
  try {
    user = (await requireAuth(c)) as User;
  } catch {
    return c.json({ detail: 'Unauthorized' }, 401);
  }
  const raw = String(c.req.query('project') ?? '');
  if (!/^[1-9][0-9]{0,9}$/.test(raw)) return c.json({ detail: 'project is required' }, 400);
  const projectId = Number(raw);
  const project = (await c.env.DB.prepare('SELECT id, founder_id FROM projects WHERE id = ?')
    .bind(projectId).first()) as ProjectRef | null;
  if (!project) return c.json({ detail: 'Project not found' }, 404);
  if (!canWrite(project, user)) return c.json({ detail: 'Forbidden' }, 403);
  return { user, projectId };
}

const ctxOf = (c: any, projectId: number): Ctx => ({ env: c.env, projectId, today: today() });

function writeFailed(c: any, e: unknown) {
  if (e instanceof WriterError) return c.json({ detail: e.sentence }, e.status as any);
  console.error('[cycle_raise] write failed:', (e as Error)?.message);
  return c.json({ detail: 'The write failed' }, 500);
}

const idParam = (v: string | undefined): number | null => (/^[1-9][0-9]{0,9}$/.test(String(v ?? '')) ? Number(v) : null);

const body = async (c: any): Promise<Record<string, unknown>> => {
  const b = await c.req.json().catch(() => ({}));
  return b && typeof b === 'object' && !Array.isArray(b) ? b : {};
};

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

cycleRaise.get('/overview', async (c) => {
  const s = await scope(c);
  if (s instanceof Response) return s;
  const ctx = ctxOf(c, s.projectId);
  const [figs, cs] = await Promise.all([figures(ctx), cards(ctx)]);
  return c.json({ cycle: CYCLE, question: QUESTION, figures: figs, cards: cs, ...(await raisePhone(ctx, figs, cs)) });
});

cycleRaise.get('/modules/:slug', async (c) => {
  const slug = c.req.param('slug') as ModuleSlug;
  const mod = MODULES.find((m) => m.slug === slug);
  if (!mod) return c.json({ detail: 'No such module', modules: MODULES.map((m) => m.slug) }, 404);
  const s = await scope(c);
  if (s instanceof Response) return s;
  const ctx = ctxOf(c, s.projectId);
  const rq = recordQuery({ q: c.req.query('q'), filter: c.req.query('filter'), sort: c.req.query('sort'), page: c.req.query('page') });
  const card = await CARD_FOR[slug](ctx);
  // The records fail on their own too: a table that cannot be read says so
  // beside a card that could.
  let records: unknown;
  try {
    records = await RECORDS_FOR[slug](ctx, rq);
  } catch (e) {
    console.warn('[cycle_raise] records unreadable:', slug, (e as Error)?.message);
    records = { state: 'unreadable', reason: `${mod.name} records could not be read`, cols: [], rows: [], total: null, page: rq.page, page_size: null };
  }
  return c.json({ module: { slug: mod.slug, name: mod.name, records_title: mod.records_title }, card, records,
    ...(slug === 'capital-relationships' ? {parts:{calls:await callsHistory(ctx)}} : {}) });
});

// ---------------------------------------------------------------------------
// Writes — each through its one writer
// ---------------------------------------------------------------------------

cycleRaise.put('/readiness/:key', async (c) => {
  const s = await scope(c);
  if (s instanceof Response) return s;
  const b = await body(c);
  try {
    return c.json(await scoreReadinessItem(c.env, { projectId: s.projectId, userId: Number(s.user.id), key: c.req.param('key'), score: b.score, evidence: b.evidence, missing: b.missing }));
  } catch (e) { return writeFailed(c, e); }
});

cycleRaise.post('/readiness/rescore', async (c) => {
  const s = await scope(c);
  if (s instanceof Response) return s;
  try {
    return c.json(await rescoreReadiness(c.env, { projectId: s.projectId, userId: Number(s.user.id) }));
  } catch (e) { return writeFailed(c, e); }
});

cycleRaise.post('/narrative-versions', async (c) => {
  const s = await scope(c);
  if (s instanceof Response) return s;
  const b = await body(c);
  try {
    return c.json(await saveNarrativeVersion(c.env, { projectId: s.projectId, userId: Number(s.user.id), investorType: b.investor_type }), 201);
  } catch (e) { return writeFailed(c, e); }
});

cycleRaise.put('/data-room/files/:id/checklist', async (c) => {
  const s = await scope(c);
  if (s instanceof Response) return s;
  const id = idParam(c.req.param('id'));
  if (id == null) return c.json({ detail: 'Invalid file id' }, 400);
  const b = await body(c);
  try {
    return c.json(await setFileChecklistItem(c.env, { projectId: s.projectId, userId: Number(s.user.id), fileId: id, item: b.item }));
  } catch (e) { return writeFailed(c, e); }
});

cycleRaise.put('/prospects/:id/next-step', async (c) => {
  const s = await scope(c);
  if (s instanceof Response) return s;
  const id = idParam(c.req.param('id'));
  if (id == null) return c.json({ detail: 'Invalid prospect id' }, 400);
  const b = await body(c);
  try {
    return c.json(await setProspectNextStep(c.env, {
      projectId: s.projectId, userId: Number(s.user.id), prospectId: id,
      next_step: b.next_step, next_step_due: b.next_step_due, warm_path: b.warm_path,
    }));
  } catch (e) { return writeFailed(c, e); }
});

export default cycleRaise;
