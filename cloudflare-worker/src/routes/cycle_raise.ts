/**
 * D663 — `/api/cycles/raise`: the Raise cycle's shared read (#1469's
 * contract) and the writes for the records migration 442 added.
 *
 *   GET /overview?project=:pid
 *     → { cycle, question, figures: [Figure ×4], cards: [Card ×7], focus, meter, index }
 *       (D692: the phone's parts, in the shape all four cycles share; services/cycleFocus.ts)
 *   GET /modules/:slug?project=:pid&q=&filter=&sort=&page=
 *     → { module: { slug, name, records_title }, card: Card,
 *         records: { cols, rows, total, page, page_size, filters?, sorts?, add? }, parts? }
 *     Investor narrative's `parts.narrative` (D909): every version with its
 *     based-on, saved, by and read-by; the newest's check; the current deck.
 *     `{ state: 'unreadable' }` when it could not be read.
 *     The first sort is the default. Row ids are D691's (#1699): an item key,
 *     a version, a link, file or prospect id, a cap-table `h-`/`e-` key or
 *     `pool`, or a use-of-funds section key.
 *
 *   PUT   /readiness/:key            { score, evidence, missing? }
 *   POST  /readiness/rescore         { items?, since? }
 *   POST  /narrative-versions        { investor_type, start_from?, based_on_version?, one_liner?, why_now?, ask?, check_against? }
 *   PATCH /narrative-versions/:version   the same fields but start_from
 *   D908 (#2692): the narrative's own stores (`services/narrative/store.ts`).
 *   GET   /narrative/compare?a=&b=   → { a, b, pairs: [{ key, label, a: { body }, b: { body }, state }] }
 *   GET   /narrative/positioning?version=   → { core, overrides, effective }
 *   PUT   /narrative/positioning?version=   { kind, position?, text | null, source? }
 *   GET   /narrative/:version        → { version, meta, sections, positioning, bindings }, each part
 *                                      { state: 'ok', … } or { state: 'unreadable' }; 0 is the live deck
 *   PUT   /narrative/:version/sections/:section   { body?, audience_note?, position?, source?, bindings? }
 *   D1114 (#2994): POST /narrative/:version/sections/:section/draft  { mode: draft | shorten | plain, words? }
 *         one metered run under `draft:narrative-section` → { version, section, mode, text, removed }; writes nothing
 *   D914 (#2698): an admin reads the narrative read only (`services/narrative/adminRead.ts`).
 *   GET   /narrative/reads           → { reads: [{ id, reason, by: { name, kind }, created_at, expires_at }], mine, viewer }
 *   POST  /narrative/reads           { reason } an admin's reason for opening it; the founder sees it
 *   GET   /narrative/notes           → { notes: [{ id, version, body, author: { name, kind }, created_at }], viewer }
 *   POST  /narrative/notes           { body, version? } an admin's note, or the founder's answer
 *   An admin's narrative write answers 403 `admin_read_only`; their narrative
 *   reads (this module's read, `/narrative/*`, and its records) answer 403
 *   `read_reason_required` until they give a reason.
 *   D911 (#2695): Eadwyn's positioning proposal (`services/narrative/positioningDraft.ts`).
 *   GET   /narrative/positioning/draft   → { read_from, segments, competitors, withheld, proposals }
 *   POST  /narrative/positioning/draft?version=   one `rail_write` run → { proposals, removed, read_from, withheld }
 *   POST  /narrative/positioning/proposals/:uid   { decision: 'accept' | 'discard' } → { proposal, positioning? }

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
import { canWrite, canWritePitchDeck, type ProjectRef } from './_founder_validate_helpers';
import { CYCLE, QUESTION, MODULES, CARD_FOR, RECORDS_FOR, INVESTOR_TYPE_LABEL, figures, cards, callsHistory, narrativeHome, recordQuery, type Ctx, type ModuleSlug } from '../services/raiseCycle';
import {
  WriterError, scoreReadinessItem, rescoreReadiness, saveNarrativeVersion, updateNarrativeVersion, createDeckLink, updateDeckLink,
  addCapHolder, updateCapHolder, saveUseOfFunds, addProspect, updateProspect, setFileChecklistItem, setProspectNextStep,
} from '../services/raiseWriters';
import { hasRecords } from '../services/records';
import { NARRATIVE_SECTIONS, compareNarrative, readNarrative, readPositioning, readableVersion, saveNarrativeSection, savePositioning } from '../services/narrative/store';
import { InputError, giveReason, isAdmin, kindOf, listNotes, listReasons, narrativeAdminGate, postNote, type Mode } from '../services/narrative/adminRead';
import { raisePhone } from '../services/cycleFocus';
import {
  POSITIONING_OPTION, POSITIONING_PAGE, POSITIONING_SYSTEM, nothingToRead, positioningMaterial, positioningPrompt, readFrom, screenAnswer,
} from '../services/narrative/positioningDraft';
import { SECTION_MODES, SECTION_OPTION, SECTION_PAGE, SECTION_SYSTEM, needsWords, screenSection, sectionMaterial, sectionPrompt, type SectionMode } from '../services/narrative/sectionDraft';
import { decideRail, getRail, listRail, proposeRail, withdrawRail, type RailProposal } from '../services/railProposals';
import { run as aiRouterRun } from '../services/aiRouter';
import { AI_SURFACE } from '../services/aiSurfaces';
import { parseJsonLoose } from '../services/decks/autofill';
import { railFor, refuseRun } from '../util/railContext';
import { ensureTier } from '../middleware/requireTier';
import { logCycleWrite } from '../services/cycleActivity';
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
  if (!(/\/deck-links(?:\/|$)/.test(c.req.path) ? canWritePitchDeck(project, user) : canWrite(project, user))) return c.json({ detail: 'Forbidden' }, 403);
  return { user, projectId };
}

/** D914: `scope`, then the narrative's rule for an admin (read only, and only with a reason). */
async function narrativeScope(c: any, mode: Mode): Promise<{ user: User; projectId: number } | Response> {
  const s = await scope(c);
  if (s instanceof Response) return s;
  return (await narrativeAdminGate(c, s.user, s.projectId, mode)) ?? s;
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
  const s = slug === 'investor-narrative' ? await narrativeScope(c, 'read') : await scope(c);
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
  // D909 (#2693): Home's tiles, Needs you and the Versions tab. It fails on its own, never the module.
  if (slug === 'investor-narrative') {
    parts.narrative = await narrativeHome(ctx).catch((e) => {
      console.warn('[cycle_raise] narrative part unreadable:', (e as Error)?.message);
      return { state: 'unreadable', reason: 'The narrative versions could not be read' };
    });
  }
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
  const s = await narrativeScope(c, 'write');
  if (s instanceof Response) return s;
  const b = await body(c);
  try {
    // #1652's caller sends only investor_type, and still saves.
    return c.json(await saveNarrativeVersion(c.env, { projectId: s.projectId, userId: Number(s.user.id), startFrom: b.start_from, ...narrativeFields(b) }), 201);
  } catch (e) { return writeFailed(c, e); }
});

