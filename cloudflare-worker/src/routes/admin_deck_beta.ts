/**
 * #4190 (K3 of #4155, D4155) — HQ › Decks › Beta cohort: named people get
 * deck features early, added and removed by name, each with a reason.
 *
 *   GET    /api/admin/deck-beta?q=&feature=&added_by=&page=
 *          → { people: [{ user: { uid, name }, company, features, added_by: { uid, name } | null, added_at }],
 *              page, per_page, total, keys: [{ key, label }] }
 *   GET    /api/admin/deck-beta/people?q=     → { people: [{ uid, name, company, role }] }   (2+ characters, at most 10)
 *   POST   /api/admin/deck-beta               { user_uids[], features[], reason }  → { added: [uid], features }
 *   DELETE /api/admin/deck-beta/:userUid      { reason }  → { removed: uid, cleared: [key] }
 *
 * WHERE IT LIVES. The `user` scope of `feature_flags` (D1509, migration 723):
 * an add writes one enabled row per person and key, which wins over the
 * role's and everyone's (`featureFlags.flagsOf`). The cohort is the people
 * with such a row on for a beta key. The keys are the deck features K2
 * registered (`DECK_FEATURES`, #4189), `grid_generate` and `element:<id>` for
 * each grid element; `element:*` in a write means every element. Any other
 * key is refused 400 `invalid_feature`.
 *
 * A removal deletes the person's rows for those keys and clears the same keys
 * from their beta column (`user_settings.feature_flags`, which answers for
 * `grid_generate` and `element:*` when no row does), so they fall back to the
 * role's and everyone's setting. What they already made stays: a logo wall
 * on a slide, a recording, a deck. No content table is touched.
 *
 * WHO. HQ admins (`requireHqAdmin`; a branch is refused). Every add and
 * removal takes a `reason` of at least 10 characters (400 `reason_required`)
 * and writes one admin audit row per person (`deck_beta_add`,
 * `deck_beta_remove`) with the keys and the reason. Neither read ever carries
 * an email: people are named, and found by name.
 *
 * Mounts itself (#4105) at `/api/admin/deck-beta`.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireHqAdmin } from '../auth';
import { refuse } from '../util/refusal';
import type { RouteMount } from '../util/routeRegistry';
import { logAdminAction } from '../services/adminAudit';
import { DECK_FEATURES, GRID_GENERATE, elementKey, forgetFlags } from '../services/featureFlags';
import { ELEMENTS } from '../services/decks/elementModels';

const r = new Hono<{ Bindings: Env }>();

export const REASON_MIN = 10;
export const PER_PAGE = 25;
export const PEOPLE_MAX = 10;
export const ALL_ELEMENTS = 'element:*';

/** Every key the cohort may hold, with the words HQ › Decks shows. */
export function betaKeys(): Array<{ key: string; label: string }> {
  return [
    ...DECK_FEATURES.map((d) => ({ key: d.key as string, label: d.label as string })),
    { key: GRID_GENERATE, label: 'One-click generate' },
    ...ELEMENTS.map((e) => ({ key: elementKey(e.id), label: `Element · ${e.id}` })),
  ];
}
const KEYS = new Set(betaKeys().map((k) => k.key));

/** The keys a write names, `element:*` expanded; null when any is not a beta key. */
export function keysOf(features: unknown): string[] | null {
  if (!Array.isArray(features) || !features.length || features.length > 200) return null;
  const out = new Set<string>();
  for (const f of features) {
    if (f === ALL_ELEMENTS) { for (const e of ELEMENTS) out.add(elementKey(e.id)); continue; }
    if (typeof f !== 'string' || !KEYS.has(f)) return null;
    out.add(f);
  }
  return [...out];
}

const reasonOf = (body: any): string | null => {
  const t = typeof body?.reason === 'string' ? body.reason.trim() : '';
  return t.length >= REASON_MIN && t.length <= 500 ? t : null;
};
const noReason = (c: any) => refuse(c, 400, { code: 'reason_required', message: `Say why, in at least ${REASON_MIN} characters. It is kept in the admin audit.` });

/** The SQL list of beta keys, as a JSON array to bind (`json_each`). */
const keyList = () => JSON.stringify([...KEYS]);

type CohortRow = { user_id: number; uid: string; name: string | null; company: string | null; features: string; added_at: string; added_by: number | null };

