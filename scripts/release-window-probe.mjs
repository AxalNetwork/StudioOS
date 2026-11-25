#!/usr/bin/env node
// D8532 (#8532): one Worker, one database, one fixed set of requests.
//
// The release-window rehearsal (`scripts/release-window-rehearsal.mjs`,
// `scripts/lib/releaseWindow.mjs`) runs this file in a child process, once per
// Worker and phase, so the Worker it loads is exactly the tree it is pointed
// at: the BASE commit's `cloudflare-worker/` for "the old Worker on the new
// schema", the candidate's for the retry. It must be started with that tree's
// own TypeScript loader:
//
//   node --experimental-strip-types --no-warnings \
//     --import <worker>/test/_ts-loader.mjs scripts/release-window-probe.mjs \
//     --worker <worker> --db <file.sqlite> --mode seed|probe
//
//   seed   writes the synthetic fixture (FIXTURE below) into the database: an
//          account on a paid plan with a TOTP sign-in, a free account with an
//          access grant to a project, an outsider, and that project. The TOTP
//          secret is encrypted with THAT Worker's own column cipher, so the
//          stored row is the one production's Worker would have written.
//   probe  asks the Worker the fixed questions (PROBES) and prints one JSON
//          object: each probe's normalised answer. Nothing time- or
//          token-dependent is kept, so two runs over the same data compare equal.
//
// The hashed asset is not a D1 row: the Worker answers `/assets/*` from its
// ASSETS binding before any D1 work (index.ts, Task #37). The fixture asset
// lives in the stub binding below, with the SPA fallback answering every
// other path as production's `not_found_handling` does.
//
// Every value here is synthetic (`*.invalid` addresses, a fixture-only signing
// key and TOTP secret). No network: no binding here reaches outside the process.
import { createHmac, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { d1Over } from '../cloudflare-worker/test/_d1_sqlite.mjs';
import { memKV } from '../cloudflare-worker/test/_mem_kv.mjs';

// A fixture signing key and TOTP secret; never a service credential.
export const JWT_SECRET = 'd8532-release-window-fixture-only-'.repeat(2);
const TOTP_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

export const FIXTURE = Object.freeze({
  owner: { id: 853201, email: 'owner@release-window.invalid', tier: 'studio' },
  member: { id: 853202, email: 'member@release-window.invalid', tier: 'free' },
  outsider: { id: 853203, email: 'outsider@release-window.invalid', tier: 'free' },
  founderId: 853201,
  project: { id: 853201, name: 'Release window rehearsal venture' },
  // A content-hashed SPA asset, as Vite names them, and one that no build holds.
  asset: { path: '/assets/index-8532a1b2c3d4.js', body: 'export const rehearsal = 8532;\n' },
  missingAsset: '/assets/index-000000000000.js',
});

function arg(name) {
  const at = process.argv.indexOf(name);
  return at < 0 ? null : process.argv[at + 1];
}

/** RFC 6238 with the authenticator defaults the Worker validates (SHA-1, 6 digits, 30 s). */
function totp(secret, at = Date.now()) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of secret) bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30000)));
  const mac = createHmac('sha1', key).update(counter).digest();
  const off = mac[mac.length - 1] & 0xf;
  const code = (mac.readUInt32BE(off) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, '0');
}

