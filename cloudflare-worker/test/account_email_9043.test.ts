/**
 * #9043 (D9043) — one normalised `users.email` on every write and lookup, so one mailbox maps to one account.
 *
 * The flows run the real routers and services over the full migrated schema in node:sqlite, with synthetic
 * addresses only: register then magic link, admin create then magic link, partner deal activation, Google and
 * Apple first sign-in, an email change and its revert, and a case pair seeded before D9043. The guard at the end
 * reads every Worker source file and fails on an `INSERT INTO users` or `UPDATE users SET email` whose address does
 * not pass through `normalizeEmail` (util/accountEmail.ts), and on a `FROM users WHERE email = …` exact match.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import auth from '../src/routes/auth.ts';
import users from '../src/routes/users.ts';
import settings from '../src/routes/settings.ts';
import { __testing as googleTesting } from '../src/routes/auth_google.ts';
import { __testing as appleTesting } from '../src/routes/auth_apple.ts';
import { activatePartnerDealOnSignature } from '../src/services/partnerDeals.ts';
import { normalizeEmail } from '../src/util/accountEmail.ts';
import { normalizeEmail as projectAccessNormalizeEmail } from '../src/services/projectAccess.ts';
import { hashToken } from '../src/auth.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { getSQL } from '../src/db.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'synthetic-9043-test-secret-not-a-credential';

function kv() {
  const m = new Map<string, string>();
  return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); }, delete: async (k: string) => { m.delete(k); } };
}

function fixture() {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  const sent: any[] = [];
  const env: any = {
    USE_CF_QUEUE: 'true', APP_URL: 'https://axal.vc', ENVIRONMENT: 'development', JWT_SECRET,
    JOB_QUEUE: { send: async (body: any) => { sent.push(body); } },
    DB: d1Over(db), RATE_LIMITS: kv(), TOKENS: kv(),
  };
  const rows = () => (db.prepare('SELECT id, email FROM users ORDER BY id').all() as any[]).map((r) => ({ id: Number(r.id), email: String(r.email) }));
  return { db, env, sent, rows };
}

const app = new Hono<any>();
app.route('/api/auth', auth);
app.route('/api/users', users);
app.route('/api/settings', settings);
app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));

let ipSeq = 0;
const ip = () => `203.0.113.${(ipSeq++ % 200) + 1}`;

async function post(env: any, path: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await app.request(path, {
    method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip(), ...headers }, body: JSON.stringify(body),
  }, env);
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** Completes a magic-link sign-in for `email`: /magic/start, the link from the queued message, /magic/verify. */
async function magicSignIn(f: ReturnType<typeof fixture>, email: string): Promise<number> {
  const before = f.sent.length;
  assert.equal((await post(f.env, '/api/auth/magic/start', { email })).status, 202);
  const msg = JSON.stringify(f.sent.slice(before));
  const token = /magic\/verify\?token=([A-Za-z0-9_-]+)/.exec(msg)?.[1];
  assert.ok(token, 'the sign-in link was queued');
  const res = await app.request(`/api/auth/magic/verify?token=${token}`, { headers: { 'cf-connecting-ip': ip() } }, f.env);
  assert.equal(res.status, 302);
  assert.doesNotMatch(res.headers.get('location') || '', /magic_error/, 'the link signed in');
  const s = f.db.prepare('SELECT user_id FROM user_sessions ORDER BY rowid DESC LIMIT 1').get() as { user_id: number };
  return Number(s.user_id);
}

