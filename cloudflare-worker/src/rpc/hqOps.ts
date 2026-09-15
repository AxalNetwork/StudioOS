/**
 * What HQ answers when a branch asks — as plain functions (D108).
 *
 * The mirror of `branchOps.ts`, and split from the entrypoint class for the
 * same reason: `cloudflare:workers` does not exist under `node --test`, so
 * logic that lived in the class could only be verified by deploying.
 *
 * THE CALLER'S CODE IS AN ARGUMENT, AND THAT IS THE WHOLE SECURITY MODEL HERE.
 * D.7 records the one thing a service binding does not give you: a callee
 * cannot see which binding called it. So every branch→HQ call passes its own
 * `BRANCH_CODE`, and HQ cannot verify it from the transport. Three
 * consequences, each deliberate:
 *
 *   - The code is validated against the same regex `branchOf` uses, so a
 *     malformed one is refused rather than written into a row.
 *   - It is checked against `licence_deployments`, so a code HQ has never
 *     provisioned cannot file an escalation. That is the check that makes the
 *     stamp mean something, and it is why migration 258 lands in the same PR.
 *   - It is NOT enough for a money-adjacent call. Those carry a
 *     per-deployment secret verified against `rpc_secret_hash`; `reportUsage`
 *     is the first of them and PR 9 builds it. Saying so here rather than
 *     leaving the asymmetry to be discovered.
 *
 * An entrypoint is callable by any Worker in the account. The account is ours,
 * so this is not an authentication boundary — it is an attribution one, and
 * the difference is worth stating because treating it as the former is how a
 * binding ends up trusted for something it cannot establish.
 */
import type { Env } from '../types';
import { branchOf, BRANCH_CODE_RE } from '../util/branch';

/** The four things a branch cannot decide for itself (migration 259). */
export const ESCALATION_KINDS = ['moderation', 'content', 'seat_increase', 'other'] as const;
export type EscalationKind = (typeof ESCALATION_KINDS)[number];

/** Hours a kind gets before it is past SLA, per the subsidiary canvas's bands. */
const SLA_HOURS: Record<EscalationKind, number> = {
  moderation: 24,
  content: 72,
  seat_increase: 72,
  other: 72,
};

export type EscalationInput = {
  kind: string;
  subject: string;
  subject_ref?: string | null;
  detail?: string | null;
  raised_by_name?: string | null;
  raised_by_branch_user_id?: number | null;
};

/**
 * Refuse to answer on a branch.
 *
 * `BranchEntrypoint` is HQ's surface. A branch that exported and answered it
 * would be a second HQ as far as its own callers were concerned — escalations
 * filed into a database that has no HQ console to read them.
 */
function requireHq(env: Env): void {
  if (branchOf(env)) throw new Error('BranchEntrypoint is only live on HQ');
}

/**
 * Is this a branch HQ has actually provisioned?
 *
 * A MISSING TABLE IS A REFUSAL, NOT A PASS. Before migration 258 runs there is
 * no deployment registry, and treating "cannot check" as "allowed" would make
 * the attribution check disappear exactly when the schema is in flux. The
 * escalation is rejected with a reason the caller can act on instead.
 */
async function knownBranch(env: Env, code: string): Promise<boolean> {
  const row = await env.DB.prepare('SELECT 1 AS x FROM licence_deployments WHERE code = ?')
    .bind(code).first<{ x: number }>();
  return !!row;
}

function newUid(): string {
  return `esc_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

/**
 * A branch pushes an item up. Returns the escalation's uid so the branch can
 * show it in its own "To HQ" lane and follow the answer back.
 */
export async function recordEscalation(
  env: Env, callerCode: string, item: EscalationInput,
): Promise<{ uid: string; due_at: string; status: 'open' }> {
  requireHq(env);

  const code = String(callerCode ?? '').trim().toLowerCase();
  if (!BRANCH_CODE_RE.test(code)) {
    throw new Error('escalate: the caller must name a valid branch code');
  }
  if (!(await knownBranch(env, code))) {
    throw new Error(`escalate: ${code} is not a provisioned branch`);
  }

  const kind = String(item?.kind ?? '').trim().toLowerCase() as EscalationKind;
  if (!(ESCALATION_KINDS as readonly string[]).includes(kind)) {
    throw new Error(`escalate: kind must be one of ${ESCALATION_KINDS.join(', ')}`);
  }
  const subject = String(item?.subject ?? '').trim().slice(0, 300);
  if (!subject) throw new Error('escalate: a subject is required');

  const uid = newUid();
  // The due date, not a band: a band stored at write time is wrong an hour
  // later, which is the whole reason migration 259 stores this column.
  const dueAt = new Date(Date.now() + SLA_HOURS[kind] * 3600_000).toISOString();

  await env.DB.prepare(
    `INSERT INTO hq_escalations
       (uid, branch_code, kind, subject, subject_ref, detail,
        raised_by_name, raised_by_branch_user_id, status, due_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
  ).bind(
    uid, code, kind, subject,
    item?.subject_ref ? String(item.subject_ref).slice(0, 300) : null,
    item?.detail ? String(item.detail).slice(0, 4000) : null,
    item?.raised_by_name ? String(item.raised_by_name).slice(0, 200) : null,
    Number.isFinite(Number(item?.raised_by_branch_user_id))
      ? Number(item.raised_by_branch_user_id) : null,
    dueAt,
  ).run();

  return { uid, due_at: dueAt, status: 'open' };
}

