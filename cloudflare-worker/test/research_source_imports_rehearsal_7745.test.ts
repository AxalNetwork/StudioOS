/**
 * D7745 (#7745) — the rehearsal: an invented package of the audited shape, applied through the mounted router over
 * the migrated schema, with a metering D1 binding. Local only; nothing is dispatched on Actions, and the wall time it
 * prints is this machine's SQLite, not a D1 timing (#7760's production preview is the first D1 contact).
 *
 * Shape (from the 2026-11-19 audit): four sources of 120, 134, 84 and 1,853 records with 5, 12, 11 and 12 fields;
 * the largest record about 9 KB; people only at synthetic.invalid; contact columns left out before upload (Q3 B).
 * No data file is committed: the package is generated here.
 *
 * The meter counts requests and statements and fails on a statement over 100 KB of text, over 100 bound parameters,
 * or a bound value over D1's 2 MB.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/research_source_imports_rehearsal_7745.test.ts
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import router, { mount } from '../src/routes/research_source_imports.ts';
import { IMPORT_LIMITS } from '../src/services/researchSourceImports.ts';
import { bodyJson, membershipDigest, sha256Hex, type CellValue } from '../src/services/researchSourceRecords.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { grantWriteBar } from './_write_bar_session.mjs';
import { loadSchema, SCHEMA_OPTIONS } from './_schema_once.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'research-source-rehearsal-7745-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

const JWT_SECRET = 'synthetic-7745-rehearsal-not-a-real-credential'.repeat(2);
const SUPER = 1;
const MARK = 'QXMARK7745R';
const D1 = { STATEMENT_BYTES: 100_000, BOUND_PARAMS: 100, VALUE_BYTES: 2_000_000 };
const bytes = (s: string) => new TextEncoder().encode(s).byteLength;

/** The audited shape. `contact` columns exist in the source and are left out by the client before upload. */
const SHAPE = [
  { key: 'invented_funds', n: 120, fields: 5, contact: 0 },
  { key: 'invented_investors', n: 134, fields: 12, contact: 1 },
  { key: 'invented_vehicles', n: 84, fields: 11, contact: 1 },
  { key: 'invented_rounds', n: 1853, fields: 12, contact: 0 },
];

type Rec = { source_key: string; provider_record_id: string; stated_row_hash: string; body_sha256: string; cells: Array<[string, CellValue]> };

async function inventedPackage() {
  const records: Rec[] = [];
  const sources = SHAPE.map((s) => ({ ...s, columns: Array.from({ length: s.fields }, (_, i) => (i < s.contact ? `contact_${i}` : `field_${i}`)) }));
  for (const s of sources) {
    for (let i = 0; i < s.n; i++) {
      const id = `${s.key.slice(9, 12)}-${String(i).padStart(5, '0')}`;
      const cells = s.columns.filter((c) => !c.startsWith('contact_')).map((c, j) => {
        // One record per source carries ~9 KB of prose; the rest are of ordinary size.
        const prose = i === 0 && j === 1 ? ` ${'Invented narrative text. '.repeat(320)}` : '';
        const value: CellValue = j === 2 ? [`Seed ${MARK}`, `Series A ${MARK}`] : j === 3 && i % 7 === 0 ? '' : `${c} ${i} ${MARK} https://${id}.synthetic.invalid/${prose}`;
        return [c, value] as [string, CellValue];
      });
      records.push({ source_key: s.key, provider_record_id: id, stated_row_hash: (await sha256Hex(`${id}|${MARK}`)), body_sha256: await sha256Hex(bodyJson(cells)), cells });
    }
  }
  const manifest = { sources: await Promise.all(sources.map(async (s) => {
    const mine = records.filter((r) => r.source_key === s.key);
    return { source_key: s.key, columns: s.columns, expected_records: s.n, expected_cells: s.n * s.fields, digest: await membershipDigest(mine), excluded_person_records: 0 };
  })) };
  const column_classes = Object.fromEntries(sources.map((s) => [s.key, Object.fromEntries(s.columns.map((c, j) => [c,
    c.startsWith('contact_') ? { class: 'contact', contact: 'withheld' } : { class: j === s.contact + 1 ? 'prose' : 'fact' }]))]));
  return { records, manifest, column_classes, entries: records.map((r) => [r.source_key, r.provider_record_id, r.stated_row_hash]) };
}

