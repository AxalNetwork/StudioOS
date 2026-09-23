/**
 * The operator switch store — a kill HQ can throw from the product, without a
 * deploy (D203, migration 283).
 *
 * WHY IT EXISTS. Until D203 every switch on the platform was a Worker
 * variable. Switching Eadwyn off meant editing ADVISOR_DISABLED and
 * redeploying, which in the middle of an incident is a push, a CI run and a
 * migration step before the refusal reaches anyone. `platform_switches` holds
 * the same kill as a row an operator writes from HQ · Platform → Switches.
 *
 * KILL-ONLY, AND THAT IS THE DESIGN. A row can only switch something OFF. The
 * reader that obeys a switch combines its deploy half and this row with OR, so
 * the store adds a kill and releases its own; it can never release a kill the
 * deployment set, and it can never switch a capability on. Charging, tax and
 * the queue therefore stay changeable only by a deployment somebody reviewed.
 *
 * ONE SWITCH TODAY. OPERATOR_SWITCH_KEYS is the list the route admits; a key
 * outside it is refused before anything is written, which is why the table
 * itself carries no CHECK on the key (migration 283 says why).
 *
 * HOW A READING TRAVELS, because it is on every Eadwyn request:
 *
 *   - One SELECT of every row, kept for OPERATOR_SWITCH_TTL_MS per isolate, in
 *     a WeakMap keyed on `bindingKey(env)` — never a module variable, which is
 *     the #203 bug: a module lives once per isolate, not once per database.
 *   - The isolate that WRITES clears its own reading, so its next request sees
 *     the change at once. Every other isolate sees it within the TTL. The
 *     console states that delay rather than implying the change is instant.
 *   - A read that fails keeps the LAST GOOD reading if there is one, and with
 *     none it answers `readable: false` with the reason. Either way the next
 *     attempt is after the same TTL: a failure is never latched, and a D1
 *     outage costs one failing read per isolate per TTL, not one per request.
 *   - Unreadable FAILS OPEN at the gate (services/advisor/rollout.ts): a D1
 *     blip must not switch Eadwyn off for everyone. The deploy variable stays
 *     the break-glass, and it is read first, with no database at all.
 *
 * NOTHING HERE CREATES THE TABLE. A read that finds no table says so; a write
 * that finds no table fails and the route answers 503 with nothing changed.
 * A runtime `CREATE TABLE` beside migration 283 would be a second definition
 * of one table, the collision D191's guard exists to catch.
 */
import type { Env } from '../types';
import { bindingKey } from '../util/schemaBootstrap';

/** The switches an operator may throw. Each one needs a reader that obeys it. */
export const OPERATOR_SWITCH_KEYS = ['eadwyn_off'] as const;
export type OperatorSwitchKey = typeof OPERATOR_SWITCH_KEYS[number];

export function isOperatorSwitchKey(key: string): key is OperatorSwitchKey {
  return (OPERATOR_SWITCH_KEYS as readonly string[]).includes(key);
}

/** How long one isolate keeps a reading of the store. */
export const OPERATOR_SWITCH_TTL_MS = 30_000;

/**
 * Where a switch thrown here takes effect, said on the console beside the
 * control. HQ's store is HQ's database: a branch Worker reads its own, where
 * no operator switch is set, so a branch's Eadwyn keeps answering. Pushing a
 * switch to the branches is not built (D203 files it, on D198's precedent).
 */
export const OPERATOR_SWITCH_REACH =
  'A switch thrown here stops Eadwyn on HQ\'s own deployment. A branch runs on its own database, '
  + 'where no operator switch is set, so a branch\'s Eadwyn keeps answering — pushing a switch to '
  + 'the branches is not built.';

/** The least a throw or a release must say about why. It is stored with the row and the audit entry. */
export const SWITCH_REASON_MIN = 10;

export interface OperatorSwitchRow {
  thrown: boolean;
  reason: string;
  set_by_user_id: number | null;
  /** SQLite's clock, `YYYY-MM-DD HH:MM:SS`. */
  set_at: string;
}

export type OperatorSwitchRead =
  | {
    readable: true;
    rows: ReadonlyMap<string, OperatorSwitchRow>;
    /** When this reading was taken from the database, ISO. */
    read_at: string;
    /** Set when the latest attempt failed and this is the last good reading. */
    stale_reason?: string;
  }
  | { readable: false; reason: string };

interface Reading {
  good: { rows: Map<string, OperatorSwitchRow>; read_at: number } | null;
  checked_at: number;
  error: string | null;
}

const readings = new WeakMap<object, Reading>();

