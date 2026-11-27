/**
 * D6242 (#6242): Eadwyn's `funds/lps` (Summarise this LP) and `funds/reporting` (Draft the letter) zone drafts,
 * through `POST /api/research/drafts` with Workers AI stubbed to keep its prompt.
 *
 *   · the LP summary reads that one LP's register row, ledger lines, receipts and comms log, and no other LP's;
 *   · the GP gate is `requireFundGp`'s: another GP, a GP below the tier, an LP and a scope on another fund draft
 *     nothing, and are answered as an LP with nothing recorded is, 409 `nothing_to_draft`, before any model runs;
 *   · the letter reads the draft period's capital movements and saved Key developments; an issued period, or one
 *     recording neither, drafts nothing;
 *   · a draft that quotes a figure its material does not carry is refused as `draft_unfaithful` and not stored;
 *   · neither surface has an `accept` hook, and the run writes only the GP's own draft row.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/fund_zone_drafts_d6242.test.ts
 *
 * From cloudflare-worker/test/README.md (moved by #6472): D6242: the `funds/lps` and
 * `funds/reporting` drafts read one LP's or one draft period's records behind `requireFundGp`,
 * refuse before the model with nothing to read, refuse a draft quoting an unrecorded figure, and
 * write only the draft row.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { AI_LOG_SCHEMA, AI_BUDGET_MIGRATION } from './_ai_budget_fixture.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { withGuard } from './_guard_stub.mjs';
import { splitStatements } from './_baseline.mjs';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';
import research from '../src/routes/research.ts';
import { RAIL_OPTION_JOBS } from '../src/services/ai/textJobs.ts';
import {
  LETTER_INSTRUCTION_FULL, LP_SUMMARY_INSTRUCTION, holdToMaterial, letterDraftMaterial, lpSummaryMaterial,
  parseFundScope, savedDevelopments, unfoundFigures,
} from '../src/services/fundZoneDrafts.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const MIGRATIONS = resolve(ROOT, 'cloudflare-worker/sql/migrations');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ADMIN = 1, GP = 40, OTHER_GP = 41, LOW_GP = 42, LP_USER = 10;

/** Baseline + every later migration, each statement tolerated where the baseline already holds it. */
function built(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8'));
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort(compareMigrations)
    .filter((f) => migrationNumber(f) > BASELINE_CUTOFF);
  for (const f of files) {
    for (const stmt of splitStatements(readFileSync(resolve(MIGRATIONS, f), 'utf8'))) {
      try { db.exec(stmt); } catch { /* already present, or names an object this fixture does not need */ }
    }
  }
  for (const stmt of splitStatements(AI_LOG_SCHEMA + AI_BUDGET_MIGRATION)) { try { db.exec(stmt); } catch { /* present */ } }
  return db;
}
const BUILT = built();

