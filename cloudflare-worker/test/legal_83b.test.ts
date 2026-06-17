/**
 * Section 83(b) tracker API (Task #13) — worker route contract + scoping.
 *
 * The production Worker previously had NO handler for /api/legal/83b/trackers*,
 * so the /incorporate/83b page 404'd in prod. These route-level tests lock in
 * the worker parity with the FastAPI contract:
 *
 *   - create returns { ok, reused, tracker } with the computed DTO (30-day
 *     deadline, days_left, 6-item checklist, 6-step IRS mailing guide);
 *   - create is idempotent on (project_id, user_id, grant_date);
 *   - a founder only sees their OWN trackers; another founder sees none of
 *     them; an admin sees all (no cross-user leakage);
 *   - only the owner (or admin/partner) can PATCH a tracker; status is
 *     validated; create is blocked for a founder who doesn't own the project;
 *   - receipt upload sniffs magic bytes (PDF/JPEG/PNG), stores to R2, links
 *     receipt_doc_id, and flips pending -> mailed; missing R2 fails loudly.
 *
 * Run with the strip-types loader (see package.json test:drift):
 *   node --experimental-strip-types --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/legal_83b.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
// Import the standalone 83(b) sub-app (mounted into legal.ts at '/'). Testing
// it directly keeps legal.ts's heavy import graph (billing → payments → queue)
// out of the strip-only loader.
import legal from '../src/routes/legal_83b.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef'; // >= 32 bytes

const ADMIN = { id: 1, role: 'admin', is_active: 1, founder_id: null };
const FOUNDER_A = { id: 10, role: 'founder', is_active: 1, founder_id: 1001 };
const FOUNDER_B = { id: 20, role: 'founder', is_active: 1, founder_id: 1002 };
const USERS_BY_ID: Record<number, any> = { 1: ADMIN, 10: FOUNDER_A, 20: FOUNDER_B };

// FOUNDER_A owns project 1; FOUNDER_B owns project 2.
const PROJECTS = [
  { id: 1, name: 'Acme', founder_id: 1001, entity_id: null },
  { id: 2, name: 'Beta', founder_id: 1002, entity_id: null },
];

async function mintToken(userId: number, role: string): Promise<string> {
  // No `jti` so getCurrentUser skips the user_sessions revocation lookup.
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

/**
 * Stateful in-memory D1 stub. getSQL() runs every statement through
 * prepare().bind().all(), so SELECT/INSERT/UPDATE routing all lives in all().
 * Users are resolved by the JWT's user_id (bound[0]) so a single env can serve
 * admin + multiple founders within one test while persisting tracker state.
 */
