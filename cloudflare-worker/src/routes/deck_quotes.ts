/**
 * D1556 (#3803) — a venture's consented interview quotes, for a deck.
 *
 *   POST /api/decks/quotes/search  { project_id, query, limit? }
 *        → { project_id, quotes: Block<Quote[]> }
 *   POST /api/decks/quotes/index   { project_id }
 *        → { project_id, index: Block<{ indexed, removed, skipped }> }
 *
 * Both are POSTs because both run models the member pays for (an embedding,
 * and for a search the reranker), so neither runs from a page load.
 * `services/decks/quoteRetrieval.ts` holds the rules: consented sessions and
 * deck-eligible interviews only, the interviewee's own final lines, this
 * venture only, attributed by role and never by name.
 *
 * Until the owner approves the `axal-deck-quotes` index (decision L), the
 * binding is absent and both answer `{ available: false, reason: 'Quote
 * retrieval is not switched on yet.' }` with 200: a state, not an error.
 *
 * WHO. `projectOwned`, as every deck route: a search reads (the founder, an
 * accepted member, an admin); indexing writes (`write: true`).
 *
 * Mounted in index.ts BEFORE `decks`, beside the other /api/decks routers.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { projectOwned } from '../middleware/projectContentAccess';
import { refuse } from '../util/refusal';
import { defaultDeps, indexProjectQuotes, retrieveQuotes } from '../services/decks/quoteRetrieval';

const deckQuotes = new Hono<{ Bindings: Env }>();

async function owned(c: any, user: User, projectId: number, write: boolean) {
  try {
    return { project: await projectOwned(c, user, projectId, write ? { write: true } : {}) };
  } catch (e: any) {
    return { refused: e?.message === 'NotFound' ? c.json({ error: 'not found' }, 404) : c.json({ error: 'forbidden' }, 403) };
  }
}

const projectIdOf = (v: unknown) => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

deckQuotes.post('/quotes/search', async (c) => {
  const user = await requireAuth(c);
  const body = await c.req.json<any>().catch(() => ({}));
  const projectId = projectIdOf(body?.project_id);
  if (!projectId) return refuse(c, 400, { code: 'project_id_required', message: 'Say which venture\'s interviews to search.' });
  const query = typeof body?.query === 'string' ? body.query.trim() : '';
  if (!query) return refuse(c, 400, { code: 'query_required', message: 'Say what the quote should be about.' });
  const limit = Math.min(Math.max(Number.isSafeInteger(Number(body?.limit)) ? Number(body.limit) : 5, 1), 10);
  const got = await owned(c, user, projectId, false);
  if ('refused' in got) return got.refused;
  const quotes = await retrieveQuotes(c.env, projectId, query, defaultDeps(c.env, user.id, projectId), limit);
  return c.json({ project_id: projectId, quotes });
});

deckQuotes.post('/quotes/index', async (c) => {
  const user = await requireAuth(c);
  const body = await c.req.json<any>().catch(() => ({}));
  const projectId = projectIdOf(body?.project_id);
  if (!projectId) return refuse(c, 400, { code: 'project_id_required', message: 'Say which venture\'s interviews to index.' });
  const got = await owned(c, user, projectId, true);
  if ('refused' in got) return got.refused;
  const index = await indexProjectQuotes(c.env, projectId, defaultDeps(c.env, user.id, projectId));
  return c.json({ project_id: projectId, index });
});

export default deckQuotes;
