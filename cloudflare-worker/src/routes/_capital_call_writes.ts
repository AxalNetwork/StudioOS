/**
 * The one place that decides what a capital-call row looks like.
 *
 * WHY THIS FILE EXISTS. Task #197: `capital_call_notice` — the job a GP's "New
 * call" enqueues — wrote an `activity_logs` line per LP and bumped
 * `vc_funds.deployed_capital`, and never wrote a `capital_calls` row. The live
 * screen reads that table through `api.listCapitalCalls()`
 * (`CapitalPage.jsx`) and carries a working Pay button
 * over it, so the call existed as a log line and a moved dashboard number while
 * the receivable — who owes what, by when, paid or not — existed nowhere.
 *
 * Giving the job its own INSERT would have made a third writer of this table.
 * `routes/capital.ts` already had two, and they already disagreed: `POST
 * /capital/calls` binds `(limited_partner_id, project_id, amount, due_date)`,
 * while `POST /capital/capitalCall` binds only `(limited_partner_id,
 * project_id, amount)` and never sets a due date. Neither supplies `uid`, so
 * the column's `lower(hex(randomblob(16)))` default mints one. A third copy
 * would have been a third set of defaults to keep in step.
 *
 * The usual argument for extracting — *an automated path must call the function
 * the manual form already calls* — does not quite apply here, and saying so is
 * more useful than implying it does: `api.createCapitalCallV2()` has no caller
 * anywhere in the SPA, so there is no reachable manual form to match. The
 * weaker reason is sufficient. One writer cannot drift from itself.
 *
 * THE SHAPE IS THE ONE PRODUCTION HAS, which needs saying because there are two.
 * `routes/legalcap.ts` writes `capital_calls` as `(deal_id, syndicate_id,
 * amount_cents, currency, …)` against its own `ensureSchema`, and no migration
 * ever added those columns — the baseline has only the LP shape below, so
 * legalcap's path is the dead one. Recorded in
 * `scripts/sqlite-table-collisions-baseline.json`; reconciling the two is its
 * own task. Everything here is the LP shape:
 *
 *   uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16))))
 *   limited_partner_id, lp_investor_id, project_id
 *   amount REAL NOT NULL          -- DOLLARS, not cents. See below.
 *   status TEXT NOT NULL DEFAULT 'pending'
 *   due_date, paid_date, created_at
 *
 * DOLLARS, NOT CENTS, and this is the one unit trap in the neighbourhood. The
 * route that issues a fund-wide call takes `amount_cents`; `capital_calls.amount`
 * is REAL dollars, as are `limited_partners.commitment_amount`, `.invested_amount`
 * and `vc_funds.total_commitment` (all four recorded REAL in
 * `scripts/money-cents-baseline.json`). Callers convert; this function does not
 * guess which it was handed.
 */
import type { Env } from '../types';

export interface CapitalCallInput {
  /** `limited_partners.id`. The canonical LP key; `lp_investor_id` is legacy. */
  limitedPartnerId: number;
  /** DOLLARS. See the header — the issuing route speaks cents and converts. */
  amount: number;
  projectId?: number | null;
  /**
   * The date the GP gave, or null.
   *
   * NEVER DEFAULTED HERE. A capital call's due date is a deadline an LP acts on,
   * and inventing one would put a date with legal weight on a record nobody
   * typed. `legalcap.ts` defaults its auto-generated call to `+30 days`; that is
   * its choice and not copied. A row with no due date reads as "no due date
   * recorded", which is true.
   */
  dueDate?: string | null;
  /**
   * An explicit uid, which turns the insert into `INSERT OR IGNORE` and makes it
   * safe to repeat.
   *
   * THIS IS THE WHOLE IDEMPOTENCY MECHANISM for the queue job, so it is worth
   * stating what it must NOT be derived from. `job.id` is unusable: the CF Queue
   * consumer calls `handleJob` with a hardcoded `id: 0`, so every
   * queue-delivered call would produce the same uid and the SECOND fund's real
   * call would be silently ignored — a worse bug than the missing row. The
   * delivery key is no good either, because the DLQ retry path deliberately
   * mints a fresh one. It has to identify the CALL, which is why the enqueueing
   * route mints a `call_uid` into the payload.
   *
   * Omit it and the column's own default applies, which is what the two existing
   * routes get and what they had before this file existed.
   */
  uid?: string | null;
}

