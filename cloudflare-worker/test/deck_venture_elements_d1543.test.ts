/**
 * D1543 (#3781, deck v2 B5) — the venture-record elements and the logos
 * store, on SQLite (the baseline and every migration).
 *
 *   1. Team grid, team bios, use of funds and round terms come from the
 *      venture's records with their Source and grade; no model runs.
 *   2. Round terms carry "Proposed, subject to counsel" until counsel
 *      approves; placing them without it is refused (`subject_to_counsel`).
 *   3. The cap-table summary is off by default, totals only, and never on a
 *      shared link unless the founder includes it.
 *   4. A logo without its customer's permission cannot be placed
 *      (`no_permission`) or sent on a link; the store refuses a permission
 *      with no reference.
 *   5. An interview quote is a manual pick of a consented line, by role,
 *      read through D1556; "not switched on" while the index is absent; an
 *      unconsented line cannot be placed or shared.
 *   6. Who may read and write; no email or user id in any reply.
 *
 * Every name and figure is synthetic.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_venture_elements_d1543.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import ventureRoutes from '../src/routes/deck_venture_elements.ts';
import { GATE_CODES, PERMISSION_LINE, TOTALS_LINE, VENTURE_ELEMENTS } from '../src/services/decks/ventureElements.ts';
import { DEFAULT_SHARE_INCLUDE, shareGatesFor, shareSlides } from '../src/services/decks/shareInclude.ts';
import { ROUND_TERMS_LABEL, ROUND_TERMS_NOTE, slideFootnotes, complianceOf } from '../src/services/decks/compliance.ts';
import { QUOTE_CONSENT_LINE, REASONS } from '../src/services/decks/quoteRetrieval.ts';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { contractErrors } from '../src/contracts/validate.ts';

const JWT_SECRET = 'unit-test-jwt-secret-d1543-venture-elements-0123456789'; // synthetic test fixture
const BASELINE_SQL = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const MIGRATIONS = resolve(process.cwd(), 'cloudflare-worker/sql/migrations');
const BUILT_DDL = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(BASELINE_SQL);
  for (const f of readdirSync(MIGRATIONS).filter((n) => /^\d+_.*\.sql$/.test(n)).sort(compareMigrations).filter((n) => migrationNumber(n) > BASELINE_CUTOFF)) db.exec(readFileSync(resolve(MIGRATIONS, f), 'utf8'));
  return (db.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`).all() as any[]).map((r) => r.sql as string);
})();
const FOUNDER = 10, OTHER = 20, P = 1, Q = 2, DECK = 2;
const IMG_A = '11111111-1111-4111-8111-111111111111';
const IMG_B = '22222222-2222-4222-8222-222222222222';

function world() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const s of BUILT_DDL) { try { db.exec(s); } catch { /* a view or trigger naming an object replayed later */ } }
  const add = db.prepare('INSERT INTO users (id, role, name, display_name, email, is_active, founder_id) VALUES (?, ?, ?, ?, ?, 1, ?)');
  add.run(FOUNDER, 'founder', 'Fay Founder', 'Avery Stone', 'fay@example.test', 1001);
  add.run(OTHER, 'founder', 'Oz Other', null, 'oz@example.test', 1002);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${P}, 'Kestrel Labs', 1001), (${Q}, 'Other Co', 1002)`);
  const deck = db.prepare('INSERT INTO pitch_decks (id, project_id, version, title, slides, is_current) VALUES (?, ?, ?, ?, ?, ?)');
  deck.run(DECK, P, 1, 'Seed v1', '[]', 1);
  deck.run(3, Q, 1, 'Other deck', '[]', 1);
  const img = db.prepare(`INSERT INTO deck_images (uid, project_id, r2_key, mime, source, use, state) VALUES (?, ?, ?, 'image/png', 'upload', 'content', ?)`);
  img.run(IMG_A, P, 'deck-images/1/a.png', 'kept');
  img.run(IMG_B, P, 'deck-images/1/b.png', 'kept');
  return db;
}

function records(db: DatabaseSync) {
  const h = db.prepare('INSERT INTO cap_table_holders (user_id, project_id, name, email, shares, ownership_pct, founder_role, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  h.run(FOUNDER, P, 'Avery Stone', 'avery@example.test', 4_000_000, 40, 'CEO', '2026-10-01');
  h.run(FOUNDER, P, 'Blake Rowe', 'blake@example.test', 3_500_000, 35, 'CTO', '2026-10-02');
  h.run(FOUNDER, P, 'Seed Fund Synth', 'fund@example.test', 2_500_000, 25, null, '2026-10-03');
  db.prepare('UPDATE projects SET use_of_funds = ? WHERE id = ?')
    .run(JSON.stringify([{ label: 'Product & engineering', pct: 60 }, { label: 'GTM: sales and marketing', pct: 40 }]), P);
  db.exec(`INSERT INTO raise_rounds (id, uid, project_id, name, status, pre_money, target_amount, updated_at) VALUES (1, 'r1', ${P}, 'Seed', 'active', 8000000, 2000000, '2026-10-09')`);
}

/** An index stand-in: present is all the pick needs (it never queries it). */
const INDEX = { upsert: async () => null, deleteByIds: async () => null, query: async () => ({ matches: [] }) };

async function call(db: DatabaseSync, who: number, method: string, path: string, body?: unknown, opts: { extra?: Record<string, unknown>; env?: Record<string, unknown> } = {}) {
  const app = new Hono<any>();
  app.route('/api/decks', ventureRoutes);
  const token = await new SignJWT({ user_id: who, role: 'founder', ...(opts.extra || {}) }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await withThrownResponses(() => app.request(`https://app.example.test${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), ...(opts.env || {}) } as any));
  return { status: res.status, body: await res.json().catch(() => null) as any };
}
const el = (db: DatabaseSync, element: string, qs = '', env?: Record<string, unknown>) => call(db, FOUNDER, 'GET', `/api/decks/${DECK}/venture-elements/${element}${qs}`, undefined, { env });
const NO_EMAIL = /@example\.test|"email"|user_id|permitted_by|created_by/;

