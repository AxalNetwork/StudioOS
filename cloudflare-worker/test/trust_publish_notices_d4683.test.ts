/**
 * D4683 (#4683, HQ Security audit 3 of 6) — Trust publication integrity and notice delivery.
 *
 *   · concurrent Publishes of one review make one change record; a repeated key is the same act; a stale
 *     preview publishes nothing (the D4675 mechanism, pinned here under concurrency);
 *   · a notice delivery interrupted between its claim and its outcome is recovered by the next sweep and read
 *     as unknown until then; two sweeps never both resend it;
 *   · a failing delivery stops at the attempt limit and the notice needs attention;
 *   · each notice reconciles with its effective date (sent late, missed once started) and with the public
 *     change log entry that published it.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/trust_publish_notices_d4683.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import trustPublic from '../src/routes/trust_public.ts';
import adminTrustCenter from '../src/routes/admin_trust_center.ts';
import { NOTICE_DAYS, today } from '../src/services/trustContent.ts';
import { MAX_ATTEMPTS, SEND_LEASE_MS, noticeDeliveries, sendSubprocessorNotices } from '../src/services/subprocessorNotices.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef'; // synthetic test fixture
const SUPER = 1;
const TC = '/api/admin/security/trust-center';
const sqlAt = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

const BUILT_DDL = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  return (db.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`).all() as any[]).map((r) => r.sql as string);
})();

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const s of BUILT_DDL) { try { db.exec(s); } catch { /* replayed later */ } }
  db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)').run(SUPER, 'admin', 'Sue Super', 'sue@example.test');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  db.prepare("INSERT INTO user_sessions (user_id, jti, factor, assurance_level, created_at) VALUES (?, ?, 'totp', 'totp', ?)").run(SUPER, `s-${SUPER}`, sqlAt(Date.now()));
  return db;
}

const app = new Hono<any>();
app.route('/api/admin/security/trust-center', adminTrustCenter);
app.route('/api/public', trustPublic);

function harness() {
  const db = fixture();
  const env: Record<string, unknown> = {
    JWT_SECRET, ENVIRONMENT: 'development', APP_URL: 'https://axal.example.test', DB: d1Over(db),
    GMAIL_CLIENT_ID: 'id', GMAIL_CLIENT_SECRET: 'secret', GMAIL_REFRESH_TOKEN: 'refresh',
  };
  const mails: string[] = [];
  let failing = false;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: { body?: unknown }) => {
    const url = String(input);
    if (url.startsWith('https://oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'at' }), { status: 200 });
    if (url.startsWith('https://gmail.googleapis.com/')) {
      if (failing) return new Response('{}', { status: 500 });
      const raw = JSON.parse(String(init?.body)).raw as string;
      mails.push(decodeURIComponent(escape(atob(raw.replace(/-/g, '+').replace(/_/g, '/')))));
      return new Response('{}', { status: 200 });
    }
    return new Response('unexpected', { status: 599 });
  }) as unknown as typeof fetch;
  async function call(method: string, path: string, body?: unknown, who: number | null = SUPER, dbBinding = env.DB) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (who !== null) {
      headers.Authorization = `Bearer ${await new SignJWT({ user_id: who, jti: `s-${who}` }).setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET))}`;
    }
    const saved = [console.warn, console.error, console.info]; console.warn = () => {}; console.error = () => {}; console.info = () => {};
    try {
      const res = await withThrownResponses(() => app.request(path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, { ...env, DB: dbBinding }));
      return { status: res.status, body: await res.json().catch(() => null) };
    } finally { [console.warn, console.error, console.info] = saved; }
  }
  return {
    db, env, mails, call,
    fail: (on: boolean) => { failing = on; },
    restore: () => { globalThis.fetch = realFetch; },
  };
}

type H = ReturnType<typeof harness>;
const lines = (text: string) => ({ intro: null, groups: [{ title: 'Signing in', lines: [{ text, recorded: true, checked_at: today() }] }] });
const changes = (h: H) => Number((h.db.prepare('SELECT COUNT(*) AS n FROM trust_content_changes').get() as any).n);
let seq = 0;
const key = () => `k4683-${String(++seq).padStart(12, '0')}`;
const tokenNow = async (h: H) => (await h.call('GET', TC)).body.pending_token as string;
const NOTE = 'Security: passkeys added to sign-in.';

