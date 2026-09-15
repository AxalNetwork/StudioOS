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
import { PERIOD_RE } from '../services/statements';

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

/* ------------------------------------------------------------------ *
 * Money-adjacent: the calls that carry a per-deployment secret (D111) *
 * ------------------------------------------------------------------ */

/**
 * Verify the branch's own RPC secret against the hash HQ stores.
 *
 * WHY THESE CALLS NEED MORE THAN A CODE, when escalations do not. The header
 * of this file records that a service binding cannot identify its caller, so
 * `callerCode` is attribution, not authentication: any Worker in the account
 * could claim to be `fr`. For an escalation that is acceptable — the worst
 * case is a spurious item in a queue a person reads. For a USAGE REPORT it is
 * not: the report is the input to a statement, so a false one changes what a
 * subsidiary is billed. The secret is what makes the claim checkable.
 *
 * SHA-256 OF THE SECRET IS WHAT HQ STORES, never the secret. It is generated
 * by `branch-provision.yml`, put on the branch Worker as `RPC_SECRET`, and its
 * hash written into `licence_deployments.rpc_secret_hash` — a read of this
 * table therefore cannot impersonate a branch.
 *
 * A DEPLOYMENT WITH NO HASH REFUSES, and this is the important default. Every
 * branch provisioned before the hash was wired has a NULL there, and treating
 * null as "skip the check" would make the guard disappear on exactly the
 * deployments nobody has audited. The refusal names what to do.
 */
async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Length-independent, difference-independent compare over two hex digests. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type BranchIdentity = { code: string; licence_uid: string };

/**
 * Resolve and authenticate a branch making a money-adjacent call.
 *
 * Throws rather than returning an error shape, because every caller of this
 * wants the same thing on failure — to not perform the write — and a returned
 * error is one `if` away from being ignored.
 */
export async function authenticateBranch(
  env: Env, callerCode: string, secret: string,
): Promise<BranchIdentity> {
  requireHq(env);
  // LOWERED, DELIBERATELY — and this is the opposite of the rule the DEPLOY
  // route follows, which validates a new code exactly as typed. The difference
  // is what the string is: there, it is a name being chosen, and accepting
  // `FR` would create a branch whose code is not what the operator wrote.
  // Here it is an identifier being presented, and the deployment it resolves
  // to is the same one either way — `FR` reaches `fr` and must still present
  // `fr`'s own secret, so the normalisation cannot reach a branch the caller
  // could not already reach.
  const code = String(callerCode ?? '').trim().toLowerCase();
  if (!BRANCH_CODE_RE.test(code)) throw new Error('rpc: the caller must name a valid branch code');

  const dep = await env.DB.prepare(
    'SELECT code, licence_uid, rpc_secret_hash FROM licence_deployments WHERE code = ?',
  ).bind(code).first<{ code: string; licence_uid: string; rpc_secret_hash: string | null }>();
  if (!dep) throw new Error(`rpc: ${code} is not a provisioned branch`);

  if (!dep.rpc_secret_hash) {
    throw new Error(
      `rpc: ${code} has no rpc_secret_hash on file, so a money-adjacent call from it cannot be `
      + 'verified. Re-run branch-provision.yml for this code, or set the hash from the secret '
      + 'the provisioning run generated.',
    );
  }
  const presented = String(secret ?? '');
  if (!presented) throw new Error(`rpc: ${code} presented no secret`);
  if (!constantTimeEqual(await sha256Hex(presented), dep.rpc_secret_hash.trim().toLowerCase())) {
    throw new Error(`rpc: ${code} presented the wrong secret`);
  }
  return { code: dep.code, licence_uid: dep.licence_uid };
}

export type UsageFigure = {
  stream: string;
  gross_cents: number | null;
  currency?: string;
  is_estimate?: boolean;
  estimate_basis?: string;
  available?: boolean;
  reason?: string;
};

/**
 * A branch reports what it billed in a period (D.8).
 *
 * A RE-REPORT REPLACES, rather than adding a second row: a branch correcting
 * itself is a correction, not a second quarter's trading, and the UNIQUE index
 * on (licence, period, stream) is what makes that structural instead of
 * remembered. `reported_at` is the BRANCH's own stamp, so a statement built
 * from a three-week-old report shows the age of its evidence.
 *
 * A FIGURE THE BRANCH COULD NOT MEASURE IS STORED AS NULL, NOT 0. Measured
 * against the schema: no branch can total subscription revenue locally
 * (`account_subscriptions` has a plan and no amount; the charges are in
 * Stripe), so this is the normal case and not an edge one. A zero there would
 * make a statement drawn from it read as a complete quarter that earned less.
 */
