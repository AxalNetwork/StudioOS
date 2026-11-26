/**
 * D7745 (#7745) — the Research imports routes at /api/research-source-imports, mounted over the migrated schema
 * (baseline plus every migration, #7742's store included), with foreign keys on as D1 has them.
 *
 * Invented data only: records at synthetic.invalid, MARK planted in every invented value. Contact columns are left out
 * by the client before upload (#7739 Q3 B), as the routes require.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/research_source_imports_7745.test.ts
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import router, { mount, REFUSAL_SENTENCES, researchImportGate } from '../src/routes/research_source_imports.ts';
import { requireSuperAdmin, requireSuperAdminWriteBar } from '../src/auth.ts';
import { AUDIT_ACTIONS, IMPORT_LIMITS } from '../src/services/researchSourceImports.ts';
import { bodyJson, membershipDigest, sealRun, sha256Hex, type CellValue } from '../src/services/researchSourceRecords.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { grantWriteBar } from './_write_bar_session.mjs';
import { loadSchema, SCHEMA_OPTIONS } from './_schema_once.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'research-source-imports-7745-'));
const seedPath = join(scratch, 'schema.sqlite');
const seed = new DatabaseSync(seedPath, SCHEMA_OPTIONS);
loadSchema(seed); seed.close();
after(() => rmSync(scratch, { recursive: true, force: true }));

const JWT_SECRET = 'synthetic-7745-only-not-a-real-credential'.repeat(2);
const SUPER = 1; const ADMIN = 2; const MEMBER = 3;
const BASE = '/api/research-source-imports';
const MARK = 'QXMARK7745';
const SEAL_CLOCK = new Date('2026-11-23T12:00:00Z');
const STORE_TABLES = ['research_source_runs', 'research_source_records', 'research_source_run_records', 'research_source_private_fields',
  'research_source_flags', 'research_source_column_rules', 'research_source_removals'];
let n = 0;

type Rec = { source_key: string; provider_record_id: string; stated_row_hash: string; body_sha256: string; cells: Array<[string, CellValue]> };

function fixture(env: Record<string, unknown> = {}) {
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
  const DB = d1Over(db) as any;
  const batches: string[][] = [];
  const prepare = DB.prepare.bind(DB);
  DB.prepare = (sql: string) => { const st = prepare(sql); st.__sql = sql; return st; };
  const batch = DB.batch.bind(DB);
  const faults = { batch: 0, beforeBatch: null as null | (() => void) };
  DB.batch = async (stmts: any[]) => {
    batches.push(stmts.map((s) => s.__sql));
    if (faults.beforeBatch) { const hook = faults.beforeBatch; faults.beforeBatch = null; hook(); }
    if (faults.batch > 0 && stmts.length === 5) { faults.batch--; throw new Error('synthetic batch fault'); }
    return batch(stmts);
  };
  const limited = { next429: 0 };
  const app = new Hono<any>();
  // A stand-in for the default rate limit: a 429 answered before the router, as the real middleware does.
  app.use('*', async (c, next) => { if (limited.next429 > 0) { limited.next429--; return c.json({ error: 'rate_limited' }, 429); } return next(); });
  app.route(mount.path, router);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  return { db, app, batches, faults, limited, jti, responses: [] as string[], env: { DB, JWT_SECRET, ENVIRONMENT: 'development', WORKER_DEPLOY_VERSION: 'synthetic-version', ...env } as any };
}
type F = ReturnType<typeof fixture>;

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
const su = (f: F, method: string, path: string, body?: unknown, opts: { bar?: boolean; raw?: string } = {}) => call(f, SUPER, method, path, body, opts);

/* ----------------------------------------------------------- an invented package of the audited kind, small */

const SOURCES = [
  { key: 'invented_funds', columns: ['name', 'website', 'notes', 'stages', 'email'], contact: ['email'], n: 12 },
  { key: 'invented_rounds', columns: ['company', 'amount', 'announced', 'lead'], contact: [] as string[], n: 30 },
];

async function record(source: typeof SOURCES[0], i: number, version = 0): Promise<Rec> {
  const id = `${source.key.slice(9, 12)}-${String(i).padStart(4, '0')}`;
  // The contact column is left out here, by the client, before upload (Q3 B).
  const cells = source.columns.filter((c) => !source.contact.includes(c)).map((c, j) => [c,
    j === 1 && i % 5 === 0 ? '' : j === 2 ? [`Seed ${MARK}`, `Series A ${MARK}`] : `${c} ${i} v${version} ${MARK} at ${source.key}.synthetic.invalid`,
  ]) as Array<[string, CellValue]>;
  return { source_key: source.key, provider_record_id: id, stated_row_hash: `stated-${id}-v${version}`, body_sha256: await sha256Hex(bodyJson(cells)), cells };
}

