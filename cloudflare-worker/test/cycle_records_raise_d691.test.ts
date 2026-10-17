/**
 * D691 (S19-B, #1699) — Raise's seven lists as the canvas draws them
 * (CO:623-629), with ids that are addresses (decision 3), and the links out.
 *
 * #1699 ships these lines of its tests here: test 1's list line (each module's
 * `records_title`, columns, filters and default sort), test 2's list ids, and
 * test 14's links out. The one-record reads (the rest of tests 1, 2, 4 and 5)
 * follow once D690 (S18-A, #1690) registers the record contract.
 *
 * The tables come from schema_baseline.sql through `_baseline.mjs`, with
 * migrations 249, 410, 442 and 463 applied, and the Research fund directory
 * built from 365's CREATE statements with 406 applied whole, so no real fund
 * row is loaded. Migration 459 is D690's and is not on main yet.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/cycle_records_raise_d691.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import cycleRaise from '../src/routes/cycle_raise.ts';
import { MODULES, TOOL_HREF, fundFit, capIdOf, NEVER_EXPIRES } from '../src/services/raiseCycle.ts';
import { saveScenario } from '../src/services/capTableWrites.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const sqlOf = (file: string) => readFileSync(resolve(process.cwd(), `cloudflare-worker/sql/migrations/${file}`), 'utf8');
/** A migration's CREATE TABLE and CREATE INDEX statements only, as research_fund_terms_d597.test.ts reads 365. */
const ddl = (file: string) => sqlOf(file).split(/;\s*\n/)
  .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
  .filter((s) => /^CREATE\s+(TABLE|INDEX)/i.test(s))
  .map((s) => `${s};`).join('\n');

const RECORD_ID = /^[a-z0-9][a-z0-9_-]*$/;
const FOUNDER = 10, ADMIN = 30;
const P = 1, P_OTHER = 2;

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of [
    'users', 'projects', 'activity_logs', 'spinout_deck_overrides', 'pitch_decks', 'pitch_deck_share_tokens',
    'deck_share_views', 'data_room_folders', 'data_room_files', 'data_room_access_log', 'cap_table_scenarios',
    'raise_prospects', 'raise_rounds', 'contacts', 'dd_cases', 'dd_requests',
  ]) db.exec(tableFromBaseline(BASELINE, t));
  const cols = (t: string) => new Set((db.prepare(`SELECT name FROM pragma_table_info('${t}')`).all() as any[]).map((r) => r.name));
  if (!cols('pitch_deck_share_tokens').has('revoked_at')) db.exec('ALTER TABLE pitch_deck_share_tokens ADD COLUMN revoked_at TEXT');
  for (const [c, d] of [['amount', 'REAL'], ['close_id', 'INTEGER'], ['commit_status', 'TEXT'], ['instrument', 'TEXT']]) {
    if (!cols('raise_prospects').has(c)) db.exec(`ALTER TABLE raise_prospects ADD COLUMN ${c} ${d}`);
  }
  db.exec(sqlOf('249_project_metrics.sql'));
  db.exec(sqlOf('410_safe_issuances.sql'));
  db.exec(sqlOf('442_raise_cycle_stores.sql'));
  db.exec(sqlOf('463_raise_record_stores.sql'));
  db.exec(ddl('365_research_eurotech_fund_directory.sql'));
  db.exec(sqlOf('406_research_fund_sources.sql'));
  db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)').run(FOUNDER, 'founder', 'Fay Founder', 'fay@example.test', 1001);
  db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)').run(ADMIN, 'admin', 'Ada Admin', 'ada@example.test');
  db.exec(`INSERT INTO projects (id, name, founder_id, sector) VALUES (${P}, 'Kestrel Labs', 1001, 'artificial intelligence'), (${P_OTHER}, 'Beta Works', 1002, NULL)`);
  return db;
}