function seeded(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  const ddl = (BUILT.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
                               ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END`).all() as any[]).map((r) => r.sql);
  for (const s of ddl) { try { db.exec(s); } catch { /* views and triggers that name absent objects */ } }
  // The AI fixture's rows (its plans), which a schema replay does not carry.
  for (const stmt of splitStatements(AI_LOG_SCHEMA + AI_BUDGET_MIGRATION)) { try { db.exec(stmt); } catch { /* present */ } }
  db.exec(`
    INSERT INTO users (id, email, name, role, is_active, investor_tier, investor_subscription_status, kyc_status) VALUES
      (${ADMIN}, 'a@example.test', 'Admin', 'admin', 1, 'free', 'active', 'approved'),
      (${GP}, 'gp@example.test', 'Gee Pee', 'investor', 1, 'institutional', 'active', 'approved'),
      (${OTHER_GP}, 'og@example.test', 'Other GP', 'investor', 1, 'institutional', 'active', 'approved'),
      (${LOW_GP}, 'low@example.test', 'Low Tier GP', 'investor', 1, 'free', 'active', 'approved'),
      (${LP_USER}, 'lp@example.test', 'Ell Pee', 'investor', 1, 'free', 'active', 'approved');
    INSERT INTO vc_funds (id, name, gp_user_id) VALUES (1, 'Fund One', ${GP}), (2, 'Fund Two', ${OTHER_GP}), (3, 'Fund Three', ${LOW_GP});
    INSERT INTO limited_partners (id, fund_id, user_id, name, email, commitment_amount, invested_amount, status, commitment_date) VALUES
      (100, 1, ${LP_USER}, 'Account LP', 'lp@example.test', 1000000, 250, 'committed', '2026-01-15'),
      (101, 1, NULL, 'Family Co', 'fam@lp.example', 777777, 333, 'committed', NULL),
      (102, 1, NULL, 'Empty LP', 'empty@lp.example', 0, 0, 'committed', NULL),
      (200, 2, NULL, 'Other fund LP', 'x@lp.example', 700, 0, 'committed', NULL),
      (300, 3, NULL, 'Low fund LP', 'y@lp.example', 900, 0, 'committed', NULL);
    INSERT INTO fund_capital_calls (id, uid, fund_id, call_number, amount_cents, purpose, due_date, line_count, issued_by, created_at)
      VALUES (7, 'fc7', 1, 3, 150000, 'Follow-on in Acme', '2026-09-30', 2, ${GP}, '2026-08-02 10:00:00');
    INSERT INTO capital_calls (id, limited_partner_id, amount, amount_cents, status, due_date, fund_call_id) VALUES
      (900, 100, 1000, 100000, 'pending', '2026-09-30', 7),
      (901, 101, 500, 50000, 'pending', '2026-09-30', 7),
      (950, 200, 700, 70000, 'pending', NULL, NULL),
      (960, 300, 900, 90000, 'pending', NULL, NULL);
    INSERT INTO capital_call_receipts (uid, capital_call_id, limited_partner_id, fund_id, amount_cents, received_on, reference, recorded_by) VALUES
      ('r1', 900, 100, 1, 25000, '2026-09-20', 'WIRE-A1', ${GP}),
      ('r2', 901, 101, 1, 33333, '2026-09-21', 'WIRE-B2', ${GP});
    INSERT INTO fund_lp_communications (fund_id, lp_id, kind, subject, sent_at, logged_by, capital_call_id) VALUES
      (1, 100, 'call_notice', 'Call 3 notice', '2026-09-01 09:00:00', ${GP}, 900),
      (1, 101, 'update', 'Family only subject', '2026-09-02 09:00:00', ${GP}, NULL);
    INSERT INTO fund_distributions (fund_id, lp_id, amount_cents, distribution_type, status, distributed_at) VALUES
      (1, 100, 4000000, 'exit_proceeds', 'paid', '2026-09-15'), (1, 101, 2000000, 'exit_proceeds', 'paid', '2026-09-15');
    INSERT INTO fund_report_periods (id, fund_id, period, period_start, period_end, notes, status) VALUES
      (500, 1, 'Q3 2026', '2026-07-01', '2026-09-30',
        '{"letter":[],"developments":[{"date":"2026-08-12","title":"Acme closed its Series A","body":"Led by a recorded investor."}],"outlook":["Not for the letter."],"subsequent":[]}', 'draft'),
      (501, 1, 'Q2 2026', '2026-04-01', '2026-06-30', '{"developments":[{"date":"2026-05-01","title":"Issued","body":"x"}]}', 'issued'),
      (502, 1, 'Q4 2026', '', '', '{}', 'draft'),
      (503, 1, 'Q1 2027', '', '', '{"developments":[{"date":"2027-02-03","title":"Beta shipped","body":""}]}', 'draft'),
      (600, 2, 'Q3 2026', '2026-07-01', '2026-09-30', '{"developments":[{"date":"2026-08-01","title":"Other fund news","body":"x"}]}', 'draft');
  `);
  return db;
}

/** One press of a band: the status, the stored body, and the prompt the model was handed (null when it never ran). */
async function press(db: DatabaseSync, who: number, surface: string, scopeKey: string, answer: string | ((prompt: string) => string) = 'A drafted summary.') {
  let prompt: string | null = null;
  const AI = withGuard({
    run: async (_model: string, payload: any) => {
      const messages = payload?.messages || [];
      prompt = String(messages[messages.length - 1]?.content ?? '');
      return { response: typeof answer === 'function' ? answer(prompt) : answer };
    },
  });
  const role = who === ADMIN ? 'admin' : 'investor';
  const auth = await new SignJWT({ user_id: who, role }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await research.fetch(new Request('http://x/drafts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${auth}`, 'content-type': 'application/json' },
    body: JSON.stringify({ surface, scope_key: scopeKey, page: '/funds/lps' }),
  }), { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), AI } as any);
  return { status: res.status, prompt: prompt as string | null, body: await res.json().catch(() => null) as any };
}