async function pkg(version = 0) {
  const records: Rec[] = [];
  for (const s of SOURCES) for (let i = 0; i < s.n; i++) records.push(await record(s, i, version));
  const manifest = { sources: await Promise.all(SOURCES.map(async (s) => {
    const mine = records.filter((r) => r.source_key === s.key);
    return { source_key: s.key, columns: s.columns, expected_records: mine.length, expected_cells: mine.length * s.columns.length,
      digest: await membershipDigest(mine), excluded_person_records: 1 };
  })) };
  const column_classes = Object.fromEntries(SOURCES.map((s) => [s.key, Object.fromEntries(s.columns.map((c) => [c,
    s.contact.includes(c) ? { class: 'contact', contact: 'withheld' } : { class: c === 'notes' ? 'prose' : 'fact' }]))]));
  const entries = records.map((r) => [r.source_key, r.provider_record_id, r.stated_row_hash]);
  return { records, manifest, column_classes, entries };
}
const chunks = <T>(list: T[], size = IMPORT_LIMITS.MAX_CHUNK_RECORDS) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));
const FILE = 'f'.repeat(64);
let keys = 0;
const newKey = () => `synthetic-run-key-${++keys}`;

async function openRun(f: F, p: Awaited<ReturnType<typeof pkg>>, key = newKey()) {
  return su(f, 'POST', '/runs', { idempotency_key: key, manifest: p.manifest, column_classes: p.column_classes, file_sha256: FILE });
}
/** Open, send every chunk (12 records each, so several chunks mix sources), and seal. */
async function apply(f: F, p: Awaited<ReturnType<typeof pkg>>, opts: { skip?: number; size?: number } = {}) {
  const opened = await openRun(f, p);
  assert.ok([200, 201].includes(opened.status), JSON.stringify(opened.body));
  const uid = opened.body.run.uid as string;
  const parts = chunks(p.records, opts.size ?? 12);
  for (const [i, records] of parts.entries()) {
    if (i === opts.skip) continue;
    const sent = await su(f, 'POST', `/runs/${uid}/chunks`, { chunk_index: i, records });
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
  }
  const sealed = await su(f, 'POST', `/runs/${uid}/seal`, { expected: p.entries });
  assert.equal(sealed.status, 200, JSON.stringify(sealed.body));
  return { uid, sealed: sealed.body, parts };
}
const snapshot = (f: F) => JSON.stringify([...STORE_TABLES, 'admin_audit_log'].map((t) => {
  try { return f.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(); } catch { return null; }
}));
const audits = (f: F) => { try { return f.db.prepare('SELECT action, filters_json FROM admin_audit_log ORDER BY id').all() as any[]; } catch { return []; } };
const count = (f: F, t: string) => Number((f.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as any).n);

/* ----------------------------------------------------------- 1. gates */

test('1. it mounts itself at its own path; every route refuses signed out, a member, a plain admin, a branch and a support session', async () => {
  // Mutations checked: the support-session check removed → the support caller reads 403 'Super admin required' without the code;
  // requireSuperAdmin swapped for requireAdmin on GET /runs → the plain admin reads 200.
  assert.deepEqual([mount.path, mount.router === router], [BASE, true]);
  const f = fixture();
  const branch = fixture({ BRANCH_CODE: 'synthetic-branch' });
  const routes: Array<[string, string]> = [['POST', '/preview'], ['GET', '/runs'], ['GET', '/runs/x'], ['POST', '/runs'],
    ['POST', '/runs/x/chunks'], ['POST', '/runs/x/seal'], ['POST', '/runs/x/reconcile'], ['POST', '/removals']];
  for (const [method, path] of routes) {
    const body = method === 'POST' ? {} : undefined;
    assert.equal((await call(f, null, method, path, body)).status, 401, `${method} ${path} signed out`);
    assert.equal((await call(f, MEMBER, method, path, body)).status, 403, `${method} ${path} member`);
    assert.equal((await call(f, ADMIN, method, path, body)).status, 403, `${method} ${path} plain admin`);
    assert.equal((await call(branch, SUPER, method, path, body)).status, 403, `${method} ${path} branch`);
    const support = await call(f, 'support', method, path, body);
    assert.deepEqual([support.status, support.body.error], [403, 'support_session_refused'], `${method} ${path} support`);
    assert.equal(support.body.message, REFUSAL_SENTENCES.support_session_refused);
  }
  // Every write also needs the write bar: a Super Admin without a fresh TOTP step-up is refused and nothing is written.
  const before = snapshot(f);
  for (const [method, path] of routes.filter(([m, p]) => m === 'POST' && p !== '/preview')) {
    assert.equal((await su(f, method, path, {}, { bar: false })).status, 403, `${method} ${path} without the write bar`);
  }
  assert.equal(snapshot(f), before);
  // Reads pass with the elevation alone.
  assert.equal((await su(f, 'GET', '/runs', undefined, { bar: false })).status, 200);
});