export interface CapitalCallWrite {
  /** False when an explicit `uid` was already present — the repeat case. */
  inserted: boolean;
  /** The row as stored, or null when the insert was ignored. */
  row: any | null;
}

/**
 * Reject the values that can only be a bug, and leave the rest alone.
 *
 * 0 IS ALLOWED, DELIBERATELY. Both existing routes accept it today — `POST
 * /capital/capitalCall` computes a per-investor share that is 0 when the call
 * amount is — and an extraction that started rejecting it would be a behaviour
 * change wearing a refactor's clothes. Callers that should not write a
 * zero-dollar receivable filter before they get here; the queue job does.
 */
function toAmount(raw: unknown): number {
  // COERCED, NOT TYPE-CHECKED, and that is not laziness. `POST /capital/calls`
  // binds `data.amount` straight from a JSON body, so a caller sending "250"
  // works today — the column is REAL and SQLite coerces. A guard written as
  // `Number.isFinite(input.amount)` would reject that string and turn this
  // extraction into a behaviour change wearing a refactor's clothes.
  const amount = Number(raw);
  if (!Number.isFinite(amount)) throw new Error('capital call amount is not a finite number');
  if (amount < 0) throw new Error('capital call amount is negative');
  return amount;
}

/**
 * The statement for one capital call, unexecuted.
 *
 * EXPOSED SEPARATELY SO A CALLER CAN BATCH. `POST /capital/capitalCall` issues a
 * call to every active investor and batches the inserts into one D1 round-trip —
 * its own comment records that this replaced an N+1 — and the queue job needs
 * the same. A single-row-only helper would have quietly reintroduced the N+1 at
 * both sites.
 *
 * `RETURNING *` rides along because SQLite emits a row only for an insert that
 * actually happened, so a batch result's `results` length and its `meta.changes`
 * agree about which rows are new.
 */
export function capitalCallStatement(env: Env, input: CapitalCallInput) {
  const amount = toAmount(input.amount);
  const projectId = input.projectId ?? null;
  const dueDate = input.dueDate ?? null;
  if (input.uid) {
    return env.DB.prepare(
      `INSERT OR IGNORE INTO capital_calls (uid, limited_partner_id, project_id, amount, due_date)
       VALUES (?, ?, ?, ?, ?)
       RETURNING *`,
    ).bind(input.uid, input.limitedPartnerId, projectId, amount, dueDate);
  }
  return env.DB.prepare(
    `INSERT INTO capital_calls (limited_partner_id, project_id, amount, due_date)
     VALUES (?, ?, ?, ?)
     RETURNING *`,
  ).bind(input.limitedPartnerId, projectId, amount, dueDate);
}

/** One capital call, written now. */
export async function insertCapitalCall(env: Env, input: CapitalCallInput): Promise<CapitalCallWrite> {
  const row = await capitalCallStatement(env, input).first<any>();
  // An ignored INSERT returns no row, which is the signal — not an error.
  return { inserted: !!row, row: row ?? null };
}

/**
 * Many capital calls in one round-trip, reporting which ones were new.
 *
 * The return array is index-aligned with `inputs`, because the caller has to know
 * WHICH rows landed rather than how many: the job notifies exactly the LPs whose
 * row it just created, and counting alone cannot say who those are.
 */
export async function insertCapitalCalls(
  env: Env, inputs: CapitalCallInput[],
): Promise<CapitalCallWrite[]> {
  if (!inputs.length) return [];
  const results = await env.DB.batch<any>(inputs.map((i) => capitalCallStatement(env, i)));
  return results.map((r) => ({
    // `meta.changes` ALONE decides this, and the reason is a trap worth naming.
    // Real D1 returns `results` as well, so `!!r.results[0]` looks equivalent —
    // but the repo's own D1 test adapter models `batch` as a sequence of `run()`
    // calls (`cloudflare-worker/test/_d1_sqlite.mjs:90-94`), and `run()` carries
    // `meta` with no `results`. Keying on the returned row would report "nothing
    // was inserted" under test while inserting fine in production, which is the
    // worst direction for a money path to be wrong in. `meta.changes` is what
    // both provide, and it is what `claimDelivery` in `queue-consumer.ts`
    // already reads for exactly this kind of `INSERT OR IGNORE`.
    inserted: Number(r.meta?.changes ?? 0) > 0,
    row: (r.results || [])[0] ?? null,
  }));
}