/** Two confirmed subscribers, through the real subscribe and confirm flow, so their addresses are encrypted as in production. */
async function subscribers(h: H, emails = ['ana@example.test', 'bo@example.test']) {
  for (const email of emails) {
    await h.call('POST', '/api/public/trust/subprocessors/subscribe', { email }, null);
    const mime = h.mails[h.mails.length - 1];
    const body = mime.split('Content-Transfer-Encoding: base64\r\n\r\n')[1]?.split('\r\n\r\n')[0] || '';
    const text = new TextDecoder().decode(Uint8Array.from(atob(body.replace(/\r\n/g, '')), (c) => c.charCodeAt(0)));
    const token = new URL(/https?:\/\/\S+\/api\/public\/trust\/subprocessors\/confirm\?token=\S+/.exec(text)![0]).searchParams.get('token')!;
    await h.call('POST', `/api/public/trust/subprocessors/confirm?token=${encodeURIComponent(token)}`, undefined, null);
  }
  h.mails.length = 0;
}

/** Publishes one new subprocessor (mail failing, so no delivery is recorded yet); its row and the change uid. */
async function publishVendor(h: H, name = 'Vendor F') {
  await h.call('POST', `${TC}/subprocessors`, { name, purpose: 'Error monitoring', data: 'Error reports', location: 'United States' });
  h.fail(true);
  const out = await h.call('POST', `${TC}/publish`, { note: `Subprocessors: ${name} added for error monitoring.`, pending_token: await tokenNow(h), publish_key: key() });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  h.fail(false);
  // The publish's own sweep ran with mail failing; start every test from "nothing attempted".
  h.db.prepare('DELETE FROM subprocessor_notice_deliveries').run();
  h.mails.length = 0;
  const row = h.db.prepare('SELECT id, starts_at, change_uid FROM trust_subprocessors WHERE name = ?').get(name) as any;
  return { id: Number(row.id), starts_at: String(row.starts_at), change_uid: String(row.change_uid), publish: out.body };
}

const subIds = (h: H) => (h.db.prepare("SELECT id FROM subprocessor_subscribers WHERE status = 'confirmed' ORDER BY id").all() as any[]).map((r) => Number(r.id));
const delivery = (h: H, sid: number, subid: number) => h.db.prepare('SELECT * FROM subprocessor_notice_deliveries WHERE subprocessor_id = ? AND subscriber_id = ?').get(sid, subid) as any;
const row = async (h: H, now = Date.now()) => ((await noticeDeliveries(h.env as any, now)) as any).rows[0];

// ---------------------------------------------------------------- publication

test('two concurrent Publishes of the same review make one change record; the loser publishes nothing', async () => {
  const h = harness();
  try {
    await h.call('PUT', `${TC}/blocks/security`, { body: lines('Passkeys.') });
    const token = await tokenNow(h);
    const [a, b] = await Promise.all([
      h.call('POST', `${TC}/publish`, { note: NOTE, pending_token: token, publish_key: key() }),
      h.call('POST', `${TC}/publish`, { note: NOTE, pending_token: token, publish_key: key() }),
    ]);
    const won = [a, b].filter((r) => r.status === 200 && r.body.replayed === false);
    assert.equal(won.length, 1, `${a.status} ${b.status}`);
    const lost = a === won[0] ? b : a;
    assert.equal(lost.status, 409);
    assert.ok(['changed_since_review', 'nothing_to_publish'].includes(lost.body.code), lost.body.code);
    assert.equal(changes(h), 1);
  } finally { h.restore(); }
});