// 1 ───────────────────────────────────────────────────────────────────────────
test('team grid, team bios and use of funds come from the records, bound, graded, with no model', async () => {
  // Mutations checked: the team grid reading every holder (founder_role filter dropped) → the fund appears and the rows
  // assert fails; a use-of-funds cell as text instead of a binding → the binding assert fails; `model: null` removed → fails.
  const db = world();
  let r = await el(db, 'team_grid');
  assert.equal(r.status, 409, 'nothing recorded is a refusal, never an empty grid');
  assert.equal(r.body.error, 'not_recorded');
  assert.match(r.body.message, /Build › Founding team/);
  records(db);

  r = await el(db, 'team_grid');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.model, null, 'no model ran');
  const grid = r.body.blocks[0];
  assert.deepEqual([grid.kind, grid.element], ['table', 'team_grid']);
  assert.deepEqual(grid.rows.map((row: any[]) => row.map((c) => c.text)), [['Name', 'Role'], ['Avery Stone', 'CEO'], ['Blake Rowe', 'CTO']], 'founders and roles only');
  assert.deepEqual(r.body.bindings.map((b: any) => [b.source_key, b.value, b.grade, b.source]), [['team.founders', 2, 'Measured', 'Recorded']]);
  assert.doesNotMatch(JSON.stringify(r.body), NO_EMAIL);

  r = await el(db, 'team_bios');
  assert.equal(r.status, 200);
  assert.equal(r.body.blocks[0].text, 'Avery Stone — CEO\nBlake Rowe — CTO', 'record-only bios, v0');
  assert.equal(r.body.blocks[0].binding.source_key, 'team.founders');

  r = await el(db, 'use_of_funds');
  assert.equal(r.status, 200);
  const rows = r.body.blocks[0].rows;
  assert.deepEqual(rows.slice(1).map((row: any[]) => [row[0].text, row[1].binding.source_key, row[1].binding.grade]),
    [['Product & engineering', 'raise.use_of_funds.product', 'Stated'], ['GTM: sales and marketing', 'raise.use_of_funds.go_to_market', 'Stated']]);
  assert.deepEqual(r.body.bindings.filter((b: any) => b.value > 0).map((b: any) => b.value), [60, 40], 'the recorded split, never a model\'s');
  assert.equal(r.body.model, null);

  // No model: the service and the route import nothing that runs one.
  for (const f of ['cloudflare-worker/src/services/decks/ventureElements.ts', 'cloudflare-worker/src/routes/deck_venture_elements.ts']) {
    const src = readFileSync(resolve(process.cwd(), f), 'utf8');
    assert.doesNotMatch(src, /aiRouter|services\/ai\/|catalogue|(?<![.\w])run\(|env\.AI\b/, `${f} reaches no model`);
    assert.doesNotMatch(src, /prepare\(\s*`[^`]*\$\{/, `${f}: every statement is a bound literal`);
  }
});

// 2 ───────────────────────────────────────────────────────────────────────────
test('round terms: "Proposed, subject to counsel" until counsel approves; placing them bare is refused', async () => {
  // Mutations checked: the final=1 refusal removed → the 409 assert fails. `some()` → `every()` survives: today every
  // round-terms slot takes one origin from the latest call, so no record state grades the terms half Reviewed.
  const db = world();
  records(db);
  let r = await el(db, 'round_terms');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.label, ROUND_TERMS_LABEL);
  assert.equal(r.body.proposed, true);
  assert.deepEqual(r.body.blocks.map((b: any) => [b.kind, b.label, b.value, b.binding.grade]),
    [['metric', 'Pre-money valuation', '$8M', 'Stated'], ['metric', 'Post-money valuation', '$10M', 'Stated'], ['metric', 'Dilution', '20%', 'Stated']]);
  const card = { blocks: r.body.blocks };
  assert.ok(slideFootnotes(card, complianceOf({}), '2026-11-02').includes(ROUND_TERMS_NOTE), 'every format draws the counsel note under the card');

  r = await el(db, 'round_terms', '?final=1');
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'subject_to_counsel');
  assert.equal(r.body.message, ROUND_TERMS_LABEL);

  db.exec(`INSERT INTO round_calls (uid, project_id, round_id, name, amount_cents, instrument, terms, minimum_cheque_cents, target_close, created_by, terms_hash, counsel_approved_hash, counsel_approved_by, counsel_approved_at, counsel_approval_reference, pre_money_cents, updated_at)
    VALUES ('rc1', ${P}, 1, 'Seed call', 200000000, 'equity', 'Priced round', 2500000, '2026-12-15', ${FOUNDER}, 'h1', 'h1', 77, '2026-10-11', 'ref-1', 1200000000, '2026-10-11')`);
  r = await el(db, 'round_terms', '?final=1');
  assert.equal(r.status, 200, 'counsel approved: placed as they stand');
  assert.equal(r.body.label, null);
  assert.ok(r.body.blocks.every((b: any) => b.binding.grade === 'Reviewed'));
  assert.ok(!slideFootnotes({ blocks: r.body.blocks }, complianceOf({}), '2026-11-02').includes(ROUND_TERMS_NOTE));
});

