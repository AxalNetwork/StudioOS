/**
 * #8530 (D8530): every answer of the VentureSpace data inventory is what the code does.
 *
 * A synthetic venture gets a row in every D1 store and an object under every R2 prefix the inventory lists, beside a
 * control venture (`_venture_stores_8530.ts`). Each event then runs through its real route or service, and every store
 * is read again: `removed` must be gone, `follows` and `not_applicable` unchanged, `kept` still there, and an
 * `unspecified` answer must match what its `today` says. The control venture is never touched. Erasure is checked
 * against the stores, not a request record: the owner's account is erased and every store is read.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LIFECYCLE_EVENTS, VENTURE_SPACE_STORES, type Answer, type LifecycleEvent, type Store } from '../src/services/ventureSpaceDataInventory.ts';
import { buildWorld, runEvent, rowOf, observe, rolledBack, VENTURE, CONTROL, HOME, DESTINATION, type Observed, type World } from './_venture_stores_8530.ts';

const STORES = VENTURE_SPACE_STORES;
const refuses = (s: Store) => { const a = s.answers.hard_delete; return a.is === 'unspecified' && a.today === 'refuses'; };
const REFUSERS = new Set(STORES.filter((s) => s.kind === 'd1_table' && refuses(s)).map((s) => s.name));

let full: World, held: World;
before(() => {
  full = buildWorld(STORES);
  held = buildWorld(STORES, REFUSERS); // the hard delete's world: no row that would make it fail
});
after(() => { full?.db.close(); held?.db.close(); });

/** What an answer says the event leaves in the venture's row, or null when this test cannot read it here. */
function expected(a: Answer): Observed[] | null {
  switch (a.is) {
    case 'follows': case 'not_applicable': return ['unchanged'];
    case 'removed': return ['gone'];
    case 'changed': return ['changed'];
    case 'kept': return ['unchanged', 'unlinked'];
    case 'unspecified':
      return a.today === 'untouched' ? ['unchanged'] : a.today === 'unlinked' ? ['unlinked'] : a.today === 'changed' ? ['changed'] : null;
  }
}

type Snapshot = { rows: Map<string, [unknown, unknown]>; objects: Map<string, [boolean, boolean]> };
function snapshot(w: World): Snapshot {
  return {
    rows: new Map([...w.rows].map(([t, [a, b]]) => [t, [rowOf(w, t, a), rowOf(w, t, b)]])),
    objects: new Map([...w.keys].map(([id, [a, b]]) => [id, [w.objects.has(a), w.objects.has(b)]])),
  };
}

/** Every store whose row does not match its answer, and every control row the event touched. */
function mismatches(w: World, event: LifecycleEvent, before: Snapshot): string[] {
  const out: string[] = [];
  for (const s of STORES) {
    if (s.kind === 'other' || s.name === 'projects') continue;
    const want = expected(s.answers[event]);
    if (s.kind === 'd1_table') {
      if (event === 'hard_delete' && REFUSERS.has(s.name)) continue; // proved by the refusal test below
      const [a, b] = w.rows.get(s.name) ?? [0, 0];
      if (!a || !b) { out.push(`${s.id}: no synthetic row`); continue; }
      const [ba, bb] = before.rows.get(s.name) as [any, any];
      const got = observe(ba, rowOf(w, s.name, a));
      if (want && !want.includes(got)) out.push(`${s.id}: ${s.answers[event].is} but the row was ${got}`);
      const control = observe(bb, rowOf(w, s.name, b));
      if (control !== 'unchanged') out.push(`${s.id}: the control venture's row was ${control}`);
    } else {
      const [a, b] = w.keys.get(s.id)!;
      const got: Observed = w.objects.has(a) ? 'unchanged' : 'gone';
      if (want && !want.includes(got)) out.push(`${s.id}: ${s.answers[event].is} but the object was ${got}`);
      if (!w.objects.has(b)) out.push(`${s.id}: the control venture's object was removed`);
    }
  }
  return out;
}

const venture = (w: World) => w.db.prepare('SELECT company_id, deleted_at FROM projects WHERE id = ?').get(VENTURE) as any;

for (const event of LIFECYCLE_EVENTS) {
  test(`${event}: every store holds what the inventory says, and the control venture is untouched`, async () => {
    const w = event === 'hard_delete' ? held : full;
    await rolledBack(w, async () => {
      const before = snapshot(w);
      const res = await runEvent(w, event);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      // The venture itself (`d1:projects`).
      const row = venture(w);
      if (event === 'move') assert.equal(row.company_id, DESTINATION);
      if (event === 'archive') assert.ok(row.deleted_at);
      if (event === 'restore' || event === 'account_erasure') assert.deepEqual({ ...row }, { company_id: HOME, deleted_at: null });
      if (event === 'hard_delete') assert.equal(row, undefined);
      assert.ok(w.db.prepare('SELECT 1 FROM projects WHERE id = ? AND deleted_at IS NULL').get(CONTROL), 'the control venture');
      assert.deepEqual(mismatches(w, event, before), []);
      // Stores outside D1 and R2: the one decided answer is the search vectors' removal, queued by the route.
      const jobs = w.db.prepare("SELECT payload FROM queue_jobs WHERE job_type = 'embed_delete'").all().map((j: any) => JSON.parse(j.payload));
      const vectors = STORES.find((s) => s.id === 'other:VECTORIZE')!.answers[event];
      assert.deepEqual(jobs, vectors.is === 'removed' ? [{ type: 'project', id: VENTURE }] : []);
      for (const s of STORES.filter((x) => x.kind === 'other' && x.id !== 'other:VECTORIZE')) {
        assert.equal(expected(s.answers[event]), null, `${s.id}: a decided answer this test does not check`);
      }
    });
  });
}

test('hard_delete: each store marked "refuses" makes the delete fail, and nothing is removed', async () => {
  assert.ok(REFUSERS.size > 0);
  for (const table of REFUSERS) {
    await rolledBack(held, async () => {
      held.seed(table);
      const [a] = held.rows.get(table)!;
      const res = await runEvent(held, 'hard_delete');
      assert.equal(res.status, 409, `${table}: ${JSON.stringify(res.body)}`);
      assert.ok(venture(held), `${table}: the venture is still there`);
      assert.ok(rowOf(held, table, a), `${table}: its row is still there`);
      assert.ok(held.objects.has('deck-images/1/s26-object.bin'), `${table}: no object was purged`);
    });
  }
});

test('a "removed" answer names the code path that removes it', () => {
  const sources = ['../src/services/projectTrash.ts', '../src/services/agents/memory.ts', '../src/agents/erasure.ts']
    .map((p) => readFileSync(new URL(p, import.meta.url), 'utf8')).join('\n');
  for (const s of STORES.filter((x) => x.kind === 'd1_table')) {
    for (const event of LIFECYCLE_EVENTS) {
      const a = s.answers[event];
      if (a.is !== 'removed') continue;
      if (a.by === 'ON DELETE CASCADE from projects') {
        const fk = full.db.prepare("SELECT on_delete FROM pragma_foreign_key_list(?) WHERE \"from\" = 'project_id' AND \"table\" = 'projects'").get(s.name) as any;
        assert.equal(fk?.on_delete, 'CASCADE', s.id);
      } else {
        assert.match(sources, new RegExp(`\\b${s.name}\\b`), `${s.id}: ${a.by} never names it`);
      }
    }
  }
});
