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
import { profilesFrom, sideOf, valuesFit } from '../services/valuesCompat';

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
 * D702 — the members query of `/published-members`, as a function, so the
 * preview on `/api/profile/preview` asks it the same question a member does
 * (as a viewer who matches no row, id 0) rather than guessing who is listed.
 * The caller's own plan lock (`archetypeAccess`) stays in the route: it is the
 * VIEWER's plan, not the listed member's choice.
 */
export async function publishedMembersFor(
  env: Env, viewer: { id: number; role: string | null | undefined }, slugs: string[],
) {
  const rows = await env.DB.prepare(
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
  ).bind(JSON.stringify(slugs), viewer.id, PUBLISHED_MEMBERS_LIMIT + 1).all<{
    user_id: number; name: string | null; role: string | null; persona: string; displayed_slug: string;
  }>();
  const all = rows.results || [];
  const listed = all.slice(0, PUBLISHED_MEMBERS_LIMIT);
  const callerPublished = await isArchetypePublished(env, viewer.id);
  let fits: Map<number, { band: string | null; compared: number }> | null = null;
  if (callerPublished && listed.length) {
    const ids = [viewer.id, ...new Set(listed.map((m) => Number(m.user_id)))];
    const idList = JSON.stringify(ids);
    // Two reads for the whole list (the caller and every member), never one per row.
    const [axal, values] = await Promise.all([
      env.DB.prepare(
        `SELECT user_id, value_key, score, confidence FROM axal_values
          WHERE user_id IN (SELECT value FROM json_each(?))`,
      ).bind(idList).all(),
      env.DB.prepare(
        `SELECT uv.user_id, vd.slug, uv.score, uv.confidence
           FROM user_values uv JOIN value_dimensions vd ON vd.id = uv.dimension_id
          WHERE uv.user_id IN (SELECT value FROM json_each(?))`,
      ).bind(idList).all(),
    ]);
    const profiles = profilesFrom(ids,
      (axal.results || []) as Array<{ user_id: number; value_key: string; score: number; confidence: number }>,
      (values.results || []) as Array<{ user_id: number; slug: string; score: number; confidence: number }>);
    const me = { side: sideOf(viewer.role), profile: profiles.get(viewer.id)! };
    fits = new Map(listed.map((m, i) => [i, valuesFit(me, { side: sideOf(m.persona), profile: profiles.get(Number(m.user_id))! })]));
  }
  return {
    locked: false,
    archetypes: slugs,
    items: listed.map((m, i) => ({
      user_id: m.user_id, name: m.name, role: m.role, persona: m.persona,
      slug: m.displayed_slug, label: ARCHETYPE_LABEL.get(m.displayed_slug) ?? null,
      values_fit: fits?.get(i) ?? null,
    })),
    values_fit_reason: callerPublished ? null : 'Publish your own archetype to see how your values compare.',
    more: all.length > PUBLISHED_MEMBERS_LIMIT,
  };
}

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
 *
 * D605 — each row's `values_fit` is `{ band, compared }` from
 * `services/valuesCompat.ts` (§6): aligned, mixed, far_apart, or null when
 * fewer than three dimensions are recorded on both sides. Only a band and a
 * count, never a dimension or a score. It is computed only when the CALLER
 * has also published (publishing is the consent to be matched); otherwise
 * every row's `values_fit` is null and `values_fit_reason` says why. The
 * values of the caller and every listed member are read in two queries for
 * the whole list, never one per row.
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
    return c.json(await publishedMembersFor(c.env, { id: Number(user.id), role: user.role }, slugs));
  } catch (e) {
    return refuse(c, 503, { code: 'published_members_unreadable', message: 'The members who published these archetypes could not be read. Try again in a moment.', raw: e });
  }
});

export default r;
