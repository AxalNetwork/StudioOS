/**
 * D1127 (#3007) — Partner profiles gaps on the Worker, through the real
 * `admin_partner_profiles.ts` routes on `node:sqlite` (the baseline's tables,
 * then migrations 275, 556 and 557 from their files).
 *
 *   1. An Explorer's account carries the Exploring board's binding agreement:
 *      not sent, sent with its day, or signed. Any other account has none.
 *   2. The list's options name the admins who gave a current verdict, for the
 *      Reviewed by filter.
 *   3. GET /export: the list's filters, or the chosen references, as a CSV of
 *      what the page draws: never the tax ID, a formula neutralised, logged by
 *      count and never by address; refused past its limits, and never handed
 *      out unlogged.
 *
 * Every person and line is synthetic.
 *
 * Run: node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *        --test cloudflare-worker/test/partner_profiles_export_d1127.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';
import { Hono } from 'hono';

import partnerProfiles from '../src/routes/admin_partner_profiles.ts';
import { EXPORT_HEADER, EXPORT_MAX, exportCell } from '../src/services/partnerProfiles.ts';
import { tableFromBaseline } from './_baseline.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ADMIN = 900, EXPLORER = 901, SENT = 902, SIGNED = 903, INVESTOR = 904, MEMBER = 905;
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const MIGRATIONS = ['275_partner_profiles_columns.sql', '556_partner_profiles_ref.sql', '557_partner_profile_review.sql']
  .map((f) => read(`cloudflare-worker/sql/migrations/${f}`));

function makeD1(db: InstanceType<typeof DatabaseSync>) {
  const stmt = (sql: string) => {
    let b: any[] = [];
    const api: any = {
      bind: (...x: any[]) => { b = x.map((v) => (v === undefined ? null : v)); return api; },
      async first() { return db.prepare(sql).get(...b) ?? null; },
      async all() { return { results: db.prepare(sql).all(...b) }; },
      async run() {
        const r = db.prepare(sql).run(...b);
        return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
      },
    };
    return api;
  };
  return { prepare: stmt, async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; } };
}

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'partner_profiles', 'user_role_review', 'activity_logs', 'esign_envelopes', 'esign_recipients', 'esign_audit_events']) db.exec(tableFromBaseline(BASELINE, t));
  db.exec(MIGRATIONS[0]);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, kyc_status) VALUES (?, ?, ?, ?, 1, ?)');
  u.run(ADMIN, 'admin', 'Ada Admin', 'ada@example.test', 'approved');
  u.run(EXPLORER, 'exploring', 'Eve Explorer', 'eve@example.test', 'pending');
  u.run(SENT, 'exploring', 'Sam Sent', 'sam@example.test', 'pending');
  u.run(SIGNED, 'exploring', 'Sia Signed', 'sia@example.test', 'pending');
  u.run(INVESTOR, 'investor', 'Ivo Investor', 'ivo@example.test', 'approved');
  u.run(MEMBER, 'founder', 'Mo Member', 'mo@example.test', 'approved');
  // The Exploring board's binding agreements: none for Eve; sent to Sam; signed by Sia.
  const env = db.prepare("INSERT INTO esign_envelopes (id, envelope_uuid, document_type, document_title, document_body, body_sha256, created_by, user_id, status, created_at, completed_at) VALUES (?, ?, 'binding_agreement', 'Synthetic binding agreement', 'Synthetic text.', 'synthetic', 900, ?, ?, ?, ?)");
  env.run(71, 'env-sent', SENT, 'sent', '2026-10-02 09:00:00', null);
  env.run(72, 'env-signed', SIGNED, 'completed', '2026-10-01 09:00:00', '2026-10-04 10:00:00');
  const rr = db.prepare('INSERT INTO user_role_review (user_id, suggested_role, role_confirmed, binding_envelope_id, binding_sent_at) VALUES (?, ?, 0, ?, ?)');
  rr.run(EXPLORER, 'founder', null, null);
  rr.run(SENT, 'investor', 71, '2026-10-02 09:00:00');
  rr.run(SIGNED, 'advisor', 72, '2026-10-01 09:00:00');
  const p = (cols: Record<string, unknown>) => {
    const keys = Object.keys(cols);
    db.prepare(`INSERT INTO partner_profiles (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...(Object.values(cols) as any[]));
  };
  const chat = '[{"role":"user","content":"hi"}]';
  p({ email: 'eve@example.test', user_id: EXPLORER, chat_history: chat, persona: 'Founder', admin_status: 'pending', created_at: '2026-10-20 08:00:00' });
  p({ email: 'sam@example.test', user_id: SENT, chat_history: chat, persona: 'Investor — LP', admin_status: 'pending', created_at: '2026-10-21 08:00:00' });
  p({ email: 'sia@example.test', user_id: SIGNED, chat_history: chat, persona: 'Advisor', admin_status: 'pending', created_at: '2026-10-22 08:00:00' });
  // A verified investor with a tax ID, and a name a spreadsheet would run as a formula.
  p({ email: 'ivo@example.test', user_id: INVESTOR, chat_history: chat, persona: 'Investor — LP', 
    legal_entity_name: '@Ivo Holdings', ein: '12-3456789', admin_status: 'verified', created_at: '2026-09-30 08:00:00' });
  p({ email: 'rex@example.test', chat_history: chat, persona: 'Advisor', full_name: '=HYPERLINK("http://x.invalid","click")', admin_status: 'rejected', created_at: '2026-10-09 08:00:00' });
  db.exec(MIGRATIONS[1]);
  db.exec(MIGRATIONS[2]);
  db.prepare("UPDATE partner_profiles SET reviewed_by = ?, reviewed_at = '2026-10-03 12:00:00' WHERE email = 'ivo@example.test'").run(ADMIN);
  return { db, env: { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) } as any };
}

async function token(who: number, role: string) {
  return new SignJWT({ user_id: who, role }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

const APP = new Hono<any>().route('/', partnerProfiles);
APP.onError((err: any, c: any) => {
  const m = String(err?.message || '');
  return c.json({ error: m }, m === 'Unauthorized' ? 401 : m === 'Admin required' ? 403 : 500);
});

async function call(f: any, path: string, who: [number, string] = [ADMIN, 'admin']) {
  const res = await APP.fetch(new Request(`http://x${path}`, { headers: { Authorization: `Bearer ${await token(...who)}` } }), f.env);
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { /* a CSV */ }
  return { status: res.status, text, body, headers: res.headers };
}

