/**
 * An obligation seeded `required: 1` must have a code path that can satisfy it.
 *
 * TWO OF THE TEN CANNOT BE, down from eight when this file landed. That number is
 * the measurement, and the point of the file is that it can only fall.
 *
 * WHAT CLOSED, in two steps. The three NDAs and the advisor disclaimer each had a
 * real signable document, a wired template body and a working send route, and
 * nothing wrote the result back — so `satisfyObligationFromEnvelope` now records a
 * completed envelope against them, which is what `evidence_envelope_uuid` was added
 * for in migration 025. Then `tos_v1` and `privacy_v1`, which had no affirmative
 * acceptance anywhere in the product to record: only passive browsewrap text, and
 * on the one screen every signup must pass, not even that. Marking them satisfied
 * would have asserted an act nobody performed, so the fix was a real consent
 * checkbox on the onboarding licence gate plus `recordTermsAcceptance` to make it
 * durable — not a write on its own. Both are proven behaviourally, in
 * `obligation_signature_satisfier.test.ts` and `terms_acceptance.test.ts`.
 *
 * WHAT REMAINS, and why each is a decision rather than a missing write:
 *
 *   `accreditation_v1` — required of every investor, no satisfier. It has a legal
 *   template and an e-sign doc_type, so it looks wired; satisfying or waiving it is
 *   a securities question for counsel, and it is deliberately excluded from
 *   `SATISFIABLE_BY_SIGNATURE` for that reason.
 *
 *   `kyb_v1` — HAS a write site that has never been able to run. That is the
 *   sharper half, because it fails invisibly: `resyncKycKyb`'s KYB branch joins
 *   `corporate_profiles.kyb_status`, a column that exists on no table in this
 *   schema, and the D1 error used to be swallowed by
 *   `.all().catch(() => ({ results: [] }))` — indistinguishable from "no rows to
 *   reconcile", so the nightly cron reported `scanned=0` and read as healthy. Two
 *   places in the repo already knew the column was absent (`schema_guards.test.mjs`,
 *   and a migration comment citing it by name as the example of a value with no
 *   writer); nothing connected that to the obligation depending on it.
 *
 * The second test below is that connection, made behaviourally rather than by
 * reading: the reconciler is RUN, against a database where every external
 * precondition is met, and KYB still does not move — and the branch's own warning
 * is captured, which is what distinguishes "nothing to do tonight" from "this has
 * never worked".
 *
 * WHAT IS STILL DELIBERATELY NOT DONE. No seeding changed, and no obligation is
 * waived. The two remaining keys are each blocked on a decision rather than on
 * code, and the precedent for leaving them alone is `ADVISOR_CHARGING_ENABLED`
 * staying unset until counsel cleared the advisor terms. This file measures;
 * `UNSATISFIABLE_TODAY` is an exact set, so the measurement can only shrink and a
 * regression cannot be quiet.
 *
 * Real SQLite via `_d1_sqlite.mjs`, for the reason that file gives: a text-matching
 * stub cannot tell a correct predicate from an incorrect one, and the whole point
 * here is that one specific predicate cannot run at all.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { resyncKycKyb } from '../src/services/trust.ts';
// The repo's own schema harvest — baseline plus every migration, cross-referenced
// against every column the worker actually reads. `schema_guards.test.mjs` pins its
// output to exactly one entry; this file is what depends on that entry being there.
import { unknownColumns } from '../../scripts/check-sqlite-columns.mjs';

const root = resolve(process.cwd());
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

const TRUST_SVC = read('cloudflare-worker/src/services/trust.ts');
const PARTNER_DEALS = read('cloudflare-worker/src/services/partnerDeals.ts');
const TRUST_ROUTES = read('cloudflare-worker/src/routes/trust.ts');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');

/* ------------------------------------------------------------------ *
 * The two sides of the invariant, both derived from source
 * ------------------------------------------------------------------ */

/**
 * Keys a seeder can mark `required: 1`.
 *
 * Three sources, and the third is easy to miss: `ROLE_MATRIX`'s literals, the
 * deal-conditional top-up in `partnerDeals.ts`, and the in-place PROMOTION at
 * `seedObligations` (`if (kyb) kyb.required = 1` for an entity investor), which
 * turns a `required: 0` literal into a real requirement without editing the table.
 */
