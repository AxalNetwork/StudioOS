/**
 * #8260 (D8260, Build v2 BD25) — Company creation's hand-offs, through `routes/company_creation_handoffs.ts`
 * mounted ahead of `cycle_build.ts`, over the real migrated schema: the filings and proofs as CSV, and
 * the company's stored papers preselected for and copied into the venture's data room. Company members
 * only. Every person, company, key and date is invented.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/company_filings_export_8260.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import handoffs, { EXPORT_COLUMNS, proofLink } from '../src/routes/company_creation_handoffs.ts';
import build from '../src/routes/cycle_build.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema, SCHEMA_OPTIONS } from './_schema_once.mjs';

const JWT_SECRET = 'invented-8260-test-secret-not-a-real-key'.repeat(2);
const PROJECT = 101;
const ORIGIN = 'https://app.example.test';

/** An in-memory FILES bucket with R2's write-once precondition. */
function memR2() {
  const store = new Map<string, { bytes: Uint8Array; type?: string }>();
  return {
    store,
    async put(key: string, body: Uint8Array | ArrayBuffer, opts: any = {}) {
      if (opts?.onlyIf && store.has(key)) return null;
      const bytes = body instanceof Uint8Array ? body : new Uint8Array(body as ArrayBuffer);
      store.set(key, { bytes, type: opts?.httpMetadata?.contentType });
      return { key, size: bytes.byteLength } as any;
    },
    async get(key: string) {
      const o = store.get(key);
      return o ? { body: o.bytes, arrayBuffer: async () => o.bytes.buffer.slice(o.bytes.byteOffset, o.bytes.byteOffset + o.bytes.byteLength) } : null;
    },
    async delete(key: string) { store.delete(key); },
    async head(key: string) { return store.has(key) ? { key } : null; },
  };
}