/** An HS256 token the Worker's `requireAuth` accepts, as the Worker tests mint them. */
function token(userId) {
  const b64 = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const iat = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ user_id: userId, iat, exp: iat + 1800 })}`;
  return `${body}.${createHmac('sha256', JWT_SECRET).update(body).digest('base64url')}`;
}

function assetsStub() {
  return {
    async fetch(request) {
      const { pathname } = new URL(typeof request === 'string' ? request : request.url);
      if (pathname === FIXTURE.asset.path) {
        return new Response(FIXTURE.asset.body, { status: 200, headers: { 'content-type': 'text/javascript; charset=utf-8' } });
      }
      // not_found_handling = "single-page-application": the shell, as HTML.
      return new Response('<!doctype html><title>shell</title>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    },
  };
}

const sha = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);

async function seed(worker, db) {
  const { encryptColumn } = await import(pathToFileURL(join(worker, 'src/services/columnCipher.ts')).href);
  const env = { JWT_SECRET, ENVIRONMENT: 'development' };
  const { owner, member, outsider, founderId, project } = FIXTURE;
  const user = db.prepare(`INSERT INTO users (id, uid, name, email, role, is_active, email_verified,
      subscription_tier, subscription_status, founder_id) VALUES (?, ?, ?, ?, 'founder', 1, 1, ?, 'active', ?)`);
  db.prepare('INSERT INTO founders (id, name, email) VALUES (?, ?, ?)').run(founderId, 'Rehearsal Owner', owner.email);
  user.run(owner.id, `rw-${owner.id}`, 'Rehearsal Owner', owner.email, owner.tier, founderId);
  user.run(member.id, `rw-${member.id}`, 'Rehearsal Member', member.email, member.tier, null);
  user.run(outsider.id, `rw-${outsider.id}`, 'Rehearsal Outsider', outsider.email, outsider.tier, null);
  db.prepare('INSERT INTO auth_totp (user_id, secret_ct, recovery_hashes) VALUES (?, ?, ?)')
    .run(owner.id, await encryptColumn(env, 'auth_totp', 'secret', owner.id, TOTP_SECRET), '[]');
  db.prepare('INSERT INTO projects (id, name, founder_id) VALUES (?, ?, ?)').run(project.id, project.name, founderId);
  db.prepare(`INSERT INTO project_members (project_id, user_id, role, status) VALUES (?, ?, 'cofounder', 'accepted')`)
    .run(project.id, member.id);
  return { seeded: ['account with an entitlement', 'access grant', 'project', 'TOTP sign-in', 'hashed asset (ASSETS binding)'] };
}

/** The fixed questions. Each answer keeps only what must not change across a migration. */
export const PROBES = Object.freeze([
  'sign-in', 'sign-in:me', 'entitlement:paid', 'entitlement:free', 'grant:member', 'grant:outsider', 'asset:hashed', 'asset:missing',
]);

async function probe(worker, db) {
  const { default: app } = await import(pathToFileURL(join(worker, 'src/index.ts')).href);
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  const env = () => ({ DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', RATE_LIMITS: memKV(), TOKENS: memKV(), ASSETS: assetsStub() });
  const send = async (path, { method = 'GET', who = null, bearer = null, body } = {}) => {
    const auth = bearer ?? (who ? token(who) : null);
    const res = await app.fetch(new Request(`https://rehearsal.invalid${path}`, {
      method, redirect: 'manual',
      headers: { ...(auth ? { authorization: `Bearer ${auth}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }), env(), ctx);
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, type: (res.headers.get('content-type') || '').split(';')[0], text, json };
  };
  const { owner, member, outsider, project, asset, missingAsset } = FIXTURE;
  const out = {};

  const login = await send('/api/auth/login', { method: 'POST', body: { email: owner.email, totp_code: totp(TOTP_SECRET) } });
  out['sign-in'] = { status: login.status, user_id: login.json?.user?.id ?? login.json?.user_id ?? null, error: login.status === 200 ? null : (login.json?.error ?? login.json?.detail ?? null) };
  const me = await send('/api/auth/me', { bearer: login.json?.token ?? token(owner.id) });
  out['sign-in:me'] = { status: me.status, id: me.json?.id ?? me.json?.user?.id ?? null, email: me.json?.email ?? me.json?.user?.email ?? null };

  // The Raise + Grow gate (middleware/requireTier.ts) on GET /api/funds: the paid account reads the list, the free one gets the 402 upsell.
  const paid = await send('/api/funds', { who: owner.id });
  out['entitlement:paid'] = { status: paid.status, passed_gate: paid.status !== 402 && paid.status < 500 };
  const free = await send('/api/funds', { who: outsider.id });
  out['entitlement:free'] = { status: free.status, error: free.json?.error ?? null };

  // The access grant: an accepted project_members row lets the member read the project; the outsider has none.
  const granted = await send(`/api/projects/${project.id}`, { who: member.id });
  out['grant:member'] = { status: granted.status, name: granted.json?.name ?? granted.json?.project?.name ?? null };
  const refused = await send(`/api/projects/${project.id}`, { who: outsider.id });
  out['grant:outsider'] = { status: refused.status };

  const hit = await send(asset.path);
  out['asset:hashed'] = { status: hit.status, type: hit.type, body_sha256: sha(hit.text) };
  const miss = await send(missingAsset);
  out['asset:missing'] = { status: miss.status, type: miss.type };
  return out;
}

async function main() {
  const worker = arg('--worker');
  const file = arg('--db');
  const mode = arg('--mode');
  if (!worker || !file || !['seed', 'probe'].includes(mode)) {
    console.error('usage: release-window-probe.mjs --worker <cloudflare-worker dir> --db <file.sqlite> --mode seed|probe');
    process.exit(2);
  }
  const db = new DatabaseSync(file, { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  // The Worker logs freely; keep stdout for the one JSON line the driver reads.
  const log = console.log;
  console.log = console.info = console.warn = console.debug = (...a) => process.stderr.write(`${a.join(' ')}\n`);
  try {
    const result = mode === 'seed' ? await seed(worker, db) : await probe(worker, db);
    log(`@@probe ${JSON.stringify(result)}`);
  } finally { db.close(); }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e?.stack || e); process.exit(1); });
}
