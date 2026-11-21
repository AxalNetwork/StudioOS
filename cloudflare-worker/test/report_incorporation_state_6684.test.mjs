/**
 * #6684 — `scripts/report-incorporation-state.mjs` against a fixture
 * database: counts and yes/no only, nothing written, writes refused.
 *
 *   node --test cloudflare-worker/test/report_incorporation_state_6684.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import {
  assertReadOnly, beneficialOwnershipStep, jurisdictionsFromSource, render, report, sqliteQuery, stripeCoverage,
} from '../../scripts/report-incorporation-state.mjs';

const ROOT = resolve(process.cwd());
const SCRIPT = join(ROOT, 'scripts/report-incorporation-state.mjs');
const hash = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'inc6684-'));
  const file = join(dir, 'fixture.db');
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE incorporations (id INTEGER PRIMARY KEY, user_id INTEGER, project_id INTEGER, jurisdiction_id TEXT, company_name TEXT, amount_cents INTEGER, status TEXT);
    CREATE TABLE legal_templates (id INTEGER PRIMARY KEY, slug TEXT UNIQUE, title TEXT, body_md TEXT, version INTEGER, is_active INTEGER, is_stub INTEGER);
    CREATE TABLE legal_reviews (id INTEGER PRIMARY KEY, object_kind TEXT, object_ref TEXT, version INTEGER, version_sha256 TEXT, decision TEXT);
  `);
  const inc = db.prepare('INSERT INTO incorporations (user_id, project_id, jurisdiction_id, company_name, amount_cents, status) VALUES (1, ?, ?, ?, 99999, ?)');
  inc.run(10, 'us_de_ccorp', '[Secret Co]', 'paid');
  inc.run(10, 'us_de_ccorp', '[Secret Co 2]', 'filed');       // project 10: two paid orders
  inc.run(11, 'us_de_ccorp', '[Other]', 'pending_payment');
  inc.run(12, 'uk_ltd', '[UK Co]', 'paid');
  inc.run(13, 'Delaware_CCorp', '[Legacy]', 'paid');           // outside the six
  const body = 'Articles body v2';
  const t = db.prepare('INSERT INTO legal_templates (slug, title, body_md, version, is_active, is_stub) VALUES (?, ?, ?, ?, ?, ?)');
  t.run('bylaws', 'Bylaws', body, 2, 1, 0);
  t.run('articles_of_incorporation_wy', 'WY', 'WY body', 1, 1, 0);
  t.run('uk_articles_of_association', 'UK', '', 1, 1, 0);       // empty body: no
  t.run('sg_constitution', 'SG', 'stub', 1, 1, 1);               // stub: no
  const r = db.prepare('INSERT INTO legal_reviews (object_kind, object_ref, version, version_sha256, decision) VALUES (?, ?, ?, ?, ?)');
  r.run('template', 'bylaws', 2, hash(body), 'approved');                       // approves the current body
  r.run('template', 'articles_of_incorporation_wy', 1, hash('older body'), 'approved'); // another body: no
  db.close();
  return { dir, file };
}

test('the six ids and their template keys are read from legal.ts', () => {
  const j = jurisdictionsFromSource(ROOT);
  assert.deepEqual(j.map((x) => x.id), ['us_de_ccorp', 'us_wy_ccorp', 'us_de_llc', 'uk_ltd', 'sg_pte', 'ee_oy']);
  assert.ok(j.find((x) => x.id === 'us_wy_ccorp').templates.includes('articles_of_incorporation_wy'));
});

test('report: counts by status, unknown ids, multi-paid projects, templates with counsel approval; no names or amounts', async () => {
  const { dir, file } = fixture();
  try {
    const before = hash(readFileSync(file).toString('latin1'));
    const r = await report({ query: await sqliteQuery(file), stripe: null, root: ROOT });
    assert.deepEqual(r.jurisdictions.us_de_ccorp.orders, { filed: 1, paid: 1, pending_payment: 1 });
    assert.deepEqual(r.jurisdictions.uk_ltd.orders, { paid: 1 });
    assert.deepEqual(r.jurisdictions.ee_oy.orders, {});
    assert.deepEqual(r.unknown_ids, { Delaware_CCorp: 1 });
    assert.equal(r.projects_with_more_than_one_paid_order, 1);
    assert.deepEqual(r.jurisdictions.us_de_ccorp.templates.bylaws, { active_body: 'yes', counsel_approved: 'yes' });
    assert.deepEqual(r.jurisdictions.us_wy_ccorp.templates.articles_of_incorporation_wy, { active_body: 'yes', counsel_approved: 'no' }, 'approval of another body does not count');
    assert.deepEqual(r.jurisdictions.uk_ltd.templates.uk_articles_of_association, { active_body: 'no', counsel_approved: 'no' });
    assert.deepEqual(r.jurisdictions.sg_pte.templates.sg_constitution, { active_body: 'no', counsel_approved: 'no' });
    assert.equal(r.jurisdictions.us_de_ccorp.stripe_price, 'not checked');
    const out = JSON.stringify(r) + render(r);
    for (const secret of ['Secret Co', 'UK Co', 'Legacy', '99999', '999.99', 'Articles body']) assert.ok(!out.includes(secret), secret);
    assert.equal(hash(readFileSync(file).toString('latin1')), before, 'the database is unchanged');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a database without the review table reads "not readable", never "no"', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'inc6684b-'));
  try {
    const file = join(dir, 'f.db');
    const db = new DatabaseSync(file);
    db.exec('CREATE TABLE incorporations (id INTEGER PRIMARY KEY, project_id INTEGER, jurisdiction_id TEXT, status TEXT)');
    db.close();
    const r = await report({ query: await sqliteQuery(file), root: ROOT });
    assert.equal(r.jurisdictions.us_de_ccorp.templates.bylaws.active_body, 'not readable');
    assert.equal(r.projects_with_more_than_one_paid_order, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('writes are refused before they run; the SQLite handle is read only', async () => {
  for (const bad of ['DELETE FROM incorporations', 'UPDATE incorporations SET status = 1', 'SELECT 1; DROP TABLE x', 'PRAGMA table_info(x)', "INSERT INTO t VALUES (1)"]) {
    assert.throws(() => assertReadOnly(bad), /refused/, bad);
  }
  assert.equal(assertReadOnly('SELECT 1'), 'SELECT 1');
  const { dir, file } = fixture();
  try {
    const q = await sqliteQuery(file);
    await assert.rejects(q('DELETE FROM incorporations'), /refused/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('Stripe: yes when an active product carries the id with a one-time price; no key, not checked; no amount kept', async () => {
  const pages = [
    { data: [{ id: 'p1', unit_amount: 50000, product: { active: true, metadata: { jurisdiction_id: 'us_de_ccorp' } } }], has_more: true },
    { data: [{ id: 'p2', unit_amount: 1, product: { active: false, metadata: { jurisdiction_id: 'uk_ltd' } } }], has_more: false },
  ];
  let i = 0;
  const seen = [];
  const got = await stripeCoverage(['us_de_ccorp', 'uk_ltd', 'ee_oy'], { fetchJson: async (path) => { seen.push(path); return pages[i++]; } });
  assert.deepEqual(got, { us_de_ccorp: 'yes', uk_ltd: 'no', ee_oy: 'no' });
  assert.match(seen[0], /^prices\?active=true&type=one_time/);
  assert.match(seen[1], /starting_after=p1/);
  assert.deepEqual(await stripeCoverage(['ee_oy'], { key: '' }), { ee_oy: 'not checked' });
});

test('the beneficial-ownership check answers yes or no with file paths', () => {
  const b = beneficialOwnershipStep(ROOT);
  assert.ok(['yes', 'no'].includes(b.shown));
  assert.equal(b.shown === 'yes', b.files.length > 0);
  for (const f of b.files) assert.match(f, /^(frontend|cloudflare-worker)\/src\//);
  assert.ok(!b.files.some((f) => /TermsPage|BrandIcon|dueDiligence/.test(f)), 'only the incorporation flow counts');
});

test('the CLI prints the report for --sqlite and refuses with no source', () => {
  const { dir, file } = fixture();
  try {
    const ok = spawnSync(process.execPath, [SCRIPT, '--sqlite', file, '--json'], { encoding: 'utf8', env: { PATH: process.env.PATH } });
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(JSON.parse(ok.stdout).projects_with_more_than_one_paid_order, 1);
    const none = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
    assert.equal(none.status, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