test('1b. the exported gate composes into another router on this prefix and answers as the import routes do', async () => {
  // #7746 imports `researchImportGate` rather than retyping it. A router built only from it, on the same prefix:
  // signed out 401, member, plain admin and branch 403, support session 403 support_session_refused, a write with no
  // fresh step-up 403, and the Super Admin passes with the user handed back.
  // Mutations checked: the support-session check removed → the support caller reads 403 without the code; the check
  // handed in skipped → the member reads 200. Equivalent: requireAuth dropped from the gate, since both checks sign in
  // the caller first and still answer 401.
  const composed = new Hono<any>();
  composed.get('/probe', async (c) => {
    const user = await researchImportGate(c, requireSuperAdmin);
    return user instanceof Response ? user : c.json({ id: (user as any).id });
  });
  composed.post('/probe', async (c) => {
    const user = await researchImportGate(c, requireSuperAdminWriteBar);
    return user instanceof Response ? user : c.json({ id: (user as any).id });
  });
  const withComposed = (f: F) => {
    const app = new Hono<any>();
    app.route(`${BASE}/composed`, composed);
    app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
    return { ...f, app };
  };
  const f = withComposed(fixture());
  const branch = withComposed(fixture({ BRANCH_CODE: 'synthetic-branch' }));
  for (const method of ['GET', 'POST']) {
    const body = method === 'POST' ? {} : undefined;
    assert.equal((await call(f, null, method, '/composed/probe', body)).status, 401, `${method} signed out`);
    assert.equal((await call(f, MEMBER, method, '/composed/probe', body)).status, 403, `${method} member`);
    assert.equal((await call(f, ADMIN, method, '/composed/probe', body)).status, 403, `${method} plain admin`);
    assert.equal((await call(branch, SUPER, method, '/composed/probe', body)).status, 403, `${method} branch`);
    const support = await call(f, 'support', method, '/composed/probe', body);
    assert.deepEqual([support.status, support.body.error, support.body.message],
      [403, 'support_session_refused', REFUSAL_SENTENCES.support_session_refused], `${method} support`);
    assert.deepEqual(await su(f, method, '/composed/probe', body), { status: 200, body: { id: SUPER } }, `${method} super admin`);
  }
  assert.equal((await su(f, 'POST', '/composed/probe', {}, { bar: false })).status, 403, 'a write with no fresh step-up');
  assert.deepEqual(await su(f, 'GET', '/composed/probe', undefined, { bar: false }), { status: 200, body: { id: SUPER } }, 'a read needs no step-up');
});

/* ----------------------------------------------------------- 2. preview */

test('2. preview answers new, unchanged, changed and removed per source and changes no table', async () => {
  // Mutation checked: the `same` test dropped from the preview statement → a replay previews as changed, not unchanged.
  const f = fixture();
  const p = await pkg();
  const before = snapshot(f);
  const pages = chunks(p.entries, 20);
  const first = await su(f, 'POST', '/preview', { manifest: p.manifest, pages }, { bar: false });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(snapshot(f), before, 'preview wrote nothing');
  assert.deepEqual(first.body.sources.map((s: any) => [s.source_key, s.sent, s.new, s.unchanged, s.changed, s.removed, s.list_digest_matches]),
    [['invented_funds', 12, 12, 0, 0, 0, true], ['invented_rounds', 30, 30, 0, 0, 0, true]]);
  const statements = f.batches.length;
  assert.equal(statements, 0, 'no batch');

  await apply(f, p);
  const v1 = await pkg(1);
  const mixed = [...p.entries.slice(0, 5), ...v1.entries.slice(5, 10)];
  const again = await su(f, 'POST', '/preview', { manifest: p.manifest, pages: [mixed] }, { bar: false });
  assert.deepEqual(again.body.sources[0], { source_key: 'invented_funds', expected_records: 12, sent: 10, new: 0, unchanged: 5, changed: 5,
    removed: 0, private_fields_removed: 0, list_digest_matches: null }, 'a part of a list is not checked against the digest');
  // An oversized page, and an entry for a source the manifest does not list, are refused.
  assert.equal((await su(f, 'POST', '/preview', { manifest: p.manifest, pages: [Array(IMPORT_LIMITS.PREVIEW_PAGE + 1).fill(p.entries[0])] })).body.error, 'page_invalid');
  assert.equal((await su(f, 'POST', '/preview', { manifest: p.manifest, pages: [[['invented_other', 'x', 'y']]] })).body.error, 'unknown_source');
});

