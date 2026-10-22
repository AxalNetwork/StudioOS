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
 *   PUT   /readiness/:key            { score, evidence, missing? }
 *   POST  /readiness/rescore         { items?, since? }
 *   POST  /narrative-versions        { investor_type, start_from?, based_on_version?, one_liner?, why_now?, ask?, check_against? }
 *   PATCH /narrative-versions/:version   the same fields but start_from
 *   POST  /deck-links                { deck_id, prospect_id | investor_label, expires_days: 7|14|30|null, allow_download?, allow_forwarding? }
 *   PATCH /deck-links/:id            investor, the two settings, an earlier expiry
 *   POST  /holders                   { name, group, instrument, shares | ownership_pct | amount_cents, cap_cents?, discount_pct?, vesting?, prospect_id? }
 *   PATCH /holders/:id               the same fields but group and instrument; :id is h-<n> or e-<n>
 *   PUT   /use-of-funds              { amount_to_raise_cents, sections: [{ key, pct, milestone_label?, milestone_by? }], runway_months }
 *   POST  /prospects                 { name | research_fund_uid, email?, stage, warm_path, next_step, next_step_due, notes }
 *   PATCH /prospects/:id             the same fields
 *   PUT   /data-room/files/:id/checklist  { item | null }
 *   PUT   /prospects/:id/next-step   { next_step, next_step_due, warm_path }
 *
 *   D840 part 2 (#2347): the founder's own Mercury feeds the modules.
 *   POST   /mercury/sync                  reads Mercury; writes facts and proposals → { counts }
 *   POST   /mercury/proposals/:id/accept  { section? }  lands it in its module
 *   POST   /mercury/proposals/:id/dismiss               never proposed again
 *   DELETE /mercury/facts/:id                           deleted; a re-sync never brings it back
 *   A module's read carries `parts.mercury` for the founder alone
 *   (`services/mercury/raiseFeeds.ts`).
 *
 * The reads are `services/raiseCycle.ts`; the writes are
 * `services/raiseWriters.ts` (D691, #1700), each logging one row per record
 * it writes through `logCycleWrite` (decision 12). Every id a route takes,
 * in its path or its body, is this venture's or the write answers 404.
 * Share links and holders keep their tool's plan gate (`ensureTier` 'studio',
 * decision 13), whose 402 the writer throws as a Response.
 *
 * WHO. Reading and writing are both the venture's own or an admin's
 * (`canWrite`). Unlike Validate's board, the Raise cards carry the cap table,
 * the investor pipeline and who opened the data room: what the pipeline, cap
 * table and data-room tools already keep to the venture and admins. An
 * investor or a partner reaches nothing here.
 *
 * MERCURY IS THE FOUNDER'S ALONE (D840). Its parts and its routes answer only
 * the project's own founder (`founder_id`, not an admin), in their active
 * company, outside a support session, from their own connection. Anyone
 * else's module read has no `parts.mercury`, and the routes answer 403.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { canWrite, type ProjectRef } from './_founder_validate_helpers';
import { CYCLE, QUESTION, MODULES, CARD_FOR, RECORDS_FOR, figures, cards, callsHistory, recordQuery, type Ctx, type ModuleSlug } from '../services/raiseCycle';
import {
  WriterError, scoreReadinessItem, rescoreReadiness, saveNarrativeVersion, updateNarrativeVersion, createDeckLink, updateDeckLink,
  addCapHolder, updateCapHolder, saveUseOfFunds, addProspect, updateProspect, setFileChecklistItem, setProspectNextStep,
} from '../services/raiseWriters';
import { hasRecords } from '../services/records';
import { raisePhone } from '../services/cycleFocus';
import {
  AcceptError, RAISE_PART_FOR, acceptRaiseProposal, deleteRaiseFact, dismissRaiseProposal, syncRaise,
} from '../services/mercury/raiseFeeds';
import { founderRaiseReads, founderMercuryConnection } from '../services/mercury/raiseAccess';
import { memberMercury } from '../services/mercury/memberConnection';
import { isSupportSession } from '../integrations/providers/mercury';
import { resolveActiveCompany, ACTIVE_COMPANY_HEADER } from '../middleware/activeCompany';
import { projectInActiveCompany } from '../services/tenancyScope';
import { HolderError } from '../services/capTableWrites';

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
  // The plan gate's refusal (`ensureTier`), with its upgrade body.
  if (e instanceof Response) return e;
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
    // D691 (#1699): each row links to its record once Raise's record service is registered (D696).
    records = { ...(await RECORDS_FOR[slug](ctx, rq)), linkable: hasRecords('raise') };
  } catch (e) {
    console.warn('[cycle_raise] records unreadable:', slug, (e as Error)?.message);
    records = { state: 'unreadable', reason: `${mod.name} records could not be read`, cols: [], rows: [], total: null, page: rq.page, page_size: null };
  }
  const parts: Record<string, unknown> = slug === 'capital-relationships' ? { calls: await callsHistory(ctx) } : {};
  // The Mercury part fails on its own: an owner check that cannot be read shows no part, never a failed module.
  // D882: the founder with no usable sign-in reads how to connect, never an empty figure.
  const founderOnly = await mercuryFounderOnly(c, s).catch(() => undefined);
  if (founderOnly === null && Object.hasOwn(RAISE_PART_FOR, slug)) {
    try {
      const connection = await memberMercury(c.env, Number(s.user.id));
      const conn = await founderMercuryConnection(c.env, s.user);
      parts.mercury = !conn
        ? { state: connection.state, reason: connection.sentence, connection }
        : { integration_uid: String(conn.uid), connection, ...(await RAISE_PART_FOR[slug](c.env, Number(conn.id), s.projectId) as object) };
    } catch { parts.mercury = { state: 'unreadable', reason: 'What Mercury fed this module could not be read' }; }
  }
  return c.json({ module: { slug: mod.slug, name: mod.name, records_title: mod.records_title }, card, records,
    ...(Object.keys(parts).length ? { parts } : {}) });
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
  // #1652's caller sends no body: every computed item.
  const b = await body(c);
  try {
    return c.json(await rescoreReadiness(c.env, { projectId: s.projectId, userId: Number(s.user.id), items: b.items, since: b.since }));
  } catch (e) { return writeFailed(c, e); }
});

