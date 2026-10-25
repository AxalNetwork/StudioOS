/**
 * D1021 (#2858) — Cap table part 6: proposals from a close, and Eadwyn's read
 * of a signed document (non-money terms only).
 *
 * Run on a database built from the baseline and every migration, as
 * production builds it, through the real routes, with the model stubbed.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/cap_table_close_d1021.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';

import captable from '../src/routes/captable.ts';
import { amountMinor, sharesFor } from '../src/services/capTableClose.ts';
import { AMOUNTS, NOT_FOUND, pagesOf, screenRead } from '../src/services/capTableDocumentRead.ts';
import { __resetForTest } from '../src/services/aiRouter.ts';
import { withGuard } from './_guard_stub.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { splitStatements } from './_baseline.mjs';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const MIGRATIONS = resolve(ROOT, 'cloudflare-worker/sql/migrations');
const JWT_SECRET = 'unit-test-jwt-secret-d1021-0123456789';

// 1 admin · 4 owner · 5 co-founder · 6 advisor · 9 another venture's founder
const USERS: Array<[number, string, number | null]> = [[1, 'admin', null], [4, 'founder', 40], [5, 'founder', 50], [6, 'advisor', null], [9, 'founder', 90]];
const ADMIN = 1, OWNER = 4, COFOUNDER = 5, ADVISOR = 6, OTHER = 9;

function built(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8'));
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql')).sort(compareMigrations)
    .filter((x) => migrationNumber(x) > BASELINE_CUTOFF)) {
    for (const stmt of splitStatements(readFileSync(resolve(MIGRATIONS, f), 'utf8'))) {
      try { db.exec(stmt); } catch { /* already present on the baseline */ }
    }
  }
  return db;
}
const BUILT = built();

// The document Eadwyn reads, as the converter heads it, and what the model answers.
const DOC_MD = [
  '### Page 1', 'SIMPLE AGREEMENT FOR FUTURE EQUITY (Post-Money Valuation Cap)', 'Investor: Bluefern Capital',
  '### Page 2', 'Purchase Amount: $500,000. Post-Money Valuation Cap: $8,000,000.',
  '### Page 3', 'Most Favored Nation. The Investor is entitled to MFN treatment.',
  '### Page 4', 'Executed on 8 October 2026.',
].join('\n');
const GOOD_READ = {
  holder: { value: 'Bluefern Capital', page: 1 },
  instrument_type: { value: 'safe', page: 1 },
  basis: { value: 'post_money', page: 1 },
  mfn: { value: true, page: 3 },
  executed_on: { value: '2026-10-08', page: 4 },
  amount_page: 2, valuation_cap_page: 2, discount_page: null, price_per_share_page: null, shares_page: null,
};

