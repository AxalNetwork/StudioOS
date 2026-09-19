/**
 * THE NINE PARTNER ZONES GET STORES, AND THE STORES KEEP THEIR OWN RULES.
 *
 * Six of the fifteen partner zones render a real body. The other nine rendered
 * a `NoStoreYet` card naming the column they would need, and every one of those
 * columns was verified absent before migrations 208 and 209 were written:
 * `engagements` has eighteen columns and one ALTER ever added to it, with no
 * cadence, renewal, consumption, milestone, hours, last-contact or
 * acknowledgment; `quotes` has a four-value status and nothing between "sent"
 * and "decided".
 *
 * These guards are about the two ways a schema like this goes wrong quietly.
 *
 * The first is a migration that cannot be replayed. The runner is forward-only
 * and aborts the whole deploy on the first failing statement, so a file that is
 * not idempotent does not just fail itself — it holds every later migration and
 * the worker behind it. Migration 200 was rewritten for exactly this after D1
 * rejected the transaction statements inside it.
 *
 * The second is a derived value that gets stored. Engagement health, retainer
 * utilisation and days-stalled are all computable from rows these files add,
 * and storing any of them would be a second source of truth for something the
 * rows already say — which disagrees with them the first moment one moves. The
 * schema is checked for their absence rather than trusted to omit them.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const DIR = join(ROOT, 'cloudflare-worker', 'sql', 'migrations');
const FILES = ['208_partner_delivery_stores.sql', '209_partner_offers_stores.sql'];
const SQL = Object.fromEntries(FILES.map((f) => [f, readFileSync(join(DIR, f), 'utf8')]));
const ALL = Object.values(SQL).join('\n');

/**
 * DDL with the `--` prose removed.
 *
 * These files argue at length for what they do NOT store, so they name every
 * derived value the guard below bans — "Utilisation is this over
 * retained_hours, computed at read time" is exactly the comment you want to
 * keep, and it failed the ban the first time this ran. Same reasoning as
 * `_codeOnly.mjs` on the JavaScript side: a word in an explanation is not a
 * word in the schema.
 */
const ddl = (sql) => sql.replace(/^\s*--[^\n]*$/gm, '').replace(/\s--[^\n]*$/gm, '');
const DDL = ddl(ALL);

/** Table names each file creates. */
const created = [...ALL.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]);

test('every zone that had no store now has one', () => {
  // Named per zone rather than as a count, so a table quietly dropped from a
  // file fails against the ZONE it was for instead of against a number.
  const perZone = {
    'pipeline/negotiations': ['quote_negotiations', 'quote_terms'],
    'pipeline/retainers': ['partner_retainers', 'retainer_usage'],
    'delivery/health': ['engagement_milestones'],
    'delivery/deliverables': ['engagement_deliverables'],
    'delivery/capacity': ['engagement_seats', 'engagement_hours'],
    'delivery/status-reports': ['engagement_status_reports', 'engagement_blockers'],
    'offers/visibility': ['partner_surfaces', 'engagement_sources'],
    'offers/proof': ['partner_proof_items', 'partner_proof_consents'],
    'offers/audience-fit': ['partner_fit_rules'],
  };
  for (const [zone, tables] of Object.entries(perZone)) {
    for (const t of tables) {
      assert.ok(created.includes(t), `/${zone} has no ${t} to read`);
    }
  }
});

test('both files are replayable — the runner aborts the deploy on one bad statement', () => {
  for (const [name, sql] of Object.entries(SQL)) {
    const tables = (sql.match(/CREATE TABLE(?! IF NOT EXISTS)/g) || []);
    assert.deepEqual(tables, [], `${name}: every CREATE TABLE needs IF NOT EXISTS`);
    const indexes = (sql.match(/CREATE (?:UNIQUE )?INDEX(?! IF NOT EXISTS)/g) || []);
    assert.deepEqual(indexes, [], `${name}: every CREATE INDEX needs IF NOT EXISTS`);
    // D1 rejects these outright inside a migration; migration 200 was rewritten
    // for it and the whole file rolled back on the production run.
    assert.doesNotMatch(sql, /\b(BEGIN|COMMIT|ROLLBACK)\s+TRANSACTION\b/i,
      `${name}: D1 rejects transaction statements in a migration`);
  }
});