export async function reportUsage(
  env: Env, callerCode: string, secret: string,
  period: string, figures: UsageFigure[],
): Promise<{ ok: true; period: string; streams: number }> {
  const who = await authenticateBranch(env, callerCode, secret);
  const p = String(period ?? '').trim();
  if (!PERIOD_RE.test(p)) throw new Error(`rpc: ${JSON.stringify(p)} is not a period (YYYY-Qn)`);

  const now = new Date().toISOString();
  const rows = (figures || []).filter((f) => f && typeof f.stream === 'string' && f.stream.trim());
  for (const f of rows) {
    const gross = f.available === false || f.gross_cents === null || f.gross_cents === undefined
      ? null
      : Math.trunc(Number(f.gross_cents) || 0);
    await env.DB.prepare(
      `INSERT INTO subsidiary_usage_reports
         (licence_uid, branch_code, period, stream, gross_cents, currency,
          is_estimate, estimate_basis, reported_at)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT(licence_uid, period, stream) DO UPDATE SET
         gross_cents = excluded.gross_cents, currency = excluded.currency,
         is_estimate = excluded.is_estimate, estimate_basis = excluded.estimate_basis,
         reported_at = excluded.reported_at`,
    ).bind(
      who.licence_uid, who.code, p, String(f.stream).trim().slice(0, 40),
      gross, String(f.currency || 'EUR').toUpperCase().slice(0, 3),
      f.is_estimate ? 1 : 0, f.estimate_basis ? String(f.estimate_basis).slice(0, 300) : null,
      now,
    ).run();
  }
  return { ok: true, period: p, streams: rows.length };
}

/**
 * The promo ceiling HQ has set for this branch's current period, for the
 * branch to store as a dated copy (`branch_promo_ceiling`, migration 256).
 *
 * `issued_cents` IS NOT SENT BACK. HQ does not know it — the branch issues the
 * codes and reports the figure through `reportUsage`. Echoing HQ's last-known
 * value would let a stale number overwrite the branch's own fresher one.
 */
