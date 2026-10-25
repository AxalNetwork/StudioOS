/**
 * D993 (#2804) — Partner profiles part 4, through the real
 * `admin_partner_profiles.ts` routes on `node:sqlite` (the baseline's tables,
 * then migrations 275 and 556 from their files).
 *
 *   1. The first-agreement options: the review's fifteen values, unchanged, in
 *      the five groups, each Ready only when the send's own resolver finds text.
 *   2. Each profile's envelope state, on the list and the record: out for
 *      signature since, not delivered, signed, declined; the newest envelope of
 *      the profile's agreement, addressed to its account or its email.
 *   3. The counts fill "envelopes out" from the same join.
 *   4. Unbind: Super Admin with a TOTP session and a recent step-up, a reason,
 *      logged in Governance by reference; only a profile whose address now
 *      belongs to another account (or none) is freed.
 *   5. Refusals: no session 401, a member 403, a D1 error 503.
 *
 * Every person and line is synthetic.
 *
 * Run: node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *        --test cloudflare-worker/test/partner_profiles_agreements_d993.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';
import { Hono } from 'hono';

import partnerProfiles from '../src/routes/admin_partner_profiles.ts';
import { AGREEMENT_GROUPS, NOT_READY } from '../src/services/partnerAgreements.ts';
import { AUTH_ERROR_STATUSES, STEP_UP_REQUIRED } from '../src/util/authErrors.ts';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { makeD1 } from './_d1_sqlite.mjs';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const SCHEMA = ['users', 'super_admins', 'user_sessions', 'activity_logs', 'admin_audit_log', 'partner_profiles', 'user_role_review',
  'esign_envelopes', 'esign_recipients', 'esign_audit_events', 'legal_templates']
  .map((t) => stripForeignKeys(tableFromBaseline(BASELINE, t))).join('\n')
  + '\n' + read('cloudflare-worker/sql/migrations/275_partner_profiles_columns.sql')
  + '\n' + read('cloudflare-worker/sql/migrations/556_partner_profiles_ref.sql')
  // D991: the list reads 557's review columns.
  + '\n' + read('cloudflare-worker/sql/migrations/557_partner_profile_review.sql');
const SECRET = ['d993', 'agreements', 'fixture', 'signing', 'secret'].join('-');

const SUPER = 1, SUPER_PW = 2, SUPER_STALE = 3, ADMIN = 4, MEMBER = 5;
const CHATTER = 10, PARTNER = 11, VERIFIED = 12, OLD = 13, NEW = 14, DECLINER = 15;
const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString().slice(0, 19).replace('T', ' ');

function fixture() {
  const { DB, db } = makeD1(SCHEMA);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  for (const [id, role, email] of [[SUPER, 'admin', 'super@example.test'], [SUPER_PW, 'admin', 'superpw@example.test'],
    [SUPER_STALE, 'admin', 'stale@example.test'], [ADMIN, 'admin', 'admin@example.test'], [MEMBER, 'partner', 'member@example.test'],
    [CHATTER, 'exploring', 'chat@example.test'], [PARTNER, 'partner', 'eadwyn@example.test'], [VERIFIED, 'investor', 'done@example.test'],
    // OLD once held moved@ and changed address; NEW holds it now.
    [OLD, 'partner', 'old-new@example.test'], [NEW, 'partner', 'moved@example.test'], [DECLINER, 'partner', 'no@example.test'],
  ] as const) u.run(id, role, `Person ${id}`, email);
  db.exec(`INSERT INTO super_admins (user_id) VALUES (${SUPER}), (${SUPER_PW}), (${SUPER_STALE})`);
  const s = db.prepare('INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES (?, ?, ?, ?)');
  s.run(SUPER, 'totp-super', 'totp', ago(0));
  s.run(SUPER_PW, 'pw-super', 'password', ago(0));
  s.run(SUPER_STALE, 'stale-super', 'totp', ago(2));
  for (const id of [ADMIN, MEMBER]) s.run(id, `totp-${id}`, 'totp', ago(0));

  const p = (cols: Record<string, unknown>) => {
    const keys = Object.keys(cols);
    db.prepare(`INSERT INTO partner_profiles (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...(Object.values(cols) as any[]));
  };
  p({ email: 'chat@example.test', user_id: CHATTER, persona: 'Founder', chat_history: '[{"role":"user"}]', agreement_type: 'Founder Collaboration Agreement', admin_status: 'verified', created_at: ago(200) });
  p({ email: 'eadwyn@example.test', user_id: PARTNER, services_offered: 'Legal', agreement_type: 'SPV Joinder Agreement', admin_status: 'verified', created_at: ago(150) });
  p({ email: 'done@example.test', persona: 'Investor — LP', chat_history: '[{"role":"user"}]', agreement_type: 'Subscription Booklet & LPA', admin_status: 'verified', created_at: ago(300) });
  p({ email: 'inv@example.test', invitation_id: 7, organization: 'Invited Co', agreement_type: 'Co-Investment Side Letter', admin_status: 'verified', created_at: ago(100) });
  p({ email: 'no@example.test', user_id: DECLINER, persona: 'Advisor', agreement_type: 'Venture Share Agreement (FAST)', admin_status: 'verified', created_at: ago(90) });
  p({ email: 'none@example.test', persona: 'Advisor', admin_status: 'pending', created_at: ago(80) });
  // Bound to OLD, whose address is now another; NEW holds it.
  p({ email: 'moved@example.test', user_id: OLD, persona: 'Operating Partner', admin_status: 'pending', created_at: ago(70) });

  const e = db.prepare(`INSERT INTO esign_envelopes (id, envelope_uuid, user_id, document_type, document_title, document_body, body_sha256, status, created_by, created_at, completed_at)
    VALUES (?, ?, ?, ?, 'T', 'B', 'h', ?, ?, ?, ?)`);
  const rcp = db.prepare("INSERT INTO esign_recipients (envelope_id, recipient_email, signing_token, token_expires_at, status) VALUES (?, ?, ?, '2099-01-01', 'pending')");
  const mail = db.prepare("INSERT INTO esign_audit_events (envelope_id, ts, action, ip) VALUES (?, ?, ?, 'system')");
  // chat@: an older signed one, then the newest out for signature (mail sent).
  e.run(1, 'u1', CHATTER, 'Founder Collaboration Agreement', 'completed', SUPER, ago(190), ago(185));
  e.run(2, 'u2', CHATTER, 'Founder Collaboration Agreement', 'sent', SUPER, ago(72), null); mail.run(2, ago(72), 'email_sent');
  // A newer one of the same type to somebody else: not chat@'s.
  e.run(3, 'u3', MEMBER, 'Founder Collaboration Agreement', 'sent', SUPER, ago(1), null); rcp.run(3, 'member@example.test', 't3');
  // eadwyn@: sent, then the mail failed on a resend.
  e.run(4, 'u4', PARTNER, 'SPV Joinder Agreement', 'partially_signed', SUPER, ago(48), null);
  mail.run(4, ago(48), 'email_sent'); mail.run(4, ago(24), 'email_failed');
  // done@ has no account: matched by the recipient's address, any case.
  e.run(5, 'u5', null, 'Subscription Booklet & LPA', 'completed', SUPER, ago(250), ago(240)); rcp.run(5, 'Done@Example.test', 't5');
  // inv@: an envelope of another document is not its agreement's.
  e.run(6, 'u6', null, 'Secondary Purchase Agreement', 'sent', SUPER, ago(50), null); rcp.run(6, 'inv@example.test', 't6');
  // no@: declined.
  e.run(7, 'u7', DECLINER, 'Venture Share Agreement (FAST)', 'rejected', SUPER, ago(60), null);

  // The library: one Ready row, one stub, one inactive.
  const t = db.prepare('INSERT INTO legal_templates (slug, title, body_md, is_active, is_stub) VALUES (?, ?, ?, ?, ?)');
  t.run('Founder Collaboration Agreement', 'Founder Collaboration Agreement', '# Founder Collaboration\n\nText.', 1, 0);
  t.run('SPV Joinder Agreement', 'SPV Joinder Agreement', '', 1, 1);
  t.run('M&A Advisory Mandate', 'M&A Advisory Mandate', '# Mandate', 0, 0);

  const env: any = { DB, JWT_SECRET: SECRET, ENVIRONMENT: 'development' };
  const app = new Hono<any>().route('/', partnerProfiles);
  app.onError((err: any, c: any) => {
    const m = String(err?.message || '');
    if (m === STEP_UP_REQUIRED) return c.json({ code: m }, 403);
    const status = AUTH_ERROR_STATUSES[m];
    return c.json({ detail: m }, status ?? 500);
  });
  const JTI: Record<number, string> = { [SUPER]: 'totp-super', [SUPER_PW]: 'pw-super', [SUPER_STALE]: 'stale-super' };
  async function call(who: number | null, method: string, path: string, body?: unknown) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (who != null) {
      headers.Authorization = 'Bearer ' + await new SignJWT({ user_id: who, jti: JTI[who] ?? `totp-${who}` }).setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    }
    const res = await withThrownResponses(() => app.request(`http://x${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env));
    let json: any = null;
    try { json = await res.json(); } catch { /* status says it */ }
    return { status: res.status, body: json };
  }
  const rows = (sql: string, ...a: unknown[]) => (db.prepare(sql).all(...(a as any[])) as any[]).map((r) => ({ ...r }));
  const refOf = (email: string) => rows('SELECT ref FROM partner_profiles WHERE email = ?', email)[0].ref as string;
  return { db, env, call, rows, refOf };
}