const narrativeFields = (b: Record<string, unknown>) => ({
  investorType: b.investor_type, basedOnVersion: b.based_on_version, oneLiner: b.one_liner, whyNow: b.why_now, ask: b.ask, checkAgainst: b.check_against,
});

cycleRaise.post('/narrative-versions', async (c) => {
  const s = await scope(c);
  if (s instanceof Response) return s;
  const b = await body(c);
  try {
    // #1652's caller sends only investor_type, and still saves.
    return c.json(await saveNarrativeVersion(c.env, { projectId: s.projectId, userId: Number(s.user.id), startFrom: b.start_from, ...narrativeFields(b) }), 201);
  } catch (e) { return writeFailed(c, e); }
});

cycleRaise.patch('/narrative-versions/:version', async (c) => {
  const s = await scope(c);
  if (s instanceof Response) return s;
  const version = idParam(c.req.param('version'));
  if (version == null) return c.json({ detail: 'Version not found' }, 404);
  const b = await body(c);
  if ('start_from' in b) return c.json({ detail: 'Start from is set when the version is made' }, 400);
  try {
    return c.json(await updateNarrativeVersion(c.env, { projectId: s.projectId, userId: Number(s.user.id), version, ...narrativeFields(b) }));
  } catch (e) { return writeFailed(c, e); }
});

cycleRaise.post('/deck-links', async (c) => {
  const s = await scope(c);
  if (s instanceof Response) return s;
  const b = await body(c);
  try {
    return c.json(await createDeckLink(c.env, { projectId: s.projectId, user: s.user, body: b }), 201);
  } catch (e) { return writeFailed(c, e); }
});

