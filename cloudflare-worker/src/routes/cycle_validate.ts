/**
 * D659 — `/api/cycles/validate`: the Validate cycle's shared read (#1469's
 * contract) and the manual writes for the records migration 440 added.
 *
 *   GET /overview?project=:pid
 *     → { cycle, question, figures: [Figure ×4], cards: [Card ×6], focus, meter, index }
 *       (D685 §5.12: the phone's focus, the interviews meter, the index counts;
 *       PUT /interviews-target sets the meter's monthly target)
 *   GET /modules/:slug?project=:pid&q=&filter=&sort=&page=
 *     → { module, card: Card, records: { cols, rows, total, page, page_size } }
 *
 * The reads are `services/cycleValidate.ts`; the shapes and the five states
 * are `services/cycleCards.ts`. Every write below calls the one writer in
 * `services/validateWriters.ts` that the interview accept path (#1471) calls
 * too, and every writer records its actor.
 *
 * WHO. Reading is the founder board's audience — the venture's own (an
 * admitted Lab member on their own project included), admins and partners —
 * because every card is derived from the interviews those people may already
 * read (`canReadBoard`). Writing is the venture's own or an admin's
 * (`canWrite`). An investor reaches nothing here.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { canReadBoard, canWrite, type ProjectRef } from './_founder_validate_helpers';
import { focusOf, indexCountsOf, meterOf } from '../services/validateFocus';
import {
  CYCLE, QUESTION, MODULES, CARD_FOR, RECORDS_FOR, figures, cards, recordQuery, loadMarketReadiness,
  type Ctx, type ModuleSlug,
} from '../services/cycleValidate';
import {
  WriterError, writeSegment, assignInterviewSegment, setInterviewStage, writeDemandSignal,
  setDemandSignalStatus, setWaitlistTarget, setInterviewsTarget, writeCompetitorMention, setMarketMark, addMarketSource,
  removeMarketSource, setHypothesisPlan, setEvidenceStrength,
} from '../services/validateWriters';

const cycleValidate = new Hono<{ Bindings: Env }>();

const today = () => new Date().toISOString().slice(0, 10);

/** The project in `?project=`, and the caller, or the Response that refuses them. */
async function scope(c: any, gate: (p: ProjectRef, u: User) => boolean): Promise<{ user: User; projectId: number; project: ProjectRef } | Response> {
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
  if (!gate(project, user)) return c.json({ detail: 'Forbidden' }, 403);
  return { user, projectId, project };
}

const ctxOf = (c: any, projectId: number): Ctx => ({ env: c.env, projectId, today: today() });

/** A writer's refusal as its own status; anything else is a 500 that says so. */
function writeFailed(c: any, e: unknown) {
  if (e instanceof WriterError) return c.json({ detail: e.sentence }, e.status as any);
  console.error('[cycle_validate] write failed:', (e as Error)?.message);
  return c.json({ detail: 'The write failed' }, 500);
}

const idParam = (v: string | undefined): number | null => (/^[1-9][0-9]{0,9}$/.test(String(v ?? '')) ? Number(v) : null);

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

cycleValidate.get('/overview', async (c) => {
  const s = await scope(c, canReadBoard);
  if (s instanceof Response) return s;
  const ctx = ctxOf(c, s.projectId);
  const [figs, cs] = await Promise.all([figures(ctx), cards(ctx)]);
  // D685 §5.12 — the phone's focus, meter and index counts. Each fails on its
  // own: an unreadable part is null, never a figure it did not read.
  const part = async <T>(name: string, f: () => Promise<T>): Promise<T | null> => {
    try { return await f(); } catch (e) { console.warn('[cycle_validate] overview part unreadable:', name, (e as Error)?.message); return null; }
  };
  const [focus, meter, index] = await Promise.all([
    part('focus', () => focusOf(c.env, s.projectId, canWrite(s.project, s.user), cs)),
    part('meter', () => meterOf(c.env, s.projectId, figs)),
    part('index', () => indexCountsOf(c.env, s.projectId)),
  ]);
  return c.json({ cycle: CYCLE, question: QUESTION, figures: figs, cards: cs, focus, meter, index });
});