const drafts = (db: DatabaseSync) => db.prepare('SELECT owner_user_id, surface, scope_key, body, accepted_at FROM research_zone_drafts').all() as any[];
const fundRows = (db: DatabaseSync) => JSON.stringify([
  db.prepare('SELECT * FROM fund_report_periods ORDER BY id').all(),
  db.prepare('SELECT * FROM limited_partners ORDER BY id').all(),
  db.prepare('SELECT * FROM fund_lp_communications ORDER BY id').all(),
]);

// ------------------------------------------------------------------ funds/lps

test('Summarise this LP reads that LP\'s commitment, lines, receipts and comms log, and no other LP\'s', async () => {
  const db = seeded();
  const before = fundRows(db);
  const r = await press(db, GP, 'funds/lps', '1:100', 'Account LP committed $1,000,000 and owes $750.00 on Call 3, due 2026-09-30.');
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const prompt = r.prompt!;
  assert.ok(prompt.startsWith(LP_SUMMARY_INSTRUCTION), 'the surface\'s own instruction leads the prompt');
  for (const fact of ['LP: Ell Pee, on the fund Fund One' /* the linked account's name, as the register shows it */, 'Commitment: $1,000,000', 'Paid to date: $250', 'Committed on: 2026-01-15',
    'Called to date: $1,000.00', 'Call 3, due 2026-09-30: owed $1,000.00; received $250.00; outstanding $750.00; Part received; received 2026-09-20 (reference WIRE-A1)',
    'Logged as sent 2026-09-01: Call notice, "Call 3 notice", logged by Gee Pee']) {
    assert.ok(prompt.includes(fact), `the material lacks: ${fact}`);
  }
  // The other LP of the same fund, and the other funds, never reach the model.
  for (const other of ['Family Co', '777,777', '$333', 'WIRE-B2', '$333.33', 'Family only subject', 'Other fund LP', 'Fund Two', '$500.00', '$40,000.00']) {
    assert.ok(!prompt.includes(other), `another LP's record reached the model: ${other}`);
  }
  // Kept as the GP's own draft, unaccepted, scoped to the LP; no fund record changed.
  assert.deepEqual(drafts(db).map((d) => ({ ...d })), [{ owner_user_id: GP, surface: 'funds/lps', scope_key: '1:100', body: 'Account LP committed $1,000,000 and owes $750.00 on Call 3, due 2026-09-30.', accepted_at: null }]);
  assert.equal(fundRows(db), before, 'the run wrote a fund record');
});

