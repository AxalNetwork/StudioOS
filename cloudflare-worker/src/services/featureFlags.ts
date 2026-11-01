/**
 * D1509 (#3760, deck v2 A16) — The Grid's feature flags: one for the
 * one-click run and area generation (`grid_generate`), one per grid element
 * (`element:<id>`) and one per model (`model:<catalogue id>`).
 *
 * WHERE A FLAG LIVES. `feature_flags` (migration 723), one row per key, scope
 * and scope id. The narrowest row wins: the member's own ('user'), then their
 * role's ('role', 'admin' being HQ), then everyone's ('global'). No row is the
 * flag's default, on: a flag is a switch HQ turns off, so a deploy changes
 * nothing until someone writes a row.
 *
 * THE BETA COHORT. Until a 'user' row is written for them, a member's
 * `user_settings.feature_flags` column (an HQ-set JSON object; the member
 * cannot write it since D1316) answers for the beta keys only, `grid_generate`
 * and `element:*`. It never turns a model on: a model switched off is off for
 * everyone, since a model is switched off for a reason (cost, quality, a
 * provider's hold).
 *
 * THE CACHE. Every row is read in one query and kept in KV (`TOKENS`, key
 * `feature_flags:v1`) for 60 s, so a change reaches every chip within a
 * minute; the admin write deletes the key, so its own isolate sees it at
 * once. A table that cannot be read (not migrated yet) reads as no rows:
 * every flag at its default, never a refusal.
 *
 * WHAT A FLAG DOES (D1509 §3):
 *   model off    `catalogueSwitchesFor` adds it to `MODELS_OFF`, so
 *                `catalogue.isOffered` refuses it everywhere the catalogue is
 *                asked: `GET /api/ai/rail`, the element-model replies, the
 *                lightbox chip, and the run itself (`aiRouter.chooseModels`).
 *                A member's pick of it is kept, not cleared, and reads as
 *                "<Model> is unavailable. Using <next>." (aird5).
 *   element off  its route answers 404 `not_switched_on`, "Not switched on
 *                yet.", which the adapter reports as such (never empty, never
 *                $0.00); the element-models reply marks it `switched_on: false`.
 *   grid_generate off  the one-click run refuses 404 `not_switched_on`.
 */
import type { Env, User } from '../types';
import type { CatalogueSwitches } from './ai/catalogue';

export const NOT_SWITCHED_ON = 'Not switched on yet.';
export const GRID_GENERATE = 'grid_generate';
export const CACHE_KEY = 'feature_flags:v1';
export const CACHE_TTL_S = 60;
export const SCOPES = ['global', 'role', 'user'] as const;
export type Scope = (typeof SCOPES)[number];

export type FlagRow = { key: string; scope: Scope; scope_id: string; enabled: number | boolean };

export const modelKey = (id: string): string => `model:${id}`;
export const elementKey = (id: string): string => `element:${id}`;

/** A key a row may be written under: `grid_generate`, `element:<id>` or `model:<id>`, as the route checks it against the catalogues. */
export function keyShape(key: unknown): 'grid' | 'element' | 'model' | null {
  if (key === GRID_GENERATE) return 'grid';
  if (typeof key !== 'string' || key.length > 200) return null;
  if (/^element:[a-z0-9_]{1,60}$/.test(key)) return 'element';
  if (/^model:[@A-Za-z0-9._\-/]{1,180}$/.test(key)) return 'model';
  return null;
}

/** The beta cohort's column answers these keys only (never a model). */
export const isBetaKey = (key: string): boolean => key === GRID_GENERATE || key.startsWith('element:');

/** Every row, from KV when it was read in the last 60 s, else from D1 (and cached). Unreadable → []. */
export async function loadFlagRows(env: Env): Promise<FlagRow[]> {
  const kv = env.TOKENS;
  try {
    const hit = kv ? await kv.get(CACHE_KEY, 'json') : null;
    if (Array.isArray(hit)) return hit as FlagRow[];
  } catch { /* a KV miss reads D1 */ }
  let rows: FlagRow[] = [];
  try {
    rows = ((await env.DB.prepare('SELECT key, scope, scope_id, enabled FROM feature_flags').all<FlagRow>()).results ?? [])
      .map((r) => ({ key: String(r.key), scope: r.scope, scope_id: String(r.scope_id ?? ''), enabled: Number(r.enabled) ? 1 : 0 }));
  } catch {
    // Not migrated yet, or D1 unreadable: every flag at its default. Not cached, so the next read tries again.
    return [];
  }
  try { await kv?.put(CACHE_KEY, JSON.stringify(rows), { expirationTtl: CACHE_TTL_S }); } catch { /* the rows still answer */ }
  return rows;
}