cycleRaise.patch('/narrative-versions/:version', async (c) => {
  const s = await narrativeScope(c, 'write');
  if (s instanceof Response) return s;
  const version = idParam(c.req.param('version'));
  if (version == null) return c.json({ detail: 'Version not found' }, 404);
  const b = await body(c);
  if ('start_from' in b) return c.json({ detail: 'Start from is set when the version is made' }, 400);
  try {
    return c.json(await updateNarrativeVersion(c.env, { projectId: s.projectId, userId: Number(s.user.id), version, ...narrativeFields(b) }));
  } catch (e) { return writeFailed(c, e); }
});

// ---------------------------------------------------------------------------
// D908 (#2692): the Investor narrative's sections, positioning and bindings
// ---------------------------------------------------------------------------

const unreadable = (c: any, e: unknown) => {
  if (e instanceof WriterError) return c.json({ detail: e.sentence }, e.status as any);
  console.error('[cycle_raise] narrative read failed:', (e as Error)?.message);
  return c.json({ detail: 'The narrative could not be read', code: 'unreadable' }, 503);
};

// Literal paths first: `compare` and `positioning` are not version numbers.
cycleRaise.get('/narrative/compare', async (c) => {
  const s = await narrativeScope(c, 'read');
  if (s instanceof Response) return s;
  try {
    return c.json(await compareNarrative(c.env, s.projectId, c.req.query('a'), c.req.query('b')));
  } catch (e) { return unreadable(c, e); }
});