function fresh({ answer = GOOD_READ as unknown, files = true } = {}) {
  __resetForTest();
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  const objs = BUILT.prepare(`SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
                               ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END`).all() as any[];
  for (const o of objs) { try { db.exec(o.sql); } catch { /* views and triggers naming absent objects */ } }
  db.exec('PRAGMA foreign_keys = OFF');
  for (const [id, role, founder] of USERS) {
    db.prepare('INSERT INTO users (id, uid, email, name, role, founder_id, is_active, subscription_tier) VALUES (?, ?, ?, ?, ?, ?, 1, ?)')
      .run(id, `u-${id}`, `person${id}@example.test`, `Person ${id}`, role, founder, 'studio');
  }
  db.exec(`INSERT INTO projects (id, uid, name, founder_id) VALUES (10, 'p-10', 'Synthetic Venture', 40), (20, 'p-20', 'Other Venture', 90);
    INSERT INTO project_members (project_id, user_id, role, status) VALUES (10, ${COFOUNDER}, 'cofounder', 'accepted'), (10, ${ADVISOR}, 'advisor', 'accepted');
    INSERT INTO raise_rounds (id, uid, project_id, name, status) VALUES (1, 'rd-1', 10, 'Seed', 'active'), (2, 'rd-2', 20, 'Seed', 'active');
    INSERT INTO raise_closes (id, uid, project_id, round_id, name, sequence, state, closed_date) VALUES
      (1, 'cl-second', 10, 1, 'Second close', 1, 'closed', '2026-10-09'),
      (2, 'cl-final', 10, 1, 'Final close', 2, 'planned', NULL),
      (3, 'cl-other', 20, 2, 'First close', 0, 'closed', '2026-10-01');
    INSERT INTO raise_prospects (id, uid, project_id, name, firm, stage, amount, commit_status, instrument, close_id) VALUES
      (1, 'pr-harbor', 10, 'Hal Partner', 'Harbor Seed Fund', 'committed', 600000, 'signed', 'equity', 1),
      (2, 'pr-bluefern', 10, 'Bo Partner', 'Bluefern Capital', 'committed', 400000, 'wired', 'equity', 1),
      (3, 'pr-axal', 10, 'Ax Partner', 'Studio Fund I', 'committed', 200000, NULL, 'equity', 1),
      (4, 'pr-soft', 10, 'Soft Angel', NULL, 'committed', 50000, 'soft', 'equity', 1),
      (5, 'pr-later', 10, 'Later Angel', NULL, 'committed', 75000, 'signed', 'equity', 2),
      (6, 'pr-safe', 10, 'Sam Safe', NULL, 'committed', 100000, 'signed', 'safe', 1),
      (7, 'pr-safe-out', 10, 'Una Unsigned', NULL, 'committed', 90000, 'signed', 'safe', 1),
      (8, 'pr-nokind', 10, 'Nia Unknown', NULL, 'committed', 10000, 'signed', NULL, 1),
      (9, 'pr-elsewhere', 20, 'El Sewhere', NULL, 'committed', 10000, 'signed', 'equity', 3);
    INSERT INTO esign_envelopes (id, envelope_uuid, document_type, document_title, document_body, body_sha256, status, created_by) VALUES
      (1, 'env-1', 'safe', 'SAFE', 'x', 'h', 'completed', 4), (2, 'env-2', 'safe', 'SAFE', 'x', 'h', 'sent', 4);
    INSERT INTO safe_issuances (id, uid, project_id, prospect_id, investor_name, amount_cents, valuation_cap_cents, envelope_id, created_by) VALUES
      (1, 'safe-signed', 10, 6, 'Sam Safe', 10000000, 800000000, 1, 4), (2, 'safe-out', 10, 7, 'Una Unsigned', 9000000, 800000000, 2, 4);
    INSERT INTO deals (id, project_id, status) VALUES (1, 10, 'active');
    INSERT INTO legal_documents (id, deal_id, type, status) VALUES (1, 1, 'spa', 'signed'), (2, 1, 'spa', 'draft');
    INSERT INTO data_room_files (id, uid, project_id, name, r2_key, content_type) VALUES
      (1, 'f-1', 10, 'SPA · Seed.pdf', 'k/spa', 'application/pdf'), (2, 'f-2', 20, 'Elsewhere.pdf', 'k/else', 'application/pdf'),
      (3, 'f-3', 10, 'SAFE · Bluefern Capital.pdf', 'k/safe', 'application/pdf');
    INSERT INTO ai_topup_accounts (user_id, balance_microusd) VALUES (${OWNER}, 5000000), (${COFOUNDER}, 5000000);`);
  const prompts: string[] = [];
  const conversions: unknown[] = [];
  const env: any = {
    DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development',
    AI: withGuard({
      run: async (_model: string, input: any) => {
        prompts.push(JSON.stringify(input?.messages ?? input));
        return { response: typeof answer === 'string' ? answer : JSON.stringify(answer), usage: { prompt_tokens: 40, completion_tokens: 30 } };
      },
      toMarkdown: async (docs: any, opts: any) => { conversions.push(opts); return [{ name: docs[0].name, data: DOC_MD }]; },
    }),
  };
  if (files) env.FILES = { get: async (key: string) => (key.startsWith('k/') ? { arrayBuffer: async () => new TextEncoder().encode('%PDF-1.7').buffer } : null) };
  return { db, env, prompts, conversions };
}

