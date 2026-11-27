// #1903 — the five OAuth refresh leases hold: KV's 60-second minimum TTL, one
// shared helper, one token call per expired connection. Fixtures only; every
// token endpoint is a stubbed `fetch`, and a URL no stub answers fails.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { d1Over } from './_d1_sqlite.mjs';
import { memKV } from './_mem_kv.mjs';
import { REFRESH_LEASE_TTL_S, acquireRefreshLease } from '../src/integrations/refreshLease.ts';
import { encryptCredentials, decryptCredentials } from '../src/integrations/secrets.ts';
import * as hubspot from '../src/integrations/providers/hubspot.ts';
import * as calendly from '../src/integrations/providers/calendly.ts';
import * as carta from '../src/integrations/providers/carta.ts';
import * as docusign from '../src/integrations/providers/docusign.ts';
import * as salesforce from '../src/integrations/providers/salesforce.ts';

const CLIENTS = {
  HUBSPOT_CLIENT_ID: 'hs-fixture', HUBSPOT_CLIENT_SECRET: 'hs-fixture-secret',
  CALENDLY_CLIENT_ID: 'cl-fixture', CALENDLY_CLIENT_SECRET: 'cl-fixture-secret',
  CARTA_CLIENT_ID: 'ca-fixture', CARTA_CLIENT_SECRET: 'ca-fixture-secret',
  DOCUSIGN_CLIENT_ID: 'ds-fixture', DOCUSIGN_CLIENT_SECRET: 'ds-fixture-secret',
  SF_CLIENT_ID: 'sf-fixture', SF_CLIENT_SECRET: 'sf-fixture-secret',
};

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE integrations(id INTEGER PRIMARY KEY, uid TEXT UNIQUE, user_id INTEGER, provider_key TEXT, status TEXT DEFAULT 'active',
    auth_type TEXT, credentials_enc TEXT, config_json TEXT, last_error TEXT, last_error_at TEXT, updated_at TEXT)`);
  const kv = memKV();
  const env = { DB: d1Over(db), RATE_LIMITS: kv, JWT_SECRET: 'kv-refresh-lease-fixture-signing-secret-0123456789', ENVIRONMENT: 'development', ...CLIENTS } as any;
  return { db, env, kv };
}

/** A connection whose access token expired an hour ago. */
async function seed(f: any, provider: string, extra: Record<string, unknown> = {}) {
  const uid = `${provider}-uid-fixture`;
  const creds = { access_token: 'old-access', refresh_token: 'old-refresh', token_type: 'Bearer', expires_at: Date.now() - 3600_000, ...extra };
  const enc = await encryptCredentials(f.env, uid, creds);
  f.db.prepare("INSERT INTO integrations(id, uid, user_id, provider_key, auth_type, credentials_enc, config_json) VALUES (1, ?, 1, ?, 'oauth2', ?, '{}')").run(uid, provider, enc);
  return { id: 1, uid, user_id: 1, provider_key: provider, credentials_enc: enc, config_json: '{}' } as any;
}

const TOKEN_URLS: Record<string, string> = {
  hubspot: 'https://api.hubapi.com/oauth/v1/token',
  calendly: 'https://auth.calendly.com/oauth/token',
  carta: 'https://login.app.carta.com/o/access_token/',
  docusign: 'https://account-d.docusign.com/oauth/token',
  salesforce: 'https://login.salesforce.com/services/oauth2/token',
};
const TOKEN_ANSWER = (provider: string) => provider === 'salesforce'
  ? { access_token: 'new-access', refresh_token: 'new-refresh', token_type: 'Bearer', instance_url: 'https://fixture.my.salesforce.com', issued_at: String(Date.now()) }
  : { access_token: 'new-access', refresh_token: 'new-refresh', token_type: 'Bearer', expires_in: 3600 };

/** Stub fetch: the provider's token URL answers (optionally held open); anything else fails the test. */
function stubToken(provider: string, { hold }: { hold?: Promise<void> } = {}) {
  const before = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: any) => {
    const url = String(input?.url ?? input);
    calls.push(url);
    if (url !== TOKEN_URLS[provider]) throw new Error(`unstubbed fetch: ${url}`);
    if (hold) await hold;
    return new Response(JSON.stringify(TOKEN_ANSWER(provider)), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as any;
  return { calls, restore: () => { globalThis.fetch = before; } };
}

/** Count the losers' 500 ms polls. */
function countPolls() {
  const before = globalThis.setTimeout;
  let polls = 0;
  globalThis.setTimeout = ((fn: any, ms?: number, ...rest: any[]) => { if (ms === 500) polls += 1; return before(fn, ms, ...rest); }) as any;
  return { get polls() { return polls; }, restore: () => { globalThis.setTimeout = before; } };
}

const READ: Record<string, (env: any, row: any) => Promise<unknown>> = {
  hubspot: hubspot.getActiveAccessToken,
  calendly: calendly.getActiveAccessToken,
  carta: carta.refreshAndPersist,
  docusign: docusign.refreshAndPersist,
  salesforce: salesforce.refreshAndPersist,
};
const tokenOf = (answer: unknown) => (typeof answer === 'string' ? answer : (answer as any)?.token);

test('the helper: the first caller acquires with a TTL of at least 60; a second does not; only the winner\'s release removes the key', async () => {
  const f = fixture();
  const puts: any[] = [];
  const put = f.kv.put.bind(f.kv);
  f.kv.put = async (key: string, value: string, opts: any) => { puts.push(opts); return put(key, value, opts); };
  assert.ok(REFRESH_LEASE_TTL_S >= 60);
  const first = await acquireRefreshLease(f.env, 'hubspot', 'uid-1');
  assert.equal(first.acquired, true);
  assert.ok(puts[0].expirationTtl >= 60, JSON.stringify(puts[0]));
  const key = 'hubspot:refresh:uid-1';
  const held = await f.kv.get(key);
  assert.match(String(held), /^[0-9a-f-]{36}$/);
  const second = await acquireRefreshLease(f.env, 'hubspot', 'uid-1');
  assert.equal(second.acquired, false);
  await second.release();
  assert.equal(await f.kv.get(key), held, 'the loser\'s release leaves the winner\'s key');
  await first.release();
  assert.equal(await f.kv.get(key), null);
  f.db.close();
});

test('the test KV refuses a TTL under 60, as Workers KV does', async () => {
  const kv = memKV();
  await assert.rejects(() => kv.put('k', 'v', { expirationTtl: 30 }), /Invalid expiration_ttl of 30\. Expiration TTL must be at least 60\./);
  await assert.rejects(() => kv.put('k', 'v', { expiration: Math.floor(Date.now() / 1000) + 10 }), /at least 60 seconds/);
  await kv.put('k', 'v', { expirationTtl: 60 });
  assert.equal(await kv.get('k'), 'v');
});

for (const provider of Object.keys(READ)) {
  test(`${provider}: one read of an expired token refreshes once, stores it, and never polls`, async () => {
    const f = fixture();
    const row = await seed(f, provider);
    const fetches = stubToken(provider);
    const timers = countPolls();
    try {
      const answer = await READ[provider](f.env, row);
      assert.equal(tokenOf(answer), 'new-access');
      assert.equal(fetches.calls.length, 1);
      assert.equal(timers.polls, 0, 'the caller held the lease, so no 500 ms poll ran');
      const stored = f.db.prepare('SELECT credentials_enc FROM integrations WHERE id = 1').get() as any;
      assert.equal((await decryptCredentials(f.env, row.uid, stored.credentials_enc))?.access_token, 'new-access');
      assert.equal(await f.kv.get(`${provider}:refresh:${row.uid}`), null, 'the winner released the lease');
    } finally { timers.restore(); fetches.restore(); f.db.close(); }
  });
}

for (const provider of ['hubspot', 'salesforce']) {
  test(`${provider}: two concurrent reads of one expired connection call the token endpoint once`, async () => {
    const f = fixture();
    const row = await seed(f, provider);
    let open!: () => void;
    const hold = new Promise<void>((r) => { open = r; });
    const fetches = stubToken(provider, { hold });
    try {
      const a = READ[provider](f.env, row);
      const b = READ[provider](f.env, row);
      // Both have started (one holds the lease, one waits) before the token call answers.
      await new Promise((r) => setTimeout(r, 50));
      open();
      const [ra, rb] = await Promise.all([a, b]);
      assert.equal(fetches.calls.length, 1);
      assert.deepEqual([tokenOf(ra), tokenOf(rb)], ['new-access', 'new-access']);
    } finally { fetches.restore(); f.db.close(); }
  });
}

test('no literal expirationTtl under 60 anywhere in cloudflare-worker/src', () => {
  const root = new URL('../src/', import.meta.url).pathname;
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.ts')) files.push(p);
    }
  };
  walk(root);
  assert.ok(files.length > 100);
  const found: string[] = [];
  for (const file of files) {
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      // A bare literal that is the whole value (`expirationTtl: 30,` or `30 }`),
      // not an expression such as `30 * 86400`.
      for (const m of line.matchAll(/expirationTtl\s*:\s*(\d+)\s*[,}]/g)) {
        if (Number(m[1]) < 60) found.push(`${file.slice(root.length)}:${i + 1}: expirationTtl ${m[1]}`);
      }
    });
  }
  assert.deepEqual(found, []);
});