test('Summarise this LP: an admin drafts on any fund; another GP, a GP below the tier, an LP and a foreign scope draft nothing', async () => {
  const db = seeded();
  assert.equal((await press(db, ADMIN, 'funds/lps', '2:200')).status, 201, 'an admin operates every fund');
  for (const [who, scope, why] of [
    [OTHER_GP, '1:100', 'the GP of another fund'],
    [LOW_GP, '3:300', 'a GP below the institutional tier'],
    [LP_USER, '1:100', 'the LP themself'],
    [GP, '1:200', 'an LP of another fund named under this fund'],
    [GP, '2:200', 'another GP\'s fund'],
    [GP, '1:9999', 'an LP that does not exist'],
    ...['100', '1:', ':100', '01:100', '1:100.0', '1:100 OR 1=1', '1:-1', ''].map((s) => [GP, s, `scope ${JSON.stringify(s)}`]),
  ] as Array<[number, string, string]>) {
    const r = await press(db, who, 'funds/lps', scope);
    assert.equal(r.status, 409, `${why}: ${r.status}`);
    assert.equal(r.body?.detail, 'nothing_to_draft', `${why}: answered as an LP with nothing recorded`);
    assert.equal(r.prompt, null, `${why}: the model ran`);
  }
  assert.equal(drafts(db).length, 1, 'a refusal stored a draft');
});

test('Summarise this LP: with nothing recorded the run is refused before the model and nothing is stored', async () => {
  const db = seeded();
  const r = await press(db, GP, 'funds/lps', '1:102');
  assert.equal(r.status, 409);
  assert.equal(r.body?.detail, 'nothing_to_draft');
  assert.equal(r.prompt, null);
  assert.equal(drafts(db).length, 0);
});

test('a draft quoting a figure that is not on the record is refused as unfaithful and not stored', async () => {
  const db = seeded();
  const r = await press(db, GP, 'funds/lps', '1:100', 'Account LP still owes $5,000.00.');
  assert.equal(r.status, 503);
  assert.equal(r.body?.detail, 'draft_unfaithful');
  assert.equal(drafts(db).length, 0);
  const letter = await press(db, GP, 'funds/reporting', '1:500', 'We called $9,999.00 this quarter.');
  assert.equal(letter.body?.detail, 'draft_unfaithful');
  assert.equal(drafts(db).length, 0);
});

// ------------------------------------------------------------------ funds/reporting

test('Draft the letter reads the draft period\'s capital movements and saved Key developments, and writes no period', async () => {
  const db = seeded();
  const before = fundRows(db);
  const r = await press(db, GP, 'funds/reporting', '1:500', (p) => `In Q3 2026 we called $1,500.00 [1]. Acme closed its Series A on 2026-08-12.${p.length ? '' : ''}`);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const prompt = r.prompt!;
  assert.ok(prompt.startsWith(LETTER_INSTRUCTION_FULL));
  for (const fact of ['Period: Q3 2026 (2026-07-01 to 2026-09-30)', 'Capital call 3, recorded 2026-08-02: $1,500.00, due 2026-09-30, for Follow-on in Acme',
    'Distribution, exit proceeds, paid 2026-09-15: $60,000.00 across 2 LPs', 'Key developments recorded on this period:', '2026-08-12, Acme closed its Series A: Led by a recorded investor.']) {
    assert.ok(prompt.includes(fact), `the material lacks: ${fact}`);
  }
  for (const other of ['Not for the letter.', 'Other fund news', 'Issued']) assert.ok(!prompt.includes(other), `the letter read ${other}`);
  assert.equal(drafts(db)[0].scope_key, '1:500');
  assert.equal(fundRows(db), before, 'drafting the letter saved the period');
});

test('Draft the letter: an issued period, a period recording nothing, and another GP\'s period draft nothing', async () => {
  const db = seeded();
  for (const [who, scope, why] of [[GP, '1:501', 'an issued period'], [GP, '1:502', 'no dates and no developments'],
    [GP, '2:600', 'another GP\'s fund'], [OTHER_GP, '1:500', 'the GP of another fund'], [GP, '1:600', 'another fund\'s period under this fund'], [GP, '500', 'a bare period id']] as Array<[number, string, string]>) {
    const r = await press(db, who, 'funds/reporting', scope);
    assert.equal(r.status, 409, why);
    assert.equal(r.body?.detail, 'nothing_to_draft', why);
    assert.equal(r.prompt, null, `${why}: the model ran`);
  }
  // Developments alone are something to draft from, with the movements said to be none.
  const dev = await press(db, GP, 'funds/reporting', '1:503', 'Beta shipped on 2027-02-03.');
  assert.equal(dev.status, 201, JSON.stringify(dev.body));
  assert.ok(dev.prompt!.includes('Period: Q1 2027, dates not recorded'));
  assert.ok(dev.prompt!.includes('Capital movements: none recorded in this period.'));
  assert.ok(dev.prompt!.includes('2027-02-03, Beta shipped'));
});