async function call(f: any, id: number, path: string, method = 'GET', body?: unknown) {
  const token = await new SignJWT({ user_id: id }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await captable.request(path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }, f.env);
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { json = null; }
    return { status: res.status, body: json, text };
  } finally { [console.warn, console.error] = saved; }
}
const one = (f: any, sql: string, ...args: any[]) => f.db.prepare(sql).get(...args) as any;
const all = (f: any, sql: string, ...args: any[]) => f.db.prepare(sql).all(...args) as any[];

async function seedClass(f: any) {
  const r = await call(f, OWNER, '/record/10/classes', 'POST', { name: 'Series Seed Preferred', kind: 'preferred', price_per_share_micros: 1_030_000 });
  assert.equal(r.status, 201, r.text);
  return r.body.class.uid as string;
}

async function proposeClose(f: any, who = OWNER, body: Record<string, unknown> = {}) {
  return call(f, who, '/record/10/closes/cl-second/proposals', 'POST', body);
}

const rowOf = (r: any, prospect: string) => r.body.rows.find((x: any) => x.prospect_uid === prospect);

test('the amounts: the venture currency’s smallest unit, and shares rounded down at the person’s price', () => {
  assert.equal(amountMinor(600000, 'USD'), 60_000_000);
  assert.equal(amountMinor(600000, 'JPY'), 600000, 'a currency with no minor unit');
  assert.equal(amountMinor(null, 'USD'), null, 'not recorded is null, never 0');
  assert.equal(amountMinor(-5, 'USD'), null);
  assert.equal(sharesFor(60_000_000, 1_030_000, 'USD'), 582524, '$600,000 at $1.03 is 582,524.27 shares');
  assert.equal(sharesFor(40_000_000, 1_030_000, 'USD'), 388349);
  assert.equal(sharesFor(600000, 1_030_000, 'JPY'), 582524);
  assert.equal(sharesFor(null, 1_030_000, 'USD'), null);
  assert.equal(sharesFor(60_000_000, null, 'USD'), null);
});

test('a closed close proposes one issuance per firm investor, on part 2’s row', async () => {
  const f = fresh();
  try {
    const seed = await seedClass(f);
    const r = await proposeClose(f, OWNER, { class_uid: seed, price_per_share_micros: 1_030_000 });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.body.close, { uid: 'cl-second', name: 'Second close', round_name: 'Seed', state: 'closed', closed_date: '2026-10-09' });
    assert.deepEqual(r.body.proposed.sort(), ['pr-axal', 'pr-bluefern', 'pr-harbor', 'pr-safe', 'pr-safe-out'].sort());
    assert.deepEqual(r.body.skipped, [{ prospect_uid: 'pr-nokind', reason: 'instrument_not_recorded' }], 'an instrument is never guessed');
    // A soft commitment, another close's investor and another venture's are not this close's.
    assert.deepEqual(r.body.rows.map((x: any) => x.prospect_uid).sort(), ['pr-axal', 'pr-bluefern', 'pr-harbor', 'pr-nokind', 'pr-safe', 'pr-safe-out']);

    const harbor = one(f, `SELECT * FROM cap_table_issuances WHERE origin_ref = 'raise_prospect:pr-harbor'`);
    assert.equal(harbor.status, 'proposed');
    assert.equal(harbor.origin, 'close');
    assert.equal(harbor.kind, 'priced');
    assert.equal(harbor.holder_name, 'Harbor Seed Fund', 'the firm, else the person');
    assert.equal(harbor.amount_cents, 60_000_000);
    assert.equal(harbor.currency, 'USD');
    assert.equal(harbor.price_per_share_micros, 1_030_000);
    assert.equal(harbor.shares, 582524);
    assert.equal(harbor.issued_on, '2026-10-09');
    assert.equal(harbor.source, 'document');
    assert.equal(harbor.document_ref, null, 'no signed document is known yet');
    assert.equal(harbor.proposed_by, OWNER);

    // A SAFE sent through StudioOS and countersigned is linked, never copied, and signed.
    const safe = one(f, `SELECT * FROM cap_table_issuances WHERE origin_ref = 'raise_prospect:pr-safe'`);
    assert.equal(safe.kind, 'safe');
    assert.equal(safe.safe_issuance_uid, 'safe-signed');
    assert.equal(safe.amount_cents, null);
    assert.equal(safe.shares, null);
    assert.equal(safe.source, 'signed');
    const out = one(f, `SELECT * FROM cap_table_issuances WHERE origin_ref = 'raise_prospect:pr-safe-out'`);
    assert.equal(out.safe_issuance_uid, null, 'an envelope not completed is not linked as signed');
    assert.equal(out.amount_cents, 9_000_000);
    assert.equal(out.cap_cents, null, 'the cap is the person’s to enter (#2431)');

    assert.equal(rowOf(r, 'pr-harbor').signature.label, 'Not signed yet');
    assert.equal(rowOf(r, 'pr-safe').signature.label, 'Signed');
    assert.equal(rowOf(r, 'pr-safe-out').signature.label, 'Not signed yet');
    assert.equal(one(f, `SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'captable.proposal.created'`).n, 5, 'one audit row each');

    // Part 2's read lists them as proposals; nothing is counted.
    const rec = await call(f, OWNER, '/record/10');
    assert.equal(rec.body.proposals.rows.length, 5);
    assert.equal(rec.body.outstanding.available, false);
  } finally { f.db.close(); }
});