/* ----------------------------------------------------------- 3. runs */

test('3. a run needs a key; the same key twice writes once and answers the first run; a second run is refused while one is open', async () => {
  // The race past the open-run check is test 3b.
  const f = fixture();
  const p = await pkg();
  const noKey = await su(f, 'POST', '/runs', { manifest: p.manifest, column_classes: p.column_classes, file_sha256: FILE });
  assert.deepEqual([noKey.status, noKey.body.error], [400, 'idempotency_key_required']);
  const key = newKey();
  const a = await openRun(f, p, key);
  const b = await openRun(f, p, key);
  assert.deepEqual([a.status, b.status, b.body.replayed, b.body.run.uid], [201, 200, true, a.body.run.uid]);
  assert.deepEqual(a.body.chunk_bound, { records: 50, bytes: IMPORT_LIMITS.MAX_CHUNK_BYTES });
  assert.equal(a.body.run.file_digest.status, 'declared_not_checked');
  assert.equal(a.body.run.worker_version, 'synthetic-version');
  assert.equal(count(f, 'research_source_runs'), 1);
  const other = await openRun(f, p);
  assert.deepEqual([other.status, other.body.error, other.body.names.run_uid], [409, 'run_open', a.body.run.uid]);
  assert.equal(count(f, 'research_source_runs'), 1);
  assert.deepEqual(audits(f).map((r) => r.action), [AUDIT_ACTIONS.opened], 'one audit row for the one run opened');
  // A key reused with a different file digest is refused; a held contact column and a named recipe are refused.
  const reused = await su(f, 'POST', '/runs', { idempotency_key: key, manifest: p.manifest, column_classes: p.column_classes, file_sha256: 'e'.repeat(64) });
  assert.equal(reused.body.error, 'idempotency_key_reused');
  const held = structuredClone(p.column_classes); (held as any).invented_funds.email = { class: 'contact', contact: 'held' };
  assert.equal((await su(f, 'POST', '/runs', { idempotency_key: newKey(), manifest: p.manifest, column_classes: held, file_sha256: FILE })).body.error, 'held_not_enabled');
  assert.equal((await su(f, 'POST', '/runs', { idempotency_key: newKey(), manifest: p.manifest, column_classes: p.column_classes, file_sha256: FILE, hash_recipe_id: 'invented' })).body.error, 'hash_recipe_unknown');
});

test('3b. a run opened by another request between the check and the write: this one writes no run, no rules and no audit row', async () => {
  // Mutations checked: the NOT EXISTS clause dropped → a second open run is written (201, not 409);
  // onlyIfChanged dropped from the open audit → the refused open still leaves an audit row.
  const f = fixture();
  const p = await pkg();
  f.faults.beforeBatch = () => {
    f.db.prepare(`INSERT INTO research_source_runs (uid, idempotency_key, payload_sha256, manifest_json, status, started_at)
      VALUES ('racing-run', 'racing-key-0001', ?, '{}', 'running', '2026-11-23T00:00:00Z')`).run(FILE);
  };
  const refusedOpen = await openRun(f, p);
  assert.deepEqual([refusedOpen.status, refusedOpen.body.error, refusedOpen.body.names.run_uid], [409, 'run_open', 'racing-run']);
  assert.equal(count(f, 'research_source_runs'), 1, 'only the racing run');
  assert.equal(count(f, 'research_source_column_rules'), 0, 'no rules fixed by a run that was not written');
  assert.deepEqual(audits(f), []);
});

/* ----------------------------------------------------------- 4. chunk refusals */