function makeEnv({ withFiles = true }: { withFiles?: boolean } = {}) {
  const projects = PROJECTS.map((p) => ({ ...p }));
  const documents: any[] = [];
  const trackers: any[] = [];
  const filesPut: any[] = [];
  let docSeq = 100;
  let trackerSeq = 0;

  const handle = (rawSql: string) => {
    const s = rawSql.toLowerCase();
    let bound: any[] = [];
    const api: any = {
      bind: (...a: any[]) => { bound = a; return api; },
      async first() {
        if (s.includes('from users where id')) return USERS_BY_ID[bound[0]] ?? null;
        return null;
      },
      async run() { return { meta: { changes: 1 } }; },
      async all() {
        // Auth: resolve JWT user_id -> users row.
        if (s.includes('from users where id')) {
          const u = USERS_BY_ID[bound[0]];
          return { results: u ? [u] : [] };
        }
        // Template store lookup -> no canonical body (fallback content path).
        if (s.includes('from legal_templates')) return { results: [] };
        // Project fetch in create.
        if (s.includes('from projects where id')) {
          const p = projects.find((x) => x.id === bound[0]);
          return { results: p ? [{ ...p }] : [] };
        }
        if (s.includes('from entities where id')) return { results: [] };
        // Document insert (election doc + receipt doc).
        if (s.includes('insert into documents')) {
          const id = ++docSeq;
          documents.push({ id, project_id: bound[0] });
          return { results: [{ id }] };
        }
        if (s.includes('from documents where id')) {
          const d = documents.find((x) => x.id === bound[0]);
          return { results: d ? [{ ...d }] : [] };
        }
        // Tracker insert.
        if (s.includes('insert into section_83b_trackers')) {
          const [project_id, user_id, taxpayer_name, grant_date, deadline_date, election_doc_id] = bound;
          const row = {
            id: ++trackerSeq,
            uid: `uid-${trackerSeq}`,
            project_id, user_id, taxpayer_name, grant_date, deadline_date,
            mailed_at: null, receipt_doc_id: null, election_doc_id,
            status: 'pending', notes: null,
            created_at: '2026-01-01 00:00:00', updated_at: '2026-01-01 00:00:00',
          };
          trackers.push(row);
          return { results: [{ ...row }] };
        }
        // Tracker update (PATCH carries notes; receipt route does not).
        if (s.includes('update section_83b_trackers')) {
          const id = bound[bound.length - 1];
          const row = trackers.find((t) => t.id === id);
          if (!row) return { results: [] };
          if (s.includes('notes = ?')) {
            const [mailed_at, status, receipt_doc_id, notes] = bound;
            row.mailed_at = mailed_at; row.status = status;
            row.receipt_doc_id = receipt_doc_id; row.notes = notes;
          } else {
            const [receipt_doc_id, status, mailed_at] = bound;
            row.receipt_doc_id = receipt_doc_id; row.status = status; row.mailed_at = mailed_at;
          }
          row.updated_at = '2026-01-02 00:00:00';
          return { results: [{ ...row }] };
        }
        // Tracker select by id.
        if (s.includes('from section_83b_trackers where id')) {
          const row = trackers.find((t) => t.id === bound[0]);
          return { results: row ? [{ ...row }] : [] };
        }
        // Idempotency probe (project_id + user_id + grant_date).
        if (s.includes('from section_83b_trackers') && s.includes('grant_date = ?')) {
          const [pid, uid, grant] = bound;
          const row = trackers.find((t) => t.project_id === pid && t.user_id === uid && t.grant_date === grant);
          return { results: row ? [{ ...row }] : [] };
        }
        // Scoped / unscoped list.
        if (s.includes('from section_83b_trackers')) {
          const hasUser = s.includes('user_id = ?');
          const hasProject = s.includes('project_id = ?');
          let rows = [...trackers];
          if (hasUser && hasProject) rows = rows.filter((t) => t.user_id === bound[0] && t.project_id === bound[1]);
          else if (hasUser) rows = rows.filter((t) => t.user_id === bound[0]);
          else if (hasProject) rows = rows.filter((t) => t.project_id === bound[0]);
          rows.sort((a, b) => (a.deadline_date < b.deadline_date ? -1 : a.deadline_date > b.deadline_date ? 1 : 0));
          return { results: rows.map((r) => ({ ...r })) };
        }
        return { results: [] };
      },
    };
    return api;
  };

  const env: any = {
    JWT_SECRET,
    ENVIRONMENT: 'development',
    DB: {
      prepare: (sql: string) => handle(sql),
      async batch(stmts: any[]) { return (stmts || []).map(() => ({ results: [] })); },
    },
  };
  if (withFiles) {
    env.FILES = { async put(key: string, bytes: Uint8Array) { filesPut.push({ key, size: bytes.length }); } };
  }
  return { env, state: { trackers, documents, filesPut } };
}

function authJson(token: string, method: string, body?: any): RequestInit {
  const init: RequestInit = { method, headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' } };
  if (body !== undefined) init.body = JSON.stringify(body);
  return init;
}

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3]);

// --- create + DTO shape -----------------------------------------------------

test('create: founder creates a tracker with the computed DTO', async () => {
  const { env } = makeEnv();
  const token = await mintToken(FOUNDER_A.id, 'founder');
  const res = await legal.request('/83b/trackers', authJson(token, 'POST', {
    project_id: 1, taxpayer_name: 'Jane Q. Doe', grant_date: '2026-06-01',
  }), env);
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.equal(body.ok, true);
  assert.equal(body.reused, false);
  assert.ok(body.election_document_id);
  const t = body.tracker;
  assert.equal(t.status, 'pending');
  assert.equal(t.grant_date, '2026-06-01');
  assert.equal(t.deadline_date, '2026-07-01'); // grant + 30 calendar days
  assert.equal(typeof t.days_left, 'number');
  assert.equal(t.checklist.length, 6);
  assert.equal(t.irs_mailing_steps.length, 6);
  assert.ok(t.election_doc_id);
  assert.equal(t.receipt_doc_id, null);
});