test('a close not closed, another venture’s close, a bad class: refused before anything is written', async () => {
  const f = fresh();
  try {
    const planned = await call(f, OWNER, '/record/10/closes/cl-final/proposals', 'POST', {});
    assert.equal(planned.status, 409);
    assert.equal(planned.body.code, 'close_not_closed');
    const other = await call(f, OWNER, '/record/10/closes/cl-other/proposals', 'POST', {});
    assert.equal(other.status, 404);
    assert.equal(other.body.code, 'unknown_close');
    assert.equal((await call(f, OWNER, '/record/10/closes/cl-other')).status, 404);
    const bad = await proposeClose(f, OWNER, { class_uid: 'nope' });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.code, 'unknown_class');
    const price = await proposeClose(f, OWNER, { price_per_share_micros: 0 });
    assert.equal(price.status, 400);
    assert.equal(one(f, 'SELECT COUNT(*) AS n FROM cap_table_issuances').n, 0);
  } finally { f.db.close(); }
});

test('who may: a co-founder proposes from a close, an advisor reads it, an outsider neither; an admin carries a reason', async () => {
  const f = fresh();
  try {
    assert.equal((await proposeClose(f, ADVISOR)).status, 403);
    assert.equal((await call(f, ADVISOR, '/record/10/closes/cl-second')).status, 200, 'the venture’s read gate');
    assert.equal((await call(f, OTHER, '/record/10/closes/cl-second')).status, 403);
    const noReason = await proposeClose(f, ADMIN);
    assert.equal(noReason.status, 400);
    assert.equal(noReason.body.code, 'reason_required');
    assert.equal(one(f, 'SELECT COUNT(*) AS n FROM cap_table_issuances').n, 0);
    const co = await proposeClose(f, COFOUNDER);
    assert.equal(co.status, 200, co.text);
    assert.equal(one(f, `SELECT proposed_by FROM cap_table_issuances WHERE origin_ref = 'raise_prospect:pr-harbor'`).proposed_by, COFOUNDER);
    // Only the owner records it (owner question 2).
    const uid = rowOf(co, 'pr-safe').proposal.uid;
    assert.equal((await call(f, COFOUNDER, `/record/10/proposals/${uid}/accept`, 'POST', {})).body.code, 'owner_records');
  } finally { f.db.close(); }
});