/** Why the store could not be read, in words an operator can act on. */
function unreadableReason(e: unknown): string {
  const msg = String((e as Error)?.message || e || '');
  if (/no such table/i.test(msg)) {
    return 'The operator switch store has not been created on this database yet.';
  }
  return 'The operator switch store did not answer.';
}

function answer(r: Reading): OperatorSwitchRead {
  if (r.good) {
    return {
      readable: true,
      rows: r.good.rows,
      read_at: new Date(r.good.read_at).toISOString(),
      ...(r.error ? { stale_reason: r.error } : {}),
    };
  }
  return { readable: false, reason: r.error || 'The operator switch store has not been read.' };
}

/**
 * Every operator switch row, as this isolate last read it.
 *
 * `fresh` skips the TTL and reads now — the console asks that way, so an
 * operator looking at the page sees what is stored rather than what this
 * isolate read up to thirty seconds ago. It fails the same way the gate's read
 * does: the last good reading stands, with the reason it is not newer.
 */
export async function readOperatorSwitches(
  env: Env,
  opts: { now?: number; fresh?: boolean } = {},
): Promise<OperatorSwitchRead> {
  const now = opts.now ?? Date.now();
  const key = bindingKey(env);
  const held = readings.get(key);
  if (held && !opts.fresh && now - held.checked_at < OPERATOR_SWITCH_TTL_MS) return answer(held);

  let next: Reading;
  try {
    const res = await env.DB.prepare(
      'SELECT switch_key, thrown, reason, set_by_user_id, set_at FROM platform_switches',
    ).all<{ switch_key: string; thrown: number; reason: string | null; set_by_user_id: number | null; set_at: string }>();
    const rows = new Map<string, OperatorSwitchRow>();
    for (const row of res.results || []) {
      rows.set(String(row.switch_key), {
        thrown: Number(row.thrown) === 1,
        reason: String(row.reason ?? ''),
        set_by_user_id: row.set_by_user_id == null ? null : Number(row.set_by_user_id),
        set_at: String(row.set_at ?? ''),
      });
    }
    next = { good: { rows, read_at: now }, checked_at: now, error: null };
  } catch (e) {
    next = { good: held?.good ?? null, checked_at: now, error: unreadableReason(e) };
  }
  readings.set(key, next);
  return answer(next);
}

/**
 * Throw (`thrown = true`) or release one operator switch.
 *
 * Answers `changed: false` when the switch was already in that state — a throw
 * of a thrown switch, or a release of one nobody threw — and writes nothing,
 * so the route can refuse it before an audit row records an act that did not
 * happen. A store error THROWS: the caller answers 503 and nothing changed.
 *
 * The state test is inside the statement, not a read before it, so two
 * operators pressing at once cannot both record a change.
 */
export async function setOperatorSwitch(
  env: Env,
  key: OperatorSwitchKey,
  thrown: boolean,
  reason: string,
  actorUserId: number,
): Promise<{ changed: boolean }> {
  const res = thrown
    ? await env.DB.prepare(
      `INSERT INTO platform_switches (switch_key, thrown, reason, set_by_user_id, set_at)
       VALUES (?, 1, ?, ?, datetime('now'))
       ON CONFLICT(switch_key) DO UPDATE SET
         thrown = 1, reason = excluded.reason,
         set_by_user_id = excluded.set_by_user_id, set_at = excluded.set_at
       WHERE platform_switches.thrown = 0`,
    ).bind(key, reason, actorUserId).run()
    : await env.DB.prepare(
      `UPDATE platform_switches
          SET thrown = 0, reason = ?, set_by_user_id = ?, set_at = datetime('now')
        WHERE switch_key = ? AND thrown = 1`,
    ).bind(reason, actorUserId, key).run();

  // This isolate's next request reads the store again rather than its old
  // reading. The others follow within OPERATOR_SWITCH_TTL_MS.
  readings.delete(bindingKey(env));
  return { changed: Number(res?.meta?.changes ?? 0) > 0 };
}

/**
 * The name to show for whoever last set a switch — for the console only,
 * never on the gate's path, so a request to Eadwyn never touches `users` for
 * this. Null when the account cannot be named; the page then shows the id.
 */
export async function operatorSwitchActorName(env: Env, userId: number | null): Promise<string | null> {
  if (userId == null) return null;
  try {
    const row = await env.DB.prepare('SELECT name, email FROM users WHERE id = ?')
      .bind(userId).first<{ name: string | null; email: string | null }>();
    return (row?.name && row.name.trim()) || row?.email || null;
  } catch {
    return null;
  }
}
