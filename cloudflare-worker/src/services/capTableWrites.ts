/**
 * D691 (S19-B, #1699) — the cap table's one save, shared by the tool and the
 * Raise cycle.
 *
 * `saveScenario()` is the save `POST /api/captable/scenarios` and
 * `PUT /api/captable/scenarios/:uid` used to carry inline. Both routes call
 * it, and #1700's `addHolder()` / `updateHolder()` recompute through it, so
 * the tool and the cycle share one recompute. It keeps:
 *   - the one cap table per venture: a POST for a project that has a base
 *     scenario updates that row (Task #28);
 *   - the unique-index recovery: a POST that loses the race to insert the
 *     base row updates the winner instead (Task #32), and a PUT that would
 *     bind a second base row answers 409;
 *   - D632's activity row on a PUT.
 * The routes keep their plan gate (`ensureTier`), their access checks and
 * their validation; this runs after them.
 *
 * ENTRY KEYS (decision 4). Before `inputs_json` is stored, every `founders[]`,
 * `safes[]` and `rounds[]` entry carries a `key`, `e-<n>`, which the Raise
 * list reads as the holder's id. An entry posted without one takes, in order:
 *   1. the key of the stored entry with the same name in the same list,
 *      unless another posted entry already holds it;
 *   2. else the next `e-<n>` never issued in this scenario.
 * A posted key is kept when it has the shape and no earlier entry holds it.
 * Matching by name keeps keys steady although the tool does not reload its
 * inputs after a save (`CapTablePage.jsx:257-261`).
 *
 * NEVER REUSED. A removed entry's key is not in the stored lists any more, so
 * the highest `n` issued is kept beside them, as `inputs.entry_key_seq`.
 * `simulate` reads only its named fields (`services/captable.ts:20-44`), so
 * neither the keys nor the sequence change a result, and the tool keeps both,
 * because its edits spread the entry and the inputs.
 */
import type { Env, User } from '../types';
import { simulate, validateInputs, type Inputs } from './captable';
import { ensureTier } from '../middleware/requireTier';
import { ensureCapTableVariantColumn } from './captableSchema';
import { hashEmail } from '../util/hashEmail';

export type ScenarioRow = {
  id: number; uid: string; owner_user_id: number; project_id: number | null;
  name: string; inputs_json: string; result_json: string | null;
  computed_at: string | null; created_at: string; updated_at: string;
  // Task #29 — 0 = canonical (project cap table), 1 = draft variant.
  is_variant: number | null;
};

/** The three lists whose entries carry a key, in the order keys are issued. */
export const KEYED_LISTS = ['founders', 'safes', 'rounds'] as const;
/** The highest `e-<n>` this scenario has issued, kept beside the lists. */
export const ENTRY_KEY_SEQ = 'entry_key_seq';
/** `e-<n>`, n from 1. Nine digits at most, so the number stays exact. */
const ENTRY_KEY = /^e-([1-9][0-9]{0,8})$/;

const keyNumber = (key: unknown): number | null => {
  const m = typeof key === 'string' ? ENTRY_KEY.exec(key) : null;
  return m ? Number(m[1]) : null;
};
const isEntry = (e: unknown): e is Record<string, any> => !!e && typeof e === 'object' && !Array.isArray(e);
const nameOf = (e: Record<string, any>) => String(e.name ?? '').trim();

/**
 * `posted` with a key on every entry of the three lists and the sequence
 * beside them, matched against `stored` (the row's inputs before this save,
 * or null for a new scenario). Pure; `posted` is not changed.
 */
