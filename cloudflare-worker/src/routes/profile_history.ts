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
 *   GET /published-members?archetypes=slug,slug
 *                              D602 — other members who PUBLISHED their
 *                              archetype and whose displayed archetype is one
 *                              of those named: the card page's matches
 *
 * The history/consent/reask reads and writes are keyed on the session user; no request field names
 * whose history is read, so there is no way to ask for anyone else's. Another
 * member only ever sees a PUBLISHED displayed archetype: `/published-members`
 * (D602) returns a member's name, role, persona and displayed slug and label,
 * and nothing else — never traits, history, skills or values (§7.9).
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
import { ARCHETYPES } from '../services/archetypeScoring';

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

/** Every archetype slug the engine can display, with its label. */
const ARCHETYPE_LABEL = new Map(Object.values(ARCHETYPES).flat().map((a) => [a.slug, a.label]));
export const PUBLISHED_MEMBERS_MAX_SLUGS = 10;
export const PUBLISHED_MEMBERS_LIMIT = 50;

/**
 * D602 — the card page's published-member matches (decision c). A member is
 * listed only when their `profile_archetype_publish` row says published, their
 * account is active, and the archetype their LATEST snapshot displays (per
 * persona) is one the caller asked about. The caller is never listed.
 *
 * What a row carries is the published archetype and who it belongs to: name,
 * role, persona, displayed slug and label. No trait, confidence, history,
 * skill or value leaves this route. A caller whose own archetype is locked
 * (D594) is answered `locked`, with no members: matches are part of the card.
 */
r.get('/published-members', async (c) => {
  const user = await requireAuth(c);
  const slugs = [...new Set(String(c.req.query('archetypes') || '').split(',').map((s) => s.trim()).filter(Boolean))];
  if (slugs.length === 0 || slugs.length > PUBLISHED_MEMBERS_MAX_SLUGS || slugs.some((s) => !ARCHETYPE_LABEL.has(s))) {
    return refuse(c, 400, {
      code: 'invalid_archetypes',
      message: `archetypes is a comma-separated list of 1 to ${PUBLISHED_MEMBERS_MAX_SLUGS} archetype slugs.`,
    });
  }
  const access = await archetypeAccess(c.env, user);
  if (access.locked) return c.json({ locked: true, archetype_access: access });
  try {
    const rows = await c.env.DB.prepare(
      `SELECT s.user_id, u.name, u.role, s.persona, s.displayed_slug
         FROM profile_snapshots s
         JOIN (SELECT user_id, persona, MAX(id) AS id FROM profile_snapshots GROUP BY user_id, persona) latest
           ON latest.id = s.id
         JOIN profile_archetype_publish p ON p.user_id = s.user_id AND p.published = 1
         JOIN users u ON u.id = s.user_id AND COALESCE(u.is_active, 1) = 1
        WHERE s.displayed_slug IN (SELECT value FROM json_each(?))
          AND s.user_id <> ?
        ORDER BY s.displayed_slug, u.name COLLATE NOCASE, s.user_id
        LIMIT ?`,
    ).bind(JSON.stringify(slugs), user.id, PUBLISHED_MEMBERS_LIMIT + 1).all<{
      user_id: number; name: string | null; role: string | null; persona: string; displayed_slug: string;
    }>();
    const all = rows.results || [];
    return c.json({
      locked: false,
      archetypes: slugs,
      items: all.slice(0, PUBLISHED_MEMBERS_LIMIT).map((m) => ({
        user_id: m.user_id, name: m.name, role: m.role, persona: m.persona,
        slug: m.displayed_slug, label: ARCHETYPE_LABEL.get(m.displayed_slug) ?? null,
      })),
      more: all.length > PUBLISHED_MEMBERS_LIMIT,
    });
  } catch (e) {
    return refuse(c, 503, { code: 'published_members_unreadable', message: 'The members who published these archetypes could not be read. Try again in a moment.', raw: e });
  }
});

export default r;
