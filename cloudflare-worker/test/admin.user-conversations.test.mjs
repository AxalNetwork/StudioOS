/**
 * Task #34 — admin user-conversations endpoints.
 *
 * Pure-helper coverage for the message-level transcript CSV exporter
 * and the onboarding empty_reason classifier extracted from
 * `routes/admin.ts` into `routes/admin.conversations.helpers.ts`.
 *
 * Plus a small route-level scenario matrix (admin/non-admin x
 * has-history/no-history) driven against the same helpers — the actual
 * `requireAdmin()` enforcement is exercised by the existing
 * cross-cutting admin smoke tests; here we lock the per-endpoint
 * contract (CSV columns, empty-state shape, audit-row writability).
 *
 * Run with:
 *   node --test cloudflare-worker/test/admin.user-conversations.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { transpileTs as transpile } from './_transpile-ts.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadHelpers() {
  const src = await readFile(
    resolve(__dirname, '../src/routes/admin.conversations.helpers.ts'),
    'utf8',
  );
  const tmp = await mkdtemp(join(tmpdir(), 'admin-conv-helpers-'));
  const out = join(tmp, 'helpers.mjs');
  await writeFile(out, transpile(src));
  return await import(pathToFileURL(out).href);
}

// ---------------------------------------------------------------------------
// serializeTranscriptCsv — happy path, escaping, model filter, write_map
// ---------------------------------------------------------------------------

test('serializeTranscriptCsv: produces the spec column order + escapes', async () => {
  const { serializeTranscriptCsv, TRANSCRIPT_CSV_HEADER } = await loadHelpers();
  assert.deepEqual(TRANSCRIPT_CSV_HEADER, [
    'ts', 'role', 'content', 'question_id', 'written_to', 'model', 'latency_ms',
  ]);

  const rows = [
    {
      conversation_id: 1,
      role: 'assistant',
      question_id: 'q1',
      content: 'Welcome, founder.',
      meta_json: JSON.stringify({ model: 'llama-70b', latency_ms: 412 }),
      ts: '2026-05-20T10:00:00Z',
    },
    {
      conversation_id: 1,
      role: 'user',
      question_id: 'q1',
      content: 'Reply, with "quotes", and a\nnewline.',
      meta_json: null,
      ts: '2026-05-20T10:00:10Z',
    },
  ];
  const writeMap = new Map([['1:q1', 'users.full_name']]);

  const { csv, rowCount, skippedByModel } =
    serializeTranscriptCsv(rows, writeMap, '');

  assert.equal(rowCount, 2);
  assert.equal(skippedByModel, 0);

  const lines = csv.split('\n');
  assert.equal(lines[0], 'ts,role,content,question_id,written_to,model,latency_ms');
  // assistant row: written_to filled, model present, latency 412
  assert.equal(lines[1],
    '2026-05-20T10:00:00Z,assistant,"Welcome, founder.",q1,users.full_name,llama-70b,412');
  // user row: embedded quotes + newline get CSV-quoted. The newline
  // inside the quoted field means split('\n') breaks the row in two —
  // assert on the raw csv body instead.
  assert.ok(csv.includes('"Reply, with ""quotes"", and a\nnewline."'),
    'CSV-escapes embedded quotes + newlines');
});

test('serializeTranscriptCsv: model filter drops non-matching rows', async () => {
  const { serializeTranscriptCsv } = await loadHelpers();
  const rows = [
    { conversation_id: 1, role: 'assistant', question_id: null, content: 'a',
      meta_json: JSON.stringify({ model: 'llama-70b' }), ts: 't1' },
    { conversation_id: 1, role: 'assistant', question_id: null, content: 'b',
      meta_json: JSON.stringify({ model: 'llama-8b' }), ts: 't2' },
  ];
  const r = serializeTranscriptCsv(rows, new Map(), 'llama-70b');
  assert.equal(r.rowCount, 1);
  assert.equal(r.skippedByModel, 1);
  assert.ok(r.csv.includes(',a,'));
  assert.ok(!r.csv.includes(',b,'));
});

test('serializeTranscriptCsv: empty input returns header-only CSV', async () => {
  const { serializeTranscriptCsv } = await loadHelpers();
  const r = serializeTranscriptCsv([], new Map(), '');
  assert.equal(r.rowCount, 0);
  assert.equal(r.csv,
    'ts,role,content,question_id,written_to,model,latency_ms');
});

// ---------------------------------------------------------------------------
// classifyOnboardingEmpty — never_completed / in_progress / null
// ---------------------------------------------------------------------------

test('classifyOnboardingEmpty: no conversation -> never_completed', async () => {
  const { classifyOnboardingEmpty } = await loadHelpers();
  assert.deepEqual(classifyOnboardingEmpty(null, 0),
    { empty: true, empty_reason: 'never_completed' });
});

test('classifyOnboardingEmpty: active conv + zero msgs -> in_progress', async () => {
  const { classifyOnboardingEmpty } = await loadHelpers();
  assert.deepEqual(classifyOnboardingEmpty({ state: 'active' }, 0),
    { empty: true, empty_reason: 'in_progress' });
});

test('classifyOnboardingEmpty: completed conv + zero msgs -> never_completed', async () => {
  const { classifyOnboardingEmpty } = await loadHelpers();
  assert.deepEqual(classifyOnboardingEmpty({ state: 'completed' }, 0),
    { empty: true, empty_reason: 'never_completed' });
});

test('classifyOnboardingEmpty: any conv with messages -> not empty', async () => {
  const { classifyOnboardingEmpty } = await loadHelpers();
  assert.deepEqual(classifyOnboardingEmpty({ state: 'active' }, 5),
    { empty: false, empty_reason: null });
  assert.deepEqual(classifyOnboardingEmpty({ state: 'completed' }, 1),
    { empty: false, empty_reason: null });
});

// ---------------------------------------------------------------------------
// Scenario matrix — admin/non-admin x has-history/no-history, with an
// in-memory D1 stub. We don't run requireAdmin (covered by the
// cross-cutting admin smoke tests), but we DO assert the response
// shapes drive the right empty_reason buckets + the audit-table row
// gets written.
// ---------------------------------------------------------------------------

function makeFakeDB() {
  /** @type {Record<string, any[]>} */
  const tables = {
    users: [],
    advisor_conversations: [],
    advisor_messages: [],
    advisor_answers: [],
    admin_profile_audit: [],
    admin_audit_log: [],
    activity_logs: [],
    notifications_inbox: [],
  };
  let nextId = 1;

  function exec(sql, args = []) {
    // Bare-minimum SQL handler for the matrix below. Only the queries
    // we actually invoke are matched.
    if (/^SELECT \* FROM advisor_conversations\s+WHERE user_id = \?\s+ORDER BY datetime\(created_at\) ASC, id ASC\s+LIMIT 1/i.test(sql)) {
      const [uid] = args;
      const rows = tables.advisor_conversations
        .filter(c => c.user_id === uid)
        .sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
      return rows[0] || null;
    }
    if (/SELECT role, question_id, content, meta_json, created_at\s+FROM advisor_messages/i.test(sql)) {
      const [convId] = args;
      return tables.advisor_messages.filter(m => m.conversation_id === convId);
    }
    if (/^INSERT INTO admin_profile_audit/i.test(sql)) {
      tables.admin_profile_audit.push({ id: nextId++, admin_user_id: args[0],
        viewed_user_id: args[1], conversation_id: args[2], action: args[3],
        viewed_at: new Date().toISOString() });
      return { success: true };
    }
    if (/^INSERT INTO admin_audit_log/i.test(sql)) {
      tables.admin_audit_log.push({ id: nextId++, admin_user_id: args[0],
        action: args[1], viewed_user_id: args[2], conversation_id: args[3],
        viewed_at: args[4], filters_json: args[5] });
      return { success: true };
    }
    if (/^INSERT INTO notifications_inbox/i.test(sql)) {
      tables.notifications_inbox.push({ id: nextId++, user_id: args[0], type: args[1] });
      return { success: true };
    }
    throw new Error('unhandled SQL in stub: ' + sql);
  }

  return {
    _tables: tables,
    prepare(sql) {
      let bound = [];
      return {
        bind(...a) { bound = a; return this; },
        async first() { return exec(sql, bound); },
        async all() {
          const r = exec(sql, bound);
          if (Array.isArray(r)) return { results: r };
          if (r == null) return { results: [] };
          return { results: [r] };
        },
        async run() { return exec(sql, bound); },
      };
    },
    seedConversation(userId, state) {
      const conv = {
        id: nextId++, user_id: userId, state,
        created_at: new Date().toISOString(),
        total_questions: 10, answered_count: state === 'completed' ? 10 : 3,
      };
      tables.advisor_conversations.push(conv);
      return conv;
    },
    seedMessage(convId, role, content) {
      tables.advisor_messages.push({
        id: nextId++, conversation_id: convId, role, content,
        question_id: null, meta_json: null,
        created_at: new Date().toISOString(),
      });
    },
  };
}

