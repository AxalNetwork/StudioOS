/**
 * D752 (#1888) — an investor's proof of capital, from their own Mercury.
 * NOTHING HERE MOVES MONEY. The sum of balances is a local variable: never
 * stored, returned or logged.
 *
 * The decisions (D752.md §3), in short:
 *   1. One use, `capital_attestation`, held by an investor on HQ only. The
 *      reads of their targets and accounts and the share run `personalPolicy`;
 *      listing and revoking their own statements refuse a support session and
 *      a branch but not a role, so a member whose role changed keeps control.
 *   2. Three targets, each the caller's own: a `pending` deal commitment on a
 *      live deal, their Fund I application while it is open or approved, and
 *      their Fund I LP commitment. Another member's target is 404, as a
 *      missing one is.
 *   3. The amount is a floor in whole dollars, from $1,000 to the target's
 *      figure (the uncalled amount for an LP commitment), and defaults to it.
 *   4. The investor picks the checking and savings accounts that count; the
 *      picker never shows a balance, and an account id is never stored.
 *   5. Consent is explicit and versioned (`capitalAttestationTerms.ts`).
 *   6. The check runs inside the investor's own request, after every refusal
 *      that needs no bank, and fails closed on a balance Mercury did not give.
 *   7. The row is the statement only (migration 491).
 *   8. One active statement per target; a newer one supersedes it.
 *   9. What a statement says is fixed; revoked is final.
 *  10. Expiry is computed, never stored.
 *  11. Logs hold counts only.
 *  12. No cron, admin route, Eadwyn reader or MCP tool calls this file.
 *
 * Every value is bound. Every refusal is our sentence, through `refuse`.
 */
import type { Context } from 'hono';
import type { Env, User } from '../types';
import { isSupportSession } from '../integrations/providers/mercury';
import { logPersonalRead, personalConnection, personalPolicy, plusDays, today } from './mercuryPersonal';
import { claimLpRowsByEmail } from './lpClaim';
import { lpSelfScope } from './tenancyScope';
import { FUND_I_SLUG, fundPayeeOf } from './payInstructions';
import { Funds } from '../models/funds';
import { branchOf, HQ_ONLY } from '../util/branch';
import { refuse } from '../util/refusal';
import {
  CONSENT_VERSION, MAX_ACCOUNTS, MIN_FLOOR_CENTS, VALID_DAYS,
  dollars, isExpired, isPurpose, ownerDto, targetLabel, wholeDollarCap,
  type AttestationPurpose, type AttestationRow,
} from './capitalAttestationTerms';

type C = Context<{ Bindings: Env }>;

const ACCOUNT_ID_RE = /^[A-Za-z0-9-]{1,64}$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TargetReason = 'amount_missing' | 'below_minimum' | 'calls_unreadable' | null;

export interface AttestationTarget {
  purpose: AttestationPurpose;
  target_id: number;
  deal_id: number | null;
  fund_id: number | null;
  label: string;
  max_cents: number | null;
  attestable: boolean;
  reason: TargetReason;
  active: { uid: string; amount_floor_cents: number; as_of: string; expires_on: string; expired: boolean } | null;
  committed_cents?: number;
  called_cents?: number | null;
}

const NOT_FOUND = 'That is not one of your open commitments.';

function refused(c: C, status: number, code: string, message: string, extra?: Record<string, unknown>): Response {
  return refuse(c, status, { code, message, extra });
}

/** For listing and revoking one's own statements: no support session, HQ only, any role. */
export async function ownerGate(c: C): Promise<Response | null> {
  if (await isSupportSession(c)) return refused(c, 403, 'support_session_refused', 'A support session cannot read or change a member\'s proof of funds.');
  if (branchOf(c.env)) return refused(c, 403, 'hq_only', HQ_ONLY);
  return null;
}

/** The use's policy (decision 1), for the routes that cannot import `mercuryPersonal` themselves. */
export const attestationPolicy = (c: C, user: User) => personalPolicy(c, user, 'capital_attestation');

// ─────────────────────────────────────────────────────────── targets (decisions 2 and 3)

/** The cap and why a target cannot be shared on, from its figure in cents. */
function capOf(cents: number | null, callsUnreadable = false): { max_cents: number | null; reason: TargetReason } {
  if (callsUnreadable) return { max_cents: null, reason: 'calls_unreadable' };
  const cap = wholeDollarCap(cents);
  if (cap === null) return { max_cents: null, reason: 'amount_missing' };
  return { max_cents: cap, reason: cap < MIN_FLOOR_CENTS ? 'below_minimum' : null };
}

const dollarsToCents = (v: unknown): number | null => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100));

type Draft = Omit<AttestationTarget, 'active' | 'attestable'>;

