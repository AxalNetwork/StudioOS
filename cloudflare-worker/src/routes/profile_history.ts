/**
 * D357 — Profiling v2 "me" routes, mounted at /api/profile
 * (documentation/architecture/PROFILING_V2.md §10).
 *
 *   GET/PUT /evidence-blend    D592 — global setting, elevated HQ Super Admin only
 *   GET /history?persona=      the caller's own snapshots, newest first
 *   GET /archetype-published   the caller's consent to show their archetype
 *   PUT /archetype-published   { published: boolean } — set it
 *   GET /reask                 D358 — the caller's answers old enough to be
 *                              asked again ("is this still true?"); a
 *                              read-only peek, nothing is marked asked
 *
 * The history/consent/reask reads and writes are keyed on the session user; no request field names
 * whose history is read, so there is no way to ask for anyone else's. Another
 * member only ever sees a PUBLISHED displayed archetype, through the matching
 * surfaces Session 15 builds on isArchetypePublished.
 */
import { Hono } from 'hono';
import evidenceBlendRoutes from './profile_evidence_blend';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { refuse } from '../util/refusal';
import type { FitPersona } from '../services/advisor/questionBank';
import { loadHistory, isArchetypePublished, setArchetypePublished } from '../services/profileHistory';
import { reaskList } from '../services/profileEvolution';
import { archetypeAccess, ARCHETYPE_KEYS, withoutKeys } from '../services/archetypeEntitlement';

const r = new Hono<{ Bindings: Env }>();
// The global setting is a separate Super Admin-only boundary, not a me read.
r.route('/evidence-blend', evidenceBlendRoutes);
const PERSONAS: FitPersona[] = ['founder', 'investor', 'partner', 'advisor', 'coach'];

r.get('/history', async (c) => {
  const user = await requireAuth(c);
  const raw = c.req.query('persona');
  if (raw != null && !(PERSONAS as string[]).includes(raw)) {
    return refuse(c, 400, { code: 'invalid_persona', message: 'persona is one of founder, investor, partner, advisor or coach.' });
  }
  try {
    const items = await loadHistory(c.env, user.id, (raw as FitPersona | undefined) ?? null);
    // D594: on a free plan each snapshot keeps its skills and values, and loses its archetype half.
    const access = await archetypeAccess(c.env, user);
    return c.json({
      items: access.locked ? items.map((x) => withoutKeys(x as unknown as Record<string, unknown>, ARCHETYPE_KEYS.snapshot)) : items,
      archetype_access: access,
    });
  } catch (e) {
    return refuse(c, 503, { code: 'profile_history_unreadable', message: 'Your profile history could not be read. Try again in a moment.', raw: e });
  }
});

r.get('/reask', async (c) => {
  const user = await requireAuth(c);
  try {
    return c.json(await reaskList(c.env, user.id));
  } catch (e) {
    return refuse(c, 503, { code: 'profile_reask_unreadable', message: 'Which of your answers are due for a refresh could not be read. Try again in a moment.', raw: e });
  }
});

r.get('/archetype-published', async (c) => {
  const user = await requireAuth(c);
  try {
    return c.json({ published: await isArchetypePublished(c.env, user.id) });
  } catch (e) {
    return refuse(c, 503, { code: 'archetype_publish_unreadable', message: 'Whether your archetype is published could not be read. Try again in a moment.', raw: e });
  }
});

r.put('/archetype-published', async (c) => {
  const user = await requireAuth(c);
  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  if (typeof body?.published !== 'boolean') {
    return refuse(c, 400, { code: 'invalid_published', message: '`published` is true or false.' });
  }
  try {
    await setArchetypePublished(c.env, user.id, body.published);
    return c.json({ published: body.published });
  } catch (e) {
    return refuse(c, 503, { code: 'archetype_publish_not_saved', message: 'Your choice was not saved. Try again in a moment.', raw: e });
  }
});

export default r;