test('nothing is added to the users table', () => {
  // `users` is at D1's 100-column limit. An ALTER against it fails with
  // "too many columns" — for a column that already exists as much as for a new
  // one — and takes the deploy with it.
  assert.doesNotMatch(DDL, /ALTER TABLE\s+users/i,
    'a user-attached fact needs a side table keyed on user_id');
});

test('new money is integer cents, whatever sits beside it', () => {
  // `engagements.price` next door is REAL and grandfathered. The float half of
  // this schema is a data migration over live records, not a lint fix — but it
  // must not grow, and a retainer amount and a budget floor are new money.
  const money = [...DDL.matchAll(/^\s*(\w*(?:amount|price|floor|fee|cost)\w*)\s+(\w+)/gim)]
    .map((m) => ({ col: m[1], type: m[2].toUpperCase() }))
    // TWO TESTS, BECAUSE THESE ARE TWO DIFFERENT TESTS.
    //
    // `hours` and `note` are SUBSTRING matches — an `hourly_cost_note` is not a
    // money column — while `_at` must be ANCHORED, because a timestamp like
    // `forecast_at` contains "cost" and would otherwise be demanded to be named
    // `*_cents` and typed INTEGER.
    //
    // This was one regex, `/hours|note|_at$/`, and grouping it as
    // `/(?:hours|note)|_at$/` did NOT satisfy CodeQL's misleading-precedence
    // rule — correctly, since the grouped form still has one anchored and one
    // unanchored alternative at the top level, which is the exact ambiguity the
    // rule is about. A regex cannot be made unambiguous by parenthesising the
    // half that was never in doubt. Two predicates say the two things.
    .filter((c) => !/hours|note/.test(c.col) && !/_at$/.test(c.col));
  assert.ok(money.length >= 2, `expected the new money columns, saw ${money.length}`);
  for (const c of money) {
    assert.match(c.col, /_cents$/, `${c.col} holds currency and must be named *_cents`);
    assert.equal(c.type, 'INTEGER', `${c.col} must be INTEGER — the name promises exactness`);
  }
});

test('nothing derivable is stored', () => {
  // Health, utilisation and days-stalled are all computable from the rows these
  // files add. Storing one makes it a second source of truth for something
  // three tables already say, and the two disagree the first time one moves.
  for (const banned of [
    /\bhealth(_\w+)?\s+(TEXT|INTEGER|REAL)/i,
    /\butilisation|\butilization/i,
    /\bdays_stalled\b/i,
    /\bis_published\b/i,
    /\bis_attested\b/i,
  ]) {
    assert.doesNotMatch(DDL, banned,
      `${banned} names a derived value; compute it at read time instead`);
  }
});

test('consent is a state that can be withdrawn, not a flag that can vanish', () => {
  // Copied deliberately from migration 204, so the advisor and partner halves
  // can be audited by one query. `consent_given` back to 0 with `withdrawn_at`
  // set keeps the record that consent was given and taken back; deleting the
  // row would erase that it ever happened, and an attestation that can silently
  // vanish is not evidence of anything.
  // Comment-stripped on both sides. These headers ARGUE for withdrawal-as-state
  // at length, so every column name appears in prose too — and a check against
  // the raw file passed a mutation that deleted `withdrawn_at` from the schema
  // while leaving the paragraph explaining it.
  const proof = ddl(SQL['209_partner_offers_stores.sql']);
  for (const col of ['consent_given', 'consent_given_at', 'consent_text',
    'consent_captured_by', 'withdrawn_at']) {
    assert.ok(new RegExp(`^\\s*${col}\\s+\\w`, 'm').test(proof),
      `partner_proof_consents is missing the ${col} column`);
  }
  const advisor = ddl(readFileSync(join(DIR, '204_advisor_proof.sql'), 'utf8'));
  for (const col of ['consent_given', 'consent_given_at', 'consent_text', 'withdrawn_at']) {
    const declared = (f) => new RegExp(`^\\s*${col}\\s+\\w`, 'm').test(f);
    assert.ok(declared(advisor) && declared(proof),
      `${col} must be declared on both halves or the shared audit query splits`);
  }
});

