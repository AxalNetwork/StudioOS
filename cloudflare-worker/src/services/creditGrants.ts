/**
 * D540 — the one way a reward puts credits on someone's perk ledger.
 *
 * Every reward in #1101 comes through `grantCredits`: a bug fixed (#1105), a
 * suggested task approved (#1107), a Spin-Out Lab milestone (#1104). Nothing
 * else writes a rule-based grant, so the rules below hold for every one of
 * them rather than for whichever caller remembered.
 *
 *   1. THE AMOUNT IS READ, NEVER PASSED. The caller names a rule key; the
 *      credits and their dollar value come from `credit_reward_rules`
 *      (migration 381) at the moment of the grant, so the Super Admin's edit
 *      is the amount paid. An unknown, inactive or zero rule pays nothing.
 *   2. IDEMPOTENT. The ledger's unique `(user_id, kind, source_ref)` index
 *      (migration 186) makes a second grant for the same source a no-op; it is
 *      reported as `already_granted`, never as an error and never twice.
 *   3. STAFF NEVER EARN. The recipient's role is read here, not trusted from
 *      the caller. `admin` (the Super Admin included) and `partner` (the
 *      studio staff role in `services/projectAccess.ts`) are refused.
 *   4. THE MONTHLY BOUNTY CAP. Bounty rules (bugs, shipped features, approved
 *      tasks) may not take a user past `cap:bounty_monthly` credits in one
 *      calendar month (UTC). The check is inside the INSERT, so two grants
 *      racing cannot both slip under it. A grant that would cross the cap is
 *      refused whole; a revoked grant no longer counts against it. Lab
 *      milestones are not bounties and are not capped.
 *   5. THE ACTOR IS RECORDED. An admin grant goes through `logAdminAction`; a
 *      system grant (a webhook, a milestone) writes `activity_logs` with
 *      `system:<source>` as the actor.
 *   6. THE USER IS TOLD. An inbox notice says what they earned and why. A
 *      notice that fails never undoes a grant that landed (D111): it is
 *      reported on the result as `notified: false`.
 *
 * A revoke (`revokeGrant`) is a Super Admin's `admin_adjust` line carrying the
 * typed reason, keyed `revoke:<ledger id>` so it too happens once. It is
 * refused when the user has already spent the credits, because the ledger
 * must not go below zero (`POST /perks/admin/credits` holds the same rule).
 */
import type { Env } from '../types';
import { logAdminAction } from './adminAudit';
import { notify } from './notify';

export const CAP_RULE_KEY = 'cap:bounty_monthly';
/** Roles that never earn credits (#1101: "Staff and admin accounts"). */
export const INELIGIBLE_ROLES: ReadonlySet<string> = new Set(['admin', 'partner']);
const SOURCE_MAX = 120;
const NOTE_MAX = 500;

export type GrantActor =
  | { kind: 'admin'; id: number; email: string }
  | { kind: 'system'; source: string };

export type GrantRefusalCode =
  | 'invalid_request' | 'rule_unknown' | 'rule_inactive' | 'user_not_found'
  | 'not_eligible' | 'cap_reached' | 'superseded';

export type GrantResult =
  | { status: 'granted'; ledger_id: number; rule_key: string; credits: number; usd_value_cents: number; notified: boolean }
  | { status: 'already_granted'; ledger_id: number | null; rule_key: string }
  | { status: 'refused'; code: GrantRefusalCode; message: string; cap?: { limit: number; used: number } };

/** A bounty is paid for a report or a suggestion, and counts toward the cap. */
export function isBountyRule(key: string): boolean {
  return key.startsWith('bug_') || key.startsWith('feature_shipped_') || key === 'task_approved';
}

/** The first instant of this calendar month, UTC, comparable with both stored date shapes. */
export function monthStart(now = new Date()): string {
  return `${now.toISOString().slice(0, 7)}-01`;
}

/**
 * Bounty credits granted this month and not revoked. The bounty test is
 * `isBountyRule` in SQL — `substr`, never LIKE, because `_` is a wildcard
 * there — and the INSERT in `grantCredits` repeats this query word for word,
 * since a query is never assembled from pieces (check-sql-prepare). Both sides
 * of the date go through
 * `datetime()`: the ledger's `created_at` defaults to SQLite's own format
 * while every route writes ISO, and a bare comparison mis-orders the two
 * (D162).
 */