async function harness() {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db);
  db.exec(`INSERT INTO users(id, role, founder_id, name, email, is_active) VALUES
      (1, 'founder', 11, 'Invented founder', 'founder@example.invalid', 1),
      (2, 'founder', 22, 'Invented outsider', 'outsider@example.invalid', 1),
      (3, 'founder', 33, 'Invented co-founder', 'cofounder@example.invalid', 1),
      (4, 'admin', NULL, 'Invented admin', 'admin@example.invalid', 1);
    INSERT INTO entities(id, name, entity_type, jurisdiction) VALUES (501, 'Invented Inc', 'project', 'DE');
    INSERT INTO company_profiles(id, uid, company_name) VALUES (10, 'co-invented', 'Invented Co');
    INSERT INTO projects(id, uid, name, founder_id, company_id, entity_id) VALUES (${PROJECT}, 'venture-invented', 'Invented venture', 11, 10, 501);
    INSERT INTO user_company_links(uid, company_id, user_id) VALUES ('link-1', 10, 1);
    INSERT INTO formation_steps(id, project_id, title, state, due_date, proof_file_key, kind, jurisdiction, sort_order, created_by) VALUES
      (41, ${PROJECT}, 'Invented 83(b) election', 'done', '2026-10-20', 'build-proof/${PROJECT}/aaaa.pdf', '83b', 'US', 1, 1),
      (42, ${PROJECT}, '=HYPERLINK("https://evil.example")', 'todo', '2026-12-01', NULL, 'other', 'DE', 2, 1);
    INSERT INTO entity_obligations(id, uid, entity_id, kind, title, cadence, due_date, status, proof_file_key) VALUES
      (7, 'ob-7', 501, 'annual_report', 'Invented annual report', 'annual', '2027-03-01', 'open', NULL);`);
  const files = memR2();
  files.store.set('company/10/bylaws.pdf', { bytes: new TextEncoder().encode('%PDF-1.4 invented bylaws'), type: 'application/pdf' });
  db.exec(`INSERT INTO documents(company_id, uid, title, doc_type, status, content, created_at) VALUES
      (10, 'doc-bylaws', 'Bylaws', 'bylaws', 'draft', '{"r2_key":"company/10/bylaws.pdf","content_type":"application/pdf"}', '2026-10-12 09:00:00'),
      (10, 'doc-cert', 'Certificate', 'certificate_of_incorporation', 'draft', NULL, '2026-10-11 09:00:00');`);
  const env: any = { DB: d1Over(db), FILES: files, JWT_SECRET, ENVIRONMENT: 'development', APP_URL: `${ORIGIN}/` };
  const app = new Hono<any>().route('/api/cycles/build', handoffs).route('/api/cycles/build', build);
  app.onError((e, c) => c.json({ error: e.message }, 500));
  async function call(method: string, path: string, user = 1, body?: unknown) {
    const quiet = [console.log, console.warn, console.error];
    console.log = console.warn = console.error = () => {};
    try {
      const auth = await new SignJWT({ user_id: user, role: user === 4 ? 'admin' : 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
      const res = await app.request(path, { method, headers: { Authorization: `Bearer ${auth}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, env);
      const text = await res.text();
      let json: any = null; try { json = JSON.parse(text); } catch { /* CSV */ }
      return { status: res.status, text, json, headers: res.headers };
    } finally { [console.log, console.warn, console.error] = quiet; }
  }
  return { db, files, call };
}

/** A CSV line split on commas outside quotes. */
const cells = (line: string) => line.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.slice(0, -1).map((c) => c.replace(/,$/, ''));

test('the export: the page\'s five columns then the proof link, one line per filing, for a company member', async () => {
  const h = await harness();
  const r = await h.call('GET', `/api/cycles/build/company-creation/filings/export?project=${PROJECT}`);
  assert.equal(r.status, 200);
  assert.match(String(r.headers.get('content-type')), /text\/csv/);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const lines = r.text.split('\r\n');
  assert.equal(lines[0], EXPORT_COLUMNS.map(([, l]) => l).join(','));
  assert.equal(lines[0], 'Filing,Jurisdiction,Due,State,Proof,Proof link');
  assert.equal(lines.length, 4, 'three filings: two Build steps and one obligation');
  assert.equal(r.headers.get('x-export-rows'), '3');
  const stored = cells(lines.find((l) => l.startsWith('Invented 83(b) election'))!);
  assert.equal(stored[4], 'Stored');
  assert.equal(stored[5], `${ORIGIN}/build/company-creation/step-41?project_id=${PROJECT}`, 'a stored proof links to its filing in the app');
});

test('a missing proof: the link column reads Not recorded, and no key or token is ever written', async () => {
  const h = await harness();
  const r = await h.call('GET', `/api/cycles/build/company-creation/filings/export?project=${PROJECT}`);
  const ob = cells(r.text.split('\r\n').find((l) => l.startsWith('Invented annual report'))!);
  assert.equal(ob[5], 'Not recorded');
  assert.notEqual(ob[4], 'Stored');
  assert.ok(!r.text.includes('build-proof/'), 'the stored proof\'s key is not in the file');
  assert.ok(!/\/api\/files\/dl\//.test(r.text), 'no download token is in the file');
});

test('a value that starts like a formula is written as text', async () => {
  const h = await harness();
  const r = await h.call('GET', `/api/cycles/build/company-creation/filings/export?project=${PROJECT}`);
  const line = r.text.split('\r\n').find((l) => l.includes('HYPERLINK'))!;
  assert.ok(line.startsWith('"\'=HYPERLINK'), `escaped: ${line}`);
});

test('permissions: a non-member who can read the board is refused, and a venture with no company is refused apart', async () => {
  const h = await harness();
  // The venture's owner reads its board; with their company link gone they are not a member of its company.
  h.db.exec(`DELETE FROM user_company_links`);
  for (const path of ['filings/export', 'data-room']) {
    const r = await h.call('GET', `/api/cycles/build/company-creation/${path}?project=${PROJECT}`, 1);
    assert.equal(r.status, 403, path);
    assert.equal(r.json.error, 'company_members_only');
    assert.ok(!r.text.includes('Bylaws') && !r.text.includes('Invented 83(b)'), 'nothing about the company leaks');
  }
  const post = await h.call('POST', `/api/cycles/build/company-creation/data-room?project=${PROJECT}`, 1, { kinds: ['bylaws'] });
  assert.equal(post.status, 403);
  assert.equal((h.db.prepare('SELECT COUNT(*) AS n FROM data_room_files').get() as any).n, 0, 'nothing is copied');
  h.db.exec(`INSERT INTO user_company_links(uid, company_id, user_id) VALUES ('link-1', 10, 1)`);
  // Someone with no board access gets the board gate's own refusal before membership is asked.
  const outsider = await h.call('GET', `/api/cycles/build/company-creation/filings/export?project=${PROJECT}`, 2);
  assert.equal(outsider.status, 403);
  h.db.exec(`UPDATE projects SET company_id = NULL WHERE id = ${PROJECT}`);
  const unlinked = await h.call('GET', `/api/cycles/build/company-creation/filings/export?project=${PROJECT}`);
  assert.equal(unlinked.status, 409);
  assert.equal(unlinked.json.error, 'company_not_linked');
});

test('the data room read: stored papers not yet in the room are preselected; missing and unreadable are not', async () => {
  const h = await harness();
  const r = await h.call('GET', `/api/cycles/build/company-creation/data-room?project=${PROJECT}`);
  assert.equal(r.status, 200);
  assert.equal(r.json.can_add, true);
  assert.deepEqual(r.json.papers.map((p: any) => [p.kind, p.state, p.preselected]), [
    ['certificate_of_incorporation', 'Unreadable', false], ['bylaws', 'Stored', true],
    ['tax_id_letter', 'Missing', false], ['registered_agent_agreement', 'Missing', false]]);
  assert.ok(!r.text.includes('company/10/'), 'the R2 key is never returned');
});

test('adding copies the bytes under the room\'s own key, under NDA and shared with nobody, once', async () => {
  const h = await harness();
  const r = await h.call('POST', `/api/cycles/build/company-creation/data-room?project=${PROJECT}`, 1, { kinds: ['bylaws', 'tax_id_letter'] });
  assert.equal(r.status, 201);
  assert.equal(r.json.added.length, 1);
  assert.deepEqual(r.json.skipped, [{ kind: 'tax_id_letter', reason: 'Not stored yet.' }]);
  const row = h.db.prepare(`SELECT name, r2_key, visibility, access_tier, source_kind, source_ref, project_id FROM data_room_files`).get() as any;
  assert.equal(row.visibility, 'nda');
  assert.equal(row.access_tier, 'nobody');
  assert.equal(row.source_kind, 'document');
  assert.equal(row.source_ref, 'company_document:doc-bylaws');
  assert.equal(row.project_id, PROJECT);
  assert.ok(row.r2_key.startsWith('data-room/venture-invented/') && row.r2_key !== 'company/10/bylaws.pdf', 'its own object, not the company\'s');
  assert.deepEqual(h.files.store.get(row.r2_key)!.bytes, h.files.store.get('company/10/bylaws.pdf')!.bytes);
  const log = h.db.prepare(`SELECT action FROM activity_logs WHERE project_id = ?`).all(PROJECT) as any[];
  assert.ok(log.some((l) => l.action === 'build_paper_to_data_room'));
  // A second add finds it in the room and copies nothing.
  const again = await h.call('POST', `/api/cycles/build/company-creation/data-room?project=${PROJECT}`, 1, { kinds: ['bylaws'] });
  assert.equal(again.status, 200);
  assert.deepEqual(again.json.added, []);
  assert.equal((h.db.prepare('SELECT COUNT(*) AS n FROM data_room_files').get() as any).n, 1);
  const read = await h.call('GET', `/api/cycles/build/company-creation/data-room?project=${PROJECT}`);
  assert.deepEqual(read.json.papers.find((p: any) => p.kind === 'bylaws'), { kind: 'bylaws', label: 'Bylaws', state: 'Stored', document_uid: 'doc-bylaws', in_room: true, preselected: false });
});

test('a member without the room\'s upload right reads the papers but cannot add them', async () => {
  const h = await harness();
  const read = await h.call('GET', `/api/cycles/build/company-creation/data-room?project=${PROJECT}`, 4);
  assert.equal(read.status, 200);
  assert.equal(read.json.can_add, false);
  assert.match(read.json.reason, /owner or a co-founder/);
  const post = await h.call('POST', `/api/cycles/build/company-creation/data-room?project=${PROJECT}`, 4, { kinds: ['bylaws'] });
  assert.equal(post.status, 403);
  assert.equal(post.json.error, 'room_upload_denied');
  assert.equal((h.db.prepare('SELECT COUNT(*) AS n FROM data_room_files').get() as any).n, 0);
});

test('a bad selection is refused before anything is read or written', async () => {
  const h = await harness();
  for (const body of [{}, { kinds: [] }, { kinds: ['other'] }, { kinds: 'bylaws' }]) {
    const r = await h.call('POST', `/api/cycles/build/company-creation/data-room?project=${PROJECT}`, 1, body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.json.error, 'invalid_papers');
  }
  assert.equal((h.db.prepare('SELECT COUNT(*) AS n FROM data_room_files').get() as any).n, 0);
});

test('proofLink: only a stored proof on a Build step or an obligation gets a link', () => {
  assert.equal(proofLink(ORIGIN, 1, 'step-3', 'Stored'), `${ORIGIN}/build/company-creation/step-3?project_id=1`);
  assert.equal(proofLink(ORIGIN, 1, 'obligation-3', 'Stored'), `${ORIGIN}/build/company-creation/obligation-3?project_id=1`);
  assert.equal(proofLink(ORIGIN, 1, 'step-3', 'Missing'), null);
  assert.equal(proofLink(ORIGIN, 1, 'lab-9-0', 'Stored'), null);
  assert.equal(proofLink(ORIGIN, 1, 'step-3/../x', 'Stored'), null);
});