// 3 ───────────────────────────────────────────────────────────────────────────
test('cap table: off by default, totals only, and never on a shared link unless the founder includes it', async () => {
  // Mutations checked: the not_included check removed → the default read is 200; a holder row added to the table →
  // the "no holder" assert fails; DEFAULT_SHARE_INCLUDE.cap_table true → the default-link assert fails.
  const db = world();
  records(db);
  assert.equal(DEFAULT_SHARE_INCLUDE.cap_table, false);
  const list = await call(db, FOUNDER, 'GET', `/api/decks/${DECK}/venture-elements`);
  assert.equal(list.status, 200);
  assert.deepEqual(Object.keys(list.body.elements).sort(), [...VENTURE_ELEMENTS].sort());
  assert.deepEqual([list.body.elements.cap_table.available, list.body.elements.cap_table.code], [false, 'not_included'], 'left out of the one-click run');

  let r = await el(db, 'cap_table');
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'not_included');
  assert.equal(r.body.message, TOTALS_LINE);
  r = await el(db, 'cap_table', '?include=cap_table&detail=holders');
  assert.equal(r.body.error, 'totals_only');

  r = await el(db, 'cap_table', '?include=cap_table');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const table = r.body.blocks[0];
  assert.equal(table.rows.length, 2, 'a header and a Total row');
  assert.deepEqual([table.rows[1][0].text, table.rows[1][1].binding.source_key, table.rows[1][2].text], ['Total', 'raise.cap_table', '10,000,000']);
  assert.doesNotMatch(JSON.stringify(r.body), /Avery|Blake|Seed Fund|example\.test/, 'no holder is named');

  const placed = [{ title: 'Cap table', blocks: [{ ...table, id: 'b1', grid: { c1: 1, c2: 12, r1: 1, r2: 6 } }] }];
  assert.deepEqual(shareSlides(placed, DEFAULT_SHARE_INCLUDE, await shareGatesFor({ DB: d1Over(db) } as any, P))[0].blocks, [], 'a default link drops it');
  const withRow = [{ blocks: [{ ...placed[0].blocks[0], rows: [...table.rows, [{ text: 'Avery Stone' }, { text: '4000000' }, { text: '' }]] }] }];
  const included = shareSlides(withRow, { ...DEFAULT_SHARE_INCLUDE, cap_table: true })[0].blocks[0];
  assert.deepEqual(included.rows.map((row: any[]) => row[0].text), ['', 'Total'], 'included: the totals, never a holder\'s row');
});