test('4. a chunk of 51, a chunk over the byte ceiling, a contact cell and a mismatched body hash are each refused and write nothing', async () => {
  // Mutations checked: MAX_CHUNK_RECORDS read as 100 → 51 records are written; the contact check removed → the email is
  // dropped by the store and the chunk is written; the hash comparison removed → the altered body is stored.
  const f = fixture();
  const p = await pkg();
  const uid = (await openRun(f, p)).body.run.uid;
  const before = snapshot(f);
  const many = [...p.records, ...(await pkg(2)).records.map((r) => ({ ...r, provider_record_id: `${r.provider_record_id}-b` }))].slice(0, 51);
  const r51 = await su(f, 'POST', `/runs/${uid}/chunks`, { chunk_index: 0, records: many });
  assert.deepEqual([r51.status, r51.body.error, r51.body.names.records], [413, 'chunk_too_large', 51]);
  const huge = await su(f, 'POST', `/runs/${uid}/chunks`, undefined, { raw: JSON.stringify({ chunk_index: 0, records: [p.records[0]], pad: 'x'.repeat(IMPORT_LIMITS.MAX_CHUNK_BYTES) }) });
  assert.deepEqual([huge.status, huge.body.error], [413, 'chunk_too_large']);
  const withEmail = { ...p.records[0], cells: [...p.records[0].cells, ['email', `someone-${MARK}@synthetic.invalid`]] as Array<[string, CellValue]> };
  withEmail.body_sha256 = await sha256Hex(bodyJson(withEmail.cells));
  const contact = await su(f, 'POST', `/runs/${uid}/chunks`, { chunk_index: 0, records: [withEmail, p.records[1]] });
  assert.deepEqual([contact.status, contact.body.error, contact.body.names.records], [422, 'contact_column_refused',
    [{ source_key: 'invented_funds', provider_record_id: p.records[0].provider_record_id, column: 'email' }]]);
  const altered = { ...p.records[2], cells: [['name', `changed ${MARK}`], ...p.records[2].cells.slice(1)] as Array<[string, CellValue]> };
  const mism = await su(f, 'POST', `/runs/${uid}/chunks`, { chunk_index: 0, records: [p.records[1], altered] });
  assert.deepEqual([mism.status, mism.body.error, mism.body.names.records], [422, 'body_hash_mismatch',
    [{ source_key: 'invented_funds', provider_record_id: p.records[2].provider_record_id }]]);
  assert.equal(snapshot(f), before, 'nothing was written by any of the four');
  assert.equal(f.batches.length, 1, 'only the run open batched');
});

test('5. a repeated chunk writes nothing; a used index with other records is refused', async () => {
  // Mutation checked: the replay short-cut removed → the second send runs the store's batch again.
  const f = fixture();
  const p = await pkg();
  const uid = (await openRun(f, p)).body.run.uid;
  const first = await su(f, 'POST', `/runs/${uid}/chunks`, { chunk_index: 0, records: p.records.slice(0, 10) });
  assert.deepEqual([first.body.status, first.body.counts.new], ['written', 10]);
  const batches = f.batches.length;
  const before = snapshot(f);
  const again = await su(f, 'POST', `/runs/${uid}/chunks`, { chunk_index: 0, records: p.records.slice(0, 10) });
  assert.deepEqual([again.status, again.body.status, again.body.written], [200, 'replayed', false]);
  assert.equal(snapshot(f), before);
  assert.equal(f.batches.length, batches, 'no batch for a replay');
  assert.equal((await su(f, 'POST', `/runs/${uid}/chunks`, { chunk_index: 0, records: p.records.slice(10, 12) })).body.error, 'chunk_index_reused');
  assert.equal((await su(f, 'POST', `/runs/${uid}/chunks`, { chunk_index: 1, records: p.records.slice(9, 12) })).body.error, 'record_in_other_chunk');
  assert.equal(snapshot(f), before);
});

/* ----------------------------------------------------------- 6. resume, seal */

