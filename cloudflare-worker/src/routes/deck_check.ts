/**
 * D900 (#2679, part 6 of #2434) — the deck's check against the records.
 *
 *   GET  /api/decks/checks?project_id=<id>
 *        → { project_id, versions: [{ deck_id, version, checked, checked_at, counts | null }] }
 *        PD2's check pills and the versions table's Checks column. A version
 *        never checked is `checked: false`, never zeros.
 *   GET  /api/decks/:id/check
 *        → the version's last check (PD13), with no record figure: the panel
 *        runs the check for the founder, and any other reader reads states.
 *   POST /api/decks/:id/check                      (the venture's founder)
 *        → { deck_id, version, outcome, checked_at, counts, figures, claims }
 *        D1264's check on THIS version, written to `raise_claims`
 *        (`surface = 'deck'`), with Stale from the version's bindings.
 *   POST /api/decks/:id/claims/:uid/use-record     (the venture's founder)
 *        { record_value } → { deck }
 *        "Use Stripe's figure": the stated number replaced by the record's,
 *        saved as a new version (as Restore saves one). `record_value` must
 *        be the figure the dialog showed, or nothing is written (409).
 *
 * "Keep mine, with a note" is the claim note on Evidence
 * (`POST /api/cycles/raise/evidence/claims/:id/note`), shared with the
 * narrative's check (#2696).
 *
 * Mounted in index.ts BEFORE `decks`, so `GET /api/decks/:id` cannot answer
 * `/checks`. Each write logs one `raise.pitch-deck` cycle row, never a figure.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { projectOwned } from '../middleware/projectContentAccess';
import { resolveActiveCompany, ACTIVE_COMPANY_HEADER } from '../middleware/activeCompany';
import { isSupportSession } from '../integrations/providers/mercury';
import { raiseEvidenceContext, RaiseEvidenceError } from '../services/raiseEvidence';
import { checkDeckVersion, deck, deckVersion, pinnedItems, signalKinds, type DeckRow } from '../services/raiseClaims';
import { deckCheckSummaries, deckCheckView, staleClaims, storedDeckClaims, swapInSlide } from '../services/deckCheck';
import { bindingsOf, compareBindings, readSources } from '../services/decks/sources';
import { isSeriesKey } from '../services/decks/chartSeries';
import { FIGURE_LABEL, type FigureKey } from '../services/raiseCycle';
import { refuse } from '../util/refusal';
import { mercuryFor } from './deck_sources';
import { auditDeckWrite, ensureSchema, getDeckRow, insertVersion, rowToDeck, sanitizeSlides, themeOfRow } from './decks';

const deckCheck = new Hono<{ Bindings: Env }>();

const today = () => new Date().toISOString().slice(0, 10);
type Row = DeckRow & { project_id: number; title: string | null; audience: string | null; round_ref: string | null };

async function deckRow(c: any, id: number): Promise<Row | null> {
  await ensureSchema(c.env);
  try { return await getDeckRow(c.env, id) as Row; } catch { return null; }
}

/** May this reader read the deck at all; and is it the venture's founder, who alone runs the check. */
async function reader(c: any, user: User, projectId: number): Promise<{ founder: boolean } | Response> {
  try { await projectOwned(c, user, projectId); } catch (e: any) {
    return e?.message === 'NotFound' ? c.json({ error: 'not found' }, 404) : c.json({ error: 'forbidden' }, 403);
  }
  if (await isSupportSession(c)) return { founder: false };
  try {
    const company = await resolveActiveCompany(c.env, user, c.req.header(ACTIVE_COMPANY_HEADER));
    return { founder: (await raiseEvidenceContext(c.env, user, projectId, company)).founder };
  } catch (e) {
    if (e instanceof RaiseEvidenceError) return { founder: false };
    throw e;
  }
}

const founderOnly = (c: any) => refuse(c, 403, { code: 'founder_only', message: 'Only the venture’s founder checks the deck against the records.' });

/** The claims a stale binding states, from D896's refresh comparison. Series bindings state no figure. */
async function staleFor(c: any, user: User, project: any, row: Row, slides: unknown): Promise<Set<string>> {
  const bindings = bindingsOf(slides).filter((b) => !isSeriesKey(b.binding.source_key));
  if (!bindings.length) return new Set();
  try {
    const { items } = await readSources({ env: c.env, projectId: Number(row.project_id), today: today(), mercury: await mercuryFor(c, user, project) }, { includeScoring: true });
    return staleClaims(slides, compareBindings(bindings, items));
  } catch {
    // The sources could not be read: nothing is called Stale, rather than everything.
    return new Set();
  }
}

const parsed = (row: Row): unknown => { try { return JSON.parse(String(row.slides)); } catch { return null; } };

deckCheck.get('/checks', async (c) => {
  const user = await requireAuth(c);
  const projectId = Number(c.req.query('project_id'));
  if (!Number.isSafeInteger(projectId) || projectId < 1) return c.json({ error: 'project_id required' }, 400);
  const who = await reader(c, user, projectId);
  if (who instanceof Response) return who;
  await ensureSchema(c.env);
  return c.json({ project_id: projectId, versions: await deckCheckSummaries(c.env, projectId) });
});