export type EscalationRow = {
  uid: string; branch_code: string; kind: string; subject: string; subject_ref: string | null;
  detail: string | null; raised_by_name: string | null; status: string; due_at: string | null;
  created_at: string; answer: string | null; answered_at: string | null;
};

/** The SLA band S3 and H1 both draw, derived on READ so it stays true. */
export function slaBand(dueAt: string | null, now = Date.now()): 'ok' | 'due_soon' | 'past' {
  if (!dueAt) return 'ok';
  const due = Date.parse(dueAt);
  if (!Number.isFinite(due)) return 'ok';
  if (now > due) return 'past';
  return due - now <= 24 * 3600_000 ? 'due_soon' : 'ok';
}

/**
 * What HQ's Home lists under "Escalations awaiting HQ" (H1).
 *
 * Oldest first: the canvas orders queue pressure by age, not by count, on both
 * tiers.
 */
export async function openEscalations(
  env: Env, limit = 50,
): Promise<Array<EscalationRow & { sla: 'ok' | 'due_soon' | 'past' }>> {
  const cap = Math.max(1, Math.min(200, Number(limit) || 50));
  const rows = await env.DB.prepare(
    `SELECT uid, branch_code, kind, subject, subject_ref, detail, raised_by_name,
            status, due_at, created_at, answer, answered_at
       FROM hq_escalations
      WHERE status = 'open'
      ORDER BY created_at ASC
      LIMIT ?`,
  ).bind(cap).all<EscalationRow>();
  const now = Date.now();
  return (rows.results || []).map((r) => ({ ...r, sla: slaBand(r.due_at, now) }));
}

/**
 * A branch pulls its own licence terms from HQ's ledger.
 *
 * WHY A BRANCH WOULD PULL WHEN HQ ALSO PUSHES. The push is how a change
 * propagates; the pull is how a freshly provisioned branch gets its first copy
 * without waiting for HQ to notice it exists. Both write the same row through
 * `applyLicenceCopy`, so there is one shape and one `pushed_at` rule.
 */
export async function licenceForBranch(
  env: Env, callerCode: string,
): Promise<Record<string, unknown> | { error: 'no_licence_for_branch' }> {
  requireHq(env);
  const code = String(callerCode ?? '').trim().toLowerCase();
  if (!BRANCH_CODE_RE.test(code)) throw new Error('licence: the caller must name a valid branch code');

  const dep = await env.DB.prepare('SELECT licence_uid FROM licence_deployments WHERE code = ?')
    .bind(code).first<{ licence_uid: string }>();
  if (!dep) return { error: 'no_licence_for_branch' };

  // THE COLUMN LIST IS MIGRATION 187'S, not the branch copy's. The two tables
  // do not have the same columns and assuming they did is how the first draft
  // of this query named `term_start`, `term_end`, `template_version` and
  // `token_margin_split_bps` — of which only a renamed `token_split_bps`
  // exists. D1 would have thrown on every pull.
  const row = await env.DB.prepare(
    `SELECT uid, licence_ref, legal_entity_name, brand_name, status, annual_fee_cents, currency,
            revenue_share_bps, token_split_bps, term_years, starts_on, renews_on,
            suspended_at, status_note
       FROM territory_licences WHERE uid = ?`,
  ).bind(dep.licence_uid).first<Record<string, unknown>>();
  if (!row) return { error: 'no_licence_for_branch' };

  const terr = await env.DB.prepare(
    'SELECT country_code FROM licence_territories lt JOIN territory_licences l ON l.id = lt.licence_id WHERE l.uid = ?',
  ).bind(dep.licence_uid).all<{ country_code: string }>();
  const seats = await env.DB.prepare(
    'SELECT seat_type, seats_licensed FROM licence_seats ls JOIN territory_licences l ON l.id = ls.licence_id WHERE l.uid = ?',
  ).bind(dep.licence_uid).all<{ seat_type: string; seats_licensed: number }>();

  const seatsMap: Record<string, number> = {};
  for (const s of seats.results || []) seatsMap[String(s.seat_type)] = Number(s.seats_licensed) || 0;

  // Shaped for `applyLicenceCopy` — the branch writes what HQ sends without
  // renaming anything, which is the lesson migration 257 came from.
  return {
    licence_uid: row.uid,
    licence_ref: row.licence_ref,
    legal_entity: row.legal_entity_name,
    brand_name: row.brand_name,
    territory: (terr.results || []).map((t) => t.country_code).join(','),
    status: row.status,
    seats_json: JSON.stringify(seatsMap),
    revenue_share_bps: row.revenue_share_bps,
    token_split_bps: row.token_split_bps,
    annual_fee_cents: row.annual_fee_cents,
    currency: row.currency,
    term_start: row.starts_on,
    // `term_end` AND `template_version` ARE NULL BECAUSE HQ DOES NOT HOLD
    // THEM. The ledger stores `term_years` beside `starts_on` and no end date,
    // and it carries no template version at all — contracts do (they already
    // travel with the version they were cut from). Computing an end date from
    // `starts_on + term_years` here would invent a fact HQ never asserted, and
    // the copy's job is to carry what HQ said, not to derive around it.
    term_end: null,
    renewal_at: row.renews_on,
    template_version: null,
    suspended_at: row.suspended_at,
    suspended_note: row.status_note,
    // Stamped by HQ at the moment it asserts the content — the branch stores
    // this verbatim rather than the moment its own write lands.
    pushed_at: new Date().toISOString(),
  };
}