export function withEntryKeys(posted: Inputs, stored: Inputs | null): Inputs {
  const out: Record<string, any> = { ...(posted || {}) };
  const prior: Record<string, any> = stored && typeof stored === 'object' ? stored : {};

  let seq = 0;
  const raise = (n: unknown) => { const v = Number(n); if (Number.isInteger(v) && v > seq && v < 1e9) seq = v; };
  raise(prior[ENTRY_KEY_SEQ]);
  raise(out[ENTRY_KEY_SEQ]);
  for (const list of KEYED_LISTS) {
    for (const src of [prior[list], out[list]]) {
      if (Array.isArray(src)) for (const e of src) if (isEntry(e)) raise(keyNumber(e.key));
    }
  }

  const held = new Set<string>();
  const lists: Record<string, any[]> = {};
  // 1. A posted key with the shape, first come, is kept.
  for (const list of KEYED_LISTS) {
    if (!Array.isArray(out[list])) continue;
    lists[list] = out[list].map((e: unknown) => {
      if (!isEntry(e)) return e;
      const copy = { ...e };
      if (keyNumber(copy.key) != null && !held.has(copy.key)) held.add(copy.key);
      else delete copy.key;
      return copy;
    });
  }
  // 2. An entry without one takes the key of the stored entry of its name in its list.
  for (const list of KEYED_LISTS) {
    const entries = lists[list];
    if (!entries) continue;
    const before = (Array.isArray(prior[list]) ? prior[list] : [])
      .filter((e: unknown) => isEntry(e) && keyNumber((e as any).key) != null) as Record<string, any>[];
    for (const e of entries) {
      if (!isEntry(e) || e.key) continue;
      const match = before.find((s) => !held.has(s.key) && nameOf(s) === nameOf(e));
      if (match) {
        e.key = match.key; held.add(match.key);
        // S1's ruling on #1700: a posted founder with no `holder_id` keeps the
        // register link of the stored entry it matched, so the tool's save,
        // which never reloads its inputs, does not unlink an Add holder founder.
        if (list === 'founders' && e.holder_id == null && match.holder_id != null) e.holder_id = match.holder_id;
      }
    }
  }
  // 3. The rest take the next key never issued.
  for (const list of KEYED_LISTS) {
    for (const e of lists[list] || []) {
      if (!isEntry(e) || e.key) continue;
      seq += 1;
      e.key = `e-${seq}`;
      held.add(e.key);
    }
    if (lists[list]) out[list] = lists[list];
  }
  out[ENTRY_KEY_SEQ] = seq;
  return out as Inputs;
}

/**
 * S1's ruling on #1700: a posted founder's `holder_id` stays only when it
 * names a `cap_table_holders` row of this venture, so a body can never link
 * another venture's register row (or any row, for a scenario with no venture).
 */
async function keepOwnHolders(env: Env, inputs: Inputs, projectId: number | null): Promise<Inputs> {
  const founders = (inputs as any)?.founders;
  if (!Array.isArray(founders) || !founders.some((f: any) => isEntry(f) && f.holder_id != null)) return inputs;
  const ids = founders.filter((f: any) => isEntry(f) && f.holder_id != null).map((f: any) => Number(f.holder_id))
    .filter((n: number) => Number.isInteger(n) && n > 0);
  const own = new Set<number>();
  if (projectId != null && ids.length) {
    const res = await env.DB.prepare(
      'SELECT id FROM cap_table_holders WHERE project_id = ? AND id IN (SELECT value FROM json_each(?))',
    ).bind(projectId, JSON.stringify(ids)).all<{ id: number }>();
    for (const r of res.results || []) own.add(Number(r.id));
  }
  return {
    ...(inputs as any),
    founders: founders.map((f: any) => {
      if (!isEntry(f) || f.holder_id == null || own.has(Number(f.holder_id))) return f;
      const { holder_id: _dropped, ...rest } = f;
      return rest;
    }),
  } as Inputs;
}

function storedInputs(row: ScenarioRow | null): Inputs | null {
  if (!row?.inputs_json) return null;
  try { return JSON.parse(row.inputs_json) as Inputs; } catch { return null; }
}

export async function loadScenarioByUid(env: Env, uid: string): Promise<ScenarioRow | null> {
  return env.DB.prepare('SELECT * FROM cap_table_scenarios WHERE uid = ?')
    .bind(uid).first<ScenarioRow>();
}

/**
 * D632 — a cap-table write records its actor in `activity_logs`, with the
 * project it belongs to. Best effort: the write has already happened, so a
 * failed log line only warns.
 */
export async function logScenarioAct(
  env: Env, user: { id: number; email?: string | null }, action: string,
  row: { uid: string; project_id: number | null; is_variant?: number | null }, extra: Record<string, unknown> = {},
): Promise<void> {
  try {
    const actor = await hashEmail(String(user.email || ''));
    await env.DB.prepare(
      'INSERT INTO activity_logs (project_id, user_id, action, details, actor) VALUES (?, ?, ?, ?, ?)',
    ).bind(row.project_id ?? null, user.id, action,
      JSON.stringify({ scenario_uid: row.uid, is_variant: row.is_variant ? 1 : 0, ...extra }), actor).run();
  } catch (e) {
    console.warn('[captable] activity log failed', action, (e as Error).message);
  }
}

