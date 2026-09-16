/**
 * What a branch answers when HQ asks — as plain functions (D108).
 *
 * WHY THE LOGIC IS NOT IN THE ENTRYPOINT CLASS. `WorkerEntrypoint` comes from
 * `cloudflare:workers`, a module that only exists inside the Workers runtime,
 * so a test that imported the class could not run under `node --test` at all.
 * Every fact these functions compute would then be verified only by deploying,
 * which for a cross-tier read is exactly the wrong place to find out. The class
 * in `rpc/index.ts` is a four-line delegation; the behaviour is here, and the
 * tests exercise it against a real D1 shim.
 *
 * EVERY FUNCTION READS THE BRANCH'S OWN DATABASE AND NOTHING ELSE. That is not
 * a rule this file enforces — it is the only database bound to the Worker these
 * run on (D.2). There is no global view underneath to leak, which is the first
 * of the subsidiary canvas's four wall rules and the reason the whole
 * programme chose a Worker per branch over a `branch_id` column.
 *
 * AN UNMEASURED NUMBER IS NULL WITH A REASON, NEVER A ZERO. Seats used and
 * revenue month-to-date both have no store on a branch yet. HQ's Home draws a
 * card per branch, and a zero there would read as "this territory sold
 * nothing" rather than "nobody has built this yet" — the same rule
 * `DERIVED_UNAVAILABLE` states for the licence page.
 */
import type { Env } from '../types';
import { branchOf, BRANCH_CODE_RE } from '../util/branch';
import { PRE_VERDICT_STATUSES } from '../services/referralSubmissions';
// ONE DEFINITION OF "PAST SLA", shared across the tier boundary. It is a pure
// function of a date, so importing it costs nothing and restating it would let
// HQ's board and the branch's lane disagree about which items are late — with
// both screens confident.
import { slaBand } from './hqOps';
// ONE COMPARISON FOR BOTH DIRECTIONS (D120). See `secret.ts`'s header for why
// the digest and the refusals are shared rather than written twice.
import { sha256Hex, verifySecret } from './secret';
import { createJWT, loadSuperAdminFlag } from '../auth';

/** Every branch answer carries the code, because a binding does not (D.7). */
export type BranchAnswer<T> = T & { branch: string; as_of: string };

export type BranchHealth = {
  ok: boolean;
  /** The licence copy's age, or null when HQ has not pushed one. */
  licence_pushed_at: string | null;
  licence_status: string | null;
  db_ok: boolean;
  /** Present only when something is wrong; never a stack trace. */
  detail?: string;
};

export type BranchOverview = {
  accounts: { total: number; by_role: Record<string, number> };
  seats_used: null;
  seats_used_reason: string;
  backlog: { count: number; oldest_at: string | null } | null;
  backlog_reason?: string;
  revenue_mtd_cents: null;
  revenue_reason: string;
  suspended: boolean;
};

/**
 * Refuse to answer on HQ.
 *
 * Every method re-checks rather than trusting that the binding only exists on
 * one tier, because `wrangler.toml` is edited by hand and by a generator, and
 * a service binding pointed at the wrong script is a configuration mistake
 * that would otherwise succeed. Thrown, not returned: a caller that ignored a
 * flag would report HQ's own numbers as a branch's.
 */
function requireBranch(env: Env): string {
  const code = branchOf(env);
  if (!code) throw new Error('HqEntrypoint is only live on a branch');
  return code;
}

const nowIso = () => new Date().toISOString();

/** The singleton licence copy's status and age, or nulls. Never throws. */
async function licenceCopy(env: Env): Promise<{ status: string | null; pushed_at: string | null }> {
  try {
    const row = await env.DB.prepare('SELECT status, pushed_at FROM branch_licence WHERE id = 1')
      .first<{ status: string; pushed_at: string }>();
    return { status: row?.status ?? null, pushed_at: row?.pushed_at ?? null };
  } catch {
    // Migration 256 not applied, or the push has not happened. Both read as
    // "no copy", which the caller renders as a provisioning state rather than
    // as a licence that does not exist.
    return { status: null, pushed_at: null };
  }
}

/**
 * Is this deployment answering, and does its database work?
 *
 * DELIBERATELY DOES A REAL QUERY. A method that returned `{ok: true}` without
 * touching D1 would answer "healthy" for a Worker whose database binding is
 * wrong — which is the failure a health check on a freshly provisioned branch
 * exists to catch.
 */
export async function branchHealth(env: Env): Promise<BranchAnswer<BranchHealth>> {
  const branch = requireBranch(env);
  let dbOk = false;
  let detail: string | undefined;
  try {
    await env.DB.prepare('SELECT 1 AS ok').first<{ ok: number }>();
    dbOk = true;
  } catch (e) {
    detail = String((e as Error).message || e).slice(0, 200);
  }
  const licence = await licenceCopy(env);
  return {
    ok: dbOk,
    db_ok: dbOk,
    licence_status: licence.status,
    licence_pushed_at: licence.pushed_at,
    ...(detail ? { detail } : {}),
    branch,
    as_of: nowIso(),
  };
}

/**
 * The four approval queues, as one backlog count and the oldest item's age.
 *
 * WHY IT IS ONE NUMBER AND NOT FOUR. H1's health card draws "backlog + oldest
 * item age", and S1 orders queue pressure by the OLDEST item rather than by
 * count — both want the queue as one pressure reading. The per-queue split is
 * S3's board, which PR 13 builds over a read model; duplicating a partial
 * version of it here would be a second answer to the same question.
 *
 * A TABLE THAT CANNOT BE READ SUBTRACTS THE WHOLE ANSWER. If one of the four
 * is missing, the count is not "the other three" — that is a smaller number
 * presented as the backlog, which is worse than no number. It returns null
 * with a reason naming what could not be read.
 */