test('the same Publish sent twice at once is one act: one record, and the second answers with it', async () => {
  const h = harness();
  try {
    await h.call('PUT', `${TC}/blocks/security`, { body: lines('Passkeys.') });
    const token = await tokenNow(h);
    const k = key();
    const [a, b] = await Promise.all([
      h.call('POST', `${TC}/publish`, { note: NOTE, pending_token: token, publish_key: k }),
      h.call('POST', `${TC}/publish`, { note: NOTE, pending_token: token, publish_key: k }),
    ]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal(a.body.uid, b.body.uid, 'two records for one Publish');
    assert.deepEqual([a.body.replayed, b.body.replayed].sort(), [false, true]);
    assert.equal(changes(h), 1);
  } finally { h.restore(); }
});

// D5495: pause only scheduling; every query and write still runs on real SQLite.
for (const phase of ['after-key-read', 'before-draft-read'] as const) {
  test(`D5495: identical Publish replays after ${phase}`, { timeout: 30000 }, async (t) => {
    const h = harness();
    const entered = Promise.withResolvers<void>();
    const resumed = Promise.withResolvers<void>();
    t.signal.addEventListener('abort', () => { entered.resolve(); resumed.resolve(); }, { once: true });
    let replay: ReturnType<H['call']> | undefined;
    try {
      await h.call('PUT', `${TC}/blocks/security`, { body: lines('Passkeys.') });
      const body = { note: NOTE, pending_token: await tokenNow(h), publish_key: key() };
      const base = h.env.DB as ReturnType<typeof d1Over>;
      let paused = false;
      const scheduled = {
        ...base,
        prepare(sql: string) {
          const statement = base.prepare(sql);
          const isGate = phase === 'after-key-read'
            ? sql.includes('FROM trust_content_changes WHERE request_key = ?')
            : sql === "SELECT key FROM trust_content_blocks WHERE state = 'draft'";
          const gate = async (read: () => Promise<unknown>) => {
            if (!isGate || paused) return read();
            paused = true;
            const before = phase === 'after-key-read' ? await read() : undefined;
            entered.resolve();
            await resumed.promise;
            return phase === 'after-key-read' ? before : read();
          };
          const wrapped = {
            ...statement,
            bind(...args: unknown[]) { statement.bind(...args); return wrapped; },
            first: (column?: string) => gate(() => statement.first(column)),
            all: () => gate(() => statement.all()),
          };
          return wrapped;
        },
      };
      replay = h.call('POST', `${TC}/publish`, body, SUPER, scheduled);
      await Promise.race([entered.promise, replay.then(() => { throw new Error(`Publish did not reach ${phase}`); })]);
      const original = await h.call('POST', `${TC}/publish`, body);
      resumed.resolve();
      const duplicate = await replay;
      assert.equal(original.status, 200, JSON.stringify(original.body));
      assert.equal(duplicate.status, 200, JSON.stringify(duplicate.body));
      assert.equal(original.body.replayed, false);
      assert.equal(duplicate.body.replayed, true);
      assert.equal(duplicate.body.uid, original.body.uid);
      assert.equal(changes(h), 1);
    } finally {
      resumed.resolve();
      await replay?.catch(() => {});
      h.restore();
      h.db.close();
    }
  });
}

test('a stale preview publishes nothing, and the change log says nothing happened', async () => {
  const h = harness();
  try {
    await h.call('PUT', `${TC}/blocks/security`, { body: lines('Passkeys.') });
    const token = await tokenNow(h);
    await h.call('PUT', `${TC}/blocks/security`, { body: lines('Passkeys, and something nobody reviewed.') });
    const r = await h.call('POST', `${TC}/publish`, { note: NOTE, pending_token: token, publish_key: key() });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'changed_since_review');
    assert.equal(changes(h), 0);
  } finally { h.restore(); }
});

// ---------------------------------------------------------------- notice delivery

test('an interrupted delivery reads as unknown, is recovered by the next sweep, and says it may have arrived twice', async () => {
  const h = harness();
  try {
    await subscribers(h);
    const v = await publishVendor(h);
    const [first, second] = subIds(h);
    const now = Date.now();
    // Claimed twenty minutes ago and never answered: the isolate died between the send and the write.
    h.db.prepare("INSERT INTO subprocessor_notice_deliveries (subprocessor_id, subscriber_id, outcome, attempted_at, attempts) VALUES (?, ?, 'sending', ?, 1)")
      .run(v.id, first, sqlAt(now - 20 * 60 * 1000));
    let r = await row(h, now);
    assert.equal(r.unknown, 1, 'an interrupted send read as in progress');
    assert.equal(r.sending, 0);
    assert.equal(r.state, 'needs_attention');

    const swept = await sendSubprocessorNotices(h.env as any, { now });
    assert.equal(swept.recovered, 1);
    assert.equal(swept.sent, 2, 'the recovered one and the one never attempted');
    const d = delivery(h, v.id, first);
    assert.equal(d.outcome, 'sent');
    assert.equal(Number(d.interrupted), 1);
    assert.equal(Number(d.attempts), 2);
    assert.ok(d.sent_at);
    assert.equal(delivery(h, v.id, second).outcome, 'sent');
    r = await row(h, now);
    assert.equal(r.unknown, 0);
    assert.equal(r.resent_after_interruption, 1);
    assert.equal(r.state, 'delivered');
  } finally { h.restore(); }
});

test('a claim inside its lease is in progress, and is not sent a second time', async () => {
  const h = harness();
  try {
    await subscribers(h, ['ana@example.test']);
    const v = await publishVendor(h);
    const [first] = subIds(h);
    const now = Date.now();
    h.db.prepare("INSERT INTO subprocessor_notice_deliveries (subprocessor_id, subscriber_id, outcome, attempted_at, attempts) VALUES (?, ?, 'sending', ?, 1)")
      .run(v.id, first, sqlAt(now - SEND_LEASE_MS + 60_000));
    assert.equal((await row(h, now)).sending, 1);
    assert.equal((await row(h, now)).state, 'in_progress');
    assert.equal((await sendSubprocessorNotices(h.env as any, { now })).sent, 0);
    assert.equal(h.mails.length, 0);
  } finally { h.restore(); }
});