test('6. an interrupted run resumes after a 429 and an expired step-up, and seals Complete with one audit row in the seal batch', async () => {
  // Mutation checked: the seal's audit statement moved out of the batch → the seal batch holds one statement.
  const f = fixture();
  const p = await pkg();
  const uid = (await openRun(f, p)).body.run.uid;
  const parts = chunks(p.records, 12);
  assert.equal((await su(f, 'POST', `/runs/${uid}/chunks`, { chunk_index: 0, records: parts[0] })).status, 200);
  f.limited.next429 = 1;
  assert.equal((await su(f, 'POST', `/runs/${uid}/chunks`, { chunk_index: 1, records: parts[1] })).status, 429);
  assert.equal((await su(f, 'POST', `/runs/${uid}/chunks`, { chunk_index: 1, records: parts[1] })).body.status, 'written', 'the resent chunk writes once');
  f.db.prepare("UPDATE user_sessions SET last_step_up_at = datetime('now', '-1 day'), created_at = datetime('now', '-1 day') WHERE jti = ?").run(f.jti);
  const before = snapshot(f);
  const lapsed = await su(f, 'POST', `/runs/${uid}/chunks`, { chunk_index: 2, records: parts[2] });
  assert.equal(lapsed.status, 403);
  assert.equal(snapshot(f), before, 'the lapsed step-up wrote nothing');
  f.db.prepare("UPDATE user_sessions SET last_step_up_at = datetime('now') WHERE jti = ?").run(f.jti);
  const read = await su(f, 'GET', `/runs/${uid}`, undefined, { bar: false });
  assert.deepEqual(read.body.held_chunks, [0, 1], 'the run says which chunks it holds');
  for (let i = 2; i < parts.length; i++) assert.equal((await su(f, 'POST', `/runs/${uid}/chunks`, { chunk_index: i, records: parts[i] })).status, 200);
  const sealed = await su(f, 'POST', `/runs/${uid}/seal`, { expected: p.entries });
  assert.equal(sealed.body.status, 'complete', JSON.stringify(sealed.body));
  assert.equal(sealed.body.sources.invented_funds.list_digest.matches, true);
  assert.deepEqual(sealed.body.sources.invented_funds.cells, { expected: 60, counted: 60, withheld: 12, matches: true }, 'the withheld email is counted');
  assert.equal(sealed.body.file_digest.status, 'declared_not_checked');
  const sealBatch = f.batches.at(-1)!;
  assert.equal(sealBatch.length, 2);
  assert.match(sealBatch[1], /INSERT INTO admin_audit_log/);
  assert.deepEqual(audits(f).map((r) => r.action), [AUDIT_ACTIONS.opened, AUDIT_ACTIONS.sealed]);
  // The store's own seal agrees.
  assert.equal((await sealRun(f.env.DB, uid, SEAL_CLOCK)).status, 'complete');
});

test('7. a missing chunk or an altered record seals partial naming the ids; reconcile resumes it to Complete or closes it', async () => {
  // Mutations checked: the missing-id loop removed → the skipped chunk's ids are not named; `resume` sets 'partial' → no chunk is accepted.
  const f = fixture();
  const p = await pkg();
  const { uid, sealed, parts } = await apply(f, p, { skip: 1 });
  assert.equal(sealed.status, 'partial');
  assert.deepEqual(sealed.named.missing.map((r: any) => r.provider_record_id).sort(), parts[1].map((r) => r.provider_record_id).sort());
  assert.equal((await sealRun(f.env.DB, uid, SEAL_CLOCK)).status, 'partial', 'the store\'s own seal agrees');
  assert.equal((await openRun(f, await pkg(5))).body.error, 'run_open', 'a partial run blocks the next');
  const resumed = await su(f, 'POST', `/runs/${uid}/reconcile`, { action: 'resume' });
  assert.deepEqual([resumed.status, resumed.body.run.status], [200, 'running']);
  assert.equal((await su(f, 'POST', `/runs/${uid}/chunks`, { chunk_index: 1, records: parts[1] })).body.status, 'written');
  assert.equal((await su(f, 'POST', `/runs/${uid}/seal`, { expected: p.entries })).body.status, 'complete');

  // One record sent under another stated hash: partial, named; closing the run ends the block.
  const g = fixture();
  const q = await pkg();
  const swapped = { ...q.records[3], stated_row_hash: 'stated-other' };
  const open = (await openRun(g, q)).body.run.uid;
  await su(g, 'POST', `/runs/${open}/chunks`, { chunk_index: 0, records: [...q.records.slice(0, 3), swapped, ...q.records.slice(4, 20)] });
  await su(g, 'POST', `/runs/${open}/chunks`, { chunk_index: 1, records: q.records.slice(20) });
  const part = (await su(g, 'POST', `/runs/${open}/seal`, { expected: q.entries })).body;
  assert.equal(part.status, 'partial');
  assert.deepEqual(part.named.hash_differs, [{ source_key: 'invented_funds', provider_record_id: q.records[3].provider_record_id }]);
  assert.equal(part.sources.invented_funds.list_digest.matches, false, 'the recomputed list digest differs from the declared one');
  // The expected list itself must be the declared one.
  assert.equal((await su(g, 'POST', `/runs/${open}/seal`, { expected: q.entries.slice(1) })).body.error, 'expected_list_mismatch');
  const closed = await su(g, 'POST', `/runs/${open}/reconcile`, { action: 'close' });
  assert.equal(closed.body.run.status, 'failed');
  assert.deepEqual(audits(g).map((r) => r.action), [AUDIT_ACTIONS.opened, AUDIT_ACTIONS.sealed, AUDIT_ACTIONS.reconciled]);
  assert.equal((await openRun(g, q)).status, 201, 'a reconciled run no longer blocks');
});

