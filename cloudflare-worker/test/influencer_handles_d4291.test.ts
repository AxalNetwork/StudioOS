/**
 * D4289 P2 (#4291) — handles, the public @handle read and its visits, and
 * attribution through a handle: the cookie, sign-up, checkout metadata, and
 * the self-referral, loop and velocity checks.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/influencer_handles_d4291.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import influencerRoute from '../src/routes/influencer.ts';
import adminInfluencers from '../src/routes/admin_influencers.ts';
import publicHandleRoute from '../src/routes/public_handle.ts';
import { ROUTE_WORDS, checkHandle, publicHandle, setHandle, skeleton } from '../src/services/influencerHandles.ts';
import {
  HANDLE_WINDOW_DAYS, activeAttribution, attachHandleReferral, attachSignupReferral, parseHandleRef, referralMetadata, selfCardRefusal,
} from '../src/services/referrals/handleAttribution.ts';
import { captureAndResolveAttribution } from '../src/services/referralAttribution.ts';
import { INFLUENCER_ACTIONS } from '../src/services/influencerActions.ts';
import { SOCIAL_CARD_GLOBS, matchSocialPath, resolveCard } from '../src/services/socialCards.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-d4291-0123456789-abcdef'; // synthetic test fixture
const SUPER = 1, ADMIN = 2, JANE = 3, KIM = 4, NEW1 = 5, NEW2 = 6, NEW3 = 7, ACME = 8, PAUSED = 9;
const NOW = Date.parse('2026-11-03T12:00:00Z');
const DAY = 86_400_000;

const BUILT_DDL = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  return (db.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`).all() as any[]).map((r) => r.sql as string);
})();

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const s of BUILT_DDL) { try { db.exec(s); } catch { /* a trigger naming an object replayed later */ } }
  const u = db.prepare('INSERT INTO users (id, uid, role, name, email, is_active, email_verified) VALUES (?, ?, ?, ?, ?, 1, 1)');
  u.run(SUPER, 'u-super', 'admin', 'Sue Super', 'sue@axal.example');
  u.run(ADMIN, 'u-admin', 'admin', 'Pat Plain', 'pat@axal.example');
  u.run(JANE, 'u-jane', 'founder', 'Jane Creator', 'jane@janestudio.example');
  u.run(KIM, 'u-kim', 'investor', 'Kim Writer', 'kim@gmail.com');
  u.run(NEW1, 'u-new1', 'exploring', 'New One', 'one@gmail.com');
  u.run(NEW2, 'u-new2', 'exploring', 'New Two', 'two@gmail.com');
  u.run(NEW3, 'u-new3', 'exploring', 'New Three', 'three@gmail.com');
  u.run(ACME, 'u-acme', 'exploring', 'Ana Colleague', 'ana@janestudio.example');
  u.run(PAUSED, 'u-paused', 'founder', 'Pia Paused', 'pia@pia.example');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  for (const id of [SUPER, ADMIN, JANE, KIM, PAUSED]) {
    db.prepare("INSERT INTO user_sessions (user_id, jti, factor, assurance_level, created_at) VALUES (?, ?, 'totp', 'totp', datetime('now'))").run(id, `totp-${id}`);
  }
  const inf = db.prepare(`INSERT INTO influencers (id, uid, user_id, tier, status, admitted_by, handle, handle_changed_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`);
  inf.run(1, 'inf_jane', JANE, 'verified_influencer', 'active', null, null);
  inf.run(2, 'inf_kim', KIM, 'affiliate_creator', 'active', 'kimwrites', '2026-09-01 00:00:00');
  inf.run(3, 'inf_pia', PAUSED, 'affiliate_creator', 'paused', 'piapause', '2026-09-01 00:00:00');
  return db;
}
const env = (db: DatabaseSync, extra: Record<string, unknown> = {}) => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), ...extra } as any);
const row = (db: DatabaseSync, sql: string, ...a: any[]) => db.prepare(sql).get(...a) as any;
const rows = (db: DatabaseSync, sql: string, ...a: any[]) => db.prepare(sql).all(...a) as any[];