r.get('/', async (c) => {
  await requireHqAdmin(c);
  const q = String(c.req.query('q') ?? '').trim().slice(0, 80);
  const feature = String(c.req.query('feature') ?? '').trim();
  const addedBy = String(c.req.query('added_by') ?? '').trim();
  const page = Math.max(1, Math.min(1000, Number.parseInt(String(c.req.query('page') ?? '1'), 10) || 1));
  if (feature && !KEYS.has(feature)) return refuse(c, 400, { code: 'invalid_feature', message: 'feature must be one of the beta keys.' });
  let rows: CohortRow[];
  try {
    rows = (await c.env.DB.prepare(
      `SELECT u.id AS user_id, u.uid, u.name,
              (SELECT cp.company_name FROM user_company_links l JOIN company_profiles cp ON cp.id = l.company_id
                WHERE l.user_id = u.id ORDER BY l.is_primary_admin DESC, l.id LIMIT 1) AS company,
              json_group_array(f.key) AS features, MIN(f.updated_at) AS added_at,
              (SELECT f2.updated_by FROM feature_flags f2 WHERE f2.scope = 'user' AND f2.scope_id = CAST(u.id AS TEXT) AND f2.enabled = 1
                AND f2.key IN (SELECT value FROM json_each(?1)) ORDER BY f2.updated_at, f2.key LIMIT 1) AS added_by
         FROM feature_flags f JOIN users u ON CAST(u.id AS TEXT) = f.scope_id
        WHERE f.scope = 'user' AND f.enabled = 1 AND f.key IN (SELECT value FROM json_each(?1))
        GROUP BY u.id
        ORDER BY added_at DESC, u.id`,
    ).bind(keyList()).all<CohortRow>()).results ?? [];
  } catch {
    return refuse(c, 503, { code: 'cohort_unreadable', message: 'The beta cohort could not be read. That is not the same as nobody being in it.' });
  }
  const byIds = [...new Set(rows.map((x) => Number(x.added_by)).filter((n) => Number.isSafeInteger(n) && n > 0))];
  const admins = new Map<number, { uid: string; name: string }>();
  if (byIds.length) {
    try {
      for (const a of (await c.env.DB.prepare('SELECT id, uid, name FROM users WHERE id IN (SELECT value FROM json_each(?1))').bind(JSON.stringify(byIds))
        .all<{ id: number; uid: string; name: string | null }>()).results ?? []) admins.set(Number(a.id), { uid: a.uid, name: a.name || 'A former admin' });
    } catch { /* unread: added_by reads null, never an id */ }
  }
  let people = rows.map((x) => ({
    user: { uid: x.uid, name: x.name || 'A former member' }, company: x.company || null,
    features: (JSON.parse(x.features || '[]') as string[]).sort(),
    added_by: x.added_by ? admins.get(Number(x.added_by)) ?? null : null, added_at: x.added_at,
  }));
  if (q) { const n = q.toLowerCase(); people = people.filter((p) => p.user.name.toLowerCase().includes(n) || (p.company ?? '').toLowerCase().includes(n)); }
  if (feature) people = people.filter((p) => p.features.includes(feature));
  if (addedBy) people = people.filter((p) => p.added_by?.uid === addedBy);
  const total = people.length;
  return c.json({ people: people.slice((page - 1) * PER_PAGE, page * PER_PAGE), page, per_page: PER_PAGE, total, keys: betaKeys() });
});