test('accepted once: a close’s proposal decided on one page is decided on the other, and never proposed again', async () => {
  const f = fresh();
  try {
    const first = await proposeClose(f);
    const harbor = rowOf(first, 'pr-harbor').proposal.uid;
    const bluefern = rowOf(first, 'pr-bluefern').proposal.uid;
    const seed = await seedClass(f);
    // Accepted on the cap table, with the signed copy attached and the class and shares the person gives.
    const acc = await call(f, OWNER, `/record/10/proposals/${harbor}/accept`, 'POST', {
      document_ref: 'data_room_files:1', class_uid: seed, price_per_share_micros: 1_030_000, shares: 582524,
    });
    assert.equal(acc.status, 200, acc.text);
    assert.equal(acc.body.issuance.status, 'recorded');
    // Dismissed, as the Closing room would, on the same row.
    assert.equal((await call(f, OWNER, `/record/10/proposals/${bluefern}/dismiss`, 'POST', { reason: 'Moved to the final close' })).status, 200);

    // The close's own read (the Closing room's) shows each decided.
    const read = await call(f, OWNER, '/record/10/closes/cl-second');
    assert.deepEqual(rowOf(read, 'pr-harbor').proposal, { uid: harbor, status: 'recorded' });
    assert.deepEqual(rowOf(read, 'pr-bluefern').proposal, { uid: bluefern, status: 'dismissed' });
    assert.equal(rowOf(read, 'pr-harbor').signature.label, 'Signed');
    // Deciding it again, from either page, is refused.
    assert.equal((await call(f, OWNER, `/record/10/proposals/${harbor}/accept`, 'POST', {})).body.code, 'not_proposed');
    assert.equal((await call(f, OWNER, `/record/10/proposals/${bluefern}/accept`, 'POST', {})).body.code, 'not_proposed');
    // Running the close again proposes nobody twice: a decided key stays decided.
    const again = await proposeClose(f);
    assert.equal(again.status, 200);
    assert.deepEqual(again.body.proposed, []);
    assert.ok(again.body.already.includes('pr-harbor') && again.body.already.includes('pr-bluefern'));
    assert.equal(one(f, `SELECT COUNT(*) AS n FROM cap_table_issuances WHERE origin = 'close'`).n, 5);
    // The record counts the one it recorded.
    assert.equal((await call(f, OWNER, '/record/10')).body.outstanding.shares, 582524);
  } finally { f.db.close(); }
});

test('a SAFE already on the record (put there by a person, or the Closing room) is listed as already there, not proposed twice', async () => {
  const f = fresh();
  try {
    const rec = await call(f, OWNER, '/record/10/issuances', 'POST', { kind: 'safe', holder_name: 'Sam Safe', safe_issuance_uid: 'safe-signed', source: 'signed' });
    assert.equal(rec.status, 201, rec.text);
    const r = await proposeClose(f);
    assert.equal(r.status, 200, r.text);
    assert.ok(r.body.already.includes('pr-safe'));
    assert.equal(r.body.proposed.includes('pr-safe'), false);
    assert.equal(one(f, `SELECT COUNT(*) AS n FROM cap_table_issuances WHERE safe_issuance_uid = 'safe-signed'`).n, 1);
    assert.equal(r.body.proposed.length, 4, 'the others are still proposed');
  } finally { f.db.close(); }
});