/** A CSV body as rows of cells (quoted cells unquoted). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; } else if (ch === '"') q = false; else cell += ch; continue; }
    if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\r') continue;
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  row.push(cell); rows.push(row);
  return rows;
}
const byEmail = (rows: string[][]) => new Map(rows.slice(1).map((r) => [r[EXPORT_HEADER.indexOf('Email')], r]));
const col = (name: (typeof EXPORT_HEADER)[number]) => EXPORT_HEADER.indexOf(name);
const refOf = (f: any, email: string) => (f.db.prepare('SELECT ref FROM partner_profiles WHERE email = ?').get(email) as any).ref;
const quiet = async <T>(fn: () => Promise<T>) => { const s = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = s; } };

test('an Explorer\'s account carries the Exploring board\'s binding agreement: not sent, sent with its day, or signed', async () => {
  const f = fixture();
  const r = await call(f, '/?status=pending&sort=newest');
  assert.equal(r.status, 200);
  const acc = new Map(r.body.rows.map((x: any) => [x.email, x.account]));
  assert.deepEqual((acc.get('eve@example.test') as any).binding, { state: 'not_sent', sent_at: null, signed_at: null });
  assert.deepEqual((acc.get('sam@example.test') as any).binding, { state: 'sent', sent_at: '2026-10-02 09:00:00', signed_at: null });
  assert.deepEqual((acc.get('sia@example.test') as any).binding, { state: 'signed', sent_at: '2026-10-01 09:00:00', signed_at: '2026-10-04 10:00:00' });
  const all = await call(f, '/?sort=newest');
  const ivo = all.body.rows.find((x: any) => x.email === 'ivo@example.test');
  assert.equal(ivo.account.binding, null, 'an account that is not exploring has no binding agreement to show');
  assert.equal(all.body.rows.find((x: any) => x.email === 'rex@example.test').account, null);
  assert.equal(all.body.rows.length, 5, 'the binding join adds no rows');
});

test('the list\'s options name the admins who gave a current verdict, for the Reviewed by filter', async () => {
  const f = fixture();
  const r = await call(f, '/');
  assert.deepEqual(r.body.options.reviewed_by, [{ id: ADMIN, name: 'Ada Admin' }]);
  const filtered = await call(f, `/?reviewed_by=${ADMIN}`);
  assert.deepEqual(filtered.body.rows.map((x: any) => x.email), ['ivo@example.test']);
});

test('the export is the view as a CSV: the list\'s filters and sort, what the page draws, never the tax ID', async () => {
  const f = fixture();
  const r = await call(f, '/export?status=pending&sort=newest');
  assert.equal(r.status, 200);
  assert.match(String(r.headers.get('Content-Type')), /^text\/csv/);
  assert.match(String(r.headers.get('Content-Disposition')), /attachment; filename="partner-profiles-\d{4}-\d{2}-\d{2}\.csv"/);
  assert.equal(r.headers.get('X-Export-Rows'), '3');
  const rows = parseCsv(r.text);
  assert.deepEqual(rows[0], [...EXPORT_HEADER]);
  assert.deepEqual(rows.slice(1).map((x) => x[col('Email')]), ['sia@example.test', 'sam@example.test', 'eve@example.test'], 'the filter and the sort');
  const m = byEmail(rows);
  assert.equal(m.get('sam@example.test')![col('Status')], 'Waiting');
  assert.equal(m.get('sam@example.test')![col('Source')], 'Onboarding chat');
  assert.equal(m.get('sam@example.test')![col('Account')], 'exploring');
  assert.equal(m.get('sam@example.test')![col('Binding agreement')], 'Sent');
  assert.equal(m.get('sia@example.test')![col('Binding agreement')], 'Signed');
  assert.equal(m.get('eve@example.test')![col('Binding agreement')], 'Not sent');
  assert.equal(m.get('eve@example.test')![col('Reviewed at')], '', 'unknown is an empty cell, never a zero');

  const everyone = await call(f, '/export?sort=newest');
  assert.ok(!everyone.text.includes('12-3456789'), 'the tax ID is never exported');
  const ivo = byEmail(parseCsv(everyone.text)).get('ivo@example.test')!;
  assert.equal(ivo[col('Name')], 'Ivo Investor', 'the account\'s name, as the page draws it');
  assert.equal(ivo[col('Entity')], '\'@Ivo Holdings');
  assert.equal(ivo[col('Reviewed by')], 'Ada Admin');
  assert.equal(ivo[col('Reviewed at')], '2026-10-03 12:00:00');
  assert.equal(ivo[col('Binding agreement')], '', 'not an Explorer');
  const rex = byEmail(parseCsv(everyone.text)).get('rex@example.test')!;
  assert.equal(rex[col('Account')], 'No account yet');
  assert.equal(rex[col('Name')], '\'=HYPERLINK("http://x.invalid","click")', 'a formula is neutralised');
});

test('the export of chosen profiles holds only those, within the filters', async () => {
  const f = fixture();
  const refs = [refOf(f, 'eve@example.test'), refOf(f, 'ivo@example.test')];
  const r = await call(f, `/export?refs=${refs.join(',')}`);
  assert.equal(r.status, 200);
  assert.deepEqual(parseCsv(r.text).slice(1).map((x) => x[col('Reference')]).sort(), [...refs].sort());
  const within = await call(f, `/export?status=pending&refs=${refs.join(',')}`);
  assert.deepEqual(parseCsv(within.text).slice(1).map((x) => x[col('Email')]), ['eve@example.test']);
});

test('each export is logged by count, never by address; nothing unlogged is handed out', async () => {
  const f = fixture();
  await call(f, '/export?status=pending');
  const log = f.db.prepare("SELECT action, details, user_id FROM activity_logs WHERE action = 'partner_profile_export'").all() as any[];
  assert.equal(log.length, 1);
  assert.equal(log[0].details, 'Partner profile export rows=3 chosen=0');
  assert.equal(log[0].user_id, ADMIN);
  assert.ok(!/@/.test(log[0].details));
  f.db.exec('DROP TABLE activity_logs');
  const r = await quiet(() => call(f, '/export'));
  assert.equal(r.status, 503);
  assert.equal(r.body.error, 'export_not_logged');
  assert.ok(!r.text.includes('example.test'), 'no profile leaves when the export could not be recorded');
});

test('the export refuses what it cannot do whole: too many profiles, too many or unknown references, a member', async () => {
  const f = fixture();
  const ins = f.db.prepare("INSERT INTO partner_profiles (email, chat_history, persona, admin_status) VALUES (?, '[1]', 'Advisor', 'pending')");
  for (let i = 0; i < EXPORT_MAX; i += 1) ins.run(`bulk${i}@example.test`);
  const big = await call(f, '/export');
  assert.equal(big.status, 413);
  assert.equal(big.body.error, 'export_too_large');
  assert.match(big.body.message, /5,005 profiles/);
  const narrowed = await call(f, '/export?status=verified');
  assert.equal(narrowed.status, 200, 'a narrowed view exports');
  const many = await call(f, `/export?refs=${Array.from({ length: 101 }, (_, i) => `pp_${String(i).padStart(10, '0')}`).join(',')}`);
  assert.equal(many.status, 400);
  assert.equal(many.body.error, 'too_many_refs');
  const bad = await call(f, '/export?refs=ivo@example.test');
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'bad_ref');
  const member = await call(f, '/export', [MEMBER, 'founder']);
  assert.equal(member.status, 403);
});

test('a cell starting like a formula is read as text; a number stays a number', () => {
  assert.equal(exportCell('=1+1'), '\'=1+1');
  assert.equal(exportCell('+44 20'), '\'+44 20');
  assert.equal(exportCell('-12'), '-12');
  assert.equal(exportCell('Acme'), 'Acme');
  assert.equal(exportCell(null), null);
  assert.equal(exportCell(''), null);
});