cycleRaise.get('/narrative/positioning', async (c) => {
  const s = await narrativeScope(c, 'read');
  if (s instanceof Response) return s;
  try {
    const raw = c.req.query('version');
    const version = raw === undefined || raw === '' ? null : await readableVersion(c.env, s.projectId, raw);
    return c.json({ version, ...(await readPositioning(c.env, s.projectId, version === 0 ? null : version)) });
  } catch (e) { return unreadable(c, e); }
});

cycleRaise.put('/narrative/positioning', async (c) => {
  const s = await narrativeScope(c, 'write');
  if (s instanceof Response) return s;
  const b = await body(c);
  try {
    return c.json(await savePositioning(c.env, { projectId: s.projectId, userId: Number(s.user.id), version: c.req.query('version'), body: b }));
  } catch (e) { return writeFailed(c, e); }
});

// ---------------------------------------------------------------------------
// D911 (#2695): Eadwyn's positioning proposal. The run reads qualitative
// records only and drops any field that holds a digit; each field it keeps is
// one `ai_rail_proposals` row, accepted or discarded one at a time. Accept
// writes through `savePositioning` with Eadwyn as the source, so the store's
// own refusal of a digit holds again. Each Accept and Discard logs one row.
// ---------------------------------------------------------------------------

const positioningRecord = (projectId: number) => `project:${projectId}`;

/** A proposal as the page draws it: the field, its words, its uid. Never the model or the run. */
const proposalView = (p: RailProposal) => ({
  uid: p.uid,
  kind: String(p.payload.kind ?? ''),
  position: Number(p.payload.position ?? 0),
  text: String(p.payload.text ?? ''),
  version: p.payload.version == null ? null : Number(p.payload.version),
  created_at: p.created_at,
});

const listPart = (part: { state: string; items?: string[] }) => (part.state === 'ok' ? { state: 'ok', items: part.items } : { state: 'unreadable' });

cycleRaise.get('/narrative/positioning/draft', async (c) => {
  const s = await narrativeScope(c, 'read');
  if (s instanceof Response) return s;
  const m = await positioningMaterial(c.env, s.projectId);
  let proposals: ReturnType<typeof proposalView>[] | null = null;
  try {
    proposals = (await listRail(c.env, Number(s.user.id), { option: POSITIONING_OPTION, record: positioningRecord(s.projectId), status: 'proposed' })).map(proposalView);
  } catch (e) {
    console.warn('[cycle_raise] positioning proposals unreadable:', (e as Error)?.message);
  }
  return c.json({
    read_from: readFrom(m),
    segments: listPart(m.segments),
    competitors: listPart(m.competitors),
    withheld: m.withheld,
    proposals: proposals === null ? { state: 'unreadable' } : { state: 'ok', items: proposals },
  });
});