deckCheck.get('/:id{[0-9]+}/check', async (c) => {
  const user = await requireAuth(c);
  const row = await deckRow(c, Number(c.req.param('id')));
  if (!row) return c.json({ error: 'not found' }, 404);
  const who = await reader(c, user, Number(row.project_id));
  if (who instanceof Response) return who;
  const version = deckVersion(row);
  const check = await c.env.DB.prepare('SELECT checked_at FROM deck_checks WHERE deck_id = ?').bind(row.id).first<{ checked_at: string }>();
  const stored = await storedDeckClaims(c.env, Number(row.project_id), version);
  return c.json({
    deck_id: row.id, version, checked: !!check || stored.length > 0, checked_at: check?.checked_at ?? stored.map((s) => s.checked_at).filter(Boolean).sort().at(-1) ?? null,
    can_check: who.founder, ...deckCheckView(stored, { founder: who.founder, stale: new Set() }),
  });
});

deckCheck.post('/:id{[0-9]+}/check', async (c) => {
  const user = await requireAuth(c);
  const row = await deckRow(c, Number(c.req.param('id')));
  if (!row) return c.json({ error: 'not found' }, 404);
  const who = await reader(c, user, Number(row.project_id));
  if (who instanceof Response) return who;
  if (!who.founder) return founderOnly(c);
  const projectId = Number(row.project_id);
  const result = await checkDeckVersion(c.env, projectId, row);
  const version = deckVersion(row);
  if (result.outcome === 'unreadable') {
    return refuse(c, 422, { code: 'deck_unreadable', message: 'This version’s slides could not be read, so nothing was checked. Its last check stands.' });
  }
  const at = new Date().toISOString().slice(0, 19).replace('T', ' ');
  await c.env.DB.prepare(
    `INSERT INTO deck_checks (deck_id, project_id, surface_version, figures, checked_by, checked_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(deck_id) DO UPDATE SET figures = excluded.figures, checked_by = excluded.checked_by, checked_at = excluded.checked_at`,
  ).bind(row.id, projectId, version, result.claims.length, Number(user.id), at).run();
  await auditDeckWrite(c, user, projectId, 'deck_checked', 'Deck checked against the records');
  const project = await c.env.DB.prepare('SELECT founder_id, company_id FROM projects WHERE id = ?').bind(projectId).first<any>();
  const slides = parsed(row);
  const stale = await staleFor(c, user, project, row, slides);
  const stored = await storedDeckClaims(c.env, projectId, version);
  return c.json({ deck_id: row.id, version, outcome: 'recorded', checked: true, checked_at: at, can_check: true, ...deckCheckView(stored, { founder: true, stale, computed: result.claims }) });
});

deckCheck.post('/:id{[0-9]+}/claims/:uid/use-record', async (c) => {
  const user = await requireAuth(c);
  const row = await deckRow(c, Number(c.req.param('id')));
  if (!row) return c.json({ error: 'not found' }, 404);
  const who = await reader(c, user, Number(row.project_id));
  if (who instanceof Response) return who;
  if (!who.founder) return founderOnly(c);
  const body: any = await c.req.json().catch(() => null);
  const expected = Number(body?.record_value);
  if (!body || body.record_value == null || !Number.isFinite(expected)) return refuse(c, 400, { code: 'record_value_required', message: 'Say which record figure to use.' });
  const projectId = Number(row.project_id);
  const uid = String(c.req.param('uid'));
  const claim = await c.env.DB.prepare(
    `SELECT field_key, claim_kind, stated_value FROM raise_claims WHERE uid = ? AND project_id = ? AND surface = 'deck' AND surface_version = ?`,
  ).bind(uid, projectId, deckVersion(row)).first<{ field_key: string; claim_kind: string; stated_value: string | null }>();
  if (!claim) return refuse(c, 404, { code: 'claim_not_found', message: 'That figure is not on this version.' });
  // The record as it is now, never as the dialog remembered it.
  const items = await pinnedItems(c.env, projectId);
  const now = await deck(c.env, projectId, items, await signalKinds(c.env, projectId, items), row);
  const current = now.claims.find((x) => x.field_key === claim.field_key);
  if (!current || current.state !== 'mismatch' || current.record?.value == null) {
    return refuse(c, 409, { code: 'claim_not_mismatch', message: 'This figure no longer differs from the record. Run the check again.' });
  }
  if (Math.abs(Number(current.record.value) - expected) > 1e-9) {
    return refuse(c, 409, { code: 'record_changed', message: 'The record’s figure changed since you opened this. Run the check again.' });
  }
  const slides = parsed(row);
  const index = Number(/^slide:(\d+)#/.exec(claim.field_key)?.[1]) - 1;
  if (!Array.isArray(slides) || !(claim.claim_kind in FIGURE_LABEL) || index < 0) {
    return refuse(c, 409, { code: 'figure_not_found', message: 'The figure could not be found on its card. Change it in the editor.' });
  }
  const swapped = swapInSlide(slides[index], claim.claim_kind as FigureKey, Number(current.stated_value), Number(current.record.value));
  if (swapped == null) return refuse(c, 409, { code: 'figure_not_found', message: 'The figure could not be found on its card. Change it in the editor.' });
  const next = sanitizeSlides(slides.map((s, i) => (i === index ? swapped : s)));
  const newId = await insertVersion(c.env, projectId, next, String(row.title || 'Pitch deck'), Number(user.id) || null,
    { audience: row.audience ?? null, round_ref: row.round_ref ?? null, theme: themeOfRow(row) });
  await auditDeckWrite(c, user, projectId, 'deck_figure_replaced', 'A deck figure replaced with the record’s figure');
  return c.json({ deck: rowToDeck(await getDeckRow(c.env, Number(newId))) });
});

export default deckCheck;
