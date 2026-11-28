/**
 * D7746 (#7746) — Research imports: record links, their history, and the five-outcome reconciliation, through the
 * routes at /api/research-source-imports/mappings over the migrated schema (baseline plus every migration).
 *
 * Invented records only, on reserved example domains (example.org, example.net, example.com). MARK is planted in every
 * prose and contact value and in every note; the privacy test shows it leaves only through the one full read.
 * Records are staged through #7742's own store functions, so the manifest side of the report is the store's.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/research_source_mapping_7746.test.ts
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import router, { mount, REFUSAL_SENTENCES } from '../src/routes/research_source_mappings.ts';
import importRouter, { mount as importMount } from '../src/routes/research_source_imports.ts';
import {
  AUDIT_ACTIONS, KIND_DECISIONS, MAPPING_LIMITS, bareHost, markPromoted, nameKey,
} from '../src/services/researchSourceMapping.ts';
import { membershipDigest, openRun, sealRun, writeChunk, type SourceRecordInput } from '../src/services/researchSourceRecords.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { grantWriteBar } from './_write_bar_session.mjs';
import { loadSchema, SCHEMA_OPTIONS } from './_schema_once.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'research-source-mapping-7746-'));
const seedPath = join(scratch, 'schema.sqlite');
const seed = new DatabaseSync(seedPath, SCHEMA_OPTIONS);
loadSchema(seed); seed.close();
after(() => rmSync(scratch, { recursive: true, force: true }));

const JWT_SECRET = 'synthetic-7746-only-not-a-real-credential'.repeat(2);
const SUPER = 1; const ADMIN = 2; const MEMBER = 3;
const BASE = '/api/research-source-imports';
const MARK = 'QXMARK7746';
const NOTE = `checked by phone ${MARK}`;
const NOW = new Date('2026-11-27T10:40:00Z');
const CATALOGUE_TABLES = ['research_fund_directory', 'research_fund_directory_uid_moves', 'research_fund_sources',
  'research_fund_directory_reports', 'research_company_directory'];

/* ----------------------------------------------------------- invented package: two sources, roles name and website */

type Row = { id: string; name: string; web: string | null };
const SOURCES = {
  invented_list_a: { columns: ['name', 'website', 'notes', 'email'], name: 'name', web: 'website' },
  invented_list_b: { columns: ['title', 'site', 'summary'], name: 'title', web: 'site' },
} as const;
const A: Row[] = [
  { id: 'a-shared', name: 'Example Shared One', web: 'https://shared.example.org/a' },
  { id: 'a-gamma', name: 'Example Gamma Partners', web: 'https://gamma.example.org' },
  { id: 'a-delta-m', name: 'Example Delta Ventures', web: 'https://delta.example.org' },
  { id: 'a-delta-v', name: 'Example Delta Ventures II', web: 'https://fund2.delta-ventures.example.org/about' },
  { id: 'a-co', name: 'Example Widget Co', web: 'https://widget.example.com' },
  { id: 'a-round', name: 'Example Widget Seed Round', web: null },
  { id: 'a-person', name: 'Example Person', web: null },
  { id: 'a-old', name: 'Example Old Capital', web: 'https://old.example.org' },
  { id: 'a-lone', name: 'Example Lone Fund', web: 'https://lone.example.org' },
  { id: 'a-eps', name: 'Example Epsilon Labs', web: 'https://epsilon.example.org' },
];
const B: Row[] = [
  { id: 'b-shared', name: 'Example Shared Two', web: 'http://www.shared.example.org/b' },
  { id: 'b-gamma', name: 'Example Gamma Partners', web: 'https://gamma-partners.example.net' },
  { id: 'b-plat', name: 'Example Platform Fund', web: 'https://www.linkedin.com/company/example-platform' },
  { id: 'b-zeta', name: 'Example Zeta Seed', web: 'https://zeta.example.net' },
];

function recordOf(source: keyof typeof SOURCES, r: Row): SourceRecordInput {
  const s = SOURCES[source];
  const cells: Array<[string, any]> = [[s.name, r.name], [s.web, r.web ?? '']];
  cells.push([s.columns[2], `Long prose about ${r.id} ${MARK}`]);
  if (source === 'invented_list_a') cells.push(['email', `desk-${r.id}-${MARK}@example.com`]);
  return { source_key: source, provider_record_id: r.id, stated_row_hash: `h-${r.id}`, captured_at: '2026-11-20', cells };
}
const classes = {
  invented_list_a: { name: { class: 'fact', role: 'name' }, website: { class: 'fact', role: 'website' }, notes: { class: 'prose' }, email: { class: 'contact' } },
  invented_list_b: { title: { class: 'fact', role: 'name' }, site: { class: 'fact', role: 'website' }, summary: { class: 'prose' } },
};