test('create: invalid grant_date is rejected (400)', async () => {
  const { env } = makeEnv();
  const token = await mintToken(FOUNDER_A.id, 'founder');
  const res = await legal.request('/83b/trackers', authJson(token, 'POST', {
    project_id: 1, taxpayer_name: 'Jane', grant_date: 'not-a-date',
  }), env);
  assert.equal(res.status, 400);
});

test('create: an impossible calendar date is rejected (400), not normalized', async () => {
  // JS Date.parse would silently shift 2026-02-31 -> 2026-03-03; the route
  // must reject it to match FastAPI's date.fromisoformat behavior.
  const { env } = makeEnv();
  const token = await mintToken(FOUNDER_A.id, 'founder');
  const res = await legal.request('/83b/trackers', authJson(token, 'POST', {
    project_id: 1, taxpayer_name: 'Jane', grant_date: '2026-02-31',
  }), env);
  assert.equal(res.status, 400);
});

test('create: idempotent on (project, user, grant_date)', async () => {
  const { env } = makeEnv();
  const token = await mintToken(FOUNDER_A.id, 'founder');
  const payload = { project_id: 1, taxpayer_name: 'Jane Q. Doe', grant_date: '2026-06-01' };
  const first = (await (await legal.request('/83b/trackers', authJson(token, 'POST', payload), env)).json()) as any;
  const second = (await (await legal.request('/83b/trackers', authJson(token, 'POST', payload), env)).json()) as any;
  assert.equal(second.reused, true);
  assert.equal(second.tracker.id, first.tracker.id);
});

test('create: a founder cannot create on a project they do not own (403)', async () => {
  const { env } = makeEnv();
  const token = await mintToken(FOUNDER_B.id, 'founder'); // owns project 2, not 1
  const res = await legal.request('/83b/trackers', authJson(token, 'POST', {
    project_id: 1, taxpayer_name: 'Mallory', grant_date: '2026-06-01',
  }), env);
  assert.equal(res.status, 403);
});

// --- list scoping -----------------------------------------------------------

test('list: founders see only their own trackers; admin sees all', async () => {
  const { env } = makeEnv();
  const tokA = await mintToken(FOUNDER_A.id, 'founder');
  const tokB = await mintToken(FOUNDER_B.id, 'founder');
  const tokAdmin = await mintToken(ADMIN.id, 'admin');
  await legal.request('/83b/trackers', authJson(tokA, 'POST', { project_id: 1, taxpayer_name: 'Jane', grant_date: '2026-06-01' }), env);
  await legal.request('/83b/trackers', authJson(tokB, 'POST', { project_id: 2, taxpayer_name: 'Bob', grant_date: '2026-06-02' }), env);

  const listA = (await (await legal.request('/83b/trackers', { headers: { Authorization: `Bearer ${tokA}` } }, env)).json()) as any;
  assert.equal(listA.trackers.length, 1);
  assert.equal(listA.trackers[0].project_id, 1);
  assert.ok(!listA.trackers.some((t: any) => t.user_id === FOUNDER_B.id));

  const listB = (await (await legal.request('/83b/trackers', { headers: { Authorization: `Bearer ${tokB}` } }, env)).json()) as any;
  assert.equal(listB.trackers.length, 1);
  assert.equal(listB.trackers[0].project_id, 2);

  const listAdmin = (await (await legal.request('/83b/trackers', { headers: { Authorization: `Bearer ${tokAdmin}` } }, env)).json()) as any;
  assert.equal(listAdmin.trackers.length, 2);
});

// --- PATCH ownership + validation -------------------------------------------