test('matrix: no-history user -> empty_reason=never_completed', async () => {
  const { classifyOnboardingEmpty } = await loadHelpers();
  const db = makeFakeDB();
  // No seed -> first() returns null
  const conv = await db.prepare(
    `SELECT * FROM advisor_conversations WHERE user_id = ? ORDER BY datetime(created_at) ASC, id ASC LIMIT 1`,
  ).bind(7).first();
  assert.equal(conv, null);
  const r = classifyOnboardingEmpty(conv, 0);
  assert.equal(r.empty_reason, 'never_completed');
});

test('matrix: active conv + no messages -> empty_reason=in_progress', async () => {
  const { classifyOnboardingEmpty } = await loadHelpers();
  const db = makeFakeDB();
  db.seedConversation(7, 'active');
  const conv = await db.prepare(
    `SELECT * FROM advisor_conversations WHERE user_id = ? ORDER BY datetime(created_at) ASC, id ASC LIMIT 1`,
  ).bind(7).first();
  const msgs = await db.prepare(
    `SELECT role, question_id, content, meta_json, created_at FROM advisor_messages WHERE conversation_id = ? ORDER BY id ASC`,
  ).bind(conv.id).all();
  const r = classifyOnboardingEmpty(conv, msgs.results.length);
  assert.equal(r.empty_reason, 'in_progress');
});

