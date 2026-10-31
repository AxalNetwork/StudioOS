/**
 * D1421 (#3699): `/api/studio` — the modules a member's Studio may place, and
 * their saved layout.
 *
 * - `GET /modules`: this profile's catalogue (`services/studioModules.ts`),
 *   each with `locked_by_plan` from the existing paywalls; D1418 adds its
 *   groups, each module's purpose, Open link and `in_default`.
 * - `GET /layout`: the saved layout, or the profile's default when there is
 *   no row. Nothing is written by a read.
 * - `PUT /layout`: replace it. Unknown, removed, fixed, other-profile and
 *   locked keys, duplicates, bad sizes and more than 12 entries are refused,
 *   and nothing is written.
 * - `POST /layout/reset`: delete the row; the read answers the default again.
 *
 * The member is always the session's; an admin names the profile they preview
 * with `?profile=`. A display preference: no activity_logs row (migration 687).
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { refuse } from '../util/refusal';
import {
  STUDIO_DEFAULTS, STUDIO_GROUPS, STUDIO_LAYOUT_MAX, STUDIO_SIZES, catalogueOf, lockOf, studioProfile,
  type StudioProfile, type StudioSize,
} from '../services/studioModules';

const r = new Hono<{ Bindings: Env }>();
r.use('*', bodyLimit({ maxSize: 8 * 1024, onError: (c) => refuse(c, 413, { code: 'payload_too_large', message: 'That layout is too large to save.' }) }));

type Who = { user: User; profile: StudioProfile };
async function who(c: Context<{ Bindings: Env }>): Promise<Who | Response> {
  let user: User;
  try { user = await requireAuth(c); } catch { return refuse(c, 401, { code: 'unauthorized', message: 'Sign in to arrange your Studio.' }); }
  const answer = studioProfile(user, c.req.query('profile'));
  if ('refusal' in answer) return refuse(c, answer.refusal.status, { code: answer.refusal.code, message: answer.refusal.message });
  return { user, profile: answer.profile };
}

type Row = { layout: string; updated_at: string };
async function savedRow(env: Env, userId: number, profile: StudioProfile): Promise<Row | null> {
  return await env.DB.prepare('SELECT layout, updated_at FROM studio_layouts WHERE user_id = ?1 AND profile = ?2')
    .bind(userId, profile).first<Row>();
}

/** The read every route answers with: saved or default, each entry with its lock, and saved keys no longer offered named in `dropped`. */
function layoutView(user: User, profile: StudioProfile, row: Row | null) {
  const catalogue = new Map(catalogueOf(profile, user).map((m) => [m.key, m]));
  const source = row ? 'saved' as const : 'default' as const;
  const entries: Array<{ key: string; size: StudioSize }> = row ? JSON.parse(row.layout) : STUDIO_DEFAULTS[profile].map((e) => ({ ...e }));
  if (!Array.isArray(entries)) throw new Error('layout_not_array');
  const dropped: string[] = [];
  const layout = [];
  for (const e of entries) {
    const mod = catalogue.get(e?.key);
    if (!mod) { dropped.push(String(e?.key)); continue; }
    layout.push({ key: mod.key, size: e.size, locked_by_plan: lockOf(user, mod) !== null });
  }
  return { profile, source, layout, updated_at: row?.updated_at ?? null, dropped };
}

async function readLayout(c: Context<{ Bindings: Env }>, w: Who) {
  const row = await savedRow(c.env, w.user.id, w.profile);
  try { return c.json(layoutView(w.user, w.profile, row)); }
  catch (e) { return refuse(c, 500, { code: 'layout_unreadable', message: 'Your saved Studio layout could not be read. Reset it to start again.', raw: e }); }
}

// D1418 (#3862): the full catalogue, its groups in order (a group with no
// module offered is left out), each module's purpose and Open link, and which
// are in the profile's default (the module map's "Recommended for you").
r.get('/modules', async (c) => {
  const w = await who(c);
  if (w instanceof Response) return w;
  const catalogue = catalogueOf(w.profile, w.user);
  const defaults = new Set(STUDIO_DEFAULTS[w.profile].map((d) => d.key));
  return c.json({
    profile: w.profile,
    groups: STUDIO_GROUPS[w.profile].filter((g) => catalogue.some((m) => m.group === g.key)).map((g) => ({ key: g.key, label: g.label })),
    modules: catalogue.map((m) => {
      const plan = lockOf(w.user, m);
      return {
        key: m.key, title: m.title, group: m.group, purpose: m.purpose, href: m.href, default_size: m.default_size,
        in_default: defaults.has(m.key), cohort_only: m.cohort_only === true, locked_by_plan: plan !== null, plan,
      };
    }),
  });
});

r.get('/layout', async (c) => {
  const w = await who(c);
  if (w instanceof Response) return w;
  return readLayout(c, w);
});

r.put('/layout', async (c) => {
  const w = await who(c);
  if (w instanceof Response) return w;
  const body = await c.req.json().catch(() => null);
  const bad = (code: string, message: string, extra?: Record<string, unknown>) => refuse(c, 400, { code, message, extra });
  if (!body || typeof body !== 'object' || Array.isArray(body) || !Array.isArray(body.layout))
    return bad('invalid_layout', 'Send the layout as a list of modules, each with a key and a size.');
  const list: unknown[] = body.layout;
  if (list.length > STUDIO_LAYOUT_MAX)
    return bad('too_many_modules', `A Studio holds at most ${STUDIO_LAYOUT_MAX} modules.`);
  const catalogue = new Map(catalogueOf(w.profile, w.user).map((m) => [m.key, m]));
  const seen = new Set<string>();
  const clean: Array<{ key: string; size: StudioSize }> = [];
  for (const item of list) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || typeof (item as any).key !== 'string'
      || Object.keys(item).some((k) => k !== 'key' && k !== 'size'))
      return bad('invalid_layout', 'Each module needs exactly a key and a size.');
    const { key, size } = item as { key: string; size: unknown };
    if (!(STUDIO_SIZES as readonly unknown[]).includes(size))
      return bad('invalid_size', 'A module is a third, a half or the full width.', { key });
    if (seen.has(key)) return bad('duplicate_module', 'Each module can be placed once.', { key });
    seen.add(key);
    const mod = catalogue.get(key);
    if (!mod) return bad('unknown_module', 'That module is not available in this Studio.', { key });
    const plan = lockOf(w.user, mod);
    if (plan) return refuse(c, 402, { code: 'module_locked', message: `${mod.title} is on the ${plan.name} plan.`, extra: { key, plan } });
    clean.push({ key, size: size as StudioSize });
  }
  await c.env.DB.prepare(
    `INSERT INTO studio_layouts (user_id, profile, layout) VALUES (?1, ?2, ?3)
     ON CONFLICT (user_id, profile) DO UPDATE SET layout = excluded.layout, updated_at = datetime('now')`,
  ).bind(w.user.id, w.profile, JSON.stringify(clean)).run();
  return readLayout(c, w);
});

r.post('/layout/reset', async (c) => {
  const w = await who(c);
  if (w instanceof Response) return w;
  await c.env.DB.prepare('DELETE FROM studio_layouts WHERE user_id = ?1 AND profile = ?2').bind(w.user.id, w.profile).run();
  return readLayout(c, w);
});

export default r;
