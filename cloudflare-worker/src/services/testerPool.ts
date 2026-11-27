/**
 * D1336 (#3541, part 1 of the member flow, #3517) — the member's side of the
 * Product tester pool (D1042's store, migration 576).
 *
 * A signed-in member reads their own row, joins the pool and leaves it. HQ
 * still decides every join, in Approvals' Product testers lane (#2390), where
 * an `applied` row already appears; nothing more is sent to tell them.
 *
 *   join   with no row: a new `applied` row. With a row: only a declined
 *          member from `reapplyAfter`'s date, or a member who left the pool
 *          themselves, applies again; the row returns to `applied` and its
 *          decision is cleared. Consent is required, with the version the
 *          member agreed to, which must be the current one.
 *   leave  from `applied`, `active` or `paused`: the row becomes `removed`
 *          with the reason "Left by the member", decided by the member. Picked
 *          places carry on (D1335 §3): leaving is not HQ's removal, which ends
 *          them (D1132).
 *
 * Each change is one conditional write and one `product_tester_events` row in
 * the same batch, the event written only when the write stamped this change.
 * An Admin or Super Admin is refused every route: Admins cannot be testers.
 * No reply carries an email.
 */
import type { Env } from '../types';
import { TestingRefusal } from './testing';
import { isAdminAccount, reapplyAfter, type TesterStatus } from './productTesters';

/** The sentence a member agrees to when joining the pool, and its version (PT-M1). */
export const POOL_CONSENT_VERSION = 'd1336-1';
export const POOL_CONSENT_TEXT = 'I agree that the firm running a programme I join, and Axal VC, may email me about it, and that my answers go to that firm. I can withdraw from a programme, or leave the tester pool, at any time.';
/** The reason a member's own leaving is recorded with (D1335 §3). */
export const LEFT_REASON = 'Left by the member';
export const AVAILABILITY_MAX = 1000;

const refuse = (status: number, code: string, message: string) => new TestingRefusal(status, code, message);

const stampNow = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const today = () => new Date().toISOString().slice(0, 10);

type Row = {
  id: number; user_id: number; status: TesterStatus; applied_at: string; decided_at: string | null;
  decided_by: number | null; reason: string | null; availability: string | null;
  consent_email_at: string | null; consent_version: string | null;
};

async function ownRow(env: Env, userId: number): Promise<Row | null> {
  return env.DB.prepare(
    `SELECT id, user_id, status, applied_at, decided_at, decided_by, reason, availability, consent_email_at, consent_version
       FROM product_testers WHERE user_id = ?`,
  ).bind(userId).first<Row>();
}

/** The member's status in the pool, or null with no row. */
export async function testerStatusOf(env: Env, userId: number): Promise<TesterStatus | null> {
  const row = await env.DB.prepare('SELECT status FROM product_testers WHERE user_id = ?').bind(userId).first<{ status: TesterStatus }>();
  return row?.status ?? null;
}

/** Whether the member left the pool themselves (they decided their own removal). */
const leftThemselves = (row: Row) => row.status === 'removed' && row.decided_by != null && Number(row.decided_by) === Number(row.user_id);

/**
 * Whether this member may join now, and if not, the sentence and code that say
 * why. `reapply_after` is the declined member's date; null otherwise.
 */
export function joinCheck(row: Row | null, on: string = today()): { can: boolean; code: string | null; message: string | null; reapply_after: string | null } {
  if (!row) return { can: true, code: null, message: null, reapply_after: null };
  if (row.status === 'applied') return { can: false, code: 'already_applied', message: 'You have already applied to be a Product tester. An Axal VC admin decides.', reapply_after: null };
  if (row.status === 'active' || row.status === 'paused') return { can: false, code: 'already_tester', message: 'You are already in the tester pool.', reapply_after: null };
  if (row.status === 'declined') {
    const after = row.decided_at ? reapplyAfter(row.decided_at) : null;
    if (after && on < after) return { can: false, code: 'reapply_later', message: `You can apply again from ${after}.`, reapply_after: after };
    return { can: true, code: null, message: null, reapply_after: after };
  }
  if (leftThemselves(row)) return { can: true, code: null, message: null, reapply_after: null };
  return { can: false, code: 'removed_by_hq', message: 'HQ removed you from the tester pool. If you think this is wrong, open a ticket with Support.', reapply_after: null };
}

async function refuseAdmin(env: Env, userId: number) {
  if (await isAdminAccount(env, userId)) throw refuse(403, 'admin_account', 'Admin accounts can’t be Product testers.');
}

/** `GET /api/testing/tester`: the member's own row, the consent, and whether they may join. */
export async function memberTester(env: Env, userId: number) {
  await refuseAdmin(env, userId);
  const row = await ownRow(env, userId);
  const check = joinCheck(row);
  return {
    tester: row ? {
      status: row.status,
      applied_at: row.applied_at,
      decided_at: row.decided_at ?? null,
      // The reason HQ gave with a decline, a pause or a removal, or "Left by the member".
      reason: row.reason ?? null,
      reapply_after: check.reapply_after,
      left_by_member: leftThemselves(row),
      availability: row.availability ?? null,
      consent_version: row.consent_version ?? null,
      consent_current: row.consent_version === POOL_CONSENT_VERSION,
    } : { status: null },
    consent: { version: POOL_CONSENT_VERSION, text: POOL_CONSENT_TEXT },
    can_apply: check.can,
    cannot_apply: check.can ? null : { code: check.code, message: check.message },
  };
}