async function backlogOf(env: Env): Promise<{ backlog: BranchOverview['backlog']; reason?: string }> {
  // THE STATUS VOCABULARIES ARE THE ROUTES' OWN, read off each store rather
  // than guessed: `lp_applications` and `cohort_applicants` default to
  // 'pending', moderation cases awaiting a decision are 'under_review'
  // ('active' is a resolved case, not an open one), and referrals have a whole
  // set. Two of the four table names in the first draft of this function were
  // wrong, which would not have failed — it would have reported the backlog as
  // permanently unreadable, a plausible-looking answer that is never right.
  //
  // Referrals reuse `PRE_VERDICT_STATUSES` rather than restating it, MINUS
  // 'draft': a draft belongs to the member who is still writing it, and
  // counting it as reviewer backlog would put the branch admin under pressure
  // for work nobody has handed them.
  const referralPending = [...PRE_VERDICT_STATUSES].filter((s) => s !== 'draft');
  const referralIn = referralPending.map((s) => `'${s}'`).join(', ');
  const SOURCES: Array<{ label: string; sql: string }> = [
    { label: 'LP applications', sql: "SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM lp_applications WHERE status = 'pending'" },
    { label: 'referrals', sql: `SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM referral_submissions WHERE status IN (${referralIn})` },
    { label: 'cohort applications', sql: "SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM cohort_applicants WHERE status = 'pending'" },
    { label: 'spinout moderation', sql: "SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM spinout_moderation_cases WHERE status = 'under_review'" },
  ];
  let count = 0;
  let oldest: string | null = null;
  const unreadable: string[] = [];
  for (const s of SOURCES) {
    try {
      const row = await env.DB.prepare(s.sql).first<{ n: number; oldest: string | null }>();
      count += Number(row?.n) || 0;
      const o = row?.oldest ?? null;
      if (o && (oldest === null || o < oldest)) oldest = o;
    } catch {
      unreadable.push(s.label);
    }
  }
  if (unreadable.length) {
    return {
      backlog: null,
      reason:
        `The backlog is the sum of four queues and ${unreadable.join(', ')} could not be read on this `
        + 'branch, so the total would be smaller than the truth rather than unknown.',
    };
  }
  return { backlog: { count, oldest_at: oldest } };
}

/**
 * The per-branch figures HQ's Home draws in one card (H1).
 */
export async function branchOverview(env: Env): Promise<BranchAnswer<BranchOverview>> {
  const branch = requireBranch(env);

  const roles = await env.DB.prepare(
    'SELECT role, COUNT(*) AS n FROM users WHERE is_active = 1 GROUP BY role',
  ).all<{ role: string; n: number }>();
  const byRole: Record<string, number> = {};
  let total = 0;
  for (const row of roles.results || []) {
    const n = Number(row.n) || 0;
    byRole[String(row.role)] = n;
    total += n;
  }

  const { backlog, reason } = await backlogOf(env);
  const licence = await licenceCopy(env);

  return {
    accounts: { total, by_role: byRole },
    // Both of these are the honest answer, not a placeholder to fill in later.
    seats_used: null,
    seats_used_reason:
      'Seats used needs `seat_assignments`, which says who holds which seat id. No such store exists '
      + 'yet on either tier, so this is unknown rather than zero.',
    backlog,
    ...(reason ? { backlog_reason: reason } : {}),
    revenue_mtd_cents: null,
    revenue_reason:
      'Revenue month-to-date for a territory needs the branch\'s own billing rows summed against the '
      + 'pushed revenue share. The reporting call that computes it is not built, so no figure is sent.',
    suspended: String(licence.status || '').toLowerCase() === 'suspended',
    branch,
    as_of: nowIso(),
  };
}

export type BranchAccountHit = {
  id: number; name: string | null; email: string | null; role: string; is_active: number; created_at: string | null;
};

/**
 * H4's cross-branch search, as one branch answers it.
 *
 * THE QUERY IS BOUNDED AND THE MATCH IS A PREFIX-FREE `LIKE`. HQ fans this out
 * to every branch on every keystroke-driven search, so an unbounded scan here
 * is N unbounded scans there. `limit` is clamped rather than trusted: the
 * caller is another Worker in the same account, which makes it trusted for
 * authorisation and not for arithmetic.
 */
export async function branchSearchAccounts(
  env: Env, q: string, limit = 20,
): Promise<BranchAnswer<{ results: BranchAccountHit[]; truncated: boolean }>> {
  const branch = requireBranch(env);
  const needle = String(q ?? '').trim();
  const cap = Math.max(1, Math.min(50, Number(limit) || 20));
  if (needle.length < 2) {
    return { results: [], truncated: false, branch, as_of: nowIso() };
  }
  const like = `%${needle.replace(/[%_]/g, (m) => `\\${m}`)}%`;
  const rows = await env.DB.prepare(
    `SELECT id, name, email, role, is_active, created_at
       FROM users
      WHERE name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\'
      ORDER BY id DESC
      LIMIT ?`,
  ).bind(like, like, cap + 1).all<BranchAccountHit>();
  const all = rows.results || [];
  return {
    results: all.slice(0, cap),
    truncated: all.length > cap,
    branch,
    as_of: nowIso(),
  };
}

/**
 * HQ pushes this branch its licence; the branch writes the copy (migration
 * 256/257).
 *
 * `pushed_at` COMES FROM HQ AND IS NOT STAMPED HERE. It is the moment HQ
 * asserted the content, so a retry that rewrites the row keeps the age of the
 * fact rather than resetting it — migration 256 says this and it is the whole
 * value of the column.
 */
export async function applyLicenceCopy(
  env: Env, record: Record<string, unknown>,
): Promise<BranchAnswer<{ applied: true }>> {
  const branch = requireBranch(env);
  const s = (k: string) => {
    const v = record[k];
    return v === undefined || v === null ? null : String(v);
  };
  const n = (k: string) => {
    const v = Number(record[k]);
    return Number.isFinite(v) ? v : null;
  };
  const pushedAt = s('pushed_at') || nowIso();
  await env.DB.prepare(
    `INSERT INTO branch_licence
       (id, licence_uid, licence_ref, legal_entity, brand_name, territory, status, seats_json,
        revenue_share_bps, token_split_bps, annual_fee_cents, currency, term_start, term_end,
        renewal_at, template_version, suspended_at, suspended_note, pushed_at, updated_at)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       licence_uid = excluded.licence_uid, licence_ref = excluded.licence_ref,
       legal_entity = excluded.legal_entity, brand_name = excluded.brand_name,
       territory = excluded.territory, status = excluded.status, seats_json = excluded.seats_json,
       revenue_share_bps = excluded.revenue_share_bps, token_split_bps = excluded.token_split_bps,
       annual_fee_cents = excluded.annual_fee_cents, currency = excluded.currency,
       term_start = excluded.term_start, term_end = excluded.term_end,
       renewal_at = excluded.renewal_at, template_version = excluded.template_version,
       suspended_at = excluded.suspended_at, suspended_note = excluded.suspended_note,
       pushed_at = excluded.pushed_at, updated_at = datetime('now')`,
  ).bind(
    s('licence_uid') ?? '', s('licence_ref'), s('legal_entity'), s('brand_name'),
    s('territory') ?? '', s('status') ?? 'active', s('seats_json'),
    n('revenue_share_bps'), n('token_split_bps'), n('annual_fee_cents'), s('currency'),
    s('term_start'), s('term_end'), s('renewal_at'), s('template_version'),
    s('suspended_at'), s('suspended_note'), pushedAt,
  ).run();
  return { applied: true, branch, as_of: pushedAt };
}

