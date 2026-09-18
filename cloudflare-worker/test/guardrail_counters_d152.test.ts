/**
 * `loadGuardrailCounters` — what the platform records about its own AI
 * guardrails, and what it still does not (D152).
 *
 * WHY THIS FILE EXISTS. HQ's Security page rendered one sentence where these
 * figures belong: *"No guardrail-hit, flagged-output or token-anomaly counter
 * is stored for the AI rails."* Two of those three clauses were false, and the
 * verdict rollup was ALREADY on screen elsewhere — `AiUsageTab` draws it as
 * "Guardrail safety (llama-guard)". So a security desk denied a store the
 * platform was showing one click away.
 *
 * REAL SQL OVER A REAL DATABASE, NOT A TEXT-MATCHING STUB. Every assertion
 * here is about which rows a predicate selects: whether a block is counted as
 * a flag, whether a non-safety call pollutes the verdict denominator, whether
 * a row outside the window is excluded. A stub that matched on query text
 * would answer all of those from what it was taught rather than from the SQL,
 * which is the failure `_d1_sqlite.mjs`'s own header was written about.
 *
 * THE THREE THINGS IT IS EASIEST TO GET WRONG HERE, each with its own test:
 *
 *   1. AN UNREADABLE TABLE MUST NOT READ AS ZERO HITS. `advisor_turn_audit`
 *      is lazily bootstrapped (`ensureAuditSchema`), so its absence is a state
 *      this function can actually meet. "0 turns blocked" on a security page
 *      is the most reassuring possible way to be wrong — the #204 defect, on
 *      the worst surface for it.
 *   2. A RATE OVER AN EMPTY DENOMINATOR IS NOT 0%. `safe_rate` is null when
 *      nothing was evaluated, because "0% judged safe" and "the guard did not
 *      run" are opposite claims.
 *   3. A VERDICT AND A CONSEQUENCE ARE DIFFERENT NUMBERS. A low score is what
 *      llama-guard thought; a block is what the route did about it. They live
 *      in different tables and must not be read off each other.
 *
 * The DDL is lifted verbatim from `sql/schema_baseline.sql`: a fixture that
 * writes its own schema only confirms its own assumptions, and the whole point
 * of these reads is which real columns they touch.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { makeD1 } from './_d1_sqlite.mjs';
import { loadGuardrailCounters } from '../src/services/aiRouter.ts';

/** Verbatim from the baseline; a literal search, never a built regex. */
const BASELINE = readFileSync(
  resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8',
);
function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  const end = BASELINE.indexOf(');', at);
  assert.ok(end > at, `${name}'s definition in the baseline is unterminated`);
  return BASELINE.slice(at, end + 2);
}

/**
 * `withAudit: false` builds the database a branch or a fresh D1 actually has
 * before anything has written an advisor turn — `ai_usage_logs` present (the
 * router bootstraps it), `advisor_turn_audit` absent.
 */
function env(withAudit = true) {
  const schema = withAudit ? `${ddl('ai_usage_logs')}\n${ddl('advisor_turn_audit')}` : ddl('ai_usage_logs');
  const { DB, db } = makeD1(schema);
  return { env: { DB } as never, db };
}

/**
 * Ages a row in the format the WRITER uses. `created_at` defaults to
 * `datetime('now')` on both tables, and the read binds a value built the same
 * way — so a fixture that aged rows in ISO would prove only that the test and
 * itself agree, which is how a mutation escaped on #588.
 */
const AGO = (days: number) => `datetime('now', '-${days} days')`;

function safetyRow(db: { exec(s: string): void }, score: number | null, opts: { days?: number; task?: string } = {}) {
  const s = score === null ? 'NULL' : String(score);
  db.exec(
    `INSERT INTO ai_usage_logs (user_id, task, model, safety_score, created_at)
       VALUES (1, '${opts.task || 'safety'}', '@cf/meta/llama-guard-3-8b', ${s}, ${AGO(opts.days ?? 1)})`,
  );
}