cycleValidate.get('/modules/:slug', async (c) => {
  const slug = c.req.param('slug') as ModuleSlug;
  const mod = MODULES.find((m) => m.slug === slug);
  if (!mod) return c.json({ detail: 'No such module', modules: MODULES.map((m) => m.slug) }, 404);
  const s = await scope(c, canReadBoard);
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
    console.warn('[cycle_validate] records unreadable:', slug, (e as Error)?.message);
    records = { state: 'unreadable', reason: `${mod.name} records could not be read`, cols: [], rows: [], total: null, page: rq.page, page_size: null };
  }
  return c.json({ module: { slug: mod.slug, name: mod.name, records_title: (mod as { records_title?: string }).records_title ?? null }, card, records });
});

/** The Lab market page's three stored checks. */
cycleValidate.get('/market-readiness', async (c) => {
  const s = await scope(c, canReadBoard);
  if (s instanceof Response) return s;
  try {
    return c.json(await loadMarketReadiness(ctxOf(c, s.projectId)));
  } catch (e) {
    console.warn('[cycle_validate] market readiness unreadable:', (e as Error)?.message);
    return c.json({ detail: 'Market readiness could not be read' }, 503);
  }
});

// ---------------------------------------------------------------------------
// Writes — each through its one writer
// ---------------------------------------------------------------------------

const body = async (c: any): Promise<Record<string, unknown>> => {
  const b = await c.req.json().catch(() => ({}));
  return b && typeof b === 'object' && !Array.isArray(b) ? b : {};
};

cycleValidate.post('/segments', async (c) => {
  const s = await scope(c, canWrite);
  if (s instanceof Response) return s;
  const b = await body(c);
  try {
    const out = await writeSegment(c.env, { projectId: s.projectId, userId: Number(s.user.id), name: b.name, description: b.description, source: 'manual' });
    return c.json(out, out.created ? 201 : 200);
  } catch (e) { return writeFailed(c, e); }
});

cycleValidate.put('/interviews/:id/segment', async (c) => {
  const s = await scope(c, canWrite);
  if (s instanceof Response) return s;
  const id = idParam(c.req.param('id'));
  if (id == null) return c.json({ detail: 'Invalid interview id' }, 400);
  const b = await body(c);
  const seg = b.segment_id == null || b.segment_id === '' ? null : idParam(String(b.segment_id));
  if (b.segment_id != null && b.segment_id !== '' && seg == null) return c.json({ detail: 'Invalid segment id' }, 400);
  try {
    await assignInterviewSegment(c.env, { projectId: s.projectId, userId: Number(s.user.id), interviewId: id, segmentId: seg });
    return c.json({ ok: true });
  } catch (e) { return writeFailed(c, e); }
});

cycleValidate.put('/interviews/:id/stage', async (c) => {
  const s = await scope(c, canWrite);
  if (s instanceof Response) return s;
  const id = idParam(c.req.param('id'));
  if (id == null) return c.json({ detail: 'Invalid interview id' }, 400);
  const b = await body(c);
  try {
    await setInterviewStage(c.env, { projectId: s.projectId, userId: Number(s.user.id), interviewId: id, stage: b.stage, at: b.at });
    return c.json({ ok: true });
  } catch (e) { return writeFailed(c, e); }
});

cycleValidate.post('/demand-signals', async (c) => {
  const s = await scope(c, canWrite);
  if (s instanceof Response) return s;
  const b = await body(c);
  try {
    // A signal typed into the form is the founder's own: `manual`, confirmed.
    const out = await writeDemandSignal(c.env, { ...b, kind: b.kind, projectId: s.projectId, userId: Number(s.user.id), source_kind: 'manual' });
    return c.json(out, 201);
  } catch (e) { return writeFailed(c, e); }
});

cycleValidate.put('/demand-signals/:id/status', async (c) => {
  const s = await scope(c, canWrite);
  if (s instanceof Response) return s;
  const id = idParam(c.req.param('id'));
  if (id == null) return c.json({ detail: 'Invalid signal id' }, 400);
  const b = await body(c);
  try {
    await setDemandSignalStatus(c.env, { projectId: s.projectId, userId: Number(s.user.id), signalId: id, status: b.status });
    return c.json({ ok: true });
  } catch (e) { return writeFailed(c, e); }
});