const quiet = async <T>(fn: () => Promise<T>) => { const s = [console.error, console.warn]; console.error = () => {}; console.warn = () => {}; try { return await fn(); } finally { [console.error, console.warn] = s; } };

// ── 1. the agreement options ─────────────────────────────────────────────────

test('the options are the review\'s fifteen values, unchanged, in the five groups', async () => {
  // Mutations checked: a value respelled (profiles carrying it orphaned); a group dropped.
  const console = read('frontend/src/pages/admin/consoles/PartnerProfilesConsole.jsx');
  const block = console.slice(console.indexOf('const AGREEMENT_OPTIONS'), console.indexOf('];', console.indexOf('const AGREEMENT_OPTIONS')));
  const theirs = [...block.matchAll(/value: '([^']+)'/g)].map((m) => m[1]);
  const mine = AGREEMENT_GROUPS.flatMap((g) => g.options.map((o) => o.value));
  assert.equal(mine.length, 15);
  assert.deepEqual(mine, theirs, 'the Worker\'s values are not the ones profiles already carry');
  assert.deepEqual(AGREEMENT_GROUPS.map((g) => g.label),
    ['Investors', 'Founders · New venture', 'Founders · Strategic scale', 'Operators and service partners', 'Liquidity']);
});

test('an option is Ready only when the send\'s resolver finds text; a stub, an inactive row or no row is Not ready', async () => {
  // Mutations checked: is_stub ignored (the stub reads Ready); readiness hard-wired true; the words changed.
  const f = fixture();
  const r = await f.call(ADMIN, 'GET', '/agreements');
  assert.equal(r.status, 200);
  const all = r.body.groups.flatMap((g: any) => g.options);
  assert.equal(all.length, 15);
  const by = new Map(all.map((o: any) => [o.value, o]));
  assert.deepEqual(by.get('Founder Collaboration Agreement'), {
    value: 'Founder Collaboration Agreement', label: 'Founder Collaboration Agreement', ready: true, readiness: 'Ready', source: 'store',
  });
  for (const v of ['SPV Joinder Agreement', 'M&A Advisory Mandate', 'Secondary Purchase Agreement']) {
    assert.equal((by.get(v) as any).ready, false, `${v} read as Ready`);
    assert.equal((by.get(v) as any).readiness, NOT_READY);
    assert.equal((by.get(v) as any).source, null);
  }
  assert.equal(NOT_READY, 'Not ready: no text in the library yet');
  assert.equal(all.filter((o: any) => o.ready).length, 1);
});