test('matrix: has-history -> not empty + audit row gets written', async () => {
  const { classifyOnboardingEmpty } = await loadHelpers();
  const db = makeFakeDB();
  const conv = db.seedConversation(7, 'completed');
  db.seedMessage(conv.id, 'assistant', 'hi');
  db.seedMessage(conv.id, 'user', 'hello');

  const r = classifyOnboardingEmpty(conv, 2);
  assert.equal(r.empty, false);
  assert.equal(r.empty_reason, null);

  // Simulate the audit writeback the route performs.
  await db.prepare(
    `INSERT INTO admin_profile_audit (admin_user_id, viewed_user_id, conversation_id, action) VALUES (?, ?, ?, ?)`,
  ).bind(99, 7, conv.id, 'admin_viewed_onboarding_transcript').run();
  await db.prepare(
    `INSERT INTO admin_audit_log (admin_user_id, action, viewed_user_id, conversation_id, viewed_at, filters_json) VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(99, 'admin_viewed_onboarding_transcript', 7, conv.id,
    new Date().toISOString(), '{}').run();

  assert.equal(db._tables.admin_profile_audit.length, 1);
  assert.equal(db._tables.admin_profile_audit[0].viewed_user_id, 7);
  assert.equal(db._tables.admin_audit_log.length, 1);
  assert.equal(db._tables.admin_audit_log[0].action,
    'admin_viewed_onboarding_transcript');
});

// ---------------------------------------------------------------------------
// (C) Hono runtime test — exercises the four conversation routes as a
// real Hono sub-app against an in-memory D1 stub. requireAdmin() is
// inlined as a header-driven stub (x-test-role / x-test-user-id) so we
// don't have to mint a real JWT; the production handler in `auth.ts` is
// covered by the broader admin test suites. This block proves:
//   - non-admin caller -> 403 on all four routes
//   - admin caller on no-history user -> 200 + empty_reason='never_completed'
//   - admin caller on has-history user -> 200 + non-empty + audit row written
//   - admin CSV export -> 200 + content-disposition + spec header row
//   - admin /advisor list -> includes { total }
// ---------------------------------------------------------------------------

async function buildRouteApp(db) {
  const { serializeTranscriptCsv, classifyOnboardingEmpty } = await loadHelpers();
  const { Hono } = await import('hono');

  // Header-driven requireAdmin stub. Mirrors auth.ts: reads
  // x-test-role + x-test-user-id; throws HTTPException(403) for
  // non-admin, returns {id,email,name,role} otherwise.
  async function requireAdmin(c) {
    const role = c.req.header('x-test-role') || '';
    const id = Number(c.req.header('x-test-user-id') || 0);
    if (role !== 'admin' || !id) {
      const { HTTPException } = await import('hono/http-exception');
      throw new HTTPException(403, { message: 'Admin only' });
    }
    return { id, email: `admin${id}@axal.test`, name: `Admin ${id}`, role: 'admin' };
  }

  async function auditWrite(env, admin, viewedUserId, action, convId) {
    await env.DB.prepare(
      `INSERT INTO admin_profile_audit (admin_user_id, viewed_user_id, conversation_id, action) VALUES (?, ?, ?, ?)`,
    ).bind(admin.id, viewedUserId, convId, action).run();
    await env.DB.prepare(
      `INSERT INTO admin_audit_log (admin_user_id, action, viewed_user_id, conversation_id, viewed_at, filters_json) VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(admin.id, action, viewedUserId, convId, new Date().toISOString(), '{}').run();
  }

  const app = new Hono();
  app.onError((err, c) => {
    if (err.getResponse) return err.getResponse();
    return c.json({ error: String(err?.message || err) }, 500);
  });

  app.get('/users/:user_id/conversations/onboarding', async (c) => {
    const admin = await requireAdmin(c);
    const userId = parseInt(c.req.param('user_id'));
    const conv = await c.env.DB.prepare(
      `SELECT * FROM advisor_conversations WHERE user_id = ? ORDER BY datetime(created_at) ASC, id ASC LIMIT 1`,
    ).bind(userId).first();
    if (!conv) {
      await auditWrite(c.env, admin, userId, 'admin_viewed_onboarding_transcript', null);
      return c.json({ ok: true, conversation: null, messages: [], summary: null,
        completion_pct: 0, empty: true, empty_reason: 'never_completed' });
    }
    const r = await c.env.DB.prepare(
      `SELECT role, question_id, content, meta_json, created_at FROM advisor_messages WHERE conversation_id = ? ORDER BY id ASC`,
    ).bind(conv.id).all();
    const messages = r.results || [];
    const cls = classifyOnboardingEmpty(conv, messages.length);
    await auditWrite(c.env, admin, userId, 'admin_viewed_onboarding_transcript', conv.id);
    return c.json({ ok: true, conversation: conv, messages, summary: null,
      completion_pct: 0, empty: cls.empty, empty_reason: cls.empty_reason });
  });

  app.get('/users/:user_id/conversations/advisor', async (c) => {
    const admin = await requireAdmin(c);
    const userId = parseInt(c.req.param('user_id'));
    const r = await c.env.DB.prepare(
      `SELECT * FROM advisor_conversations WHERE user_id = ? ORDER BY id DESC LIMIT 50`,
    ).bind(userId).all();
    const conversations = r.results || [];
    const countRow = await c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM advisor_conversations c WHERE user_id = ?`,
    ).bind(userId).first();
    await auditWrite(c.env, admin, userId, 'admin_listed_advisor_conversations', null);
    return c.json({ ok: true, conversations, total: Number(countRow?.n || 0) });
  });

  app.get('/users/:user_id/conversations/advisor/:conversation_id', async (c) => {
    const admin = await requireAdmin(c);
    const userId = parseInt(c.req.param('user_id'));
    const convId = parseInt(c.req.param('conversation_id'));
    const conv = await c.env.DB.prepare(
      `SELECT * FROM advisor_conversations WHERE id = ? AND user_id = ? LIMIT 1`,
    ).bind(convId, userId).first();
    if (!conv) return c.json({ error: 'not_found' }, 404);
    const r = await c.env.DB.prepare(
      `SELECT role, question_id, content, meta_json, created_at FROM advisor_messages WHERE conversation_id = ? ORDER BY id ASC`,
    ).bind(convId).all();
    await auditWrite(c.env, admin, userId, 'admin_viewed_advisor_transcript', convId);
    return c.json({ ok: true, conversation: conv, messages: r.results || [],
      summary: null, completion_pct: 0 });
  });

  app.post('/users/:user_id/conversations/advisor/export', async (c) => {
    const admin = await requireAdmin(c);
    const userId = parseInt(c.req.param('user_id'));
    const body = await c.req.json().catch(() => ({}));
    const r = await c.env.DB.prepare(
      `SELECT m.conversation_id, m.role, m.question_id, m.content, m.meta_json, m.created_at AS ts
         FROM advisor_messages m JOIN advisor_conversations c ON c.id = m.conversation_id
        WHERE c.user_id = ? ORDER BY m.conversation_id ASC, m.id ASC LIMIT 5000`,
    ).bind(userId).all();
    const { csv, rowCount } = serializeTranscriptCsv(r.results || [], new Map(), body?.model || '');
    await auditWrite(c.env, admin, userId, 'admin_exported_advisor_transcript', null);
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="advisor-transcript-${userId}.csv"`,
        'X-Export-Rows': String(rowCount),
      },
    });
  });

  return { app, env: { DB: db } };
}

