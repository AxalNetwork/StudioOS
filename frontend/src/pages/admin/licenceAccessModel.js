/**
 * D4819 part 11 (#5922) — the licence's Access section, Licences v2 board L11:
 * administrators with their account state, licensed seats by profile, and
 * what each administrator action will do before it is taken.
 *
 * Pure, so the tests read it without a page. Every value comes from a read
 * that already exists (`GET /api/admin/licences/:uid/admins`, and the seats on
 * `GET /api/admin/licences/:uid`); nothing here is a sample figure.
 *
 * THREE ABSENCES, NEVER ONE. `none` is a read that succeeded and found
 * nothing (no administrator is named). `not_recorded` is a value no store
 * holds (seat usage per licence, a seat count HQ never set). `unreadable` is a
 * read that failed: it says nothing about the licence either way.
 */
import { NOT_RECORDED } from '../../lib/absence';
import { SEAT_TYPES } from './licences/licenceShared';
import { LICENCE_REASONS } from './licenceReasonModel';

export { NOT_RECORDED };
export const NONE = 'None';
export const UNREADABLE = 'Unreadable';

/**
 * The statuses a licence can take an administrator in. The Worker's own list
 * (`APPOINTABLE` in `cloudflare-worker/src/services/licenceTransitions.ts`,
 * #4678): every status but `terminated`. A status this list does not name is
 * not offered the action either, since the Worker would refuse it.
 */
export const APPOINTABLE_STATUSES = Object.freeze(['draft', 'pending_activation', 'active', 'suspended']);

const STATUS_WORD = Object.freeze({
  draft: 'draft', pending_activation: 'pending activation', active: 'active', suspended: 'suspended', terminated: 'terminated',
});
const statusWord = (s) => STATUS_WORD[s] || String(s || '').replace(/_/g, ' ') || 'unrecorded';
const refOf = (licence) => licence?.licence_ref || licence?.brand_name || 'this licence';

/**
 * Whether Add administrator is offered, and the sentence said in its place
 * when it is not. A terminated licence has released its territory and
 * deprovisioned its administrators; the Worker refuses an appointment on it.
 */
export function addAdminOffer(licence) {
  const status = licence?.status;
  if (APPOINTABLE_STATUSES.includes(status)) return { offered: true, why: null };
  if (status === 'terminated') {
    return { offered: false, why: 'Add administrator is not offered: this licence is terminated, and a terminated licence cannot take an administrator.' };
  }
  return { offered: false, why: `Add administrator is not offered: a licence that is ${statusWord(status)} cannot take an administrator.` };
}

/**
 * Whether the seat counts may be changed. The seats write only lands on a
 * licence that is not terminated (`PUT /:uid/seats`), so on a terminated one
 * the editor is not offered and the counts stand as they were.
 */
export function seatChangeOffer(licence) {
  if (licence?.status === 'terminated') {
    return { offered: false, why: 'Seats are not changed on a terminated licence. The counts below are as they stood when it ended.' };
  }
  return { offered: true, why: null };
}

/**
 * One administrator's account state, from `users.role` and `users.is_active`
 * on the admins read. A binding survives a demotion and a deactivation, so
 * the row says which of them happened:
 *   - `active`: holds the admin role on an active account;
 *   - `deactivated`: holds the role, but the account is switched off;
 *   - `demoted`: no longer an admin and still bound, so Detach finishes it;
 *   - `not_recorded`: the read carried no role or no active flag.
 */
export function accountState(a) {
  const role = a?.role === null || a?.role === undefined ? null : String(a.role).toLowerCase();
  if (role === null || role === '') return { key: 'not_recorded', word: NOT_RECORDED, isAdmin: false };
  if (role !== 'admin') return { key: 'demoted', word: 'No longer an admin', note: 'Detach to finish removing it', isAdmin: false };
  if (a?.is_active === null || a?.is_active === undefined) return { key: 'not_recorded', word: NOT_RECORDED, isAdmin: true };
  return Number(a.is_active) === 1
    ? { key: 'active', word: 'Active', isAdmin: true }
    : { key: 'deactivated', word: 'Deactivated', note: 'Holds the admin role on a switched-off account', isAdmin: true };
}