/* ------------------------------------------------------------------ *
 * H5 — what a branch can say about its own money (D111)               *
 * ------------------------------------------------------------------ */

export type StreamReport = {
  stream: string;
  gross_cents: number | null;
  currency: string;
  available: boolean;
  is_estimate?: boolean;
  estimate_basis?: string;
  reason?: string;
};

/**
 * What this branch billed in a period, per stream, with the unavailable ones
 * named rather than zeroed.
 *
 * THE HONEST ANSWER TODAY IS MOSTLY "CANNOT MEASURE", and that was worth
 * checking rather than assuming. Read against the schema on 2026-09-15:
 *
 *   subscriptions  `account_subscriptions` carries `plan`, `status`,
 *                  `period_end` and Stripe ids and NO AMOUNT. The charges live
 *                  in the Stripe API, read one customer at a time by
 *                  `/api/admin/billing/ltv`. There is no local charge ledger
 *                  to total a quarter from — on a branch any more than at HQ,
 *                  which is the same finding `admin_revenue.ts` already
 *                  records for the platform.
 *   licence_fees   A branch charges no onward licence fee in the product. The
 *                  annual fee flows the other way, from the branch to HQ, and
 *                  it is a term of the licence rather than something the
 *                  branch bills.
 *   token_margin   `ai_usage_logs.est_cost_usd` is a COST and is real. What
 *                  tokens were BILLED at is stored nowhere, so a margin cannot
 *                  be derived — only the cost reported, flagged as an estimate
 *                  with its basis, and never presented as invoiced.
 *
 * REPORTING THE COST AS `token_margin` WOULD BE A LIE, so it is not. The
 * stream is reported unavailable with the cost carried in `estimate_basis`,
 * which is the one shape that gives HQ the number it has without letting a
 * statement sum it as revenue.
 *
 * `engagement_invoices` is deliberately NOT read here even though it carries
 * `total_cents`: it is a partner billing a founder, not the branch billing
 * anyone. Summing it would report other people's trade as the subsidiary's.
 */
export async function branchRevenueSummary(
  env: Env, period: string,
): Promise<BranchAnswer<{ period: string; streams: StreamReport[] }>> {
  const code = branchOf(env);
  if (!code) throw new Error('revenueSummary is only live on a branch');

  // THE PERIOD IS VALIDATED HERE, NOT WHERE IT IS USED. `quarterBounds` throws
  // on a period it cannot parse, and the only call to it sits inside a
  // try/catch that turns any throw into "the usage log could not be read" — so
  // a nonsense period would have produced a plausible summary with a false
  // reason attached, and HQ would have drawn a statement over a window nobody
  // meant. Refusing up front is the only place the caller learns the truth.
  const bounds = quarterBounds(period);

  const streams: StreamReport[] = [
    {
      stream: 'subscriptions',
      gross_cents: null,
      currency: 'EUR',
      available: false,
      reason:
        'Subscription revenue is not totalled in this database. `account_subscriptions` records a '
        + 'plan and a status but no amount, and the charges live in the Stripe API. HQ can enter '
        + 'the figure on the statement; nothing here can derive it.',
    },
    {
      stream: 'licence_fees',
      gross_cents: null,
      currency: 'EUR',
      available: false,
      reason:
        'A subsidiary charges no onward licence fee in the product — the annual fee is a term of '
        + 'its own licence and flows to HQ, so there is nothing for this branch to report.',
    },
  ];

  // The one figure that IS measured, reported as a cost and named as one.
  try {
    const q = await env.DB.prepare(
      `SELECT COALESCE(SUM(est_cost_usd), 0) AS cost, COUNT(*) AS calls
         FROM ai_usage_logs WHERE datetime(created_at) >= datetime(?) AND datetime(created_at) < datetime(?)`,
    ).bind(...bounds).first<{ cost: number; calls: number }>();
    const costCents = Math.round((Number(q?.cost) || 0) * 100);
    streams.push({
      stream: 'token_margin',
      gross_cents: null,
      currency: 'USD',
      available: false,
      is_estimate: true,
      estimate_basis:
        `Inference COST for the period was USD ${(costCents / 100).toFixed(2)} over `
        + `${Number(q?.calls) || 0} calls (ai_usage_logs.est_cost_usd).`,
      reason:
        'The margin on tokens cannot be derived: the cost is recorded and what tokens were billed '
        + 'at is not. The cost is carried in estimate_basis so HQ has the number it does have, '
        + 'without a statement summing a cost as revenue.',
    });
  } catch {
    streams.push({
      stream: 'token_margin',
      gross_cents: null,
      currency: 'USD',
      available: false,
      reason: 'The AI usage log could not be read on this branch.',
    });
  }

  return { branch: code, as_of: new Date().toISOString(), period: String(period), streams };
}

/** The half-open [start, end) ISO bounds of a 'YYYY-Qn' period. */
function quarterBounds(period: string): [string, string] {
  const m = /^(\d{4})-Q([1-4])$/.exec(String(period || '').trim());
  if (!m) throw new Error(`revenueSummary: ${JSON.stringify(period)} is not a period (YYYY-Qn)`);
  const y = Number(m[1]);
  const q = Number(m[2]) - 1;
  return [
    new Date(Date.UTC(y, q * 3, 1)).toISOString(),
    new Date(Date.UTC(y, q * 3 + 3, 1)).toISOString(),
  ];
}

/**
 * Store the promo ceiling HQ pushed, as a dated copy (migration 256).
 *
 * `issued_cents` IS LEFT ALONE. The branch owns that figure — it issues the
 * codes — and a push that reset it to HQ's last-known value would erase the
 * branch's own count every time HQ changed the ceiling.
 */
