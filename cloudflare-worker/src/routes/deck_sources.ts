/**
 * D896 (#2675, part 2 of #2434) — what a pitch deck can be filled from, and
 * which of a version's bound figures their stores have moved past.
 *
 *   GET  /api/decks/sources?project_id=<id>[&include=scoring]
 *        → { project_id, items: SourceItem[], coverage }
 *   POST /api/decks/:id/refresh
 *        → { deck_id, version, checked, stale, rows: RefreshRow[] }
 *
 * Mounted in index.ts BEFORE `decks`: `GET /api/decks/:id` would otherwise
 * answer `/sources` (Hono matches in registration order; #2434's worker map
 * §0.1 found `/methods` and `/brand` shadowed the same way).
 *
 * Both read only. Refresh says which bound cards are stale; re-reading a value
 * into the deck is the editor's Save (`PUT /api/decks/:id`, a new version), and
 * "Keep as of" is simply not saving. Neither route writes, so neither logs a
 * cycle-activity row.
 *
 * WHO. `projectOwned` decides, as every deck read does. Mercury's figures are
 * read only for the venture's own founder, from their own connection, in the
 * startup's company and outside a support session (cycle_raise's
 * `mercuryFounderOnly`); for anyone else those slots are `withheld`.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { projectOwned } from '../middleware/projectContentAccess';
import { resolveActiveCompany, ACTIVE_COMPANY_HEADER } from '../middleware/activeCompany';
import { projectInActiveCompany } from '../services/tenancyScope';
import { isSupportSession } from '../integrations/providers/mercury';
import { founderMercuryConnection } from '../services/mercury/raiseAccess';
import { bindingsOf, compareBindings, readSources, type SourceCtx } from '../services/decks/sources';

const deckSources = new Hono<{ Bindings: Env }>();

const today = () => new Date().toISOString().slice(0, 10);

/** The founder's own Mercury connection, `withheld` for anyone else, or null when the founder has none. */
export async function mercuryFor(c: any, user: User, project: { founder_id: number | null; company_id: number | null }): Promise<SourceCtx['mercury']> {
  const owner = project.founder_id != null && user.founder_id != null && Number(user.founder_id) === Number(project.founder_id);
  if (!owner) return { withheld: true };
  const company = await resolveActiveCompany(c.env, user, c.req.header(ACTIVE_COMPANY_HEADER));
  if (!projectInActiveCompany(company, project) || await isSupportSession(c)) return { withheld: true };
  const conn = await founderMercuryConnection(c.env, user);
  return conn ? { integrationId: Number(conn.id) } : null;
}

/** `projectOwned`, with its refusals as the deck routes answer them. */
async function owned(c: any, user: User, projectId: number) {
  try {
    return { project: await projectOwned(c, user, projectId) };
  } catch (e: any) {
    return { refused: e?.message === 'NotFound' ? c.json({ error: 'not found' }, 404) : c.json({ error: 'forbidden' }, 403) };
  }
}

deckSources.get('/sources', async (c) => {
  const user = await requireAuth(c);
  const projectId = Number(c.req.query('project_id'));
  if (!Number.isSafeInteger(projectId) || projectId < 1) return c.json({ error: 'project_id required' }, 400);
  const got = await owned(c, user, projectId);
  if ('refused' in got) return got.refused;
  const ctx: SourceCtx = { env: c.env, projectId, today: today(), mercury: await mercuryFor(c, user, got.project) };
  const { items, coverage } = await readSources(ctx, { includeScoring: c.req.query('include') === 'scoring' });
  return c.json({ project_id: projectId, items, coverage });
});

deckSources.post('/:id{[0-9]+}/refresh', async (c) => {
  const user = await requireAuth(c);
  const id = Number(c.req.param('id'));
  const row = await c.env.DB.prepare('SELECT id, project_id, version, slides FROM pitch_decks WHERE id = ?').bind(id)
    .first<{ id: number; project_id: number; version: number; slides: string | null }>();
  if (!row) return c.json({ error: 'not found' }, 404);
  const got = await owned(c, user, Number(row.project_id));
  if ('refused' in got) return got.refused;
  let slides: unknown = [];
  try { slides = JSON.parse(row.slides || '[]'); } catch { slides = []; }
  const bindings = bindingsOf(slides);
  // Scoring slots are read too: a band the founder included is bound like any figure.
  const { items } = bindings.length
    ? await readSources({ env: c.env, projectId: Number(row.project_id), today: today(), mercury: await mercuryFor(c, user, got.project) }, { includeScoring: true })
    : { items: [] };
  const rows = compareBindings(bindings, items);
  return c.json({ deck_id: row.id, version: row.version, checked: rows.length, stale: rows.filter((r) => r.state === 'stale').length, rows });
});

export default deckSources;