/** `principal` or `delegate`, in words; anything else is shown as it is recorded. */
export function adminRoleWord(r) {
  if (r === 'principal') return 'Principal';
  if (r === 'delegate') return 'Delegate';
  return r ? String(r) : NOT_RECORDED;
}

/**
 * The administrators card's state. `items` is `undefined` while the read is on
 * its way, `null` when it failed, else the array the Worker returned.
 */
export function adminsState(items) {
  if (items === undefined) return { state: 'reading', word: 'Reading…' };
  if (!Array.isArray(items)) return { state: 'unreadable', word: UNREADABLE };
  if (items.length === 0) return { state: 'none', word: NONE };
  return { state: 'listed', word: `${items.length} ${items.length === 1 ? 'administrator' : 'administrators'}` };
}

/**
 * Licensed seats by profile. A profile with no seat row is Not recorded,
 * never 0; a recorded 0 is 0. Usage is never attributed to a licence on HQ,
 * so In use is Not recorded on every row, with the reason in operator words.
 * A licence payload whose seats are not a map could not be read for them.
 */
export function seatRows(licence) {
  const seats = licence?.seats;
  const readable = seats !== null && typeof seats === 'object' && !Array.isArray(seats);
  return SEAT_TYPES.map((t) => {
    if (!readable) return { key: t.k, profile: t.label, licensed: UNREADABLE, licensedState: 'unreadable', inUse: NOT_RECORDED };
    const n = seats[t.k];
    const has = n !== null && n !== undefined && Number.isFinite(Number(n));
    return {
      key: t.k, profile: t.label,
      licensed: has ? Number(n).toLocaleString('en-GB') : NOT_RECORDED,
      licensedState: has ? 'value' : 'not_recorded',
      inUse: NOT_RECORDED,
    };
  });
}

/** Why In use is Not recorded. Operator words: no internal identifier. */
export const SEAT_USE_REASON = 'HQ cannot reliably attribute account usage to individual licences yet. Branch-level usage is on HQ Home and the branch console.';

/**
 * Add administrator, said before the reason is asked for (the labelled reason
 * dialog, until the consequence sheet lands). What the appointment writes, in
 * `POST /:uid/admins`: the role and the binding in one step, the licence's
 * history and the audit log with the reason, a notice to the account holder;
 * an account that held a member licence keeps it.
 */
export function addAdminAsk(licence, { email, adminRole }, initial = '') {
  const who = String(email || '').trim() || 'This account';
  const suspended = licence?.status === 'suspended'
    ? 'This licence is suspended; the appointment still takes effect now. '
    : '';
  return {
    title: 'Add an administrator',
    consequence: `${suspended}${who} becomes a ${adminRoleWord(adminRole).toLowerCase()} administrator of ${refOf(licence)}: the account is given the admin role and bound to this licence in one step, and its holder is told. An account that held a member licence keeps it. Undoing it is two steps: remove, then detach.`,
    question: 'Why this account? The reason is recorded in the licence history and the audit log.',
    min: 10, confirm: 'Add administrator', tone: 'warn', initial,
  };
}

/**
 * Remove…, the first of the two steps (`POST /api/admin/users/:userId/demote-admin`):
 * the admin role goes now; the binding stays until Detach.
 */
export function removeAdminAsk(licence, admin) {
  const who = admin?.name || admin?.email || 'This administrator';
  return {
    ...LICENCE_REASONS.demoteAdmin,
    title: 'Remove this administrator',
    consequence: `${who} loses the admin role now and can no longer administer ${refOf(licence)}; its holder is told. The account stays bound to this licence until you detach it, the second step. An account holding the Super Admin elevation is refused, and nothing changes.`,
    question: 'Why is this administrator being removed? It is recorded in the audit log.',
    confirm: 'Remove administrator', tone: 'danger',
  };
}

/** Detach, the second step (`DELETE /:uid/admins/:userId`). It takes no reason, so none is asked for. */
export function detachLine(licence) {
  return `Detach unbinds this account from ${refOf(licence)}. It is recorded in the licence history.`;
}