/** Drops the cache, so the next read in this isolate (and within 60 s everywhere) sees a write. */
export async function forgetFlags(env: Env): Promise<void> {
  try { await env.TOKENS?.delete(CACHE_KEY); } catch { /* expires in 60 s */ }
}

type Who = Pick<User, 'id' | 'role'> | null | undefined;

/** The member's beta column, as booleans for the beta keys only. Unreadable → {}. */
export async function betaColumn(env: Env, userId: number): Promise<Record<string, boolean>> {
  if (!userId) return {};
  try {
    const row = await env.DB.prepare('SELECT feature_flags FROM user_settings WHERE user_id = ?1').bind(userId).first<{ feature_flags: string | null }>();
    const parsed = JSON.parse(row?.feature_flags || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([k, v]) => isBetaKey(k) && typeof v === 'boolean')) as Record<string, boolean>;
  } catch { return {}; }
}

export type Flags = {
  on: (key: string) => boolean;
  /** Every model switched off for this member, for `CatalogueSwitches.MODELS_OFF`. */
  modelsOff: ReadonlySet<string>;
  elementOn: (id: string) => boolean;
  gridGenerate: boolean;
};

/** The flags as one member reads them, from the rows (and the beta column). Pure, so tests can hand it rows. */
export function flagsOf(rows: readonly FlagRow[], who: Who, beta: Record<string, boolean> = {}): Flags {
  const userId = who?.id != null ? String(who.id) : null;
  const role = who?.role ? String(who.role).toLowerCase() : null;
  const at = (key: string, scope: Scope, id: string | null) =>
    id == null ? undefined : rows.find((r) => r.key === key && r.scope === scope && r.scope_id === id);
  const on = (key: string): boolean => {
    const user = at(key, 'user', userId);
    if (user) return Boolean(Number(user.enabled));
    if (isBetaKey(key) && typeof beta[key] === 'boolean') return beta[key];
    const byRole = at(key, 'role', role);
    if (byRole) return Boolean(Number(byRole.enabled));
    const global = at(key, 'global', '');
    if (global) return Boolean(Number(global.enabled));
    return true;
  };
  const modelsOff = new Set<string>();
  for (const k of new Set(rows.filter((r) => r.key.startsWith('model:')).map((r) => r.key))) if (!on(k)) modelsOff.add(k.slice(6));
  return { on, modelsOff, elementOn: (id) => on(elementKey(id)), gridGenerate: on(GRID_GENERATE) };
}

/** The flags for this member, read through the cache. */
export async function flagsFor(env: Env, who: Who): Promise<Flags> {
  const rows = await loadFlagRows(env);
  const beta = who?.id ? await betaColumn(env, Number(who.id)) : {};
  return flagsOf(rows, who, beta);
}

/**
 * The models switched off for a run's member, from the user id alone (a run
 * carries no user row): the role is read only when a role row names a model.
 * Never throws: an unreadable table is no flag.
 */
export async function modelsOffFor(env: Env, userId: number): Promise<ReadonlySet<string>> {
  const rows = (await loadFlagRows(env)).filter((r) => r.key.startsWith('model:'));
  if (!rows.length) return new Set();
  let role: string | null = null;
  if (userId > 0 && rows.some((r) => r.scope === 'role')) {
    try { role = (await env.DB.prepare('SELECT role FROM users WHERE id = ?1').bind(userId).first<{ role: string | null }>())?.role ?? null; } catch { role = null; }
  }
  return flagsOf(rows, { id: userId > 0 ? userId : (null as any), role: role as any }).modelsOff;
}

/** The owner's catalogue switches with this member's switched-off models: what every `isOffered` call is handed. */
export function catalogueSwitchesFor(env: Partial<CatalogueSwitches> | null | undefined, flags: Pick<Flags, 'modelsOff'>): CatalogueSwitches {
  return { AI_PARTNER_MODELS: env?.AI_PARTNER_MODELS, AI_PAID_MODELS: env?.AI_PAID_MODELS, MODELS_OFF: flags.modelsOff };
}

/** aird5's line for a pick whose model is switched off. */
export const unavailableLine = (was: string | null, using: string | null): string =>
  `${was ?? 'That model'} is unavailable. Using ${using ?? 'no model'}.`;

/** The 404 every switched-off surface answers, in the shape `refuse` writes. */
export const notSwitchedOn = { code: 'not_switched_on', message: NOT_SWITCHED_ON } as const;