test('patch: only the owner (or admin) can mutate; status is validated', async () => {
  const { env } = makeEnv();
  const tokA = await mintToken(FOUNDER_A.id, 'founder');
  const tokB = await mintToken(FOUNDER_B.id, 'founder');
  const tokAdmin = await mintToken(ADMIN.id, 'admin');
  const created = (await (await legal.request('/83b/trackers', authJson(tokA, 'POST', { project_id: 1, taxpayer_name: 'Jane', grant_date: '2026-06-01' }), env)).json()) as any;
  const id = created.tracker.id;

  const forbidden = await legal.request(`/83b/trackers/${id}`, authJson(tokB, 'PATCH', { status: 'confirmed' }), env);
  assert.equal(forbidden.status, 403);

  const bad = await legal.request(`/83b/trackers/${id}`, authJson(tokA, 'PATCH', { status: 'bogus' }), env);
  assert.equal(bad.status, 400);

  const ok = await legal.request(`/83b/trackers/${id}`, authJson(tokA, 'PATCH', { status: 'confirmed' }), env);
  assert.equal(ok.status, 200);
  assert.equal(((await ok.json()) as any).tracker.status, 'confirmed');

  const adminOk = await legal.request(`/83b/trackers/${id}`, authJson(tokAdmin, 'PATCH', { status: 'missed' }), env);
  assert.equal(adminOk.status, 200);
});

test('patch: 404 for a tracker that does not exist', async () => {
  const { env } = makeEnv();
  const tokA = await mintToken(FOUNDER_A.id, 'founder');
  const res = await legal.request('/83b/trackers/9999', authJson(tokA, 'PATCH', { status: 'mailed' }), env);
  assert.equal(res.status, 404);
});

// --- receipt upload ---------------------------------------------------------

test('receipt: owner uploads a PDF -> stored, linked, pending flips to mailed', async () => {
  const { env, state } = makeEnv();
  const tokA = await mintToken(FOUNDER_A.id, 'founder');
  const created = (await (await legal.request('/83b/trackers', authJson(tokA, 'POST', { project_id: 1, taxpayer_name: 'Jane', grant_date: '2026-06-01' }), env)).json()) as any;
  const id = created.tracker.id;

  const fd = new FormData();
  fd.append('file', new Blob([PDF_BYTES], { type: 'application/pdf' }), 'receipt.pdf');
  const res = await legal.request(`/83b/trackers/${id}/receipt`, { method: 'POST', headers: { Authorization: `Bearer ${tokA}` }, body: fd }, env);
  assert.equal(res.status, 200);
  const t = ((await res.json()) as any).tracker;
  assert.ok(t.receipt_doc_id);
  assert.equal(t.status, 'mailed');
  assert.ok(t.mailed_at);
  assert.equal(state.filesPut.length, 1);
});

test('receipt: a non-PDF/JPEG/PNG payload is rejected (400)', async () => {
  const { env } = makeEnv();
  const tokA = await mintToken(FOUNDER_A.id, 'founder');
  const created = (await (await legal.request('/83b/trackers', authJson(tokA, 'POST', { project_id: 1, taxpayer_name: 'Jane', grant_date: '2026-06-01' }), env)).json()) as any;
  const id = created.tracker.id;

  const fd = new FormData();
  fd.append('file', new Blob([new TextEncoder().encode('plain text not a receipt')], { type: 'text/plain' }), 'note.txt');
  const res = await legal.request(`/83b/trackers/${id}/receipt`, { method: 'POST', headers: { Authorization: `Bearer ${tokA}` }, body: fd }, env);
  assert.equal(res.status, 400);
});

test('receipt: missing R2 binding fails loudly (503), no silent drop', async () => {
  const { env } = makeEnv({ withFiles: false });
  const tokA = await mintToken(FOUNDER_A.id, 'founder');
  const created = (await (await legal.request('/83b/trackers', authJson(tokA, 'POST', { project_id: 1, taxpayer_name: 'Jane', grant_date: '2026-06-01' }), env)).json()) as any;
  const id = created.tracker.id;

  const fd = new FormData();
  fd.append('file', new Blob([PDF_BYTES], { type: 'application/pdf' }), 'receipt.pdf');
  const res = await legal.request(`/83b/trackers/${id}/receipt`, { method: 'POST', headers: { Authorization: `Bearer ${tokA}` }, body: fd }, env);
  assert.equal(res.status, 503);
});