test('an investor whose document is not signed cannot be accepted: “Not signed yet”', async () => {
  const f = fresh();
  try {
    const r = await proposeClose(f);
    const out = rowOf(r, 'pr-safe-out').proposal.uid;
    const terms = { cap_cents: 800_000_000, basis: 'post_money' };
    const none = await call(f, OWNER, `/record/10/proposals/${out}/accept`, 'POST', terms);
    assert.equal(none.status, 409);
    assert.equal(none.body.code, 'not_signed');
    assert.match(none.body.message, /^Not signed yet/);
    // Linking the investor's SAFE whose envelope is not completed is not a signature either.
    const unsignedSafe = await call(f, OWNER, `/record/10/proposals/${out}/accept`, 'POST', { amount_cents: null, safe_issuance_uid: 'safe-out' });
    assert.equal(unsignedSafe.status, 409, unsignedSafe.text);
    assert.equal(unsignedSafe.body.code, 'not_signed');
    const draft = await call(f, OWNER, `/record/10/proposals/${out}/accept`, 'POST', { ...terms, document_ref: 'legal_documents:2' });
    assert.equal(draft.body.code, 'not_signed', 'a legal document not marked signed');
    assert.equal(one(f, 'SELECT status FROM cap_table_issuances WHERE uid = ?', out).status, 'proposed');
    const signed = await call(f, OWNER, `/record/10/proposals/${out}/accept`, 'POST', { ...terms, document_ref: 'legal_documents:1' });
    assert.equal(signed.status, 200, signed.text);
    assert.equal(signed.body.issuance.document_ref, 'legal_documents:1');
    // The countersigned SAFE needs nothing attached.
    const safe = rowOf(r, 'pr-safe').proposal.uid;
    assert.equal((await call(f, OWNER, `/record/10/proposals/${safe}/accept`, 'POST', {})).status, 200);
    // A proposal that is not a close's keeps part 2's rule: no document needed.
    const typed = await call(f, OWNER, '/record/10/proposals', 'POST', { kind: 'safe', holder_name: 'Typed Angel', amount_cents: 100 });
    assert.equal((await call(f, OWNER, `/record/10/proposals/${typed.body.issuance.uid}/accept`, 'POST', {})).status, 200);
  } finally { f.db.close(); }
});

test('the page split: one page per "### Page N", or the whole text as page 1', () => {
  assert.deepEqual(pagesOf(DOC_MD).map((p) => p.page), [1, 2, 3, 4]);
  assert.match(pagesOf(DOC_MD)[1].text, /Purchase Amount/);
  assert.deepEqual(pagesOf('Just text'), [{ page: 1, text: 'Just text' }]);
  assert.deepEqual(pagesOf(''), []);
});

test('the screen: non-money terms with their page, money as a page alone, and no figure survives', () => {
  const pages = pagesOf(DOC_MD);
  const greedy = {
    ...GOOD_READ,
    // Everything a model might add: figures in money keys, in made-up keys and in a term.
    amount: { value: 500000, page: 2 }, amount_value: '$500,000', valuation_cap: '$8,000,000', amount_page: 2,
    discount_page: { value: '20%', page: 2 }, price_per_share_page: '1.03', shares_page: 99,
    extra: 'Purchase Amount $500,000',
  };
  const { terms, amounts } = screenRead(greedy, pages);
  const text = JSON.stringify({ terms, amounts });
  for (const figure of ['500', '8,000,000', '8000000', '20%', '1.03', 'Purchase']) assert.equal(text.includes(figure), false, figure);
  assert.deepEqual(terms.map((t) => [t.key, t.value, t.page]), [
    ['holder', 'Bluefern Capital', 1], ['instrument_type', 'safe', 1], ['basis', 'post_money', 1], ['mfn', true, 3], ['executed_on', '2026-10-08', 4],
  ]);
  assert.deepEqual(amounts.map((a) => [a.key, a.page]), [['amount', 2], ['valuation_cap', 2], ['discount', null], ['price_per_share', null], ['shares', null]]);
  assert.deepEqual(amounts.map((a) => Object.keys(a).sort()), AMOUNTS.map(() => ['found', 'key', 'label', 'note', 'page']), 'a money field has no value key');
  assert.equal(amounts[2].note, NOT_FOUND);
});

test('the screen: a term the document does not hold, or on a page it does not have, is not found', () => {
  const pages = pagesOf(DOC_MD);
  const { terms, amounts } = screenRead({
    holder: { value: 'Someone Else LLC', page: 1 }, // not on page 1
    instrument_type: { value: 'warrant', page: 1 },
    basis: { value: 'post_money', page: 9 }, // no page 9
    mfn: { value: 'yes', page: 3 },
    executed_on: { value: '2026-02-30', page: 4 },
    amount_page: 9, valuation_cap_page: '2',
  }, pages);
  for (const t of terms) assert.deepEqual([t.found, t.value, t.page, t.note], [false, null, null, NOT_FOUND], t.key);
  assert.deepEqual(amounts.map((a) => a.page), [null, 2, null, null, null]);
  // A "holder" that is a figure is a figure, even when the page holds it.
  assert.equal(screenRead({ holder: { value: '$500,000', page: 2 } }, pages).terms[0].found, false);
  assert.equal(screenRead('not json', pages).terms.every((t) => !t.found), true);
});

