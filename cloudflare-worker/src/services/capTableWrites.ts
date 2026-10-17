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
import type { Env } from '../types';
import { simulate, type Inputs } from './captable';
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
      if (match) { e.key = match.key; held.add(match.key); }
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
    const inputs = withEntryKeys(args.inputs, storedInputs(row));
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
      const inputs = withEntryKeys(args.inputs, storedInputs(existing));
      await env.DB.prepare(UPDATE_BY_ID)
        .bind(name, JSON.stringify(inputs), JSON.stringify(simulate(inputs)), now, now, existing.id).run();
      const updated = await loadScenarioByUid(env, existing.uid);
      return updated ? { ok: true, row: updated } : { ok: false, reason: 'update_failed' };
    }
  }

  const uid = crypto.randomUUID();
  const inputs = withEntryKeys(args.inputs, null);
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
        const merged = withEntryKeys(args.inputs, storedInputs(winner));
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