// ── 2. the envelope per profile ──────────────────────────────────────────────

test('each row carries its agreement\'s envelope: out since, not delivered, signed, declined, or none', async () => {
  // Mutations checked: the oldest envelope taken; the document type not matched; the recipient address not matched;
  // a failed mail read as delivered; the signed date shown on an unsigned envelope.
  const f = fixture();
  const r = await f.call(ADMIN, 'GET', '/?sort=newest');
  assert.equal(r.status, 200);
  const env = new Map(r.body.rows.map((x: any) => [x.email, x.envelope]));
  assert.deepEqual(env.get('chat@example.test'), {
    state: 'out', label: 'Out for signature', document_type: 'Founder Collaboration Agreement', sent_at: ago(72), signed_at: null,
  });
  assert.deepEqual(env.get('eadwyn@example.test'), {
    state: 'not_delivered', label: 'Not delivered', document_type: 'SPV Joinder Agreement', sent_at: ago(48), signed_at: null,
  });
  assert.deepEqual(env.get('done@example.test'), {
    state: 'signed', label: 'Signed', document_type: 'Subscription Booklet & LPA', sent_at: ago(250), signed_at: ago(240),
  });
  assert.equal((env.get('no@example.test') as any).state, 'declined');
  assert.equal(env.get('inv@example.test'), null, 'another document\'s envelope was taken for the agreement\'s');
  assert.equal(env.get('none@example.test'), null, 'a profile with no agreement has an envelope');
  // The record carries the same.
  const one = await f.call(ADMIN, 'GET', '/' + f.refOf('eadwyn@example.test'));
  assert.equal(one.status, 200);
  assert.equal(one.body.listed.envelope.state, 'not_delivered');
});