cycleRaise.post('/narrative/positioning/draft', async (c) => {
  const s = await narrativeScope(c, 'write');
  if (s instanceof Response) return s;
  // Owner question 4 (#2454) decides the plan gate. Until then, the old route's: `studio`.
  try { ensureTier(s.user, 'studio'); } catch (e) { if (e instanceof Response) return e; throw e; }
  const raw = c.req.query('version');
  let version: number | null = null;
  if (raw !== undefined && raw !== '') {
    try { version = await readableVersion(c.env, s.projectId, raw); } catch (e) { return writeFailed(c, e); }
    if (version === 0) return c.json({ detail: 'Version 0 is the live deck’s wording. Propose for the core, or for a saved version.' }, 409);
  }
  const m = await positioningMaterial(c.env, s.projectId);
  if (nothingToRead(m)) {
    return c.json({ code: 'nothing_to_read', detail: 'There is nothing in Validate or Build to propose from yet. Add a pain theme, a segment or your solution first.' }, 422);
  }
  const record = positioningRecord(s.projectId);
  const result = await aiRouterRun(c.env, {
    task: 'rail_write',
    userId: Number(s.user.id),
    surface: AI_SURFACE.raiseNarrative,
    rail: railFor(c, { page: POSITIONING_PAGE, option: POSITIONING_OPTION }, record),
    systemPrompt: POSITIONING_SYSTEM,
    messages: [{ role: 'user', content: positioningPrompt(m) }],
    temperature: 0.5,
    maxTokens: 700,
  });
  if (!result.ok || !result.output) {
    return refuseRun(c, result) || c.json({ code: 'ai_unavailable', detail: 'Eadwyn could not propose positioning just now. Try again.' }, 503);
  }
  const { fields, removed } = screenAnswer(parseJsonLoose<unknown>(result.output));
  // A new run replaces what the last one left open.
  await withdrawRail(c.env, Number(s.user.id), POSITIONING_OPTION, record);
  const proposals = [];
  for (const f of fields) {
    proposals.push(proposalView(await proposeRail(c.env, {
      userId: Number(s.user.id), page: POSITIONING_PAGE, option: POSITIONING_OPTION, record,
      kind: 'proposal', payload: { kind: f.kind, position: f.position, text: f.text, version }, model: result.usage?.model ?? null, usageLogId: result.usageLogId ?? null,
    })));
  }
  return c.json({ proposals, removed, read_from: readFrom(m), withheld: m.withheld });
});

cycleRaise.post('/narrative/positioning/proposals/:uid', async (c) => {
  const s = await narrativeScope(c, 'write');
  if (s instanceof Response) return s;
  const uid = String(c.req.param('uid') || '');
  const b = await body(c);
  const decision = b.decision;
  if (decision !== 'accept' && decision !== 'discard') return c.json({ detail: 'decision is accept or discard' }, 400);
  const userId = Number(s.user.id);
  const open = /^[0-9a-f-]{36}$/.test(uid) ? await getRail(c.env, userId, uid) : null;
  // Another member's proposal, another venture's, or another option's is not found.
  if (!open || open.rail_option !== POSITIONING_OPTION || open.record_ref !== positioningRecord(s.projectId)) return c.json({ detail: 'Proposal not found' }, 404);
  if (open.status !== 'proposed') return c.json({ detail: 'This proposal was already decided.' }, 409);
  const view = proposalView(open);
  try {
    if (decision === 'accept') {
      // The store writes the words, refuses a digit in Eadwyn's wording, and logs the row.
      const saved = await savePositioning(c.env, {
        projectId: s.projectId, userId, version: view.version ?? undefined,
        body: { kind: view.kind, position: view.position, text: view.text, source: { kind: 'eadwyn', ref: `ai_rail_proposals:${uid}` } },
      });
      const decided = await decideRail(c.env, userId, uid, 'accept');
      return c.json({ proposal: decided ? proposalView(decided) : view, decision, positioning: saved.positioning });
    }
    const decided = await decideRail(c.env, userId, uid, 'discard');
    if (!decided) return c.json({ detail: 'This proposal was already decided.' }, 409);
    await logCycleWrite(c.env, {
      projectId: s.projectId, userId, cycle: 'raise', module: 'investor-narrative', entityId: view.version,
      action: 'narrative_positioning_discarded',
      summary: `${view.version == null ? 'Core positioning' : `Version ${view.version} positioning`}: Eadwyn's ${view.kind.replace(/_/g, ' ')}${view.kind === 'line' ? ` ${view.position + 1}` : ''} discarded`,
    });
    return c.json({ proposal: proposalView(decided), decision });
  } catch (e) { return writeFailed(c, e); }
});