function meteredWorld() {
  const db = new DatabaseSync(join(scratch, 'rehearsal.sqlite'), SCHEMA_OPTIONS);
  loadSchema(db);
  db.exec('PRAGMA foreign_keys = ON');
  db.prepare('INSERT INTO users(id, email, name, role) VALUES (?, ?, ?, ?)').run(SUPER, 'operator@synthetic.invalid', 'Invented Operator', 'admin');
  db.prepare('DELETE FROM super_admins').run();
  db.prepare('INSERT INTO super_admins(user_id) VALUES (?)').run(SUPER);
  const jti = grantWriteBar(db, SUPER);
  const DB = d1Over(db) as any;
  const meter = { requests: 0, statements: 0, perRequest: [] as number[], maxStatementBytes: 0, maxParams: 0, maxValueBytes: 0, violations: [] as string[] };
  const prepare = DB.prepare.bind(DB);
  DB.prepare = (sql: string) => {
    const st = prepare(sql);
    const textBytes = bytes(sql);
    meter.maxStatementBytes = Math.max(meter.maxStatementBytes, textBytes);
    if (textBytes > D1.STATEMENT_BYTES) meter.violations.push(`statement text ${textBytes} bytes`);
    const bind = st.bind.bind(st);
    st.bind = (...args: unknown[]) => {
      meter.maxParams = Math.max(meter.maxParams, args.length);
      if (args.length > D1.BOUND_PARAMS) meter.violations.push(`${args.length} bound parameters`);
      for (const a of args) if (typeof a === 'string') {
        meter.maxValueBytes = Math.max(meter.maxValueBytes, bytes(a));
        if (bytes(a) > D1.VALUE_BYTES) meter.violations.push(`bound value ${bytes(a)} bytes`);
      }
      return bind(...args);
    };
    for (const m of ['all', 'first', 'run'] as const) {
      const f = st[m].bind(st);
      st[m] = (...a: unknown[]) => { meter.statements++; meter.perRequest[meter.perRequest.length - 1]++; return f(...a); };
    }
    return st;
  };
  const batch = DB.batch.bind(DB);
  DB.batch = (stmts: unknown[]) => { meter.statements += stmts.length; meter.perRequest[meter.perRequest.length - 1] += stmts.length; return batch(stmts); };
  const app = new Hono<any>().route(mount.path, router);
  const env = { DB, JWT_SECRET, ENVIRONMENT: 'development', WORKER_DEPLOY_VERSION: 'synthetic-version' } as any;
  const responses: string[] = [];
  async function call(method: string, path: string, body?: unknown) {
    meter.requests++;
    meter.perRequest.push(0);
    const t = await new SignJWT({ user_id: SUPER, jti }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
    const res = await app.request(`${mount.path}${path}`, { method, headers: { 'content-type': 'application/json', Authorization: `Bearer ${t}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
    const text = await res.text();
    responses.push(text);
    return { status: res.status, body: JSON.parse(text) };
  }
  return { db, meter, call, responses };
}

const pages = <T>(list: T[], size: number) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

test('rehearsal: preview, apply in 44 chunks, read back and replay the audited shape inside D1\'s limits and under 100 requests', async () => {
  const p = await inventedPackage();
  assert.equal(p.records.length, 2191);
  const largest = Math.max(...p.records.map((r) => bytes(JSON.stringify(r))));
  assert.ok(largest > 8_500 && largest < 10_000, `largest record ${largest} bytes`);
  const manifestBytes = bytes(JSON.stringify(p.manifest));
  const w = meteredWorld();
  const started = performance.now();

  // Preview: one request, pages of 500.
  const preview = await w.call('POST', '/preview', { manifest: p.manifest, pages: pages(p.entries, IMPORT_LIMITS.PREVIEW_PAGE) });
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  assert.deepEqual(preview.body.sources.map((s: any) => [s.new, s.list_digest_matches]), [[120, true], [134, true], [84, true], [1853, true]]);
  // Apply: open, 44 chunks that may mix sources, seal against the expected list.
  const opened = await w.call('POST', '/runs', { idempotency_key: 'synthetic-rehearsal-0001', manifest: p.manifest, column_classes: p.column_classes, file_sha256: 'c'.repeat(64) });
  assert.equal(opened.status, 201, JSON.stringify(opened.body));
  const uid = opened.body.run.uid;
  const chunks = pages(p.records, IMPORT_LIMITS.MAX_CHUNK_RECORDS);
  assert.equal(chunks.length, 44);
  const largestChunk = Math.max(...chunks.map((c, i) => bytes(JSON.stringify({ chunk_index: i, records: c }))));
  for (const [i, records] of chunks.entries()) {
    const sent = await w.call('POST', `/runs/${uid}/chunks`, { chunk_index: i, records });
    assert.equal(sent.body.status, 'written', JSON.stringify(sent.body));
  }
  const sealed = await w.call('POST', `/runs/${uid}/seal`, { expected: p.entries });
  assert.equal(sealed.body.status, 'complete', JSON.stringify(sealed.body).slice(0, 2000));
  // Read back: the run, its members in pages.
  let offset: number | null = 0;
  while (offset !== null) {
    const read = await w.call('GET', `/runs/${uid}?offset=${offset}`);
    assert.equal(read.status, 200);
    offset = read.body.next_offset;
  }
  const importRequests = w.meter.requests;
  const importStatements = w.meter.statements;
  const largestRequest = Math.max(...w.meter.perRequest);

  // Replay: every record unchanged, none created.
  const records = Number((w.db.prepare('SELECT COUNT(*) AS n FROM research_source_records').get() as any).n);
  const replay = await w.call('POST', '/runs', { idempotency_key: 'synthetic-rehearsal-0002', manifest: p.manifest, column_classes: p.column_classes, file_sha256: 'c'.repeat(64) });
  for (const [i, chunk] of chunks.entries()) {
    const sent = await w.call('POST', `/runs/${replay.body.run.uid}/chunks`, { chunk_index: i, records: chunk });
    assert.equal(sent.body.counts.unchanged, chunk.length);
  }
  assert.equal((await w.call('POST', `/runs/${replay.body.run.uid}/seal`, { expected: p.entries })).body.status, 'complete');
  assert.equal(Number((w.db.prepare('SELECT COUNT(*) AS n FROM research_source_records').get() as any).n), records);
  const wallMs = Math.round(performance.now() - started);

  assert.deepEqual(w.meter.violations, [], 'no statement over 100 KB, 100 bound parameters or a 2 MB value');
  assert.ok(importRequests < 100, `preview, apply and read-back took ${importRequests} requests`);
  for (const text of w.responses) assert.ok(!text.includes(MARK), 'no response carries a value');
  // The figures D7745.md records.
  console.log(JSON.stringify({
    records: p.records.length, largest_record_bytes: largest, manifest_bytes: manifestBytes, largest_chunk_bytes: largestChunk,
    chunks: chunks.length, requests_preview_apply_readback: importRequests, statements_preview_apply_readback: importStatements,
    statements_in_largest_request: largestRequest, max_statement_text_bytes: w.meter.maxStatementBytes, max_bound_params: w.meter.maxParams,
    max_bound_value_bytes: w.meter.maxValueBytes, requests_with_replay: w.meter.requests, wall_ms_local_sqlite_not_d1: wallMs,
  }));
  w.db.close();
});