export async function applyPromoCeiling(
  env: Env, c: { period: string; ceiling_cents: number; currency: string; pushed_at: string },
): Promise<{ ok: true }> {
  if (!branchOf(env)) throw new Error('applyPromoCeiling is only live on a branch');
  await env.DB.prepare(
    `INSERT INTO branch_promo_ceiling (id, period, ceiling_cents, currency, pushed_at, updated_at)
     VALUES (1, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       period = excluded.period, ceiling_cents = excluded.ceiling_cents,
       currency = excluded.currency, pushed_at = excluded.pushed_at,
       updated_at = excluded.updated_at`,
  ).bind(
    String(c.period), Math.trunc(Number(c.ceiling_cents) || 0),
    String(c.currency || 'EUR').toUpperCase().slice(0, 3),
    String(c.pushed_at), new Date().toISOString(),
  ).run();
  return { ok: true };
}

/* ------------------------------------------------------------------ *
 * The branch's own escalation lane (D112)                             *
 * ------------------------------------------------------------------ */

export type BranchEscalationRow = {
  id: number;
  hq_uid: string | null;
  kind: string;
  subject: string;
  subject_ref: string | null;
  detail: string | null;
  raised_by_name: string | null;
  status: string;
  delivery_error: string | null;
  due_at: string | null;
  answer: string | null;
  answered_by_name: string | null;
  answered_at: string | null;
  pushed_at: string | null;
  created_at: string;
};

/**
 * Store HQ's decision on an escalation this branch raised (migration 261).
 *
 * MATCHED ON `hq_uid`, WHICH IS HQ'S OWN. The branch's row id means nothing at
 * HQ, so a push keyed on it would be a push into a row number that happens to
 * exist here — on the wrong escalation, silently. A push for a uid this branch
 * has no row for is reported rather than inserted: a branch inventing a local
 * row from a push would show an escalation nobody here raised.
 *
 * `pushed_at` IS HQ'S STAMP, not this database's write time, so "as of" never
 * gets younger than the decision it reports (migration 256's rule).
 */
export async function applyEscalationAnswer(
  env: Env,
  a: {
    hq_uid: string; answer: string; answered_by_name: string;
    answered_at: string; status: string; pushed_at: string;
  },
): Promise<{ ok: boolean; reason?: string }> {
  if (!branchOf(env)) throw new Error('applyEscalationAnswer is only live on a branch');

  const uid = String(a?.hq_uid ?? '').trim();
  if (!uid) throw new Error('applyEscalationAnswer: hq_uid is required');

  const res = await env.DB.prepare(
    `UPDATE branch_escalations
        SET answer = ?, answered_by_name = ?, answered_at = ?, status = ?,
            pushed_at = ?, updated_at = ?
      WHERE hq_uid = ?`,
  ).bind(
    String(a.answer ?? '').slice(0, 4000),
    String(a.answered_by_name ?? '').slice(0, 200) || null,
    String(a.answered_at ?? ''),
    // HQ's vocabulary is wider than the branch's — 'declined' and 'withdrawn'
    // are both decided as far as this lane is concerned, and inventing two more
    // local states would mean the CHECK constraint and HQ's list drifting.
    String(a.status ?? '') === 'open' ? 'open' : 'answered',
    String(a.pushed_at ?? ''), nowIso(), uid,
  ).run();

  const changed = Number((res as { meta?: { changes?: number } })?.meta?.changes ?? 0);
  if (!changed) {
    return {
      ok: false,
      reason: `This branch has no escalation with HQ uid ${uid}, so there is nothing to answer. `
        + 'The row is not created from the push: a local row invented here would show an '
        + 'escalation nobody at this branch raised.',
    };
  }
  return { ok: true };
}

/** S3's To-HQ lane: what this branch raised, newest first, with the SLA band. */
export async function branchEscalations(
  env: Env, limit = 50,
): Promise<BranchAnswer<{ items: Array<BranchEscalationRow & { sla: 'ok' | 'due_soon' | 'past' }> }>> {
  const code = requireBranch(env);
  const cap = Math.max(1, Math.min(200, Number(limit) || 50));
  const rows = await env.DB.prepare(
    `SELECT id, hq_uid, kind, subject, subject_ref, detail, raised_by_name, status,
            delivery_error, due_at, answer, answered_by_name, answered_at, pushed_at, created_at
       FROM branch_escalations ORDER BY created_at DESC LIMIT ?`,
  ).bind(cap).all<BranchEscalationRow>();

  const now = Date.now();
  return {
    branch: code,
    as_of: nowIso(),
    // THE SAME BAND FUNCTION HQ USES, imported rather than restated — two
    // definitions of "past SLA" is how the two tiers come to disagree about
    // which items are late.
    items: (rows.results || []).map((r) => ({ ...r, sla: slaBand(r.due_at, now) })),
  };
}

/* ------------------------------------------------------------------ *
 * The cross-host support session (D120)                               *
 * ------------------------------------------------------------------ */

/**
 * Verify that the caller really is HQ.
 *
 * THIS IS THE ONE AUTHENTICATED THING ON `HqEntrypoint`, AND IT HAD TO BE. Read
 * `rpc/index.ts`'s header: *"An entrypoint is callable by any Worker in the
 * account."* For `health`, `overview` and the `apply*` pushes that is tolerable
 * — the worst a rogue Worker in our own account achieves is reading branch data
 * or overwriting a licence copy with another licence copy. Opening a session as
 * an arbitrary user is a different kind of thing entirely, so it does not get
 * to rely on the same assumption.
 *
 * THE MIRROR IMAGE OF `authenticateBranch`, AND SET UP THE SAME WAY.
 * `branch-provision.yml` generates `HQ_RPC_SECRET` once, puts the plaintext on
 * HQ and the digest on the branch as `HQ_RPC_SECRET_HASH`. Both halves are
 * written by the same run, which is the point: pushing the hash over
 * `applyLicence` at runtime would mean using the unauthenticated channel to
 * establish the authentication for it.
 *
 * A BRANCH WITH NO HASH REFUSES. Same default as the other direction and for
 * the same reason — a null means nobody has provisioned this leg, which is
 * exactly when a default-open turns the control off on the deployments nobody
 * has audited.
 *
 * WHAT IT DOES NOT ESTABLISH, stated because the gap is the whole design: the
 * secret proves the call came from HQ's Worker. It proves nothing about the
 * person. `requireFactor(c,'totp')`, `requireStepUp(c)` and `requireAdmin(c)`
 * are facts about an HQ operator's browser session, and a branch cannot see a
 * session on another host at all. HQ's own route runs all three BEFORE it
 * reaches the binding; the branch's trust in that is exactly what this secret
 * buys, and nothing more.
 */