const app = new Hono<any>();
app.route('/api/influencer', influencerRoute);
app.route('/api/admin/influencers', adminInfluencers);
app.route('/api/public/handle', publicHandleRoute);
app.onError((err) => {
  const m = String((err as Error)?.message || '');
  if (m === 'Unauthorized') return new Response(JSON.stringify({ error: m }), { status: 401 });
  if (/required|step_up|factor|HQ only/i.test(m)) return new Response(JSON.stringify({ error: m }), { status: 403 });
  throw err;
});
async function call(db: DatabaseSync, who: number | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const role = who ? (row(db, 'SELECT role FROM users WHERE id = ?', who)?.role ?? 'founder') : null;
  const auth = who ? { Authorization: `Bearer ${await new SignJWT({ user_id: who, role, jti: `totp-${who}` }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET))}` } : {};
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await withThrownResponses(() => app.request(path, {
      method, headers: { ...auth, 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, env(db)));
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error] = saved; }
}

// ---- the handle's rules ---------------------------------------------------------

test('a handle: 3 to 24 of [a-z0-9_], case-folded; no reserved word, no brand, no look-alike of either', () => {
  // Mutation checked: drop the look-alike skeleton → `adm1n` and `l0gin` are accepted.
  assert.deepEqual(checkHandle('Jane_Writes'), { ok: true, handle: 'jane_writes' });
  assert.deepEqual(checkHandle('@jane'), { ok: true, handle: 'jane' });
  for (const bad of ['ja', 'a'.repeat(25), 'jane-doe', 'jané', '', 42]) assert.equal((checkHandle(bad) as any).code, 'handle_invalid', String(bad));
  for (const reserved of ['admin', 'adm1n', 'l0gin', 'settings', 'axal', 'axalfan', 'the_axal_way', '4x4l', 'influencers', 'pr1c1ng']) {
    assert.equal((checkHandle(reserved) as any).code, 'handle_reserved', reserved);
  }
  assert.equal(skeleton('j4n3_5'), 'janes');
  assert.equal(skeleton('pr1c1ng'), skeleton('pricing'), 'i, l and 1 read as one');
});

