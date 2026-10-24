/**
 * D691 (S19-B, #1699) — Raise's seven lists as the canvas draws them
 * (CO:623-629), with ids that are addresses (decision 3), and the links out.
 *
 * Test 1's list line (each module's `records_title`, columns, filters and
 * default sort), test 2's list ids and test 14's links out read the module
 * route. The one-record reads (the rest of tests 1 and 2, and tests 4 and 5)
 * go through D690's record route with Raise's specs registered
 * (`services/records/raise.ts`).
 *
 * The database is the baseline plus every numbered migration above the
 * cutoff, schema only, as cycle_records_build_d690.test.ts builds one, so no
 * real fund row is loaded and no table is hand-written. Every person, venture
 * and fund is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/cycle_records_raise_d691.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import cycleRaise from '../src/routes/cycle_raise.ts';
import { createCycleRecords } from '../src/routes/cycle_records.ts';
import { MODULES, TOOL_HREF, fundFit, capIdOf, NEVER_EXPIRES } from '../src/services/raiseCycle.ts';
import { saveScenario } from '../src/services/capTableWrites.ts';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { RAISE_RECORDS } from '../src/services/records/raise.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const MIGRATIONS = resolve(process.cwd(), 'cloudflare-worker/sql/migrations');

const RECORD_ID = /^[a-z0-9][a-z0-9_-]*$/;
const FOUNDER = 10, ADMIN = 30;
const P = 1, P_OTHER = 2;

/** The baseline, then every post-cutoff migration in order, as cycle_records_build_d690.test.ts builds one. */
const FILES = readdirSync(MIGRATIONS).filter((f) => /^\d+_.*\.sql$/.test(f)).sort(compareMigrations);
const BUILT_DDL = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(BASELINE);
  for (const f of FILES.filter((n) => migrationNumber(n) > BASELINE_CUTOFF)) db.exec(readFileSync(resolve(MIGRATIONS, f), 'utf8'));
  return (db.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`).all() as any[]).map((r) => r.sql as string);
})();

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const s of BUILT_DDL) { try { db.exec(s); } catch { /* a view or trigger naming an object replayed later */ } }
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
/** A users row per role the record gate must weigh; `founder_id` 1001 owns venture 1, 1002 venture 2. */
const PEOPLE: Record<number, { role: string; founder?: number; lab?: number }> = {
  [FOUNDER]: { role: 'founder', founder: 1001 }, [ADMIN]: { role: 'admin' }, 40: { role: 'partner' }, 41: { role: 'advisor' },
  50: { role: 'investor' }, 51: { role: 'investor' }, 20: { role: 'founder', founder: 1002 }, 60: { role: 'exploring', founder: 1001, lab: 1 },
};
function people(db: DatabaseSync) {
  const add = db.prepare('INSERT OR IGNORE INTO users (id, role, name, email, is_active, founder_id, spinout_lab_active) VALUES (?, ?, ?, ?, 1, ?, ?)');
  for (const [id, p] of Object.entries(PEOPLE)) add.run(Number(id), p.role, `Person ${id}`, `person${id}@example.test`, p.founder ?? null, p.lab ?? 0);
}

const records = new Hono<any>();
records.route('/api/cycles', createCycleRecords());
records.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 500));

/** One record read (or its activity) through the registered route, as `who`. */
async function rec(db: DatabaseSync, slug: string, id: string | number, { who = FOUNDER, project = P, tail = '' } = {}) {
  people(db);
  const token = await new SignJWT({ user_id: who, role: PEOPLE[who]?.role ?? 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await records.request(`/api/cycles/raise/modules/${slug}/records/${encodeURIComponent(String(id))}${tail}?project=${project}`,
      { headers: { Authorization: `Bearer ${token}` } }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error] = saved; }
}
/** A stand-in for the R2 bucket: the keys put and deleted. */
function bucket() {
  const objects = new Map<string, Uint8Array>();
  const deleted: string[] = [];
  return {
    objects, deleted,
    put: async (key: string, bytes: Uint8Array) => { objects.set(key, bytes); },
    get: async (key: string) => (objects.has(key) ? { body: objects.get(key) } : null),
    delete: async (key: string) => { deleted.push(key); objects.delete(key); },
  };
}

/** One record action (or form-options) through the registered route, as `who`. */
async function act(db: DatabaseSync, slug: string, id: string | number | null, key: string, body?: unknown,
  { who = FOUNDER, project = P, files = bucket() as any, query = '' } = {}) {
  people(db);
  const token = await new SignJWT({ user_id: who, role: PEOPLE[who]?.role ?? 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const path = id == null
    ? `/api/cycles/raise/modules/${slug}/form-options?project=${project}${query}`
    : `/api/cycles/raise/modules/${slug}/records/${encodeURIComponent(String(id))}/actions/${key}?project=${project}`;
  const init: any = id == null ? { headers: { Authorization: `Bearer ${token}` } } : body instanceof FormData
    ? { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body }
    : { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) };
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    // A writer's refusal is a thrown Response, which the worker's entry answers with (util/thrownResponse.ts).
    const res = await withThrownResponses(() => records.request(path, init, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), FILES: files } as any));
    const raw = await res.text();
    return { status: res.status, body: raw ? JSON.parse(raw) : null, raw };
  } finally { [console.warn, console.error] = saved; }
}
const count = (db: DatabaseSync, sql: string) => Number((db.prepare(sql).get() as any).n);

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
  'investor-narrative': { title: 'Versions', cols: ['Version', 'Investor type', 'Deck use', 'Mismatches', 'Date'], filters: ['Investor type'], sort: 'Newest' },
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
  assert.equal(versions[2].deck, 'No deck reads this version.');
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

test('14: the data-room Add opens Upload, Manage access opens the file tool, and every list links its rows to the record route', async () => {
  assert.equal(TOOL_HREF.dataRoom, '/raise/data-room?mode=workspace');
  const empty = fixture();
  const card = (await overview(empty)).cards.find((c: any) => c.slug === 'data-room');
  // D695 (#1657) decision 11: Upload is Data room's form, so both open its address; #1658's
  // "Open the files tool" and Manage access keep the file tool one link away.
  assert.deepEqual([card.next.text, card.next.href], ['Upload', `/raise/data-room/new?project=${P}`], 'the empty card\'s next');
  assert.deepEqual((await read(empty, 'data-room')).body.records.add, { text: 'Upload', href: `/raise/data-room/new?project=${P}` }, 'the records add');
  const db = await seeded();
  for (const m of MODULES) {
    // D-e: a row links only while Raise's specs are registered, so it never opens a 404.
    assert.equal((await read(db, m.slug)).body.records.linkable, true, m.slug);
    const first = (await read(db, m.slug)).body.records.rows.find((r: any) => r.id != null);
    assert.equal((await rec(db, m.slug, first.id)).status, 200, `${m.slug} ${first.id} opens`);
  }
  // Manage access opens the file tool on this venture; Model a round opens the variants.
  const links = async (slug: string, id: string | number) => (await rec(db, slug, id)).body.actions
    .filter((a: any) => a.kind === 'link').map((a: any) => [a.key, a.kind, a.href]);
  assert.deepEqual(await links('data-room', 12), [['manage-access', 'link', `${TOOL_HREF.dataRoom}&project_id=${P}`]]);
  assert.deepEqual(await links('cap-table', 'e-3'), [['model-a-round', 'link', '/raise/cap-table/variants']]);
});


// ---------------------------------------------------------------------------
// The one-record reads (D690's contract): tests 1, 2, 4 and 5
// ---------------------------------------------------------------------------

/** A record of every module, with the sections each one draws. */
const SECTIONS: Record<string, { id: string | number; main: string[]; side: string[] }> = {
  'fundraising-readiness': { id: 'data_room', main: ['reads', 'mock-diligence'], side: ['history', 'opens'] },
  'investor-narrative': { id: 2, main: ['narrative', 'consistency'], side: ['feedback', 'versions'] },
  'pitch-deck': { id: 41, main: ['views', 'slides'], side: ['settings', 'investor'] },
  'data-room': { id: 12, main: ['opened', 'versions'], side: ['access', 'diligence'] },
  'cap-table': { id: 'e-3', main: ['conversion', 'documents'], side: ['holder'] },
  'use-of-funds': { id: 'product', main: ['hires', 'actual'], side: ['feeds'] },
  'capital-relationships': { id: 5, main: ['timeline', 'fit'], side: ['feedback', 'materials'] },
};
/** Every action and section action #1699's step 4 lists (#1700 step 6), for the record in SECTIONS. */
const ACTIONS: Record<string, string[]> = {
  'fundraising-readiness': ['rescore'],
  'investor-narrative': ['duplicate', 'edit'],
  'pitch-deck': ['revoke'],
  'data-room': ['manage-access', 'replace', 'remove'],
  'cap-table': ['model-a-round', 'edit'],
  'use-of-funds': ['add-hire', 'edit-split'],
  'capital-relationships': ['log', 'add-feedback', 'mark-passed', 'edit'],
};
/** The section that carries an action, and the action it names. */
const SECTION_ACTIONS: Record<string, Record<string, string>> = {
  'fundraising-readiness': { 'mock-diligence': 'rescore' },
  'investor-narrative': { narrative: 'edit' },
  'data-room': { versions: 'replace' },
  'use-of-funds': { hires: 'add-hire' },
  'capital-relationships': { timeline: 'log', feedback: 'add-feedback' },
};

test('1: each record has a title, four facts with a value or a reason, its sections and every action it lists', async () => {
  const db = await seeded();
  for (const m of MODULES) {
    const want = SECTIONS[m.slug];
    const { status, body } = await rec(db, m.slug, want.id);
    assert.equal(status, 200, m.slug);
    assert.equal(body.cycle, 'raise');
    assert.equal(body.id, String(want.id));
    assert.ok(String(body.title).trim(), `${m.slug} title`);
    assert.equal(body.facts.length, 4, `${m.slug} facts`);
    for (const f of body.facts) assert.ok(f.value != null || String(f.reason ?? '').trim(), `${m.slug} ${f.label} says why it is empty`);
    assert.deepEqual(body.main.map((x: any) => x.key), want.main, `${m.slug} main`);
    assert.deepEqual(body.side.map((x: any) => x.key), want.side, `${m.slug} side`);
    assert.deepEqual(body.actions.map((a: any) => a.key), ACTIONS[m.slug], `${m.slug} actions`);
    for (const a of body.actions) {
      assert.ok(!('execute' in a) && !('references' in a), `${m.slug} ${a.key}: the handler stays on the server`);
      if (a.kind === 'link') assert.ok(a.href, `${m.slug} ${a.key} links somewhere`);
      if (a.kind === 'form') assert.ok(a.form.fields.length > 0, `${m.slug} ${a.key} has fields`);
    }
    const carried = Object.fromEntries([...body.main, ...body.side].filter((x: any) => x.action).map((x: any) => [x.key, x.action]));
    assert.deepEqual(carried, SECTION_ACTIONS[m.slug] ?? {}, `${m.slug} section actions`);
    for (const key of Object.values(carried)) assert.ok(body.actions.some((a: any) => a.key === key), `${m.slug}: ${key} is declared`);
    assert.ok(!('createdBy' in body) && !('createdAt' in body), 'the creator stays on the server');
  }
  // Mock diligence is the Data room item's alone (decision 8).
  assert.ok(!(await rec(db, 'fundraising-readiness', 'deck')).body.main.some((x: any) => x.key === 'mock-diligence'));
  // Team is scored by a person (a form); the pool is set in the tool, so it has no Edit.
  assert.deepEqual((await rec(db, 'fundraising-readiness', 'team')).body.actions.map((a: any) => [a.key, a.kind]), [['score', 'form']]);
  assert.deepEqual((await rec(db, 'cap-table', 'pool')).body.actions.map((a: any) => a.key), ['model-a-round']);
  // An unscored item is a record with every fact Not recorded, and Team reads no check.
  const team = (await rec(db, 'fundraising-readiness', 'team')).body;
  assert.deepEqual(team.facts.map((f: any) => [f.value, f.reason]), Array(4).fill([null, 'Not scored yet']));
  assert.equal(team.main[0].empty, 'Team is scored by a person, not by a check.');
  const reads = (await rec(db, 'fundraising-readiness', 'data_room')).body.main[0].rows;
  assert.deepEqual(reads.map((r: any) => r.c), ['Missing', 'Missing'], 'ungranted files do not satisfy the readiness check');
});

test('1: Fit, Expires, Monthly and the data-room access read their stores', async () => {
  const db = await seeded();
  // Fit: a fund the directory serves draws its verdict; no fund is Not recorded with its reason.
  db.exec(`INSERT INTO research_fund_sources (source_name, title, terms_status, evidence, verdict, verdict_reason, reviewed_on) VALUES
           ('Made-up open list', 'Open list', 'not found', 'e', 'cite only', 'r', '2026-10-01')`);
  db.exec(`INSERT INTO research_fund_directory (uid, name, sector_focus, source_name, source_url, as_of) VALUES
           ('fund-ai', 'Gridline AI Fund', 'AI', 'Made-up open list', 'https://example.test/a', '2026-10-01'),
           ('fund-fin', 'Ledger Seed', 'Fintech', 'Made-up open list', 'https://example.test/b', '2026-10-01')`);
  db.exec(`INSERT INTO raise_prospects (id, uid, project_id, name, stage, research_fund_uid) VALUES
           (20, 'p20', ${P}, 'Gridline AI Fund', 'contacted', 'fund-ai'), (21, 'p21', ${P}, 'Ledger Seed', 'contacted', 'fund-fin')`);
  const fit = async (id: number) => (await rec(db, 'capital-relationships', id)).body.main.find((x: any) => x.key === 'fit');
  assert.equal((await fit(20)).rows[0].c, 'Fits');
  assert.equal((await fit(21)).rows[0].c, 'Outside its focus');
  assert.deepEqual([(await fit(5)).rows, (await fit(5)).empty], [[], 'Not recorded: no fund from the directory is linked.']);
  // Expires: a "Never" link says Never, not a far date.
  const expires = async (id: number) => (await rec(db, 'pitch-deck', id)).body.facts.find((f: any) => f.label === 'Expires').value;
  assert.equal(await expires(44), 'Never');
  assert.equal(await expires(41), '2999-01-01');
  // Monthly: without a runway it says why.
  const monthly = async () => (await rec(db, 'use-of-funds', 'product')).body.facts.find((f: any) => f.label === 'Monthly');
  assert.deepEqual(await monthly(), { label: 'Monthly', value: '$30,000' });
  db.exec(`UPDATE projects SET use_of_funds_meta = '{}' WHERE id = ${P}`);
  assert.deepEqual(await monthly(), { label: 'Monthly', value: null, reason: 'No runway set' });

  // Access (decision 6): an active grant the file's tier admits, and an nda file only once the NDA is live.
  people(db);
  db.exec(`INSERT INTO data_room_grants (uid, project_id, investor_user_id, granted_by_user_id, status, expires_at) VALUES
           ('g50', ${P}, 50, ${FOUNDER}, 'active', NULL), ('g51', ${P}, 51, ${FOUNDER}, 'active', '2020-01-01 00:00:00'),
           ('g40', ${P}, 40, ${FOUNDER}, 'revoked', NULL)`);
  db.exec(`INSERT INTO raise_prospects (id, uid, project_id, name, stage, email) VALUES (30, 'p30', ${P}, 'Person 50', 'committed', 'person50@example.test')`);
  const access = async (id: number) => (await rec(db, 'data-room', id)).body.side.find((x: any) => x.key === 'access').rows.map((r: any) => r.a);
  assert.deepEqual(await access(13), ['Person 50'], 'an open, invited file: the live grant only, never an expired or revoked one');
  assert.deepEqual(await access(14), [], 'a file for nobody');
  assert.deepEqual(await access(12), [], 'an nda file before the NDA is live');
  db.exec(`INSERT INTO pairwise_ndas (party_a_user_id, party_b_user_id, status) VALUES (${FOUNDER}, 50, 'active')`);
  assert.deepEqual(await access(12), ['Person 50', 'Expires'], 'once it is live, until the file\'s expiry');
  db.exec(`UPDATE raise_prospects SET stage = 'meeting' WHERE id = 30`);
  assert.deepEqual(await access(12), [], 'a committed-only file, once the investor is not committed');
  // Who opened it: an admitted investor who never downloaded reads Not opened.
  const opened = (await rec(db, 'data-room', 13)).body.main.find((x: any) => x.key === 'opened').rows;
  assert.deepEqual(opened.map((r: any) => [r.a, r.c]), [['Person 50', 'Not opened']]);
});

test('1: an older record\'s activity reads its store\'s creator, by name or by date', async () => {
  const db = await seeded();
  people(db);
  db.exec(`UPDATE data_room_files SET uploaded_by_user_id = ${FOUNDER} WHERE id = 12`);
  const first = async (slug: string, id: string | number) => (await rec(db, slug, id, { tail: '/activity' })).body.items[0].a;
  assert.equal(await first('data-room', 12), 'Created by Fay Founder');
  assert.match(await first('data-room', 13), /^Created \d{4}-\d{2}-\d{2}$/, 'no uploader recorded: the date');
  assert.match(await first('capital-relationships', 5), /^Created \d{4}-\d{2}-\d{2}$/, 'a prospect keeps no creator');
  assert.equal(await first('cap-table', 'pool'), 'Created by Fay Founder', 'the base scenario\'s owner');
  // A logged write is the record's own line, under raise.<slug>.
  db.exec(`INSERT INTO activity_logs (user_id, action, entity_type, entity_id, details, project_id) VALUES
           (${FOUNDER}, 'updated', 'raise.data-room', '12', '{}', ${P})`);
  const items = (await rec(db, 'data-room', 12, { tail: '/activity' })).body.items;
  assert.ok(items.length >= 1 && items.some((i: any) => i.action === 'updated'), 'raise.data-room is read');
});

test('2: a record id is the list\'s, and an id the venture does not hold is 404', async () => {
  const db = await seeded();
  for (const m of MODULES) {
    for (const r of (await read(db, m.slug)).body.records.rows) {
      if (r.id == null) continue;
      const got = await rec(db, m.slug, r.id);
      assert.equal(got.status, 200, `${m.slug} ${r.id}`);
      assert.equal(got.body.id, String(r.id));
    }
  }
  for (const [slug, id] of [['fundraising-readiness', 'pricing'], ['investor-narrative', 9], ['use-of-funds', 'travel'],
    ['cap-table', 'e-99'], ['cap-table', 'h-1'], ['data-room', 99], ['pitch-deck', 99], ['capital-relationships', 99]] as const) {
    assert.equal((await rec(db, slug, id)).status, 404, `${slug} ${id}`);
  }
  for (const id of ['Data_Room', 'h-', '../1', 'e-1 ']) assert.equal((await rec(db, 'cap-table', id)).status, 404, `bad id ${JSON.stringify(id)}`);
});

test('4: only the venture\'s own writer reads a record, and another venture\'s id is 404 on this one', async () => {
  const db = await seeded();
  for (const m of MODULES) {
    const id = SECTIONS[m.slug].id;
    for (const who of [40, 41, 50, 20]) assert.equal((await rec(db, m.slug, id, { who })).status, 403, `${m.slug} as ${PEOPLE[who].role} ${who}`);
    for (const who of [FOUNDER, ADMIN, 60]) assert.equal((await rec(db, m.slug, id, { who })).status, 200, `${m.slug} as ${who}`);
  }
  // Venture B's rows, read with ?project= the founder's own venture.
  db.exec(`INSERT INTO pitch_deck_share_tokens (id, deck_id, token_hash, expires_at, created_at) VALUES (45, 6, 'h45', '2999-01-01 00:00:00', '2026-10-01 10:00:00')`);
  db.exec(`INSERT INTO data_room_files (id, uid, project_id, name, r2_key) VALUES (15, 'f15', ${P_OTHER}, 'theirs.pdf', 'k15')`);
  db.exec(`INSERT INTO spinout_deck_overrides (project_id, field_key, value, version) VALUES (${P_OTHER}, '_version', '', 7)`);
  for (const [slug, id] of [['capital-relationships', 9], ['pitch-deck', 45], ['data-room', 15], ['investor-narrative', 7]] as const) {
    assert.equal((await rec(db, slug, id)).status, 404, `${slug} ${id}`);
    assert.equal((await rec(db, slug, id, { who: ADMIN })).status, 404, `${slug} ${id}, even as an admin`);
  }
  // An h- id names a register row: one of venture B's, carried in A's scenario, is still 404.
  db.exec(`INSERT INTO cap_table_holders (id, user_id, project_id, name, shares) VALUES (77, 20, ${P_OTHER}, 'Their founder', 100), (78, ${FOUNDER}, ${P}, 'Mira Okafor', 100)`);
  const row = db.prepare(`SELECT id, inputs_json FROM cap_table_scenarios WHERE project_id = ${P}`).get() as any;
  const inputs = JSON.parse(row.inputs_json);
  inputs.founders[0].holder_id = 77; inputs.founders[1].holder_id = 78;
  db.prepare('UPDATE cap_table_scenarios SET inputs_json = ? WHERE id = ?').run(JSON.stringify(inputs), row.id);
  assert.equal((await rec(db, 'cap-table', 'h-77')).status, 404, 'B\'s register row');
  assert.equal((await rec(db, 'cap-table', 'h-78')).status, 200, 'A\'s register row');
  // Venture B's own founder reads B's prospect on B.
  assert.equal((await rec(db, 'capital-relationships', 9, { who: 20, project: P_OTHER })).status, 200);
});

test('5: a record never claims what no store holds', async () => {
  const db = await seeded();
  const file = (await rec(db, 'data-room', 12)).body;
  assert.deepEqual(file.facts.find((f: any) => f.label === 'Watermark'), { label: 'Watermark', value: null, reason: 'The room does not watermark' });
  assert.equal(file.uid, 'f12', 'the file\'s uid rides on its record');
  const text = (b: any) => JSON.stringify(b);
  for (const m of MODULES) {
    const body = (await rec(db, m.slug, SECTIONS[m.slug].id)).body;
    assert.ok(!/copy link/i.test(text(body)), `${m.slug}: no Copy link`);
    assert.ok(!/\bViewed\b/.test(text(body.main)), `${m.slug}: no per-file view is logged`);
  }
  // Downloads and blocked tries are what the room logs.
  people(db);
  db.exec(`INSERT INTO data_room_access_log (project_id, file_id, user_id, action, created_at) VALUES
           (${P}, 12, 50, 'download', '2026-10-14 10:00:00'), (${P}, 12, 51, 'blocked', '2026-10-15 10:00:00'), (${P}, 12, 50, 'view', '2026-10-16 10:00:00')`);
  const opened = (await rec(db, 'data-room', 12)).body.main.find((x: any) => x.key === 'opened').rows;
  assert.deepEqual(opened.map((r: any) => [r.a, r.c]), [['Person 51', 'Blocked'], ['Person 50', 'Downloaded']]);
  const funds = (await rec(db, 'use-of-funds', 'product')).body.main.find((x: any) => x.key === 'actual');
  assert.deepEqual([funds.rows, funds.empty], [[], 'Not recorded: no store splits spend by category.']);
  const docs = (await rec(db, 'cap-table', 'e-3')).body.main.find((x: any) => x.key === 'documents').rows;
  assert.deepEqual(docs.at(-1), { a: 'Side letter', b: '', c: 'Not recorded', tone: 'grey' });
  // A pitch link's views have no city: only a hashed IP is stored.
  db.exec(`INSERT INTO deck_share_views (deck_id, share_token_id, read_seconds, created_at) VALUES (5, 41, 125, '2026-10-12 10:00:00')`);
  const views = (await rec(db, 'pitch-deck', 41)).body.main.find((x: any) => x.key === 'views').rows;
  assert.deepEqual(views, [{ a: '2026-10-12 · 10:00', b: '2 min' }]);
});


// ---------------------------------------------------------------------------
// #1700 step 6: every declared action runs its writer, through D690's route
// ---------------------------------------------------------------------------

test('1: each declared action runs its handler, writes its store and logs one row on its record', async () => {
  const db = await seeded();
  db.exec(`UPDATE users SET subscription_tier = 'studio' WHERE id = ${FOUNDER}`);
  const ok = async (slug: string, id: string | number, key: string, body?: unknown, files?: any) => {
    const r = await act(db, slug, id, key, body, files ? { files } : {});
    assert.equal(r.status, 200, `${slug} ${id} ${key}: ${r.raw}`);
    assert.equal(r.body.ok, true);
    return r.body;
  };
  const logged = (slug: string, id: string | number) => db.prepare(
    'SELECT project_id, entity_type, entity_id, action, details FROM activity_logs WHERE entity_type = ? AND entity_id = ? ORDER BY id DESC LIMIT 1',
  ).get(`raise.${slug}`, String(id)) as any;

  // Readiness: Re-score this item; Team's Score form.
  const scores = count(db, 'SELECT COUNT(*) AS n FROM readiness_scores');
  await ok('fundraising-readiness', 'deck', 'rescore');
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM readiness_scores s JOIN readiness_items i ON i.id = s.item_id WHERE i.item_key = 'deck'"), 2, 'appended, the earlier kept');
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM readiness_scores'), scores + 1, 'this item only');
  assert.equal(logged('fundraising-readiness', 'deck').action, 'readiness_rescored');
  await ok('fundraising-readiness', 'team', 'score', { score: '7', evidence: 'pattern', missing: 'A CFO' });
  assert.deepEqual({ ...(db.prepare("SELECT s.score, s.evidence, s.source FROM readiness_scores s JOIN readiness_items i ON i.id = s.item_id WHERE i.item_key = 'team'").get() as any) },
    { score: 7, evidence: 'pattern', source: 'manual' });
  assert.equal((await act(db, 'fundraising-readiness', 'team', 'rescore')).status, 404, 'Team has no check to re-run');

  // Narrative: Duplicate makes the next version, based on this one; Edit is PATCH's writer.
  const dup = await ok('investor-narrative', 2, 'duplicate');
  assert.equal(dup.record.version, 3);
  assert.equal((db.prepare(`SELECT based_on_version FROM narrative_version_meta WHERE project_id = ${P} AND version = 3`).get() as any).based_on_version, 2);
  await ok('investor-narrative', 2, 'edit', { why_now: 'Grid tariffs changed', one_liner: 'Batteries for cold towns' });
  assert.equal((db.prepare(`SELECT why_now FROM narrative_version_meta WHERE project_id = ${P} AND version = 2`).get() as any).why_now, 'Grid tariffs changed');
  assert.equal(logged('investor-narrative', 2).action, 'narrative_version_updated');
  const sf = await act(db, 'investor-narrative', 2, 'edit', { start_from: 'blank' });
  assert.deepEqual([sf.status, sf.body.detail], [400, 'Start from is set when the version is made']);

  // Pitch deck: Revoke; a revoked link offers it no more.
  await ok('pitch-deck', 41, 'revoke');
  assert.ok((db.prepare('SELECT revoked_at FROM pitch_deck_share_tokens WHERE id = 41').get() as any).revoked_at);
  assert.equal(logged('pitch-deck', 41).action, 'deck_link_revoked');
  assert.deepEqual((await rec(db, 'pitch-deck', 41)).body.actions, []);
  assert.equal((await act(db, 'pitch-deck', 41, 'revoke')).status, 404);

  // Data room: Replace (multipart) keeps the old object as a version; Remove deletes the file and its versions.
  const room = bucket();
  const form = new FormData();
  form.set('file', new File([new Uint8Array([1, 2, 3])], 'contracts-v2.pdf', { type: 'application/pdf' }));
  const replaced = await ok('data-room', 12, 'replace', form, room);
  assert.equal(replaced.record.version, 1);
  const uid = (db.prepare(`SELECT uid FROM projects WHERE id = ${P}`).get() as any).uid;
  const now = db.prepare('SELECT r2_key, size_bytes FROM data_room_files WHERE id = 12').get() as any;
  assert.ok(now.r2_key.startsWith(`data-room/${uid}/`) && room.objects.has(now.r2_key), 'the new object, inside the room\'s prefix');
  assert.equal(now.size_bytes, 3);
  assert.equal((db.prepare('SELECT r2_key FROM data_room_file_versions WHERE file_id = 12').get() as any).r2_key, 'k12');
  assert.equal(logged('data-room', 12).action, 'file_replaced');
  assert.equal((await act(db, 'data-room', 12, 'replace', {}, { files: room })).status, 400, 'no file');
  await ok('data-room', 12, 'remove', undefined, room);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM data_room_files WHERE id = 12'), 0);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM data_room_file_versions WHERE file_id = 12'), 0);
  assert.deepEqual(room.deleted, [now.r2_key], 'k12 lies outside the prefix and is never deleted');
  assert.equal(logged('data-room', 12).action, 'file_removed');
  // A file removed between the route's ownedRow and the writer (a race) is 404, never ok with no record.
  const ctx = { env: { DB: d1Over(db), FILES: room }, projectId: P, project: { id: P, founder_id: 1001 }, user: { id: FOUNDER, role: 'founder' } } as any;
  const remove = (await RAISE_RECORDS['data-room'].actions(ctx, '12', {} as any)).find((a) => a.key === 'remove')!;
  const raced = await remove.execute!(ctx, '12', {}).then(() => null, (e) => e);
  assert.ok(raced instanceof Response && raced.status === 404, 'the race answers 404');

  // Cap table: Edit is updateHolder()'s, on the SAFE's e- key; its prospect is checked.
  // A form sends text; the handler passes numbers on.
  await ok('cap-table', 'e-3', 'edit', { amount_cents: '30000000', prospect_id: '5' });
  const safe = JSON.parse((db.prepare(`SELECT inputs_json FROM cap_table_scenarios WHERE project_id = ${P}`).get() as any).inputs_json).safes[0];
  assert.deepEqual([safe.key, safe.amount, safe.prospect_id], ['e-3', 300_000, 5]);
  assert.equal(logged('cap-table', 'e-3').action, 'holder_updated');
  assert.equal((await act(db, 'cap-table', 'e-3', 'edit', { instrument: 'common' })).status, 400);

  // Use of funds: Add a hire on the section; Edit split is the whole PUT.
  await ok('use-of-funds', 'product', 'add-hire', { role: 'Senior engineer', start_month: '2027-01', annual_cents: '15000000' });
  assert.deepEqual({ ...(db.prepare(`SELECT category_key, role, start_month FROM use_of_funds_hires WHERE project_id = ${P}`).get() as any) },
    { category_key: 'product', role: 'Senior engineer', start_month: '2027-01' });
  assert.equal(count(db, `SELECT annual_cents AS n FROM use_of_funds_hires WHERE project_id = ${P}`), 15_000_000);
  await ok('use-of-funds', 'product', 'edit-split', {
    amount_to_raise_cents: '150000000', runway_months: '18',
    'pct.product': '40', 'pct.go-to-market': '40', 'pct.reserve': '20', 'milestone_label.product': 'Launch v3', 'milestone_by.product': '2027-06',
  });
  const p = db.prepare(`SELECT funding_needed, use_of_funds, use_of_funds_meta FROM projects WHERE id = ${P}`).get() as any;
  assert.equal(p.funding_needed, 1_500_000);
  assert.deepEqual(JSON.parse(p.use_of_funds).map((x: any) => x.pct), [40, 40, 20]);
  assert.deepEqual(JSON.parse(p.use_of_funds_meta).milestones.product, { label: 'Launch v3', by: '2027-06' });
  assert.equal(JSON.parse(p.use_of_funds_meta).runway_months, 18);
  const off = await act(db, 'use-of-funds', 'product', 'edit-split', { 'pct.product': '40', 'pct.reserve': '20' });
  assert.equal(off.status, 400, 'a split off 100');

  // Capital relationships: Log, Add feedback, Mark passed and Edit.
  await ok('capital-relationships', 5, 'log', { kind: 'call', note: 'Partner call', on: '2026-10-01' });
  assert.deepEqual({ ...(db.prepare('SELECT kind, note, done_at FROM raise_prospect_events WHERE prospect_id = 5').get() as any) }, { kind: 'call', note: 'Partner call', done_at: '2026-10-01' });
  await ok('capital-relationships', 5, 'add-feedback', { objection: 'Too early for us' });
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM raise_prospect_feedback WHERE prospect_id = 5'), 1);
  await ok('capital-relationships', 5, 'edit', { next_step: 'Send the deck', next_step_due: '2026-11-02' });
  assert.deepEqual({ ...(db.prepare('SELECT next_step, next_step_due FROM raise_prospects WHERE id = 5').get() as any) }, { next_step: 'Send the deck', next_step_due: '2026-11-02' });
  await ok('capital-relationships', 5, 'mark-passed');
  assert.equal((db.prepare('SELECT stage FROM raise_prospects WHERE id = 5').get() as any).stage, 'passed');
  assert.ok(!(await rec(db, 'capital-relationships', 5)).body.actions.some((a: any) => a.key === 'mark-passed'), 'passed already');

  // Every row: this venture, raise.<slug>, an id that is an address, and no person's name.
  const rows = db.prepare("SELECT project_id, entity_type, entity_id, details FROM activity_logs WHERE entity_type LIKE 'raise.%'").all() as any[];
  assert.ok(rows.length >= 15);
  for (const r of rows) {
    assert.equal(r.project_id, P);
    assert.match(String(r.entity_id), RECORD_ID);
    for (const name of [...NAMES, 'fay founder']) assert.ok(!String(r.details ?? '').toLowerCase().includes(name), `${r.entity_type}: ${r.details}`);
  }
  const undeclared = await act(db, 'capital-relationships', 6, 'copy-link');
  assert.deepEqual([undeclared.status, undeclared.body.detail], [404, 'No such action on this record.']);
});

test('4: form-options and every action take the module\'s write gate, and an id a body names must be the venture\'s', async () => {
  const db = await seeded();
  db.exec(`UPDATE users SET subscription_tier = 'studio' WHERE id = ${FOUNDER}`);
  const before = count(db, 'SELECT COUNT(*) AS n FROM activity_logs');
  for (const m of MODULES) {
    const id = SECTIONS[m.slug].id;
    for (const who of [40, 41, 50, 20]) {
      assert.equal((await act(db, m.slug, null, '', undefined, { who })).status, 403, `${m.slug} form-options as ${who}`);
      for (const key of ACTIONS[m.slug]) assert.equal((await act(db, m.slug, id, key, {}, { who })).status, 403, `${m.slug} ${key} as ${who}`);
    }
    for (const who of [FOUNDER, ADMIN, 60]) assert.equal((await act(db, m.slug, null, '', undefined, { who })).status, m.slug === 'pitch-deck' && who === ADMIN ? 403 : 200, `${m.slug} form-options as ${who}`);
  }
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM activity_logs'), before, 'a refused action writes nothing');
  // Venture B's prospect (9) named in a holder's body, and its version (7) as Based on.
  db.exec(`INSERT INTO spinout_deck_overrides (project_id, field_key, value, version) VALUES (${P_OTHER}, '_version', '', 7)`);
  const holder = await act(db, 'cap-table', 'e-3', 'edit', { prospect_id: 9 });
  assert.deepEqual([holder.status, holder.body.detail], [404, 'Record not found.']);
  assert.equal(JSON.parse((db.prepare(`SELECT inputs_json FROM cap_table_scenarios WHERE project_id = ${P}`).get() as any).inputs_json).safes[0].prospect_id, undefined);
  const based = await act(db, 'investor-narrative', 2, 'edit', { based_on_version: 7 });
  assert.deepEqual([based.status, based.body.detail], [404, 'Record not found.'], 'the route checks the version before the writer runs');
  // A record of venture B, addressed on venture A.
  assert.equal((await act(db, 'capital-relationships', 9, 'mark-passed')).status, 404);
  assert.equal((db.prepare('SELECT stage FROM raise_prospects WHERE id = 9').get() as any).stage, 'meeting');
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM activity_logs'), before);
});

test('9 (form-options): each module serves its Add form; funds only by name from a served list, warm paths from the caller\'s own network', async () => {
  const db = await seeded();
  const fo = async (slug: string, query = '') => {
    const r = await act(db, slug, null, '', undefined, { query });
    assert.equal(r.status, 200, `${slug}: ${r.raw}`);
    return r.body;
  };
  const ready = await fo('fundraising-readiness');
  assert.equal(ready.items.length, 7);
  assert.deepEqual(ready.items.find((i: any) => i.value === 'team'), { value: 'team', label: 'Team', by_hand: true, last_scored: null, score: null });
  assert.equal(ready.items.find((i: any) => i.value === 'deck').score, 9);
  const narrative = await fo('investor-narrative');
  assert.deepEqual(narrative.versions.map((v: any) => v.value), ['2', '1']);
  assert.deepEqual(narrative.check_against.map((c: any) => c.value), ['deck', 'metrics'], 'the data room is not a check source');
  const deck = await fo('pitch-deck');
  assert.deepEqual(deck.decks.map((d: any) => d.value), ['5'], 'this venture\'s decks only');
  assert.deepEqual(deck.prospects.map((x: any) => x.value), ['5', '6']);
  assert.deepEqual(deck.expires.map((x: any) => x.value), ['7', '14', '30', 'never']);
  const room = await fo('data-room');
  assert.equal(room.project_uid, (db.prepare(`SELECT uid FROM projects WHERE id = ${P}`).get() as any).uid);
  assert.deepEqual(room.folders.map((f: any) => f.label), ['Financials', 'Legal', 'Team', 'Product', 'Customers'], 'Financials exists; the other four are offered by name');
  assert.equal(room.folders[0].value, 'fo3');
  assert.deepEqual(room.requests.map((r: any) => r.value), ['7'], 'only this venture\'s requests');
  assert.deepEqual(room.tiers.map((t: any) => t.value), ['invited', 'committed', 'nobody']);
  const cap = await fo('cap-table');
  assert.deepEqual(cap.pairs.map((x: any) => `${x.group}/${x.instrument}`), ['founders/common', 'investors/safe', 'investors/note']);
  const uof = await fo('use-of-funds');
  assert.deepEqual(uof.sections.map((x: any) => [x.value, x.pct]), [['product', 30], ['go-to-market', 50], ['infrastructure', 0], ['operations', 0], ['reserve', 20]]);
  assert.equal(uof.runway_months, 12);

  db.exec(`INSERT INTO research_fund_sources (source_name, title, terms_status, evidence, verdict, verdict_reason, reviewed_on) VALUES
           ('Made-up open list', 'Open list', 'not found', 'e', 'cite only', 'r', '2026-10-01'),
           ('Made-up closed list', 'Closed list', 'not found', 'e', 'not allowed', 'r', '2026-10-01')`);
  db.exec(`INSERT INTO research_fund_directory (uid, name, sector_focus, source_name, source_url, as_of) VALUES
           ('fund-ai', 'Gridline AI Fund', 'AI', 'Made-up open list', 'https://example.test/a', '2026-10-01'),
           ('fund-pct', 'Gridline 100% Fund', 'AI', 'Made-up open list', 'https://example.test/p', '2026-10-01'),
           ('fund-hid', 'Gridline Hidden', 'AI', 'Made-up closed list', 'https://example.test/c', '2026-10-01')`);
  db.exec(`INSERT INTO network_connections (user_id, name, email, company) VALUES (${FOUNDER}, 'Lin Park', 'lin@example.test', 'Harbour'), (${ADMIN}, 'Not Mine', NULL, NULL)`);
  const capital = await fo('capital-relationships');
  assert.ok(!('funds' in capital), 'no fund without q');
  assert.equal(capital.stages[0].label, 'Identified');
  assert.deepEqual(capital.warm_paths.map((w: any) => w.label), ['Lin Park · Harbour'], 'the caller\'s own, name and company only');
  assert.deepEqual((await fo('capital-relationships', '&q=gridline')).funds.map((f: any) => f.value), ['fund-pct', 'fund-ai'], 'never a fund from a list not allowed');
  assert.deepEqual((await fo('capital-relationships', '&q=100%25')).funds.map((f: any) => f.value), ['fund-pct'], '% matches itself');
  assert.deepEqual((await fo('capital-relationships', '&q=Gridline_AI')).funds, [], '_ matches itself, not any character');
  assert.deepEqual((await fo('capital-relationships', `&q=${'g'.repeat(500)}`)).funds, []);
});


test('#2691: a narrative record compares current values, ignores stale check rows, and never claims a deck reads it',async()=>{
 const db=await seeded();
 try {
  db.exec(`INSERT INTO spinout_deck_overrides(project_id,field_key,value,version) VALUES(${P},'traction.takeaway','We have $45k MRR',2)`);
  db.exec(`INSERT INTO project_metrics(project_id,snapshot_date,mrr) VALUES(${P},'2026-10-01',38000)`);
  const before=db.prepare('SELECT COUNT(*) AS n FROM activity_logs').get()?.n;
  let r=await rec(db,'investor-narrative',2); assert.equal(r.status,200);
  let rows=r.body.main.find((s:any)=>s.key==='consistency').rows;
  assert.equal(rows.find((x:any)=>x.a==='MRR').c,'Mismatch','even without a saved mismatch');
  assert.equal(rows.find((x:any)=>x.a==='Pitch deck').c,'Not compared');
  assert.match(r.body.sub,/No deck reads this version/);
  db.exec(`UPDATE project_metrics SET mrr=45000 WHERE project_id=${P}`);
  db.exec(`INSERT INTO narrative_checks(project_id,version,figure,stated_value,stated_source,metric_value,metric_source) VALUES(${P},2,'mrr',45000,'Narrative',38000,'Old snapshot')`);
  r=await rec(db,'investor-narrative',2);
  rows=r.body.main.find((s:any)=>s.key==='consistency').rows;
  assert.equal(rows.find((x:any)=>x.a==='MRR').c,'OK','stale mismatches do not overrule the actual comparison');
  db.exec(`DELETE FROM spinout_deck_overrides WHERE project_id=${P} AND field_key='traction.takeaway'`);
  r=await rec(db,'investor-narrative',2);
  assert.ok(r.body.pills.some((p:any)=>p.text==='Nothing compared yet'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM activity_logs').get()?.n,before,'reads do not write');
 }finally{db.close();}
});

test('#2447: a manual score offers only evidence values its writer accepts',async()=>{
 const db=await seeded();const team=(await rec(db,'fundraising-readiness','team')).body;
 const choices=team.actions.find((a:any)=>a.key==='score').form.fields.find((f:any)=>f.key==='evidence').options;
 assert.deepEqual(choices.map((x:any)=>x.value),['anecdote','pattern']);
 for(const choice of choices) assert.equal((await act(db,'fundraising-readiness','team','score',{score:'7',evidence:choice.value,missing:''})).status,200);
 assert.equal((await act(db,'fundraising-readiness','team','score',{score:'7',evidence:'stated',missing:''})).status,400);
});