/** Every module given rows, with names that must never reach an id. */
const NAMES = ['mira okafor', 'tomas reyes', 'harbour angels', 'northwind capital', 'lin park', 'quinn ventures'];
async function seeded() {
  const db = fixture();
  // Readiness: one item scored with a gap, one scored clean, one unscored.
  db.exec(`INSERT INTO readiness_items (id, project_id, item_key, label, position) VALUES
           (1, ${P}, 'data_room', 'Data room', 2), (2, ${P}, 'deck', 'Pitch deck', 1), (3, ${P}, 'team', 'Team', 6)`);
  db.exec(`INSERT INTO readiness_scores (item_id, project_id, score, evidence, missing, source) VALUES
           (1, ${P}, 5, 'pattern', 'Customer contracts', 'computed'), (2, ${P}, 9, 'measured', NULL, 'computed')`);
  // Narrative versions 1 and 2.
  db.exec(`INSERT INTO spinout_deck_overrides (project_id, field_key, value, version, investor_type, deck_version) VALUES
           (${P}, '_version', '', 1, 'angel', 3), (${P}, '_version', '', 2, 'seed_fund', 4)`);
  // Northwind's contact was active after Quinn's row last changed, so Last contact and Recently updated disagree.
  db.exec(`INSERT INTO contacts (id, uid, project_id, audience, email, name, last_activity_at) VALUES
           (100, 'c100', ${P}, 'investor', 'northwind@example.test', 'Northwind contact', '2026-10-12 10:00:00')`);
  // Deck links: one for a prospect, one with a typed name, one made before 463, one "Never".
  db.exec(`INSERT INTO pitch_decks (id, project_id, version, slides) VALUES (5, ${P}, 1, '[]'), (6, ${P_OTHER}, 1, '[]')`);
  db.exec(`INSERT INTO raise_prospects (id, uid, project_id, contact_id, name, firm, stage, warm_path, updated_at) VALUES
           (5, 'p5', ${P}, 100, 'Northwind Capital', NULL, 'meeting', 'via Lin Park', '2026-10-10 09:00:00'),
           (6, 'p6', ${P}, NULL, 'Quinn Ventures', NULL, 'to_contact', NULL, '2026-10-11 09:00:00'),
           (9, 'p9', ${P_OTHER}, NULL, 'Elsewhere Fund', NULL, 'meeting', NULL, '2026-10-11 09:00:00')`);
  db.exec(`INSERT INTO pitch_deck_share_tokens (id, deck_id, token_hash, expires_at, view_count, last_viewed_at, created_at, prospect_id, investor_label) VALUES
           (41, 5, 'h41', '2999-01-01 00:00:00', 4, '2026-10-12 10:00:00', '2026-10-01 10:00:00', 5, NULL),
           (42, 5, 'h42', '2999-01-01 00:00:00', 1, '2026-10-14 10:00:00', '2026-10-02 10:00:00', NULL, 'Harbour Angels'),
           (43, 5, 'h43', '2026-01-01 00:00:00', 7, '2025-12-20 10:00:00', '2025-12-01 10:00:00', NULL, NULL),
           (44, 5, 'h44', '${NEVER_EXPIRES}', 0, NULL, '2026-10-03 10:00:00', 9, NULL)`);
  // Data room: a file answering this venture's request, one naming another venture's request, one in a folder.
  db.exec(`INSERT INTO dd_cases (id, uid, subject_type, subject_id, subject_label, owner_user_id) VALUES
           (1, 'c1', 'project', ${P}, 'Kestrel Labs', ${ADMIN}), (2, 'c2', 'project', ${P_OTHER}, 'Beta Works', ${ADMIN})`);
  db.exec(`INSERT INTO dd_requests (id, case_id, title) VALUES (7, 1, 'Customer contracts'), (8, 2, 'Their cap table')`);
  db.exec(`INSERT INTO data_room_folders (id, uid, project_id, name) VALUES (3, 'fo3', ${P}, 'Financials')`);
  db.exec(`INSERT INTO data_room_files (id, uid, project_id, folder_id, name, r2_key, visibility, checklist_item, dd_request_id, access_tier, access_expires_at, updated_at) VALUES
           (12, 'f12', ${P}, 3, 'contracts.pdf', 'k12', 'nda', 'customer_contracts', 7, 'committed', '2026-11-30 00:00:00', '2026-10-12 00:00:00'),
           (13, 'f13', ${P}, NULL, 'board.pdf', 'k13', 'open', 'board_consents', 8, 'invited', NULL, '2026-10-09 00:00:00'),
           (14, 'f14', ${P}, 3, 'model.xlsx', 'k14', 'open', NULL, NULL, 'nobody', NULL, '2026-10-01 00:00:00')`);
  // The cap table, saved through the tool's own save, so its entries carry keys.
  const env = { DB: d1Over(db) } as any;
  const saved = await saveScenario(env, {
    actor: { id: FOUNDER, email: 'fay@example.test' }, name: 'Kestrel cap table', projectId: P,
    inputs: {
      founders: [{ name: 'Mira Okafor', shares: 6_000_000 }, { name: 'Tomas Reyes', shares: 4_000_000 }],
      option_pool_pct: 10,
      safes: [{ name: 'Harbour Angels', amount: 250_000, cap: 8_000_000, discount: 0.2 }],
      rounds: [{ name: 'Seed', pre_money: 9_000_000, investment: 2_000_000, post_round_pool_pct: 12 }],
    } as any,
  });
  assert.ok(saved.ok);
  // Use of funds: three sections, a runway, one recorded milestone.
  db.exec(`UPDATE projects SET funding_needed = 1200000,
             use_of_funds = '[{"label":"Product & engineering","pct":30},{"label":"GTM: sales and marketing","pct":50},{"label":"Hiring / runway reserve","pct":20}]',
             use_of_funds_meta = '{"runway_months":12,"milestones":{"product":{"label":"Launch v2","by":"2027-03"}},"deck_synced_at":"2026-10-01"}'
           WHERE id = ${P}`);
  return db;
}