function requiredKeys(): Set<string> {
  const out = new Set<string>();
  const matrix = TRUST_SVC.slice(
    TRUST_SVC.indexOf('const ROLE_MATRIX'),
    TRUST_SVC.indexOf('export function obligationsForRole'),
  );
  assert.ok(matrix.length > 200, 'ROLE_MATRIX could not be sliced out of trust.ts');
  for (const m of matrix.matchAll(/\{\s*key:\s*'([a-z0-9_]+)',\s*required:\s*1\b/g)) out.add(m[1]);

  // The deal-conditional block. `isCapital ? 1 : 0` counts: for a capital
  // partnership it IS required, and a partner who signs one is handed it.
  const deal = PARTNER_DEALS.slice(
    PARTNER_DEALS.indexOf('const dealConditional'),
    PARTNER_DEALS.indexOf('for (const o of dealConditional)'),
  );
  assert.ok(deal.length > 100, 'dealConditional could not be sliced out of partnerDeals.ts');
  for (const m of deal.matchAll(/\{\s*key:\s*'([a-z0-9_]+)',\s*required:\s*(1|isCapital)/g)) out.add(m[1]);

  // Promotions: `<something>.required = 1` where a key was just resolved.
  for (const m of TRUST_SVC.matchAll(/find\(d => d\.key === '([a-z0-9_]+)'\)[\s\S]{0,120}?\.required = 1/g)) {
    out.add(m[1]);
  }
  // And SQL that promotes by key.
  for (const m of TRUST_ROUTES.matchAll(/required = 1[\s\S]{0,240}?obligation_key = '([a-z0-9_]+)'/g)) {
    out.add(m[1]);
  }
  return out;
}

/**
 * Keys some statement WRITES `'satisfied'` for — which is not the same as keys that
 * can BE satisfied, and conflating the two is the KYB finding itself. `kyb_v1` has
 * an UPDATE setting `status = 'satisfied'` that has never once run. So this function
 * reports write sites; `UNSATISFIABLE_TODAY` marks which of them are inert, and the
 * invariant subtracts those.
 *
 * Returns key → the files whose write sites name it, so an inert entry can prove its
 * blocker is read by the same file that holds the write rather than anywhere at all.
 *
 * ATTRIBUTED BY ENCLOSING BLOCK, NOT BY PROXIMITY. In `resyncKycKyb` the key is not
 * in the UPDATE at all — it is in the SELECT above it, inside the same `try`. A
 * window of N lines around the UPDATE would read the neighbouring branch's key and
 * credit KYB with KYC's satisfier, which is the same read-past-the-boundary trap
 * that escaped a mutation in `rateLimit_advisor_charge.test.ts`.
 */
function writeSites(): { writes: Map<string, Set<string>>; sites: number } {
  const writes = new Map<string, Set<string>>();
  const statements = new Set<string>();
  for (const [file, src] of [
    ['cloudflare-worker/src/services/trust.ts', TRUST_SVC],
    ['cloudflare-worker/src/services/partnerDeals.ts', PARTNER_DEALS],
    ['cloudflare-worker/src/routes/trust.ts', TRUST_ROUTES],
  ] as const) {
    let from = 0;
    for (;;) {
      const at = src.indexOf("status = 'satisfied'", from);
      if (at < 0) break;
      from = at + 1;
      // A WHERE clause reading the state is not a write of it.
      const stmtStart = src.lastIndexOf('`', at);
      const head = src.slice(Math.max(0, stmtStart - 40), at);
      if (/WHERE\s+$/i.test(src.slice(Math.max(0, at - 40), at)) || /\bWHERE\b[^`]*$/i.test(head)) continue;

      // ONE SQL STATEMENT IS ONE SITE. `partnerDeals`'s ON CONFLICT carries a CASE
      // whose two arms both mention 'satisfied' — counting them separately made the
      // site count 4 and would have hidden a genuinely new fourth satisfier behind
      // an off-by-one nobody could read.
      statements.add(`${file}:${stmtStart}`);

      // TWO-STAGE ATTRIBUTION, because the key is not always inside the innermost
      // `try`. In `resyncKycKyb` the key is in the SELECT in the same try-block, and
      // the tight boundary is essential — a fixed window would spill into the
      // neighbouring branch and credit KYB with KYC's satisfier. In `partnerDeals`
      // it is the loop's `o.key === 'partner_msa_v1'`, which sits BEFORE the inner
      // try wrapping the INSERT, so the tight slice finds nothing and the window
      // has to widen. Tight first, widen only when tight yields no key.
      const tight = src.slice(Math.max(src.lastIndexOf('try {', at), at - 2500), at);
      const found = (s: string) => [
        ...[...s.matchAll(/obligation_key = '([a-z0-9_]+)'/g)].map((m) => m[1]),
        ...[...s.matchAll(/o\.key === '([a-z0-9_]+)'/g)].map((m) => m[1]),
      ];
      const hits = found(tight).length ? found(tight) : found(src.slice(Math.max(0, at - 2500), at));
      for (const k of hits) {
        if (!writes.has(k)) writes.set(k, new Set());
        writes.get(k)!.add(file);
      }
    }
  }
  return { writes, sites: statements.size };
}

/**
 * Keys a satisfier declares it will act on, read from the set that declares it.
 *
 * NEEDED BECAUSE A TEXT SCAN CANNOT ANSWER THIS ONE. Both newer satisfiers bind
 * `obligation_key = ?` from a set rather than naming keys in SQL, so
 * `writeSites()` correctly finds their write statements and correctly attributes
 * no key to them. Rather than loosen that attribution — which is what stops a key
 * in a neighbouring branch being credited to the wrong write — this reads the
 * authority directly: the declared set IS the list of keys the satisfier acts on.
 *
 * That the keys in each set can really be satisfied is proven behaviourally, by
 * `obligation_signature_satisfier.test.ts` and `terms_acceptance.test.ts` running
 * the real functions against a real database. These parsers establish scope; those
 * files establish that the scope works.
 */
function declaredKeys(setName: string): Set<string> {
  const at = TRUST_SVC.indexOf(`const ${setName}`);
  assert.ok(at > 0, `${setName} is gone from trust.ts — did its satisfier move or get deleted?`);
  const block = TRUST_SVC.slice(at, TRUST_SVC.indexOf(']);', at));
  const keys = [...block.matchAll(/'([a-z0-9_]+_v1)'/g)].map((m) => m[1]);
  assert.ok(keys.length > 0, `${setName} parsed to nothing`);
  return new Set(keys);
}

/** Every key some declared-set satisfier covers. */
function declaredSatisfiableKeys(): Set<string> {
  return new Set([
    ...declaredKeys('SATISFIABLE_BY_SIGNATURE'),
    ...declaredKeys('SATISFIABLE_BY_CLICKWRAP'),
  ]);
}

/**
 * EXACT SET. Each entry is a key a seeder marks required and that nothing can
 * satisfy. It can only shrink: removing an entry without building its satisfier
 * fails, and closing a gap without removing its entry also fails.
 *
 * EACH ENTRY PROVES ITSELF, because the two gaps here fail in different ways and a
 * single "is it satisfiable" check would call one of them wrong:
 *
 *   `satisfier: 'none'`  — nothing anywhere writes `'satisfied'` for this key. The
 *                          entry is proven by the key's ABSENCE from `writeSites()`;
 *                          if a write site appears, the entry is stale.
 *   `satisfier: 'inert'` — a write site exists and has never been able to run. The
 *                          entry is proven by its PRESENCE in `writeSites()` plus
 *                          `blockedBy` still being a column the worker reads and no
 *                          table defines, per the repo's own schema harvest. Add the
 *                          column, or rewrite the query off it, and the entry turns
 *                          red and demands review.
 *
 * So the day someone adds `corporate_profiles.kyb_status` this file fails — which is
 * the point, because that is the day KYB might start working and nothing else would
 * notice that it had.
 */
type Gap = { why: string; satisfier: 'none' | 'inert'; blockedBy?: string };

const UNSATISFIABLE_TODAY: Record<string, Gap> = {
  // Acceptance happens somewhere — a signup checkbox, a signature — but nothing
  // records it into `legal_obligations`. No write site in any of the four files
  // names these keys, so every user carries them pending forever.
  // SIX KEYS USED TO BE HERE. The four signature-backed ones went when
  // `satisfyObligationFromEnvelope` landed; `tos_v1` and `privacy_v1` went when
  // the onboarding licence gate got a real consent checkbox and
  // `recordTermsAcceptance` gave it somewhere to write. Both sets are credited by
  // the `declaredKeys` parsers above and proven behaviourally by
  // `obligation_signature_satisfier.test.ts` and `terms_acceptance.test.ts`.
  //
  // What is left is exactly the two nobody can close without a decision.
  // Has a legal template and an e-sign doc_type, so it looks wired; it is not.
  // required:1 for EVERY investor, which makes this the widest of the seven.
  // Waiving it is a securities question, not a code change.
  accreditation_v1: {
    satisfier: 'none',
    why: 'no write site at all, and required for every investor — needs counsel before any waive',
  },
  // The one write site that exists and cannot run. Note the shape of the miss: a
  // real KYB store DOES exist — migration 220's `company_kyb_records`, with a
  // `status` column — and the reconciler reads a different, absent column on a
  // different table, so the two have never been connected.
  kyb_v1: {
    satisfier: 'inert',
    blockedBy: 'corporate_profiles.kyb_status',
    why: 'the UPDATE exists; the SELECT feeding it joins a column no table defines, so it has never run',
  },
};

/* ------------------------------------------------------------------ *
 * A real database, and the reconciler actually run against it
 * ------------------------------------------------------------------ */

function tableDDL(name: string): string {
  const at = BASELINE.indexOf(`CREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is not in schema_baseline.sql`);
  const end = BASELINE.indexOf(');', at);
  return BASELINE.slice(at, end + 2);
}

function makeEnv() {
  const db = new DatabaseSync(':memory:');
  db.exec(tableDDL('legal_obligations'));
  db.exec(tableDDL('corporate_profiles'));
  // `users` in the baseline is large and carries FKs; the reconciler reads one
  // column off it, so a minimal stand-in keeps the fixture honest about what is
  // actually consulted.
  db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, kyc_status TEXT)');
  const coerce = (a: any[]) => a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
  const DB = {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() {
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async batch(stmts: any[]) { return Promise.all(stmts); },
  };
  return { env: { DB } as any, db };
}

const statusOf = (db: InstanceType<typeof DatabaseSync>, key: string) =>
  (db.prepare('SELECT status FROM legal_obligations WHERE obligation_key = ?').get(key) as any)?.status;

/* ------------------------------------------------------------------ *
 * Tests
 * ------------------------------------------------------------------ */

test('the reconciler satisfies KYC when the provider approved it', async () => {
  // The control. Proves the fixture, the harness and the reconciler all work, so
  // the KYB result below is a fact about KYB and not about this test's plumbing.
  const { env, db } = makeEnv();
  db.exec("INSERT INTO users (id, kyc_status) VALUES (7, 'approved')");
  db.exec("INSERT INTO legal_obligations (user_id, obligation_key, required, status) VALUES (7, 'kyc_v1', 1, 'pending')");

  const out = await resyncKycKyb(env);
  assert.equal(statusOf(db, 'kyc_v1'), 'satisfied',
    'kyc_v1 no longer reconciles from users.kyc_status; the control for this file is broken');
  assert.ok(out.updated >= 1, 'the reconciler reported no update for a row it changed');
});

test('the reconciler cannot satisfy KYB, and reports success while failing', async () => {
  // THE FINDING, RUN RATHER THAN READ. Every external precondition a reader would
  // expect is met: the account has a corporate profile, and the obligation is
  // pending. The only thing missing is the column the query joins.
  const { env, db } = makeEnv();
  db.exec("INSERT INTO users (id, kyc_status) VALUES (8, 'approved')");
  db.exec("INSERT INTO corporate_profiles (user_id, entity_name) VALUES (8, 'Anvil Ltd')");
  db.exec("INSERT INTO legal_obligations (user_id, obligation_key, required, status) VALUES (8, 'kyb_v1', 1, 'pending')");

  const warned: string[] = [];
  const realWarn = console.warn;
  console.warn = (...a: unknown[]) => { warned.push(a.map(String).join(' ')); };
  let out: { scanned: number; updated: number };
  try {
    out = await resyncKycKyb(env);
  } finally {
    console.warn = realWarn;
  }

  assert.equal(statusOf(db, 'kyb_v1'), 'pending',
    'kyb_v1 moved — if a satisfier was built, remove its UNSATISFIABLE_TODAY entry');
  // The call still resolves and still reports counts — the no-op is unchanged.
  assert.equal(typeof out!.scanned, 'number', 'resyncKycKyb threw rather than swallowing');
  assert.equal(out!.updated, 0, 'nothing was updated, which is the honest count of a no-op');

  // AND THE QUERY REALLY DOES FAIL, rather than merely matching no rows — which is
  // the difference between "no entity investors to reconcile tonight" and "this has
  // never worked". Proven by the branch's own named warning firing: it is emitted
  // only from the SELECT's rejection handler. Before this line was added the two
  // cases were indistinguishable from outside, which is exactly how the gap
  // survived a nightly cron.
  const inert = warned.filter((w) => w.includes('KYB inert'));
  assert.equal(inert.length, 1,
    'expected exactly one "KYB inert" warning from the failing SELECT, got '
    + `${inert.length}: ${JSON.stringify(warned)}. If the query no longer rejects, KYB may `
    + 'now be readable — re-check UNSATISFIABLE_TODAY.kyb_v1.');
  assert.match(inert[0], /corporate_profiles\.kyb_status/,
    'the warning does not name the missing column, so a reader of the cron log cannot act on it');
});

test('corporate_profiles has no kyb_status column, which is why the above cannot work', () => {
  // The pair. `schema_guards.test.mjs` asserts the absence across every table; this
  // asserts the LINK — that the satisfier reads precisely the absent column — so
  // adding the column turns the test above red and demands the entry be removed.
  const ddl = tableDDL('corporate_profiles');
  assert.ok(!/\bkyb_status\b/.test(ddl),
    'corporate_profiles now HAS kyb_status — the KYB reconciler may work; re-check '
    + 'UNSATISFIABLE_TODAY.kyb_v1 and the behavioural test above');
  assert.match(TRUST_SVC, /cp\.kyb_status/,
    'the KYB reconciler no longer reads corporate_profiles.kyb_status; if it was '
    + 'rewritten, this pairing no longer describes the code');
});

test('every obligation a seeder marks required can be satisfied, or is a recorded gap', () => {
  const required = requiredKeys();
  const { writes } = writeSites();
  const recorded = new Set(Object.keys(UNSATISFIABLE_TODAY));

  // A write that cannot execute is not a satisfier, so the inert ones are subtracted
  // before the invariant is applied. Without this the KYB gap reads as closed.
  const inert = new Set(
    Object.entries(UNSATISFIABLE_TODAY).filter(([, g]) => g.satisfier === 'inert').map(([k]) => k),
  );
  // Two sources, because there are two ways a key becomes satisfiable: a write
  // that names it in SQL, and the signature satisfier that binds it from a set.
  const satisfiable = new Set([
    ...[...writes.keys()].filter((k) => !inert.has(k)),
    ...declaredSatisfiableKeys(),
  ]);

  const unexplained = [...required].filter((k) => !satisfiable.has(k) && !recorded.has(k)).sort();
  assert.deepEqual(unexplained, [],
    'these obligations are seeded required:1 and nothing can ever set them to '
    + "'satisfied', so the user carries them forever and their trust score can never "
    + 'reach 100. Build a satisfier, or add an entry to UNSATISFIABLE_TODAY stating '
    + `why not:\n  ${unexplained.join('\n  ')}`);

  // An entry for a key no seeder requires would be recording a gap nobody has.
  const unrequired = [...recorded].filter((k) => !required.has(k)).sort();
  assert.deepEqual(unrequired, [],
    `these are recorded as unsatisfiable but no seeder marks them required:\n  ${unrequired.join('\n  ')}`);

  // Anti-rot, the direction an allowlist normally rots in: an entry whose gap has
  // been closed is a false statement nothing else would notice. Each kind is proven
  // the way only that kind can be.
  const phantom = unknownColumns();
  for (const [key, gap] of Object.entries(UNSATISFIABLE_TODAY)) {
    assert.ok(gap.why.length > 25, `${key}'s entry does not say why it cannot be satisfied`);

    if (gap.satisfier === 'none') {
      // Checked against the UNION, not just the textual writes: adding a key to
      // SATISFIABLE_BY_SIGNATURE is exactly as much a satisfier as naming it in
      // SQL, and an entry that survived that would be a false statement.
      assert.ok(!satisfiable.has(key),
        `${key} is recorded as having NO satisfier, but one now covers it `
        + `(${[...(writes.get(key) ?? ['SATISFIABLE_BY_SIGNATURE'])].join(', ')}). If it can `
        + `satisfy the obligation, delete this entry; if it cannot, change the entry to `
        + `satisfier:'inert' and name what blocks it.`);
      continue;
    }

    assert.ok(writes.has(key),
      `${key}'s entry says a write site exists and is inert, but no statement writes `
      + `'satisfied' for it any more. Change the entry to satisfier:'none', or delete it.`);
    assert.ok(gap.blockedBy, `${key} is recorded inert without naming what blocks it`);

    // THE SELF-PROVING HALF. `unknownColumns()` is the repo's own harvest of every
    // column the worker reads that no table defines — the same function
    // `schema_guards.test.mjs` pins to exactly this one key. Not re-derived here.
    const sites = phantom.get(gap.blockedBy!);
    assert.ok(sites,
      `${key} is recorded inert because ${gap.blockedBy} does not exist, but the schema `
      + `harvest no longer reports it as a phantom column — either the column was added or `
      + `the query was rewritten off it. Re-check whether ${key} can now be satisfied, and `
      + `delete this entry if it can.`);
    // And the blocker must be read by the very file holding the write, or it is
    // some unrelated phantom standing in as an alibi.
    const files = writes.get(key)!;
    assert.ok(sites!.some((s) => [...files].some((f) => s.startsWith(`${f}:`))),
      `${gap.blockedBy} is a phantom column but it is read at ${sites!.join(', ')}, none of `
      + `which is where ${key}'s write site lives (${[...files].join(', ')}). The entry no `
      + `longer describes what blocks this obligation.`);
  }
});

test('the parsers found both sides, so the comparison above is not vacuous', () => {
  // A parser that silently finds nothing makes every assertion above pass. Both
  // sides are pinned to counts a real change would move.
  const required = requiredKeys();
  const { writes, sites } = writeSites();

  assert.ok(required.size >= 8,
    `expected at least 8 keys marked required across the seeders, found ${required.size}`);
  for (const k of ['tos_v1', 'privacy_v1', 'kyb_v1', 'accreditation_v1', 'partner_msa_v1']) {
    assert.ok(required.has(k), `${k} is required somewhere but the parser missed it`);
  }
  assert.equal(sites, 5,
    `expected exactly 5 writes of status='satisfied' across the three files, found ${sites} — `
    + 'a new one means a new satisfier; update UNSATISFIABLE_TODAY and this count together');
  // Three of the five name their key in SQL. The other two —
  // `satisfyObligationFromEnvelope` and `recordTermsAcceptance` — bind it, so they
  // are deliberately absent here and accounted for by `declaredSatisfiableKeys()`.
  assert.deepEqual([...writes.keys()].sort(), ['kyb_v1', 'kyc_v1', 'partner_msa_v1'],
    'the set of keys a satisfied-write is attributed to changed');
  assert.deepEqual([...declaredSatisfiableKeys()].sort(), [
    'founder_nda_v1', 'investor_nda_v1', 'mentor_disclaimer_v1',
    'mentor_nda_v1', 'privacy_v1', 'tos_v1',
  ], 'the declared satisfier scope changed — if a key was added, delete its '
    + 'UNSATISFIABLE_TODAY entry and prove it behaviourally; accreditation_v1 in '
    + 'particular must not appear here without counsel');
  // The number this file exists to move: obligations with a satisfier that can
  // actually run. It was 2 when the measurement landed; it is 8 now, and the two
  // that remain are the two nobody can close without a policy decision.
  const working = [
    ...[...writes.keys()].filter((k) => UNSATISFIABLE_TODAY[k]?.satisfier !== 'inert'),
    ...declaredSatisfiableKeys(),
  ].sort();
  assert.deepEqual(working, [
    'founder_nda_v1', 'investor_nda_v1', 'kyc_v1', 'mentor_disclaimer_v1',
    'mentor_nda_v1', 'partner_msa_v1', 'privacy_v1', 'tos_v1',
  ], 'the set of obligations with a satisfier that can actually run changed');
});