cycleValidate.put('/waitlist-target', async (c) => {
  const s = await scope(c, canWrite);
  if (s instanceof Response) return s;
  const b = await body(c);
  try {
    await setWaitlistTarget(c.env, { projectId: s.projectId, userId: Number(s.user.id), value: b.value === undefined ? undefined : b.value });
    return c.json({ ok: true });
  } catch (e) { return writeFailed(c, e); }
});

// D685 §5.12 — the monthly interviews target the meter reads; null clears it.
cycleValidate.put('/interviews-target', async (c) => {
  const s = await scope(c, canWrite);
  if (s instanceof Response) return s;
  const b = await body(c);
  try {
    await setInterviewsTarget(c.env, { projectId: s.projectId, userId: Number(s.user.id), value: b.value === undefined ? undefined : b.value });
    return c.json({ ok: true });
  } catch (e) { return writeFailed(c, e); }
});

cycleValidate.post('/competitor-mentions', async (c) => {
  const s = await scope(c, canWrite);
  if (s instanceof Response) return s;
  const b = await body(c);
  try {
    const out = await writeCompetitorMention(c.env, { ...b, name: b.name, projectId: s.projectId, userId: Number(s.user.id), source_kind: b.source_kind === 'web' ? 'web' : 'manual' });
    return c.json(out, 201);
  } catch (e) { return writeFailed(c, e); }
});

cycleValidate.put('/market-marks/:item', async (c) => {
  const s = await scope(c, canWrite);
  if (s instanceof Response) return s;
  const b = await body(c);
  if (typeof b.done !== 'boolean') return c.json({ detail: 'done must be true or false' }, 400);
  try {
    await setMarketMark(c.env, { projectId: s.projectId, userId: Number(s.user.id), item: c.req.param('item'), done: b.done });
    return c.json({ ok: true });
  } catch (e) { return writeFailed(c, e); }
});

cycleValidate.post('/market-sources', async (c) => {
  const s = await scope(c, canWrite);
  if (s instanceof Response) return s;
  const b = await body(c);
  try {
    return c.json(await addMarketSource(c.env, { projectId: s.projectId, userId: Number(s.user.id), title: b.title, url: b.url, kind: b.kind }), 201);
  } catch (e) { return writeFailed(c, e); }
});

cycleValidate.delete('/market-sources/:id', async (c) => {
  const s = await scope(c, canWrite);
  if (s instanceof Response) return s;
  const id = idParam(c.req.param('id'));
  if (id == null) return c.json({ detail: 'Invalid source id' }, 400);
  try {
    await removeMarketSource(c.env, { projectId: s.projectId, userId: Number(s.user.id), sourceId: id });
    return c.json({ ok: true });
  } catch (e) { return writeFailed(c, e); }
});

cycleValidate.put('/hypotheses/:id/plan', async (c) => {
  const s = await scope(c, canWrite);
  if (s instanceof Response) return s;
  const id = idParam(c.req.param('id'));
  if (id == null) return c.json({ detail: 'Invalid hypothesis id' }, 400);
  const b = await body(c);
  try {
    await setHypothesisPlan(c.env, {
      projectId: s.projectId, userId: Number(s.user.id), hypothesisId: id,
      sprint: b.sprint, owner_user_id: b.owner_user_id, inconclusive: b.inconclusive,
    });
    return c.json({ ok: true });
  } catch (e) { return writeFailed(c, e); }
});

cycleValidate.put('/evidence-links/:id/strength', async (c) => {
  const s = await scope(c, canWrite);
  if (s instanceof Response) return s;
  const id = idParam(c.req.param('id'));
  if (id == null) return c.json({ detail: 'Invalid link id' }, 400);
  const b = await body(c);
  try {
    await setEvidenceStrength(c.env, { projectId: s.projectId, userId: Number(s.user.id), linkId: id, strength: b.strength === undefined ? '' : b.strength });
    return c.json({ ok: true });
  } catch (e) { return writeFailed(c, e); }
});

export default cycleValidate;
