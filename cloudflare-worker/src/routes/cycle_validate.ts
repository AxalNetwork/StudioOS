/**
 * D659 — `/api/cycles/validate`: the Validate cycle's shared read (#1469's
 * contract) and the manual writes for the records migration 440 added.
 *
 *   GET /overview?project=:pid
 *     → { cycle, question, figures: [Figure ×4], cards: [Card ×6, ×7 with Verdict], focus, meter, index }
 *       (D685 §5.12, D692: the phone's focus, the interviews meter and the
 *       index rows, in the shape all four cycles share (services/cycleFocus.ts);
 *       PUT /interviews-target sets the meter's monthly target)
 *   GET /modules/:slug?project=:pid&q=&filter=&sort=&page=
 *     → { module, card: Card, records: { cols, rows, total, page, page_size, filters, sorts, linkable }, parts }
 *       (D690 decisions 10 and 16: the canvas's filters and sorts, and `parts`,
 *       what the bottom sections draw, each part under its own store's gate)
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
 * (`canWrite`). An investor reaches nothing here. The Verdict card and the
 * Verdict module read check `canReadDecision` too (D693), so partners get
 * neither.
 */
import { Hono } from 'hono';
import { hasRecords } from '../services/records';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { canReadBoard, canReadDecision, canWrite, type ProjectRef } from './_founder_validate_helpers';
import { focusOf, indexOf, meterOf } from '../services/validateFocus';
import { part } from '../services/cycleFocus';
import {
  CYCLE, QUESTION, MODULES, CARD_FOR, RECORDS_FOR, figures, cards, recordQuery, loadMarketReadiness,
  type Ctx, type ModuleSlug,
} from '../services/cycleValidate';
import {
  WriterError, writeSegment, assignInterviewSegment, setInterviewStage, writeDemandSignal,
  setDemandSignalStatus, setWaitlistTarget, setInterviewsTarget, writeCompetitorMention, setMarketMark, addMarketSource,
  removeMarketSource, setHypothesisPlan, setEvidenceStrength,
  writeTheme, updateTheme, deleteTheme, updateSegment, addCompetitor, updateCompetitor, updateDemandSignal,
  createHypothesis, updateHypothesis,
} from '../services/validateWriters';
import { ownedRow } from '../services/records/owned';
import type { Store } from '../services/records/types';

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
  const decisions = canReadDecision(s.project, s.user);
  const [figs, cs] = await Promise.all([figures(ctx), cards(ctx, { decisions })]);
  // D685 §5.12, D692 — the phone's focus, meter and index rows. Each fails on
  // its own: an unreadable part is null, never a figure it did not read. The
  // focus reads the meter's count, so the two never disagree.
  const meter = await part('meter', () => meterOf(c.env, s.projectId, figs));
  const [focus, index] = await Promise.all([
    part('focus', () => focusOf(c.env, s.projectId, canWrite(s.project, s.user), cs, figs, meter)),
    part('index', () => indexOf(c.env, s.project, s.user, figs, cs)),
  ]);
  // D693 decision 7: whether this viewer may see decisions, so the page can
  // drop the Verdict tab for a partner instead of drawing a read that fails.
  return c.json({
    cycle: CYCLE, question: QUESTION, figures: figs, cards: cs, focus, meter, index,
    can_read_decisions: decisions,
  });
});