const CAP_USED_SQL = `SELECT COALESCE(SUM(g.delta), 0) AS used FROM perk_credit_ledger g
   WHERE g.user_id = ? AND g.kind = 'grant' AND datetime(g.created_at) >= datetime(?)
     AND (substr(g.rule_key, 1, 4) = 'bug_' OR substr(g.rule_key, 1, 16) = 'feature_shipped_' OR g.rule_key = 'task_approved')
     AND NOT EXISTS (SELECT 1 FROM perk_credit_ledger r
                      WHERE r.user_id = g.user_id AND r.kind = 'admin_adjust'
                        AND r.source_ref = 'revoke:' || g.id)`;

/** Why the user earned it, in their inbox and on the ledger line. */
export function ruleReason(key: string): string {
  if (key === 'bug_high' || key === 'bug_medium' || key === 'bug_low') {
    return `A bug you reported was confirmed and fixed (${key.slice(4)} impact)`;
  }
  if (key.startsWith('feature_shipped_')) return `A feature you requested shipped (${key.slice(16)} impact)`;
  if (key === 'task_approved') return 'A task you suggested was approved for the community task list';
  if (key === 'lab:graduation') return 'You graduated from the Spin-Out Lab';
  if (key.startsWith('lab:')) return `Spin-Out Lab milestone completed: ${key.slice(4).replace(/_/g, ' ')}`;
  return `Reward: ${key}`;
}

const clean = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);

async function recordActor(env: Env, actor: GrantActor, action: string, details: Record<string, unknown>, userId: number) {
  if (actor.kind === 'admin') {
    await logAdminAction(env, actor.id, actor.email, action, details);
    return;
  }
  try {
    await env.DB.prepare(
      'INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?, ?, ?, ?)',
    ).bind(action, JSON.stringify(details), `system:${clean(actor.source, 60) || 'unknown'}`, userId).run();
  } catch (e) {
    console.warn('[creditGrants] activity_logs write failed', action, (e as Error).message);
  }
}

async function tell(env: Env, userId: number, type: string, title: string, body: string, payload: Record<string, unknown>) {
  try {
    const id = await notify(env, { userId, type, title, body, link: '/perks', payload, channels: ['in_app'], category: 'credits' });
    return id !== null;
  } catch (e) {
    console.warn('[creditGrants] inbox notice failed', type, (e as Error).message);
    return false;
  }
}

