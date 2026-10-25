/**
 * D1075 (#2967, part 3 of #2425) — the public trust center's content store,
 * its change log, the Super Admin's writes, the public matrix, subprocessor
 * notices, and Help's private Security reports.
 *
 * The database is the baseline plus every numbered migration above the
 * cutoff, schema only, as D982's test builds it, so the SQL runs against
 * production's columns. Every person, vendor and address is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/trust_content_d1075.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import trustPublic from '../src/routes/trust_public.ts';
import adminTrustCenter from '../src/routes/admin_trust_center.ts';
import { securityReports, adminSecurityReports } from '../src/routes/security_reports.ts';
import { BLOCK_KEYS, MATRIX_PROFILES, MATRIX_REQUIREMENTS, NOTICE_DAYS, publicMatrix, today } from '../src/services/trustContent.ts';
import { obligationsForRole } from '../src/services/trust.ts';
import { sendSubprocessorNotices } from '../src/services/subprocessorNotices.ts';
import { REPORTS_PER_DAY } from '../src/services/securityReports.ts';
import { parseTicketCategory, SECURITY_CATEGORY, TICKET_CATEGORIES } from '../src/services/ticketCategories.ts';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef'; // synthetic test fixture
const BASE = 'https://axal.example.test';
const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const MIGRATIONS = resolve(process.cwd(), 'cloudflare-worker/sql/migrations');
const SUPER = 1, PLAIN_ADMIN = 2, MEMBER = 3, STALE_SUPER = 4, OTHER_MEMBER = 5;
const NOTE = 'Security: passkeys added to sign-in.';
const PDF = new TextEncoder().encode('%PDF-1.7\n% synthetic auditor report\n%%EOF');

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
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  u.run(SUPER, 'admin', 'Sue Super', 'sue@example.test');
  u.run(PLAIN_ADMIN, 'admin', 'Pat Plain', 'pat@example.test');
  u.run(MEMBER, 'founder', 'Mo Member', 'mo@example.test');
  u.run(STALE_SUPER, 'admin', 'Sam Stale', 'sam@example.test');
  u.run(OTHER_MEMBER, 'investor', 'Ivy Other', 'ivy@example.test');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(STALE_SUPER);
  const s = db.prepare("INSERT INTO user_sessions (user_id, jti, factor, assurance_level, created_at) VALUES (?, ?, 'totp', 'totp', ?)");
  for (const id of [SUPER, PLAIN_ADMIN, MEMBER, OTHER_MEMBER]) s.run(id, `s-${id}`, new Date().toISOString().slice(0, 19).replace('T', ' '));
  // A TOTP session a day old, with no step-up since: the write bar's "recent" fails.
  s.run(STALE_SUPER, `s-${STALE_SUPER}`, new Date(Date.now() - 86_400_000).toISOString().slice(0, 19).replace('T', ' '));
  return db;
}

const app = new Hono<any>();
app.route('/api/admin/security/trust-center', adminTrustCenter);
app.route('/api/admin/security/reports', adminSecurityReports);
app.route('/api/help/security-reports', securityReports);
app.route('/api/public', trustPublic);

type Mail = { to: string; subject: string; text: string };
function decodeMail(body: string): Mail {
  const raw = JSON.parse(body).raw as string;
  const mime = decodeURIComponent(escape(atob(raw.replace(/-/g, '+').replace(/_/g, '/'))));
  const headers = mime.split('\r\n\r\n')[0];
  const part = /Content-Type: text\/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)\r\n\r\n/.exec(mime)?.[1] || '';
  const text = new TextDecoder().decode(Uint8Array.from(atob(part.replace(/\r\n/g, '')), (ch) => ch.charCodeAt(0)));
  return { to: /^To: (.*)$/m.exec(headers)?.[1] || '', subject: /^Subject: (.*)$/m.exec(headers)?.[1] || '', text };
}

function harness(db = fixture(), extra: Record<string, unknown> = {}) {
  const r2 = new Map<string, Uint8Array>();
  const FILES_BUCKET = {
    put: async (k: string, v: Uint8Array) => { r2.set(k, v); },
    get: async (k: string) => (r2.has(k) ? { body: r2.get(k) } : null),
  };
  const env: Record<string, unknown> = {
    JWT_SECRET, ENVIRONMENT: 'development', APP_URL: BASE, DB: d1Over(db), FILES: FILES_BUCKET,
    GMAIL_CLIENT_ID: 'id', GMAIL_CLIENT_SECRET: 'secret', GMAIL_REFRESH_TOKEN: 'refresh', ...extra,
  };
  const mails: Mail[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: { body?: unknown }) => {
    const url = String(input);
    if (url.startsWith('https://oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'at' }), { status: 200 });
    if (url.startsWith('https://gmail.googleapis.com/')) { mails.push(decodeMail(String(init?.body))); return new Response('{}', { status: 200 }); }
    return new Response('unexpected', { status: 599 });
  }) as unknown as typeof fetch;

  async function call(who: number | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const auth: Record<string, string> = {};
    if (who !== null) {
      const token = await new SignJWT({ user_id: who, jti: `s-${who}` }).setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
      auth.Authorization = `Bearer ${token}`;
    }
    const saved = [console.warn, console.error, console.info]; console.warn = () => {}; console.error = () => {}; console.info = () => {};
    try {
      const isBytes = body instanceof Uint8Array;
      const res = await withThrownResponses(() => app.request(path, {
        method,
        headers: { ...auth, 'Content-Type': isBytes ? 'application/pdf' : 'application/json', Accept: 'application/json', ...headers },
        ...(body === undefined ? {} : { body: isBytes ? body : JSON.stringify(body) }),
      }, env));
      const text = await res.text();
      let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
      return { status: res.status, body: json, text };
    } finally { [console.warn, console.error, console.info] = saved; }
  }
  return { db, env, mails, call, r2, restore: () => { globalThis.fetch = realFetch; } };
}

const TC = '/api/admin/security/trust-center';
const lines = (text: string) => ({ intro: null, groups: [{ title: 'Signing in', lines: [{ text, recorded: true, checked_at: today() }] }] });
const audits = (db: DatabaseSync) => (db.prepare(`SELECT action FROM admin_audit_log ORDER BY id`).all() as any[]).map((r) => r.action as string);

// ---------------------------------------------------------------- the store's own rules

test('the change log is append-only, and a published block cannot exist without its note', () => {
  const db = fixture();
  db.prepare(`INSERT INTO trust_content_changes (uid, change_note) VALUES ('tcc_1', ?)`).run(NOTE);
  assert.throws(() => db.exec(`UPDATE trust_content_changes SET change_note = 'rewritten history here'`), /append-only/);
  assert.throws(() => db.exec(`DELETE FROM trust_content_changes`), /append-only/);
  assert.throws(() => db.prepare(
    `INSERT INTO trust_content_blocks (key, state, body_json, published_at, change_uid) VALUES ('security', 'published', '{}', datetime('now'), 'tcc_1')`,
  ).run(), /CHECK/);
  assert.throws(() => db.prepare(
    `INSERT INTO trust_content_blocks (key, state, body_json, published_at, change_uid, change_note) VALUES ('security', 'published', '{}', datetime('now'), 'tcc_1', 'short')`,
  ).run(), /CHECK/);
  assert.throws(() => db.prepare(`INSERT INTO trust_content_blocks (key, state, body_json) VALUES ('pricing', 'draft', '{}')`).run(), /CHECK/);
});

// ---------------------------------------------------------------- drafts, publish, the public read

test('a draft is never served publicly; Publish serves it with its checked date and logs the change', async () => {
  const h = harness();
  try {
    const saved = await h.call(SUPER, 'PUT', `${TC}/blocks/security`, { body: lines('Passkeys.'), checked_at: today() });
    assert.equal(saved.status, 200, saved.text);

    let pub = await h.call(null, 'GET', '/api/public/trust');
    assert.equal(pub.status, 200);
    assert.equal(pub.body.blocks.security, null, 'a draft is not public');
    for (const k of BLOCK_KEYS) assert.ok(k in pub.body.blocks, k);
    assert.deepEqual(pub.body.changes.items, []);

    const done = await h.call(SUPER, 'POST', `${TC}/publish`, { note: NOTE });
    assert.equal(done.status, 200, done.text);
    assert.deepEqual(done.body.blocks, ['security']);

    pub = await h.call(null, 'GET', '/api/public/trust');
    assert.equal(pub.body.blocks.security.label, 'Security');
    assert.equal(pub.body.blocks.security.body.groups[0].lines[0].text, 'Passkeys.');
    assert.equal(pub.body.blocks.security.checked_at, today());
    assert.equal(pub.body.changes.items[0].note, NOTE);
    assert.deepEqual(pub.body.changes.items[0].blocks, [{ key: 'security', label: 'Security' }]);
    assert.equal(h.db.prepare(`SELECT COUNT(*) AS n FROM trust_content_blocks WHERE state = 'draft'`).get()!.n, 0, 'the draft is consumed');

    // A new draft leaves the published copy in place until the next Publish.
    await h.call(SUPER, 'PUT', `${TC}/blocks/security`, { body: lines('Passkeys and SMS codes.') });
    pub = await h.call(null, 'GET', '/api/public/trust');
    assert.equal(pub.body.blocks.security.body.groups[0].lines[0].text, 'Passkeys.');

    const log = await h.call(null, 'GET', '/api/public/trust/changes?limit=5');
    assert.equal(log.body.items.length, 1);
    assert.equal(log.body.complete, true);
  } finally { h.restore(); }
});

test('Publish without a note, with a short one, or with nothing drafted is refused', async () => {
  const h = harness();
  try {
    assert.equal((await h.call(SUPER, 'POST', `${TC}/publish`, { note: NOTE })).body.code, 'nothing_to_publish');
    await h.call(SUPER, 'PUT', `${TC}/blocks/data`, { body: lines('No third-party analytics.') });
    for (const note of [undefined, '', 'too short', 'x'.repeat(1001)]) {
      const r = await h.call(SUPER, 'POST', `${TC}/publish`, { note });
      assert.equal(r.status, 400, String(note));
      assert.equal(r.body.code, 'note_required');
    }
    assert.equal((await h.call(null, 'GET', '/api/public/trust')).body.blocks.data, null);
  } finally { h.restore(); }
});

test('a block is checked: a gap says why, no future checked date, no unknown block or field', async () => {
  const h = harness();
  try {
    const put = (key: string, body: unknown, checked_at?: unknown) => h.call(SUPER, 'PUT', `${TC}/blocks/${key}`, { body, checked_at });
    assert.equal((await put('pricing', lines('x'))).status, 404);
    assert.equal((await put('security', { groups: [{ title: null, lines: [{ text: 'Penetration test', recorded: false }] }] })).body.code, 'why_required');
    assert.equal((await put('security', lines('x'), '2999-01-01')).body.code, 'bad_checked_at');
    assert.equal((await put('security', { groups: [], extra: 1 })).body.code, 'bad_body');
    assert.equal((await put('security', { groups: [{ title: null, lines: [{ text: '', recorded: true }] }] })).body.code, 'text_required');
    const gap = await put('security', { groups: [{ title: 'Testing', lines: [{ text: 'Penetration test', recorded: false, why: 'None is on record.' }] }] });
    assert.equal(gap.status, 200, gap.text);
  } finally { h.restore(); }
});

test('a certification cannot be saved without its auditor\'s report on file; visitors see "on file", never the uid', async () => {
  const h = harness();
  try {
    const cert = (report_uid?: string) => ({ items: [{ name: 'Example Standard', auditor: 'Example Audit LLP', issued_on: today(), report_uid }] });
    assert.equal((await h.call(SUPER, 'PUT', `${TC}/blocks/certifications`, { body: cert() })).body.code, 'report_required');
    assert.equal((await h.call(SUPER, 'PUT', `${TC}/blocks/certifications`, { body: cert('tcr_00000000000000000000') })).body.code, 'report_unknown');

    assert.equal((await h.call(SUPER, 'POST', `${TC}/reports`, new TextEncoder().encode('not a pdf'))).status, 415);
    const up = await h.call(SUPER, 'POST', `${TC}/reports`, PDF);
    assert.equal(up.status, 201, up.text);
    assert.ok(h.r2.has(`trust-center/reports/${up.body.uid}.pdf`));

    const ok = await h.call(SUPER, 'PUT', `${TC}/blocks/certifications`, { body: cert(up.body.uid) });
    assert.equal(ok.status, 200, ok.text);
    await h.call(SUPER, 'POST', `${TC}/publish`, { note: 'Certifications: Example Standard added.' });
    const item = (await h.call(null, 'GET', '/api/public/trust')).body.blocks.certifications.body.items[0];
    assert.equal(item.report_on_file, true);
    assert.equal('report_uid' in item, false);

    const back = await h.call(SUPER, 'GET', `${TC}/reports/${up.body.uid}`);
    assert.equal(back.status, 200);
    assert.ok(back.text.startsWith('%PDF-'));
  } finally { h.restore(); }
});

// ---------------------------------------------------------------- who may write, and the audit log

test('only a Super Admin reads or writes, a write needs a recent step-up, and every write is in the admin audit log', async () => {
  const h = harness();
  try {
    for (const who of [PLAIN_ADMIN, MEMBER]) {
      assert.equal((await h.call(who, 'GET', TC)).status, 403, `read ${who}`);
      assert.equal((await h.call(who, 'PUT', `${TC}/blocks/security`, { body: lines('x') })).status, 403, `write ${who}`);
      assert.equal((await h.call(who, 'POST', `${TC}/publish`, { note: NOTE })).status, 403, `publish ${who}`);
    }
    assert.equal((await h.call(null, 'GET', TC)).status, 401);
    const stale = await h.call(STALE_SUPER, 'PUT', `${TC}/blocks/security`, { body: lines('x') });
    assert.equal(stale.status, 403);
    assert.equal(stale.body.code ?? stale.body.error, 'step_up_required');
    assert.equal((await h.call(STALE_SUPER, 'GET', TC)).status, 200, 'a read needs the elevation, not a step-up');
    assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM trust_content_blocks').get()!.n, 0);

    await h.call(SUPER, 'PUT', `${TC}/blocks/security`, { body: lines('Passkeys.') });
    await h.call(SUPER, 'DELETE', `${TC}/blocks/security/draft`);
    await h.call(SUPER, 'PUT', `${TC}/blocks/security`, { body: lines('Passkeys.') });
    const sub = await h.call(SUPER, 'POST', `${TC}/subprocessors`, { name: 'Vendor F', purpose: 'Error monitoring', data: 'Error reports', location: 'United States' });
    await h.call(SUPER, 'PATCH', `${TC}/subprocessors/${sub.body.uid}`, { purpose: 'Error monitoring and alerts' });
    await h.call(SUPER, 'POST', `${TC}/reports`, PDF);
    await h.call(SUPER, 'POST', `${TC}/publish`, { note: NOTE });
    await h.call(SUPER, 'DELETE', `${TC}/subprocessors/${sub.body.uid}`);
    await h.call(SUPER, 'POST', `${TC}/subprocessors/${sub.body.uid}/keep`);
    assert.deepEqual(audits(h.db), [
      'trust_center.draft_saved', 'trust_center.draft_discarded', 'trust_center.draft_saved',
      'trust_center.subprocessor_drafted', 'trust_center.subprocessor_edited', 'trust_center.report_attached',
      'trust_center.published', 'trust_center.subprocessor_removal_drafted', 'trust_center.subprocessor_removal_cancelled',
    ]);
    const logged = (h.db.prepare('SELECT filters_json FROM admin_audit_log').all() as any[]).map((r) => r.filters_json).join(' ');
    assert.equal(logged.includes('Passkeys'), false, 'the page\'s words are not logged');
    assert.equal(logged.includes(NOTE), false, 'nor the note');
  } finally { h.restore(); }
});

// ---------------------------------------------------------------- subprocessors and their notices

test('a new subprocessor is a draft until Publish, then starts ten days later; removal waits for Publish too', async () => {
  const h = harness();
  try {
    const sub = await h.call(SUPER, 'POST', `${TC}/subprocessors`, { name: 'Vendor F', purpose: 'Error monitoring', data: 'Error reports, with no names', location: 'United States' });
    assert.equal(sub.status, 201, sub.text);
    assert.equal((await h.call(SUPER, 'POST', `${TC}/subprocessors`, { name: 'Vendor G' })).body.code, 'subprocessor_fields');
    assert.deepEqual((await h.call(null, 'GET', '/api/public/trust')).body.subprocessors.items, []);

    const done = await h.call(SUPER, 'POST', `${TC}/publish`, { note: 'Subprocessors: Vendor F added for error monitoring.' });
    const start = new Date(Date.parse(`${today()}T00:00:00Z`) + NOTICE_DAYS * 86_400_000).toISOString().slice(0, 10);
    assert.deepEqual(done.body.added, [{ uid: sub.body.uid, name: 'Vendor F', starts_at: start }]);
    let listed = (await h.call(null, 'GET', '/api/public/trust')).body.subprocessors;
    assert.equal(listed.items.length, 1);
    assert.equal(listed.items[0].starts_at, start);
    assert.equal(listed.items[0].active, false, 'not active until its start date');
    assert.deepEqual((await h.call(null, 'GET', '/api/public/trust')).body.changes.items[0].subprocessors,
      [{ action: 'added', uid: sub.body.uid, name: 'Vendor F', starts_at: start }]);
    assert.equal((await h.call(SUPER, 'PATCH', `${TC}/subprocessors/${sub.body.uid}`, { name: 'Renamed' })).body.code, 'not_draft');

    await h.call(SUPER, 'DELETE', `${TC}/subprocessors/${sub.body.uid}`);
    listed = (await h.call(null, 'GET', '/api/public/trust')).body.subprocessors;
    assert.equal(listed.items.length, 1, 'still listed until the removal is published');
    await h.call(SUPER, 'POST', `${TC}/publish`, { note: 'Subprocessors: Vendor F removed.' });
    assert.deepEqual((await h.call(null, 'GET', '/api/public/trust')).body.subprocessors.items, []);
  } finally { h.restore(); }
});

const linkIn = (text: string, path: string) => {
  const prefix = `${BASE}${path}?token=`;
  const at = text.indexOf(prefix);
  assert.ok(at >= 0, `no ${path} link in:\n${text}`);
  const rest = text.slice(at + prefix.length);
  const end = rest.search(/\s/);
  return decodeURIComponent(end < 0 ? rest : rest.slice(0, end));
};

test('subscribe needs a confirm; an unconfirmed address is never sent to; unsubscribe by token works once', async () => {
  const h = harness();
  try {
    const sub = (email: string) => h.call(null, 'POST', '/api/public/trust/subprocessors/subscribe', { email });
    assert.equal((await sub('not-an-address')).status, 400);
    const a = await sub('ana@example.test');
    assert.equal(a.status, 200);
    assert.equal(a.body.ok, true);
    await sub('bo@example.test');
    assert.equal(h.mails.length, 2);
    const row = h.db.prepare(`SELECT email_enc, email_hash, status FROM subprocessor_subscribers ORDER BY id LIMIT 1`).get() as any;
    assert.equal(row.status, 'pending');
    assert.equal(String(row.email_enc).includes('ana@'), false, 'the address is stored encrypted');

    const token = linkIn(h.mails[0].text, '/api/public/trust/subprocessors/confirm');
    assert.equal((await h.call(null, 'GET', `/api/public/trust/subprocessors/confirm?token=${encodeURIComponent(token)}`)).body.status, 'pending', 'a GET confirms nothing');
    assert.equal(h.db.prepare(`SELECT COUNT(*) AS n FROM subprocessor_subscribers WHERE status = 'confirmed'`).get()!.n, 0);
    assert.equal((await h.call(null, 'POST', `/api/public/trust/subprocessors/confirm?token=${encodeURIComponent(token)}`)).body.status, 'confirmed');
    assert.equal((await h.call(null, 'POST', `/api/public/trust/subprocessors/confirm?token=${encodeURIComponent(token)}`)).status, 410, 'the confirm link works once');

    // A confirmed address that subscribes again gets the same answer and no email.
    const before = h.mails.length;
    assert.equal((await sub('ana@example.test')).body.ok, true);
    assert.equal(h.mails.length, before);

    await h.call(SUPER, 'POST', `${TC}/subprocessors`, { name: 'Vendor F', purpose: 'Error monitoring', data: 'Error reports', location: 'United States' });
    h.mails.length = 0;
    await h.call(SUPER, 'POST', `${TC}/publish`, { note: 'Subprocessors: Vendor F added for error monitoring.' });
    assert.equal(h.mails.length, 1, 'one notice: the confirmed address only');
    assert.equal(h.mails[0].to, 'ana@example.test');
    assert.ok(h.mails[0].text.includes('Vendor F'));
    assert.equal(h.mails.some((m) => m.to === 'bo@example.test'), false, 'the pending address is never sent to');

    const again = await sendSubprocessorNotices(h.env as any);
    assert.equal(again.sent, 0, 'each subscriber is told once');

    const off = linkIn(h.mails[0].text, '/api/public/trust/subprocessors/unsubscribe');
    assert.equal((await h.call(null, 'POST', `/api/public/trust/subprocessors/unsubscribe?token=${encodeURIComponent(off)}`)).body.status, 'unsubscribed');
    assert.equal((await h.call(null, 'POST', `/api/public/trust/subprocessors/unsubscribe?token=${encodeURIComponent(off)}`)).status, 410, 'works once');
    assert.equal((await h.call(null, 'POST', `/api/public/trust/subprocessors/unsubscribe?token=${encodeURIComponent(off.slice(0, -1) + (off.endsWith('0') ? '1' : '0'))}`)).status, 410);

    await h.call(SUPER, 'POST', `${TC}/subprocessors`, { name: 'Vendor G', purpose: 'Support routing', data: 'Tickets', location: 'United States' });
    h.mails.length = 0;
    await h.call(SUPER, 'POST', `${TC}/publish`, { note: 'Subprocessors: Vendor G added for support.' });
    assert.equal(h.mails.length, 0, 'an unsubscribed address is never sent to');
  } finally { h.restore(); }
});

test('without mail credentials no notice is claimed, so it goes once they are set', async () => {
  const h = harness(fixture(), { GMAIL_CLIENT_ID: '' });
  try {
    h.db.prepare(`INSERT INTO subprocessor_subscribers (uid, email_hash, email_enc, status, confirmed_at) VALUES ('sps_00000000000000000001', 'h1', 'v1.x', 'confirmed', datetime('now'))`).run();
    await h.call(SUPER, 'POST', `${TC}/subprocessors`, { name: 'Vendor F', purpose: 'Error monitoring', data: 'Error reports', location: 'United States' });
    await h.call(SUPER, 'POST', `${TC}/publish`, { note: 'Subprocessors: Vendor F added for error monitoring.' });
    assert.equal((await sendSubprocessorNotices(h.env as any)).unconfigured, true);
    assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM subprocessor_notice_deliveries').get()!.n, 0);
  } finally { h.restore(); }
});

// ---------------------------------------------------------------- one failed part never blanks the page

test('a part that cannot be read says so, and the rest of the read still answers', async () => {
  const h = harness();
  try {
    await h.call(SUPER, 'PUT', `${TC}/blocks/glance`, { body: lines('Facts we can show.') });
    await h.call(SUPER, 'POST', `${TC}/publish`, { note: 'At a glance: first published.' });
    h.db.exec('DROP TABLE subprocessor_notice_deliveries; DROP TABLE trust_subprocessors');
    const r = await h.call(null, 'GET', '/api/public/trust');
    assert.equal(r.status, 200);
    assert.equal(r.body.subprocessors.unreadable, true);
    assert.equal(r.body.blocks.glance.body.groups[0].lines[0].text, 'Facts we can show.');
    assert.equal(r.body.changes.items.length, 1);
  } finally { h.restore(); }
});

// ---------------------------------------------------------------- the public matrix

test('the public matrix: every profile including Explorer, from the obligations the Worker seeds, no session', async () => {
  const h = harness();
  try {
    const r = await h.call(null, 'GET', '/api/public/trust/matrix');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.profiles.map((p: any) => p.key), ['founder', 'investor', 'advisor', 'partner', 'exploring']);
    const row = (k: string) => r.body.rows.find((x: any) => x.key === k);
    assert.deepEqual(row('role_nda').cells.founder, { asked: 'always', renews_months: 24 });
    assert.equal(row('role_nda').cells.partner, null);
    assert.deepEqual(row('identity').cells.investor, { asked: 'always', renews_months: 24 });
    assert.deepEqual(row('accreditation').cells.investor, { asked: 'always', renews_months: 12 });
    assert.deepEqual(row('entity').cells.investor, { asked: 'when_it_applies', renews_months: 24 });
    assert.deepEqual(row('tos').cells.exploring, { asked: 'always', renews_months: null });
    assert.equal(row('partner_agreement'), undefined, 'a requirement asked of nobody is left out');
  } finally { h.restore(); }
  // Every obligation any profile is asked has a named requirement: no row falls back to a bare key.
  const named = new Set(MATRIX_REQUIREMENTS.flatMap((x) => x.obligations as readonly string[]));
  for (const p of MATRIX_PROFILES) for (const d of obligationsForRole(p.key)) assert.ok(named.has(d.key), `${p.key}: ${d.key}`);
  assert.equal(publicMatrix().rows.every((x) => MATRIX_REQUIREMENTS.some((m) => m.key === x.key)), true);
});

// ---------------------------------------------------------------- Help's Security category

test('a security report is HQ\'s only: encrypted, read by Super Admins and its sender, never by a plain admin', async () => {
  const h = harness();
  try {
    const WHAT = 'The export link answered without a session.';
    const sent = await h.call(MEMBER, 'POST', '/api/help/security-reports', { affected: 'Account › Export', what_happened: WHAT, how_to_reproduce: 'Open the link signed out.' });
    assert.equal(sent.status, 201, sent.text);
    const raw = h.db.prepare('SELECT what_enc, how_enc FROM security_reports').get() as any;
    assert.equal(String(raw.what_enc).includes('export'), false, 'what happened is stored encrypted');
    assert.equal(String(raw.how_enc).includes('signed out'), false);

    const mine = await h.call(MEMBER, 'GET', '/api/help/security-reports/mine');
    assert.equal(mine.body.items[0].what_happened, WHAT);
    assert.deepEqual((await h.call(OTHER_MEMBER, 'GET', '/api/help/security-reports/mine')).body.items, [], 'another member sees none');

    assert.equal((await h.call(PLAIN_ADMIN, 'GET', '/api/admin/security/reports')).status, 403);
    const list = await h.call(SUPER, 'GET', '/api/admin/security/reports');
    assert.equal(list.status, 200);
    assert.equal(list.body.items[0].what_happened, WHAT);
    assert.equal(list.body.items[0].reporter.user_id, MEMBER);

    const bells = h.db.prepare(`SELECT user_id, title, body FROM notifications WHERE kind = 'security_report' ORDER BY user_id`).all() as any[];
    assert.deepEqual(bells.map((b) => b.user_id), [SUPER, STALE_SUPER]);
    assert.equal(bells.some((b) => `${b.title} ${b.body}`.includes('export')), false, 'the bell carries no words from the report');

    assert.equal((await h.call(PLAIN_ADMIN, 'PATCH', `/api/admin/security/reports/${sent.body.uid}`, { status: 'resolved' })).status, 403);
    const moved = await h.call(SUPER, 'PATCH', `/api/admin/security/reports/${sent.body.uid}`, { status: 'acknowledged' });
    assert.equal(moved.status, 200, moved.text);
    assert.ok((h.db.prepare('SELECT acknowledged_at FROM security_reports').get() as any).acknowledged_at);
    assert.deepEqual(audits(h.db), ['security_report.status_changed']);
  } finally { h.restore(); }
});

test('a security report is refused on a branch, past five a day, and as a ticket category', async () => {
  const branch = harness(fixture(), { BRANCH_CODE: 'lisbon' });
  try {
    const r = await branch.call(MEMBER, 'POST', '/api/help/security-reports', { affected: 'x', what_happened: 'y' });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'hq_only');
  } finally { branch.restore(); }

  const h = harness();
  try {
    for (let i = 0; i < REPORTS_PER_DAY; i++) {
      assert.equal((await h.call(MEMBER, 'POST', '/api/help/security-reports', { affected: 'Sign in', what_happened: `Report ${i}` })).status, 201);
    }
    assert.equal((await h.call(MEMBER, 'POST', '/api/help/security-reports', { affected: 'Sign in', what_happened: 'One more' })).status, 429);
    assert.equal((await h.call(MEMBER, 'POST', '/api/help/security-reports', { affected: '', what_happened: 'y' })).status, 400);
  } finally { h.restore(); }

  const asTicket = parseTicketCategory('security');
  assert.equal(asTicket.ok, false, 'the ticket route cannot file a security report');
  assert.ok(!asTicket.ok && asTicket.error.includes(SECURITY_CATEGORY.route));
  assert.equal(TICKET_CATEGORIES.some((c) => c.id === 'security'), false);
});