async function dealCommitments(env: Env, user: User, id: number | null): Promise<Draft[]> {
  const rows = (await env.DB.prepare(
    `SELECT c.id, c.deal_id, c.amount, p.name AS project_name
       FROM commitments c JOIN deals d ON d.id = c.deal_id LEFT JOIN projects p ON p.id = d.project_id
      WHERE c.investor_user_id = ?1 AND c.status = 'pending' AND d.status <> 'rejected' AND d.passed_at IS NULL
        AND (?2 IS NULL OR c.id = ?2)
      ORDER BY c.created_at DESC, c.id DESC`,
  ).bind(user.id, id).all<{ id: number; deal_id: number; amount: number | null; project_name: string | null }>()).results || [];
  return rows.map((r) => ({
    purpose: 'deal_commitment', target_id: Number(r.id), deal_id: Number(r.deal_id), fund_id: null,
    label: targetLabel('deal_commitment', { project_name: r.project_name }), ...capOf(dollarsToCents(r.amount)),
  }));
}

async function fundIId(env: Env): Promise<number | null> {
  try {
    const f = await Funds.bySlug(env, FUND_I_SLUG);
    return f ? Number(f.id) : null;
  } catch { return null; }
}

async function lpApplications(env: Env, user: User, id: number | null): Promise<Draft[]> {
  const rows = (await env.DB.prepare(
    `SELECT id, target_commitment, status FROM lp_applications
      WHERE user_id = ?1 AND fund_slug = ?2 AND status IN ('pending', 'in_review', 'needs_follow_up', 'approved')
        AND (?3 IS NULL OR id = ?3)
      ORDER BY id DESC`,
  ).bind(user.id, FUND_I_SLUG, id).all<{ id: number; target_commitment: number | null; status: string }>()).results || [];
  if (!rows.length) return [];
  const fund = await fundIId(env);
  return rows.map((r) => ({
    purpose: 'lp_application', target_id: Number(r.id), deal_id: null, fund_id: fund,
    label: targetLabel('lp_application'), ...capOf(dollarsToCents(r.target_commitment)),
  }));
}

async function lpCommitments(env: Env, user: User, id: number | null): Promise<Draft[]> {
  // As /lp-portal does: an unlinked row carrying the caller's email becomes theirs first.
  await claimLpRowsByEmail(env, user.id, user.email);
  const scope = lpSelfScope(user, 'lp');
  const rows = (await env.DB.prepare(
    `SELECT lp.id, lp.fund_id, CAST(ROUND(lp.commitment_amount * 100) AS INTEGER) AS committed_cents, f.name AS fund_name
       FROM limited_partners lp JOIN vc_funds f ON f.id = lp.fund_id
      WHERE ${scope.sql} AND (? IS NULL OR lp.id = ?)
      ORDER BY lp.created_at DESC, lp.id DESC`,
  ).bind(...scope.binds, id, id).all<{ id: number; fund_id: number; committed_cents: number | null; fund_name: string | null }>()).results || [];
  const out: Draft[] = [];
  for (const r of rows) {
    // Fund I only: other funds' rows belong to outside GPs, and Axal's admins read the statement.
    if ((await fundPayeeOf(env, Number(r.fund_id))) !== 'fund') continue;
    const committed = Number(r.committed_cents ?? 0);
    let called: number | null = null;
    try {
      const sum = await env.DB.prepare(
        'SELECT COALESCE(SUM(COALESCE(cc.amount_cents, CAST(ROUND(cc.amount * 100) AS INTEGER))), 0) AS n FROM capital_calls cc WHERE cc.limited_partner_id = ?',
      ).bind(r.id).first<{ n: number }>();
      called = Number(sum?.n ?? 0);
    } catch { called = null; }
    out.push({
      purpose: 'lp_commitment', target_id: Number(r.id), deal_id: null, fund_id: Number(r.fund_id),
      label: targetLabel('lp_commitment', { fund_name: r.fund_name }),
      ...capOf(called === null ? null : Math.max(0, committed - called), called === null),
      committed_cents: committed, called_cents: called,
    });
  }
  return out;
}

const READERS: Record<AttestationPurpose, (env: Env, user: User, id: number | null) => Promise<Draft[]>> = {
  deal_commitment: dealCommitments,
  lp_application: lpApplications,
  lp_commitment: lpCommitments,
};

async function activeStatements(env: Env, user: User) {
  const rows = (await env.DB.prepare(
    "SELECT uid, purpose, target_id, amount_floor_cents, as_of, expires_on FROM capital_attestations WHERE user_id = ? AND state = 'active'",
  ).bind(user.id).all<{ uid: string; purpose: string; target_id: number; amount_floor_cents: number; as_of: string; expires_on: string }>()).results || [];
  const now = today();
  return new Map(rows.map((r) => [`${r.purpose}:${r.target_id}`, {
    uid: r.uid, amount_floor_cents: Number(r.amount_floor_cents), as_of: r.as_of, expires_on: r.expires_on, expired: isExpired(r.expires_on, now),
  }]));
}