export async function promoCeilingForBranch(
  env: Env, callerCode: string,
): Promise<{ period: string; ceiling_cents: number; currency: string; pushed_at: string } | { error: 'no_ceiling_set' }> {
  requireHq(env);
  const code = String(callerCode ?? '').trim().toLowerCase();
  if (!BRANCH_CODE_RE.test(code)) throw new Error('promoCeiling: the caller must name a valid branch code');

  const dep = await env.DB.prepare('SELECT licence_uid FROM licence_deployments WHERE code = ?')
    .bind(code).first<{ licence_uid: string }>();
  if (!dep) return { error: 'no_ceiling_set' };

  const row = await env.DB.prepare(
    `SELECT period, ceiling_cents, currency FROM licence_promo_ceilings
      WHERE licence_uid = ? ORDER BY period DESC LIMIT 1`,
  ).bind(dep.licence_uid).first<{ period: string; ceiling_cents: number; currency: string }>();
  if (!row) return { error: 'no_ceiling_set' };

  return {
    period: row.period,
    ceiling_cents: Number(row.ceiling_cents) || 0,
    currency: row.currency,
    // Stamped when HQ asserts it, like every other pushed copy (D106).
    pushed_at: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------ *
 * HQ answers an escalation (D112)                                     *
 * ------------------------------------------------------------------ */

/** What a branch's own lane needs back, beyond what `recordEscalation` returned. */
export type EscalationAnswer = {
  hq_uid: string;
  answer: string;
  answered_by_name: string;
  answered_at: string;
  status: string;
  pushed_at: string;
};

/** The states HQ can move an escalation to. `open` is the write-time default. */
export const ESCALATION_STATUSES = ['open', 'answered', 'declined', 'withdrawn'] as const;
export type EscalationStatus = (typeof ESCALATION_STATUSES)[number];

/**
 * Record HQ's decision on one escalation.
 *
 * WHY A DECISION AND NOT A MESSAGE. `hq_escalations` carries one `answer` with
 * one author and one time (migration 259). That is the decision half of what
 * the canvas draws and not the conversation half, and this function does not
 * pretend otherwise: a second answer REPLACES the first rather than appending,
 * because two decisions in one column is not a thread, it is a lost decision.
 * A real thread is a messages table and is its own feature.
 *
 * AN ANSWER REQUIRES TEXT even when the decision is "declined". The subsidiary
 * canvas draws the answer as something a branch admin reads and acts on; a
 * status change with nothing written is a refusal with no reason, arriving on
 * the screen of the person least able to find out why.
 *
 * DOES NOT PUSH. The push is the caller's, because whether the branch received
 * the decision is a different fact from whether HQ made it, and the route
 * reports them separately (the D111 promo-ceiling precedent).
 */
export async function answerEscalation(
  env: Env,
  uid: string,
  input: { answer: string; status?: string; answered_by_user_id: number; answered_by_name: string },
): Promise<{ row: EscalationRow; answer: Omit<EscalationAnswer, 'pushed_at'> }> {
  requireHq(env);

  const id = String(uid ?? '').trim().slice(0, 80);
  if (!id) throw new Error('answerEscalation: an escalation uid is required');

  const answer = String(input?.answer ?? '').trim().slice(0, 4000);
  if (!answer) {
    throw new Error(
      'answerEscalation: a decision needs its reason. A status change with nothing written '
      + 'reaches the branch as a refusal it cannot act on.',
    );
  }

  const status = String(input?.status ?? 'answered').trim().toLowerCase();
  if (!(ESCALATION_STATUSES as readonly string[]).includes(status)) {
    throw new Error(`answerEscalation: status must be one of ${ESCALATION_STATUSES.join(', ')}`);
  }
  // An answer that left the row 'open' would show as decided at HQ and
  // undecided on the branch, which is the one inconsistency this pair of
  // tables can produce.
  if (status === 'open') {
    throw new Error('answerEscalation: an answered escalation cannot stay open');
  }

  const name = String(input?.answered_by_name ?? '').trim().slice(0, 200);
  const now = new Date().toISOString();

  const existing = await env.DB.prepare('SELECT uid FROM hq_escalations WHERE uid = ?')
    .bind(id).first<{ uid: string }>();
  if (!existing) throw new Error(`answerEscalation: ${id} is not an escalation`);

  await env.DB.prepare(
    `UPDATE hq_escalations
        SET answer = ?, answered_by_user_id = ?, answered_at = ?, status = ?, updated_at = ?
      WHERE uid = ?`,
  ).bind(answer, Number(input.answered_by_user_id) || null, now, status, now, id).run();

  const row = await env.DB.prepare(
    `SELECT uid, branch_code, kind, subject, subject_ref, detail, raised_by_name,
            status, due_at, created_at, answer, answered_at
       FROM hq_escalations WHERE uid = ?`,
  ).bind(id).first<EscalationRow>();

  return {
    row: row!,
    answer: { hq_uid: id, answer, answered_by_name: name, answered_at: now, status },
  };
}

/**
 * The escalation board, filtered — H1 lists what is open, H6 lists content.
 *
 * `openEscalations` above stays as it is: H1's zone asks a narrower question
 * ("what is awaiting HQ") and a caller that had to pass `status: 'open'` to get
 * the same list would be one forgotten argument away from showing answered
 * items as a backlog.
 */
export async function listEscalations(
  env: Env,
  filter: { status?: string; kind?: string; branch_code?: string; limit?: number } = {},
): Promise<Array<EscalationRow & { sla: 'ok' | 'due_soon' | 'past' }>> {
  requireHq(env);
  const cap = Math.max(1, Math.min(200, Number(filter.limit) || 50));

  // FOUR LITERAL STATEMENTS RATHER THAN AN ASSEMBLED `WHERE`. The same rule
  // D111's PATCH handler follows and for the same reason: a `${…}` inside
  // `DB.prepare` lands in the query TEXT, where no binding protects it. The
  // filter space here is small enough to enumerate, so it is enumerated.
  const status = filter.status ? String(filter.status).trim().toLowerCase() : '';
  const kind = filter.kind ? String(filter.kind).trim().toLowerCase() : '';

  // AND THE COLUMN LIST IS REPEATED RATHER THAN HOISTED. A first draft put it
  // in a `COLS` const and interpolated it, which `check-sql-prepare` refused —
  // correctly, because the guard's rule is that NO `${…}` reaches the query
  // text, not that the value happens to be safe today. A hoisted fragment is
  // one refactor away from carrying a caller's string, so the four statements
  // are four statements.
  let rows: { results?: EscalationRow[] };
  if (status && kind) {
    rows = await env.DB.prepare(
      `SELECT uid, branch_code, kind, subject, subject_ref, detail, raised_by_name,
              status, due_at, created_at, answer, answered_at
         FROM hq_escalations WHERE status = ? AND kind = ?
        ORDER BY created_at ASC LIMIT ?`,
    ).bind(status, kind, cap).all<EscalationRow>();
  } else if (kind) {
    rows = await env.DB.prepare(
      `SELECT uid, branch_code, kind, subject, subject_ref, detail, raised_by_name,
              status, due_at, created_at, answer, answered_at
         FROM hq_escalations WHERE kind = ?
        ORDER BY created_at ASC LIMIT ?`,
    ).bind(kind, cap).all<EscalationRow>();
  } else if (status) {
    rows = await env.DB.prepare(
      `SELECT uid, branch_code, kind, subject, subject_ref, detail, raised_by_name,
              status, due_at, created_at, answer, answered_at
         FROM hq_escalations WHERE status = ?
        ORDER BY created_at ASC LIMIT ?`,
    ).bind(status, cap).all<EscalationRow>();
  } else {
    rows = await env.DB.prepare(
      `SELECT uid, branch_code, kind, subject, subject_ref, detail, raised_by_name,
              status, due_at, created_at, answer, answered_at
         FROM hq_escalations
        ORDER BY created_at ASC LIMIT ?`,
    ).bind(cap).all<EscalationRow>();
  }

  const now = Date.now();
  return (rows.results || []).map((r) => ({ ...r, sla: slaBand(r.due_at, now) }));
}