test('8. a chunk of unknown outcome keeps the run uncertain until it is sent again', async () => {
  const f = fixture();
  const p = await pkg();
  const uid = (await openRun(f, p)).body.run.uid;
  const parts = chunks(p.records, 21);
  await su(f, 'POST', `/runs/${uid}/chunks`, { chunk_index: 0, records: parts[0] });
  f.faults.batch = 1;
  assert.equal((await su(f, 'POST', `/runs/${uid}/chunks`, { chunk_index: 1, records: parts[1] })).body.status, 'uncertain');
  await su(f, 'POST', `/runs/${uid}/chunks`, { chunk_index: 2, records: parts[2] });
  const unsure = (await su(f, 'POST', `/runs/${uid}/seal`, { expected: p.entries })).body;
  assert.deepEqual([unsure.status, unsure.uncertain_chunks], ['uncertain', [1]]);
  assert.equal((await su(f, 'POST', `/runs/${uid}/reconcile`, { action: 'resume' })).body.error, 'resend_uncertain_chunks');
  assert.equal((await su(f, 'POST', `/runs/${uid}/chunks`, { chunk_index: 1, records: parts[1] })).body.status, 'written');
  assert.equal((await su(f, 'POST', `/runs/${uid}/seal`, { expected: p.entries })).body.status, 'complete');
});

/* ----------------------------------------------------------- 9. replay and removals */

test('9. a replay reports every record unchanged and creates none', async () => {
  const f = fixture();
  const p = await pkg();
  await apply(f, p);
  const records = count(f, 'research_source_records');
  const preview = await su(f, 'POST', '/preview', { manifest: p.manifest, pages: chunks(p.entries, 25) });
  assert.deepEqual(preview.body.sources.map((s: any) => [s.unchanged, s.new, s.changed]), [[12, 0, 0], [30, 0, 0]]);
  const { sealed } = await apply(f, p);
  assert.equal(sealed.status, 'complete');
  assert.equal(count(f, 'research_source_records'), records);
  const runs = (await su(f, 'GET', '/runs')).body.runs;
  assert.equal(runs.length, 2);
  assert.deepEqual(runs[0].counts.outcomes, { unchanged: 42 });
});

test('10. each removal leaves one audit row in its batch; preview then reports it removed and a replay restores nothing', async () => {
  // Mutation checked: the removal's audit statement dropped → the removal batch carries no audit insert.
  const f = fixture();
  const p = await pkg();
  await apply(f, p);
  const rec = p.records[0];
  const blocked = fixture();
  await openRun(blocked, p);
  assert.equal((await su(blocked, 'POST', '/removals', { scope: 'source', source_key: 'invented_funds' })).body.error, 'run_open');

  for (const [scope, body] of [
    ['private_fields', { scope: 'private_fields', source_key: rec.source_key, provider_record_id: rec.provider_record_id }],
    ['record', { scope: 'record', source_key: rec.source_key, provider_record_id: rec.provider_record_id }],
    ['source', { scope: 'source', source_key: 'invented_rounds' }],
  ] as const) {
    const removed = await su(f, 'POST', '/removals', body);
    assert.equal(removed.status, 201, JSON.stringify(removed.body));
    const batch = f.batches.at(-1)!;
    assert.match(batch.at(-1)!, /INSERT INTO admin_audit_log/, `${scope}: the audit row is in the removal batch`);
    assert.match(batch.at(-2)!, /INSERT INTO research_source_removals/);
    const preview = (await su(f, 'POST', '/preview', { manifest: p.manifest, pages: chunks(p.entries, 25) })).body.sources;
    if (scope === 'private_fields') assert.equal(preview[0].private_fields_removed, 1);
    if (scope === 'record') assert.equal(preview[0].removed, 1);
    if (scope === 'source') assert.equal(preview[1].removed, 30);
  }
  assert.deepEqual(audits(f).filter((r) => r.action === AUDIT_ACTIONS.removal).length, 3);
  // A replay of the funds restores nothing; the rounds source refuses a run outright.
  const funds = { ...p, records: p.records.filter((r) => r.source_key === 'invented_funds'),
    entries: p.entries.filter((e) => e[0] === 'invented_funds'), manifest: { sources: [p.manifest.sources[0]] },
    column_classes: { invented_funds: p.column_classes.invented_funds } };
  const { sealed } = await apply(f, funds);
  assert.equal(sealed.status, 'partial');
  assert.deepEqual(sealed.named.refused, [{ source_key: 'invented_funds', provider_record_id: rec.provider_record_id, code: 'record_removed' }]);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM research_source_records WHERE provider_record_id = ?').get(rec.provider_record_id)!.n, 0);
  await su(f, 'POST', `/runs/${(await su(f, 'GET', '/runs')).body.runs[0].uid}/reconcile`, { action: 'close' });
  assert.equal((await openRun(f, p)).body.error, 'source_removed');
  assert.equal(count(f, 'research_source_records'), 11, 'eleven funds; no round came back');
});