const finish = (d: Draft, active: AttestationTarget['active']): AttestationTarget => ({ ...d, attestable: d.reason === null && d.max_cents !== null, active });

/**
 * The caller's open targets. A purpose whose store cannot be read is named in
 * `unreadable` and is never reported as having none.
 */
export async function openTargets(env: Env, user: User): Promise<{ targets: AttestationTarget[]; unreadable: AttestationPurpose[] }> {
  const active = await activeStatements(env, user);
  const targets: AttestationTarget[] = [];
  const unreadable: AttestationPurpose[] = [];
  for (const purpose of Object.keys(READERS) as AttestationPurpose[]) {
    try {
      for (const d of await READERS[purpose](env, user, null)) targets.push(finish(d, active.get(`${d.purpose}:${d.target_id}`) ?? null));
    } catch (e) {
      console.error('[capital_attestations] targets unreadable', purpose, String((e as Error)?.message || e).slice(0, 300));
      unreadable.push(purpose);
    }
  }
  return { targets, unreadable };
}

/** One of the caller's targets, or null when it is not theirs or does not exist. */
export async function targetFor(env: Env, user: User, purpose: AttestationPurpose, targetId: number): Promise<AttestationTarget | null> {
  const [d] = await READERS[purpose](env, user, targetId);
  return d ? finish(d, null) : null;
}

// ─────────────────────────────────────────────────────────── the bank (decisions 4 and 6)

/** The caller's checking and savings accounts, for the picker: never a balance. */
export async function ownAccounts(c: C, user: User): Promise<Response> {
  const conn = await personalConnection(c, user, 'capital_attestation');
  if (conn instanceof Response) return conn;
  await logPersonalRead(c.env, conn, user, 'capital_attestation_accounts', { accounts: conn.accounts.length });
  return c.json({
    holder_name: conn.legal_name,
    accounts: conn.accounts.map((a) => ({ id: a.mercury_account_id, name: a.nickname, kind: a.kind, last_four: a.last_four })),
  });
}

const positiveId = (v: unknown) => (typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v)))
  && Number.isSafeInteger(Number(v)) && Number(v) > 0;

function accountIds(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length < 1 || v.length > MAX_ACCOUNTS) return null;
  if (!v.every((x) => typeof x === 'string' && ACCOUNT_ID_RE.test(x))) return null;
  return new Set(v).size === v.length ? (v as string[]) : null;
}

/** One of the caller's statements by uid, with its labels; null when it is not theirs. */
async function ownRow(env: Env, user: User, uid: string): Promise<AttestationRow | null> {
  return await env.DB.prepare(
    `SELECT a.*, p.name AS project_name, f.name AS fund_name
       FROM capital_attestations a
       LEFT JOIN deals d ON d.id = a.deal_id LEFT JOIN projects p ON p.id = d.project_id
       LEFT JOIN vc_funds f ON f.id = a.fund_id
      WHERE a.uid = ? AND a.user_id = ?`,
  ).bind(uid, user.id).first<AttestationRow>();
}

/**
 * Share one statement. Every step before the connection calls Mercury zero
 * times; the connection makes exactly two GETs (`/organization`, `/accounts`).
 */