// D914 (#2698): the read reasons and the notes thread. Literal paths, before `/narrative/:version`.
const inputFailed = (c: any, e: unknown, what: string) => {
  if (e instanceof InputError) return c.json({ detail: e.sentence, code: e.code }, 400);
  if (e instanceof WriterError) return c.json({ detail: e.sentence }, e.status as any);
  console.error('[cycle_raise] narrative write failed:', what, (e as Error)?.message);
  return c.json({ detail: `The ${what} could not be saved` }, 500);
};

cycleRaise.get('/narrative/reads', async (c) => {

  const s = await scope(c);
  if (s instanceof Response) return s;
  try {
    return c.json({ ...(await listReasons(c.env, s.projectId, s.user)), viewer: await kindOf(c.env, s.user) });
  } catch (e) { return unreadable(c, e); }
});

cycleRaise.post('/narrative/reads', async (c) => {
  const s = await scope(c);
  if (s instanceof Response) return s;
  if (!isAdmin(s.user)) return c.json({ detail: 'Only an admin gives a reason for reading a narrative.' }, 403);
  const b = await body(c);
  try {
    return c.json({ read: await giveReason(c.env, s.projectId, s.user, b.reason) }, 201);
  } catch (e) { return inputFailed(c, e, 'reason'); }
});

cycleRaise.get('/narrative/notes', async (c) => {
  const s = await narrativeScope(c, 'read');
  if (s instanceof Response) return s;
  try {
    return c.json({ notes: await listNotes(c.env, s.projectId), viewer: await kindOf(c.env, s.user) });
  } catch (e) { return unreadable(c, e); }
});

// A note is not a narrative write: an admin with a reason posts it, as the founder answers it.
cycleRaise.post('/narrative/notes', async (c) => {
  const s = await narrativeScope(c, 'read');
  if (s instanceof Response) return s;
  const b = await body(c);
  try {
    const version = b.version === undefined || b.version === null ? null : await readableVersion(c.env, s.projectId, b.version);
    if (version === 0) return c.json({ detail: 'A note is on a saved version, or on the narrative as a whole.', code: 'invalid_version' }, 400);
    return c.json({ note: await postNote(c.env, s.projectId, s.user, b.body, version) }, 201);
  } catch (e) { return inputFailed(c, e, 'note'); }
});

cycleRaise.get('/narrative/:version', async (c) => {
  const s = await narrativeScope(c, 'read');
  if (s instanceof Response) return s;
  const raw = c.req.param('version');
  if (!/^(0|[1-9][0-9]{0,8})$/.test(raw)) return c.json({ detail: 'Version not found' }, 404);
  try {
    return c.json(await readNarrative(c.env, s.projectId, raw));
  } catch (e) { return unreadable(c, e); }
});

cycleRaise.put('/narrative/:version/sections/:section', async (c) => {
  const s = await narrativeScope(c, 'write');
  if (s instanceof Response) return s;
  const raw = c.req.param('version');
  if (!/^(0|[1-9][0-9]{0,8})$/.test(raw)) return c.json({ detail: 'Version not found' }, 404);
  const b = await body(c);
  try {
    return c.json(await saveNarrativeSection(c.env, { projectId: s.projectId, userId: Number(s.user.id), version: raw, section: c.req.param('section'), body: b }));
  } catch (e) {
    if (e instanceof WriterError && e.sentence === 'Unknown section') {
      return c.json({ detail: 'Unknown section', sections: NARRATIVE_SECTIONS.map((x) => x.key) }, 404);
    }
    return writeFailed(c, e);
  }
});