// 4 ───────────────────────────────────────────────────────────────────────────
test('logos: an unpermitted logo cannot be placed or shared; permission needs a reference and can be withdrawn', async () => {
  // Mutations checked: shareGatesFor back to an empty logo set → the permitted logo is dropped from the link; the
  // no_permission branch removed → the unpermitted wall is 200; permissionOf accepting an empty reference → 200 not 400;
  // the store's CHECK removed from 732 → the direct insert succeeds.
  const db = world();
  let r = await call(db, FOUNDER, 'POST', `/api/decks/${DECK}/logos`, { customer_name: 'Harbor Freight Synth', image_uid: IMG_A });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const keyA = r.body.logo.logo_key;
  assert.match(keyA, /^logo_[0-9a-f]{24}$/);
  assert.equal(r.body.logo.permitted, false, 'stored while the founder asks');
  assert.doesNotMatch(JSON.stringify(r.body), NO_EMAIL);

  r = await el(db, 'logo_wall', `?logos=${keyA}`);
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'no_permission');
  assert.equal(r.body.message, PERMISSION_LINE('Harbor Freight Synth'));
  assert.equal(r.body.message, "Harbor Freight Synth hasn't given permission to show their logo.");
  r = await el(db, 'logo_wall');
  assert.equal(r.body.error, 'no_permission', 'none permitted: the wall is refused, not empty');

  // A block forged with the unpermitted key never leaves on a link.
  const forged = [{ blocks: [{ id: 'l1', kind: 'image', element: 'logo_wall', grid: { c1: 1, c2: 3, r1: 1, r2: 2 }, image_url: 'https://app.example.test/x', logo_key: keyA }] }];
  assert.deepEqual(shareSlides(forged, DEFAULT_SHARE_INCLUDE, await shareGatesFor({ DB: d1Over(db) } as any, P))[0].blocks, []);

  r = await call(db, FOUNDER, 'PATCH', `/api/decks/${DECK}/logos/${keyA}`, { permitted: true, permission_reference: '   ' });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'permission_reference_required');
  assert.throws(() => db.prepare(`INSERT INTO deck_logos (project_id, logo_key, customer_name, image_uid, permitted) VALUES (${P}, 'logo_000000000000000000000000', 'X', '${IMG_B}', 1)`).run(),
    /CHECK constraint/, 'the store itself refuses a permission with no reference or date');

  r = await call(db, FOUNDER, 'PATCH', `/api/decks/${DECK}/logos/${keyA}`, { permitted: true, permission_reference: 'Email from their CMO, 30 Oct' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.logo.permitted, true);
  r = await call(db, FOUNDER, 'POST', `/api/decks/${DECK}/logos`, { customer_name: 'Quay Synth', image_uid: IMG_B });
  const keyB = r.body.logo.logo_key;

  r = await el(db, 'logo_wall');
  assert.equal(r.status, 200, 'unasked: the permitted ones only');
  assert.deepEqual(r.body.blocks.map((b: any) => [b.kind, b.tag, b.logo_key]), [['image', 'logo', keyA]]);
  assert.equal(r.body.blocks[0].image_url, `https://app.example.test/api/decks/images/${IMG_A}/file`);
  r = await el(db, 'logo_wall', `?logos=${keyA},${keyB}`);
  assert.equal(r.status, 409, 'asked for by key: one unpermitted logo refuses the wall');
  assert.equal(r.body.message, PERMISSION_LINE('Quay Synth'));

  const wall = [{ blocks: [
    { id: 'l1', kind: 'image', element: 'logo_wall', grid: { c1: 1, c2: 3, r1: 1, r2: 2 }, image_url: 'https://app.example.test/a', logo_key: keyA },
    { id: 'l2', kind: 'image', element: 'logo_wall', grid: { c1: 4, c2: 6, r1: 1, r2: 2 }, image_url: 'https://app.example.test/b', logo_key: keyB },
  ] }];
  let sent = shareSlides(wall, DEFAULT_SHARE_INCLUDE, await shareGatesFor({ DB: d1Over(db) } as any, P))[0].blocks;
  assert.deepEqual(sent.map((b: any) => b.id), ['l1'], 'the permitted logo goes, the other never');
  assert.ok(!('logo_key' in sent[0]), 'the viewer gets the block, not its key');

  r = await call(db, FOUNDER, 'PATCH', `/api/decks/${DECK}/logos/${keyA}`, { permitted: false });
  assert.equal(r.body.logo.permitted, false);
  sent = shareSlides(wall, DEFAULT_SHARE_INCLUDE, await shareGatesFor({ DB: d1Over(db) } as any, P))[0].blocks;
  assert.deepEqual(sent, [], 'withdrawn: off every link at once');
  assert.equal((await call(db, FOUNDER, 'DELETE', `/api/decks/${DECK}/logos/${keyB}`)).body.deleted, true);
});