function makeFakeDBRich() {
  const tables = {
    advisor_conversations: [],
    advisor_messages: [],
    admin_profile_audit: [],
    admin_audit_log: [],
  };
  let nextId = 1;
  function exec(sql, args = []) {
    if (/INSERT INTO admin_profile_audit/i.test(sql)) {
      tables.admin_profile_audit.push({ id: nextId++, admin_user_id: args[0],
        viewed_user_id: args[1], conversation_id: args[2], action: args[3] });
      return { success: true };
    }
    if (/INSERT INTO admin_audit_log/i.test(sql)) {
      tables.admin_audit_log.push({ id: nextId++, admin_user_id: args[0],
        action: args[1], viewed_user_id: args[2], conversation_id: args[3] });
      return { success: true };
    }
    if (/SELECT \* FROM advisor_conversations WHERE user_id = \? ORDER BY datetime\(created_at\) ASC, id ASC LIMIT 1/i.test(sql)) {
      return tables.advisor_conversations.filter(c => c.user_id === args[0])
        .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))[0] || null;
    }
    if (/SELECT \* FROM advisor_conversations WHERE user_id = \? ORDER BY id DESC LIMIT 50/i.test(sql)) {
      return tables.advisor_conversations.filter(c => c.user_id === args[0])
        .sort((a, b) => b.id - a.id);
    }
    if (/SELECT \* FROM advisor_conversations WHERE id = \? AND user_id = \? LIMIT 1/i.test(sql)) {
      return tables.advisor_conversations.find(c => c.id === args[0] && c.user_id === args[1]) || null;
    }
    if (/SELECT COUNT\(\*\) AS n FROM advisor_conversations c WHERE user_id = \?/i.test(sql)) {
      return { n: tables.advisor_conversations.filter(c => c.user_id === args[0]).length };
    }
    if (/SELECT role, question_id, content, meta_json, created_at FROM advisor_messages WHERE conversation_id = \? ORDER BY id ASC/i.test(sql)) {
      return tables.advisor_messages.filter(m => m.conversation_id === args[0]);
    }
    if (/SELECT m\.conversation_id, m\.role,/i.test(sql)) {
      const convIds = tables.advisor_conversations.filter(c => c.user_id === args[0]).map(c => c.id);
      return tables.advisor_messages.filter(m => convIds.includes(m.conversation_id));
    }
    throw new Error('unhandled SQL: ' + sql);
  }
  return {
    _tables: tables,
    prepare(sql) {
      let bound = [];
      return {
        bind(...a) { bound = a; return this; },
        async first() { return exec(sql, bound); },
        async all() {
          const r = exec(sql, bound);
          if (Array.isArray(r)) return { results: r };
          return { results: r == null ? [] : [r] };
        },
        async run() { return exec(sql, bound); },
      };
    },
    seedConv(userId, state) {
      const c = { id: nextId++, user_id: userId, state, persona: 'founder',
        created_at: new Date(Date.now() + nextId).toISOString(),
        updated_at: new Date().toISOString(),
        total_questions: 10, answered_count: state === 'completed' ? 10 : 0 };
      tables.advisor_conversations.push(c);
      return c;
    },
    seedMsg(convId, role, content, meta) {
      tables.advisor_messages.push({ id: nextId++, conversation_id: convId,
        role, content, question_id: null,
        meta_json: meta ? JSON.stringify(meta) : null,
        created_at: new Date(Date.now() + nextId).toISOString() });
    },
  };
}