// D1114 (#2994): Story's "Ask Eadwyn ▾". One `rail_write` run under
// `draft:narrative-section`, metered like every rail option; it writes
// nothing. The founder accepts the words into the section and Save version
// writes them with Eadwyn as the source, where the store refuses a digit again.
const POSITIONING_WORDS: Record<string, string> = { one_liner: 'One-liner', elevator: 'Elevator pitch', category: 'Category', wedge: 'Wedge', line: 'Line' };

cycleRaise.post('/narrative/:version/sections/:section/draft', async (c) => {
  const s = await narrativeScope(c, 'write');
  if (s instanceof Response) return s;
  const raw = c.req.param('version');
  if (!/^(0|[1-9][0-9]{0,8})$/.test(raw)) return c.json({ detail: 'Version not found' }, 404);
  const b = await body(c);
  const mode = String(b.mode ?? 'draft') as SectionMode;
  if (!(SECTION_MODES as readonly string[]).includes(mode)) return c.json({ detail: 'mode is draft, shorten or plain' }, 400);
  let read: Awaited<ReturnType<typeof readNarrative>>;
  try { read = await readNarrative(c.env, s.projectId, raw); } catch (e) { return writeFailed(c, e); }
  if (read.version === 0) return c.json({ detail: 'Version 0 is the live deck’s wording. Change it in the deck, or in a saved version.' }, 409);
  if (read.sections.state !== 'ok') return c.json({ code: 'unreadable', detail: 'This version’s sections could not be read, so Eadwyn has nothing to work on. Try again.' }, 503);
  const sectionKey = String(c.req.param('section') || '');
  const section = (read.sections.items as Array<{ key: string; body: string | null }>).find((x) => x.key === sectionKey);
  // The words on the page, unsaved, are what the founder asks about; else the stored words.
  const words = typeof b.words === 'string' ? b.words.slice(0, 4000) : section?.body ?? '';
  const audience = read.meta.state === 'ok' && read.meta.investor_type ? INVESTOR_TYPE_LABEL[read.meta.investor_type] ?? null : null;
  const positioning = read.positioning.state === 'ok'
    ? (read.positioning.effective as Array<{ kind: string; text: string }>).filter((p) => POSITIONING_WORDS[p.kind]).map((p) => ({ label: POSITIONING_WORDS[p.kind], text: p.text }))
    : [];
  const m = section ? sectionMaterial(sectionKey, words, audience, positioning) : null;
  if (!m) return c.json({ detail: 'Unknown section', sections: NARRATIVE_SECTIONS.map((x) => x.key) }, 404);
  if (needsWords(mode, m)) return c.json({ code: 'nothing_to_read', detail: `There are no words in ${m.label} to ${mode === 'shorten' ? 'shorten' : 'put in plain words'} yet. Write some, or ask Eadwyn to draft it.` }, 422);
  const result = await aiRouterRun(c.env, {
    task: 'rail_write',
    userId: Number(s.user.id),
    surface: AI_SURFACE.raiseNarrative,
    rail: railFor(c, { page: SECTION_PAGE, option: SECTION_OPTION }, `narrative:${s.projectId}:${read.version}:${sectionKey}`),
    systemPrompt: SECTION_SYSTEM,
    messages: [{ role: 'user', content: sectionPrompt(mode, m) }],
    temperature: mode === 'draft' ? 0.5 : 0.3,
    maxTokens: 900,
  });
  if (!result.ok || !result.output) {
    return refuseRun(c, result) || c.json({ code: 'ai_unavailable', detail: 'Eadwyn could not write this just now. Nothing was charged. Try again.' }, 503);
  }
  const { text, removed } = screenSection(parseJsonLoose<unknown>(result.output), m.max);
  if (!text) return c.json({ code: 'nothing_kept', detail: 'Eadwyn’s words all held a number, so none was kept. Write this section yourself, and insert figures from your records.', removed }, 422);
  return c.json({ version: read.version, section: sectionKey, mode, text, removed });
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
