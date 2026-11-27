/**
 * D4691 — one identity shape for every actor HQ · Security names, and one
 * network attribution.
 *
 * WHY. The privileged-action feed and the Sessions zone each built a name from
 * whatever columns their join returned. Three cases came out wrong or blank:
 * an act with no acting account (a sweep, a cron) rendered an empty Actor; a
 * support session's own acts read as the account holder's; and a refused
 * attempt that named an account put that account in the Actor column, as if
 * the holder had made the attempt. Every reader now builds an `Identity` here,
 * and the page renders its `kind` beside its `label`.
 *
 *   user     an account acting as itself.
 *   support  an operator acting inside a support session; `on_behalf_of` is
 *            the account whose session it was. A branch support session's
 *            operator is held at HQ, so it has no local id and no name here.
 *   system   no account acted: a scheduled job or the platform itself.
 *   network  no account was established: a refused attempt, attributed only
 *            to the network it came from. Any account it named is the
 *            `subject`, never the actor.
 *
 * PRIVACY. A network is only ever the bucket `ipPrefix` computes (/24 for
 * IPv4, /48 for IPv6), the rule the security_events ledger already follows. An
 * address is never put in an identity; a stored bucket that does not have the
 * bucket's shape is reported as `unknown` rather than passed through.
 */
import { ipPrefix } from './securityEvents';
import { BRANCH_SUPPORT_ADMIN_ID } from './sessionStatus';

export type IdentityKind = 'user' | 'support' | 'system' | 'network';
export type IdentityRef = { user_id: number | null; label: string };
export type Identity = {
  kind: IdentityKind;
  user_id: number | null;
  label: string;
  on_behalf_of: IdentityRef | null;
  network: string | null;
};

const IPV4_BUCKET = /^(25[0-5]|2[0-4]\d|1?\d?\d)\.(25[0-5]|2[0-4]\d|1?\d?\d)\.(25[0-5]|2[0-4]\d|1?\d?\d)\.0\/24$/;
const IPV6_BUCKET = /^[0-9a-f]{1,4}:[0-9a-f]{1,4}:[0-9a-f]{1,4}::\/48$/;

/** A stored network bucket, checked for the bucket's shape; anything else is 'unknown'. */
export function networkOf(stored: unknown): string {
  const s = typeof stored === 'string' ? stored.trim().toLowerCase() : '';
  return IPV4_BUCKET.test(s) || IPV6_BUCKET.test(s) ? s : 'unknown';
}

/** A client address reduced to its bucket, for a reader that holds a raw address. */
export const networkOfAddress = (ip: unknown): string => networkOf(ipPrefix(typeof ip === 'string' ? ip : null));

const positiveId = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

/** The best name a join gave, or `account <id>`; null when there is no account at all. */
export function accountLabel(name: unknown, email: unknown, id: unknown): string | null {
  if (typeof name === 'string' && name.trim()) return name.trim();
  if (typeof email === 'string' && email.trim()) return email.trim();
  const n = positiveId(id);
  return n === null ? null : `account ${n}`;
}

export function systemIdentity(label = 'System'): Identity {
  return { kind: 'system', user_id: null, label, on_behalf_of: null, network: null };
}

export function networkIdentity(stored: unknown): Identity {
  const network = networkOf(stored);
  return { kind: 'network', user_id: null, label: `network ${network}`, on_behalf_of: null, network };
}

/** An account acting as itself; no account means the platform acted. */
export function userIdentity(id: unknown, name?: unknown, email?: unknown, network?: unknown): Identity {
  const label = accountLabel(name, email, id);
  if (label === null) return systemIdentity();
  return {
    kind: 'user', user_id: positiveId(id), label, on_behalf_of: null,
    network: network === undefined ? null : networkOf(network),
  };
}

/** An operator inside a support session, acting on another account. */
export function supportIdentity(
  operator: { id: unknown; name?: unknown; email?: unknown },
  target: { id: unknown; name?: unknown; email?: unknown },
  network?: unknown,
): Identity {
  const branchHeld = Number(operator.id) === BRANCH_SUPPORT_ADMIN_ID;
  const label = branchHeld
    ? 'HQ support operator'
    : (accountLabel(operator.name, operator.email, operator.id) ?? 'unrecorded operator');
  return {
    kind: 'support',
    user_id: branchHeld ? null : positiveId(operator.id),
    label,
    on_behalf_of: { user_id: positiveId(target.id), label: accountLabel(target.name, target.email, target.id) ?? 'unrecorded account' },
    network: network === undefined ? null : networkOf(network),
  };
}

/**
 * The actor of a `security_events` row, and the account it named.
 *
 * A gate refusal and a step-up happen to a caller who is already signed in, so
 * that caller is the actor — or, when the row records a support session, the
 * operator, on behalf of the account. A refused sign-in or recovery step has
 * established nobody: its actor is its network, and the account it named, if
 * any, is returned as `subject`.
 */
export function securityEventIdentity(row: Record<string, unknown>): { actor: Identity; subject: IdentityRef | null } {
  const kind = String(row.kind ?? '');
  const authenticated = kind === 'gate' || kind === 'step_up';
  const subjectLabel = accountLabel(row.subject_name, row.subject_email, row.user_id);
  const subject = subjectLabel === null ? null : { user_id: positiveId(row.user_id), label: subjectLabel };
  const supportOperator = row.support_user_id;
  if (authenticated && supportOperator !== null && supportOperator !== undefined) {
    return {
      actor: supportIdentity(
        { id: supportOperator, name: row.support_name, email: row.support_email },
        { id: row.user_id, name: row.subject_name, email: row.subject_email },
        row.ip_prefix,
      ),
      subject,
    };
  }
  if (authenticated && subject) {
    return { actor: userIdentity(row.user_id, row.subject_name, row.subject_email, row.ip_prefix), subject: null };
  }
  return { actor: networkIdentity(row.ip_prefix), subject };
}