/** `POST /api/testing/tester/apply` `{ consent_version, availability? }`. */
export async function joinPool(env: Env, userId: number, body: any) {
  await refuseAdmin(env, userId);
  const b = body && typeof body === 'object' ? body : {};
  if (b.consent_version !== POOL_CONSENT_VERSION) {
    throw refuse(400, 'consent_required', `Agree to consent version ${POOL_CONSENT_VERSION} to apply.`);
  }
  const availability = b.availability == null ? null : String(b.availability).trim();
  if (availability && availability.length > AVAILABILITY_MAX) {
    throw refuse(400, 'invalid_request', `Availability is at most ${AVAILABILITY_MAX} characters.`);
  }
  const row = await ownRow(env, userId);
  const check = joinCheck(row);
  if (!check.can) throw refuse(409, check.code!, check.message!);
  const stamp = stampNow();
  const write = row
    // The status it read, so a decision in between changes nothing.
    ? env.DB.prepare(
      `UPDATE product_testers SET status = 'applied', applied_at = ?, decided_at = NULL, decided_by = NULL, reason = NULL,
              availability = ?, consent_email_at = ?, consent_version = ?, updated_at = ?
        WHERE id = ? AND status = ?`,
    ).bind(stamp, availability || null, stamp, POOL_CONSENT_VERSION, stamp, row.id, row.status)
    : env.DB.prepare(
      `INSERT OR IGNORE INTO product_testers (user_id, status, applied_at, availability, consent_email_at, consent_version, created_at, updated_at)
       VALUES (?, 'applied', ?, ?, ?, ?, ?, ?)`,
    ).bind(userId, stamp, availability || null, stamp, POOL_CONSENT_VERSION, stamp, stamp);
  const results = await env.DB.batch([
    write,
    env.DB.prepare(
      `INSERT INTO product_tester_events (tester_id, user_id, action, from_status, to_status, actor_user_id, created_at)
       SELECT id, user_id, 'applied', ?, 'applied', user_id, ? FROM product_testers
        WHERE user_id = ? AND status = 'applied' AND applied_at = ? AND updated_at = ?`,
    ).bind(row?.status ?? null, stamp, userId, stamp, stamp),
  ]);
  if (Number(results?.[0]?.meta?.changes ?? 0) !== 1) {
    throw refuse(409, 'already_applied', 'Your tester status changed just now. Read it again.');
  }
  return memberTester(env, userId);
}

/** `POST /api/testing/tester/leave`: the member's own row becomes `removed`, "Left by the member". */
export async function leavePool(env: Env, userId: number) {
  await refuseAdmin(env, userId);
  const row = await ownRow(env, userId);
  if (!row || !['applied', 'active', 'paused'].includes(row.status)) {
    throw refuse(409, 'not_in_pool', 'You are not in the tester pool.');
  }
  const stamp = stampNow();
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE product_testers SET status = 'removed', decided_at = ?, decided_by = user_id, reason = ?, updated_at = ?
        WHERE id = ? AND status = ?`,
    ).bind(stamp, LEFT_REASON, stamp, row.id, row.status),
    env.DB.prepare(
      `INSERT INTO product_tester_events (tester_id, user_id, action, from_status, to_status, actor_user_id, reason, created_at)
       SELECT id, user_id, 'removed', ?, 'removed', user_id, ?, ? FROM product_testers
        WHERE id = ? AND status = 'removed' AND decided_at = ? AND decided_by = user_id AND updated_at = ?`,
    ).bind(row.status, LEFT_REASON, stamp, row.id, stamp, stamp),
  ]);
  if (Number(results?.[0]?.meta?.changes ?? 0) !== 1) {
    throw refuse(409, 'not_in_pool', 'Your tester status changed just now. Read it again.');
  }
  return memberTester(env, userId);
}

/** The sentence a member who is not an active tester reads instead of the programmes (D1336). */
export function notActiveMessage(status: TesterStatus | null): string {
  switch (status) {
    case null: return 'Open programmes are for Product testers. Apply to join the tester pool first.';
    case 'applied': return 'Open programmes are for Product testers. An Axal VC admin is deciding your application.';
    case 'paused': return 'Your place in the tester pool is paused, so you can’t apply to programmes.';
    case 'declined': return 'Open programmes are for Product testers, and your application was not approved.';
    case 'removed': return 'You’re no longer in the tester pool, so you can’t apply to programmes.';
    default: return 'Open programmes are for active Product testers.';
  }
}

/** Refuse anyone who is not an active tester, with the sentence for their status. */
export async function requireActiveTester(env: Env, userId: number): Promise<void> {
  const status = await testerStatusOf(env, userId);
  if (status !== 'active') throw refuse(403, 'not_active_tester', notActiveMessage(status));
}