test('Eadwyn’s read: one metered run on the cap table’s rail, a draft kept for a person’s Accept, nothing recorded', async () => {
  const f = fresh({ answer: { ...GOOD_READ, amount: '$500,000', valuation_cap: 8000000 } });
  try {
    const r = await call(f, COFOUNDER, '/record/10/document-read', 'POST', { document_ref: 'data_room_files:3' });
    assert.equal(r.status, 200, r.text);
    const d = r.body.draft;
    assert.equal(d.document_ref, 'data_room_files:3');
    assert.equal(d.document_name, 'SAFE · Bluefern Capital.pdf');
    assert.equal(d.pages, 4);
    assert.deepEqual(d.terms.find((t: any) => t.key === 'holder'), { key: 'holder', label: 'Holder', found: true, value: 'Bluefern Capital', page: 1, note: null });
    assert.deepEqual(d.amounts.find((a: any) => a.key === 'amount'), { key: 'amount', label: 'Amount', found: true, page: 2, note: null });
    assert.equal(JSON.stringify(r.body).includes('500,000'), false, 'the answer never carries a money figure');
    assert.equal(JSON.stringify(r.body).includes('8000000'), false);
    // The converter is asked for pages without metadata; the model reads them labelled.
    assert.deepEqual(f.conversions[0], { conversionOptions: { pdf: { metadata: false } } });
    assert.ok(f.prompts.some((p) => p.includes('--- Page 2 ---')));
    // Metered and charged to the member who pressed, on the page's rail.
    const usage = all(f, 'SELECT user_id, task, rail_page, rail_option, record_ref, surface FROM ai_usage_logs WHERE guard_for IS NULL');
    assert.equal(usage.length, 1);
    assert.deepEqual({ ...usage[0] }, {
      user_id: COFOUNDER, task: 'rail_legal', rail_page: 'Founder · Raise · Cap table', rail_option: 'draft:raise/document-terms',
      record_ref: 'project:10', surface: '/raise/cap-table',
    });
    // A draft in the rail's proposals, waiting on a person; the record is untouched.
    const kept = all(f, 'SELECT uid, kind, status, payload_json FROM ai_rail_proposals');
    assert.equal(kept.length, 1);
    assert.deepEqual([kept[0].uid, kept[0].kind, kept[0].status], [d.uid, 'draft', 'proposed']);
    assert.equal(kept[0].payload_json.includes('500,000'), false);
    assert.equal(one(f, 'SELECT COUNT(*) AS n FROM cap_table_issuances').n, 0);
    // A second read replaces the draft the first left open.
    await call(f, COFOUNDER, '/record/10/document-read', 'POST', { document_ref: 'data_room_files:3' });
    assert.equal(one(f, `SELECT COUNT(*) AS n FROM ai_rail_proposals WHERE status = 'withdrawn'`).n, 1);
  } finally { f.db.close(); }
});

test('Eadwyn’s read: another venture’s file, a bad ref, an advisor, no storage — refused, and nothing is run', async () => {
  const f = fresh();
  try {
    const other = await call(f, OWNER, '/record/10/document-read', 'POST', { document_ref: 'data_room_files:2' });
    assert.equal(other.status, 400);
    assert.equal(other.body.code, 'unknown_document');
    assert.equal((await call(f, OWNER, '/record/10/document-read', 'POST', { document_ref: 'legal_documents:1' })).body.code, 'bad_document_ref');
    assert.equal((await call(f, ADVISOR, '/record/10/document-read', 'POST', { document_ref: 'data_room_files:1' })).status, 403);
    assert.equal(f.prompts.length, 0);
    const g = fresh({ files: false });
    try {
      const r = await call(g, OWNER, '/record/10/document-read', 'POST', { document_ref: 'data_room_files:1' });
      assert.equal(r.status, 503);
      assert.equal(r.body.code, 'document_read_unavailable');
    } finally { g.db.close(); }
  } finally { f.db.close(); }
});