/** D1/SQLite surfaces a unique-index violation as "UNIQUE constraint failed". */
export function isUniqueViolation(err: unknown): boolean {
  return /unique constraint failed/i.test(String((err as any)?.message ?? err ?? ''));
}

export type SaveScenarioArgs = {
  actor: { id: number; email?: string | null };
  name: string;
  /** Validated by the caller (`validateInputs`). */
  inputs: Inputs;
  projectId: number | null;
  /** The row a PUT edits. Without it the save is a POST: the project's base row, or a new one. */
  row?: ScenarioRow;
};

export type SaveScenarioResult =
  | { ok: true; row: ScenarioRow }
  /** A PUT that would make a second base cap table for its project. */
  | { ok: false; reason: 'project_has_cap_table' }
  /** The row could not be read back after the write. */
  | { ok: false; reason: 'update_failed' | 'insert_failed' };

const UPDATE_BY_ID = `UPDATE cap_table_scenarios
            SET name = ?, inputs_json = ?, result_json = ?, computed_at = ?, updated_at = ?
          WHERE id = ?`;
const CANONICAL = 'SELECT * FROM cap_table_scenarios WHERE project_id = ? AND COALESCE(is_variant,0) = 0 ORDER BY updated_at DESC LIMIT 1';

/** Key, simulate and store one scenario. A non-unique write error is thrown, as the routes always did. */
export async function saveScenario(env: Env, args: SaveScenarioArgs): Promise<SaveScenarioResult> {
  await ensureCapTableVariantColumn(env);
  const { actor, name, projectId } = args;
  const now = new Date().toISOString();

  if (args.row) {
    const row = args.row;
    const inputs = await keepOwnHolders(env, withEntryKeys(args.inputs, storedInputs(row)), projectId);
    const result = simulate(inputs);
    try {
      await env.DB.prepare(
        `UPDATE cap_table_scenarios
          SET name = ?, inputs_json = ?, result_json = ?, computed_at = ?,
              updated_at = ?, project_id = ?
        WHERE uid = ?`,
      ).bind(name, JSON.stringify(inputs), JSON.stringify(result), now, now, projectId, row.uid).run();
    } catch (e) {
      // Task #32 — the DB partial unique index backstops the route's clash
      // check: if a concurrent save bound this project between that SELECT
      // and here, the same 409, not a 500.
      if (isUniqueViolation(e)) return { ok: false, reason: 'project_has_cap_table' };
      throw e;
    }
    const fresh = await loadScenarioByUid(env, row.uid);
    // D632 — a variant renamed or edited in place says so, with the old name.
    await logScenarioAct(env, actor, 'captable_scenario_updated', fresh as ScenarioRow,
      row.name !== name ? { renamed_from: row.name } : {});
    return { ok: true, row: fresh as ScenarioRow };
  }

  // Task #28 — one cap table per project. When a project is provided and a
  // scenario already exists for it, UPDATE that row instead of inserting a
  // duplicate (guards against stale frontend state).
  if (projectId != null) {
    const existing = await env.DB.prepare(CANONICAL).bind(projectId).first<ScenarioRow>();
    if (existing) {
      const inputs = await keepOwnHolders(env, withEntryKeys(args.inputs, storedInputs(existing)), projectId);
      await env.DB.prepare(UPDATE_BY_ID)
        .bind(name, JSON.stringify(inputs), JSON.stringify(simulate(inputs)), now, now, existing.id).run();
      const updated = await loadScenarioByUid(env, existing.uid);
      return updated ? { ok: true, row: updated } : { ok: false, reason: 'update_failed' };
    }
  }

  const uid = crypto.randomUUID();
  const inputs = await keepOwnHolders(env, withEntryKeys(args.inputs, null), projectId);
  try {
    await env.DB.prepare(
      `INSERT INTO cap_table_scenarios
         (uid, owner_user_id, project_id, name, inputs_json, result_json, computed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(uid, actor.id, projectId, name, JSON.stringify(inputs), JSON.stringify(simulate(inputs)), now, now, now).run();
  } catch (e) {
    // Task #32 — DB-level "one canonical cap table per project" guard (partial
    // unique index). Two saves for the same project can race between the
    // SELECT above and this INSERT (double-click / two tabs / a retry); the
    // index rejects the second INSERT. Recover exactly like the upsert branch:
    // load the row the winner created and UPDATE it, keyed against the
    // winner's entries, so a lost race is a silent edit, not a 500.
    if (projectId != null && isUniqueViolation(e)) {
      const winner = await env.DB.prepare(CANONICAL).bind(projectId).first<ScenarioRow>();
      if (winner) {
        const merged = await keepOwnHolders(env, withEntryKeys(args.inputs, storedInputs(winner)), projectId);
        await env.DB.prepare(UPDATE_BY_ID)
          .bind(name, JSON.stringify(merged), JSON.stringify(simulate(merged)), now, now, winner.id).run();
        const row = await loadScenarioByUid(env, winner.uid);
        if (row) return { ok: true, row };
      }
    }
    throw e;
  }
  const row = await loadScenarioByUid(env, uid);
  return row ? { ok: true, row } : { ok: false, reason: 'insert_failed' };
}

// ---------------------------------------------------------------------------
// D691 decision 4 (#1700) — `addHolder()` and `updateHolder()`: the one writer
// for Raise's Add holder and Build's Add founder (#1695).
//
//   - Founders · Common writes a `cap_table_holders` row for the venture
//     (owned by the account whose `founder_id` is the project's, as
//     `ownsVenture` matches), its `cap_table_vesting` row on the same
//     `user_id` and `holder_id` when `vesting` is given, and a `founders[]`
//     entry carrying `holder_id`. It returns `h-<holder_id>`.
//   - Investors · SAFE or Convertible note adds a `safes[]` entry, money
//     converted from cents to the scenario's dollars. No register row. It
//     returns the entry's `e-<n>`.
//   - Both recompute through `saveScenario()`.
//   - THE PLAN GATE TRAVELS WITH THE WRITER: a caller below `studio` gets
//     `ensureTier`'s 402 (thrown as a Response) and nothing is written.
//   - NEITHER LOGS. The caller logs its own row (`raise.cap-table`,
//     `build.founding-team`).
//   - Option pool, Advisors, Options and Preferred are not offered: the pool
//     is set in the tool and a priced round's investors come from Model a round.
// ---------------------------------------------------------------------------

/** A refusal with its status and the sentence the caller shows. */
export class HolderError extends Error {
  status: number;
  sentence: string;
  constructor(status: number, sentence: string) { super(sentence); this.status = status; this.sentence = sentence; }
}

export type HolderVesting = { start_date: string; total_months: number; cliff_months: number };

export type AddHolderArgs = {
  projectId: number;
  actor: User;
  name: string;
  email?: string | null;
  group: 'founders' | 'investors';
  instrument: 'common' | 'safe' | 'note';
  shares?: number | null;
  ownership_pct?: number | null;
  amount_cents?: number | null;
  cap_cents?: number | null;
  discount_pct?: number | null;
  founder_role?: string | null;
  vesting?: HolderVesting | null;
  prospect_id?: number | null;
};

export type UpdateHolderArgs = {
  projectId: number;
  actor: User;
  id: string;
  name?: string;
  email?: string | null;
  shares?: number | null;
  ownership_pct?: number | null;
  amount_cents?: number | null;
  cap_cents?: number | null;
  discount_pct?: number | null;
  vesting?: HolderVesting | null;
  prospect_id?: number | null;
};

/** The base share count a founding table starts from when no founder holds any yet. */
export const FOUNDING_SHARES_BASE = 10_000_000;

const posInt = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null);
const pctIn = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 100 ? v : null);

function cleanName(v: unknown): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s || s.length > 200) throw new HolderError(400, 'name must be 1..200 characters');
  return s;
}

function cleanVesting(v: unknown): HolderVesting | null {
  if (v == null) return null;
  const o = v as Record<string, unknown>;
  const start = typeof o.start_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.start_date) ? o.start_date : null;
  const total = posInt(o.total_months);
  const cliff = typeof o.cliff_months === 'number' && Number.isInteger(o.cliff_months) && o.cliff_months >= 0 ? o.cliff_months : null;
  if (!start || total == null || cliff == null || cliff > total) {
    throw new HolderError(400, 'vesting needs start_date (YYYY-MM-DD), total_months and cliff_months no longer than the total');
  }
  return { start_date: start, total_months: total, cliff_months: cliff };
}

/** A prospect a body names must be one of this venture's (until `ownedRow` lands, S1's ruling). */
async function checkProspect(env: Env, projectId: number, prospectId: unknown): Promise<number | null> {
  if (prospectId == null) return null;
  const id = posInt(prospectId);
  const row = id == null ? null : await env.DB.prepare('SELECT id FROM raise_prospects WHERE id = ? AND project_id = ?')
    .bind(id, projectId).first<{ id: number }>();
  if (!row) throw new HolderError(404, 'Prospect not found');
  return Number(row.id);
}

async function baseScenario(env: Env, projectId: number): Promise<ScenarioRow | null> {
  await ensureCapTableVariantColumn(env);
  return env.DB.prepare(CANONICAL).bind(projectId).first<ScenarioRow>();
}

function checkInputs(inputs: Inputs) {
  const errs = validateInputs(inputs);
  if (errs.length) throw new HolderError(400, errs.join(' '));
}

/** Save the base scenario through `saveScenario()`'s POST path, which upserts it and logs nothing. */
async function recompute(env: Env, actor: User, projectId: number, base: ScenarioRow | null, inputs: Inputs) {
  const saved = await saveScenario(env, { actor, name: base?.name || 'Cap table', inputs, projectId });
  if (!saved.ok) throw new HolderError(500, 'The cap table could not be saved');
  return saved.row;
}

function safeEntry(name: string, a: { instrument: string; amount_cents?: number | null; cap_cents?: number | null; discount_pct?: number | null; prospect_id: number | null }) {
  const amount = posInt(a.amount_cents);
  if (amount == null) throw new HolderError(400, 'amount_cents must be a positive whole number of cents');
  const e: Record<string, unknown> = { name, amount: amount / 100 };
  if (a.cap_cents != null) {
    const cap = posInt(a.cap_cents);
    if (cap == null) throw new HolderError(400, 'cap_cents must be a positive whole number of cents');
    e.cap = cap / 100;
  }
  if (a.discount_pct != null) {
    if (typeof a.discount_pct !== 'number' || !(a.discount_pct >= 0 && a.discount_pct <= 90)) throw new HolderError(400, 'discount_pct must be 0..90');
    e.discount = a.discount_pct / 100;
  }
  if (a.instrument === 'note') e.instrument = 'note';
  if (a.prospect_id != null) e.prospect_id = a.prospect_id;
  return e;
}

export async function addHolder(env: Env, args: AddHolderArgs): Promise<{ id: string; holderId: number | null }> {
  ensureTier(args.actor, 'studio');
  const pair = `${args.group}:${args.instrument}`;
  if (!['founders:common', 'investors:safe', 'investors:note'].includes(pair)) {
    throw new HolderError(400, 'Add holder takes Founders · Common, or Investors · SAFE or Convertible note');
  }
  const name = cleanName(args.name);
  const prospectId = await checkProspect(env, args.projectId, args.prospect_id);
  const base = await baseScenario(env, args.projectId);
  const stored: Record<string, any> = storedInputs(base) || {};

  if (args.group === 'investors') {
    const entry = safeEntry(name, { ...args, prospect_id: prospectId });
    const safes = [...(Array.isArray(stored.safes) ? stored.safes : []), entry];
    const inputs = { ...stored, safes } as Inputs;
    checkInputs(inputs);
    const row = await recompute(env, args.actor, args.projectId, base, inputs);
    const saved = (storedInputs(row) as any)?.safes ?? [];
    return { id: String(saved[safes.length - 1]?.key ?? ''), holderId: null };
  }

  // Founders · Common.
  const vesting = cleanVesting(args.vesting);
  const founders = Array.isArray(stored.founders) ? stored.founders : [];
  const total = founders.reduce((n: number, f: any) => n + (Number(f?.shares) > 0 ? Number(f.shares) : 0), 0);
  const pct = args.ownership_pct == null ? null : pctIn(args.ownership_pct);
  if (args.ownership_pct != null && pct == null) throw new HolderError(400, 'ownership_pct must be between 0 and 100');
  let shares = args.shares == null ? null : posInt(args.shares);
  if (args.shares != null && shares == null) throw new HolderError(400, 'shares must be a positive whole number');
  if (shares == null && pct != null) {
    // With only a percentage, the founder holds that share of the founding table.
    shares = total > 0 ? Math.round((pct * total) / (100 - pct)) : Math.round((FOUNDING_SHARES_BASE * pct) / 100);
  }
  if (shares == null || shares <= 0) throw new HolderError(400, 'A founder needs shares or ownership_pct');
  const owner = await env.DB.prepare(
    'SELECT u.id FROM users u JOIN projects p ON p.founder_id = u.founder_id WHERE p.id = ? ORDER BY u.id LIMIT 1',
  ).bind(args.projectId).first<{ id: number }>();
  if (!owner) throw new HolderError(409, 'This venture has no owner account to hold the register row');
  // Validated before anything is written.
  checkInputs({ ...stored, founders: [...founders, { name, shares }] } as Inputs);

  const role = typeof args.founder_role === 'string' && args.founder_role.trim() ? args.founder_role.trim().slice(0, 120) : null;
  const email = typeof args.email === 'string' && args.email.trim() ? args.email.trim().slice(0, 320) : null;
  const ins = await env.DB.prepare(
    `INSERT INTO cap_table_holders (user_id, project_id, name, email, security_type, shares, ownership_pct, source, kind, founder_role)
     VALUES (?, ?, ?, ?, 'common', ?, ?, 'manual', 'founder', ?) RETURNING id`,
  ).bind(owner.id, args.projectId, name, email, shares, pct, role).first<{ id: number }>();
  const holderId = Number(ins?.id);
  if (!Number.isInteger(holderId) || holderId <= 0) throw new HolderError(500, 'The holder could not be written');
  try {
    if (vesting) {
      await env.DB.prepare(
        `INSERT INTO cap_table_vesting (user_id, holder_id, start_date, cliff_months, total_months, total_shares, source)
         VALUES (?, ?, ?, ?, ?, ?, 'manual')`,
      ).bind(owner.id, holderId, vesting.start_date, vesting.cliff_months, vesting.total_months, shares).run();
    }
    await recompute(env, args.actor, args.projectId, base, { ...stored, founders: [...founders, { name, shares, holder_id: holderId }] } as Inputs);
  } catch (e) {
    // Nothing half-written: the register and vesting rows go if the save fails.
    await env.DB.batch([
      env.DB.prepare('DELETE FROM cap_table_vesting WHERE holder_id = ? AND user_id = ?').bind(holderId, owner.id),
      env.DB.prepare('DELETE FROM cap_table_holders WHERE id = ? AND project_id = ?').bind(holderId, args.projectId),
    ]);
    throw e;
  }
  return { id: `h-${holderId}`, holderId };
}

export async function updateHolder(env: Env, args: UpdateHolderArgs): Promise<{ id: string; holderId: number | null }> {
  ensureTier(args.actor, 'studio');
  const m = /^(h|e)-([1-9][0-9]{0,9})$/.exec(String(args.id || ''));
  if (!m) throw new HolderError(404, 'Holder not found');
  const base = await baseScenario(env, args.projectId);
  const stored: Record<string, any> = storedInputs(base) || {};
  const founders: any[] = Array.isArray(stored.founders) ? stored.founders.map((f: any) => (isEntry(f) ? { ...f } : f)) : [];
  const safes: any[] = Array.isArray(stored.safes) ? stored.safes.map((f: any) => (isEntry(f) ? { ...f } : f)) : [];
  const name = args.name === undefined ? undefined : cleanName(args.name);
  const prospectId = args.prospect_id === undefined ? undefined : await checkProspect(env, args.projectId, args.prospect_id);

  if (m[1] === 'h') {
    const holderId = Number(m[2]);
    const reg = await env.DB.prepare('SELECT id, user_id, name, shares, ownership_pct FROM cap_table_holders WHERE id = ? AND project_id = ?')
      .bind(holderId, args.projectId).first<{ id: number; user_id: number; name: string; shares: number | null; ownership_pct: number | null }>();
    if (!reg) throw new HolderError(404, 'Holder not found');
    const vesting = args.vesting === undefined ? undefined : cleanVesting(args.vesting);
    let shares = args.shares === undefined ? undefined : posInt(args.shares);
    if (args.shares !== undefined && shares == null) throw new HolderError(400, 'shares must be a positive whole number');
    const pct = args.ownership_pct === undefined ? undefined : (args.ownership_pct == null ? null : pctIn(args.ownership_pct));
    if (args.ownership_pct != null && pct == null) throw new HolderError(400, 'ownership_pct must be between 0 and 100');
    let at = founders.findIndex((f) => isEntry(f) && Number(f.holder_id) === holderId);
    if (at < 0) { founders.push({ name: reg.name, shares: Number(reg.shares) > 0 ? Number(reg.shares) : 0, holder_id: holderId }); at = founders.length - 1; }
    if (shares === undefined && pct != null) {
      const others = founders.reduce((n, f, i) => n + (i !== at && Number(f?.shares) > 0 ? Number(f.shares) : 0), 0);
      shares = others > 0 ? Math.round((pct * others) / (100 - pct)) : Math.round((FOUNDING_SHARES_BASE * pct) / 100);
    }
    const entry = founders[at];
    if (name !== undefined) entry.name = name;
    if (shares != null) entry.shares = shares;
    checkInputs({ ...stored, founders } as Inputs);
    const email = args.email === undefined ? undefined : (typeof args.email === 'string' && args.email.trim() ? args.email.trim().slice(0, 320) : null);
    await env.DB.prepare(
      `UPDATE cap_table_holders SET name = ?, email = COALESCE(?, email), shares = ?, ownership_pct = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND project_id = ?`,
    ).bind(entry.name, email ?? null, entry.shares, pct === undefined ? reg.ownership_pct : pct, holderId, args.projectId).run();
    if (vesting !== undefined && vesting !== null) {
      const up = await env.DB.prepare(
        `UPDATE cap_table_vesting SET start_date = ?, cliff_months = ?, total_months = ?, total_shares = ?, updated_at = CURRENT_TIMESTAMP
          WHERE holder_id = ? AND user_id = ?`,
      ).bind(vesting.start_date, vesting.cliff_months, vesting.total_months, entry.shares, holderId, reg.user_id).run();
      if (!Number(up.meta?.changes)) {
        await env.DB.prepare(
          `INSERT INTO cap_table_vesting (user_id, holder_id, start_date, cliff_months, total_months, total_shares, source)
           VALUES (?, ?, ?, ?, ?, ?, 'manual')`,
        ).bind(reg.user_id, holderId, vesting.start_date, vesting.cliff_months, vesting.total_months, entry.shares).run();
      }
    }
    await recompute(env, args.actor, args.projectId, base, { ...stored, founders } as Inputs);
    return { id: `h-${holderId}`, holderId };
  }

  // e-<n>: a founder entry with no register row, or a SAFE / note.
  const key = `e-${m[2]}`;
  const fi = founders.findIndex((f) => isEntry(f) && f.key === key);
  const si = safes.findIndex((f) => isEntry(f) && f.key === key);
  if (fi >= 0) {
    const entry = founders[fi];
    if (entry.holder_id != null) throw new HolderError(404, 'Holder not found');
    if (name !== undefined) entry.name = name;
    if (args.shares !== undefined) {
      const sh = posInt(args.shares);
      if (sh == null) throw new HolderError(400, 'shares must be a positive whole number');
      entry.shares = sh;
    }
  } else if (si >= 0) {
    const entry = safes[si];
    if (name !== undefined) entry.name = name;
    if (args.amount_cents !== undefined) {
      const a = posInt(args.amount_cents);
      if (a == null) throw new HolderError(400, 'amount_cents must be a positive whole number of cents');
      entry.amount = a / 100;
    }
    if (args.cap_cents !== undefined) {
      if (args.cap_cents == null) delete entry.cap;
      else { const c = posInt(args.cap_cents); if (c == null) throw new HolderError(400, 'cap_cents must be a positive whole number of cents'); entry.cap = c / 100; }
    }
    if (args.discount_pct !== undefined) {
      if (args.discount_pct == null) delete entry.discount;
      else if (typeof args.discount_pct !== 'number' || !(args.discount_pct >= 0 && args.discount_pct <= 90)) throw new HolderError(400, 'discount_pct must be 0..90');
      else entry.discount = args.discount_pct / 100;
    }
    if (prospectId !== undefined) { if (prospectId == null) delete entry.prospect_id; else entry.prospect_id = prospectId; }
  } else {
    throw new HolderError(404, 'Holder not found');
  }
  const inputs = { ...stored, founders, safes } as Inputs;
  checkInputs(inputs);
  await recompute(env, args.actor, args.projectId, base, inputs);
  return { id: key, holderId: null };
}