function turnRow(db: { exec(s: string): void }, refusal: string | null, flagged: 0 | 1, days = 1) {
  const r = refusal === null ? 'NULL' : `'${refusal}'`;
  db.exec(
    `INSERT INTO advisor_turn_audit (user_id, prompt_hash, refusal_reason, shadow_flagged, created_at)
       VALUES (1, 'abc123', ${r}, ${flagged}, ${AGO(days)})`,
  );
}

test('the verdict rollup counts safety calls, and only safety calls', async () => {
  const { env: e, db } = env();
  safetyRow(db, 0.9);
  safetyRow(db, 0.8);
  safetyRow(db, 0.2);          // unsafe
  safetyRow(db, null);         // evaluated nothing — no score to judge
  safetyRow(db, 0.9, { task: 'chat' }); // a different task class entirely

  const c = await loadGuardrailCounters(e, 7);
  assert.equal(c.verdicts.available, true);
  if (!c.verdicts.available) return;
  // 3, not 5: the null-score row has no verdict and the `chat` row is not a
  // guard call. Both exclusions are the denominator being honest.
  assert.equal(c.verdicts.evaluated, 3);
  assert.equal(c.verdicts.safe_count, 2);
  assert.equal(c.verdicts.unsafe_count, 1);
  assert.ok(c.verdicts.safe_rate !== null);
  assert.ok(Math.abs((c.verdicts.safe_rate as number) - 2 / 3) < 1e-9);
});

test('a rate over an empty denominator is null, never 0%', async () => {
  const { env: e } = env();
  const c = await loadGuardrailCounters(e, 7);
  assert.equal(c.verdicts.available, true, 'an empty table is readable — it is simply empty');
  if (!c.verdicts.available) return;
  assert.equal(c.verdicts.evaluated, 0);
  assert.equal(
    c.verdicts.safe_rate, null,
    '"0% judged safe" and "the guard never ran" are opposite claims and must not render alike',
  );
});

test('a blocked turn, a flagged turn and an ordinary turn are three different counts', async () => {
  const { env: e, db } = env();
  turnRow(db, 'safety_block', 0);   // refused before the model answered
  turnRow(db, null, 1);             // answered, and the screen flagged the output
  turnRow(db, null, 0);             // neither
  turnRow(db, 'rate_limited', 0);   // a refusal, but not a safety one

  const c = await loadGuardrailCounters(e, 7);
  assert.equal(c.enforcement.available, true);
  if (!c.enforcement.available) return;
  assert.equal(c.enforcement.blocked, 1, 'a non-safety refusal was counted as a guardrail block');
  assert.equal(c.enforcement.flagged, 1, 'a blocked turn was counted as a flagged one, or vice versa');
});

test('a blocked turn is NOT inferred from a low safety score', async () => {
  // THE DISTINCTION THE WHOLE FUNCTION RESTS ON. A score is llama-guard's
  // opinion; a block is what the route did with it. Here the guard judged
  // something unsafe and nothing was refused — which is a real state, because
  // `classifyInput` is also called on paths that only record the verdict.
  const { env: e, db } = env();
  safetyRow(db, 0.1);
  turnRow(db, null, 0);

  const c = await loadGuardrailCounters(e, 7);
  assert.equal(c.verdicts.available && c.verdicts.unsafe_count, 1);
  assert.equal(c.enforcement.available && c.enforcement.blocked, 0);
});

test('AN UNREADABLE advisor_turn_audit IS NOT ZERO HITS', async () => {
  // The assertion this file exists for. The table is lazily bootstrapped, so a
  // database that has never run an advisor turn does not have it — and on a
  // security page, "0 turns blocked" is the most reassuring possible way to be
  // wrong about a store you could not read.
  const { env: e, db } = env(false);
  safetyRow(db, 0.9);

  const c = await loadGuardrailCounters(e, 7);
  assert.equal(c.enforcement.available, false, 'an absent audit table read as a count of zero');
  if (c.enforcement.available) return;
  assert.match(c.enforcement.reason, /advisor_turn_audit/);
  assert.match(
    c.enforcement.reason, /not the same as no turn having been blocked/,
    'the reason does not say what it is refusing to claim',
  );
  // AND THE OTHER HALF STILL ANSWERS. One unreadable table must not take the
  // readable one down with it — the per-source isolation rule this programme
  // applies to every fan-out, one layer down.
  assert.equal(c.verdicts.available, true, 'an unreadable audit table poisoned the verdict rollup');
});

