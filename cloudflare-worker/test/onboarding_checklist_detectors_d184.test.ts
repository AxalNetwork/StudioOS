/**
 * D184 — every onboarding-checklist detector, prepared against the real schema.
 *
 * `services/onboardingChecklist.ts` carries fifty items across five personas,
 * all of them `autoDetect: true`, and each runs one query through `num()`:
 *
 *     async function num(env, sql, ...binds) {
 *       try { … } catch { return 0; }
 *     }
 *
 * A query naming a table or column that does not exist therefore throws inside
 * `num`, returns 0, fails `0 > 0`, upserts no row, and the item renders
 * `pending`. Forever, for every account. The route answers 200 and NOTHING is
 * logged — `loadChecklist`'s own `console.warn` sits outside a catch that can
 * never fire, because `num` already swallowed it.
 *
 * THE FILE PREDICTED THIS. Its header, lines 20-29, describes the same defect
 * in the past tense: `op.service` named `services_offerings`, a typo for a
 * table that exists everywhere, and "the item read 'not done' for every
 * operator, forever, with nothing anywhere to notice." It ends with the rule —
 * *"a swallowed query is indistinguishable from an honest zero"* — and what
 * that lesson bought was one hand-written assertion in
 * `frontend/test/migration_column_shapes.test.mjs` watching `op.service`
 * alone. The other forty-nine went unwatched, and twenty-four of them are the
 * very defect the header warns about.
 *
 * WHY THIS TEST CAN EXIST NOW AND COULD NOT BEFORE. `sqlStrings()` harvested
 * only a literal sitting next to `.prepare(`, `.exec(` or the `sql` tag. Every
 * detect query is `num(env, \`SELECT …\`, userId)` — the `.prepare(` is inside
 * `num`, on the `sql` variable — so all forty-four were invisible to the three
 * SQL guards AND to any test built on the same extractor. D184 widened the
 * harvest to every literal in a file; `everyDetectQueryCameFromTheWidening`
 * below is what keeps that from silently regressing.
 *
 * The database is the real one — `schema_baseline.sql` plus every post-cutoff
 * migration — because a hand-written fixture is how this class hides. #203 was
 * exactly that, and `board_lanes.test.ts` says so in its own header.
 *
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/onboarding_checklist_detectors_d184.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { sqlStrings } from '../../scripts/check-sqlite-dialect.mjs';
import { BASELINE_CUTOFF, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';
import { splitStatements } from './_baseline.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SQL = resolve(HERE, '../sql');
const MIGRATIONS = resolve(SQL, 'migrations');
const SERVICE = resolve(HERE, '../src/services/onboardingChecklist.ts');
const SRC = readFileSync(SERVICE, 'utf8');

/** A new environment's schema: the baseline, then every migration past it. */
function freshDb(): InstanceType<typeof DatabaseSync> {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(readFileSync(resolve(SQL, 'schema_baseline.sql'), 'utf8'));
  for (const name of readdirSync(MIGRATIONS)
    .filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF)
    .sort((a, b) => migrationNumber(a) - migrationNumber(b) || a.localeCompare(b))) {
    for (const stmt of splitStatements(readFileSync(resolve(MIGRATIONS, name), 'utf8'))) {
      try { db.exec(stmt); } catch { /* fresh-build failures are migrations_fresh_build's to report */ }
    }
  }
  return db;
}

/**
 * The `detect()` switch, bounded at both ends.
 *
 * Bounded rather than whole-file because the file's other nine literals are the
 * checklist's own bookkeeping DDL and progress reads — real, working SQL that
 * would dilute the count this test is about.
 */
function detectQueries(): Array<{ body: string; line: number; kind: string }> {
  const from = SRC.indexOf('async function detect(');
  assert.ok(from > 0, 'detect() is gone, so this test is aimed at nothing');
  const to = SRC.indexOf('export interface ChecklistRow', from);
  assert.ok(to > from, 'the marker that ends the detect switch moved');
  const region = SRC.slice(from, to);
  const before = SRC.slice(0, from).split('\n').length - 1;
  return sqlStrings(region).map((q) => ({ ...q, line: q.line + before }));
}

/** Which of them SQLite refuses to prepare against the real schema. */
function unpreparable(): Map<string, string> {
  const db = freshDb();
  const bad = new Map<string, string>();
  for (const { body, line } of detectQueries()) {
    try {
      db.prepare(body).finalize?.();
    } catch (e: any) {
      bad.set(`${line}`, String(e?.message || e).replace(/^.*?:\s*/, ''));
    }
  }
  return bad;
}

// ---------------------------------------------------------------------------

test('the detect switch is read in full, and only the widening can read it', () => {
  const qs = detectQueries();
  // Non-vacuity. Fifty catalogue items share forty-four queries; a number far
  // below that means the region bound or the extractor stopped working, and a
  // test that silently examines three queries is worse than none.
  assert.ok(qs.length >= 40,
    `only ${qs.length} detect queries were read — the region bound or sqlStrings is broken`);

  // THE PROOF THE WIDENING IS LOAD-BEARING. Every one of these reaches D1
  // through `num(env, sql, …)`, so none of them sits next to `.prepare(`,
  // `.exec(` or the `sql` tag. If any ever carries an anchored `kind`, the
  // file has been rewritten and this test's premise needs re-reading; if they
  // ALL do, the widening has been reverted and the guards are blind again.
  const anchored = qs.filter((q) => q.kind !== 'literal');
  assert.equal(anchored.length, 0,
    `${anchored.length} detect queries came from the anchored pass — expected all `
    + 'to be reachable only through the whole-file literal scan');
});