const app = new Hono<any>();
app.route('/api/cycles/raise', cycleRaise);
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 500));

async function read(db: DatabaseSync, slug: string, qs = '', flags: Record<string, string> = {}) {
  const token = await new SignJWT({ user_id: FOUNDER, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await app.request(`/api/cycles/raise/modules/${slug}?project=${P}${qs}`, { headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), ...flags } as any);
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error] = saved; }
}
const overview = async (db: DatabaseSync) => {
  const token = await new SignJWT({ user_id: FOUNDER, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.request(`/api/cycles/raise/overview?project=${P}`, { headers: { Authorization: `Bearer ${token}` } },
    { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
  return (await res.json()) as any;
};

/** Step 3's table: title, columns, filters, default sort. */
const CANVAS: Record<string, { title: string; cols: string[]; filters: string[]; sort: string }> = {
  'fundraising-readiness': { title: 'Readiness items', cols: ['Item', 'Score', 'Evidence', 'Missing', 'Updated'], filters: ['State'], sort: 'Score' },
  'investor-narrative': { title: 'Versions', cols: ['Version', 'Investor type', 'Used by deck', 'Mismatches', 'Date'], filters: ['Investor type'], sort: 'Newest' },
  'pitch-deck': { title: 'Investor links', cols: ['Investor', 'Expires', 'Views', 'Time on deck', 'Most read'], filters: ['State'], sort: 'Last viewed' },
  'data-room': { title: 'Files', cols: ['File', 'Folder', 'Answers request', 'Access', 'Updated'], filters: ['Folder', 'Access', 'Answers', 'Area'], sort: 'Updated' },
  'cap-table': { title: 'Holders', cols: ['Holder', 'Group', 'Instrument', 'Before', 'After round'], filters: ['Group', 'Instrument'], sort: 'Ownership' },
  'use-of-funds': { title: 'Categories', cols: ['Category', 'Share', 'Amount', 'Monthly', 'Milestone'], filters: ['Category'], sort: 'Share' },
  'capital-relationships': { title: 'Investors', cols: ['Investor', 'Stage', 'Last contact', 'Next step', 'Warm path'], filters: ['Stage', 'Fit', 'Path'], sort: 'Last contact' },
};

// ---------------------------------------------------------------------------
// Test 1 (the list line): each list is the canvas's
// ---------------------------------------------------------------------------

test('1: every Raise list has the canvas\'s title, columns, filters and default sort', async () => {
  const db = await seeded();
  assert.deepEqual(MODULES.map((m) => m.slug).sort(), Object.keys(CANVAS).sort());
  for (const m of MODULES) {
    const r = await read(db, m.slug);
    assert.equal(r.status, 200, m.slug);
    const want = CANVAS[m.slug];
    assert.equal(r.body.module.records_title, want.title, `${m.slug} title`);
    assert.deepEqual(r.body.records.cols.map((c: any) => c.label), want.cols, `${m.slug} columns`);
    assert.deepEqual((r.body.records.filters || []).map((f: any) => f.label), want.filters, `${m.slug} filters`);
    assert.equal(r.body.records.sorts[0].label, want.sort, `${m.slug} default sort`);
    // No Add links back to its own module page. The file tool shares the data
    // room's path, so the page is told apart by its mode.
    if (r.body.records.add) {
      const u = new URL(String(r.body.records.add.href), 'https://app.example.test');
      assert.ok(!(u.pathname === `/raise/${m.slug}` && u.searchParams.get('mode') !== 'workspace'), `${m.slug} links to itself`);
    }
  }
  // Capital relationships keeps "Responded to a call" while round calls are on.
  db.exec(sqlOf('436_round_calls.sql'));
  const on = await read(db, 'capital-relationships', '', { ROUND_CALLS_ENABLED: 'true' });
  assert.deepEqual(on.body.records.filters.map((f: any) => f.label), ['Stage', 'Fit', 'Path', 'Source']);
});

test('1: each list sorts by its default with no sort sent, and the filters narrow it', async () => {
  const db = await seeded();
  const ids = async (slug: string, qs = '') => (await read(db, slug, qs)).body.records.rows.map((r: any) => r.id);
  // Score, highest first; the unscored item last.
  assert.deepEqual(await ids('fundraising-readiness'), ['deck', 'data_room', 'team']);
  assert.deepEqual(await ids('fundraising-readiness', '&filter=state:gap'), ['data_room']);
  assert.deepEqual(await ids('fundraising-readiness', '&filter=state:not_scored'), ['team']);
  assert.deepEqual(await ids('fundraising-readiness', '&filter=state:scored'), ['deck', 'data_room']);
  // Last viewed first, a link never opened last.
  assert.deepEqual(await ids('pitch-deck'), [42, 41, 43, 44]);
  assert.deepEqual(await ids('pitch-deck', '&filter=status:expired'), [43]);
  // Updated, newest first.
  assert.deepEqual(await ids('data-room'), [12, 13, 14]);
  assert.deepEqual(await ids('data-room', '&filter=folder:3'), [12, 14]);
  assert.deepEqual(await ids('data-room', '&filter=folder:top'), [13]);
  assert.deepEqual(await ids('data-room', '&filter=access:committed'), [12]);
  assert.deepEqual(await ids('data-room', '&filter=access:nda'), [12]);
  assert.deepEqual(await ids('data-room', '&filter=answers:request'), [12]);
  assert.deepEqual(await ids('data-room', '&filter=answers:checklist'), [13], 'another venture\'s request answers nothing');
  assert.deepEqual(await ids('data-room', '&filter=answers:none'), [14]);
  // Ownership: largest before the round.
  assert.equal((await read(db, 'cap-table')).body.records.rows[0].cells.holder, 'Mira Okafor');
  assert.deepEqual((await read(db, 'cap-table', '&filter=instrument:preferred')).body.records.rows.map((r: any) => r.cells.holder), ['Seed Investors']);
  // Share, largest first; the category filter takes a section key.
  assert.deepEqual(await ids('use-of-funds'), ['go-to-market', 'product', 'reserve']);
  assert.deepEqual(await ids('use-of-funds', '&sort=order'), ['product', 'go-to-market', 'reserve']);
  assert.deepEqual(await ids('use-of-funds', '&filter=category:reserve'), ['reserve']);
  // Last contact, the most recent first; a prospect with none after.
  assert.deepEqual(await ids('capital-relationships'), [5, 6]);
  assert.deepEqual(await ids('capital-relationships', '&sort=recent'), [6, 5]);
  // Path: a recorded warm path, or none.
  assert.deepEqual(await ids('capital-relationships', '&filter=path:has'), [5]);
  assert.deepEqual(await ids('capital-relationships', '&filter=path:none'), [6]);
});

test('1: the cells read the stores 463 added and say Not recorded where nothing is', async () => {
  const db = await seeded();
  const cells = async (slug: string) => Object.fromEntries((await read(db, slug)).body.records.rows.map((r: any) => [r.id, r.cells]));
  const links = await cells('pitch-deck');
  assert.equal(links[41].link, 'Northwind Capital', 'the prospect the link was made for');
  assert.equal(links[42].link, 'Harbour Angels', 'the name typed in');
  assert.equal(links[43].link, 'Link created 2025-12-01', 'a link made before 463 names its day');
  assert.equal(links[44].link, 'Link created 2026-10-03', 'another venture\'s prospect is never named');
  assert.deepEqual(links[44].expires, { text: 'Never', tone: 'ok' });
  assert.deepEqual(links[43].expires, { text: 'Expired', tone: 'muted' });
  const files = await cells('data-room');
  assert.equal(files[12].answers, 'Customer contracts', 'the request it answers');
  assert.equal(files[13].answers, 'Bylaws and board consents', 'a foreign request falls back to the checklist item');
  assert.equal(files[14].answers, null);
  assert.equal(files[12].access, 'Committed investors only · NDA · until 2026-11-30');
  assert.equal(files[14].access, 'Nobody yet');
  const funds = await cells('use-of-funds');
  assert.deepEqual(funds.product, { category: 'Product & engineering', share: 30, amount: 360000, monthly: 30000, milestone: 'Launch v2 by 2027-03' });
  assert.equal(funds.reserve.milestone, null);
  const versions = await cells('investor-narrative');
  assert.equal(versions[2].deck, 'v4');
  const investors = await cells('capital-relationships');
  assert.equal(investors[6].stage, 'Identified', 'to_contact reads Identified');
  const holders = (await read(db, 'cap-table')).body.records.rows;
  assert.equal(holders.find((r: any) => r.cells.holder === 'Harbour Angels').cells.instrument, 'SAFE · $8,000,000 cap');
});

test('1: Fit reads the fund\'s thesis against the venture\'s sector, only for a fund the directory serves', async () => {
  // The crosswalk, never a substring.
  assert.equal(fundFit('Generalist', null), 'fits');
  assert.equal(fundFit('AI · Fintech', 'artificial intelligence'), 'fits');
  assert.equal(fundFit('Fintech', 'artificial intelligence'), 'outside');
  assert.equal(fundFit('Underwater basket weaving', 'artificial intelligence'), 'unclear');
  assert.equal(fundFit('AI', 'Widgets'), 'unclear');
  assert.notEqual(fundFit('AI', 'Retail'), 'fits', '"retail" holds "ai", and a substring is never a match');

  const db = await seeded();
  db.exec(`INSERT INTO research_fund_sources (source_name, title, terms_status, evidence, verdict, verdict_reason, reviewed_on) VALUES
           ('Made-up open list', 'Open list', 'not found', 'e', 'cite only', 'r', '2026-10-01'),
           ('Made-up closed list', 'Closed list', 'not found', 'e', 'not allowed', 'r', '2026-10-01')`);
  db.exec(`INSERT INTO research_fund_directory (uid, name, sector_focus, source_name, source_url, as_of) VALUES
           ('fund-ai', 'Gridline AI Fund', 'AI', 'Made-up open list', 'https://example.test/a', '2026-10-01'),
           ('fund-fin', 'Ledger Seed', 'Fintech', 'Made-up open list', 'https://example.test/b', '2026-10-01'),
           ('fund-hid', 'Hidden Partners', 'AI', 'Made-up closed list', 'https://example.test/c', '2026-10-01')`);
  db.exec(`INSERT INTO raise_prospects (id, uid, project_id, name, stage, research_fund_uid) VALUES
           (20, 'p20', ${P}, 'Gridline AI Fund', 'contacted', 'fund-ai'),
           (21, 'p21', ${P}, 'Ledger Seed', 'contacted', 'fund-fin'),
           (22, 'p22', ${P}, 'Hidden Partners', 'contacted', 'fund-hid'),
           (23, 'p23', ${P}, 'Gone Fund', 'contacted', 'fund-pruned')`);
  const ids = async (fit: string) => (await read(db, 'capital-relationships', `&filter=fit:${fit}`)).body.records.rows.map((r: any) => r.id).sort((a: number, b: number) => a - b);
  assert.deepEqual(await ids('fits'), [20]);
  assert.deepEqual(await ids('outside'), [21]);
  assert.deepEqual(await ids('unclear'), []);
  assert.deepEqual(await ids('not_recorded'), [5, 6, 22, 23], 'no fund, a list not allowed, or a fund pruned from the directory');
});

// ---------------------------------------------------------------------------
// Test 2 (the list ids): addresses, never names, the same on every sort
// ---------------------------------------------------------------------------

test('2: every id matches the record pattern, holds no holder or investor name, and data_room is one', async () => {
  const db = await seeded();
  for (const m of MODULES) {
    const rows = (await read(db, m.slug)).body.records.rows;
    assert.ok(rows.length >= 2, `${m.slug} is seeded`);
    for (const r of rows) {
      assert.ok(r.id != null, `${m.slug}: a keyed table has no null id`);
      const id = String(r.id);
      assert.match(id, RECORD_ID, `${m.slug}: ${id}`);
      for (const n of NAMES) for (const part of n.split(' ')) assert.ok(!id.includes(part), `${m.slug}: ${id} carries "${part}"`);
    }
  }
  assert.ok((await read(db, 'fundraising-readiness')).body.records.rows.some((r: any) => r.id === 'data_room'));
});

test('2: ids are the same on page 1 and after a re-sort', async () => {
  const db = await seeded();
  const SORTS: Record<string, string[]> = {
    'fundraising-readiness': ['score', 'order'], 'investor-narrative': ['newest', 'oldest'],
    'pitch-deck': ['last_viewed', 'newest', 'views'], 'data-room': ['updated', 'name'],
    'cap-table': ['ownership', 'after'], 'use-of-funds': ['share', 'order'],
    'capital-relationships': ['last_contact', 'recent', 'due', 'name'],
  };
  for (const m of MODULES) {
    const sent = (await read(db, m.slug)).body.records.sorts.map((s: any) => s.key);
    assert.deepEqual(sent, SORTS[m.slug], `${m.slug} sorts`);
    const byRow = (rows: any[]) => Object.fromEntries(rows.map((r) => [JSON.stringify(Object.values(r.cells)[0]), r.id]));
    const first = byRow((await read(db, m.slug)).body.records.rows);
    for (const s of sent) assert.deepEqual(byRow((await read(db, m.slug, `&sort=${s}`)).body.records.rows), first, `${m.slug} by ${s}`);
  }
});

test('2: a tool-entered holder reads as e-<n>, the pool as pool, and a register founder as h-<n>', async () => {
  const db = await seeded();
  const ids = Object.fromEntries((await read(db, 'cap-table')).body.records.rows.map((r: any) => [r.cells.holder, r.id]));
  assert.deepEqual(ids, { 'Mira Okafor': 'e-1', 'Tomas Reyes': 'e-2', 'Option Pool': 'pool', 'Harbour Angels': 'e-3', 'Seed Investors': 'e-4' });
  // An entry that carries a register row's id reads as that row (decision 4).
  const inputs = { founders: [{ name: 'Mira Okafor', key: 'e-1', holder_id: 7 }] };
  assert.equal(capIdOf({ holder: 'Mira Okafor', type: 'founder' }, inputs), 'h-7');
  assert.equal(capIdOf({ holder: 'Mira Okafor', type: 'founder' }, { founders: [{ name: 'Mira Okafor', key: 'Mira Okafor' }] }), null, 'a key without the shape is no id');
});

test('2: a scenario saved before keys reads with id null, and the read writes nothing', async () => {
  const db = fixture();
  const before = [{ holder: 'Mira Okafor', type: 'founder', shares: 8000 }, { holder: 'Option Pool', type: 'option_pool', shares: 2000 }];
  const inputs = JSON.stringify({ founders: [{ name: 'Mira Okafor', shares: 8000 }], option_pool_pct: 20 });
  db.exec(`INSERT INTO cap_table_scenarios (owner_user_id, project_id, name, inputs_json, result_json) VALUES
           (${FOUNDER}, ${P}, 'Old', '${inputs}', '${JSON.stringify({ founding: before, rounds: [] })}')`);
  const stamp = () => db.prepare('SELECT inputs_json, updated_at FROM cap_table_scenarios').get() as any;
  const was = { ...stamp() };
  const rows = (await read(db, 'cap-table')).body.records.rows;
  assert.deepEqual(rows.map((r: any) => [r.cells.holder, r.id]), [['Mira Okafor', null], ['Option Pool', 'pool']]);
  assert.deepEqual({ ...stamp() }, was, 'the read wrote nothing');
});

// ---------------------------------------------------------------------------
// Test 14 (links out)
// ---------------------------------------------------------------------------

test('14: the data-room links open the file tool, and no row links before the record service registers', async () => {
  assert.equal(TOOL_HREF.dataRoom, '/raise/data-room?mode=workspace');
  const empty = fixture();
  const card = (await overview(empty)).cards.find((c: any) => c.slug === 'data-room');
  assert.equal(card.next.href, TOOL_HREF.dataRoom, 'the empty card\'s next');
  assert.equal((await read(empty, 'data-room')).body.records.add.href, TOOL_HREF.dataRoom, 'the records add');
  const db = await seeded();
  for (const m of MODULES) {
    // D-e: until #1690's hasRecords('raise') is true, a linked row would open a 404.
    assert.notEqual((await read(db, m.slug)).body.records.linkable, true, m.slug);
  }
});