test('the counts fill "envelopes out" from the same join, and an unreadable envelope store costs that block only', async () => {
  // Mutations checked: not-delivered left out of "out"; the block left unavailable.
  const f = fixture();
  const r = await f.call(ADMIN, 'GET', '/counts');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.envelopes_out, { available: true, reason: null, count: 2, not_delivered: 1 });
  f.db.exec('DROP TABLE esign_audit_events');
  const b = await f.call(ADMIN, 'GET', '/counts');
  assert.equal(b.status, 200);
  assert.equal(b.body.envelopes_out.available, false);
  assert.equal(b.body.envelopes_out.count, null, 'an unreadable store read as zero');
  assert.equal(b.body.waiting.available, true, 'the envelope store cost the waiting block');
});

// ── 3. Unbind ────────────────────────────────────────────────────────────────

test('a Super Admin with a recent step-up unbinds a profile whose address now belongs to another account, logged in Governance by reference', async () => {
  // Mutations checked: the Governance row dropped; the reason not kept; the binding not cleared.
  const f = fixture();
  const ref = f.refOf('moved@example.test');
  const r = await f.call(SUPER, 'POST', `/${ref}/unbind`, { reason: 'Address moved to a new account in October' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { unbound: true, ref, previous_user_id: OLD, address_holder_user_id: NEW });
  assert.equal(f.rows('SELECT user_id FROM partner_profiles WHERE ref = ?', ref)[0].user_id, null);
  const gov = f.rows("SELECT admin_user_id, action, viewed_user_id, filters_json FROM admin_audit_log WHERE action = 'partner_profile_unbound'");
  assert.equal(gov.length, 1, 'the Unbind is not in Governance');
  assert.equal(gov[0].admin_user_id, SUPER);
  assert.equal(gov[0].viewed_user_id, OLD);
  assert.deepEqual(JSON.parse(gov[0].filters_json), { ref, target_user_id: OLD, address_holder_user_id: NEW, reason: 'Address moved to a new account in October' });
  for (const l of f.rows("SELECT details FROM activity_logs WHERE action = 'partner_profile_unbound'").concat(gov.map((g) => ({ details: g.filters_json })))) {
    assert.ok(!String(l.details).includes('@'), `a log line carries an email: ${l.details}`);
  }
  // A second Unbind finds nothing bound.
  assert.equal((await f.call(SUPER, 'POST', `/${ref}/unbind`, { reason: 'Address moved to a new account in October' })).body.error, 'not_bound');
});

test('Unbind refuses an Admin, a password session, a stale step-up and a member, and changes nothing', async () => {
  // Mutations checked: the write bar replaced by requireAdmin; replaced by plain requireSuperAdmin (the stale and password sessions pass).
  const f = fixture();
  const ref = f.refOf('moved@example.test');
  const body = { reason: 'Address moved to a new account in October' };
  assert.equal((await f.call(null, 'POST', `/${ref}/unbind`, body)).status, 401);
  for (const who of [ADMIN, MEMBER, SUPER_PW, SUPER_STALE]) {
    const r = await f.call(who, 'POST', `/${ref}/unbind`, body);
    assert.equal(r.status, 403, `${who}: ${r.status}`);
  }
  assert.equal((await f.call(SUPER_STALE, 'POST', `/${ref}/unbind`, body)).body.code, STEP_UP_REQUIRED);
  assert.equal(f.rows('SELECT user_id FROM partner_profiles WHERE ref = ?', ref)[0].user_id, OLD);
  assert.equal(f.rows('SELECT COUNT(*) AS n FROM admin_audit_log')[0].n, 0);
});

test('Unbind needs a reason, a bound profile and an address that left its account; each refusal changes nothing', async () => {
  // Mutations checked: the reason check dropped; the still-theirs check dropped (an owner's profile freed).
  const f = fixture();
  const moved = f.refOf('moved@example.test');
  for (const body of [{}, { reason: '' }, { reason: 'too short' }, { reason: 'x'.repeat(501) }, { reason: 42 }]) {
    const r = await f.call(SUPER, 'POST', `/${moved}/unbind`, body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.body.error, 'reason_required');
  }
  const reason = { reason: 'Checking the address belongs elsewhere' };
  const theirs = await f.call(SUPER, 'POST', `/${f.refOf('chat@example.test')}/unbind`, reason);
  assert.equal(theirs.status, 409);
  assert.equal(theirs.body.error, 'address_still_theirs');
  const unbound = await f.call(SUPER, 'POST', `/${f.refOf('done@example.test')}/unbind`, reason);
  assert.equal(unbound.status, 409);
  assert.equal(unbound.body.error, 'not_bound');
  assert.equal((await f.call(SUPER, 'POST', '/pp_0000000000/unbind', reason)).status, 404);
  assert.equal((await f.call(SUPER, 'POST', '/moved%40example.test/unbind', reason)).status, 404, 'an email is not an address');
  assert.deepEqual(f.rows("SELECT email, user_id FROM partner_profiles WHERE email IN ('moved@example.test', 'chat@example.test') ORDER BY email"),
    [{ email: 'chat@example.test', user_id: CHATTER }, { email: 'moved@example.test', user_id: OLD }]);
  assert.equal(f.rows('SELECT COUNT(*) AS n FROM admin_audit_log')[0].n, 0);
});

// ── 4. refusals on the reads ─────────────────────────────────────────────────

test('the agreement read refuses no session and a member, and an unreadable library is a 503, never "not ready"', async () => {
  // Mutation checked: the library failure caught as "not ready".
  const f = fixture();
  assert.equal((await f.call(null, 'GET', '/agreements')).status, 401);
  assert.equal((await f.call(MEMBER, 'GET', '/agreements')).status, 403);
  const db = f.env.DB;
  f.env.DB = { ...db, prepare: (sql: string) => (/legal_templates/.test(sql) && /SELECT/.test(sql) ? { bind: () => ({ first: async () => { throw new Error('D1_ERROR'); } }) } : db.prepare(sql)) };
  const r = await quiet(() => f.call(ADMIN, 'GET', '/agreements'));
  assert.equal(r.status, 503);
  assert.equal(r.body.error, 'agreements_unreadable');
  f.env.DB = { ...db, prepare: (sql: string) => (/UPDATE partner_profiles/.test(sql) ? { bind: () => ({ run: async () => { throw new Error('D1_ERROR'); } }) } : db.prepare(sql)) };
  const u = await quiet(() => f.call(SUPER, 'POST', `/${f.refOf('moved@example.test')}/unbind`, { reason: 'Address moved to a new account in October' }));
  assert.equal(u.status, 503);
  assert.equal(f.rows('SELECT COUNT(*) AS n FROM admin_audit_log')[0].n, 0, 'a failed Unbind was logged as done');
});