export async function authenticateHq(env: Env, secret: string): Promise<string> {
  const code = requireBranch(env);
  const verdict = await verifySecret(secret, env.HQ_RPC_SECRET_HASH);
  if (verdict === 'no_hash') {
    throw new Error(
      `rpc: ${code} has no HQ_RPC_SECRET_HASH, so a call claiming to be HQ cannot be verified. `
      + 'Re-run branch-provision.yml for this code, or set the hash from the HQ_RPC_SECRET the '
      + 'provisioning run generated.',
    );
  }
  if (verdict === 'no_secret') throw new Error('rpc: HQ presented no secret');
  if (verdict !== 'ok') throw new Error('rpc: HQ presented the wrong secret');
  return code;
}

/** Minutes a support session lasts, and the window to redeem the code. */
export const SUPPORT_SESSION_MINUTES = 30;
export const SUPPORT_CODE_TTL_MINUTES = 5;
/** The one reason length, enforced at HQ and again here. */
export const SUPPORT_REASON_MIN = 10;

export type SupportSessionRequest = {
  hq_actor_name: string;
  /** HQ's own user id, carried as OPAQUE TEXT for HQ's audit trail. Never joined. */
  hq_actor_ref?: string | null;
  target_user_id: number;
  reason: string;
};

export type SupportSessionOffer = {
  code: string;
  expires_at: string;
  redeem_path: string;
  target: { id: number; name: string | null; email: string | null; role: string };
};