cycleValidate.get('/modules/:slug', async (c) => {
  const slug = c.req.param('slug') as ModuleSlug;
  const mod = MODULES.find((m) => m.slug === slug);
  if (!mod) return c.json({ detail: 'No such module', modules: MODULES.map((m) => m.slug) }, 404);
  const s = await scope(c, canReadBoard);
  if (s instanceof Response) return s;
  // D693 decision 7: decisions never reach anyone `canReadDecision` refuses,
  // so the Verdict read is refused before anything is read.
  if (slug === 'verdict' && !canReadDecision(s.project, s.user)) {
    return c.json({ detail: 'Partners do not see decisions.' }, 403);
  }
  // D690 decision 16: the viewer's write gate, which `parts.can_write`,
  // `parts.themes` and the Quotes rule read.
  const writer = canWrite(s.project, s.user);
  const ctx: Ctx = { ...ctxOf(c, s.projectId), canWrite: writer };
  const rq = recordQuery({ q: c.req.query('q'), filter: c.req.query('filter'), sort: c.req.query('sort'), page: c.req.query('page') });
  const card = await CARD_FOR[slug](ctx);
  // The records fail on their own too: a table that cannot be read says so
  // beside a card that could, and its parts go with it.
  let records: Record<string, unknown>;
  let parts: Record<string, unknown> = {};
  try {
    const { parts: p, ...rest } = await RECORDS_FOR[slug](ctx, rq);
    records = rest;
    parts = p ?? {};
  } catch (e) {
    console.warn('[cycle_validate] records unreadable:', slug, (e as Error)?.message);
    records = { state: 'unreadable', reason: `${mod.name} records could not be read`, cols: [], rows: [], total: null, page: rq.page, page_size: null };
  }
  return c.json({ module: { slug: mod.slug, name: mod.name, records_title: (mod as { records_title?: string }).records_title ?? null }, card,
    records: { ...records, linkable: hasRecords('validate') }, parts: { can_write: writer, ...parts },
    // D693 decision 7: every Validate module read says so too.
    can_read_decisions: canReadDecision(s.project, s.user) });
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
    // D690 (#1692) — New segment's five steps, its value source and Score against.
    const out = await writeSegment(c.env, {
      projectId: s.projectId, userId: Number(s.user.id), name: b.name, description: b.description, source: 'manual',
      who_they_are: b.who_they_are, context: b.context, job_to_be_done: b.job_to_be_done, urgency: b.urgency,
      value_promised: b.value_promised, value_source: b.value_source, score_since: b.score_since,
    });
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
    // A signal typed into the form is the founder's own: `manual`, confirmed
    // unless they say "To confirm". D690 (#1692): the writer refuses an amount
    // on a need-to-have mention or a waitlist sign-up.
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

// ---------------------------------------------------------------------------
// D690 (#1692) — the Add, Edit and Delete writes behind Validate's records
//
// Each takes `?project=`, answers the write gate, and runs `ownedRow` on its
// path id before the writer runs (decision 3): a record of another venture is
// a 404, never a 403 that confirms it exists. The writer checks every id the
// body names against this venture too.
// ---------------------------------------------------------------------------

/** The path id, proved to be this venture's record, or the 404 that refuses it. */
async function ownedParam(c: any, store: Store, raw: string | undefined, projectId: number, what: string): Promise<string | Response> {
  const id = String(raw ?? '');
  if (!await ownedRow(c.env, store, id, projectId)) return c.json({ detail: `${what} not found on this project` }, 404);
  return id;
}

cycleValidate.post('/themes', async (c) => {
  const s = await scope(c, canWrite);
  if (s instanceof Response) return s;
  const b = await body(c);
  try {
    return c.json(await writeTheme(c.env, { projectId: s.projectId, userId: Number(s.user.id), title: b.title, severity: b.severity, quotes: b.quotes, hypothesis_id: b.hypothesis_id }), 201);
  } catch (e) { return writeFailed(c, e); }
});

cycleValidate.patch('/themes/:id', async (c) => {
  const s = await scope(c, canWrite);
  if (s instanceof Response) return s;
  const id = await ownedParam(c, 'pain_groups', c.req.param('id'), s.projectId, 'Theme');
  if (id instanceof Response) return id;
  const b = await body(c);
  try {
    return c.json(await updateTheme(c.env, { projectId: s.projectId, userId: Number(s.user.id), themeId: Number(id), title: b.title, severity: b.severity }));
  } catch (e) { return writeFailed(c, e); }
});

cycleValidate.delete('/themes/:id', async (c) => {
  const s = await scope(c, canWrite);
  if (s instanceof Response) return s;
  const id = await ownedParam(c, 'pain_groups', c.req.param('id'), s.projectId, 'Theme');
  if (id instanceof Response) return id;
  try {
    await deleteTheme(c.env, { projectId: s.projectId, userId: Number(s.user.id), themeId: Number(id) });
    return c.json({ ok: true });
  } catch (e) { return writeFailed(c, e); }
});

cycleValidate.patch('/segments/:id', async (c) => {
  const s = await scope(c, canWrite);
  if (s instanceof Response) return s;
  const id = await ownedParam(c, 'customer_segments', c.req.param('id'), s.projectId, 'Segment');
  if (id instanceof Response) return id;
  const b = await body(c);
  try {
    return c.json(await updateSegment(c.env, {
      projectId: s.projectId, userId: Number(s.user.id), segmentId: Number(id), name: b.name, description: b.description,
      who_they_are: b.who_they_are, context: b.context, job_to_be_done: b.job_to_be_done, urgency: b.urgency,
      value_promised: b.value_promised, value_source: b.value_source, score_since: b.score_since,
    }));
  } catch (e) { return writeFailed(c, e); }
});

cycleValidate.post('/competitors', async (c) => {
  const s = await scope(c, canWrite);
  if (s instanceof Response) return s;
  const b = await body(c);
  try {
    const out = await addCompetitor(c.env, {
      projectId: s.projectId, userId: Number(s.user.id), name: b.name, company_ref: b.company_ref, directory_uid: b.directory_uid,
      kind: b.kind, watch: b.watch, why: b.why,
    });
    return c.json(out, out.added ? 201 : 200);
  } catch (e) { return writeFailed(c, e); }
});

cycleValidate.patch('/competitors/:id', async (c) => {
  const s = await scope(c, canWrite);
  if (s instanceof Response) return s;
  const id = await ownedParam(c, 'competitor_candidates', c.req.param('id'), s.projectId, 'Competitor');
  if (id instanceof Response) return id;
  const b = await body(c);
  try {
    await updateCompetitor(c.env, {
      projectId: s.projectId, userId: Number(s.user.id), candidateId: id, kind: b.kind, watch: b.watch, why: b.why,
      price_position: b.price_position, depth_position: b.depth_position,
    });
    return c.json({ ok: true });
  } catch (e) { return writeFailed(c, e); }
});

// A `signal-` record only: a `revenue-` record is the ledger's, a `waitlist-` record the person's own.
cycleValidate.patch('/demand-signals/:id', async (c) => {
  const s = await scope(c, canWrite);
  if (s instanceof Response) return s;
  const id = await ownedParam(c, 'demand_signals', c.req.param('id'), s.projectId, 'Signal');
  if (id instanceof Response) return id;
  const b = await body(c);
  try {
    return c.json(await updateDemandSignal(c.env, {
      projectId: s.projectId, userId: Number(s.user.id), signalId: Number(String(id).replace(/^signal-/, '')),
      kind: b.kind, who: b.who, amount_cents: b.amount_cents, currency: b.currency, period: b.period,
      signal_date: b.signal_date, status: b.status, note: b.note,
    }));
  } catch (e) { return writeFailed(c, e); }
});

cycleValidate.post('/hypotheses', async (c) => {
  const s = await scope(c, canWrite);
  if (s instanceof Response) return s;
  const b = await body(c);
  try {
    return c.json(await createHypothesis(c.env, {
      projectId: s.projectId, userId: Number(s.user.id), claim: b.claim, success_bar: b.success_bar, disproof: b.disproof,
      pain_group_ids: b.pain_group_ids, direction: b.direction, owner_user_id: b.owner_user_id, deadline: b.deadline,
    }), 201);
  } catch (e) { return writeFailed(c, e); }
});

cycleValidate.patch('/hypotheses/:id', async (c) => {
  const s = await scope(c, canWrite);
  if (s instanceof Response) return s;
  const id = await ownedParam(c, 'hypotheses', c.req.param('id'), s.projectId, 'Hypothesis');
  if (id instanceof Response) return id;
  const b = await body(c);
  try {
    return c.json(await updateHypothesis(c.env, {
      projectId: s.projectId, userId: Number(s.user.id), hypothesisId: Number(id), claim: b.claim, success_bar: b.success_bar,
      disproof: b.disproof, deadline: b.deadline, sprint: b.sprint, owner_user_id: b.owner_user_id,
      inconclusive: b.inconclusive, retired: b.retired,
    }));
  } catch (e) { return writeFailed(c, e); }
});

export default cycleValidate;
