// D1421 (#3699): moving the two paywall prefix arrays into
// middleware/paywallPrefixes.ts is behaviour-neutral, and /api/studio is
// mounted on the real app. Drives the whole Worker (`index.ts`).
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/studio_modules_registry_d1421.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { SignJWT } from 'jose';
import worker from '../src/index.ts';
import { makeD1 } from './_d1_sqlite.mjs';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';
import { memKV } from './_mem_kv.mjs';
import { STUDIO_PREFIXES, INVESTOR_PRO_PREFIXES, underPrefix } from '../src/middleware/paywallPrefixes.ts';

const JWT_SECRET = randomBytes(32).toString('hex');
const baseline = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const ctx: any = { waitUntil() {}, passThroughOnException() {} };

function env() {
  const fx = makeD1(stripForeignKeys(tableFromBaseline(baseline, 'users')));
  fx.db.exec(readFileSync(new URL('../sql/migrations/687_studio_layouts.sql', import.meta.url), 'utf8'));
  // D1594 (#3863): the layout's revision.
  fx.db.exec(readFileSync(new URL('../sql/migrations/750_studio_layout_revision.sql', import.meta.url), 'utf8'));
  fx.db.prepare("INSERT INTO users(id,name,email,role,is_active,subscription_tier) VALUES(1,'Synthetic','s1@example.test','founder',1,'free')").run();
  fx.db.prepare("INSERT INTO users(id,name,email,role,is_active,investor_tier) VALUES(2,'Synthetic','s2@example.test','investor',1,'free')").run();
  return { fx, env: { DB: fx.DB, JWT_SECRET, ENVIRONMENT: 'development', RATE_LIMITS: memKV(), TOKENS: memKV() } as any };
}
async function get(e: any, id: number, path: string) {
  const auth = `Bearer ${await new SignJWT({ user_id: id }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET))}`;
  const s = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await worker.fetch(new Request(`https://axal.vc${path}`, { headers: { authorization: auth } }), e, ctx);
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error] = s; }
}

test('the paywalls still answer as before: a free founder gets 402 on a Raise + Grow prefix, a free investor on a Professional one', async () => {
  const { fx, env: e } = env();
  try {
    const capital = await get(e, 1, '/api/capital');
    assert.deepEqual([capital.status, capital.body?.error, capital.body?.required], [402, 'tier_required', 'studio']);
    const deep = await get(e, 1, '/api/positions/analytics');
    assert.equal(deep.status, 402);
    const pipeline = await get(e, 2, '/api/pipeline');
    assert.deepEqual([pipeline.status, pipeline.body?.error], [402, 'investor_tier_required']);
  } finally { fx.db.close(); }
});

test('/api/studio is mounted on the real app', async () => {
  const { fx, env: e } = env();
  try {
    const r = await get(e, 1, '/api/studio/modules');
    assert.deepEqual([r.status, r.body.profile], [200, 'founder']);
    assert.equal((await get(e, 1, '/api/studio/layout')).body.source, 'default');
  } finally { fx.db.close(); }
});

test('the shared arrays are the ones index.ts used, and a prefix matches itself and its children only', () => {
  assert.equal(STUDIO_PREFIXES.length, 16);
  assert.ok(STUDIO_PREFIXES.includes('/api/capital') && STUDIO_PREFIXES.includes('/api/positions'));
  assert.deepEqual([...INVESTOR_PRO_PREFIXES], ['/api/dd', '/api/pipeline', '/api/deals', '/api/ic']);
  assert.equal(underPrefix('/api/deals', '/api/deals'), true);
  assert.equal(underPrefix('/api/deals/pipeline', '/api/deals'), true);
  assert.equal(underPrefix('/api/dealsx', '/api/deals'), false);
  assert.equal(underPrefix('/api/ddx/1', '/api/dd'), false);
});