// 5 ───────────────────────────────────────────────────────────────────────────
test('interview quote: a manual pick of a consented line, by role; not switched on until the index is', async () => {
  // Mutations checked: the quoteIndex check removed → the not-switched-on read picks a line; pickQuote using a raw
  // segment read (no consent clause) → the unconsented pick is 200; the attribution set to the name → the name assert fails.
  const db = world();
  db.exec(`INSERT INTO discovery_interviews (id, project_id, interviewee_name, interviewee_role, interviewee_company, interview_date, quote_consent, stage) VALUES
      (1, ${P}, 'Rowan Synth', 'Head of Operations', 'Synthetic Freight Co', '2026-10-01', 1, 'done'),
      (2, ${P}, 'Uma Synth', 'CFO', 'Synthetic Co', '2026-10-02', 0, 'done');
    INSERT INTO interview_sessions (id, uid, interview_id, project_id, created_by_user_id, channel, status, consent_status, consent_at) VALUES
      (11, 'sess-ok', 1, ${P}, ${FOUNDER}, 'video', 'reviewed', 'given', '2026-10-01 10:00:00'),
      (12, 'sess-no-quote', 2, ${P}, ${FOUNDER}, 'video', 'reviewed', 'given', '2026-10-02 10:00:00');
    INSERT INTO interview_transcript_segments (id, session_id, source, start_ms, end_ms, speaker_label, text) VALUES
      (101, 11, 'final', 1000, 9000, 'Rowan Synth', 'We reconcile every freight invoice by hand and it takes two days each month.'),
      (102, 12, 'final', 1000, 9000, 'Uma Synth', 'This line comes from an interview that declined to be quoted at all.');`);
  let r = await el(db, 'interview_quote', '?segment=101');
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'quotes_not_switched_on');
  assert.equal(r.body.message, REASONS.not_set_up);

  const on = { DECK_QUOTES: INDEX };
  r = await el(db, 'interview_quote', '', on);
  assert.equal(r.body.error, 'pick_required', 'a manual pick, never chosen for the founder');
  r = await el(db, 'interview_quote', '?segment=102', on);
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'no_consent');
  assert.equal(r.body.message, QUOTE_CONSENT_LINE);

  r = await el(db, 'interview_quote', '?segment=101', on);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.blocks[0].text, '“We reconcile every freight invoice by hand and it takes two days each month.” — Head of Operations');
  assert.equal(r.body.blocks[0].session_uid, 'sess-ok');
  assert.deepEqual([r.body.quote.attribution, r.body.quote.consent, r.body.quote.grade], ['Head of Operations', 'given', 'Measured']);
  assert.doesNotMatch(JSON.stringify(r.body), /Rowan|Synthetic Freight/, 'by role, never by name or company');

  const gates = await shareGatesFor({ DB: d1Over(db) } as any, P);
  const cards = [{ blocks: [
    { ...r.body.blocks[0], id: 'q1', grid: { c1: 1, c2: 6, r1: 1, r2: 2 } },
    { id: 'q2', kind: 'text', element: 'interview_quote', grid: { c1: 7, c2: 12, r1: 1, r2: 2 }, text: '“forged”', session_uid: 'sess-no-quote' },
  ] }];
  assert.deepEqual(shareSlides(cards, DEFAULT_SHARE_INCLUDE, gates)[0].blocks.map((b: any) => b.id), ['q1'], 'an unconsented quote never leaves on a link');

  const list = await call(db, FOUNDER, 'GET', `/api/decks/${DECK}/venture-elements`);
  assert.equal(list.body.elements.interview_quote.code, 'quotes_not_switched_on', 'the one-click run leaves it out');
});