async function bearer(id: number, role: string) {
  const t = await new SignJWT({ user_id: id, role }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  return { Authorization: `Bearer ${t}` };
}

test('one normaliser: util/accountEmail trims and lowercases, and projectAccess re-exports the same function', () => {
  assert.equal(normalizeEmail('  Jane.Doe9043@Example.TEST \t'), 'jane.doe9043@example.test');
  assert.equal(normalizeEmail(null), '');
  assert.equal(projectAccessNormalizeEmail, normalizeEmail);
});

test('register as "Jane@Example.com " then a magic link as "jane@example.com": one users row, the same id', async () => {
  const f = fixture();
  const r = await post(f.env, '/api/auth/register', { email: 'Jane.R9043@Example.test ', name: 'Synthetic Jane', defer_email: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const [created] = f.rows();
  assert.deepEqual(f.rows(), [{ id: created.id, email: 'jane.r9043@example.test' }], 'stored trimmed and lowercased');
  const signedIn = await magicSignIn(f, 'jane.r9043@example.test');
  assert.equal(signedIn, created.id, 'the magic link signs in the registered account');
  assert.equal(f.rows().length, 1, 'no second account');
  // Registering again in another case finds the same (still unverified until the link) account, not a new one.
  const again = await post(f.env, '/api/auth/register', { email: 'JANE.R9043@EXAMPLE.TEST', name: 'Synthetic Jane' });
  assert.equal(again.status, 409, JSON.stringify(again.body));
  assert.equal(f.rows().length, 1);
});

test('a magic link first, then register in another case: the address is already the verified account', async () => {
  const f = fixture();
  const id = await magicSignIn(f, '  Kim.M9043@Example.test');
  assert.deepEqual(f.rows(), [{ id, email: 'kim.m9043@example.test' }]);
  const r = await post(f.env, '/api/auth/register', { email: 'KIM.M9043@example.test', name: 'Synthetic Kim' });
  assert.equal(r.status, 409);
  assert.equal(f.rows().length, 1);
});

test('admin create as a mixed-case address, then a magic link in lowercase: one row, the same id', async () => {
  const f = fixture();
  f.db.prepare("INSERT INTO users (id, email, name, role, email_verified, is_active) VALUES (900, 'admin9043@example.test', 'Synthetic Admin', 'admin', 1, 1)").run();
  const h = await bearer(900, 'admin');
  const r = await post(f.env, '/api/users', { email: ' Lee.A9043@Example.TEST ', name: 'Synthetic Lee', role: 'founder' }, h);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.email, 'lee.a9043@example.test');
  const dup = await post(f.env, '/api/users', { email: 'LEE.A9043@example.test', name: 'Synthetic Lee', role: 'founder' }, h);
  assert.equal(dup.status, 409, 'the same mailbox in another case is the existing user');
  assert.equal(await magicSignIn(f, 'lee.a9043@example.test'), Number(r.body.id));
  assert.equal(f.rows().filter((u) => u.email.startsWith('lee.')).length, 1);
});

test('partner deal activation stores the invited address normalised; a later magic link is the same account', async () => {
  const f = fixture();
  f.db.prepare("INSERT INTO users (id, email, name, role, email_verified, is_active) VALUES (900, 'admin9043@example.test', 'Synthetic Admin', 'admin', 1, 1)").run();
  f.db.prepare(`INSERT INTO partner_invitations (id, token, recipient_email, recipient_name, invited_by_user_id, status, expires_at)
    VALUES (1, 'synthetic-invite-9043', ' Pat.P9043@Example.TEST', 'Synthetic Pat', 900, 'signed', '2999-01-01T00:00:00Z')`).run();
  f.db.prepare(`INSERT INTO esign_envelopes (id, envelope_uuid, document_type, document_title, document_body, body_sha256, status, created_by)
    VALUES (77, 'synthetic-envelope-9043', 'partner_agreement', 'Synthetic agreement', 'Synthetic body', 'synthetic-sha', 'completed', 900)`).run();
  f.db.prepare(`INSERT INTO partner_deals (id, invitation_id, envelope_id, status, deal_type, proposal_json)
    VALUES (5, 1, 77, 'awaiting_signature', 'standard', '{}')`).run();
  const out = await activatePartnerDealOnSignature(f.env, 77);
  assert.equal(out?.activated, true, JSON.stringify(out));
  const pat = f.rows().find((u) => u.id === out!.user_id)!;
  assert.equal(pat.email, 'pat.p9043@example.test');
  assert.equal(await magicSignIn(f, 'PAT.P9043@example.test'), pat.id);
  assert.equal(f.rows().length, 2);
});

function fakeCtx(env: any) {
  return { env, req: { header: () => undefined, raw: new Request('https://axal.vc/') } } as any;
}

test('Google first sign-in with a mixed-case address stores it lowercased; a later magic link is the same account', async () => {
  const f = fixture();
  const sql = getSQL(f.env);
  const r = await googleTesting.resolveGoogleSignin(fakeCtx(f.env), sql, { sub: 'google-sub-9043', email: 'Gil.G9043@Example.TEST', name: 'Synthetic Gil', hd: 'example.test' });
  assert.equal(r.ok, true, JSON.stringify(r));
  const id = Number((r as any).user.id);
  assert.deepEqual(f.rows(), [{ id, email: 'gil.g9043@example.test' }]);
  assert.equal(await magicSignIn(f, 'gil.g9043@example.test'), id);
  // A second Google sub with the same mailbox in another case links to the account rather than creating one.
  const again = await googleTesting.resolveGoogleSignin(fakeCtx(f.env), sql, { sub: 'google-sub-9043-b', email: 'GIL.G9043@example.test', name: 'Synthetic Gil', hd: 'example.test' });
  assert.equal(again.ok, true, JSON.stringify(again));
  assert.equal(Number((again as any).user.id), id);
  assert.equal(f.rows().length, 1);
});

test('Apple first sign-in with a mixed-case address stores it lowercased; a later magic link is the same account', async () => {
  const f = fixture();
  const sql = getSQL(f.env);
  const r = await appleTesting.resolveAppleSignin(fakeCtx(f.env), sql, { sub: 'apple-sub-9043', email: 'Ann9043@PrivateRelay.AppleID.com', privateEmail: true }, { name: 'Synthetic Ann' });
  assert.equal(r.ok, true, JSON.stringify(r));
  const id = Number((r as any).user.id);
  assert.deepEqual(f.rows(), [{ id, email: 'ann9043@privaterelay.appleid.com' }]);
  assert.equal(await magicSignIn(f, 'ann9043@privaterelay.appleid.com'), id);
  assert.equal(f.rows().length, 1);
});

async function seedChange(f: ReturnType<typeof fixture>, userId: number, oldEmail: string, newEmail: string, confirmed: boolean) {
  const confirmRaw = `synthetic-confirm-${userId}-${confirmed ? 'c' : 'p'}`;
  const revokeRaw = `synthetic-revoke-${userId}-${confirmed ? 'c' : 'p'}`;
  // The route creates its own table on first use; a confirm call with an unknown token makes sure it exists.
  await post(f.env, '/api/settings/email-change/confirm', { token: 'synthetic-unknown' });
  f.db.prepare(`INSERT INTO email_change_requests (user_id, old_email, new_email, confirm_token_hash, revoke_token_hash, confirm_expires_at, revoke_expires_at, confirmed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(userId, oldEmail, newEmail, await hashToken(confirmRaw), await hashToken(revokeRaw),
    '2999-01-01T00:00:00Z', '2999-01-01T00:00:00Z', confirmed ? '2026-11-27 00:00:00' : null);
  return { confirmRaw, revokeRaw };
}

test('an email change to a mixed-case address stores it lowercased; the revert restores the old address normalised', async () => {
  const f = fixture();
  f.db.prepare("INSERT INTO users (id, email, name, role, email_verified, is_active) VALUES (31, 'Old.C9043@Example.test', 'Synthetic Cy', 'founder', 1, 1)").run();
  const { confirmRaw, revokeRaw } = await seedChange(f, 31, 'Old.C9043@Example.test', ' New.C9043@Example.TEST', false);
  const ok = await post(f.env, '/api/settings/email-change/confirm', { token: confirmRaw });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.email, 'new.c9043@example.test');
  assert.deepEqual(f.rows(), [{ id: 31, email: 'new.c9043@example.test' }]);
  const back = await post(f.env, '/api/settings/email-change/revoke', { token: revokeRaw });
  assert.equal(back.status, 200, JSON.stringify(back.body));
  assert.deepEqual(f.rows(), [{ id: 31, email: 'old.c9043@example.test' }]);
});

test('an email change requested in mixed case is checked and stored normalised', async () => {
  const f = fixture();
  f.db.prepare("INSERT INTO users (id, email, name, role, email_verified, is_active) VALUES (41, 'dee.d9043@example.test', 'Synthetic Dee', 'founder', 1, 1)").run();
  f.db.prepare("INSERT INTO users (id, email, name, role, email_verified, is_active) VALUES (42, 'taken.d9043@example.test', 'Synthetic Taken', 'founder', 1, 1)").run();
  const h = await bearer(41, 'founder');
  const same = await post(f.env, '/api/settings/email-change/request', { new_email: ' DEE.D9043@Example.test' }, h);
  assert.equal(same.status, 400, 'a case-only change is the current address');
  const taken = await post(f.env, '/api/settings/email-change/request', { new_email: 'Taken.D9043@EXAMPLE.test ' }, h);
  assert.equal(taken.status, 409, 'another account holds that mailbox');
  const fresh = await post(f.env, '/api/settings/email-change/request', { new_email: ' Fresh.D9043@Example.TEST' }, h);
  assert.equal(fresh.status, 200, JSON.stringify(fresh.body));
  const req = f.db.prepare('SELECT new_email FROM email_change_requests WHERE user_id = 41 ORDER BY id DESC LIMIT 1').get() as any;
  assert.equal(req.new_email, 'fresh.d9043@example.test');
});

test('a revert whose normalised address another account holds (a pre-D9043 case pair) restores the stored bytes and merges nothing', async () => {
  const f = fixture();
  f.db.prepare("INSERT INTO users (id, email, name, role, email_verified, is_active) VALUES (51, 'new.e9043@example.test', 'Synthetic Eve', 'founder', 1, 1)").run();
  f.db.prepare("INSERT INTO users (id, email, name, role, email_verified, is_active) VALUES (52, 'pair.e9043@example.test', 'Synthetic Other', 'founder', 1, 1)").run();
  const { revokeRaw } = await seedChange(f, 51, 'Pair.E9043@Example.test', 'new.e9043@example.test', true);
  const back = await post(f.env, '/api/settings/email-change/revoke', { token: revokeRaw });
  assert.equal(back.status, 200, JSON.stringify(back.body));
  assert.deepEqual(f.rows(), [{ id: 51, email: 'Pair.E9043@Example.test' }, { id: 52, email: 'pair.e9043@example.test' }]);
});

test('an account stored in mixed case before D9043 is found by every sign-in path, not duplicated', async () => {
  const f = fixture();
  f.db.prepare("INSERT INTO users (id, email, name, role, email_verified, is_active) VALUES (71, 'Legacy.L9043@Example.test', 'Synthetic Lee', 'founder', 1, 1)").run();
  assert.equal(await magicSignIn(f, 'legacy.l9043@example.test'), 71);
  const reg = await post(f.env, '/api/auth/register', { email: 'legacy.l9043@example.test', name: 'Synthetic Lee' });
  assert.equal(reg.status, 409, 'register finds the verified account');
  f.db.prepare("INSERT INTO users (id, email, name, role, email_verified, is_active) VALUES (900, 'admin9043@example.test', 'Synthetic Admin', 'admin', 1, 1)").run();
  const dup = await post(f.env, '/api/users', { email: 'LEGACY.l9043@example.test', name: 'Synthetic Lee', role: 'founder' }, await bearer(900, 'admin'));
  assert.equal(dup.status, 409, 'admin create finds it too');
  assert.deepEqual(f.rows().map((u) => u.id), [71, 900]);
});

test('a case pair seeded before D9043: every lookup picks the lowest id, and no flow creates a third row', async () => {
  const f = fixture();
  f.db.prepare("INSERT INTO users (id, email, name, role, email_verified, is_active) VALUES (61, 'Twin.T9043@Example.test', 'Synthetic Twin A', 'founder', 1, 1)").run();
  f.db.prepare("INSERT INTO users (id, email, name, role, email_verified, is_active) VALUES (60, 'twin.t9043@example.test', 'Synthetic Twin B', 'founder', 1, 1)").run();
  assert.equal(await magicSignIn(f, 'TWIN.T9043@example.test'), 60);
  assert.equal(await magicSignIn(f, 'Twin.T9043@Example.test'), 60, 'the exact stored case does not pick the other row');
  const reg = await post(f.env, '/api/auth/register', { email: 'twin.T9043@example.TEST', name: 'Synthetic Twin' });
  assert.equal(reg.status, 409);
  const sql = getSQL(f.env);
  const g = await googleTesting.resolveGoogleSignin(fakeCtx(f.env), sql, { sub: 'google-sub-9043-twin', email: 'Twin.T9043@Example.test', name: 'Synthetic Twin', hd: 'example.test' });
  assert.equal(g.ok, true, JSON.stringify(g));
  assert.equal(Number((g as any).user.id), 60, 'Google first sign-in picks the lowest id');
  const a = await appleTesting.resolveAppleSignin(fakeCtx(f.env), sql, { sub: 'apple-sub-9043-twin', email: 'Twin.T9043@Example.test', privateEmail: false }, { name: 'Synthetic Twin' });
  // Apple is not authoritative for a non-relay address, so it refuses; the refusal names the account it matched.
  assert.equal((a as any).code, 'link_requires_email_proof', JSON.stringify(a));
  assert.equal((a as any).userId, 60, 'Apple first sign-in matches the lowest id');
  assert.equal(f.rows().length, 2, 'the pair is left alone: not merged, not added to');
});

// ───────────────────────────────────────────────────────────── guard ──

const SRC = new URL('../src/', import.meta.url).pathname;
const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true })
  .flatMap((e) => e.isDirectory() ? walk(join(d, e.name)) : /\.ts$/.test(e.name) ? [join(d, e.name)] : []);

/** The text from `open` (an index of `(` or `{`) to its matching close, exclusive of both. */
function balanced(s: string, open: number): { inner: string; end: number } {
  const pairs: Record<string, string> = { '(': ')', '{': '}', '[': ']' };
  const stack: string[] = [];
  for (let i = open; i < s.length; i++) {
    const ch = s[i];
    if (pairs[ch]) stack.push(pairs[ch]);
    else if (ch === stack[stack.length - 1]) { stack.pop(); if (!stack.length) return { inner: s.slice(open + 1, i), end: i }; }
  }
  return { inner: s.slice(open + 1), end: s.length };
}

/** Splits on top-level commas (outside (), {}, [] and `${…}`). */
function splitTop(s: string): string[] {
  const out: string[] = []; let depth = 0; let cur = '';
  for (const ch of s) {
    if ('({['.includes(ch)) depth++;
    if (')}]'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** The address expression is normalised: a `normalizeEmail(…)` call, or a name whose nearest declaration is one. */
function normalised(src: string, at: number, expr: string): boolean {
  const e = expr.trim();
  if (/^normalizeEmail\(/.test(e)) return true;
  if (!/^[A-Za-z_$][\w$]*$/.test(e)) return false;
  const decl = new RegExp(`\\b(?:const|let|var)\\s+${e.replace(/\$/g, '\\$')}\\s*(?::[^=]+)?=\\s*([^;\\n]+)`, 'g');
  let last: string | null = null; let m: RegExpExecArray | null;
  while ((m = decl.exec(src)) && m.index < at) last = m[1];
  return last != null && /^normalizeEmail\(/.test(last.trim());
}

/** The bound value for the k-th `?` (0-based) of the statement whose literal closes at `literalEnd`. */
function bindArg(src: string, literalEnd: number, k: number): string | null {
  const b = /^\s*,?\s*\)?\s*\.bind\(/.exec(src.slice(literalEnd + 1));
  if (!b) return null;
  const open = literalEnd + 1 + b[0].length - 1;
  return splitTop(balanced(src, open).inner)[k] ?? null;
}

type Violation = { file: string; line: number; what: string };

function accountEmailViolations(file: string, src: string): Violation[] {
  const out: Violation[] = [];
  const lineOf = (i: number) => src.slice(0, i).split('\n').length;
  const exempt = (i: number) => /account-email-exact:/.test(src.slice(Math.max(0, src.lastIndexOf('\n', i - 1) - 400), i).split('\n').slice(-4).join('\n'));
  const literalEnd = (i: number) => {
    // The statement's own string literal: the nearest quote before it, closed by the same quote.
    const q = Math.max(src.lastIndexOf('`', i), src.lastIndexOf("'", i), src.lastIndexOf('"', i));
    const quote = src[q];
    let j = i;
    while (j < src.length) {
      if (quote === '`' && src.startsWith('${', j)) { j = balanced(src, j + 1).end + 1; continue; }
      if (src[j] === quote) return j;
      j++;
    }
    return src.length;
  };
  const check = (at: number, stmt: string, value: string, qIndex: number, what: string) => {
    if (exempt(at)) return;
    let expr: string | null = null;
    const t = value.trim();
    if (t.startsWith('${')) expr = balanced(t, 1).inner;
    else if (t === '?') expr = bindArg(src, literalEnd(at), qIndex);
    if (expr == null || !normalised(src, at, expr)) out.push({ file, line: lineOf(at), what: `${what}: ${t}${expr && t === '?' ? ` (bound ${expr})` : ''}` });
  };
  const ins = /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+users\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = ins.exec(src))) {
    const cols = balanced(src, m.index + m[0].length - 1);
    const rest = src.slice(cols.end + 1);
    const v = /^\s*VALUES\s*\(/i.exec(rest);
    if (!v) continue; // INSERT … SELECT copies rows that are already stored (usersRoleRebuild).
    const colList = splitTop(cols.inner).map((c) => c.toLowerCase());
    const idx = colList.indexOf('email');
    if (idx < 0) continue;
    const valsOpen = cols.end + 1 + v[0].length - 1;
    const vals = splitTop(balanced(src, valsOpen).inner);
    const qBefore = vals.slice(0, idx).filter((x) => x === '?').length;
    check(m.index, m[0], vals[idx] ?? '', qBefore, 'INSERT INTO users email');
  }
  const upd = /UPDATE\s+users\s+SET\s+/gi;
  while ((m = upd.exec(src))) {
    const end = literalEnd(m.index);
    const stmt = src.slice(m.index, end);
    const setClause = stmt.split(/\bWHERE\b/i)[0];
    const set = /(^|[\s,])email\s*=\s*(\$\{|\?)/i.exec(setClause);
    if (!set) continue;
    const from = m.index + set.index + set[0].length - set[2].length;
    const value = set[2] === '?' ? '?' : '${' + balanced(src, from + 1).inner + '}';
    const qBefore = (stmt.slice(0, set.index).match(/\?/g) || []).length;
    check(m.index, stmt, value, qBefore, 'UPDATE users SET email');
  }
  const look = /\bFROM\s+users(?:\s+(?:AS\s+)?(?!WHERE\b)\w+)?\s+WHERE\b([^`'";]{0,300})/gi;
  while ((m = look.exec(src))) {
    if (/(?<![\w(.])(?:\w+\.)?email\s*(?:=|\bIN\b)/i.test(m[1])) out.push({ file, line: lineOf(m.index), what: 'exact-match users.email lookup (use LOWER(email) = normalizeEmail(…))' });
  }
  return out;
}

test('guard: every users.email write passes through normalizeEmail, and no lookup matches users.email exactly', () => {
  const found: Violation[] = [];
  for (const f of walk(SRC)) found.push(...accountEmailViolations(relative(SRC, f), readFileSync(f, 'utf8')));
  assert.deepEqual(found, []);
});

test('guard: the checks fire on the shapes they exist for', () => {
  const v = (s: string) => accountEmailViolations('x.ts', s).map((x) => x.what.split(':')[0]);
  assert.deepEqual(v('const email = body.email;\nawait sql`INSERT INTO users (name, email) VALUES (${n}, ${email})`;'), ['INSERT INTO users email']);
  assert.deepEqual(v('const email = normalizeEmail(body.email);\nawait sql`INSERT INTO users (name, email) VALUES (${n}, ${email})`;'), []);
  assert.deepEqual(v("await db.prepare('INSERT INTO users (name, role, email) VALUES (?, ?, ?)').bind(n, r, raw).run();"), ['INSERT INTO users email']);
  assert.deepEqual(v("await db.prepare('INSERT INTO users (name, role, email) VALUES (?, ?, ?)').bind(n, r, normalizeEmail(raw)).run();"), []);
  assert.deepEqual(v('await sql`UPDATE users SET email = ${rec.new_email} WHERE id = ${id}`;'), ['UPDATE users SET email']);
  assert.deepEqual(v("await db.prepare('UPDATE users SET name = ?, email = ? WHERE id = ?').bind(n, normalizeEmail(e), id).run();"), []);
  assert.deepEqual(v("await db.prepare('UPDATE users SET name = ?, email = ? WHERE id = ?').bind(n, e, id).run();"), ['UPDATE users SET email']);
  assert.deepEqual(v("await db.prepare('UPDATE users SET name = ? WHERE LOWER(email) = ?').bind(n, e).run();"), [], 'a WHERE on email is not a write');
  assert.deepEqual(v('// account-email-exact: restores stored bytes\nawait sql`UPDATE users SET email = ${rec.old_email} WHERE id = ${id}`;'), []);
  assert.deepEqual(v("db.prepare('SELECT id FROM users WHERE email = ?')"), ['exact-match users.email lookup (use LOWER(email) = normalizeEmail(…))']);
  assert.deepEqual(v("db.prepare('SELECT id FROM users u WHERE u.is_active = 1 AND u.email = ?')"), ['exact-match users.email lookup (use LOWER(email) = normalizeEmail(…))']);
  assert.deepEqual(v("db.prepare('SELECT id FROM users WHERE LOWER(email) = ? ORDER BY id LIMIT 1')"), []);
  assert.deepEqual(v('let email = normalizeEmail(a);\nfunction g() { const email = b.email;\nsql`INSERT INTO users (email) VALUES (${email})`; }'), ['INSERT INTO users email'], 'the nearest declaration decides');
});