/* ----------------------------------------------------------- 11. privacy */

test('11. the planted marker appears in no response, console line, audit row or activity row; no refusal carries upstream', async () => {
  const logs: string[] = [];
  const orig = { log: console.log, error: console.error, warn: console.warn, info: console.info };
  for (const k of ['log', 'error', 'warn', 'info'] as const) console[k] = (...a: unknown[]) => { logs.push(a.map(String).join(' ')); };
  const f = fixture();
  try {
    const p = await pkg();
    await su(f, 'POST', '/preview', { manifest: p.manifest, pages: [p.entries] });
    const { uid } = await apply(f, p, { skip: 2 });
    await su(f, 'GET', `/runs/${uid}`);
    await su(f, 'GET', '/runs');
    const withEmail = { ...p.records[0], cells: [...p.records[0].cells, ['email', `x-${MARK}@synthetic.invalid`]] };
    await su(f, 'POST', `/runs/${uid}/reconcile`, { action: 'resume' });
    await su(f, 'POST', `/runs/${uid}/chunks`, { chunk_index: 9, records: [withEmail] });
    await su(f, 'POST', `/runs/${uid}/chunks`, { chunk_index: 9, records: [{ ...p.records[1], cells: [['name', MARK]] }] });
    await su(f, 'POST', `/runs/${uid}/chunks`, { chunk_index: 9, records: [{ ...p.records[1], cells: [['not_a_column', MARK]], body_sha256: await sha256Hex(bodyJson([['not_a_column', MARK]])) }] });
    f.faults.batch = 1;
    await su(f, 'POST', `/runs/${uid}/chunks`, { chunk_index: 2, records: chunks(p.records, 12)[2] });
    await su(f, 'POST', `/runs/${uid}/chunks`, undefined, { raw: `{"records": [${MARK}` });
    await su(f, 'POST', '/removals', { scope: 'record', source_key: 'invented_funds', provider_record_id: p.records[4].provider_record_id });
  } finally { Object.assign(console, orig); }
  for (const text of f.responses) {
    assert.ok(!text.includes(MARK), `a response carries a value: ${text.slice(0, 200)}`);
    assert.ok(!/"upstream"/.test(text), 'no refusal carries upstream');
  }
  for (const line of logs) assert.ok(!line.includes(MARK), `a console line carries a value: ${line.slice(0, 200)}`);
  assert.ok(!JSON.stringify(audits(f)).includes(MARK), 'no audit row carries a value');
  let activity: unknown[] = [];
  try { activity = f.db.prepare('SELECT * FROM activity_logs').all(); } catch { /* no table, no rows */ }
  assert.ok(!JSON.stringify(activity).includes(MARK), 'no activity row carries a value');
  assert.ok(f.responses.length > 10);
});

test('12. every refusal code the router sends has its sentence, and none is built with raw or audience', async () => {
  const { readFileSync } = await import('node:fs');
  const route = readFileSync(new URL('../src/routes/research_source_imports.ts', import.meta.url), 'utf8');
  const service = readFileSync(new URL('../src/services/researchSourceImports.ts', import.meta.url), 'utf8');
  assert.ok(!/\braw\s*:/.test(route) && !/\baudience\s*:/.test(route), 'no raw, no audience');
  const codes = [...service.matchAll(/new ImportRefusal\(\d+, '([a-z_]+)'/g)].map((m) => m[1]);
  assert.ok(codes.length > 20);
  for (const code of codes) assert.ok(REFUSAL_SENTENCES[code], `${code} has no sentence`);
});