// The four numbers that are already doubled, each with the files that hold
// them. D168 WIDENED THIS FROM A TWO-NUMBER CHECK, and the reason is the whole
// argument for a ledger over a list: the assertion below used to read
// `for (const n of [208, 209])`, so it stated the rule correctly and enforced
// it only against the two instances its author happened to be adding. A
// collision on any other number was invisible — and one duly happened. On the
// day D168 was open, `271_archetype_sex.sql` merged to `main` from #662 while
// this branch already carried `271_dsr_requests.sql`; nothing in the suite
// said so, and the duplicate would have shipped. The runner tolerates it
// (`scripts/lib/migrationPlan.mjs:62` sorts by number then filename precisely
// because of the four below), so tolerating it is not the failure — shipping
// an ordering nobody chose is.
//
// A named ledger rather than a count, and it refuses a STALE entry too: a line
// that no longer points at two real files is a line nobody can check, which is
// the rule `scripts/sql-prepare-baseline.json` states for its own.
const KNOWN_DUPLICATE_NUMBERS = {
  '011': ['011_sms_2fa.sql', '011_subscription_tiers.sql'],
  '068': ['068_news_articles.sql', '068_x_twitter.sql'],
  '118': ['118_captable_scenario_variants.sql', '118_project_product_demo.sql'],
  '259': ['259_hq_escalations.sql', '259_licence_contracts.sql'],
};

test('the migration numbers are free and in order', () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.sql'));
  const nums = files.map((f) => Number(f.slice(0, 3))).filter(Number.isFinite);
  for (const n of [208, 209]) {
    assert.equal(nums.filter((x) => x === n).length, 1,
      `two files numbered ${n} order by filename, which is not a decision anyone made`);
  }

  // NO FIFTH DUPLICATE. Every number is used once, except the four above.
  const byNumber = new Map();
  for (const f of files) {
    const k = f.slice(0, 3);
    if (!byNumber.has(k)) byNumber.set(k, []);
    byNumber.get(k).push(f);
  }
  for (const [k, group] of [...byNumber].sort()) {
    if (group.length === 1) continue;
    assert.deepEqual(group.sort(), KNOWN_DUPLICATE_NUMBERS[k],
      `migration ${k} is used by ${group.length} files and is not one of the four `
      + 'historical duplicates. Renumber the new one before merge — the runner '
      + 'orders same-numbered files by filename, which is not a decision anyone made.');
  }
  // …and the ledger itself stays true: an entry whose files are gone or were
  // renumbered is a line that can no longer fail, which is worse than no line.
  for (const [k, expected] of Object.entries(KNOWN_DUPLICATE_NUMBERS)) {
    assert.deepEqual((byNumber.get(k) || []).sort(), expected,
      `KNOWN_DUPLICATE_NUMBERS['${k}'] no longer describes the tree — `
      + 'drop the entry rather than leaving a line nobody can check.');
  }
  // THIS USED TO ASSERT `Math.max(...nums) === 209`, and that was a bad
  // assertion however true it was when written: it said "these are the newest
  // migrations", which stops being true the moment anyone adds one. Migration
  // 210 is what expired it — a guard whose only failure mode is somebody doing
  // the next correct thing is a speed bump, not a check.
  //
  // The durable half is what it was reaching for anyway. The runner orders by
  // FILENAME, so a number that is not three digits sorts somewhere its author
  // did not intend — `21_x.sql` runs before `208_x.sql`, and a file that
  // depends on an earlier one then runs first and aborts the deploy.
  for (const f of files) {
    assert.match(f, /^\d{3}_/,
      `${f}: the runner orders by filename, so every migration needs a 3-digit prefix`);
  }
});