test('both reads are bounded by the same window, and the window is clamped', async () => {
  const { env: e, db } = env();
  safetyRow(db, 0.9, { days: 2 });
  safetyRow(db, 0.9, { days: 40 });   // outside a 7-day window
  turnRow(db, 'safety_block', 0, 2);
  turnRow(db, 'safety_block', 0, 40); // outside it too

  const c = await loadGuardrailCounters(e, 7);
  assert.equal(c.window_days, 7);
  assert.equal(c.verdicts.available && c.verdicts.evaluated, 1, 'the verdict read ignored its window');
  assert.equal(c.enforcement.available && c.enforcement.blocked, 1, 'the enforcement read ignored its window');

  // A wider window reaches both of them — which is what proves the rows were
  // excluded by the DATE and not by some other predicate.
  const wide = await loadGuardrailCounters(e, 90);
  assert.equal(wide.verdicts.available && wide.verdicts.evaluated, 2);
  assert.equal(wide.enforcement.available && wide.enforcement.blocked, 2);

  // Clamped at both ends, so a caller cannot ask for a window the indexes were
  // never meant to serve, and cannot ask for zero days either.
  assert.equal((await loadGuardrailCounters(e, 0)).window_days, 1);
  assert.equal((await loadGuardrailCounters(e, 9999)).window_days, 90);
});

test('the rollup has ONE definition — loadAiUsageReport is its caller, not a second copy', async () => {
  // D152's consolidation, and the twelfth of its kind (D127 one `GROUP BY
  // role`, D128 one LIKE escaper, D130 one definition of open, D131 one count,
  // D138 one definition of what freezes, D140 one zone formatter, D142 one
  // freeze list, D144 one notification row, D149 one bps formatter, D151 one
  // name for the branch). Asserted structurally: the safety SQL appears once
  // in the service, so the two endpoints cannot come to disagree about what a
  // guardrail hit is.
  const src = readFileSync(
    resolve(process.cwd(), 'cloudflare-worker/src/services/aiRouter.ts'), 'utf8',
  );
  assert.equal(
    (src.match(/FROM ai_usage_logs WHERE created_at >= \? AND task = 'safety'/g) || []).length, 1,
    'the llama-guard rollup is written twice — /monitoring/ai-usage and HQ Security must share one',
  );
  // D158 — THIS WAS A COUNT AND IS NOW A CONTAINMENT CHECK, because the two are
  // not the same property. It asserted exactly one `FROM advisor_turn_audit` in
  // the file, which D158's by-category breakdown broke by adding a SECOND READ
  // INSIDE THE ONE ROLLUP — not a second definition of it. The rule D152 set is
  // that the rollup is defined once so the two endpoints cannot disagree about
  // what a guardrail hit is; a count cannot tell "defined twice" from "reads
  // that table twice in the one place", and only the first is the defect.
  //
  // So: every read of the table must live inside `loadGuardrailCounters`. A
  // second copy in `loadAiUsageReport` still fails — which is the case the
  // original assertion existed for — while a second query in the one function
  // passes. Stronger than the count, not looser: the count would also have
  // passed a lone read that had MOVED out of the rollup entirely.
  const fnAt = src.indexOf('export async function loadGuardrailCounters');
  assert.ok(fnAt > 0, 'the rollup function is gone');
  const fnEnd = src.indexOf('\nexport async function ', fnAt + 10);
  const rollup = src.slice(fnAt, fnEnd > 0 ? fnEnd : src.length);
  const inFile = (src.match(/FROM advisor_turn_audit/g) || []).length;
  const inRollup = (rollup.match(/FROM advisor_turn_audit/g) || []).length;
  assert.ok(inRollup >= 1, 'the rollup stopped reading advisor_turn_audit');
  assert.equal(inFile, inRollup,
    'advisor_turn_audit is read outside loadGuardrailCounters — that is a second rollup');
  assert.equal(
    (src.match(/loadGuardrailCounters\(env, win\)/g) || []).length, 1,
    'loadAiUsageReport stopped being the rollup\'s caller',
  );
});