// ------------------------------------------------------------------ the builders and the registration

test('unfoundFigures names each number a draft quotes that its material does not carry', () => {
  const material = ['Commitment: $1,000,000', 'Call 3, due 2026-09-30: owed $1,000.00'];
  assert.deepEqual(unfoundFigures('They committed $1,000,000 and owe $1,000.00 on Call 3, due 2026-09-30.', material), []);
  assert.deepEqual(unfoundFigures('They owe $1,000 and 40% of it.', material), ['1,000', '40']);
  assert.equal(holdToMaterial('  Owes $1,000.00.  ', material), 'Owes $1,000.00.');
  assert.equal(holdToMaterial('Owes $2,000.00.', material), null);
  assert.equal(holdToMaterial('Anything.', []), null);
});

test('the LP material is [] with nothing recorded, and a zero commitment alone is nothing', () => {
  const empty = { entries: [], truncated: false };
  assert.deepEqual(lpSummaryMaterial({ fund: { name: 'F' }, lp: { id: 1, name: 'A', commitment_amount: 0 }, ledger: empty, comms: { items: [] } }), []);
  assert.ok(lpSummaryMaterial({ fund: { name: 'F' }, lp: { id: 1, name: 'A', commitment_amount: 5 }, ledger: empty, comms: { items: [] } }).includes('Commitment: $5'));
  const cut = lpSummaryMaterial({ fund: { name: 'F' }, lp: { id: 1, name: 'A', commitment_amount: 5 }, ledger: { entries: [], truncated: true }, comms: { items: [], truncated: true } });
  assert.ok(cut.some((l) => l.startsWith('Called to date: not totalled')));
  assert.ok(cut.includes('Only the newest comms log entries were read.'));
});

test('the letter material and its developments', () => {
  assert.deepEqual(savedDevelopments('not json'), []);
  assert.deepEqual(savedDevelopments('{"developments":[{"date":"2026-01-01","title":"  ","body":"x"},{"date":"2026-01-02","title":"T","body":"B"}]}'), [{ date: '2026-01-02', title: 'T', body: 'B' }]);
  assert.deepEqual(letterDraftMaterial({ period: 'Q', period_start: null, period_end: null, notes: '{}' }, [], []), []);
  assert.equal(parseFundScope('1:2')?.recordId, 2);
  assert.equal(parseFundScope('1:2:3'), null);
});

test('both surfaces are registered with no accept hook, each holds its draft to its material, and each has a job', () => {
  const src = readFileSync(resolve(ROOT, 'cloudflare-worker/src/routes/research.ts'), 'utf8');
  for (const [surface, gather] of [['funds/lps', 'lpSummaryGather'], ['funds/reporting', 'letterDraftGather']]) {
    const at = src.indexOf(`'${surface}': {`);
    assert.ok(at > 0, `${surface} is not registered`);
    const entry = src.slice(at, src.indexOf('\n  },', at));
    assert.doesNotMatch(entry, /\n\s+accept:/, `${surface}'s Accept writes a record`);
    assert.match(entry, new RegExp(`gather: \\(c, _userId, scope\\) => ${gather}\\(c, scope\\)`));
    assert.match(entry, new RegExp(`finish: async \\(c, _userId, scope, text\\) => holdToMaterial\\(text, await ${gather}\\(c, scope\\)\\)`));
  }
  assert.equal(RAIL_OPTION_JOBS['draft:lp-summary'], 'IN5');
  assert.equal(RAIL_OPTION_JOBS['draft:quarterly-letter'], 'RA10');
});
