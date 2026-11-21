/** D8011: deterministic fake clock/network/crypto tests, never live security or capacity evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CapacityIssuerKeys, CapacityRequestBudget, CAPACITY_AUTH_LIMITS as L, CAPACITY_KEY_URL } from '../src/lib/ciCapacityAuthPolicy.ts';
import type { CapacityBudgetWindow, CapacityBudgetStore } from '../src/lib/ciCapacityAuthPolicy.ts';
import { authenticateCapacity, CAPACITY_ISSUER } from '../src/ciCapacityAuth.ts';

function clock() {
  let time = 0, serial = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  return {
    now: () => time,
    timer(callback: () => void, ms: number) { const id = ++serial; timers.set(id, { at: time + ms, callback }); return () => { timers.delete(id); }; },
    advance(ms: number) { time += ms; for (const [id, timer] of [...timers]) if (timer.at <= time) { timers.delete(id); timer.callback(); } },
    rewind(ms: number) { time -= ms; },
    pending: () => timers.size,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function store(): CapacityBudgetStore {
  let window: CapacityBudgetWindow | null = null;
  return { async update(decide) { const next = decide(structuredClone(window)); window = structuredClone(next.state); return next.accepted; } };
}
const key = (kid = 'k1') => ({ kty: 'RSA', alg: 'RS256', use: 'sig', kid, n: 'fixture_modulus', e: 'AQAB' });
const response = (...keys: ReturnType<typeof key>[]) => Response.json({ keys });
const identity = (run = 1) => ({ repository_id: '7', run_id: String(run), run_attempt: '1' });

test('cached material is copied, fixed-issuer-only, and refreshed at expiry', async () => {
  const c = clock(); let fetches = 0;
  const keys = new CapacityIssuerKeys(async (url, init) => {
    fetches++; assert.equal(url, CAPACITY_KEY_URL); assert.equal(init?.redirect, 'error'); assert.equal(init?.method, 'GET');
    return response(key());
  }, c);
  const first = await keys.get('k1'); first.n = 'changed';
  const cached = await keys.get('k1'); cached.n = 'changed again';
  assert.equal((await keys.get('k1')).n, 'fixture_modulus'); assert.equal(fetches, 1);
  c.advance(L.keyLifetimeMs - 1); await keys.get('k1'); assert.equal(fetches, 1);
  c.advance(1); await keys.get('k1'); assert.equal(fetches, 2); assert.equal(c.pending(), 0);
});

test('rotation replaces the set, and arbitrary unknown IDs share one refresh cooldown', async () => {
  const c = clock(); let fetches = 0;
  const keys = new CapacityIssuerKeys(async () => ++fetches === 1 ? response(key()) : response(key('k2')), c);
  await keys.get('k1');
  for (let i = 0; i < 100; i++) await assert.rejects(keys.get(`unknown-${i}`), /refresh_limited/);
  assert.equal(fetches, 1);
  c.advance(L.refreshIntervalMs);
  assert.equal((await keys.get('k2')).kid, 'k2'); assert.equal(fetches, 2);
  await assert.rejects(keys.get('k1'), /refresh_limited/);
  await assert.rejects(keys.get('https://other.invalid'), /invalid_key_id/);
});

test('provider failure backs off and never serves expired material', async () => {
  const c = clock(); let fetches = 0, down = false;
  const keys = new CapacityIssuerKeys(async () => { fetches++; if (down) throw Error('fake network'); return response(key()); }, c);
  await keys.get('k1'); down = true; c.advance(L.refreshIntervalMs);
  await assert.rejects(keys.get('unknown'), /keys_unavailable/);
  assert.equal((await keys.get('k1')).n, 'fixture_modulus', 'still fresh known keys survive unrelated lookup failure');
  c.advance(L.keyLifetimeMs);
  await assert.rejects(keys.get('k1'), /keys_unavailable/);
  const before = fetches;
  await assert.rejects(keys.get('k1'), /refresh_limited/); assert.equal(fetches, before);
  c.advance(L.refreshIntervalMs); down = false;
  assert.equal((await keys.get('k1')).n, 'fixture_modulus');
});

test('concurrent lookups coalesce, excess waiters fail immediately', async () => {
  const c = clock(), done = deferred<Response>(), started = deferred<void>(); let fetches = 0;
  const keys = new CapacityIssuerKeys(async () => { fetches++; started.resolve(); return done.promise; }, c);
  const waiting = Array.from({ length: L.keyWaiters }, () => keys.get('k1'));
  await started.promise;
  await assert.rejects(keys.get('k1'), /waiters_limited/); assert.equal(fetches, 1);
  done.resolve(response(key()));
  assert.equal((await Promise.all(waiting)).every(k => k.n === 'fixture_modulus'), true);
  assert.equal(c.pending(), 0);
});

test('timeout aborts and retains a non-cooperative native slot, ignoring late data', async () => {
  const c = clock(), done = deferred<Response>(), started = deferred<void>(), settled = deferred<void>(); let fetches = 0, signal: AbortSignal | null = null;
  const keys = new CapacityIssuerKeys(async (_url, init) => { fetches++; if (fetches > 1) return new Response(null, { status: 503 }); signal = init?.signal ?? null; started.resolve(); return done.promise; }, c);
  const pending = assert.rejects(keys.get('k1'), /keys_unavailable/);
  await started.promise; c.advance(L.keyDeadlineMs); await pending;
  assert.equal((signal as AbortSignal | null)?.aborted, true);
  c.advance(L.refreshIntervalMs);
  await assert.rejects(keys.get('k1'), /keys_unavailable/); assert.equal(fetches, 1);
  let read = false;
  const bytes = new TextEncoder().encode(JSON.stringify({ keys: [key()] }));
  done.resolve({ ok: true, redirected: false, body: {
    cancel: async () => { settled.resolve(); },
    getReader: () => ({ read: async () => { if (read) return { done: true }; read = true; return { done: false, value: bytes }; }, cancel: async () => { settled.resolve(); } }),
  } } as unknown as Response);
  // The fake body's cancellation marks actual settlement, not a fixed tick wait.
  await settled.promise; await assert.rejects(keys.get('k1'), /keys_unavailable|refresh_limited/);
  assert.equal(fetches, 1);
});

test('key document bounds reject excess bytes, keys, malformed and duplicate material', async () => {
  for (const make of [
    () => Response.json({ keys: [key()], extension: 'x'.repeat(L.keyBytes) }),
    () => response(...Array.from({ length: L.keyCount + 1 }, (_, i) => key(`k${i}`))),
    () => response(key(), key()),
    () => response({ ...key(), n: 'x'.repeat(1025) }),
    () => response({ ...key(), alg: 'none' }),
    () => Response.json({ keys: [] }),
    () => new Response('not JSON'),
    () => new Response(null, { status: 503 }),
  ]) {
    const keys = new CapacityIssuerKeys(async () => make(), clock());
    await assert.rejects(keys.get('k1'), /keys_unavailable/);
  }
});

test('empty streaming chunks are bounded and slow bodies use the same deadline', async () => {
  let pulls = 0, cancelled = false;
  const empty = new CapacityIssuerKeys(async () => new Response(new ReadableStream({
    pull(controller) { pulls++; controller.enqueue(new Uint8Array()); }, cancel() { cancelled = true; },
  })), clock());
  await assert.rejects(empty.get('k1'), /keys_unavailable/);
  assert.ok(pulls <= L.keyChunks + 1); assert.equal(cancelled, true);
  const c = clock(), started = deferred<void>();
  const slow = new CapacityIssuerKeys(async () => new Response(new ReadableStream({ pull() { started.resolve(); } })), c);
  const waiting = assert.rejects(slow.get('k1'), /keys_unavailable/);
  await started.promise; c.advance(L.keyDeadlineMs); await waiting;
});

test('unauthenticated failures use no work lane and verification allowance resets by fake time', async () => {
  const c = clock(), b = new CapacityRequestBudget(store(), c); let verifications = 0, work = 0;
  for (let i = 0; i < L.authPerWindow; i++) await assert.rejects(b.run(async () => { verifications++; throw Error('bad token'); }, () => 'receipt', async () => { work++; }), /bad token/);
  await assert.rejects(b.run(async () => identity(), () => 'receipt', async () => { work++; }), /auth_limited/);
  assert.equal(verifications, L.authPerWindow); assert.equal(work, 0);
  c.advance(L.windowMs);
  assert.equal(await b.run(async () => identity(), () => 'receipt', async () => 'receipt progressed'), 'receipt progressed');
});

test('submission exhaustion preserves a separate authenticated receipt budget', async () => {
  const b = new CapacityRequestBudget(store(), clock()); let work = 0;
  for (let i = 0; i < L.submitPerWindow; i++) await b.run(async () => identity(Math.floor(i / L.submitPerCaller) + 1), () => 'submit', async () => { work++; });
  await assert.rejects(b.run(async () => identity(20), () => 'submit', async () => { work++; }), /work_limited/);
  assert.equal(await b.run(async () => identity(99), () => 'receipt', async () => 'owned receipt'), 'owned receipt');
  assert.equal(work, L.submitPerWindow);
  await assert.rejects(b.run(async () => identity(99), () => null, async () => { work++; }), /lane_unauthorized/);
});

test('caller quotas cannot be evicted by new identities, and active work survives a window reset', async () => {
  const c = clock(), b = new CapacityRequestBudget(store(), c);
  for (let i = 0; i < L.receiptCallers; i++) await b.run(async () => identity(i + 1), () => 'receipt', async () => 1);
  await assert.rejects(b.run(async () => identity(999), () => 'receipt', async () => 1), /work_limited/);
  for (let i = 1; i < L.receiptPerCaller; i++) await b.run(async () => identity(1), () => 'receipt', async () => 1);
  await assert.rejects(b.run(async () => identity(1), () => 'receipt', async () => 1), /work_limited/);
  c.advance(L.windowMs);
  const finish = deferred<number>(), starts = Array.from({ length: L.receiptConcurrent }, () => deferred<void>());
  const active = starts.map((start, i) => b.run(async () => identity(i + 1), () => 'receipt', async () => { start.resolve(); return finish.promise; }));
  await Promise.all(starts.map(s => s.promise)); c.advance(L.windowMs);
  await assert.rejects(b.run(async () => identity(10), () => 'receipt', async () => 1), /work_limited/);
  assert.equal(await b.run(async () => identity(10), () => 'submit', async () => 2), 2);
  finish.resolve(1); await Promise.all(active);
  assert.equal(await b.run(async () => identity(10), () => 'receipt', async () => 3), 3);
});

test('verification timeout never releases a still-running native verification slot', async () => {
  const c = clock(), b = new CapacityRequestBudget(store(), c), finish = deferred<ReturnType<typeof identity>>();
  const starts = Array.from({ length: L.authConcurrent }, () => deferred<void>());
  const waiting = starts.map(start => assert.rejects(b.run(async () => { start.resolve(); return finish.promise; }, () => 'receipt', async () => assert.fail('late verification must not run work')), /auth_timeout/));
  await Promise.all(starts.map(s => s.promise)); c.advance(L.authDeadlineMs); await Promise.all(waiting);
  c.advance(L.windowMs);
  await assert.rejects(b.run(async () => identity(), () => 'receipt', async () => 1), /auth_limited/);
  finish.resolve(identity());
});

test('backwards clock movement cannot reset a caller allowance', async () => {
  const c = clock(), b = new CapacityRequestBudget(store(), c); c.advance(L.windowMs);
  for (let i = 0; i < L.submitPerCaller; i++) await b.run(async () => identity(), () => 'submit', async () => 1);
  c.rewind(L.windowMs);
  await assert.rejects(b.run(async () => identity(), () => 'submit', async () => 1), /work_limited/);
});

test('composed fixture caches only key material and still verifies every signature and original claim', async t => {
  const c = clock(); let fetches = 0, signatures = 0, signatureValid = true;
  const keys = new CapacityIssuerKeys(async () => { fetches++; return response(key()); }, c);
  // Explicit fake native boundary. No signed-token/live-provider proof is claimed here.
  t.mock.method(crypto.subtle, 'importKey', async () => ({}));
  t.mock.method(crypto.subtle, 'verify', async () => { signatures++; return signatureValid; });
  const now = 1_800_000_000_000, repo = 'AxalNetwork/StudioOS';
  const claims = { ...identity(), iss: CAPACITY_ISSUER, aud: 'fixture', sub: `repo:${repo}:ref:refs/heads/main`, repository: repo,
    exp: now / 1000 + 300, iat: now / 1000, nbf: now / 1000 - 1, ref: 'refs/heads/main', event_name: 'push',
    sha: 'a'.repeat(40), workflow_ref: `${repo}/.github/workflows/ci.yml@refs/heads/main`, workflow_sha: 'b'.repeat(40) };
  const verify = async (patch = {}) => {
    const token = [ { alg: 'RS256', kid: 'k1' }, { ...claims, ...patch } ].map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.c2ln';
    const request = new Request('https://capacity.invalid', { headers: { authorization: `Bearer ${token}` } });
    return authenticateCapacity(request, 'fixture', repo, async () => Response.json({ keys: [await keys.get('k1')] }), now);
  };
  await verify(); await verify(); assert.equal(signatures, 2); assert.equal(fetches, 1);
  signatureValid = false; await assert.rejects(verify(), /bad_signature/); signatureValid = true;
  for (const patch of [{ aud: 'other' }, { repository: 'fork/StudioOS' }, { exp: now / 1000 }, { iss: 'https://other.invalid' }, { run_attempt: '0' }, { nbf: now / 1000 + 1 }]) await assert.rejects(verify(patch), /claims_refused/);
  assert.equal(fetches, 1); assert.equal(signatures, 9);
});


test('durable reservations survive replacement policy instances and reject invalid storage', async () => {
  const c = clock(), persisted = store();
  for (let i = 0; i < L.submitPerCaller; i++) await new CapacityRequestBudget(persisted, c).run(async () => identity(), () => 'submit', async () => 1);
  await assert.rejects(new CapacityRequestBudget(persisted, c).run(async () => identity(), () => 'submit', async () => 1), /work_limited/);
  c.advance(L.windowMs);
  assert.equal(await new CapacityRequestBudget(persisted, c).run(async () => identity(), () => 'submit', async () => 2), 2);
  const corrupt: CapacityBudgetStore = { async update(decide) { return decide({ version: 1, window: 0, authUsed: 999, progressAuthUsed: 0, lanes: { receipt: { used: 0, callers: [] }, submit: { used: 0, callers: [] } } }).accepted; } };
  await assert.rejects(new CapacityRequestBudget(corrupt, c).run(async () => identity(), () => 'receipt', async () => assert.fail('corrupt state must not authorize work')), /budget_state_invalid/);
});


test('late durable admission does not start native verification after its deadline', async () => {
  const c = clock(), started = deferred<void>(), finish = deferred<boolean>(); let verified = 0;
  const delayed: CapacityBudgetStore = { async update() { started.resolve(); return finish.promise; } };
  const budget = new CapacityRequestBudget(delayed, c);
  const request = assert.rejects(budget.run(async () => { verified++; return identity(); }, () => 'receipt', async () => assert.fail('expired request must not run work')), /auth_timeout/);
  await started.promise; c.advance(L.authDeadlineMs); await request;
  finish.resolve(true);
  // A second admitted request completes behind the first settlement and exposes any late verify.
  await assert.rejects(budget.run(async () => { throw Error('probe'); }, () => 'receipt', async () => 1), /probe/);
  assert.equal(verified, 0);
});


test('proven receipt token gets protected verification progress after an unauthenticated flood', async () => {
  const c = clock(), b = new CapacityRequestBudget(store(), c); let verifications = 0;
  const caller = { ...identity(), exp: 300 };
  const progress = { token: 'fixture.signed.receipt', ownedReceipt: (active: boolean) => active === true };
  const verify = async () => { verifications++; return caller; };
  assert.equal(await b.run(verify, () => 'receipt', async () => true, progress), true);
  for (let i = 1; i < L.authPerWindow; i++) await assert.rejects(b.run(async () => { throw Error('unauthorized'); }, () => 'receipt', async () => assert.fail()), /unauthorized/);
  await assert.rejects(b.run(verify, () => 'receipt', async () => true), /auth_limited/);
  assert.equal(await b.run(verify, () => 'receipt', async () => true, progress), true);
  assert.equal(verifications, 2, 'priority still verifies every token');
  await assert.rejects(b.run(async () => { throw Error('revoked'); }, () => 'receipt', async () => assert.fail(), progress), /revoked/);
  await assert.rejects(b.run(verify, () => 'receipt', async () => true, { ...progress, token: 'forged.same.claims' }), /auth_limited/);
  c.advance(L.progressProofMs);
  await assert.rejects(b.run(verify, () => 'receipt', async () => true, progress), /auth_limited/);
});

test('a path, failed lookup, or unverified token cannot obtain priority', async () => {
  const b = new CapacityRequestBudget(store(), clock());
  const progress = { token: 'unowned.receipt.token', ownedReceipt: (active: boolean) => active === true };
  await b.run(async () => ({ ...identity(), exp: 300 }), () => 'receipt', async () => false, progress);
  for (let i = 1; i < L.authPerWindow; i++) await assert.rejects(b.run(async () => { throw Error('bad'); }, () => 'receipt', async () => false, progress), /bad/);
  await assert.rejects(b.run(async () => ({ ...identity(), exp: 300 }), () => 'receipt', async () => true, progress), /auth_limited/);
});

test('ordinary verification concurrency cannot consume the proven-receipt slots', async () => {
  const c = clock(), b = new CapacityRequestBudget(store(), c);
  const progress = { token: 'known.signed.token', ownedReceipt: (active: boolean) => active };
  const known = { ...identity(), exp: 300 };
  await b.run(async () => known, () => 'receipt', async () => true, progress);
  const finish = deferred<ReturnType<typeof identity>>();
  const starts = Array.from({ length: L.authConcurrent }, () => deferred<void>());
  const waiting = Promise.allSettled(starts.map(start => b.run(async () => { start.resolve(); return finish.promise; }, () => null, async () => assert.fail())));
  await Promise.all(starts.map(s => s.promise));
  await assert.rejects(b.run(async () => known, () => 'receipt', async () => true), /auth_limited/);
  assert.equal(await b.run(async () => known, () => 'receipt', async () => true, progress), true);
  finish.resolve(identity());
  assert.equal((await waiting).every(result => result.status === 'rejected'), true);
});