cycleRaise.patch('/deck-links/:id', async (c) => {
  const s = await scope(c);
  if (s instanceof Response) return s;
  const id = idParam(c.req.param('id'));
  if (id == null) return c.json({ detail: 'Link not found' }, 404);
  const b = await body(c);
  try {
    return c.json(await updateDeckLink(c.env, { projectId: s.projectId, user: s.user, linkId: id, body: b }));
  } catch (e) { return writeFailed(c, e); }
});

cycleRaise.post('/holders', async (c) => {
  const s = await scope(c);
  if (s instanceof Response) return s;
  const b = await body(c);
  try {
    return c.json(await addCapHolder(c.env, { projectId: s.projectId, user: s.user, body: b }), 201);
  } catch (e) { return writeFailed(c, e); }
});

cycleRaise.patch('/holders/:id', async (c) => {
  const s = await scope(c);
  if (s instanceof Response) return s;
  const id = String(c.req.param('id') ?? '');
  if (!/^(h|e)-[1-9][0-9]{0,9}$/.test(id)) return c.json({ detail: 'Holder not found' }, 404);
  const b = await body(c);
  if ('group' in b || 'instrument' in b) return c.json({ detail: 'A holder keeps its group and instrument; add a new holder instead' }, 400);
  try {
    return c.json(await updateCapHolder(c.env, { projectId: s.projectId, user: s.user, id, body: b }));
  } catch (e) { return writeFailed(c, e); }
});

cycleRaise.put('/use-of-funds', async (c) => {
  const s = await scope(c);
  if (s instanceof Response) return s;
  const b = await body(c);
  try {
    return c.json(await saveUseOfFunds(c.env, { projectId: s.projectId, userId: Number(s.user.id), body: b }));
  } catch (e) { return writeFailed(c, e); }
});

cycleRaise.post('/prospects', async (c) => {
  const s = await scope(c);
  if (s instanceof Response) return s;
  const b = await body(c);
  try {
    return c.json(await addProspect(c.env, { projectId: s.projectId, userId: Number(s.user.id), body: b }), 201);
  } catch (e) { return writeFailed(c, e); }
});