r.get('/people', async (c) => {
  await requireHqAdmin(c);
  const q = String(c.req.query('q') ?? '').trim();
  if (q.length < 2) return refuse(c, 400, { code: 'query_too_short', message: 'Type at least 2 characters of a name.' });
  const like = `%${q.slice(0, 80).replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  const rows = (await c.env.DB.prepare(
    `SELECT u.uid, u.name, u.role,
            (SELECT cp.company_name FROM user_company_links l JOIN company_profiles cp ON cp.id = l.company_id
              WHERE l.user_id = u.id ORDER BY l.is_primary_admin DESC, l.id LIMIT 1) AS company
       FROM users u
      WHERE u.is_active = 1 AND u.deletion_requested_at IS NULL AND u.name LIKE ?1 ESCAPE '\\'
      ORDER BY u.name, u.id LIMIT ?2`,
  ).bind(like, PEOPLE_MAX).all<{ uid: string; name: string | null; role: string | null; company: string | null }>()).results ?? [];
  return c.json({ people: rows.map((p) => ({ uid: p.uid, name: p.name || 'A member', company: p.company || null, role: p.role || null })) });
});

r.post('/', async (c) => {
  const admin = await requireHqAdmin(c);
  const body = await c.req.json().catch(() => ({} as any));
  const reason = reasonOf(body);
  if (!reason) return noReason(c);
  const keys = keysOf(body?.features);
  if (!keys) return refuse(c, 400, { code: 'invalid_feature', message: 'features must be beta keys: a deck feature, grid_generate, element:<id> or element:*.' });
  const uids = Array.isArray(body?.user_uids) ? [...new Set(body.user_uids.filter((u: unknown) => typeof u === 'string' && u.length <= 64))] as string[] : [];
  if (!uids.length || uids.length > 50) return refuse(c, 400, { code: 'invalid_people', message: 'Name between 1 and 50 people.' });
  const people = (await c.env.DB.prepare('SELECT id, uid FROM users WHERE uid IN (SELECT value FROM json_each(?1)) AND is_active = 1')
    .bind(JSON.stringify(uids)).all<{ id: number; uid: string }>()).results ?? [];
  if (people.length !== uids.length) return refuse(c, 404, { code: 'person_not_found', message: 'Someone named here is not an active member. Nothing was changed.' });
  const writes = [];
  for (const p of people) {
    for (const k of keys) {
      writes.push(c.env.DB.prepare(
        `INSERT INTO feature_flags (key, scope, scope_id, enabled, updated_by, updated_at) VALUES (?1, 'user', ?2, 1, ?3, datetime('now'))
         ON CONFLICT (key, scope, scope_id) DO UPDATE SET enabled = 1, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      ).bind(k, String(p.id), Number(admin.id) || null));
    }
  }
  await c.env.DB.batch(writes);
  await forgetFlags(c.env);
  for (const p of people) {
    await logAdminAction(c.env, Number(admin.id), String((admin as any).email ?? ''), 'deck_beta_add', { target_user_id: Number(p.id), features: keys, reason });
  }
  return c.json({ added: people.map((p) => p.uid), features: keys }, 201);
});

r.delete('/:userUid', async (c) => {
  const admin = await requireHqAdmin(c);
  const body = await c.req.json().catch(() => ({} as any));
  const reason = reasonOf(body);
  if (!reason) return noReason(c);
  const person = await c.env.DB.prepare('SELECT id, uid FROM users WHERE uid = ?1').bind(c.req.param('userUid')).first<{ id: number; uid: string }>();
  if (!person) return refuse(c, 404, { code: 'person_not_found', message: 'That member is not in the beta cohort.' });
  const had = ((await c.env.DB.prepare(
    `SELECT key FROM feature_flags WHERE scope = 'user' AND scope_id = ?1 AND key IN (SELECT value FROM json_each(?2)) ORDER BY key`,
  ).bind(String(person.id), keyList()).all<{ key: string }>()).results ?? []).map((x) => x.key);
  await c.env.DB.prepare(`DELETE FROM feature_flags WHERE scope = 'user' AND scope_id = ?1 AND key IN (SELECT value FROM json_each(?2))`)
    .bind(String(person.id), keyList()).run();
  // The beta column answers grid_generate and element:* when no row does: clear those keys too, leaving the member's other settings.
  try {
    const row = await c.env.DB.prepare('SELECT feature_flags FROM user_settings WHERE user_id = ?1').bind(person.id).first<{ feature_flags: string | null }>();
    const parsed = row?.feature_flags ? JSON.parse(row.feature_flags) : null;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const kept = Object.fromEntries(Object.entries(parsed).filter(([k]) => !KEYS.has(k)));
      if (Object.keys(kept).length !== Object.keys(parsed).length) {
        await c.env.DB.prepare('UPDATE user_settings SET feature_flags = ?1 WHERE user_id = ?2').bind(JSON.stringify(kept), person.id).run();
      }
    }
  } catch { /* no column on this database: the rows are gone either way */ }
  await forgetFlags(c.env);
  await logAdminAction(c.env, Number(admin.id), String((admin as any).email ?? ''), 'deck_beta_remove', { target_user_id: Number(person.id), features: had, reason });
  return c.json({ removed: person.uid, cleared: had });
});

export default r;

/** #4105: mounts itself; nothing else answers under this path. */
export const mount: RouteMount = { path: '/api/admin/deck-beta', router: r };