const plural = (n: number) => `${n} credit${n === 1 ? '' : 's'}`;
const usd = (cents: number) => `US$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

/**
 * `unlessPaid` (#1104 follow-up): a source ref of the same user whose grant
 * forbids this one, for a pair that pays "the first of" two. It is checked
 * INSIDE the insert, so two grants landing together cannot both pass it,
 * and a hit is refused as `superseded`. Each half keeps its own source ref.
 */
export async function grantCredits(env: Env, args: {
  userId: number; ruleKey: string; sourceRef: string; actor: GrantActor; note?: string | null;
  unlessPaid?: string | null;
}): Promise<GrantResult> {
  const ruleKey = clean(args.ruleKey, 80);
  const sourceRef = clean(args.sourceRef, SOURCE_MAX);
  const userId = Number(args.userId);
  if (!Number.isInteger(userId) || userId <= 0 || !ruleKey || !sourceRef || ruleKey === CAP_RULE_KEY) {
    return { status: 'refused', code: 'invalid_request', message: 'A grant needs a user, a reward rule and a source.' };
  }

  // A SOURCE ALREADY PAID IS ANSWERED FIRST. Whether the rule is still on,
  // what it pays now and who the recipient is today can all change after a
  // grant; a retry of a paid source must still read `already_granted`, or a
  // webhook or job would treat a processed event as failed and retry forever.
  const paid = await env.DB.prepare(
    `SELECT id FROM perk_credit_ledger WHERE user_id = ? AND kind = 'grant' AND source_ref = ?`,
  ).bind(userId, sourceRef).first<{ id: number }>();
  if (paid) return { status: 'already_granted', ledger_id: Number(paid.id), rule_key: ruleKey };

  const rule = await env.DB.prepare(
    'SELECT key, credits, usd_value_cents, active FROM credit_reward_rules WHERE key = ?',
  ).bind(ruleKey).first<{ key: string; credits: number; usd_value_cents: number; active: number }>();
  if (!rule) return { status: 'refused', code: 'rule_unknown', message: `No reward rule is named ${ruleKey}.` };
  const credits = Number(rule.credits);
  if (Number(rule.active) !== 1 || !(credits > 0)) {
    return { status: 'refused', code: 'rule_inactive', message: `The ${ruleKey} reward is switched off, so nothing was granted.` };
  }

  const user = await env.DB.prepare('SELECT id, role FROM users WHERE id = ?')
    .bind(userId).first<{ id: number; role: string }>();
  if (!user) return { status: 'refused', code: 'user_not_found', message: 'No such account.' };
  if (INELIGIBLE_ROLES.has(String(user.role || '').toLowerCase())) {
    return { status: 'refused', code: 'not_eligible', message: 'Staff and admin accounts do not earn credits.' };
  }

  const bounty = isBountyRule(ruleKey);
  let cap = 0;
  if (bounty) {
    const capRow = await env.DB.prepare(
      'SELECT credits, active FROM credit_reward_rules WHERE key = ?',
    ).bind(CAP_RULE_KEY).first<{ credits: number; active: number }>();
    // An inactive cap row lifts the cap; a missing one is not a licence to pay
    // without limit, so it reads as a cap of zero.
    cap = capRow ? (Number(capRow.active) === 1 ? Number(capRow.credits) : -1) : 0;
  }
  const since = monthStart();
  const note = clean(args.note, NOTE_MAX) || ruleReason(ruleKey);
  const capped = bounty && cap >= 0;
  const unlessPaid = clean(args.unlessPaid, SOURCE_MAX) || null;

  // THE CAP IS INSIDE THE INSERT. A read-then-write would let two grants
  // landing together both see room under it.
  const ins = await env.DB.prepare(
    `INSERT OR IGNORE INTO perk_credit_ledger (user_id, delta, kind, source_ref, note, created_at, rule_key)
     SELECT ?, ?, 'grant', ?, ?, ?, ?
      WHERE (? = 0 OR (SELECT COALESCE(SUM(g.delta), 0) AS used FROM perk_credit_ledger g
   WHERE g.user_id = ? AND g.kind = 'grant' AND datetime(g.created_at) >= datetime(?)
     AND (substr(g.rule_key, 1, 4) = 'bug_' OR substr(g.rule_key, 1, 16) = 'feature_shipped_' OR g.rule_key = 'task_approved')
     AND NOT EXISTS (SELECT 1 FROM perk_credit_ledger r
                      WHERE r.user_id = g.user_id AND r.kind = 'admin_adjust'
                        AND r.source_ref = 'revoke:' || g.id)) + ? <= ?)
      AND (? IS NULL OR NOT EXISTS (SELECT 1 FROM perk_credit_ledger x
                                     WHERE x.user_id = ? AND x.kind = 'grant' AND x.source_ref = ?))`,
  ).bind(userId, credits, sourceRef, note, new Date().toISOString(), ruleKey,
    capped ? 1 : 0, userId, since, credits, cap, unlessPaid, userId, unlessPaid).run();

  if (Number(ins?.meta?.changes ?? 0) !== 1) {
    const prior = await env.DB.prepare(
      `SELECT id, rule_key FROM perk_credit_ledger WHERE user_id = ? AND kind = 'grant' AND source_ref = ?`,
    ).bind(userId, sourceRef).first<{ id: number; rule_key: string | null }>();
    if (prior) return { status: 'already_granted', ledger_id: Number(prior.id), rule_key: ruleKey };
    if (unlessPaid) {
      const other = await env.DB.prepare(
        `SELECT id FROM perk_credit_ledger WHERE user_id = ? AND kind = 'grant' AND source_ref = ?`,
      ).bind(userId, unlessPaid).first<{ id: number }>();
      if (other) return { status: 'refused', code: 'superseded', message: 'The other half of this pair was already paid, so nothing was granted.' };
    }
    const used = await env.DB.prepare(CAP_USED_SQL).bind(userId, since).first<{ used: number }>();
    const usedN = Number(used?.used) || 0;
    return {
      status: 'refused', code: 'cap_reached',
      message: `This would take the account past its ${plural(cap)} bounty limit for the month (${plural(usedN)} granted so far), so nothing was granted.`,
      cap: { limit: cap, used: usedN },
    };
  }

  const ledgerId = Number(ins.meta.last_row_id);
  const usdCents = Number(rule.usd_value_cents) || 0;
  await recordActor(env, args.actor, 'credit_grant', {
    target_user_id: userId, rule_key: ruleKey, credits, usd_value_cents: usdCents, source_ref: sourceRef, ledger_id: ledgerId,
  }, userId);
  const notified = await tell(env, userId, 'credit_grant', `You earned ${plural(credits)} (${usd(usdCents)})`,
    `${note}. Spend them on Perks. Credits have no cash value and cannot be transferred.`,
    { ledger_id: ledgerId, rule_key: ruleKey, credits });
  return { status: 'granted', ledger_id: ledgerId, rule_key: ruleKey, credits, usd_value_cents: usdCents, notified };
}

export type RevokeResult =
  | { status: 'revoked'; ledger_id: number; credits: number; notified: boolean }
  | { status: 'already_revoked'; ledger_id: number }
  | { status: 'refused'; code: 'not_found' | 'would_overdraw'; message: string; balance?: number };

/**
 * A grant is taken back: an `admin_adjust` line with the reason. The actor is
 * a Super Admin, or (D542) the system acting on a decision recorded
 * elsewhere — a bounty tier label removed on GitHub — which is logged to
 * `activity_logs` as `system:<source>`, as a system grant is.
 */
export async function revokeGrant(env: Env, args: {
  ledgerId: number; actor: { id: number; email: string } | GrantActor; reason: string;
}): Promise<RevokeResult> {
  const grant = await env.DB.prepare(
    `SELECT id, user_id, delta, rule_key, source_ref FROM perk_credit_ledger WHERE id = ? AND kind = 'grant'`,
  ).bind(args.ledgerId).first<{ id: number; user_id: number; delta: number; rule_key: string | null; source_ref: string }>();
  if (!grant) return { status: 'refused', code: 'not_found', message: 'No grant has that id.' };
  const ref = `revoke:${grant.id}`;
  const credits = Number(grant.delta);
  const ins = await env.DB.prepare(
    `INSERT OR IGNORE INTO perk_credit_ledger (user_id, delta, kind, source_ref, note, created_at, rule_key)
     SELECT ?, ?, 'admin_adjust', ?, ?, ?, ?
      WHERE (SELECT COALESCE(SUM(delta), 0) FROM perk_credit_ledger WHERE user_id = ?) >= ?`,
  ).bind(grant.user_id, -credits, ref, args.reason, new Date().toISOString(), grant.rule_key, grant.user_id, credits).run();
  if (Number(ins?.meta?.changes ?? 0) !== 1) {
    const prior = await env.DB.prepare(
      `SELECT id FROM perk_credit_ledger WHERE user_id = ? AND kind = 'admin_adjust' AND source_ref = ?`,
    ).bind(grant.user_id, ref).first<{ id: number }>();
    if (prior) return { status: 'already_revoked', ledger_id: Number(prior.id) };
    const bal = await env.DB.prepare('SELECT COALESCE(SUM(delta), 0) AS b FROM perk_credit_ledger WHERE user_id = ?')
      .bind(grant.user_id).first<{ b: number }>();
    return {
      status: 'refused', code: 'would_overdraw', balance: Number(bal?.b) || 0,
      message: `The account holds ${plural(Number(bal?.b) || 0)}, fewer than the ${plural(credits)} this grant paid: they have been spent, so the grant cannot be taken back without a negative balance.`,
    };
  }
  const ledgerId = Number(ins.meta.last_row_id);
  const actor: GrantActor = 'kind' in args.actor ? args.actor : { kind: 'admin', ...args.actor };
  await recordActor(env, actor, 'credit_grant_revoke', {
    target_user_id: grant.user_id, grant_ledger_id: grant.id, ledger_id: ledgerId,
    rule_key: grant.rule_key, credits, source_ref: grant.source_ref, reason: args.reason,
  }, grant.user_id);
  const notified = await tell(env, grant.user_id, 'credit_grant_revoked', `${plural(credits)} were taken back`,
    `A grant of ${plural(credits)} was revoked. The reason recorded: "${args.reason}".`,
    { grant_ledger_id: grant.id, ledger_id: ledgerId, credits });
  return { status: 'revoked', ledger_id: ledgerId, credits, notified };
}