// 6 ───────────────────────────────────────────────────────────────────────────
test('who: another venture cannot read or write; a support session cannot record a permission; refusals are codes', async () => {
  const db = world();
  records(db);
  assert.equal((await call(db, OTHER, 'GET', `/api/decks/${DECK}/venture-elements`)).status, 403);
  assert.equal((await call(db, OTHER, 'GET', `/api/decks/${DECK}/venture-elements/team_grid`)).status, 403);
  assert.equal((await call(db, OTHER, 'GET', `/api/decks/${DECK}/logos`)).status, 403);
  assert.equal((await call(db, OTHER, 'POST', `/api/decks/${DECK}/logos`, { customer_name: 'X', image_uid: IMG_A })).status, 403);
  assert.equal((await call(db, FOUNDER, 'GET', '/api/decks/99/venture-elements')).status, 404);
  const support = await call(db, FOUNDER, 'POST', `/api/decks/${DECK}/logos`, { customer_name: 'X', image_uid: IMG_A }, { extra: { impersonated_by: 1 } });
  assert.equal(support.status, 403);
  assert.equal(support.body.error, 'support_session_refused');
  const other = await call(db, FOUNDER, 'POST', `/api/decks/${DECK}/logos`, { customer_name: 'X', image_uid: '33333333-3333-4333-8333-333333333333' });
  assert.equal(other.body.error, 'image_not_found', 'a logo is one of the venture\'s own kept pictures');
  const unknown = await call(db, FOUNDER, 'GET', `/api/decks/${DECK}/venture-elements/pie_chart`);
  assert.deepEqual([unknown.status, unknown.body.error], [400, 'unknown_element']);
  for (const code of ['no_consent', 'no_permission', 'totals_only', 'subject_to_counsel', 'not_included', 'quotes_not_switched_on']) {
    assert.ok(code in GATE_CODES, `${code} is a documented gate code`);
  }
  const d = readFileSync(resolve(process.cwd(), 'documentation/architecture/decisions/D1543.md'), 'utf8');
  for (const code of Object.keys(GATE_CODES)) assert.match(d, new RegExp(`\`${code}\``), `D1543 documents ${code}`);
  assert.match(d, /732_deck_logos\.sql/);
});

// 7 ───────────────────────────────────────────────────────────────────────────
test('the replies match the ventureElements contract (D1511): the one-click list and every placed element', async () => {
  // Mutations checked: a stray key on an answer, or a gate code the contract does not list, fails it.
  const schema = JSON.parse(readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/contracts/deckVentureElements.schema.json'), 'utf8'));
  const db = world();
  records(db);
  const list = await call(db, FOUNDER, 'GET', `/api/decks/${DECK}/venture-elements`);
  assert.equal(list.status, 200);
  assert.deepEqual(contractErrors(schema, list.body), [], 'the one-click list');
  let placed = 0;
  for (const element of VENTURE_ELEMENTS) {
    const r = await el(db, element, element === 'cap_table' ? '?include=cap_table' : '');
    if (r.status !== 200) continue;
    placed += 1;
    assert.deepEqual(contractErrors(schema, r.body), [], element);
  }
  assert.ok(placed >= 3, `several elements are placed in this world (${placed})`);
  const answer = list.body.elements.cap_table;
  assert.notDeepEqual(contractErrors(schema, { ...list.body, elements: { ...list.body.elements, cap_table: { ...answer, stray: 1 } } }), []);
  assert.notDeepEqual(contractErrors(schema, { ...list.body, elements: { ...list.body.elements, cap_table: { ...answer, code: 'other' } } }), []);
});