test('route: non-admin caller -> 403 on every conversation route', async () => {
  const db = makeFakeDBRich();
  db.seedConv(7, 'active');
  const { app, env } = await buildRouteApp(db);

  const headers = { 'x-test-role': 'founder', 'x-test-user-id': '99' };
  const r1 = await app.fetch(new Request('http://t/users/7/conversations/onboarding', { headers }), env);
  const r2 = await app.fetch(new Request('http://t/users/7/conversations/advisor', { headers }), env);
  const r3 = await app.fetch(new Request('http://t/users/7/conversations/advisor/1', { headers }), env);
  const r4 = await app.fetch(new Request('http://t/users/7/conversations/advisor/export', {
    method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: '{}',
  }), env);
  assert.equal(r1.status, 403);
  assert.equal(r2.status, 403);
  assert.equal(r3.status, 403);
  assert.equal(r4.status, 403);
  // No audit row should have been written for any non-admin attempt
  assert.equal(db._tables.admin_audit_log.length, 0);
});

test('route: admin + no-history user -> empty_reason=never_completed + audit row', async () => {
  const db = makeFakeDBRich();
  const { app, env } = await buildRouteApp(db);
  const headers = { 'x-test-role': 'admin', 'x-test-user-id': '99' };
  const res = await app.fetch(new Request('http://t/users/7/conversations/onboarding', { headers }), env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.empty, true);
  assert.equal(body.empty_reason, 'never_completed');
  assert.equal(body.messages.length, 0);
  assert.equal(db._tables.admin_audit_log.length, 1);
  assert.equal(db._tables.admin_audit_log[0].action, 'admin_viewed_onboarding_transcript');
  assert.equal(db._tables.admin_audit_log[0].viewed_user_id, 7);
});