test('every top-level route word of the app is reserved for handles', () => {
  // Mutation checked: drop `pricing` from ROUTE_WORDS → this names it.
  const sources = [readFileSync('frontend/src/App.jsx', 'utf8'), ...readdirSync('frontend/src/routes').filter((f) => f.endsWith('.jsx')).map((f) => readFileSync(`frontend/src/routes/${f}`, 'utf8'))].join('\n');
  const words = new Set([...sources.matchAll(/path="\/([a-z0-9_-]+)/g)].map((m) => m[1].replace(/-/g, '_')).filter((w) => /^[a-z0-9_]{3,24}$/.test(w)));
  const missing = [...words].filter((w) => !ROUTE_WORDS.has(w) && checkHandle(w).ok);
  assert.deepEqual(missing, [], 'add these to ROUTE_WORDS');
});

test('setting a handle: free, then once every 30 days; an old one redirects for 12 months and blocks others until then', async () => {
  // Mutation checked: skip the 30-day check → the second change in a week goes through.
  const db = fixture();
  const e = env(db);
  assert.deepEqual(await setHandle(e, JANE, { handle: 'Jane', line: 'I build in public.' }, NOW), {
    handle: 'jane', url: 'https://axal.vc/@jane', line: 'I build in public.', next_change_at: '2026-12-03T12:00:00.000Z', status: 'active',
  });
  await assert.rejects(setHandle(e, JANE, { handle: 'janewrites' }, NOW + 7 * DAY), (x: any) => x.code === 'handle_change_too_soon' && x.extra.next_change_at === '2026-12-03T12:00:00.000Z');
  await assert.rejects(setHandle(e, JANE, { handle: 'kimwrites' }, NOW + 31 * DAY), (x: any) => x.code === 'handle_taken');
  // Changed after 30 days: the old handle redirects, keeping the channel.
  assert.equal((await setHandle(e, JANE, { handle: 'janewrites' }, NOW + 31 * DAY)).handle, 'janewrites');
  assert.deepEqual((await publicHandle(e, 'jane', 'yt', null, NOW + 40 * DAY)).body, { state: 'moved', handle: 'janewrites', redirect: '/@janewrites/yt' });
  // Kim cannot take `jane` while it redirects; after 12 months it is free.
  await assert.rejects(setHandle(e, KIM, { handle: 'jane' }, NOW + 60 * DAY), (x: any) => x.code === 'handle_taken');
  assert.equal((await setHandle(e, KIM, { handle: 'jane' }, NOW + 31 * DAY + 366 * DAY)).handle, 'jane');
  assert.equal((await publicHandle(e, 'jane', null, null, NOW + 400 * DAY)).body.name, 'Kim Writer');
  // Every change is in the append-only log.
  assert.deepEqual(rows(db, "SELECT detail_json FROM influencer_events WHERE event = 'handle_changed' ORDER BY id").map((r) => JSON.parse(r.detail_json)),
    [{ from: null, to: 'jane' }, { from: 'jane', to: 'janewrites' }, { from: 'kimwrites', to: 'jane' }]);
  // A uid, a company slug and an inactive member.
  db.prepare("INSERT INTO company_profiles (uid, company_name, slug) VALUES ('cp1', 'Acme', 'acmeco')").run();
  db.prepare("UPDATE influencers SET handle_changed_at = '2025-01-01 00:00:00'").run();
  await assert.rejects(setHandle(e, JANE, { handle: 'acmeco' }, NOW + 400 * DAY), (x: any) => x.code === 'handle_taken', 'a company slug');
  db.prepare("UPDATE users SET uid = 'takenuid' WHERE id = ?").run(NEW1);
  await assert.rejects(setHandle(e, JANE, { handle: 'TakenUid' }, NOW + 400 * DAY), (x: any) => x.code === 'handle_taken', 'a member\'s uid');
  await assert.rejects(setHandle(e, PAUSED, { handle: 'newpia' }, NOW), (x: any) => x.code === 'influencer_not_active');
  await assert.rejects(setHandle(e, JANE, { line: 'x'.repeat(161) }, NOW), (x: any) => x.code === 'line_invalid');
});

test('HQ takes a handle down: no redirect, unclaimable for 12 months, and the influencer may choose another at once', async () => {
  // Mutation checked: let a taken-down handle redirect → the read answers moved.
  const db = fixture();
  // Kim changed her handle yesterday, so without the takedown she would wait 29 days.
  db.prepare("UPDATE influencers SET handle_changed_at = '2026-11-02 12:00:00' WHERE id = 2").run();
  const patch = (body: unknown, who = ADMIN) => call(db, who, 'PATCH', '/api/admin/influencers/inf_kim', body);
  assert.deepEqual([(await patch({ handle_takedown: true })).body.error], ['reason_required']);
  assert.deepEqual([(await patch({ handle_takedown: 'yes', reason: 'Impersonates a portfolio founder.' })).body.error], ['invalid_takedown']);
  const r = await patch({ handle_takedown: true, reason: 'Impersonates a portfolio founder.' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.events, r.body.membership.handle], [['handle_taken_down'], null]);
  assert.deepEqual((await publicHandle(env(db), 'kimwrites', null, null, NOW)).body, { state: 'unknown' });
  await assert.rejects(setHandle(env(db), JANE, { handle: 'kimwrites' }, NOW), (x: any) => x.code === 'handle_taken');
  assert.equal((await setHandle(env(db), KIM, { handle: 'kimnew' }, NOW)).handle, 'kimnew', 'no 30-day wait after a takedown');
  assert.deepEqual((await publicHandle(env(db), 'kimwrites', null, null, NOW)).body, { state: 'unknown' }, 'a taken-down handle never redirects to the new one');
  assert.equal(row(db, "SELECT action FROM admin_audit_log WHERE action = ?", INFLUENCER_ACTIONS.takedown).action, INFLUENCER_ACTIONS.takedown);
  assert.deepEqual([(await call(db, ADMIN, 'PATCH', '/api/admin/influencers/inf_jane', { handle_takedown: true, reason: 'Nothing to take down here.' })).body.error], ['no_handle']);
});

// ---- links and the public read -------------------------------------------------

test('channel links: add, list, one per channel, archive; the URL carries the UTM campaign', async () => {
  const db = fixture();
  const add = (body: unknown) => call(db, KIM, 'POST', '/api/influencer/me/links', body);
  assert.deepEqual([(await add({ channel: 'You Tube' })).body.error], ['channel_invalid']);
  assert.deepEqual([(await add({ channel: 'yt', utm_campaign: 'spring sale' })).body.error], ['utm_invalid']);
  const yt = await add({ channel: 'YT', utm_campaign: 'launch' });
  assert.equal(yt.status, 201, JSON.stringify(yt.body));
  assert.equal(yt.body.link.url, 'https://axal.vc/@kimwrites/yt?utm_campaign=launch');
  assert.deepEqual([(await add({ channel: 'yt' })).body.error], ['channel_taken']);
  assert.equal((await call(db, KIM, 'GET', '/api/influencer/me/links')).body.links.length, 1);
  assert.equal((await call(db, KIM, 'DELETE', `/api/influencer/me/links/${yt.body.link.uid}`)).status, 204);
  assert.equal((await call(db, KIM, 'GET', '/api/influencer/me/links')).body.links.length, 0);
  assert.equal((await add({ channel: 'yt' })).status, 201, 'an archived channel can be used again');
  assert.equal((await call(db, ADMIN, 'GET', '/api/influencer/me/links')).status, 404, 'not an influencer');
});

test('the public read: a live page with the disclosure and the cookie value; one visit per visitor and day, no IP; paused is neutral', async () => {
  // Mutation checked: record a visit for a paused influencer → the paused read writes a row.
  const db = fixture();
  db.prepare("INSERT INTO influencer_links (uid, influencer_id, channel) VALUES ('ifl_1', 2, 'yt')").run();
  db.prepare("UPDATE influencers SET page_line = 'Notes on angel investing.' WHERE id = 2").run();
  const read = (path: string, visitor?: string) => call(db, null, 'GET', path, undefined, visitor ? { 'X-Axal-Visitor': visitor } : {});
  const live = await read('/api/public/handle/KimWrites/yt', 'visitor-aaaa-1111');
  assert.equal(live.status, 200, JSON.stringify(live.body));
  assert.deepEqual(live.body, {
    state: 'live', handle: 'kimwrites', channel: 'yt', name: 'Kim Writer', photo: null, line: 'Notes on angel investing.',
    tier: 'affiliate_creator', tier_label: 'Affiliate Creator', offer: null,
    disclosure: 'Kim Writer earns a commission when you subscribe. Axal memberships are software, not an investment.', ref: 'h:kimwrites:yt',
  });
  await read('/api/public/handle/kimwrites/yt', 'visitor-aaaa-1111');
  await read('/api/public/handle/kimwrites/zz', 'visitor-aaaa-1111');
  await read('/api/public/handle/kimwrites');
  await read('/api/public/handle/kimwrites');
  const visits = rows(db, 'SELECT channel, visitor_hash FROM handle_visits ORDER BY id');
  assert.deepEqual(visits.map((v) => v.channel), ['yt', '', '', ''], 'the same visitor once a day per channel; an unknown channel is the handle; no visitor id counts each time');
  assert.equal(visits[0].visitor_hash.length, 64);
  assert.ok(!JSON.stringify(visits).includes('visitor-aaaa'), 'the id is hashed');
  assert.deepEqual(rows(db, 'PRAGMA table_info(handle_visits)').map((c) => c.name).filter((n) => /ip|agent/i.test(n)), [], 'no IP or user agent column');
  assert.deepEqual((await read('/api/public/handle/piapause')).body, { state: 'unavailable' });
  assert.equal(row(db, "SELECT COUNT(*) AS n FROM handle_visits WHERE handle = 'piapause'").n, 0);
  assert.deepEqual([(await read('/api/public/handle/nobody')).status, (await read('/api/public/handle/a!')).status], [404, 404]);
});

// ---- attribution ---------------------------------------------------------------------

test('the reference: h: and @ forms, case-folded; anything else is a code', () => {
  assert.deepEqual(parseHandleRef('h:KimWrites:YT'), { handle: 'kimwrites', channel: 'yt' });
  assert.deepEqual(parseHandleRef('@kimwrites/yt'), { handle: 'kimwrites', channel: 'yt' });
  assert.deepEqual(parseHandleRef('@kimwrites'), { handle: 'kimwrites', channel: null });
  for (const v of ['AXALFAN', 'kimwrites', 'h:ab', '@kim/yt/x', 'h:kim:y t', null]) assert.equal(parseHandleRef(v as any), null, String(v));
});

test('sign-up through a handle: 90 days, locked to the account, counted in Refer & Earn; the code path is untouched', async () => {
  // Mutation checked: let a second attach replace the first → NEW1 moves to Jane.
  const db = fixture();
  db.prepare("UPDATE influencers SET handle = 'jane' WHERE id = 1").run();
  db.prepare("INSERT INTO influencer_links (uid, influencer_id, channel) VALUES ('ifl_1', 2, 'yt')").run();
  assert.equal(await attachSignupReferral(env(db), NEW1, 'h:kimwrites:yt'), true);
  const a = row(db, 'SELECT * FROM referral_attributions WHERE user_id = ?', NEW1);
  assert.deepEqual([a.source, a.handle, a.channel, a.status, a.referrer_user_id, a.referral_code], ['handle', 'kimwrites', 'yt', 'active', KIM, 'h:kimwrites:yt']);
  assert.equal(HANDLE_WINDOW_DAYS, 90);
  assert.equal(Math.round((Date.parse(`${a.expires_at.replace(' ', 'T')}Z`) - Date.parse(`${a.first_touch_at.replace(' ', 'T')}Z`)) / DAY), 90);
  assert.equal(row(db, 'SELECT referrer_id FROM referrals WHERE referred_id = ?', NEW1).referrer_id, KIM);
  assert.deepEqual(await attachHandleReferral(env(db), NEW1, { handle: 'jane', channel: null }, { signup: false }), { attached: false, reason: 'already_attributed' });
  assert.equal(row(db, 'SELECT referrer_user_id FROM referral_attributions WHERE user_id = ?', NEW1).referrer_user_id, KIM, 'the first eligible referral is locked');
  // A paused influencer's handle attributes nothing.
  assert.deepEqual(await attachHandleReferral(env(db), NEW2, { handle: 'piapause', channel: null }), { attached: false, reason: 'not_live' });
  // Purchase-time capture reads a handle cookie the same way.
  await captureAndResolveAttribution(env(db), NEW3, 'h:jane');
  assert.equal(row(db, 'SELECT source FROM referral_attributions WHERE user_id = ?', NEW3).source, 'handle');
  // The wiring: /register no longer upper-cases a handle, and Google and magic-link sign-ups read the cookie.
  const auth = readFileSync('cloudflare-worker/src/routes/auth.ts', 'utf8');
  assert.match(auth, /if \(parseHandleRef\(ref_code \?\? cookieRef\)\) \{\n\s+const linked = await attachSignupReferral\(c\.env, user\.id, String\(ref_code \?\? cookieRef\)\);/);
  assert.match(auth, /await attachSignupReferral\(c\.env, Number\(user\.id\), readRefCookie\(c\.req\.header\('cookie'\)\)\);/);
  assert.match(readFileSync('cloudflare-worker/src/routes/auth_google.ts', 'utf8'), /await attachSignupReferral\(c\.env, Number\(user\.id\), readRefCookie\(c\.req\.header\('cookie'\)\)\);/);
});

test('fraud: the same account or company domain and a loop are refused; past the daily cap a sign-up is held for HQ', async () => {
  // Mutation checked: treat gmail.com as a company domain → NEW2's sign-up through Kim is refused.
  const db = fixture();
  db.prepare("UPDATE influencers SET handle = 'jane' WHERE id = 1").run();
  assert.deepEqual(await attachHandleReferral(env(db), JANE, { handle: 'jane', channel: null }), { attached: false, reason: 'self_account' });
  assert.deepEqual(await attachHandleReferral(env(db), ACME, { handle: 'jane', channel: null }), { attached: false, reason: 'self_email_domain' });
  assert.equal((await attachHandleReferral(env(db), NEW2, { handle: 'kimwrites', channel: null })).attached, true, 'gmail.com is shared, not a company');
  // Loop: Kim was referred by Jane, so Jane cannot be referred by Kim.
  db.prepare("INSERT INTO referrals (referrer_id, referred_id, referral_code, status) VALUES (?, ?, 'X', 'pending')").run(JANE, KIM);
  assert.deepEqual(await attachHandleReferral(env(db), JANE, { handle: 'kimwrites', channel: null }), { attached: false, reason: 'loop' });
  // The velocity cap: the second sign-up of the day through one handle is held.
  const capped = env(db, { INFLUENCER_HANDLE_DAILY_CAP: '1' });
  assert.deepEqual(await attachHandleReferral(capped, NEW3, { handle: 'kimwrites', channel: null }), { attached: true, status: 'flagged' });
  assert.deepEqual(rows(db, 'SELECT reason, outcome FROM influencer_referral_flags ORDER BY id').map((f) => [f.reason, f.outcome]),
    [['self_email_domain', 'refused'], ['loop', 'refused'], ['velocity', 'held']]);
  // A held attribution stamps nothing at checkout until HQ clears it.
  assert.equal(await activeAttribution(env(db), NEW3), null);
  const flag = row(db, "SELECT uid FROM influencer_referral_flags WHERE reason = 'velocity'").uid;
  assert.deepEqual([(await call(db, ADMIN, 'POST', `/api/admin/influencers/flags/${flag}/decision`, { decision: 'clear' })).body.error], ['reason_required']);
  const cleared = await call(db, ADMIN, 'POST', `/api/admin/influencers/flags/${flag}/decision`, { decision: 'clear', reason: 'Spike from a newsletter we know.' });
  assert.deepEqual([cleared.status, cleared.body.flag.outcome], [200, 'cleared']);
  assert.equal((await activeAttribution(env(db), NEW3))?.referrer_user_id, KIM);
  assert.deepEqual([(await call(db, ADMIN, 'POST', `/api/admin/influencers/flags/${flag}/decision`, { decision: 'uphold', reason: 'Second look at the spike.' })).body.error], ['flag_decided']);
  const q = await call(db, ADMIN, 'GET', '/api/admin/influencers/flags?outcome=all');
  assert.equal(q.body.flags.length, 3);
  assert.equal((await call(db, KIM, 'GET', '/api/admin/influencers/flags')).status, 403);
});

test('checkout: the locked referral rides on the subscription; a saved card that is the referrer\'s own refuses it', async () => {
  // Mutation checked: compare against the buyer's own cards → the self-card case passes.
  const db = fixture();
  await attachHandleReferral(env(db), NEW1, { handle: 'kimwrites', channel: null });
  const a = (await activeAttribution(env(db), NEW1))!;
  assert.deepEqual(referralMetadata(a), { 'metadata[referrer_user_id]': String(KIM), 'metadata[referral_source]': 'handle', 'metadata[handle]': 'kimwrites' });
  assert.deepEqual(referralMetadata(null), {});
  assert.equal(await activeAttribution(env(db), NEW1, NOW + 120 * DAY), null, 'past the 90 days');
  db.prepare("UPDATE users SET stripe_customer_id = 'cus_kim' WHERE id = ?").run(KIM);
  const stripe = async (path: string) => (path.startsWith('/customers/cus_kim/') ? { data: [{ card: { fingerprint: 'fp_kim' } }] } : { data: [] });
  assert.equal(await selfCardRefusal(env(db), NEW1, a, 'fp_other', stripe), false);
  assert.equal(await selfCardRefusal(env(db), NEW1, a, 'fp_kim', async () => { throw new Error('stripe down'); }), false, 'a read that fails blocks nothing');
  assert.equal(await selfCardRefusal(env(db), NEW1, a, 'fp_kim', stripe), true);
  assert.deepEqual({ ...row(db, 'SELECT status, refused_reason FROM referral_attributions WHERE user_id = ?', NEW1) }, { status: 'refused', refused_reason: 'self_card' });
  assert.equal(await activeAttribution(env(db), NEW1), null);
  assert.equal(row(db, "SELECT reason FROM influencer_referral_flags WHERE reason = 'self_card'").reason, 'self_card');
  // The checkout route stamps it, and marks a new card for P3's check on payment.
  const src = readFileSync('cloudflare-worker/src/routes/billing_checkout.ts', 'utf8');
  assert.match(src, /\.\.\.referralMetadata\(attribution\),\n\s+\.\.\.\(attribution && !cardFingerprint \? \{ 'metadata\[referral_card_check\]': 'on_payment' \} : \{\}\),/);
});

// ---- the link preview -------------------------------------------------------------------

test('the /@ card: an [assets] glob, live influencers only, with the disclosure in the description', async () => {
  // Mutation checked: card a paused influencer → the paused card is not null.
  assert.ok((SOCIAL_CARD_GLOBS as readonly string[]).includes('/@*'));
  const wrangler = readFileSync('wrangler.toml', 'utf8');
  const lists = [...wrangler.matchAll(/^run_worker_first = (\[.*\])$/gm)].map((m) => JSON.parse(m[1]));
  for (const l of lists) assert.ok(l.includes('/@*'));
  assert.doesNotMatch(wrangler, /pattern = "axal\.vc\/@/, 'never a path-scoped apex route');
  assert.deepEqual(matchSocialPath('/@KimWrites'), { kind: 'handle', key: 'kimwrites', path: '/@kimwrites' });
  assert.deepEqual(matchSocialPath('/@kimwrites/yt/'), { kind: 'handle', key: 'kimwrites/yt', path: '/@kimwrites/yt' });
  for (const p of ['/@ab', '/@kim/yt/x', '/@kim%2Fyt']) assert.equal(matchSocialPath(p), null, p);
  const db = fixture();
  const card = await resolveCard(env(db), matchSocialPath('/@kimwrites')!);
  assert.equal(card!.title.startsWith('Kim Writer invites you to Axal VC'), true);
  assert.match(card!.description, /Kim Writer earns a commission when you subscribe\./);
  assert.equal(await resolveCard(env(db), matchSocialPath('/@piapause')!), null);
});
