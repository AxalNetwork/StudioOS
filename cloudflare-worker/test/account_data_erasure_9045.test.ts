/**
 * #9045 (D9045): every account-erasure answer of the account data inventory is what the code does.
 *
 * A synthetic person gets a row in every D1 store and an object under every R2 template the inventory lists, beside a
 * control person (`_account_stores_9045.ts`). The platform's one account erasure (`eraseAccountAgents`, D1530) runs
 * on the person and every store is read again: `removed` must be gone, `changed` changed, `kept` and an `untouched`
 * answer unchanged. The control person's rows, objects and keys are never touched. A store the test cannot read must
 * say `unknown`.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ACCOUNT_STORES, type ErasureAnswer } from '../src/services/accountDataInventory.ts';
import { buildWorld, eraseSubject, kvSnapshot, observe, rolledBack, rowOf, SUBJECT, type Observed, type World } from './_account_stores_9045.ts';

let world: World;
before(() => { world = buildWorld(ACCOUNT_STORES); });
after(() => { world?.db.close(); });

/** What an answer says the erasure leaves in the person's row, or null when this test cannot read it. */
function expected(a: ErasureAnswer): Observed[] | null {
  switch (a.is) {
    case 'removed': return ['gone'];
    case 'changed': return ['changed'];
    case 'kept': return ['unchanged'];
    case 'unspecified': return a.today === 'untouched' ? ['unchanged'] : a.today === 'changed' ? ['changed'] : null;
  }
}

type Snapshot = { rows: Map<string, [unknown, unknown]>; objects: Map<string, [boolean, boolean]>; kv: string };
const snapshot = (w: World): Snapshot => ({
  rows: new Map([...w.rows].map(([t, [a, b]]) => [t, [rowOf(w as any, t, a), rowOf(w as any, t, b)]])),
  objects: new Map([...w.keys].map(([id, [a, b]]) => [id, [w.objects.has(a), w.objects.has(b)]])),
  kv: kvSnapshot(w),
});

/** Every store whose row or object does not match its answer, and every control row the erasure touched. */
function mismatches(w: World, before: Snapshot): string[] {
  const out: string[] = [];
  for (const s of ACCOUNT_STORES) {
    const want = expected(s.account_erasure);
    if (s.kind === 'd1_table') {
      const [a, b] = w.rows.get(s.name) ?? [0, 0];
      if (!a || !b) { out.push(`${s.id}: no synthetic row`); continue; }
      const [ba, bb] = before.rows.get(s.name) as [any, any];
      const got = observe(ba, rowOf(w as any, s.name, a));
      if (!want || !want.includes(got)) out.push(`${s.id}: ${s.account_erasure.is}${s.account_erasure.is === 'unspecified' ? `/${s.account_erasure.today}` : ''} but the row was ${got}`);
      const control = observe(bb, rowOf(w as any, s.name, b));
      if (control !== 'unchanged') out.push(`${s.id}: the control person's row was ${control}`);
    } else if (s.kind === 'r2_prefix') {
      const pair = w.keys.get(s.id);
      if (!pair) { out.push(`${s.id}: no synthetic object`); continue; }
      const got: Observed = w.objects.has(pair[0]) ? 'unchanged' : 'gone';
      if (!want || !want.includes(got)) out.push(`${s.id}: ${s.account_erasure.is} but the object was ${got}`);
      if (!w.objects.has(pair[1])) out.push(`${s.id}: the control person's object was removed`);
    }
  }
  return out;
}

test('account erasure: every store holds what the inventory says, and the control person is untouched', async () => {
  await rolledBack(w(), async () => {
    const before = snapshot(world);
    const asked = await eraseSubject(world);
    assert.deepEqual(mismatches(world, before), []);
    // KV: the erasure writes and deletes no key, the subject's or anyone's.
    const kv = ACCOUNT_STORES.filter((s) => s.kind === 'kv_namespace');
    assert.equal(kv.length, 3 - 1, 'RATE_LIMITS and OAUTH_KV');
    for (const s of kv) assert.deepEqual(expected(s.account_erasure), ['unchanged'], s.id);
    assert.equal(kvSnapshot(world), before.kv);
    // The agent runtime: asked to erase the subject's agent, and nothing else. What it then holds, the test cannot read.
    const agent = (world.db.prepare('SELECT id FROM team_agents WHERE sponsor_user_id = ?').get(SUBJECT) as any).id;
    assert.deepEqual(asked.map(([, id]) => id), [agent]);
    for (const s of ACCOUNT_STORES.filter((x) => x.kind === 'other')) assert.equal(expected(s.account_erasure), null, `${s.id}: a decided answer this test does not check`);
  });
});

test('the world has a row for the person in every D1 store and an object under every R2 template', () => {
  const d1 = ACCOUNT_STORES.filter((s) => s.kind === 'd1_table').map((s) => s.name);
  assert.deepEqual(d1.filter((t) => !world.rows.get(t)?.every(Boolean)), []);
  assert.deepEqual(ACCOUNT_STORES.filter((s) => s.kind === 'r2_prefix' && !world.keys.get(s.id)?.every(Boolean)).map((s) => s.id), []);
});

test('a "removed" or "changed" answer names the erasure, and the erasure names the table', () => {
  const sources = ['../src/agents/erasure.ts', '../src/services/agents/memory.ts', '../src/services/agents/computeBridge.ts']
    .map((p) => readFileSync(new URL(p, import.meta.url), 'utf8')).join('\n');
  for (const s of ACCOUNT_STORES.filter((x) => x.kind === 'd1_table')) {
    const a = s.account_erasure;
    if (a.is === 'removed' || a.is === 'changed') assert.match(a.by, /^eraseAccountAgents\b/, s.id);
    if (a.is === 'removed' || a.is === 'changed' || (a.is === 'unspecified' && a.today === 'changed')) {
      assert.match(sources, new RegExp(`\\b${s.name}\\b`), `${s.id}: the erasure never names it`);
    }
  }
});

function w() { return world; }
