/**
 * #4678 (D4678) — the licence lifecycle as one state machine, with a
 * compare-and-swap on every move.
 *
 * Before this, `activate`, `suspend`, `reinstate`, `renew` and `terminate`
 * (and the compliance sweep, and the notice review that reinstates) each
 * validated a status read earlier and then UPDATEd by id. Two requests that
 * read the same row both passed, and the later write won: a stale reinstate
 * overwrote a completed termination and left an active licence with its
 * territory already released.
 *
 * NOW EVERY MOVE
 *   1. names the status and revision it read (`WHERE id = ? AND status = ? AND revision = ?`),
 *   2. bumps the revision in the same statement,
 *   3. is followed, in the same batch, by statements that run only if (2)
 *      applied (`appliedGuard`), so a termination's territory release cannot
 *      happen without the termination, and
 *   4. is checked for exactly one changed row. Any other count is a stale
 *      mutation: the caller answers 409 `licence_changed`, and nothing changed.
 *
 * THE TABLE BELOW IS THE STATE MACHINE. `terminated` appears in no `from`
 * list, and migration 202611071540's trigger refuses it at the database too.
 * Every move into `active` re-checks the activation prerequisites, in SQL
 * (territory, seats, terms, renewal date) as well as in the caller's blocker
 * list, so no alternate path (reinstate, a notice review, a suspend of a
 * draft) can produce an active licence that activation would have refused.
 */
import type { Env } from '../types';

export type LicenceVerb = 'activate' | 'suspend' | 'reinstate' | 'renew' | 'terminate';

/** The statuses a verb may start from. `terminated` is in none of them. */
export const FROM: Record<LicenceVerb, readonly string[]> = {
  activate: ['draft', 'pending_activation'],
  suspend: ['active'],
  reinstate: ['suspended'],
  renew: ['draft', 'pending_activation', 'active', 'suspended'],
  terminate: ['draft', 'pending_activation', 'active', 'suspended'],
};

/** The status each verb ends in; `renew` leaves it where it is. */
export const TO: Record<LicenceVerb, string | null> = {
  activate: 'active', suspend: 'suspended', reinstate: 'active', renew: null, terminate: 'terminated',
};

/** Verbs that end in `active` and so must re-check the prerequisites. */
export const ENTERS_ACTIVE: ReadonlySet<LicenceVerb> = new Set(['activate', 'reinstate']);

/** The statuses an administrator may be appointed to. A terminated licence administers nobody. */
export const APPOINTABLE: readonly string[] = ['draft', 'pending_activation', 'active', 'suspended'];

export type Held = { id: number; status: string; revision: number };

export type TransitionResult =
  | { ok: true; revision: number }
  | { ok: false; code: 'bad_transition' | 'licence_changed'; current: { status: string; revision: number } | null };

/** Whether `verb` may start from `status`. */
export const allows = (verb: LicenceVerb, status: string | null | undefined): boolean => FROM[verb].includes(String(status ?? ''));

/**
 * `sql` is true only while the licence is at `revision`. Statements that must
 * not run unless the transition applied end with `AND ${sql}` (the guard's
 * binds come after the statement's own).
 */
export function appliedGuard(licenceId: number, revision: number, status: string): { sql: string; binds: unknown[] } {
  // The status is part of the guard because a DIFFERENT request can leave the
  // licence at this same revision number (two moves both read revision 0 and
  // both write 1). Only this move leaves this status at this revision.
  return {
    sql: 'EXISTS (SELECT 1 FROM territory_licences WHERE id = ? AND revision = ? AND status = ?)',
    binds: [licenceId, revision, status],
  };
}

/** The prerequisites of an active licence as one SQL predicate on `territory_licences l`. */
const PREREQUISITES = `EXISTS (SELECT 1 FROM licence_territories t WHERE t.licence_id = l.id)
  AND (SELECT COALESCE(SUM(s.seats_licensed), 0) FROM licence_seats s WHERE s.licence_id = l.id) > 0
  AND l.annual_fee_cents IS NOT NULL AND l.revenue_share_bps IS NOT NULL AND l.renews_on IS NOT NULL`;

export type Change = {
  note?: string | null;
  /** `renew` only. */
  renewsOn?: string;
  now: string;
  /** Statements run in the same batch, after the move, only if it applied. Build them with `appliedGuard(id, held.revision + 1, TO[verb])`. */
  after?: D1PreparedStatement[];
};

/**
 * Apply one move. Reads nothing: the caller passes what it read, and the
 * database decides whether that is still true.
 */
export async function transition(env: Env, held: Held, verb: LicenceVerb, change: Change): Promise<TransitionResult> {
  if (!allows(verb, held.status)) return { ok: false, code: 'bad_transition', current: { status: held.status, revision: held.revision } };
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (verb === 'activate' || verb === 'reinstate') sets.push("status = 'active'", 'status_note = NULL', 'suspended_at = NULL');
  else if (verb === 'suspend') { sets.push("status = 'suspended'", 'status_note = ?', 'suspended_at = ?'); binds.push(change.note ?? null, change.now); }
  else if (verb === 'terminate') { sets.push("status = 'terminated'", 'status_note = ?', 'terminated_at = ?'); binds.push(change.note ?? null, change.now); }
  else { sets.push('renews_on = ?'); binds.push(change.renewsOn ?? null); }
  sets.push('revision = revision + 1', 'updated_at = ?');
  binds.push(change.now);
  const prerequisites = ENTERS_ACTIVE.has(verb) ? ` AND ${PREREQUISITES}` : '';
  const move = env.DB.prepare(
    `UPDATE territory_licences AS l SET ${sets.join(', ')}
      WHERE l.id = ? AND l.status = ? AND l.revision = ?${prerequisites}`,
  ).bind(...binds, held.id, held.status, held.revision);
  let results: Array<{ meta?: { changes?: number } }>;
  try {
    results = await env.DB.batch([move, ...(change.after ?? [])]);
  } catch (e) {
    // The floor under the state machine: a database trigger refused the move.
    if (/licence_terminated/.test(String((e as Error)?.message))) return { ok: false, code: 'licence_changed', current: await currentOf(env, held.id) };
    throw e;
  }
  if (Number(results[0]?.meta?.changes ?? 0) !== 1) return { ok: false, code: 'licence_changed', current: await currentOf(env, held.id) };
  return { ok: true, revision: held.revision + 1 };
}

async function currentOf(env: Env, id: number): Promise<{ status: string; revision: number } | null> {
  const row = await env.DB.prepare('SELECT status, revision FROM territory_licences WHERE id = ?').bind(id).first<{ status: string; revision: number }>();
  return row ? { status: String(row.status), revision: Number(row.revision) } : null;
}

/** The 409 body for a stale mutation: what the licence is now, so a caller can re-read and decide. */
export function staleBody(current: { status: string; revision: number } | null) {
  return {
    error: 'licence_changed',
    message: 'This licence changed while your request was being handled, so nothing was changed. Reload it and try again.',
    current_status: current?.status ?? null,
    revision: current?.revision ?? null,
  };
}