test('two sweeps reaching one interrupted delivery send it once', async () => {
  const h = harness();
  try {
    await subscribers(h, ['ana@example.test']);
    const v = await publishVendor(h);
    const [first] = subIds(h);
    const now = Date.now();
    h.db.prepare("INSERT INTO subprocessor_notice_deliveries (subprocessor_id, subscriber_id, outcome, attempted_at, attempts) VALUES (?, ?, 'sending', ?, 1)")
      .run(v.id, first, sqlAt(now - 30 * 60 * 1000));
    const [a, b] = await Promise.all([sendSubprocessorNotices(h.env as any, { now }), sendSubprocessorNotices(h.env as any, { now })]);
    assert.equal(a.sent + b.sent, 1);
    assert.equal(h.mails.length, 1);
    assert.equal(Number(delivery(h, v.id, first).attempts), 2);
  } finally { h.restore(); }
});

test('a failing delivery is retried after an hour, stops at the attempt limit, and the notice needs attention', async () => {
  const h = harness();
  try {
    await subscribers(h, ['ana@example.test']);
    const v = await publishVendor(h);
    const [first] = subIds(h);
    let now = Date.now();
    h.fail(true);
    assert.equal((await sendSubprocessorNotices(h.env as any, { now })).failed, 1);
    assert.equal((await sendSubprocessorNotices(h.env as any, { now: now + 30 * 60 * 1000 })).failed, 0, 'retried before the hour');
    for (let i = 2; i <= MAX_ATTEMPTS; i += 1) {
      now += 61 * 60 * 1000;
      assert.equal((await sendSubprocessorNotices(h.env as any, { now })).failed, 1, `attempt ${i} did not run`);
    }
    assert.equal(Number(delivery(h, v.id, first).attempts), MAX_ATTEMPTS);
    h.fail(false);
    now += 61 * 60 * 1000;
    assert.equal((await sendSubprocessorNotices(h.env as any, { now })).sent, 0, 'retried past the attempt limit');
    const r = await row(h, now);
    assert.equal(r.exhausted, 1);
    assert.equal(r.state, 'needs_attention');
  } finally { h.restore(); }
});

test('each notice reconciles with its effective date: owed by, late, and missed once started', async () => {
  const h = harness();
  try {
    await subscribers(h);
    const v = await publishVendor(h);
    const [first, second] = subIds(h);
    const start = Date.parse(`${v.starts_at}T00:00:00Z`);
    const dueBy = new Date(start - NOTICE_DAYS * 86_400_000).toISOString().slice(0, 10);
    let r = await row(h);
    assert.equal(r.notice_due_by, dueBy);
    assert.equal(r.state, 'in_progress');
    // One went out after the notice date; the other never went.
    h.db.prepare("INSERT INTO subprocessor_notice_deliveries (subprocessor_id, subscriber_id, outcome, attempted_at, attempts, sent_at) VALUES (?, ?, 'sent', ?, 1, ?)")
      .run(v.id, first, sqlAt(start - 86_400_000), sqlAt(start - 86_400_000));
    const afterDue = start - 2 * 86_400_000;
    r = await row(h, afterDue);
    assert.equal(r.late, 1);
    assert.equal(r.not_sent, 1);
    assert.equal(r.state, 'needs_attention', 'past the notice date with a subscriber still owed, and it read as fine');
    // The start day comes: nothing more is sent, and the notice is missed for that subscriber.
    const started = start + 3600_000;
    assert.equal((await sendSubprocessorNotices(h.env as any, { now: started })).sent, 0, 'a notice was sent after the start');
    r = await row(h, started);
    assert.equal(r.started, true);
    assert.equal(r.state, 'missed');
    assert.equal(delivery(h, v.id, second), undefined);
  } finally { h.restore(); }
});

test('each notice names the change-log entry that published it', async () => {
  const h = harness();
  try {
    await subscribers(h, ['ana@example.test']);
    const v = await publishVendor(h);
    const r = await row(h);
    assert.equal(r.change_uid, v.publish.uid);
    assert.equal(r.in_change_log, true);
    assert.ok(r.published_at);
    // A row whose change is not on the log says so rather than borrowing another entry.
    h.db.prepare("UPDATE trust_subprocessors SET change_uid = 'tcc_nowhere' WHERE id = ?").run(v.id);
    assert.equal((await row(h)).in_change_log, false);
    // And the HQ read carries the reconciliation.
    const read = await h.call('GET', TC);
    const n = read.body.notices.rows[0];
    for (const k of ['notice_due_by', 'unknown', 'late', 'exhausted', 'state', 'change_uid', 'in_change_log']) assert.ok(k in n, `${k} is missing from the HQ read`);
  } finally { h.restore(); }
});