let n = 0;
async function fixture(env: Record<string, unknown> = {}) {
  const file = join(scratch, `case-${++n}.sqlite`);
  copyFileSync(seedPath, file);
  const db = new DatabaseSync(file, SCHEMA_OPTIONS);
  db.exec('PRAGMA foreign_keys = ON');
  const user = db.prepare('INSERT INTO users(id, email, name, role) VALUES (?, ?, ?, ?)');
  user.run(SUPER, 'super@synthetic.invalid', 'Sam Super', 'admin');
  user.run(ADMIN, 'plain@synthetic.invalid', 'Pat Plain', 'admin');
  user.run(MEMBER, 'member@synthetic.invalid', 'Mo Member', 'founder');
  db.prepare('DELETE FROM super_admins').run();
  db.prepare('INSERT INTO super_admins(user_id) VALUES (?)').run(SUPER);
  const jti = grantWriteBar(db, SUPER);
  // The invented catalogue: a served vehicle, the row a promotion of the gamma record would have written, a retired
  // uid and where it moved, and a row of a list whose terms say 'not allowed'.
  const fund = db.prepare(`INSERT INTO research_fund_directory (uid, name, website, fund_number, source_name, source_url, as_of)
    VALUES (?, ?, ?, ?, ?, 'https://catalogue.example.org/list', '2026-11-20')`);
  fund.run('example-delta-ventures-ii', 'Example Delta Ventures II', 'https://fund2.delta-ventures.example.org', 'II', 'Invented catalogue 7746');
  fund.run('example-gamma-promoted', 'Example Gamma Partners Holdings', 'https://holdings.example.org', null, 'Invented catalogue 7746');
  fund.run('example-new-capital-i', 'Example New Capital I', 'https://new-capital.example.org', 'I', 'Invented catalogue 7746');
  fund.run('example-zeta-seed', 'Example Zeta Seed', 'https://zeta-other.example.org', null, 'Invented catalogue 7746');
  fund.run('example-withheld-fund', 'Example Withheld Fund', 'https://withheld.example.org', null, 'Invented withheld 7746');
  db.prepare(`INSERT INTO research_fund_sources (source_name, title, terms_status, evidence, verdict, verdict_reason, reviewed_on)
    VALUES ('Invented withheld 7746', 'Invented withheld list', 'not found', 'invented', 'not allowed', 'invented', '2026-11-20')`).run();
  db.prepare(`INSERT INTO research_fund_directory_uid_moves (old_uid, new_uid, moved_on) VALUES ('exampleoldcapital', 'example-new-capital-i', '2026-11-20')`).run();

  const DB = d1Over(db) as any;
  const prepare = DB.prepare.bind(DB);
  DB.prepare = (sql: string) => { const st = prepare(sql); st.__sql = sql; return st; };
  const batch = DB.batch.bind(DB);
  const faults = { beforeBatch: null as null | (() => void) };
  DB.batch = async (stmts: any[]) => {
    if (faults.beforeBatch) { const hook = faults.beforeBatch; faults.beforeBatch = null; hook(); }
    return batch(stmts);
  };
  // Stage both sources through the store's own functions, sealed Complete.
  const records = [...A.map((r) => recordOf('invented_list_a', r)), ...B.map((r) => recordOf('invented_list_b', r))];
  const manifest = { sources: await Promise.all((Object.keys(SOURCES) as Array<keyof typeof SOURCES>).map(async (k) => {
    const mine = records.filter((r) => r.source_key === k);
    return { source_key: k, columns: [...SOURCES[k].columns], expected_records: mine.length, expected_cells: mine.length * SOURCES[k].columns.length, digest: await membershipDigest(mine) };
  })) };
  const storeEnv = { JWT_SECRET, ENVIRONMENT: 'test' } as any;
  const run = await openRun(DB, { idempotencyKey: `synthetic-7746-${n}`, actorUserId: SUPER, payloadSha256: 'a'.repeat(64), hashRecipeId: null,
    manifest: manifest as any, columnClasses: classes as any, now: NOW });
  await writeChunk(DB, storeEnv, { runUid: run.run_uid, chunkIndex: 0, records, now: NOW } as any);
  const sealed = await sealRun(DB, run.run_uid, NOW);
  assert.equal(sealed.status, 'complete');

  const app = new Hono<any>();
  app.route(mount.path, router);
  app.route(importMount.path, importRouter);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  const f = { db, DB, app, faults, jti, responses: [] as string[], env: { DB, JWT_SECRET, ENVIRONMENT: 'development', ...env } as any };
  return f;
}
type F = Awaited<ReturnType<typeof fixture>>;

