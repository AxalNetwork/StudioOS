/**
 * D4860 part 3 (#4860, owner answer A = B) — the KV mirror of the operator
 * switches, so an emergency kill does not depend on D1, the failure domain it
 * is most likely thrown in.
 *
 * WHERE. The `TOKENS` KV namespace, which every deployment already binds (no
 * new binding, `wrangler.toml` untouched), one key per switch:
 * `operator_switch:<key>` → `{ thrown, revision, set_at }`. Never a reason, an
 * actor or a figure: `platform_switches` (migration 283) stays the record and
 * the audit trail. A deployment with no `TOKENS` binding (a test, a branch
 * that never bound it) has no mirror, and everything behaves as before D4860.
 *
 * HOW IT IS USED (services/operatorSwitches.ts, services/advisor/rollout.ts):
 *   - A THROW writes here FIRST, then D1 with its audit row. With D1 down the
 *     kill still takes effect, and the route says it was not recorded.
 *   - A RELEASE runs on D1 first, with its audit row, and clears this only
 *     once D1 no longer holds the throw. With D1 down nothing is released: an
 *     emergency kill fails safe.
 *   - THE GATE READS THIS BEFORE D1, and a switch is thrown when either says
 *     so. A thrown mirror decides without touching D1 at all.
 *
 * READINGS travel as the D1 store's do (D203): one `get` per switch held for
 * OPERATOR_SWITCH_TTL_MS per isolate, keyed on the binding, never a module
 * variable; the writing isolate clears its own reading; a failed read keeps
 * the last good reading and is retried after the same TTL, never latched. KV
 * itself is eventually consistent (about a minute across locations), so
 * every other location follows within about a minute.
 */
import type { Env } from '../types';

/** One isolate keeps a reading this long, as the D1 store's (services/operatorSwitches.ts). */
export const EMERGENCY_TTL_MS = 30_000;

/** The KV key a switch is mirrored under. */
export const emergencyKey = (key: string) => `operator_switch:${key}`;

export interface EmergencyRecord {
  thrown: boolean;
  /** The D1 revision this record matches, or null when D1 could not be written (a throw not yet recorded). */
  revision: number | null;
  /** ISO time of the write here. */
  set_at: string;
}

export type EmergencyRead =
  | { bound: false }
  | { bound: true; readable: true; record: EmergencyRecord | null; stale_reason?: string }
  | { bound: true; readable: false; reason: string };

interface MinimalKV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

const kvOf = (env: Env): MinimalKV | null => {
  const store = (env as unknown as { TOKENS?: MinimalKV }).TOKENS;
  return store && typeof store.get === 'function' && typeof store.put === 'function' ? store : null;
};

interface Reading { good: { record: EmergencyRecord | null } | null; checked_at: number; error: string | null }
const readings = new WeakMap<object, Map<string, Reading>>();

const UNREADABLE = 'The emergency switch store did not answer.';

/** A stored value as a record, or null when it is missing or not one. */
export function parseEmergency(raw: string | null): EmergencyRecord | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== 'object' || typeof v.thrown !== 'boolean') return null;
    const revision = Number.isSafeInteger(v.revision) && v.revision >= 0 ? v.revision : null;
    return { thrown: v.thrown, revision, set_at: typeof v.set_at === 'string' ? v.set_at.slice(0, 40) : '' };
  } catch {
    return null;
  }
}

/** The mirror of one switch, as this isolate last read it; `fresh` reads now (the console, and a release). */
export async function readEmergencySwitch(env: Env, key: string, opts: { now?: number; fresh?: boolean } = {}): Promise<EmergencyRead> {
  const store = kvOf(env);
  if (!store) return { bound: false };
  const now = opts.now ?? Date.now();
  let byKey = readings.get(store);
  if (!byKey) { byKey = new Map(); readings.set(store, byKey); }
  const held = byKey.get(key);
  let next: Reading;
  if (held && !opts.fresh && now - held.checked_at < EMERGENCY_TTL_MS) next = held;
  else {
    try {
      next = { good: { record: parseEmergency(await store.get(emergencyKey(key))) }, checked_at: now, error: null };
    } catch {
      next = { good: held?.good ?? null, checked_at: now, error: UNREADABLE };
    }
    byKey.set(key, next);
  }
  if (next.good) return { bound: true, readable: true, record: next.good.record, ...(next.error ? { stale_reason: next.error } : {}) };
  return { bound: true, readable: false, reason: next.error || UNREADABLE };
}

/** Whether a reading says the switch is thrown. Unbound or unreadable is not a throw (D1 still decides). */
export const emergencyThrown = (read: EmergencyRead | null | undefined): boolean =>
  !!read && read.bound && read.readable && read.record?.thrown === true;

/**
 * Write one switch's mirror. True when it was written, false when there is no
 * mirror or the write failed (never throws). This isolate's next read sees it.
 */
export async function writeEmergencySwitch(env: Env, key: string, record: { thrown: boolean; revision: number | null }, now = Date.now()): Promise<boolean> {
  const store = kvOf(env);
  if (!store) return false;
  readings.get(store)?.delete(key);
  try {
    await store.put(emergencyKey(key), JSON.stringify({ thrown: record.thrown, revision: record.revision, set_at: new Date(now).toISOString() }));
    return true;
  } catch {
    return false;
  }
}