test('twenty-four checklist items can never be satisfied, and these are they', () => {
  const bad = unpreparable();
  const lines = [...bad.keys()].map(Number).sort((a, b) => a - b);

  // Each line is one detect query SQLite refuses against the shipped schema.
  // The consequence is identical for all of them: `num()` returns 0, the item
  // never completes, and nobody is told. `scripts/sqlite-columns-baseline.json`
  // and `scripts/sqlite-tables-baseline.json` carry the per-item diagnosis and
  // the column or table each should be repointed at; D184's follow-up PRs empty
  // both ledgers and shrink this list to nothing.
  //
  // THIS LIST IS NOT THE GUARDS' LIST, AND THE DIFFERENCE IS THE POINT. The
  // three `check-sqlite-*` guards ask "does the repo declare this anywhere",
  // unioning every file under `sql/`. This test asks "does a freshly
  // provisioned database have it" — baseline plus post-cutoff migrations,
  // which is exactly what `migrate-d1 --bootstrap` builds. Line 288 is the
  // whole difference: `captable_holders` is declared in
  // `migrations/034_unmounted_routes.sql`, so the guards call it known, and it
  // is in neither `schema_baseline.sql` nor production (read read-only against
  // studioos-db, 2026-09-21). Only a fresh-build fixture can see it.
  //
  // Two entries here are therefore missing TABLES rather than renamed columns,
  // both from that same migration: `captable_holders` (288) and
  // `references_records` (379, 397). Their baseline entries say so; the
  // migration declaring tables neither the baseline nor production has is
  // baseline drift, which `check-baseline-drift` owns and D184 does not.
  assert.deepEqual(lines, [
    269,   // nf.advisor      expert_bookings.founder_user_id -> user_id
    288,   // ef.captable     captable_holders — absent; the cap_table_holders
           //                 fallback below it works, so the ITEM is fine and
           //                 this arm is dead weight. Guard-invisible (034).
    298,   // ef.financials   financial_models.user_id -> keyed on project_id
    301,   // ef.83b          compliance_records.user_id / .record_type
    305,   // ef.ip           compliance_records.user_id / .record_type
    311,   // ef/inv/mt.nda   pairwise_ndas.user_a/user_b -> party_a/b_user_id
    316,   // inv.kyc         kyc_records — no such table anywhere
    320,   // inv.thesis      investor_profiles.thesis -> thesis_text
    329,   // inv.review      match_scores.investor_user_id -> user_id/target_user_id
    334,   // inv.target      investor_profiles.deployment_target_cents/.reserve_percent
    354,   // op.accept       partner_invitations.accepted_user_id/.email/.redeemed_at
    360,   // op.conflicts    partner_profiles.conflicts_disclosed_at
    364,   // op.deal_type    partner_deals.partner_user_id/.signed_at
    368,   // op.kyb          kyc_records — no such table anywhere
    379,   // op.refs         references_records — absent table, not a rename
    381,   // op.referral     referral_invites.owner_user_id -> sender_user_id
    384,   // op.intro        investor_introductions.source_user_id/.introducer_user_id
    390,   // mt.tags         experts.tags -> categories_json/sectors_json
    394,   // mt.comp         experts.comp_model — pricing_model is NOT NULL DEFAULT
    397,   // mt.refs         references_records — absent table, not a rename
    400,   // mt.capacity     advisors.weekly_hours_band, via users.advisor_id
    403,   // mt.slots        advisor_slots — historical/ only
    406,   // mt.booking      expert_bookings.expert_user_id -> expert_id
  ], `unpreparable detect queries: ${[...bad].map(([l, m]) => `${l} (${m})`).join('; ')}`);
});

test('the advisor catalogue cannot reach the celebration threshold', () => {
  // The sharpest single consequence, and the reason wholesale removal is not
  // an option for `mt.*`. Seven of its ten items are among the broken set, and
  // CELEBRATION_THRESHOLD is an absolute 8 — so an advisor who completes every
  // item the platform can actually observe reaches 3 of 10 and the checklist
  // never finishes for them.
  const bad = new Set([...unpreparable().keys()].map(Number));
  const mt = detectQueries().filter((q) => q.line >= 386 && q.line <= 410);
  assert.ok(mt.length >= 5, `only ${mt.length} mt.* queries found — the line window moved`);
  const broken = mt.filter((q) => bad.has(q.line)).length;
  assert.ok(broken >= 5,
    `${broken} of the advisor catalogue's detectors are broken — if this has dropped, `
    + 'the repairs have started and this assertion should move with them');

  const threshold = /CELEBRATION_THRESHOLD\s*=\s*(\d+)/.exec(SRC);
  assert.ok(threshold, 'CELEBRATION_THRESHOLD is gone');
  assert.equal(Number(threshold![1]), 8,
    'the threshold is an absolute count, not a ratio — changing it changes which '
    + 'personas can ever finish, and the advisor one already cannot');
});

test('a swallowed query is why none of this was visible', () => {
  // The mechanism, pinned. If `num` ever rethrows, these items start failing
  // loudly instead of silently — a better world, and one that makes the
  // assertions above describe something else, so it must not change unnoticed.
  const numFn = SRC.slice(SRC.indexOf('async function num('), SRC.indexOf('async function detect('));
  assert.match(numFn, /catch\s*\{\s*\n?\s*return 0;/,
    'num() no longer swallows — re-read what the checklist does on a bad query');
  assert.doesNotMatch(numFn, /console\.(warn|error)/,
    'num() gained a log line; if a bad query is now reported, say so in D184 rather '
    + 'than leaving this suite describing a silence that has ended');
});