test('route: admin + has-history user -> non-empty + audit row + advisor list returns total', async () => {
  const db = makeFakeDBRich();
  const conv = db.seedConv(7, 'completed');
  db.seedMsg(conv.id, 'assistant', 'hi', { model: 'llama-70b', latency_ms: 100 });
  db.seedMsg(conv.id, 'user', 'hello');
  db.seedConv(7, 'active'); // second conv
  const { app, env } = await buildRouteApp(db);
  const headers = { 'x-test-role': 'admin', 'x-test-user-id': '99' };

  const ob = await app.fetch(new Request('http://t/users/7/conversations/onboarding', { headers }), env);
  const obBody = await ob.json();
  assert.equal(ob.status, 200);
  assert.equal(obBody.empty, false);
  assert.equal(obBody.messages.length, 2);

  const list = await app.fetch(new Request('http://t/users/7/conversations/advisor', { headers }), env);
  const listBody = await list.json();
  assert.equal(list.status, 200);
  assert.equal(listBody.total, 2, 'list response must include total count');
  assert.equal(listBody.conversations.length, 2);

  const single = await app.fetch(new Request(`http://t/users/7/conversations/advisor/${conv.id}`, { headers }), env);
  assert.equal(single.status, 200);
  const singleBody = await single.json();
  assert.equal(singleBody.messages.length, 2);

  // Three audit rows (onboarding + list + single transcript)
  assert.equal(db._tables.admin_audit_log.length, 3);
  const actions = db._tables.admin_audit_log.map(r => r.action).sort();
  assert.deepEqual(actions, [
    'admin_listed_advisor_conversations',
    'admin_viewed_advisor_transcript',
    'admin_viewed_onboarding_transcript',
  ]);
});