cycleRaise.patch('/prospects/:id', async (c) => {
  const s = await scope(c);
  if (s instanceof Response) return s;
  const id = idParam(c.req.param('id'));
  if (id == null) return c.json({ detail: 'Prospect not found' }, 404);
  const b = await body(c);
  try {
    return c.json(await updateProspect(c.env, { projectId: s.projectId, userId: Number(s.user.id), prospectId: id, body: b }));
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

// ---------------------------------------------------------------------------
// D840 part 2 — the founder's own Mercury
// ---------------------------------------------------------------------------

/** The project's own founder, in their active company, outside a support session: null, or the refusal. */
async function mercuryFounderOnly(c: any, s: { user: User; projectId: number }): Promise<Response | null> {
  const p = await c.env.DB.prepare('SELECT founder_id, company_id FROM projects WHERE id = ?').bind(s.projectId)
    .first() as { founder_id: number | null; company_id: number | null } | null;
  if (!p || p.founder_id == null || s.user.founder_id == null || Number(s.user.founder_id) !== Number(p.founder_id)) {
    return c.json({ error: 'mercury_owner_only', detail: 'Only the startup’s founder reads its Mercury, from their own connection.' }, 403);
  }
  const company = await resolveActiveCompany(c.env, s.user, c.req.header(ACTIVE_COMPANY_HEADER));
  if (!projectInActiveCompany(company, p)) return c.json({ error: 'mercury_owner_only', detail: 'Switch to this startup’s company first.' }, 403);
  if (await isSupportSession(c)) return c.json({ error: 'support_session_refused', detail: 'A support session cannot read a member’s bank account.' }, 403);
  return null;
}

/** The project's own founder, as `mercuryFounderOnly`, with their own connection. */
async function mercuryOwner(c: any, s: { user: User; projectId: number }): Promise<{ integrationId: number; uid: string } | Response> {
  const refused = await mercuryFounderOnly(c, s);
  if (refused) return refused;
  const conn = await founderMercuryConnection(c.env, s.user);
  if (!conn) return c.json({ error: 'mercury_not_connected', detail: 'Sign in with Mercury first.' }, 409);
  return { integrationId: Number(conn.id), uid: String(conn.uid) };
}

const OUTCOME_STATUS = (o: { status: number }) => o.status as any;

cycleRaise.post('/mercury/sync', async (c) => {
  const s = await scope(c);
  if (s instanceof Response) return s;
  const own = await mercuryOwner(c, s);
  if (own instanceof Response) return own;
  const reads = await founderRaiseReads(c.env, s.user);
  if (!reads.ok) return c.json({ error: reads.code, detail: reads.message }, reads.status as any);
  try {
    const counts = await syncRaise(c.env, own.integrationId, s.projectId, reads.reads, today());
    await reads.log('mercury_raise_sync', counts);
    return c.json({ ok: true, counts });
  } catch (e) {
    // Counts and a code only: no Mercury figure reaches a log.
    console.error('[cycle_raise] mercury sync failed:', (e as { code?: string })?.code ?? 'error');
    return c.json({ error: 'mercury_sync_failed', detail: 'Mercury could not be read. Nothing changed; try again.' }, 502);
  }
});

cycleRaise.post('/mercury/proposals/:id/accept', async (c) => {
  const s = await scope(c);
  if (s instanceof Response) return s;
  const id = idParam(c.req.param('id'));
  if (id == null) return c.json({ detail: 'Proposal not found' }, 404);
  const own = await mercuryOwner(c, s);
  if (own instanceof Response) return own;
  const b = await body(c);
  // Only a statement needs Mercury again: its bytes.
  const kind = (await c.env.DB.prepare('SELECT kind FROM mercury_raise_proposals WHERE id = ? AND integration_id = ? AND project_id = ?')
    .bind(id, own.integrationId, s.projectId).first()) as { kind: string } | null;
  const reads = kind?.kind === 'statement' ? await founderRaiseReads(c.env, s.user) : null;
  if (reads && !reads.ok) return c.json({ error: reads.code, detail: reads.message }, reads.status as any);
  try {
    const out = await acceptRaiseProposal(c.env, {
      integrationId: own.integrationId, projectId: s.projectId, id, user: s.user, reads: reads?.ok ? reads.reads : null, section: b.section,
    });
    if (!out.ok) return c.json({ error: out.code, detail: out.message }, OUTCOME_STATUS(out));
    return c.json(out);
  } catch (e) {
    if (e instanceof HolderError) return c.json({ detail: e.sentence }, e.status as any);
    if (e instanceof AcceptError) return c.json({ error: e.code, detail: e.sentence }, e.status as any);
    return writeFailed(c, e);
  }
});

cycleRaise.post('/mercury/proposals/:id/dismiss', async (c) => {
  const s = await scope(c);
  if (s instanceof Response) return s;
  const id = idParam(c.req.param('id'));
  if (id == null) return c.json({ detail: 'Proposal not found' }, 404);
  const own = await mercuryOwner(c, s);
  if (own instanceof Response) return own;
  const out = await dismissRaiseProposal(c.env, { integrationId: own.integrationId, projectId: s.projectId, id, user: s.user });
  if (!out.ok) return c.json({ error: out.code, detail: out.message }, OUTCOME_STATUS(out));
  return c.json(out);
});

cycleRaise.delete('/mercury/facts/:id', async (c) => {
  const s = await scope(c);
  if (s instanceof Response) return s;
  const id = idParam(c.req.param('id'));
  if (id == null) return c.json({ detail: 'Fact not found' }, 404);
  const own = await mercuryOwner(c, s);
  if (own instanceof Response) return own;
  if (!(await deleteRaiseFact(c.env, { integrationId: own.integrationId, projectId: s.projectId, id }))) return c.json({ detail: 'Fact not found' }, 404);
  return c.json({ ok: true });
});

export default cycleRaise;