/** 48 hex characters from the CSPRNG — the code IS the credential for its window. */
function newHandoffCode(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Authorise HQ to open a support session on this branch, and hand back a
 * one-time code.
 *
 * NAMED FOR WHAT IT DOES. Plan F.5 called this `mintSupportSession`; it does
 * not mint a session. The JWT is created at redeem (see `redeemSupportCode`),
 * which buys two things worth the rename: no bearer credential is ever stored
 * at rest, and the 30-minute clock starts when the operator actually begins
 * rather than when HQ pressed a button and walked away.
 *
 * THE THREE RULES THE BRANCH CAN ACTUALLY CHECK, and they are checked here
 * rather than trusted from HQ — not because HQ is suspected, but because a
 * caller-side-only rule is a convention and this side is where the row gets
 * written:
 *   1. the reason, >= 10 characters, the same bar `admin.ts` sets locally;
 *   2. the target exists on THIS branch and is active;
 *   3. the target is not carrying a `super_admins` row.
 *
 * WHY (3) READS THE TABLE DIRECTLY INSTEAD OF ASKING `isSuperAdmin`. On a
 * branch `hydrateSuperAdmin` returns 0 unconditionally and never queries
 * (D106) — that one line is what closes HQ's console on a subsidiary. So a
 * holder-vs-holder check written the way `admin.ts:1471` writes it would be a
 * branch that can never fire: it would read 0 for every target, including the
 * one case worth catching. `loadSuperAdminFlag` asks the table, so the guard is
 * real. And the case IS worth catching: D106's own header says one
 * `INSERT INTO super_admins` on a branch database is the escalation the
 * deployment-level refusal exists to survive. A row there means something is
 * wrong with this database; opening a session as that account is not the move.
 *
 * THE OTHER HALF OF `admin.ts`'s HOLDER RULE DOES NOT TRANSFER, and pretending
 * it did would be the misleading kind of thoroughness. At HQ the rule is "only
 * a Super Admin may impersonate a Super Admin", which exists because a plain
 * admin borrowing the franchisor's account is an escalation. Across this
 * boundary there is nobody above HQ to escalate to — supporting a branch's own
 * administrator is the ordinary case, not a privilege grab.
 */
export async function openSupportSession(
  env: Env, secret: string, req: SupportSessionRequest,
): Promise<BranchAnswer<SupportSessionOffer>> {
  const branch = await authenticateHq(env, secret);

  const reason = String(req?.reason ?? '').trim().slice(0, 200);
  if (reason.length < SUPPORT_REASON_MIN) {
    throw new Error(
      `rpc: a support session needs a reason of at least ${SUPPORT_REASON_MIN} characters, `
      + 'recorded against the session on both sides.',
    );
  }
  const actor = String(req?.hq_actor_name ?? '').trim().slice(0, 200);
  if (!actor) throw new Error('rpc: a support session needs the name of the HQ operator opening it');

  const targetId = Number(req?.target_user_id);
  if (!Number.isInteger(targetId) || targetId <= 0) {
    throw new Error('rpc: a support session needs the id of an account on this branch');
  }
  const target = await env.DB.prepare(
    'SELECT id, name, email, role, is_active FROM users WHERE id = ?',
  ).bind(targetId).first<{ id: number; name: string | null; email: string | null; role: string; is_active: number }>();
  if (!target) throw new Error(`rpc: ${branch} holds no account with id ${targetId}`);
  if (Number(target.is_active ?? 1) === 0) {
    throw new Error(`rpc: account ${targetId} is deactivated on ${branch}, so a session cannot be opened as it`);
  }

  if (await loadSuperAdminFlag(env, targetId)) {
    throw new Error(
      `rpc: account ${targetId} carries a super_admins row on ${branch}. A branch database is `
      + 'bootstrapped past migration 207 and should have none (D106), so this is a state to '
      + 'investigate rather than a session to open.',
    );
  }

  const code = newHandoffCode();
  // THE EXPIRY IS COMPUTED BY SQLITE, NOT BY JAVASCRIPT, AND THIS IS A
  // CORRECTNESS FIX RATHER THAN A STYLE CHOICE. `new Date().toISOString()`
  // produces `2026-09-16T06:55:57.859Z`; `CURRENT_TIMESTAMP` produces
  // `2026-09-16 07:00:57`. Compared as TEXT — which is all SQLite does — the
  // date halves match and position 10 decides it: 'T' (0x54) beats ' ' (0x20),
  // so an ISO string is GREATER than the current timestamp whatever time it
  // carries. Verified rather than reasoned about: a value five minutes past
  // still answered 1 for `e > CURRENT_TIMESTAMP`. A TTL written that way does
  // not expire until the UTC date rolls over.
  //
  // So both sides come from one clock in one format: `datetime('now', …)` here
  // and `expires_at > datetime('now')` at redeem. `RETURNING` hands back the
  // value that was actually stored, so what HQ shows is what the branch will
  // enforce rather than a second computation of the same intent.
  const row = await env.DB.prepare(
    `INSERT INTO support_handoff_codes
       (code_hash, target_user_id, hq_actor_name, hq_actor_ref, reason, expires_at)
     VALUES (?, ?, ?, ?, ?, datetime('now', ?))
     RETURNING expires_at`,
  ).bind(
    await sha256Hex(code), targetId, actor,
    req?.hq_actor_ref == null ? null : String(req.hq_actor_ref).slice(0, 64),
    reason, `+${SUPPORT_CODE_TTL_MINUTES} minutes`,
  ).first<{ expires_at: string }>();
  const expiresAt = row?.expires_at ?? '';

  // The branch's own audit row for the AUTHORISATION. The session itself gets
  // its own row at redeem — the two are different events and an operator who
  // asked for a code and never used it should be visible as exactly that.
  try {
    await env.DB.prepare(
      `INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?, ?, ?, ?)`,
    ).bind(
      'hq_support_authorised',
      JSON.stringify({ hq_actor_name: actor, reason, expires_at: expiresAt, branch }),
      `hq:${actor}`.slice(0, 200),
      targetId,
    ).run();
  } catch (e) {
    console.warn('[rpc:openSupportSession] audit row failed', (e as Error).message);
  }

  return {
    code,
    expires_at: expiresAt,
    // The PATH, not a URL. The branch knows its own hostname from APP_URL, but
    // HQ is the side that has to open the browser and already holds the
    // registry entry — so it builds the link, and there is one place that does.
    //
    // `/support/session`, NOT `/support`: the bare path is already the SPA's
    // help-centre redirect, so a link there would lose the code to /help.
    redeem_path: `/support/session?code=${code}`,
    target: { id: target.id, name: target.name, email: target.email, role: target.role },
    branch,
    as_of: nowIso(),
  };
}

export type RedeemedSupportSession = {
  token: string;
  jti: string;
  expires_at: string;
  reason: string;
  hq_actor_name: string;
  target: { id: number; name: string | null; email: string | null; role: string };
};

/**
 * Swap a one-time code for a session, or refuse.
 *
 * THE CLAIM IS ONE ATOMIC STATEMENT, on the `magic/verify` precedent
 * (`routes/auth.ts:1261`): the `UPDATE … WHERE used_at IS NULL AND expires_at >
 * CURRENT_TIMESTAMP RETURNING …` both consumes the code and tells us whether we
 * were the one who consumed it. A read-then-write would leave a window in which
 * two redeems of the same code both pass, which for a session-minting endpoint
 * is the whole control.
 *
 * `factor = 'hq_support'` IS A REAL GATE, NOT A LABEL. `requireFactor` reads
 * `user_sessions.factor` by jti and fails closed (`auth.ts:708-730`), so a
 * support session satisfies `requireFactor(c,'totp')` nowhere — every branch
 * route behind TOTP or a step-up stays shut to HQ. That is the property worth
 * having, and it costs one column value because the mechanism already exists.
 *
 * NO `impersonated_by` CLAIM, AND THIS IS DELIBERATE. `createJWT` would happily
 * carry one, but the only id HQ could put there is an HQ user id, and
 * `admin_escalations.ts:77-80` already states the rule for this boundary: the
 * two id spaces are unrelated, so an id sent across names whoever holds it
 * locally. Every consumer of the claim was checked rather than assumed —
 * `pickAuthToken` (precedence, and the redeem route clears the jar so there is
 * never a second candidate), `selectJwt`'s audit blob, and
 * `recoveryCoolOff`, which keys off the impersonated user and never reads it.
 * None of them needs a resolvable id, and none of them would be improved by a
 * wrong one. The session's identity as a support session lives in
 * `user_sessions.factor` and its `impersonation_sessions` row, both of which
 * are local and both of which are read.
 */
export async function redeemSupportCode(
  env: Env, code: string,
): Promise<RedeemedSupportSession> {
  const branch = requireBranch(env);
  const presented = String(code ?? '').trim();
  if (!presented) throw new Error('support: no code was presented');

  const claimed = await env.DB.prepare(
    // `datetime('now')`, matching how `expires_at` was written — see the note in
    // `openSupportSession`. Comparing against `CURRENT_TIMESTAMP` would be the
    // same string comparison with a different format on each side, and an
    // expired code would read as live until the UTC date changed.
    `UPDATE support_handoff_codes SET used_at = datetime('now')
       WHERE code_hash = ? AND used_at IS NULL AND expires_at > datetime('now')
       RETURNING target_user_id, hq_actor_name, reason`,
  ).bind(await sha256Hex(presented)).first<{
    target_user_id: number; hq_actor_name: string; reason: string;
  }>();
  // ONE MESSAGE FOR ALL THREE FAILURES — unknown, already used, expired. Telling
  // them apart would tell an unauthenticated caller which codes have existed.
  if (!claimed) throw new Error('support: this link is not valid. Ask HQ to start a new support session.');

  const target = await env.DB.prepare(
    'SELECT id, name, email, role, is_active FROM users WHERE id = ?',
  ).bind(claimed.target_user_id).first<{
    id: number; name: string | null; email: string | null; role: string; is_active: number;
  }>();
  // Re-checked at redeem, not only at authorisation: the account can be
  // deactivated in the minutes between, and the code would still be unused.
  if (!target || Number(target.is_active ?? 1) === 0) {
    throw new Error('support: that account is no longer active on this branch.');
  }

  const jti = crypto.randomUUID();
  const token = await createJWT(
    env, target.id, String(target.email ?? ''), target.role, undefined, jti,
    `${SUPPORT_SESSION_MINUTES}m`,
  );
  const expiresAt = new Date(Date.now() + SUPPORT_SESSION_MINUTES * 60_000).toISOString();

  try {
    await env.DB.prepare(
      `INSERT INTO user_sessions (user_id, jti, factor, assurance_level) VALUES (?, ?, 'hq_support', 'hq_support')`,
    ).bind(target.id, jti).run();
  } catch (e) {
    console.warn('[rpc:redeemSupportCode] session row failed', (e as Error).message);
  }

  try {
    const { ensureCohortTimingSchema } = await import('../services/cohortTiming');
    await ensureCohortTimingSchema(env);
    await env.DB.prepare(
      `INSERT INTO impersonation_sessions (admin_user_id, target_user_id, context) VALUES (?, ?, ?)`,
    ).bind(
      // ZERO, DELIBERATELY. The column is NOT NULL with no foreign key, and no
      // user in THIS database opened this session. A real HQ id here would be
      // joinable to a local `users` row and would name the wrong person with
      // complete confidence; 0 matches nobody, because AUTOINCREMENT starts at
      // 1. The actor travels as a name, in `context`, where it cannot be joined.
      0, target.id,
      `hq_support:${claimed.hq_actor_name}|${claimed.reason}`.slice(0, 500),
    ).run();
  } catch (e) {
    console.warn('[rpc:redeemSupportCode] impersonation row failed', (e as Error).message);
  }

  try {
    await env.DB.prepare(
      `INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?, ?, ?, ?)`,
    ).bind(
      'hq_support_session_opened',
      JSON.stringify({
        hq_actor_name: claimed.hq_actor_name, reason: claimed.reason, branch, expires_at: expiresAt,
      }),
      `hq:${claimed.hq_actor_name}`.slice(0, 200),
      target.id,
    ).run();
  } catch (e) {
    console.warn('[rpc:redeemSupportCode] audit row failed', (e as Error).message);
  }

  return {
    token,
    jti,
    expires_at: expiresAt,
    reason: claimed.reason,
    hq_actor_name: claimed.hq_actor_name,
    target: { id: target.id, name: target.name, email: target.email, role: target.role },
  };
}

/* ------------------------------------------------------------------ *
 * D.6 — moving an account between branches (D121)                     *
 * ------------------------------------------------------------------ */

/**
 * WHAT A "MOVE" IS HERE, AND WHAT IT DELIBERATELY IS NOT. D.6 chose re-invite
 * over record migration: the account is closed where it lives and invited on
 * the destination, and **projects, deals and documents stay where they were**,
 * readable by HQ. The two databases cannot see each other (D.2), so a true
 * migration means copying rows across a boundary and rewriting every reference
 * on both sides. A half-done one — some rows moved, some left, foreign keys
 * pointing into a database that is not bound — is worse than none, and that is
 * the reason the decision reads the way it does rather than a limitation being
 * worked around.
 *
 * SO THE TWO HALVES ARE INDEPENDENT, and the route reports them separately
 * (the D111 precedent `admin_escalations.ts` follows for the same reason). The
 * source deactivation is a completed fact whether or not the destination is
 * reachable; collapsing them into one outcome would make an unreachable
 * destination look like a move that never happened, and an operator would do it
 * again — against an account that is already closed.
 *
 * BOTH METHODS AUTHENTICATE. One deactivates an account and the other creates
 * an invitation to one; each is at least as privileged as `openSupportSession`.
 * An unauthenticated `HqEntrypoint` method that deactivates accounts would be
 * exactly the hole D120 closed, reopened one PR later.
 */

/** How long a moved-account invitation stays open. */
export const INVITATION_TTL_DAYS = 14;
/** The one reason length, shared with the support session (D120). */
export const MOVE_REASON_MIN = SUPPORT_REASON_MIN;

const newInvitationUid = () => `inv_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;

export type MoveOutRequest = {
  hq_actor_name: string;
  target_user_id: number;
  reason: string;
  /** The branch the account is moving TO, for the target's own audit line. */
  destination_code: string;
};

export type MoveOutResult = BranchAnswer<{
  moved_out: true;
  target: { id: number; name: string | null; email: string | null; role: string };
}>;

/**
 * Close an account on this branch because it is moving to another one.
 *
 * NOT `toggle-active`. `admin.ts`'s existing deactivation writes the right two
 * audit rows — one for the actor, one addressed to the person — but carries no
 * reason, and D.6 requires one. The reason is the field that makes the record
 * answer the question it exists to answer; the same argument `admin.ts` makes
 * for the support session's own reason, which is why this does not simply call
 * through to it.
 *
 * AND THE PERSON IS TOLD WHERE THEY ARE GOING. An account told only that it was
 * deactivated has been told something true and useless — worse, something
 * misleading, because it reads as a suspension. Their row names the destination.
 */
export async function moveAccountOut(
  env: Env, secret: string, req: MoveOutRequest,
): Promise<MoveOutResult> {
  const branch = await authenticateHq(env, secret);

  const reason = String(req?.reason ?? '').trim().slice(0, 300);
  if (reason.length < MOVE_REASON_MIN) {
    throw new Error(
      `rpc: moving an account needs a reason of at least ${MOVE_REASON_MIN} characters, `
      + 'recorded on both sides.',
    );
  }
  const actor = String(req?.hq_actor_name ?? '').trim().slice(0, 200);
  if (!actor) throw new Error('rpc: moving an account needs the name of the HQ operator doing it');

  const destination = String(req?.destination_code ?? '').trim().toLowerCase();
  if (!BRANCH_CODE_RE.test(destination)) {
    throw new Error('rpc: a move needs a valid destination branch code');
  }
  if (destination === branch) {
    throw new Error(`rpc: ${branch} is already where this account lives, so there is nothing to move`);
  }

  const targetId = Number(req?.target_user_id);
  if (!Number.isInteger(targetId) || targetId <= 0) {
    throw new Error('rpc: a move needs the id of an account on this branch');
  }
  const target = await env.DB.prepare(
    'SELECT id, name, email, role, is_active FROM users WHERE id = ?',
  ).bind(targetId).first<{ id: number; name: string | null; email: string | null; role: string; is_active: number }>();
  if (!target) throw new Error(`rpc: ${branch} holds no account with id ${targetId}`);
  // ALREADY INACTIVE IS A REFUSAL, NOT A NO-OP. A second move of the same
  // account would write a second invitation on the destination and a second
  // pair of audit rows, for a person who left the first time — so the state is
  // reported rather than silently re-applied.
  if (Number(target.is_active ?? 1) === 0) {
    throw new Error(
      `rpc: account ${targetId} is already deactivated on ${branch}. If a previous move did not `
      + 'finish, invite them on the destination rather than moving them out again.',
    );
  }

  await env.DB.prepare('UPDATE users SET is_active = 0 WHERE id = ?').bind(targetId).run();

  // TWO ROWS, the shape `admin.ts:1770-1771` already uses: one for what the
  // operator did, one addressed to the person it happened to.
  const detail = `Moved to ${destination} by ${actor}: ${reason}`;
  try {
    await env.DB.prepare(
      `INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?, ?, ?, ?)`,
    ).bind('hq_account_moved_out', detail, `hq:${actor}`.slice(0, 200), targetId).run();
    await env.DB.prepare(
      `INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?, ?, ?, ?)`,
    ).bind(
      'account_status_changed',
      `Your account here was closed because it is moving to ${destination}. `
      + 'Your projects, deals and documents stay with this branch.',
      `hq:${actor}`.slice(0, 200), targetId,
    ).run();
  } catch (e) {
    console.warn('[rpc:moveAccountOut] audit rows failed', (e as Error).message);
  }

  return {
    moved_out: true,
    target: { id: target.id, name: target.name, email: target.email, role: target.role },
    branch,
    as_of: nowIso(),
  };
}

export type InviteRequest = {
  hq_actor_name: string;
  email: string;
  name?: string | null;
  role?: string | null;
  /** Where they are arriving from, so the destination sees a move, not an application. */
  moved_from_code?: string | null;
  reason?: string | null;
};

export type InviteResult = BranchAnswer<{
  uid: string;
  email: string;
  expires_at: string;
  /** What the mailer actually did. See migration 263 and `company_invitations`. */
  email_sent: boolean;
  email_reason?: string;
  /**
   * The invitation link, AND ONLY WHEN THE MESSAGE DID NOT LEAVE.
   *
   * Telling an operator to "pass the link on by hand" while never showing it
   * to them is a dead end dressed as guidance — the first version of this did
   * exactly that. So the link travels, narrowly: to an authenticated
   * super-admin, over the private binding, only on the path where the person
   * cannot otherwise be reached. On the happy path it is omitted entirely,
   * because then it is in the one place it belongs, which is their inbox.
   */
  invite_link?: string;
}>;

/**
 * Invite an email onto this branch (migration 263).
 *
 * `email_sent` IS REPORTED, NEVER ASSUMED. Every sender in `services/email.ts`
 * returns `false` when the Gmail credentials are unset rather than throwing, and
 * a branch that has not had its mail configured is a real and likely state
 * during provisioning. An invitation nobody was told about is a different thing
 * from one that is merely unanswered — migration 236 says exactly that, and HQ
 * needs to see which so it can pass the link on by hand.
 */
export async function inviteAccount(
  env: Env, secret: string, req: InviteRequest,
): Promise<InviteResult> {
  const branch = await authenticateHq(env, secret);

  const actor = String(req?.hq_actor_name ?? '').trim().slice(0, 200);
  if (!actor) throw new Error('rpc: an invitation needs the name of the HQ operator sending it');

  // Normalised HERE as well as at the caller, because this is the side that
  // writes the row the unique index and the accept-time match both read.
  const email = String(req?.email ?? '').trim().toLowerCase().slice(0, 320);
  if (!email || !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) {
    throw new Error('rpc: an invitation needs a valid email address');
  }

  const existing = await env.DB.prepare(
    'SELECT id FROM users WHERE email = ? AND is_active = 1',
  ).bind(email).first<{ id: number }>();
  if (existing) {
    throw new Error(`rpc: ${email} already has an active account on ${branch}`);
  }

  // PREFIXED SO IT CANNOT BE MISTAKEN FOR ITS OWN DIGEST. Two UUIDs with the
  // dashes stripped are exactly 64 hex characters — the same shape a SHA-256
  // hex digest has — so a bug that stored the raw token instead of the hash
  // would look completely correct in the table AND pass any assertion that
  // checked the column's shape. That is not hypothetical: the first version
  // of this code was mutated to store the raw token and the test could not
  // tell. The prefix makes the two distinguishable at a glance and in an
  // assertion, and costs nothing.
  const rawToken = `invt_${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '');
  const uid = newInvitationUid();
  const row = await env.DB.prepare(
    `INSERT INTO branch_invitations
       (uid, email, name, role, token_hash, moved_from_code, reason, invited_by_name, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?))
     RETURNING expires_at`,
  ).bind(
    uid, email,
    req?.name == null ? null : String(req.name).slice(0, 200),
    String(req?.role ?? 'exploring').slice(0, 40),
    await sha256Hex(rawToken),
    req?.moved_from_code == null ? null : String(req.moved_from_code).trim().toLowerCase().slice(0, 32),
    req?.reason == null ? null : String(req.reason).slice(0, 300),
    actor,
    `+${INVITATION_TTL_DAYS} days`,
  ).first<{ expires_at: string }>();

  const base = String(env.APP_URL || '').replace(/\/+$/, '');
  const link = `${base}/invite/${rawToken}`;

  let sent = false;
  let emailReason: string | undefined;
  try {
    const { sendCompanyInvitationEmail } = await import('../services/email');
    sent = await sendCompanyInvitationEmail(
      env, email, String(env.BRANCH_NAME || branch), actor, link,
    );
    if (!sent) {
      emailReason = 'This branch has no mail sender configured, so the invitation exists and '
        + 'nobody has been told about it. Pass the link on by hand, or set the mail credentials.';
    }
  } catch (e) {
    emailReason = `The invitation was stored and the message failed to send: ${(e as Error).message}`;
    console.warn('[rpc:inviteAccount] send failed', (e as Error).message);
  }

  try {
    await env.DB.prepare('UPDATE branch_invitations SET email_sent = ?, updated_at = ? WHERE uid = ?')
      .bind(sent ? 1 : 0, nowIso(), uid).run();
    await env.DB.prepare(
      `INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?, ?, ?, NULL)`,
    ).bind(
      'hq_account_invited',
      JSON.stringify({ uid, branch, moved_from: req?.moved_from_code ?? null, email_sent: sent }),
      `hq:${actor}`.slice(0, 200),
    ).run();
  } catch (e) {
    console.warn('[rpc:inviteAccount] post-send write failed', (e as Error).message);
  }

  return {
    uid,
    email,
    expires_at: row?.expires_at ?? '',
    email_sent: sent,
    ...(emailReason ? { email_reason: emailReason } : {}),
    ...(sent ? {} : { invite_link: link }),
    branch,
    as_of: nowIso(),
  };
}