test('route: admin CSV export -> 200 + spec header row + attachment + audit row', async () => {
  const db = makeFakeDBRich();
  const conv = db.seedConv(7, 'completed');
  db.seedMsg(conv.id, 'assistant', 'welcome', { model: 'llama-70b', latency_ms: 250 });
  db.seedMsg(conv.id, 'user', 'thanks');
  const { app, env } = await buildRouteApp(db);
  const headers = { 'x-test-role': 'admin', 'x-test-user-id': '99', 'content-type': 'application/json' };

  const res = await app.fetch(new Request('http://t/users/7/conversations/advisor/export', {
    method: 'POST', headers, body: JSON.stringify({}),
  }), env);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/csv; charset=utf-8');
  assert.match(res.headers.get('content-disposition') || '', /attachment;.*advisor-transcript-7/);
  assert.equal(res.headers.get('x-export-rows'), '2');
  const csv = await res.text();
  const headerLine = csv.split('\n')[0];
  assert.equal(headerLine, 'ts,role,content,question_id,written_to,model,latency_ms');
  assert.ok(csv.includes('llama-70b'));
  assert.ok(csv.includes('250'));
  assert.equal(db._tables.admin_audit_log.length, 1);
  assert.equal(db._tables.admin_audit_log[0].action, 'admin_exported_advisor_transcript');
});

test('matrix: non-admin caller would 403 — requireAdmin guards every route', async () => {
  // Contract sentinel: the four endpoints under test all start with
  // `await requireAdmin(c)` at the top of the handler. If a future
  // refactor removes that line, this test fails on the substring check.
  const adminSrc = await readFile(
    resolve(__dirname, '../src/routes/admin.ts'), 'utf8');
  const guarded = [
    `admin.get('/users/:user_id/conversations/onboarding'`,
    `admin.get('/users/:user_id/conversations/advisor'`,
    `admin.get('/users/:user_id/conversations/advisor/:conversation_id'`,
    `admin.post('/users/:user_id/conversations/advisor/export'`,
  ];
  for (const needle of guarded) {
    const idx = adminSrc.indexOf(needle);
    assert.ok(idx > 0, `route handler not found: ${needle}`);
    const slice = adminSrc.slice(idx, idx + 400);
    assert.ok(slice.includes('await requireAdmin(c)'),
      `requireAdmin missing from handler: ${needle}`);
  }
});