async function token(claims: Record<string, unknown>) {
  return new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
}
type Who = number | null | 'support';
async function call(f: F, who: Who, method: string, path: string, body?: unknown, opts: { bar?: boolean; raw?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (who === 'support') headers.Authorization = `Bearer ${await token({ user_id: MEMBER, impersonated_by: SUPER })}`;
  else if (who !== null) headers.Authorization = `Bearer ${await token({ user_id: who, ...(opts.bar !== false && who === SUPER ? { jti: f.jti } : {}) })}`;
  const payload = opts.raw ?? (body === undefined ? undefined : JSON.stringify(body));
  const res = await f.app.request(`${BASE}${path}`, { method, headers, ...(payload === undefined ? {} : { body: payload }) }, f.env);
  const text = await res.text();
  f.responses.push(text);
  let json: any; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}
const su = (f: F, method: string, path: string, body?: unknown, opts: { bar?: boolean } = {}) => call(f, SUPER, method, path, body, opts);

const ref = (source: string, id: string) => ({ source_key: source, provider_record_id: id });
const LA = 'invented_list_a'; const LB = 'invented_list_b';
const decide = (f: F, d: Record<string, unknown>) => su(f, 'POST', '/mappings/decide', d);
const create = (f: F, source: string, id: string, kind = 'manager') => decide(f, { ...ref(source, id), kind, decision: 'create' });
const linkTo = (f: F, source: string, id: string, target: Record<string, unknown>, ground: string, kind = 'manager', extra: Record<string, unknown> = {}) =>
  decide(f, { ...ref(source, id), kind, decision: 'link', target, ground, ...extra });
const staged = (source: string, id: string) => ({ type: 'staged_record', source_key: source, id });
const catalogue = (uid: string) => ({ type: 'catalogue_fund', id: uid });

const count = (f: F, t: string) => Number((f.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as any).n);
const mappingState = (f: F) => JSON.stringify(['research_source_record_links', 'research_source_link_history'].map((t) => f.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()));
const catalogueState = (f: F) => JSON.stringify(CATALOGUE_TABLES.map((t) => { try { return f.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(); } catch { return null; } }));
async function rowOf(f: F, source: string, id: string) {
  const list = await su(f, 'GET', `/mappings?source=${source}`);
  assert.equal(list.status, 200, JSON.stringify(list.body));
  return list.body.records.find((r: any) => r.provider_record_id === id);
}

/* ----------------------------------------------------------- 1. schema */

test('1. the migration builds two empty research_source_* tables; the history refuses UPDATE and DELETE; no organisation column', async () => {
  // Mutations checked: the no_update trigger dropped → the UPDATE succeeds and the throws assertion fails; the
  // no_delete trigger dropped → likewise for DELETE.
  const f = await fixture();
  const cols = (t: string) => (f.db.prepare(`PRAGMA table_info(${t})`).all() as any[]).map((c) => c.name);
  assert.deepEqual(cols('research_source_record_links'), ['source_key', 'provider_record_id', 'kind', 'decision', 'ground_code', 'target_type',
    'target_source_key', 'target_id', 'reason_code', 'note', 'decided_by_user_id', 'decided_at', 'revision', 'promoted_uid', 'promoted_at']);
  assert.ok(!cols('research_source_link_history').includes('note'), 'the history holds no note');
  for (const t of ['research_source_record_links', 'research_source_link_history']) {
    assert.ok(!cols(t).some((c) => /organi[sz]ation/.test(c)));
    assert.equal(count(f, t), 0);
  }
  assert.equal((await create(f, LA, 'a-lone')).status, 200);
  assert.throws(() => f.db.exec(`UPDATE research_source_link_history SET decision = 'reject'`), /append-only/);
  assert.throws(() => f.db.exec(`DELETE FROM research_source_link_history`), /append-only/);
  assert.equal(count(f, 'research_source_link_history'), 1);
  // Kinds are a list in code, not a CHECK: a later plan's kind needs no table rebuild.
  f.db.prepare(`INSERT INTO research_source_record_links (source_key, provider_record_id, kind, decision, decided_at) VALUES ('x', 'y', 'later_kind', 'create', 't')`).run();
});

/* ----------------------------------------------------------- 2. gates */

test('2. every route refuses signed out, a member, a plain admin, a branch and a support session; writes need the write bar', async () => {
  // Mutations checked: requireSuperAdmin swapped for requireAdmin on GET /mappings → the plain admin reads 200;
  // requireSuperAdminWriteBar swapped for requireSuperAdmin on /mappings/decide → the no-bar write reads 200.
  assert.deepEqual([mount.path, mount.router === router], [BASE, true]);
  const f = await fixture();
  const branch = await fixture({ BRANCH_CODE: 'synthetic-branch' });
  const routes: Array<[string, string]> = [['GET', '/mappings'], ['GET', '/mappings/report'], ['POST', '/mappings/record'],
    ['POST', '/mappings/decide'], ['POST', '/mappings/bulk/preview'], ['POST', '/mappings/bulk/apply']];
  const before = mappingState(f);
  for (const [method, path] of routes) {
    const body = method === 'POST' ? { ...ref(LA, 'a-lone'), kind: 'manager', decision: 'create' } : undefined;
    assert.equal((await call(f, null, method, path, body)).status, 401, `${method} ${path} signed out`);
    assert.equal((await call(f, MEMBER, method, path, body)).status, 403, `${method} ${path} member`);
    assert.equal((await call(f, ADMIN, method, path, body)).status, 403, `${method} ${path} plain admin`);
    assert.equal((await call(branch, SUPER, method, path, body)).status, 403, `${method} ${path} branch`);
    const support = await call(f, 'support', method, path, body);
    assert.deepEqual([support.status, support.body.error], [403, 'support_session_refused'], `${method} ${path} support`);
    assert.equal(support.body.message, REFUSAL_SENTENCES.support_session_refused);
  }
  for (const path of ['/mappings/decide', '/mappings/bulk/apply']) {
    assert.equal((await su(f, 'POST', path, { ...ref(LA, 'a-lone'), kind: 'manager', decision: 'create' }, { bar: false })).status, 403, `${path} without the bar`);
  }
  assert.equal(mappingState(f), before, 'no refused call wrote anything');
  assert.equal((await su(f, 'GET', '/mappings', undefined, { bar: false })).status, 200, 'a read passes with the elevation alone');
  assert.equal((await su(f, 'GET', '/mappings?q=anything')).status, 200, 'an unknown parameter is ignored: there is no search');
  assert.equal((await su(f, 'GET', '/mappings?kind=fund')).body.error, 'filter_invalid');
});

/* ----------------------------------------------------------- 3. no link row, shared website */

test('3. a record with no link row is unresolved; a shared host is a marked suggestion, never the only ground, and refuses a list whole', async () => {
  // Mutations checked: the shared-host check removed from the link rules → the website_host link reads 200; refuseShared
  // emptied → the list naming a-shared previews 200; the platform list emptied → b-plat carries no shared_website flag.
  const f = await fixture();
  const lone = await rowOf(f, LA, 'a-lone');
  assert.deepEqual([lone.decision, lone.outcome, lone.unresolved, lone.label], [null, 'unresolved', 'no_decision', 'Example Lone Fund']);
  assert.ok((await rowOf(f, LB, 'b-plat')).flags.includes('shared_website'), 'a social platform host is shared');

  const a = await su(f, 'POST', '/mappings/record', ref(LA, 'a-shared'));
  const b = await su(f, 'POST', '/mappings/record', ref(LB, 'b-shared'));
  for (const [read, other] of [[a, ['invented_list_b', 'b-shared']], [b, ['invented_list_a', 'a-shared']]] as const) {
    assert.equal(read.body.record.shared_website, true);
    const offered = read.body.candidates.find((c: any) => c.target_type === 'staged_record' && c.target_source_key === other[0] && c.target_id === other[1]);
    assert.deepEqual([offered?.ground, offered?.shared_website], ['website_host', true], 'each offered the other, marked');
  }
  assert.equal((await create(f, LB, 'b-shared')).status, 200);
  const before = mappingState(f);
  const onHost = await linkTo(f, LA, 'a-shared', staged(LB, 'b-shared'), 'website_host');
  assert.deepEqual([onHost.status, onHost.body.error], [422, 'shared_website_ground']);
  for (const id of [['invented_list_a', 'a-shared'], ['invented_list_b', 'b-shared']]) {
    const list = await su(f, 'POST', '/mappings/bulk/preview', { entries: [{ ...ref(id[0], id[1]), kind: 'manager', decision: 'reject', reason: 'out_of_scope' }] });
    assert.deepEqual([list.status, list.body.error], [422, 'shared_website_in_list']);
  }
  assert.equal(mappingState(f), before, 'nothing changed');
  assert.equal((await rowOf(f, LA, 'a-shared')).outcome, 'unresolved', 'still two records');
  // On another ground (a person's check, with its reason), the link is taken.
  const verified = await linkTo(f, LA, 'a-shared', staged(LB, 'b-shared'), 'operator_verified', 'manager', { reason: 'verified_by_operator', note: NOTE });
  assert.equal(verified.status, 200, JSON.stringify(verified.body));
});

/* ----------------------------------------------------------- 4. one organisation in two sources */

test('4. one organisation in two sources: one create, one link to it; after markPromoted both resolve to one uid', async () => {
  // Mutations checked: outcomeOf's staged-target branch returning `waiting` → b-gamma stays unresolved after promotion;
  // `created` derived without the promotion mark → a-gamma reads created before markPromoted.
  const f = await fixture();
  assert.equal((await create(f, LA, 'a-gamma')).status, 200);
  const linked = await linkTo(f, LB, 'b-gamma', staged(LA, 'a-gamma'), 'name_key');
  assert.equal(linked.status, 200, JSON.stringify(linked.body));
  for (const [s, i] of [[LA, 'a-gamma'], [LB, 'b-gamma']]) {
    const r = await rowOf(f, s, i);
    assert.deepEqual([r.outcome, r.unresolved, r.resolved_uid], ['unresolved', 'awaiting_promotion', null], `${i} before promotion`);
  }
  const catBefore = catalogueState(f);
  const promoted = await markPromoted(f.DB, { sourceKey: LA, providerRecordId: 'a-gamma', uid: 'example-gamma-promoted', actorUserId: SUPER, now: NOW });
  assert.deepEqual(promoted, { promoted_uid: 'example-gamma-promoted', written: true });
  assert.deepEqual(await markPromoted(f.DB, { sourceKey: LA, providerRecordId: 'a-gamma', uid: 'example-gamma-promoted', actorUserId: SUPER, now: NOW }),
    { promoted_uid: 'example-gamma-promoted', written: false }, 'the same mark again is a no-op');
  await assert.rejects(markPromoted(f.DB, { sourceKey: LA, providerRecordId: 'a-gamma', uid: 'example-zeta-seed', actorUserId: SUPER, now: NOW }), /already_promoted/);
  await assert.rejects(markPromoted(f.DB, { sourceKey: LB, providerRecordId: 'b-gamma', uid: 'example-gamma-promoted', actorUserId: SUPER, now: NOW }), /not_create/);
  assert.equal(catalogueState(f), catBefore, 'the mark writes no catalogue row');
  const ra = await rowOf(f, LA, 'a-gamma'); const rb = await rowOf(f, LB, 'b-gamma');
  assert.deepEqual([ra.outcome, rb.outcome], ['created', 'linked']);
  assert.equal(ra.resolved_uid, 'example-gamma-promoted');
  assert.equal(rb.resolved_uid, ra.resolved_uid, 'both resolve to one uid');
  // A promoted record's decision stands.
  assert.equal((await decide(f, { ...ref(LA, 'a-gamma'), kind: 'manager', decision: 'reject', reason: 'other' })).body.error, 'record_promoted');
});

/* ----------------------------------------------------------- 5. link rules */

test('5. a link to a non-create record, to itself or through a chain is refused; kinds take different targets', async () => {
  // Mutations checked: the self-link check removed → a-lone→a-lone is refused for another code; the dependents check
  // removed → a-gamma turns to reject while b-gamma links to it; the kind check removed → the vehicle links to the manager.
  const f = await fixture();
  const notCreate = await linkTo(f, LB, 'b-gamma', staged(LA, 'a-gamma'), 'name_key');
  assert.deepEqual([notCreate.status, notCreate.body.error], [422, 'link_target_not_create']);
  assert.equal((await linkTo(f, LA, 'a-lone', staged(LA, 'a-lone'), 'operator_verified', 'manager', { reason: 'other' })).body.error, 'self_link');
  assert.equal((await create(f, LA, 'a-gamma')).status, 200);
  assert.equal((await linkTo(f, LB, 'b-gamma', staged(LA, 'a-gamma'), 'name_key')).status, 200);
  // Chain: a link to b-gamma (itself a link) is refused, and a-gamma cannot stop being a create while linked to.
  assert.equal((await linkTo(f, LA, 'a-lone', staged(LB, 'b-gamma'), 'operator_verified', 'manager', { reason: 'other' })).body.error, 'link_target_not_create');
  const unlink = await decide(f, { ...ref(LA, 'a-gamma'), kind: 'manager', decision: 'reject', reason: 'other' });
  assert.deepEqual([unlink.status, unlink.body.error], [409, 'record_is_link_target']);
  // A manager and its vehicle: different kinds and targets.
  assert.equal((await create(f, LA, 'a-delta-m', 'manager')).status, 200);
  const manager = await su(f, 'POST', '/mappings/record', ref(LA, 'a-delta-m'));
  assert.ok(manager.body.candidates.some((c: any) => c.ground === 'manager_fund_number' && c.target_id === 'example-delta-ventures-ii'),
    'the served vehicle is offered to its manager by manager plus fund number');
  assert.equal((await linkTo(f, LA, 'a-delta-v', staged(LA, 'a-delta-m'), 'operator_verified', 'vehicle', { reason: 'other' })).body.error, 'link_kind_mismatch');
  const vehicle = await linkTo(f, LA, 'a-delta-v', catalogue('example-delta-ventures-ii'), 'name_key', 'vehicle');
  assert.equal(vehicle.status, 200, JSON.stringify(vehicle.body));
  const rows = [await rowOf(f, LA, 'a-delta-m'), await rowOf(f, LA, 'a-delta-v')];
  assert.deepEqual(rows.map((r) => [r.kind, r.decision, r.outcome]), [['manager', 'create', 'unresolved'], ['vehicle', 'link', 'linked']]);
  // A ground the candidates do not bear out is refused.
  assert.equal((await linkTo(f, LA, 'a-eps', catalogue('example-zeta-seed'), 'name_key')).body.error, 'ground_not_supported');
});

test('6. a company, a funding round and an individual take neither create nor link; they may be kept privately or rejected', async () => {
  // Mutation checked: KIND_DECISIONS.company given every decision → the company create reads 200.
  const f = await fixture();
  for (const [id, kind] of [['a-co', 'company'], ['a-round', 'funding_round'], ['a-person', 'individual']]) {
    assert.deepEqual(KIND_DECISIONS[kind as 'company'], ['retain_private', 'reject']);
    for (const d of [{ decision: 'create' }, { decision: 'link', target: catalogue('example-zeta-seed'), ground: 'operator_verified', reason: 'other' }]) {
      const res = await decide(f, { ...ref(LA, id), kind, ...d });
      assert.deepEqual([res.status, res.body.error], [422, 'decision_not_allowed_for_kind'], `${kind} ${d.decision}`);
    }
  }
  assert.equal((await decide(f, { ...ref(LA, 'a-co'), kind: 'company', decision: 'retain_private', reason: 'out_of_scope' })).status, 200);
  assert.equal((await decide(f, { ...ref(LA, 'a-person'), kind: 'individual', decision: 'reject', reason: 'about_a_person' })).status, 200);
  assert.equal((await decide(f, { ...ref(LA, 'a-round'), kind: 'funding_round', decision: 'reject' })).body.error, 'reason_required');
});

test('7. an unknown uid and a row of a not-allowed list are refused; a retired uid is refused naming where it moved', async () => {
  // Mutations checked: the served-set check removed → the withheld row is linked; the moves lookup removed → the
  // retired uid reads target_not_served without moved_to.
  const f = await fixture();
  const unknown = await linkTo(f, LA, 'a-lone', catalogue('example-no-such-fund'), 'operator_verified', 'manager', { reason: 'other' });
  assert.deepEqual([unknown.status, unknown.body.error], [422, 'target_not_served']);
  const withheld = await linkTo(f, LA, 'a-lone', catalogue('example-withheld-fund'), 'operator_verified', 'manager', { reason: 'other' });
  assert.equal(withheld.body.error, 'target_not_served');
  const read = await su(f, 'POST', '/mappings/record', ref(LA, 'a-old'));
  const retired = read.body.candidates.find((c: any) => c.retired);
  assert.deepEqual([retired?.target_id, retired?.moved_to, retired?.ground], ['exampleoldcapital', 'example-new-capital-i', 'retired_uid']);
  const toOld = await linkTo(f, LA, 'a-old', catalogue('exampleoldcapital'), 'retired_uid');
  assert.deepEqual([toOld.status, toOld.body.error, toOld.body.names.moved_to], [422, 'target_uid_retired', 'example-new-capital-i']);
  assert.equal((await linkTo(f, LA, 'a-old', catalogue('example-new-capital-i'), 'retired_uid')).status, 200, 'the uid it moved to is taken');
});

/* ----------------------------------------------------------- 8. outcomes and the report */

test('8. the five counts sum to the staged total for every source and kind, each record in one; the summary holds counts only', async () => {
  // Mutations checked: `t[d.outcome]++` dropped → the per-kind sums fall short of staged; unresolved sub-counts
  // swapped → the awaiting_promotion count reads 0.
  const f = await fixture();
  await create(f, LA, 'a-gamma');
  await linkTo(f, LB, 'b-gamma', staged(LA, 'a-gamma'), 'name_key');
  await decide(f, { ...ref(LA, 'a-co'), kind: 'company', decision: 'retain_private', reason: 'out_of_scope' });
  await decide(f, { ...ref(LA, 'a-person'), kind: 'individual', decision: 'reject', reason: 'about_a_person' });
  await linkTo(f, LA, 'a-delta-v', catalogue('example-delta-ventures-ii'), 'name_key', 'vehicle');
  await create(f, LB, 'b-zeta');
  await markPromoted(f.DB, { sourceKey: LB, providerRecordId: 'b-zeta', uid: 'example-zeta-seed', actorUserId: SUPER, now: NOW });
  const report = await su(f, 'GET', '/mappings/report');
  assert.equal(report.status, 200);
  const { summary } = report.body;
  assert.equal(summary.unit, 'records');
  const stagedCount = { invented_list_a: A.length, invented_list_b: B.length } as Record<string, number>;
  for (const s of summary.sources) {
    let total = 0;
    for (const [kind, t] of Object.entries(s.kinds) as Array<[string, any]>) {
      assert.equal(t.created + t.linked + t.retained_private + t.rejected + t.unresolved, t.staged, `${s.source_key} ${kind}`);
      assert.equal(t.no_decision + t.awaiting_promotion, t.unresolved);
      total += t.staged;
    }
    assert.equal(total, stagedCount[s.source_key]);
    assert.equal(s.records.staged, stagedCount[s.source_key]);
    assert.deepEqual([s.manifest.records.matches, s.manifest.columns.matches, s.manifest.cells.matches], [true, true, true], s.source_key);
  }
  const a = summary.sources.find((s: any) => s.source_key === LA).records;
  assert.deepEqual([a.created, a.linked, a.retained_private, a.rejected, a.no_decision, a.awaiting_promotion], [0, 1, 1, 1, 6, 1]);
  const b = summary.sources.find((s: any) => s.source_key === LB).records;
  assert.deepEqual([b.created, b.linked, b.awaiting_promotion, b.no_decision], [1, 0, 1, 2]);
  // Each record in exactly one line, with one outcome.
  const keys = report.body.lines.map((l: any) => `${l.source_key}/${l.provider_record_id}`);
  assert.equal(new Set(keys).size, A.length + B.length);
  const text = JSON.stringify(summary);
  assert.ok(!text.includes(MARK) && !text.includes('Example') && !A.some((r) => text.includes(r.id)), 'counts only: no value, label or id');
});

/* ----------------------------------------------------------- 9. history */

test('9. changing a decision keeps the earlier one in the history, which holds ids, codes, actor and time only', async () => {
  // Mutation checked: the upsert's revision kept from the old row → the link's revision reads 1.
  const f = await fixture();
  await decide(f, { ...ref(LA, 'a-lone'), kind: 'manager', decision: 'create', note: NOTE });
  await decide(f, { ...ref(LA, 'a-lone'), kind: 'resource', decision: 'reject', reason: 'out_of_scope', note: NOTE });
  const read = await su(f, 'POST', '/mappings/record', ref(LA, 'a-lone'));
  assert.deepEqual(read.body.history.map((h: any) => [h.revision, h.kind, h.decision, h.actor_user_id]), [[1, 'manager', 'create', SUPER], [2, 'resource', 'reject', SUPER]]);
  assert.equal(read.body.decision.note, NOTE, 'the note is read back in the full read');
  assert.deepEqual([read.body.decision.revision, read.body.decision.kind, read.body.decision.decision], [2, 'resource', 'reject']);
  assert.ok(!JSON.stringify(f.db.prepare('SELECT * FROM research_source_link_history').all()).includes(MARK), 'no note in the history');
});

/* ----------------------------------------------------------- 10. lists */

test('10. a list with an unknown key, a duplicate key or a disallowed kind changes nothing; over the bound, stale digest and replay', async () => {
  // Mutations checked: the duplicate check removed → the duplicate list previews 200; the digest comparison removed →
  // the stale apply writes; the unchanged short-cut removed → the replay is refused as stale instead of writing nothing.
  const f = await fixture();
  const good = [
    { ...ref(LA, 'a-gamma'), kind: 'manager', decision: 'create', note: NOTE },
    { ...ref(LB, 'b-gamma'), kind: 'manager', decision: 'link', target: staged(LA, 'a-gamma'), ground: 'name_key' },
    { ...ref(LA, 'a-co'), kind: 'company', decision: 'retain_private', reason: 'out_of_scope' },
  ];
  const before = mappingState(f);
  for (const [bad, code] of [
    [[...good, { ...ref(LA, 'a-unknown'), kind: 'manager', decision: 'create' }], 'unknown_record'],
    [[...good, good[0]], 'duplicate_entry'],
    [[...good, { ...ref(LA, 'a-person'), kind: 'individual', decision: 'create' }], 'decision_not_allowed_for_kind'],
  ] as const) {
    const preview = await su(f, 'POST', '/mappings/bulk/preview', { entries: bad });
    assert.equal(preview.body.error, code);
    const apply = await su(f, 'POST', '/mappings/bulk/apply', { entries: bad, preview_digest: 'a'.repeat(64) });
    assert.equal(apply.body.error, code);
  }
  const long = Array.from({ length: MAPPING_LIMITS.MAX_LIST + 1 }, (_, i) => ({ ...ref(LA, `x-${i}`), kind: 'manager', decision: 'create' }));
  assert.deepEqual([(await su(f, 'POST', '/mappings/bulk/preview', { entries: long })).status, (await su(f, 'POST', '/mappings/bulk/preview', { entries: long })).body.error], [413, 'list_too_long']);
  assert.equal(mappingState(f), before, 'nothing changed, history included');

  const preview = await su(f, 'POST', '/mappings/bulk/preview', { entries: good });
  assert.deepEqual([preview.status, preview.body.would_change, preview.body.writes], [200, 3, 'none']);
  assert.equal(mappingState(f), before, 'a preview writes nothing');
  // A named record changes after the preview: the apply is refused and writes nothing.
  await decide(f, { ...ref(LA, 'a-co'), kind: 'company', decision: 'reject', reason: 'other' });
  const changedSince = mappingState(f);
  const stale = await su(f, 'POST', '/mappings/bulk/apply', { entries: good, preview_digest: preview.body.preview_digest });
  assert.deepEqual([stale.status, stale.body.error], [409, 'preview_stale']);
  assert.equal(mappingState(f), changedSince);
  const fresh = await su(f, 'POST', '/mappings/bulk/preview', { entries: good });
  const applied = await su(f, 'POST', '/mappings/bulk/apply', { entries: good, preview_digest: fresh.body.preview_digest });
  assert.deepEqual([applied.status, applied.body.written], [200, 3], JSON.stringify(applied.body));
  const history = count(f, 'research_source_link_history');
  const again = await su(f, 'POST', '/mappings/bulk/apply', { entries: good, preview_digest: fresh.body.preview_digest });
  assert.deepEqual([again.status, again.body.written, again.body.unchanged], [200, 0, 3]);
  assert.equal(count(f, 'research_source_link_history'), history, 'the same list twice writes no second history row');
});

test('11. a decision or record landing between the read and the batch fences the whole write out', async () => {
  // Mutation checked: the fence conditions removed from insertHistory → the decision is written over the newer state.
  const f = await fixture();
  const before = count(f, 'research_source_record_links');
  f.faults.beforeBatch = () => f.db.prepare(`INSERT INTO research_source_link_history (batch_uid, event, source_key, provider_record_id, revision, kind, decision, at)
    VALUES ('other-request', 'decided', 'invented_list_a', 'a-eps', 1, 'manager', 'create', '2026-11-27T10:41:00Z')`).run();
  const res = await create(f, LA, 'a-lone');
  assert.deepEqual([res.status, res.body.error], [409, 'state_changed']);
  assert.equal(count(f, 'research_source_record_links'), before);
  assert.equal(count(f, 'research_source_link_history'), 1, 'only the other request\'s row');
});

/* ----------------------------------------------------------- 12. privacy, audit, catalogue */

test('12. no response but the full read, no log line, refusal or audit row holds a value or a note; a full read audits the record id; no catalogue change', async () => {
  // Mutations checked: the read's audit row given the provider id and label → the details assertion fails; the list
  // label taken from the prose column → MARK appears in the list response.
  const f = await fixture();
  const cat = catalogueState(f);
  const lines: string[] = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  for (const k of ['log', 'warn', 'error'] as const) (console as any)[k] = (...a: unknown[]) => lines.push(a.map(String).join(' '));
  try {
    await decide(f, { ...ref(LA, 'a-lone'), kind: 'manager', decision: 'create', note: NOTE });
    await decide(f, { ...ref(LA, 'a-lone'), kind: 'manager', decision: 'link', note: NOTE });
    await su(f, 'POST', '/mappings/bulk/preview', { entries: [{ ...ref(LA, 'a-shared'), kind: 'manager', decision: 'create', note: NOTE }] });
    await su(f, 'GET', '/mappings');
    await su(f, 'GET', '/mappings/report');
    const fullReads = f.responses.length;
    const read = await su(f, 'POST', '/mappings/record', ref(LA, 'a-eps'));
    assert.equal(read.status, 200);
    assert.ok(JSON.stringify(read.body.cells).includes(MARK), 'the full read returns the stored cells');
    assert.ok(!JSON.stringify(read.body.cells).includes('@example.com'), 'a contact value was never stored');
    for (const text of f.responses.slice(0, fullReads)) assert.ok(!text.includes(MARK), text.slice(0, 200));
  } finally { Object.assign(console, orig); }
  assert.ok(!lines.join('\n').includes(MARK));
  const audits = f.db.prepare(`SELECT action, filters_json FROM admin_audit_log ORDER BY id`).all() as any[];
  assert.ok(!JSON.stringify(audits).includes(MARK) && !JSON.stringify(audits).includes('Example'));
  const reads = audits.filter((a) => a.action === AUDIT_ACTIONS.read);
  const recordId = (f.db.prepare(`SELECT MAX(id) AS id FROM research_source_records WHERE provider_record_id = 'a-eps'`).get() as any).id;
  assert.deepEqual(reads.map((a) => JSON.parse(a.filters_json)), [{ record_id: recordId }], 'one audit row per full read, the record id only');
  assert.equal(catalogueState(f), cat, 'no catalogue, statement or company table changed');
});

test('13. keys follow D7326: name key, bare host', () => {
  // Mutation checked: the www. strip removed → the two shared hosts differ.
  assert.equal(nameKey('Example  Gamma-Partners (Fund)'), 'examplegammapartnersfund');
  assert.equal(bareHost('http://www.Shared.example.org:8080/b?x#y'), 'shared.example.org');
  assert.equal(bareHost('https://shared.example.org./a'), 'shared.example.org');
  assert.notEqual(bareHost('https://shared-example.org'), bareHost('https://shared.example.org'), 'similar hosts are not equal');
  assert.equal(bareHost('not a host'), null);
});