export async function createAttestation(c: C, user: User, body: Record<string, unknown>): Promise<Response> {
  const policy = await personalPolicy(c, user, 'capital_attestation');
  if (policy) return policy;
  if (body.consent !== true) return refused(c, 400, 'consent_required', 'Agree to the statement\'s words before it is shared.');
  if (body.consent_version !== CONSENT_VERSION) return refused(c, 409, 'consent_outdated', 'The words you agreed to have changed. Read them again.');
  if (!isPurpose(body.purpose)) return refused(c, 400, 'invalid_purpose', 'Choose a deal commitment, your Fund I application or your Fund I commitment.');
  if (!positiveId(body.target_id)) return refused(c, 400, 'invalid_target_id', 'Name the commitment by its id.');
  const picked = accountIds(body.account_ids);
  if (!picked) return refused(c, 400, 'invalid_accounts', `Pick between 1 and ${MAX_ACCOUNTS} of your accounts, each once.`);
  const purpose = body.purpose;
  const target = await targetFor(c.env, user, purpose, Number(body.target_id));
  if (!target) return refused(c, 404, 'target_not_found', NOT_FOUND);
  if (!target.attestable || target.max_cents === null) {
    return refused(c, 409, 'target_not_attestable', 'This commitment has no amount a statement can be checked against.', { reason: target.reason });
  }
  const cap = target.max_cents;
  let floor = cap;
  if (body.amount_cents !== undefined) {
    const a = body.amount_cents;
    if (typeof a !== 'number' || !Number.isSafeInteger(a) || a % 100 !== 0 || a < MIN_FLOOR_CENTS) {
      return refused(c, 400, 'invalid_amount', `Give a whole-dollar amount of at least ${dollars(MIN_FLOOR_CENTS)}.`);
    }
    if (a > cap) return refused(c, 400, 'amount_above_target', `The amount can be at most ${dollars(cap)}, this commitment's figure.`);
    floor = a;
  }

  const conn = await personalConnection(c, user, 'capital_attestation');
  if (conn instanceof Response) return conn;
  const byId = new Map(conn.accounts.map((a) => [a.mercury_account_id, a]));
  // The sum lives here and nowhere else: never stored, returned or logged.
  let sum = 0;
  let counted = 0;
  let unreadable = 0;
  let missing = 0;
  for (const id of picked) {
    const a = byId.get(id);
    if (!a) { missing += 1; continue; }
    if (a.available_cents === null || a.available_cents === undefined) { unreadable += 1; continue; }
    sum += a.available_cents;
    counted += 1;
  }
  await logPersonalRead(c.env, conn, user, 'capital_attestation_check', { accounts: picked.length, unreadable: unreadable + missing });
  if (missing) {
    return refused(c, 409, 'account_not_found', 'One of the accounts you picked is not a checking or savings account in your Mercury organization now. Pick again. Nothing was shared.');
  }
  if (counted === 0) {
    return refused(c, 502, 'mercury_unreadable', 'Mercury did not give an available balance for the accounts you picked, so nothing was checked or shared.');
  }
  const holder = (conn.legal_name || '').trim();
  if (!holder) return refused(c, 502, 'holder_unreadable', 'Mercury did not give your organization\'s name, so no statement can name its holder. Nothing was shared.');
  if (sum < floor) return refused(c, 409, 'balance_below_amount', 'Your available balance at Mercury is below that amount. Nothing was shared.');

  const uid = crypto.randomUUID();
  const asOf = today();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE capital_attestations SET state = 'superseded', updated_at = datetime('now') WHERE user_id = ? AND purpose = ? AND target_id = ? AND state = 'active'",
      ).bind(user.id, purpose, target.target_id),
      c.env.DB.prepare(
        `INSERT INTO capital_attestations (uid, user_id, purpose, target_id, deal_id, fund_id, amount_floor_cents, as_of, expires_on, holder_name, accounts_counted, consent_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(uid, user.id, purpose, target.target_id, target.deal_id, purpose === 'deal_commitment' ? null : target.fund_id,
        floor, asOf, plusDays(asOf, VALID_DAYS), holder.slice(0, 200), counted, CONSENT_VERSION),
    ]);
  } catch (e) {
    if (/UNIQUE/i.test(String((e as Error)?.message || ''))) {
      return refused(c, 409, 'attestation_conflict', 'Another statement for this commitment was shared at the same moment. Reload and try again.');
    }
    throw e;
  }
  const row = await ownRow(c.env, user, uid);
  return c.json({ ok: true, attestation: ownerDto(row!, today()), accounts_unreadable: unreadable }, 201);
}

// ─────────────────────────────────────────────────────────── the investor's own statements

export async function listOwn(env: Env, user: User) {
  const rows = (await env.DB.prepare(
    `SELECT a.*, p.name AS project_name, f.name AS fund_name
       FROM capital_attestations a
       LEFT JOIN deals d ON d.id = a.deal_id LEFT JOIN projects p ON p.id = d.project_id
       LEFT JOIN vc_funds f ON f.id = a.fund_id
      WHERE a.user_id = ?
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT 200`,
  ).bind(user.id).all<AttestationRow>()).results || [];
  const now = today();
  return rows.map((r) => ownerDto(r, now));
}

/** Revoke one of the caller's statements. Another member's uid is 404, as a missing one is. */
export async function revokeOwn(c: C, user: User, uid: string): Promise<Response> {
  const res = await c.env.DB.prepare(
    "UPDATE capital_attestations SET state = 'revoked', revoked_at = datetime('now'), updated_at = datetime('now') WHERE uid = ? AND user_id = ? AND state IN ('active', 'superseded')",
  ).bind(uid, user.id).run();
  const row = await ownRow(c.env, user, uid);
  if (!row) return refused(c, 404, 'attestation_not_found', 'No such statement.');
  if (!res.meta?.changes) return refused(c, 409, 'already_revoked', 'That statement is already revoked.');
  return c.json({ ok: true, attestation: ownerDto(row, today()) });
}
