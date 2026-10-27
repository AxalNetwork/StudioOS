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
 *   POST  /readiness/rescore         { items?, since?, pmf? }
 *   GET   /pmf/history?project=&limit=&before=  stored Product-market fit points
 *   D1146 (#3032): GET /pmf/model?project=  → { version, stored, scored_with, published_at, model, grades }, RD4's model
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
 *   D913 (#2697): the objections investors raised (`services/narrative/objections.ts`, `objectionDraft.ts`).
 *   GET   /narrative/objections      → { objections: [{ key, text, count, prospects, last_heard, answer, answered }], capped, answers }
 *   PUT   /narrative/objections/:objection/answer  { version, section, how: eadwyn | picked } → { objection, answered }
 *   DELETE /narrative/objections/:objection/answer → { objection, answered: null }   (migration 624)
 *   POST  /narrative/objections/:objection/draft  { version, section, words? }
 *         one metered run under `draft:narrative-objection` → { version, section, objection, text, removed }; writes nothing
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
 *   POST   /mercury/proposals/:id/accept  { section?, discount_bps? }  lands it in its module (D1025: a SAFE's discount)
 *   POST   /mercury/proposals/:id/dismiss               never proposed again
 *   DELETE /mercury/facts/:id                           deleted; a re-sync never brings it back
 *   A module's read carries `parts.mercury` for the founder alone
 *   (`services/mercury/raiseFeeds.ts`).
 *
 *   D1094 (#2959): the member's chosen Google files and calendar feed the modules.
 *   POST   /google/sync                  reads the chosen files and the calendar → { counts }
 *   POST   /google/proposals/:id/accept  a deck version (Pitch deck) or a "last met" meeting (Capital relationships)
 *   POST   /google/proposals/:id/dismiss               never proposed again
 *   DELETE /google/facts/:id                           a data-room copy; a re-sync never copies it again
 *   Pitch deck, Data room and Capital relationships carry `parts.google` for the
 *   member's own connection (`services/google/raise.ts`).
 *
 *   D1190 (#3124): Capital relationships' two reads (`services/capRelReads.ts`).
 *   GET /capital-relationships/commitments?project=   one read across the stores:
 *     → { currency, round, totals, investors: [{ key, prospect_id, name, chosen, lines }], sources, words, basis }
 *     Mercury's matched credits only for the venture's founder (`mercuryFounderOnly`).
 *   GET /capital-relationships/match?project=&q=&hq_country=&focus=&size_band=&fit=&warm=1&sort=&limit=&offset=
 *     → the fund directory's answer, each fund with `fit`, `warm_paths`, `in_pipeline`;
 *       `verified_investors: { count }`, never names. `stage` is refused (400), as the directory refuses it.
 *
 *   D1193 (#3127): Outreach, Activity and Eadwyn's proposals (`services/capRelTabs.ts`).
 *   GET  /capital-relationships/activity?project=&q=&kind=&investor=&page=   every logged change, 25 a page
 *   GET  /capital-relationships/materials?project=   per investor: deck link, data room (its owner alone), call
 *   GET  /capital-relationships/proposals?project=   the caller's open proposals and drafts
 *   POST /capital-relationships/proposals            { prospect_id, event_id }  one run over a logged note
 *   POST /capital-relationships/proposals/:uid/accept { edited? }  written through the one prospect writer
 *   POST /capital-relationships/drafts               { prospect_id, purpose, via? }  one run; the founder sends it
 *   A draft or proposal is edited or dismissed through `/api/ai/rail/proposals/:uid/decide`.
 *
 * The reads are `services/raiseCycle.ts`; the writes are
 * `services/raiseWriters.ts` (D691, #1700), each logging one row per record
 * it writes through `logCycleWrite` (decision 12). Every id a route takes,
 * in its path or its body, is this venture's or the write answers 404.
 * Share links and holders keep their tool's plan gate (`ensureTier` 'studio',
 * decision 13), whose 402 the writer throws as a Response.
 *
 * D1191: Capital relationships instead admits accepted co-founder editors.
 * Staff get a count-only summary; a separate reasoned support response records
 * the founder-visible audit before private SQL and never grants later access.
 *
 * WHO (the other modules). Reading and writing are both the venture's own or an admin's
 * (`canWrite`). Unlike Validate's board, the Raise cards carry the cap table,
 * the investor pipeline and who opened the data room: what the pipeline, cap
 * table and data-room tools already keep to the venture and admins. An
 * investor or a partner reaches nothing here.
 *
 * THE DATA ROOM IS ITS OWNER'S (D1102, #2982). Its paths here take D1102's
 * owner-only rule (`dataRoomOwner`), so an admin is not treated as the owner:
 * the overview's data-room card is the room's summary for anyone but the owner
 * (counts and recorded checklist coverage, no file names, investors or access
 * rows); `GET /modules/data-room` answers an admin 403 `support_read_required`
 * (the audited `POST /api/data-room/:projectUid/support-read`) and anyone else
 * 403; `PUT /data-room/files/:id/checklist` answers anyone but the owner 403.
 *
 * MERCURY IS THE FOUNDER'S ALONE (D840). Its parts and its routes answer only
 * the project's own founder (`founder_id`, not an admin), in their active
 * company, outside a support session, from their own connection. Anyone
 * else's module read has no `parts.mercury`, and the routes answer 403.
 */
import { ClaimNoteError, noteText, setClaimNote } from '../services/raiseClaimNotes';
import { narrativeClaims } from '../services/narrativeClaims';
import { checkNarrativeVersion } from '../services/raiseClaims';
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth, selectJwt } from '../auth';
import { canWrite, canWritePitchDeck, type ProjectRef } from './_founder_validate_helpers';
import { CYCLE, QUESTION, MODULES, CARD_FOR, RECORDS_FOR, INVESTOR_TYPE_LABEL, figures, nonCapitalFigures, cards, callsHistory, narrativeHome, recordQuery, type Ctx, type ModuleSlug } from '../services/raiseCycle';
import {
  WriterError, scoreReadinessItem, rescoreReadiness, saveNarrativeVersion, updateNarrativeVersion, createDeckLink, updateDeckLink,
  addCapHolder, updateCapHolder, addProspect, updateProspect, setFileChecklistItem, setProspectNextStep,
  importProspects,
} from '../services/raiseWriters';
import { hasRecords } from '../services/records';
import { NARRATIVE_SECTIONS, compareNarrative, readNarrative, readPositioning, readableVersion, saveNarrativeSection, savePositioning } from '../services/narrative/store';
import { InputError, giveReason, isAdmin, kindOf, listNotes, listReasons, narrativeAdminGate, postNote, type Mode } from '../services/narrative/adminRead';
import { raisePhone } from '../services/cycleFocus';
import {
  POSITIONING_OPTION, POSITIONING_PAGE, POSITIONING_SYSTEM, nothingToRead, positioningMaterial, positioningPrompt, readFrom, screenAnswer,
} from '../services/narrative/positioningDraft';
import { SECTION_MODES, SECTION_OPTION, SECTION_PAGE, SECTION_SYSTEM, needsWords, screenSection, sectionMaterial, sectionPrompt, type SectionMode } from '../services/narrative/sectionDraft';
import { readObjections, type Objection } from '../services/narrative/objections';
import { OBJECTION_OPTION, OBJECTION_SYSTEM, objectionPrompt } from '../services/narrative/objectionDraft';
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
import {
  RAISE_GOOGLE_SLUGS, acceptRaiseGoogleProposal, calendarEventDays, deleteRaiseGoogleCopy, dismissRaiseGoogleProposal, raiseGooglePart, syncRaiseGoogle,
} from '../services/google/raise';
import { WorkspaceError, workspaceRead } from '../services/google/workspace';
import { workspaceContext } from './google_workspace';
import { founderRaiseReads, founderMercuryConnection } from '../services/mercury/raiseAccess';
import { memberMercury } from '../services/mercury/memberConnection';
import { isSupportSession } from '../integrations/providers/mercury';
import { resolveActiveCompany, ACTIVE_COMPANY_HEADER } from '../middleware/activeCompany';
import { projectInActiveCompany } from '../services/tenancyScope';
import { HolderError } from '../services/capTableWrites';
import { MatchQueryError, commitmentsRead, matchRead } from '../services/capRelReads';
import { CapRelTabError, DRAFT_OPTION, NOTE_OPTION, PROPOSAL_PAGE, acceptProposal, activityRead, draftMessage, materialsRead, proposalsRead, proposeFromNote, prospectRecord } from '../services/capRelTabs';
import { recomputePmf, pmfHistory, pmfModelRead } from '../services/scoring/pmfStore';
import { dataRoomOwner, roomSummary } from './data_room';
import { safeCard, type Card } from '../services/cycleCards';
import { refuse } from '../util/refusal';
import {
  CapitalAccessError, capitalCanWork, capitalPage, capitalRequestPath, capitalStaff, capitalStaffRequestAllowed, capitalStudioSummary,
  capitalSummary, capitalSupportDetails, capitalSupportHistory, recordCapitalSupport,
} from '../services/capRelAccess';
import useOfFunds from './cycle_use_of_funds';
import { RaiseEvidenceError, raiseEvidenceContext, readRaiseEvidence, acceptItem as acceptEvidenceItem, dismissItem as dismissEvidenceItem, setSharing as setEvidenceSharing, linkClaim as linkEvidenceClaim, previewEvidence, type RaiseEvidenceContext } from '../services/raiseEvidence';

const cycleRaise = new Hono<{ Bindings: Env }>();
cycleRaise.route('/use-of-funds', useOfFunds);

const today = () => new Date().toISOString().slice(0, 10);
const capitalPath = (path: string) => /\/(?:capital-relationships|prospects)(?:\/|$)/.test(path);

function capitalFailure(c: any, error: unknown): Response {
  if (error instanceof Error && error.message === 'Unauthorized') return c.json({ detail: 'Unauthorized' }, 401);
  if (error instanceof CapitalAccessError) return refuse(c, error.status as any, { code: error.code, message: error.sentence });
  return refuse(c, 503, { code: 'capital_unreadable', message: 'Capital relationships could not be read. Try again.' });
}

/** The project in `?project=`, and the caller, or the Response that refuses them. */
async function scope(c: any): Promise<{ user: User; projectId: number; project: ProjectRef } | Response> {
  let user: User;
  try {
    user = (await requireAuth(c)) as User;
  } catch {
    return c.json({ detail: 'Unauthorized' }, 401);
  }
  const raw = String(c.req.query('project') ?? '');
  if (!/^[1-9][0-9]{0,9}$/.test(raw)) return c.json({ detail: 'project is required' }, 400);
  const projectId = Number(raw);
  let path: string;
  try { path = capitalRequestPath(c.req.path); } catch (error) { return capitalFailure(c, error); }
  const project = (await c.env.DB.prepare(capitalPath(path) || path.endsWith('/overview')
    ? 'SELECT id, founder_id FROM projects WHERE id = ? AND deleted_at IS NULL' : 'SELECT id, founder_id FROM projects WHERE id = ?')
    .bind(projectId).first()) as ProjectRef | null;
  if (!project) return c.json({ detail: 'Project not found' }, 404);
  if ((capitalPath(path) || path.endsWith('/overview')) && await isSupportSession(c)) {
    return refuse(c, 403, { code: 'support_session_refused', message: 'Use your own staff account and give a reason for a support read.' });
  }
  if (capitalPath(path)) {
    if (capitalStaff(user)) {
      if (!capitalStaffRequestAllowed(c.req.method, c.req.path)) return refuse(c, 403, c.req.method === 'GET'
        ? { code: 'support_read_required', message: 'Give a reason for a read-only support view.' }
        : { code: 'admin_read_only', message: 'Staff read a summary or make a reasoned support read. They do not change the pipeline.' });
    } else {
      try { if (!await capitalCanWork(c.env, project, user)) return c.json({ detail: 'Forbidden' }, 403); }
      catch (error) { return capitalFailure(c, error); }
    }
    return { user, projectId, project };
  }
  if (!(/\/deck-links(?:\/|$)/.test(c.req.path) ? canWritePitchDeck(project, user) : canWrite(project, user))) return c.json({ detail: 'Forbidden' }, 403);
  return { user, projectId, project };
}

// ---------------------------------------------------------------------------
// D1102 (#2982): the data room's own paths here answer its owner alone
// ---------------------------------------------------------------------------

/**
 * `canWrite` admits an admin, so `scope` alone would treat one as the room's
 * owner. The data-room paths below add D1102's owner-only rule
 * (`dataRoomOwner`, the helper `routes/data_room.ts` and the shared record
 * module use): the overview's data-room card, the module read and the
 * checklist write. Every other path in this file keeps `scope`'s rule.
 */
const isRoomOwner = (s: { user: User; project: ProjectRef }) => dataRoomOwner(s.project, s.user as any);

/** The module read's refusal: an admin is pointed at the audited support read, as `/data-room/shared` does. */
function roomReadRefused(c: any, s: { user: User; project: ProjectRef }): Response | null {
  if (isRoomOwner(s)) return null;
  if (isAdmin(s.user)) return refuse(c, 403, { code: 'support_read_required', message: 'Use an audited support read to open this room.' });
  return c.json({ detail: 'Forbidden' }, 403);
}

const SUMMARY_ROWS: Array<[string, (s: any) => unknown, 'files' | 'coverage' | 'grants']> = [
  ['Files', (b) => b.total, 'files'],
  ['Files gated by NDA', (b) => b.nda, 'files'],
  ['Checklist items with a tagged file', (b) => `${b.covered_items} of ${b.total_items}`, 'coverage'],
  ['Active grants', (b) => b.active, 'grants'],
];

/**
 * The data-room card for anyone the overview admits who is not the room's
 * owner: D1102's summary (counts and recorded checklist coverage), never the
 * owner's card, which names who opened the room. A block that could not be
 * read says "Unreadable" on its own row; all of them failing is an
 * unreadable card. It proposes no action: the room's actions are the owner's.
 */
function roomSummaryCard(env: Env, projectId: number): Promise<Card> {
  return safeCard({
    slug: 'data-room', name: 'Data room', range: 'All files', source: 'The data room summary',
    caption: 'Counts and checklist tags only. File names, investors and access rows stay with the founder.',
  }, async () => {
    const summary: any = await roomSummary(env, { id: projectId, uid: '' });
    const blocks = [summary.files, summary.coverage, summary.grants];
    if (!blocks.some((b) => b?.available === true)) throw new Error('Data room summary unavailable');
    const items = SUMMARY_ROWS.map(([label, value, block]) => ({
      label, value: summary[block]?.available === true ? value(summary[block]) : 'Unreadable',
    }));
    return { state: 'ok', series: [{ kind: 'rows', items }], next: null, reason: null };
  });
}

async function capitalSummaryCard(env: Env, projectId: number): Promise<Card> {
  const summary = await capitalSummary(env, projectId);
  return { slug: 'capital-relationships', name: 'Capital relationships', range: 'This venture', source: 'Pipeline counts',
    caption: 'Summary only. A support read needs a reason the founder can see.', next: null,
    state: summary.state === 'unreadable' ? 'unreadable' : summary.total === 0 ? 'empty' : 'ok', reason: summary.reason,
    series: summary.state === 'unreadable' ? null : [{ kind: 'rows', items: summary.stages.map(row => ({ label: row.stage.replace(/_/g, ' '), value: row.count })) }] };
}

/** D914: `scope`, then the narrative's rule for an admin (read only, and only with a reason). */
async function narrativeScope(c: any, mode: Mode): Promise<{ user: User; projectId: number; project: ProjectRef } | Response> {
  const s = await scope(c);
  if (s instanceof Response) return s;
  return (await narrativeAdminGate(c, s.user, s.projectId, mode)) ?? s;
}

async function pmfActor(c: any, user: User): Promise<number> {
  const actor = (await selectJwt(c))?.payload.impersonated_by;
  return typeof actor === 'number' && Number.isSafeInteger(actor) && actor > 0 ? actor : Number(user.id);
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
  if (capitalStaff(s.user)) {
    const [figs, cs] = await Promise.all([nonCapitalFigures(ctx), Promise.all(MODULES.map(m =>
      m.slug === 'capital-relationships' ? capitalSummaryCard(c.env, s.projectId)
        : m.slug === 'data-room' ? roomSummaryCard(c.env, s.projectId) : CARD_FOR[m.slug](ctx)))]);
    return c.json({ cycle: CYCLE, question: QUESTION, mode: 'summary', read_only: true, figures: figs, cards: cs });
  }
  // D1102: the data-room card is the owner's; anyone else reads the room's summary there.
  // The other six cards are built as `cards()` builds them.
  const cardsRead = isRoomOwner(s) ? cards(ctx)
    : Promise.all(MODULES.map((m) => (m.slug === 'data-room' ? roomSummaryCard(c.env, s.projectId) : CARD_FOR[m.slug](ctx))));
  const [figs, cs] = await Promise.all([figures(ctx), cardsRead]);
  return c.json({ cycle: CYCLE, question: QUESTION, figures: figs, cards: cs, ...(await raisePhone(ctx, figs, cs)) });
});

cycleRaise.get('/modules/:slug', async (c) => {
  const slug = c.req.param('slug') as ModuleSlug;
  const mod = MODULES.find((m) => m.slug === slug);
  if (!mod) return c.json({ detail: 'No such module', modules: MODULES.map((m) => m.slug) }, 404);
  const s = slug === 'investor-narrative' ? await narrativeScope(c, 'read') : await scope(c);
  if (s instanceof Response) return s;
  if (slug === 'capital-relationships' && capitalStaff(s.user)) {
    const summary = await capitalSummary(c.env, s.projectId);
    const rows = summary.stages.map(row => ({ id: `summary-${row.stage}`, cells: { stage: row.stage.replace(/_/g, ' '), count: row.count } }));
    if (summary.state === 'ok') rows.push({ id: 'summary-unrecorded', cells: { stage: 'Status not recorded', count: summary.status_not_recorded } });
    return c.json({ module: { slug: mod.slug, name: mod.name, records_title: 'Pipeline counts' }, mode: 'summary', read_only: true,
      card: await capitalSummaryCard(c.env, s.projectId), summary,
      records: { state: summary.state, reason: summary.reason, cols: [{ key: 'stage', label: 'Stage' }, { key: 'count', label: 'Investors' }],
        rows, total: summary.state === 'ok' ? rows.length : null, page: 1, page_size: 25, linkable: false } });
  }
  // D1102: the room's files and who opened it are its owner's; refused before anything is read.
  if (slug === 'data-room') {
    const refused = roomReadRefused(c, s);
    if (refused) return refused;
  }
  const ctx = ctxOf(c, s.projectId);
  const rq = recordQuery({ q: c.req.query('q'), filter: c.req.query('filter'), sort: c.req.query('sort'), page: c.req.query('page') });
  let pmf: unknown;
  if (slug === 'fundraising-readiness') {
    try { pmf = await recomputePmf(c.env, s.projectId, await pmfActor(c, s.user), 'module_read', ctx.today); }
    catch { pmf = { state: 'unreadable', reason: 'Product-market fit could not be read' }; }
  }
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
  if (pmf) parts.pmf = pmf;
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
  // D1094: what Google fed this module, for the member's own connection. It fails on its own.
  if ((RAISE_GOOGLE_SLUGS as readonly string[]).includes(slug)) {
    try {
      const own = await googleOwner(c, s);
      if (!(own instanceof Response)) parts.google = await raiseGooglePart(c.env, { integrationId: own.integration.id, userId: Number(s.user.id), projectId: s.projectId, slug });
    } catch { parts.google = { state: 'unreadable', reason: 'What Google fed this module could not be read' }; }
  }
  return c.json({ module: { slug: mod.slug, name: mod.name, records_title: mod.records_title }, card, records,
    ...(Object.keys(parts).length ? { parts } : {}) });
});

// D1190 (#3124): Commitments and Match, each one read. The module's gate (`scope`) applies.
cycleRaise.get('/capital-relationships/summary', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!capitalStaff(user) || await isSupportSession(c)) return c.json({ detail: 'Forbidden' }, 403);
    const raw = c.req.query('project');
    const projectId = raw == null ? null : idParam(raw);
    if (raw != null && projectId == null) return c.json({ detail: 'Invalid project' }, 400);
    return c.json(await capitalStudioSummary(c.env, projectId, capitalPage(c.req.query('page'))));
  } catch (error) { return capitalFailure(c, error); }
});

cycleRaise.post('/capital-relationships/support-read', async (c) => {
  try {
    const s = await scope(c);
    if (s instanceof Response) return s;
    const input = await body(c);
    const prospectId = input.prospect_id == null ? null : idParam(String(input.prospect_id));
    if (input.prospect_id != null && prospectId == null) return c.json({ detail: 'Invalid investor' }, 400);
    if (prospectId != null && !await c.env.DB.prepare('SELECT 1 FROM raise_prospects WHERE id = ? AND project_id = ?').bind(prospectId, s.projectId).first()) return c.json({ detail: 'Investor not found' }, 404);
    const page = capitalPage(input.page);
    const auditId = await recordCapitalSupport(c.env, s.user, s.project, input.reason, { page, prospect_id: prospectId });
    return c.json({ ...(await capitalSupportDetails(c.env, s.projectId, page, prospectId)), audit_id: auditId });
  } catch (error) { return capitalFailure(c, error); }
});

cycleRaise.get('/capital-relationships/support-reads', async (c) => {
  try {
    const s = await scope(c);
    if (s instanceof Response) return s;
    if (!await capitalCanWork(c.env, s.project, s.user)) return c.json({ detail: 'Forbidden' }, 403);
    return c.json(await capitalSupportHistory(c.env, s.projectId, capitalPage(c.req.query('page'))));
  } catch (error) { return capitalFailure(c, error); }
});

cycleRaise.get('/capital-relationships/commitments', async (c) => {
  const s = await scope(c);
  if (s instanceof Response) return s;
  if (capitalStaff(s.user)) return refuse(c, 403, { code: 'support_read_required', message: 'Give a reason for a read-only support view.' });
  // Mercury is the founder's alone: an owner check that cannot be read reads as not the founder.
  const founderOnly = await mercuryFounderOnly(c, s).catch(() => undefined);
  try {
    return c.json(await commitmentsRead(c.env, s.projectId, founderOnly === null ? Number(s.user.id) : null));
  } catch (e) {
    console.error('[cycle_raise] commitments unreadable:', (e as Error)?.name || 'error');
    return c.json({ state: 'unreadable', detail: 'The commitments could not be read. Try again.' }, 500);
  }
});

cycleRaise.get('/capital-relationships/match', async (c) => {
  const s = await scope(c);
  if (s instanceof Response) return s;
  if (capitalStaff(s.user)) return refuse(c, 403, { code: 'support_read_required', message: 'Give a reason for a read-only support view.' });
  try {
    return c.json(await matchRead(c.env, { projectId: s.projectId, callerUserId: Number(s.user.id), get: (k) => c.req.query(k) }));
  } catch (e) {
    if (e instanceof MatchQueryError) return c.json({ detail: e.sentence, field: e.field }, 400);
    console.error('[cycle_raise] match unreadable:', (e as Error)?.name || 'error');
    return c.json({ state: 'unreadable', detail: 'The fund directory could not be read. Try again.' }, 500);
  }
});

// D1193 (#3127): Outreach, Activity and Eadwyn's proposals. `scope` admits the
// venture's founder and accepted co-founders, and refuses staff (D1191).
function capRelTabFailed(c: any, e: unknown, what: string): Response {
  if (e instanceof CapRelTabError) return c.json({ code: e.code, detail: e.sentence, ...(e.field ? { field: e.field } : {}) }, e.status);
  if (e instanceof WriterError) return writeFailed(c, e);
  console.error('[cycle_raise] capital-relationships failed:', what, (e as Error)?.name || 'error');
  return c.json({ state: 'unreadable', detail: 'That could not be done just now. Try again.' }, 500);
}

cycleRaise.get('/capital-relationships/activity', async (c) => {
  const s = await scope(c);
  if (s instanceof Response) return s;
  try { return c.json(await activityRead(c.env, s.projectId, (k) => c.req.query(k))); } catch (e) { return capRelTabFailed(c, e, 'activity'); }
});

cycleRaise.get('/capital-relationships/materials', async (c) => {
  const s = await scope(c);
  if (s instanceof Response) return s;
  try { return c.json(await materialsRead(c.env, s.projectId, isRoomOwner(s))); } catch (e) { return capRelTabFailed(c, e, 'materials'); }
});

cycleRaise.get('/capital-relationships/proposals', async (c) => {
  const s = await scope(c);
  if (s instanceof Response) return s;
  try { return c.json(await proposalsRead(c.env, s.projectId, Number(s.user.id))); } catch (e) { return capRelTabFailed(c, e, 'proposals'); }
});

cycleRaise.post('/capital-relationships/proposals', async (c) => {
  const s = await scope(c);
  if (s instanceof Response) return s;
  const b = await body(c);
  try {
    const record = Number.isSafeInteger(Number(b.prospect_id)) && Number(b.prospect_id) > 0 ? prospectRecord(Number(b.prospect_id)) : null;
    const rail = railFor(c, { page: PROPOSAL_PAGE, option: NOTE_OPTION }, record);
    const { result, proposals } = await proposeFromNote(c.env, s.projectId, Number(s.user.id), b, rail);
    if (!proposals) return refuseRun(c, result) || refuse(c, 503, { code: 'ai_unavailable', message: 'Eadwyn could not read that note just now. Try again.' });
    return c.json({ proposals });
  } catch (e) { return capRelTabFailed(c, e, 'proposals run'); }
});

cycleRaise.post('/capital-relationships/proposals/:uid/accept', async (c) => {
  const s = await scope(c);
  if (s instanceof Response) return s;
  const uid = c.req.param('uid');
  if (!/^[0-9a-f-]{36}$/i.test(uid)) return c.json({ code: 'unknown_proposal', detail: 'That proposal is no longer open.' }, 404);
  const b = await body(c);
  const edited = b.edited && typeof b.edited === 'object' && !Array.isArray(b.edited) ? b.edited as Record<string, unknown> : null;
  try { return c.json(await acceptProposal(c.env, s.projectId, Number(s.user.id), uid, edited)); } catch (e) { return capRelTabFailed(c, e, 'accept'); }
});

cycleRaise.post('/capital-relationships/drafts', async (c) => {
  const s = await scope(c);
  if (s instanceof Response) return s;
  const b = await body(c);
  try {
    const record = Number.isSafeInteger(Number(b.prospect_id)) && Number(b.prospect_id) > 0 ? prospectRecord(Number(b.prospect_id)) : null;
    const rail = railFor(c, { page: PROPOSAL_PAGE, option: DRAFT_OPTION }, record);
    const { result, draft, dropped } = await draftMessage(c.env, s.projectId, Number(s.user.id), b, rail);
    if (dropped) return c.json({ code: 'draft_dropped', detail: 'Eadwyn’s draft named a figure, so it was not kept. Try again, or write it yourself.' }, 422);
    if (!draft) return refuseRun(c, result) || refuse(c, 503, { code: 'ai_unavailable', message: 'Eadwyn could not draft that just now. Try again.' });
    return c.json({ draft }, 201);
  } catch (e) { return capRelTabFailed(c, e, 'draft run'); }
});

cycleRaise.get('/pmf/history', async (c) => {
  const s = await scope(c);
  if (s instanceof Response) return s;
  const limit = Number(c.req.query('limit') ?? 200);
  const raw = c.req.query('before');
  const before = raw == null ? null : idParam(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500 || (raw != null && before == null)) return c.json({ detail: 'Invalid history page' }, 400);
  try { return c.json(await pmfHistory(c.env, s.projectId, limit, before)); }
  catch { return c.json({ state: 'unreadable', detail: 'Product-market fit history could not be read', reason: 'Product-market fit history could not be read' }, 503); }
});

cycleRaise.get('/pmf/model', async (c) => {
  const s = await scope(c);
  if (s instanceof Response) return s;
  try { return c.json(await pmfModelRead(c.env, s.projectId)); }
  catch { return c.json({ state: 'unreadable', detail: 'How Product-market fit is scored could not be read', reason: 'How Product-market fit is scored could not be read' }, 503); }
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
    return c.json(await rescoreReadiness(c.env, { projectId: s.projectId, userId: b.pmf === true ? await pmfActor(c, s.user) : Number(s.user.id), items: b.items, since: b.since, pmf: b.pmf }));
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

// D913 (#2697, NAR10): the objections investors raised, project-wide, so Home
// and Story draw them with no version open (`services/narrative/objections.ts`).
cycleRaise.get('/narrative/objections', async (c) => {
  const s = await narrativeScope(c, 'read');
  if (s instanceof Response) return s;
  try {
    const read = await readObjections(c.env, s.projectId);
    return c.json({ objections: read.items, capped: read.capped, answers: read.answers });
  } catch (e) { return unreadable(c, e); }
});

// D913 option A (migration 624): which saved version and section answers an
// objection. `eadwyn` is set by Story's Save after an accepted "Answer it"
// draft; `picked` by the founder choosing the section by hand. One row per
// objection: a later answer replaces the earlier one. The log row names the
// section and version only, never the objection's words or who raised it.
const HOW_LABEL = { eadwyn: 'Eadwyn’s draft, saved', picked: 'picked by hand' } as const;

async function objectionOf(c: any, projectId: number, key: string): Promise<Objection | Response> {
  if (!/^[0-9a-f]{16}$/.test(key)) return c.json({ detail: 'Objection not found' }, 404) as Response;
  let objection: Objection | undefined;
  try { objection = (await readObjections(c.env, projectId)).items.find((o) => o.key === key); } catch (e) { return unreadable(c, e) as Response; }
  return objection ?? (c.json({ detail: 'Objection not found' }, 404) as Response);
}

cycleRaise.put('/narrative/objections/:objection/answer', async (c) => {
  const s = await narrativeScope(c, 'write');
  if (s instanceof Response) return s;
  const key = String(c.req.param('objection') || '');
  const objection = await objectionOf(c, s.projectId, key);
  if (objection instanceof Response) return objection;
  const b = await body(c);
  const how = b.how === 'eadwyn' || b.how === 'picked' ? b.how : null;
  if (!how) return c.json({ detail: 'how is eadwyn or picked' }, 400);
  const section = NARRATIVE_SECTIONS.find((x) => x.key === b.section);
  if (!section) return c.json({ detail: 'Unknown section', sections: NARRATIVE_SECTIONS.map((x) => x.key) }, 404);
  let version: number;
  try { version = await readableVersion(c.env, s.projectId, b.version); } catch (e) { return writeFailed(c, e); }
  if (version === 0) return c.json({ detail: 'An objection is answered in a saved version. Version 0 is the live deck’s wording.', code: 'invalid_version' }, 409);
  const userId = Number(s.user.id);
  try {
    await c.env.DB.prepare(
      `INSERT INTO narrative_objection_answers (project_id, objection_key, version, section_key, how, answered_by)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (project_id, objection_key) DO UPDATE SET
         version = excluded.version, section_key = excluded.section_key, how = excluded.how,
         answered_by = excluded.answered_by, answered_at = datetime('now')`,
    ).bind(s.projectId, key, version, section.key, how, userId).run();
    await logCycleWrite(c.env, {
      projectId: s.projectId, userId, cycle: 'raise', module: 'investor-narrative', entityId: version,
      action: 'narrative_objection_answered',
      summary: `An objection marked answered in ${section.label}, version ${version} (${HOW_LABEL[how]})`,
    });
    const answered = (await readObjections(c.env, s.projectId)).items.find((o) => o.key === key)?.answered ?? null;
    return c.json({ objection: key, answered });
  } catch (e) { return writeFailed(c, e); }
});

cycleRaise.delete('/narrative/objections/:objection/answer', async (c) => {
  const s = await narrativeScope(c, 'write');
  if (s instanceof Response) return s;
  const key = String(c.req.param('objection') || '');
  const objection = await objectionOf(c, s.projectId, key);
  if (objection instanceof Response) return objection;
  try {
    const gone: any = await c.env.DB.prepare(
      'DELETE FROM narrative_objection_answers WHERE project_id = ? AND objection_key = ? RETURNING version, section_key',
    ).bind(s.projectId, key).first();
    if (!gone) return c.json({ detail: 'This objection is not marked answered.' }, 404);
    const label = NARRATIVE_SECTIONS.find((x) => x.key === gone.section_key)?.label ?? 'a section';
    await logCycleWrite(c.env, {
      projectId: s.projectId, userId: Number(s.user.id), cycle: 'raise', module: 'investor-narrative', entityId: Number(gone.version),
      action: 'narrative_objection_unanswered',
      summary: `An objection no longer marked answered in ${label}, version ${Number(gone.version)}`,
    });
    return c.json({ objection: key, answered: null });
  } catch (e) { return writeFailed(c, e); }
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

// D912 (#2696): one version's claims (NAR6, NAR7) and its check (NAR8). The
// narrative's own gate first (an Admin gives a reason and only reads), then
// the Evidence gate: claims are evidence, so only the founder reads a record's
// figure and runs the check; an Admin reads states. A support session reads
// no claims at all, as it reads no Evidence.
const narrativeVersionNumber = async (c: any, projectId: number): Promise<number | Response> => {
  const raw = c.req.param('version');
  if (!/^[1-9][0-9]{0,8}$/.test(raw)) return c.json({ detail: 'Version not found' }, 404);
  try { return await readableVersion(c.env, projectId, raw); } catch (e) { return writeFailed(c, e); }
};

cycleRaise.get('/narrative/:version/claims', async (c) => {
  const s = await narrativeScope(c, 'read');
  if (s instanceof Response) return s;
  try {
    const ctx = await evidenceScope(c, false);
    if (ctx instanceof Response) return ctx;
    const version = await narrativeVersionNumber(c, s.projectId);
    if (version instanceof Response) return version;
    return c.json(await narrativeClaims(c.env, s.projectId, version, ctx.founder));
  } catch (error) { return evidenceFailure(c, error); }
});

cycleRaise.post('/narrative/:version/check', async (c) => {
  const s = await narrativeScope(c, 'write');
  if (s instanceof Response) return s;
  try {
    const ctx = await evidenceScope(c, true);
    if (ctx instanceof Response) return ctx;
    const version = await narrativeVersionNumber(c, s.projectId);
    if (version instanceof Response) return version;
    const check = await checkNarrativeVersion(c.env, s.projectId, version);
    if (check.outcome === 'unreadable') return c.json({ code: 'unreadable', detail: 'This version could not be read, so nothing was checked. Try again.' }, 503);
    await logCycleWrite(c.env, { projectId: s.projectId, userId: Number(s.user.id), cycle: 'raise', module: 'investor-narrative', entityId: null, action: 'narrative_checked', summary: `Version ${version} checked against the records` });
    return c.json(await narrativeClaims(c.env, s.projectId, version, true));
  } catch (error) { return evidenceFailure(c, error); }
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

/**
 * What an Eadwyn run reads about one section of one saved version: the
 * section's words (the page's unsaved `words` when sent, else the stored
 * ones), the version's audience and its positioning, each figure masked
 * (`sectionMaterial`). A refusal is the Response to send.
 */
async function draftMaterial(c: any, projectId: number, raw: string, sectionKey: string, given: unknown) {
  if (!/^(0|[1-9][0-9]{0,8})$/.test(raw)) return c.json({ detail: 'Version not found' }, 404) as Response;
  let read: Awaited<ReturnType<typeof readNarrative>>;
  try { read = await readNarrative(c.env, projectId, raw); } catch (e) { return writeFailed(c, e) as Response; }
  if (read.version === 0) return c.json({ detail: 'Version 0 is the live deck’s wording. Change it in the deck, or in a saved version.' }, 409) as Response;
  if (read.sections.state !== 'ok') return c.json({ code: 'unreadable', detail: 'This version’s sections could not be read, so Eadwyn has nothing to work on. Try again.' }, 503) as Response;
  const section = (read.sections.items as Array<{ key: string; body: string | null }>).find((x) => x.key === sectionKey);
  // The words on the page, unsaved, are what the founder asks about; else the stored words.
  const words = typeof given === 'string' ? given.slice(0, 4000) : section?.body ?? '';
  const audience = read.meta.state === 'ok' && read.meta.investor_type ? INVESTOR_TYPE_LABEL[read.meta.investor_type] ?? null : null;
  const positioning = read.positioning.state === 'ok'
    ? (read.positioning.effective as Array<{ kind: string; text: string }>).filter((p) => POSITIONING_WORDS[p.kind]).map((p) => ({ label: POSITIONING_WORDS[p.kind], text: p.text }))
    : [];
  const m = section ? sectionMaterial(sectionKey, words, audience, positioning) : null;
  if (!m) return c.json({ detail: 'Unknown section', sections: NARRATIVE_SECTIONS.map((x) => x.key) }, 404) as Response;
  return { version: read.version, m };
}

cycleRaise.post('/narrative/:version/sections/:section/draft', async (c) => {
  const s = await narrativeScope(c, 'write');
  if (s instanceof Response) return s;
  const raw = c.req.param('version');
  if (!/^(0|[1-9][0-9]{0,8})$/.test(raw)) return c.json({ detail: 'Version not found' }, 404);
  const b = await body(c);
  const mode = String(b.mode ?? 'draft') as SectionMode;
  if (!(SECTION_MODES as readonly string[]).includes(mode)) return c.json({ detail: 'mode is draft, shorten or plain' }, 400);
  const sectionKey = String(c.req.param('section') || '');
  const got = await draftMaterial(c, s.projectId, raw, sectionKey, b.words);
  if (got instanceof Response) return got;
  const { m } = got;
  if (needsWords(mode, m)) return c.json({ code: 'nothing_to_read', detail: `There are no words in ${m.label} to ${mode === 'shorten' ? 'shorten' : 'put in plain words'} yet. Write some, or ask Eadwyn to draft it.` }, 422);
  const result = await aiRouterRun(c.env, {
    task: 'rail_write',
    userId: Number(s.user.id),
    surface: AI_SURFACE.raiseNarrative,
    rail: railFor(c, { page: SECTION_PAGE, option: SECTION_OPTION }, `narrative:${s.projectId}:${got.version}:${sectionKey}`),
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
  return c.json({ version: got.version, section: sectionKey, mode, text, removed });
});

// D913 (#2697, NAR10): "Answer it". One `rail_write` run under
// `draft:narrative-objection`: Eadwyn drafts one section's words so they answer
// one objection. No figure goes in (the section and the objection are masked)
// and none comes out (a sentence with a digit is dropped); it writes nothing.
cycleRaise.post('/narrative/objections/:objection/draft', async (c) => {
  const s = await narrativeScope(c, 'write');
  if (s instanceof Response) return s;
  const key = String(c.req.param('objection') || '');
  if (!/^[0-9a-f]{16}$/.test(key)) return c.json({ detail: 'Objection not found' }, 404);
  const b = await body(c);
  const sectionKey = typeof b.section === 'string' ? b.section : '';
  if (!sectionKey) return c.json({ detail: 'Choose the section that answers it' }, 400);
  let objection: Objection | undefined;
  try { objection = (await readObjections(c.env, s.projectId)).items.find((o) => o.key === key); } catch (e) { return unreadable(c, e); }
  if (!objection) return c.json({ detail: 'Objection not found' }, 404);
  const got = await draftMaterial(c, s.projectId, String(b.version ?? ''), sectionKey, b.words);
  if (got instanceof Response) return got;
  const result = await aiRouterRun(c.env, {
    task: 'rail_write',
    userId: Number(s.user.id),
    surface: AI_SURFACE.raiseNarrative,
    rail: railFor(c, { page: SECTION_PAGE, option: OBJECTION_OPTION }, `narrative:${s.projectId}:${got.version}:${sectionKey}:objection`),
    systemPrompt: OBJECTION_SYSTEM,
    messages: [{ role: 'user', content: objectionPrompt(got.m, objection) }],
    temperature: 0.5,
    maxTokens: 900,
  });
  if (!result.ok || !result.output) {
    return refuseRun(c, result) || c.json({ code: 'ai_unavailable', detail: 'Eadwyn could not write this just now. Nothing was charged. Try again.' }, 503);
  }
  const { text, removed } = screenSection(parseJsonLoose<unknown>(result.output), got.m.max);
  if (!text) return c.json({ code: 'nothing_kept', detail: 'Eadwyn’s words all held a number, so none was kept. Answer it yourself, and insert figures from your records.', removed }, 422);
  return c.json({ version: got.version, section: sectionKey, objection: key, text, removed });
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

cycleRaise.post('/prospects', async (c) => {
  const s = await scope(c);
  if (s instanceof Response) return s;
  const b = await body(c);
  try {
    return c.json(await addProspect(c.env, { projectId: s.projectId, userId: Number(s.user.id), body: b }), 201);
  } catch (e) { return writeFailed(c, e); }
});

// D1192 (#3126, CRL5): Import, at most 50 rows a request, each through the one writer.
cycleRaise.post('/prospects/import', async (c) => {
  const s = await scope(c);
  if (s instanceof Response) return s;
  const b = await body(c);
  try {
    return c.json(await importProspects(c.env, { projectId: s.projectId, userId: Number(s.user.id), rows: b.rows }));
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
  // D1102: a room's writes are its owner's. The shared record door refuses the same way.
  if (!isRoomOwner(s)) return c.json({ detail: 'Forbidden' }, 403);
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
      discount_bps: b.discount_bps,
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

// ---------------------------------------------------------------------------
// D1094 — the member's own Google Workspace
// ---------------------------------------------------------------------------

/** Part 2's gates (`workspaceContext`): no support session, a writer of the venture, their own connection enabled for its company. */
async function googleOwner(c: any, s: { user: User; projectId: number }): Promise<{ integration: { id: number } } | Response> {
  try { return await workspaceContext(c, s.user, s.projectId); }
  catch (e) {
    const w = e instanceof WorkspaceError ? e : new WorkspaceError('workspace_unreadable');
    return c.json({ error: w.code }, w.status as any);
  }
}

cycleRaise.post('/google/sync', async (c) => {
  const s = await scope(c);
  if (s instanceof Response) return s;
  const own = await googleOwner(c, s);
  if (own instanceof Response) return own;
  const userId = Number(s.user.id);
  try {
    const counts = await syncRaiseGoogle(c.env, {
      integrationId: own.integration.id, projectId: s.projectId, user: s.user,
      read: (call, id, options) => workspaceRead(c.env, userId, call, id, options), eventDays: calendarEventDays(c.env, userId),
    });
    await logCycleWrite(c.env, { projectId: s.projectId, userId, cycle: 'raise', module: 'data-room', entityId: s.projectId, action: 'google_raise_sync',
      summary: `Synced from Google: ${Number(counts.decks_proposed)} deck, ${Number(counts.copies_added) + Number(counts.copies_replaced)} files, ${Number(counts.last_met_proposed)} meetings` }).catch(() => {});
    return c.json({ ok: true, counts });
  } catch (e) {
    // A code only: no file name, address or event reaches a log.
    console.error('[cycle_raise] google sync failed:', e instanceof WorkspaceError ? e.code : 'error');
    return c.json({ error: 'google_sync_failed', detail: 'Google could not be read. Nothing changed; try again.' }, 502);
  }
});

cycleRaise.post('/google/proposals/:id/accept', async (c) => {
  const s = await scope(c);
  if (s instanceof Response) return s;
  const id = idParam(c.req.param('id'));
  if (id == null) return c.json({ detail: 'Proposal not found' }, 404);
  const own = await googleOwner(c, s);
  if (own instanceof Response) return own;
  try {
    const out = await acceptRaiseGoogleProposal(c.env, { integrationId: own.integration.id, projectId: s.projectId, id, user: s.user });
    if (!out.ok) return c.json({ error: out.code, detail: out.message }, OUTCOME_STATUS(out));
    return c.json(out);
  } catch (e) { return writeFailed(c, e); }
});

cycleRaise.post('/google/proposals/:id/dismiss', async (c) => {
  const s = await scope(c);
  if (s instanceof Response) return s;
  const id = idParam(c.req.param('id'));
  if (id == null) return c.json({ detail: 'Proposal not found' }, 404);
  const own = await googleOwner(c, s);
  if (own instanceof Response) return own;
  const out = await dismissRaiseGoogleProposal(c.env, { integrationId: own.integration.id, projectId: s.projectId, id, user: s.user });
  if (!out.ok) return c.json({ error: out.code, detail: out.message }, OUTCOME_STATUS(out));
  return c.json(out);
});

cycleRaise.delete('/google/facts/:id', async (c) => {
  const s = await scope(c);
  if (s instanceof Response) return s;
  const id = idParam(c.req.param('id'));
  if (id == null) return c.json({ detail: 'File not found' }, 404);
  const own = await googleOwner(c, s);
  if (own instanceof Response) return own;
  if (!(await deleteRaiseGoogleCopy(c.env, { integrationId: own.integration.id, projectId: s.projectId, id, user: s.user }))) return c.json({ detail: 'File not found' }, 404);
  return c.json({ ok: true });
});

// D1263: the evidence paths use scope(), then active-company and founder-only decision gates.
async function evidenceScope(c: any, write: boolean): Promise<RaiseEvidenceContext | Response> {
  c.header('Cache-Control', 'no-store');
  const s = await scope(c);
  if (s instanceof Response) return s;
  if (await isSupportSession(c)) return c.json({ error: 'support_session_refused', message: 'Evidence decisions and source details are unavailable in a support session.' }, 403);
  const company = await resolveActiveCompany(c.env, s.user, c.req.header(ACTIVE_COMPANY_HEADER));
  if (c.req.header(ACTIVE_COMPANY_HEADER) && company == null) return c.json({ error: 'company_selection_refused', message: 'Switch to this venture’s company first.' }, 403);
  const ctx = await raiseEvidenceContext(c.env, s.user, s.projectId, company);
  if (write && !ctx.founder) throw new RaiseEvidenceError('forbidden', 403);
  return ctx;
}
function evidenceFailure(c: any, error: unknown) {
  if (error instanceof RaiseEvidenceError) return c.json({ error: error.code, message: error.sentence }, error.status);
  return c.json({ error: 'evidence_unreadable', message: 'Evidence could not be read or saved. Try again.' }, 503);
}
async function evidenceBody(c: any): Promise<Record<string, unknown>> {
  const body: unknown = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new RaiseEvidenceError('invalid', 400);
  return body as Record<string, unknown>;
}
const evidencePage = (c: any) => {
  const limit = c.req.query('limit') ?? '50', offset = c.req.query('offset') ?? '0';
  if (!/^[0-9]{1,7}$/.test(limit) || !/^[0-9]{1,7}$/.test(offset)) throw new RaiseEvidenceError('invalid', 400);
  return { limit: Number(limit), offset: Number(offset) };
};
cycleRaise.get('/evidence', async c => {
  try { const ctx = await evidenceScope(c, false); if (ctx instanceof Response) return ctx; return c.json(await readRaiseEvidence(ctx, evidencePage(c))); }
  catch (error) { return evidenceFailure(c, error); }
});
// D1266 (#3289): See as an investor (VR11). The founder's own preview of the investor's projection, never logged as an open.
cycleRaise.get('/evidence/preview', async c => {
  try { const ctx = await evidenceScope(c, true); if (ctx instanceof Response) return ctx;
    const nda = c.req.query('nda') ?? '0'; if (nda !== '0' && nda !== '1') throw new RaiseEvidenceError('invalid', 400);
    return c.json(await previewEvidence(ctx, nda === '1')); }
  catch (error) { return evidenceFailure(c, error); }
});
cycleRaise.post('/evidence/refresh', async c => {
  try { const ctx = await evidenceScope(c, true); if (ctx instanceof Response) return ctx; return c.json(await readRaiseEvidence(ctx, { ...evidencePage(c), refresh: true })); }
  catch (error) { return evidenceFailure(c, error); }
});
cycleRaise.post('/evidence/items/:id/accept', async c => {
  try { const ctx = await evidenceScope(c, true); if (ctx instanceof Response) return ctx; const body = await evidenceBody(c);
    if (Object.keys(body).some(k => k !== 'snapshot_hash')) throw new RaiseEvidenceError('invalid', 400);
    return c.json(await acceptEvidenceItem(ctx, c.req.param('id'), body.snapshot_hash)); }
  catch (error) { return evidenceFailure(c, error); }
});
cycleRaise.post('/evidence/items/:id/dismiss', async c => {
  try { const ctx = await evidenceScope(c, true); if (ctx instanceof Response) return ctx; return c.json(await dismissEvidenceItem(ctx, c.req.param('id'))); }
  catch (error) { return evidenceFailure(c, error); }
});
cycleRaise.patch('/evidence/items/:id', async c => {
  try { const ctx = await evidenceScope(c, true); if (ctx instanceof Response) return ctx; return c.json(await setEvidenceSharing(ctx, c.req.param('id'), await evidenceBody(c))); }
  catch (error) { return evidenceFailure(c, error); }
});
cycleRaise.post('/evidence/claims/:id/link', async c => {
  try { const ctx = await evidenceScope(c, true); if (ctx instanceof Response) return ctx; return c.json(await linkEvidenceClaim(ctx, c.req.param('id'), await evidenceBody(c))); }
  catch (error) { return evidenceFailure(c, error); }
});
// D900 (#2679): "Keep mine, with a note" on a Mismatch, shared by the deck's and the narrative's checks.
cycleRaise.post('/evidence/claims/:id/note', async c => {
  try { const ctx = await evidenceScope(c, true); if (ctx instanceof Response) return ctx; const body = await evidenceBody(c);
    return c.json(await setClaimNote(ctx.env, ctx.projectId, Number(ctx.user.id), c.req.param('id'), noteText(body.note))); }
  catch (error) { return error instanceof ClaimNoteError ? c.json({ error: error.code, message: error.sentence }, error.status) : evidenceFailure(c, error); }
});
cycleRaise.delete('/evidence/claims/:id/note', async c => {
  try { const ctx = await evidenceScope(c, true); if (ctx instanceof Response) return ctx;
    return c.json(await setClaimNote(ctx.env, ctx.projectId, Number(ctx.user.id), c.req.param('id'), null)); }
  catch (error) { return error instanceof ClaimNoteError ? c.json({ error: error.code, message: error.sentence }, error.status) : evidenceFailure(c, error); }
});
cycleRaise.delete('/evidence/claims/:id/link', async c => {
  try { const ctx = await evidenceScope(c, true); if (ctx instanceof Response) return ctx; return c.json(await linkEvidenceClaim(ctx, c.req.param('id'), await evidenceBody(c), true)); }
  catch (error) { return evidenceFailure(c, error); }
});

export default cycleRaise;
