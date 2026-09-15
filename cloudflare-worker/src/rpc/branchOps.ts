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
import { branchOf } from '../util/branch';
import { PRE_VERDICT_STATUSES } from '../services/referralSubmissions';

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
         FROM ai_usage_logs WHERE created_at >= ? AND created_at < ?`,
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
