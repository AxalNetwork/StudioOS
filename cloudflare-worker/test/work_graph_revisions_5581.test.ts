/**
 * D5581 part 1 (#5581, WorkGraph P0) — the revision registry, the CAS head and the dependency DAG, against a real
 * SQLite database built from the migration itself (`202611140007_5581_work_graph_revisions.sql`):
 *
 *   1. Two agents produce separate revisions from one parent; neither touches the head.
 *   2. A stale writer is refused with the current head, and cannot rebase by naming the new head.
 *   3. 100 concurrent candidates against one head: exactly one wins, 99 are refused, no update is lost;
 *      100 concurrent creates get 100 distinct sequence numbers.
 *   4. Idempotency: a lost or late callback returns the first result and writes nothing; a reused key with another
 *      request is refused.
 *   5. Wrong tenant, company or project is refused on every operation.
 *   6. Dependency cycles are refused.
 *   7. A dependency's new head names stale dependents (transitively) and the approvals it invalidates; a stale pin is
 *      refused at creation and atomically at the swap.
 *   8. A composite never mixes component revisions that are not the components' heads.
 *   9. Tombstones are one-way, never under a legal hold, never the head; nothing is deleted or rewritten.
 *  10. Max versions and the size limit, including under concurrency.
 *  11. The audit row ties actor, agent run, charge, base, mutation, approval and published revision.
 *  12. Approvals: required by policy, a person's, of the exact bytes (D5579's codes).
 *  13. D5579's validator decides authority and digest format; every result carries its D1 cost.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/work_graph_revisions_5581.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeD1 } from './_d1_sqlite.mjs';
import type { Actor, Scope, ValidationContext } from '../src/services/workGraphContracts.ts';
import {
  WORK_GRAPH_DEPS, WORK_GRAPH_LIMITS, advanceHead, createRevision, impactOf, registerAsset, setLegalHold,
  staleDependencies, tombstoneRevision,
  type CreateRevisionInput, type Dependency,
} from '../src/services/workGraphRevisions.ts';

const MIGRATION = readFileSync(new URL('../sql/migrations/202611140007_5581_work_graph_revisions.sql', import.meta.url), 'utf8');
const NOW = new Date('2026-11-14T00:10:00Z');
WORK_GRAPH_DEPS.now = () => NOW;
let n = 0;
WORK_GRAPH_DEPS.newId = () => `id${++n}`;

const SCOPE: Scope = { tenantId: 7, companyId: 70, projectId: 700 };
const CTX: ValidationContext = { scope: { tenantId: 7, companyId: 70, projectId: null } };
const ALICE: Actor = { kind: 'person', userId: 11 };
const BOB: Actor = { kind: 'person', userId: 12 };
const agent = (run: string): Actor => ({ kind: 'agent', agentRunId: run, onBehalfOfUserId: 11, chargeId: `chg_${run}` });
const D = (ch: string) => ch.repeat(64);
const hex = (i: number) => i.toString(16).padStart(64, '0');

function world() {
  const { DB, db } = makeD1(MIGRATION);
  return { env: { DB } as any, db };
}
type W = ReturnType<typeof world>;

async function asset(w: W, key: string, over: Partial<Parameters<typeof registerAsset>[2]> = {}) {
  const r = await registerAsset(w.env, CTX, {
    scope: SCOPE, kind: 'pitch_deck', accessClass: 'confidential', approvalPolicy: 'team_review', actor: ALICE,
    idempotencyKey: `asset-${key}`, ...over,
  });
  assert.ok(r.ok, JSON.stringify(r));
  return r.assetUid;
}
function rev(assetUid: string, key: string, over: Partial<CreateRevisionInput> = {}): CreateRevisionInput {
  return {
    assetUid, parents: [], digest: D('a'), byteLength: 10, mediaProfile: 'application/json',
    source: { store: 'd1_record', locator: 'pitch_decks', id: '41', revision: key }, author: agent('run_a'),
    idempotencyKey: `rev-${key}`, ...over,
  };
}
async function mk(w: W, input: CreateRevisionInput, limits = WORK_GRAPH_LIMITS) {
  const r = await createRevision(w.env, CTX, input, limits);
  assert.ok(r.ok, JSON.stringify(r));
  return r.revisionUid;
}
async function head(w: W, assetUid: string, expected: string | null, revisionUid: string, key: string, actor: Actor = agent('run_a'), approval: any = null) {
  return advanceHead(w.env, CTX, { assetUid, expectedRevisionUid: expected, revisionUid, actor, approval, idempotencyKey: `adv-${key}` });
}
const headOf = (w: W, a: string) => ({ ...(w.db.prepare('SELECT head_revision_uid AS h, head_seq AS s, version_count AS c FROM work_graph_assets WHERE asset_uid = ?').get(a) as any) });
const count = (w: W, sql: string, ...b: any[]) => Number((w.db.prepare(sql).get(...b) as any).n);

/** An asset with a first head v1. */
async function seeded(w: W, key = 'deck', over: Partial<Parameters<typeof registerAsset>[2]> = {}, first: Partial<CreateRevisionInput> = {}) {
  const a = await asset(w, key, over);
  const v1 = await mk(w, rev(a, `${key}-v1`, first));
  const h = await head(w, a, null, v1, `${key}-v1`);
  assert.ok(h.ok, JSON.stringify(h));
  return { a, v1 };
}

test('1. two agents produce separate revisions from one parent; the head does not move', async () => {
  const w = world();
  const { a, v1 } = await seeded(w);
  const r1 = await createRevision(w.env, CTX, rev(a, 'one', { parents: [v1], digest: D('b'), author: agent('run_one') }));
  const r2 = await createRevision(w.env, CTX, rev(a, 'two', { parents: [v1], digest: D('c'), author: agent('run_two') }));
  assert.ok(r1.ok && r2.ok);
  assert.notEqual(r1.revisionUid, r2.revisionUid);
  assert.deepEqual([r1.seq, r2.seq], [2, 3]);
  assert.equal(headOf(w, a).h, v1);
  const rows = w.db.prepare('SELECT agent_run_id AS run, digest FROM work_graph_revisions WHERE asset_uid = ? ORDER BY seq').all(a) as any[];
  assert.deepEqual(rows.map((r) => r.run), ['run_a', 'run_one', 'run_two']);
});

test('2. a stale writer is refused with the current head, and cannot overwrite it by naming it', async () => {
  const w = world();
  const { a, v1 } = await seeded(w);
  const ra = await mk(w, rev(a, 'A', { parents: [v1], digest: D('b') }));
  const rb = await mk(w, rev(a, 'B', { parents: [v1], digest: D('c') }));
  const winA = await head(w, a, v1, ra, 'A');
  assert.ok(winA.ok, JSON.stringify(winA));
  assert.equal(winA.headSeq, 2);

  const late = await head(w, a, v1, rb, 'B');
  assert.equal(late.ok, false);
  assert.ok(!late.ok);
  assert.equal(late.code, 'stale_revision');
  assert.deepEqual(late.currentHead, { revisionUid: ra, headSeq: 2 });
  assert.deepEqual(late.ids, [rb, v1, ra]);

  // Naming the new head does not help: B was not built on it, so it would discard A's work.
  const sneaky = await head(w, a, ra, rb, 'B2');
  assert.ok(!sneaky.ok);
  assert.equal(sneaky.code, 'not_descendant');
  assert.equal(headOf(w, a).h, ra);

  // Rebased on the head, B is accepted.
  const rb2 = await mk(w, rev(a, 'B-rebased', { parents: [ra], digest: D('d') }));
  const ok = await head(w, a, ra, rb2, 'B3');
  assert.ok(ok.ok);
  assert.equal(headOf(w, a).s, 3);
  // The refusal is in the trail, with the head the writer lost to.
  const refused = w.db.prepare("SELECT refusal_code AS c, base_revision_uid AS b, detail_json AS d FROM work_graph_events WHERE action = 'advance_refused'").all() as any[];
  assert.deepEqual(refused.map((r) => [r.c, r.b, JSON.parse(r.d).current_head]), [['stale_revision', v1, ra]]);
});

test('3. 100 concurrent candidates: exactly one wins, 99 are refused, nothing is lost', async () => {
  const w = world();
  const { a, v1 } = await seeded(w);
  const made = await Promise.all(Array.from({ length: 100 }, (_, i) =>
    createRevision(w.env, CTX, rev(a, `c${i}`, { parents: [v1], digest: hex(i + 1), author: agent(`run_${i}`) }))));
  assert.ok(made.every((r) => r.ok));
  const seqs = made.map((r) => (r.ok ? r.seq : 0)).sort((x, y) => x - y);
  assert.deepEqual(seqs, Array.from({ length: 100 }, (_, i) => i + 2), 'every concurrent create got its own sequence number');
  assert.equal(headOf(w, a).c, 101);

  const results = await Promise.all(made.map((r, i) => head(w, a, v1, r.ok ? r.revisionUid : '', `c${i}`, agent(`run_${i}`))));
  const winners = results.filter((r) => r.ok);
  const losers = results.filter((r) => !r.ok);
  assert.equal(winners.length, 1);
  assert.equal(losers.length, 99);
  const winner = winners[0].ok ? winners[0].revisionUid : '';
  for (const l of losers) {
    assert.ok(!l.ok);
    assert.equal(l.code, 'stale_revision');
    assert.deepEqual(l.currentHead, { revisionUid: winner, headSeq: 2 });
  }
  assert.deepEqual(headOf(w, a), { h: winner, s: 2, c: 101 });
  assert.equal(count(w, "SELECT COUNT(*) AS n FROM work_graph_events WHERE action = 'advance_head' AND asset_uid = ?", a), 2);
  assert.equal(count(w, "SELECT COUNT(*) AS n FROM work_graph_events WHERE action = 'advance_refused' AND asset_uid = ?", a), 99);
  assert.equal(count(w, 'SELECT COUNT(*) AS n FROM work_graph_revisions WHERE asset_uid = ?', a), 101, 'every candidate is kept');
});

test('4. idempotency: a lost or late callback returns the first result and writes nothing', async () => {
  const w = world();
  const { a, v1 } = await seeded(w);
  const input = rev(a, 'idem', { parents: [v1], digest: D('b') });
  const first = await createRevision(w.env, CTX, input);
  const again = await createRevision(w.env, CTX, input);
  assert.ok(first.ok && again.ok);
  assert.equal(again.revisionUid, first.revisionUid);
  assert.equal(again.replayed, true);
  assert.equal(count(w, 'SELECT COUNT(*) AS n FROM work_graph_revisions WHERE idempotency_key = ?', 'rev-idem'), 1);

  // Two deliveries at once of the same callback: one row.
  const twin = rev(a, 'twin', { parents: [v1], digest: D('c') });
  const both = await Promise.all([createRevision(w.env, CTX, twin), createRevision(w.env, CTX, twin)]);
  assert.ok(both[0].ok && both[1].ok);
  assert.equal(both[0].revisionUid, both[1].revisionUid);
  assert.equal(count(w, 'SELECT COUNT(*) AS n FROM work_graph_revisions WHERE idempotency_key = ?', 'rev-twin'), 1);

  // The same key with another request is refused.
  const clash = await createRevision(w.env, CTX, { ...input, digest: D('e') });
  assert.ok(!clash.ok);
  assert.equal(clash.code, 'idempotency_conflict');

  // A head move whose callback arrives late, after another writer moved on: replayed, not re-applied.
  const moved = await head(w, a, v1, first.revisionUid, 'late');
  assert.ok(moved.ok);
  const next = await mk(w, rev(a, 'next', { parents: [first.revisionUid], digest: D('f') }));
  assert.ok((await head(w, a, first.revisionUid, next, 'next')).ok);
  const lateAgain = await head(w, a, v1, first.revisionUid, 'late');
  assert.ok(lateAgain.ok);
  assert.equal(lateAgain.replayed, true);
  assert.equal(lateAgain.headSeq, 2);
  assert.equal(headOf(w, a).h, next, 'the late callback did not move the head back');
  assert.equal(count(w, "SELECT COUNT(*) AS n FROM work_graph_events WHERE idempotency_key = 'adv-late'"), 1);
});

test('5. wrong tenant, company or project is refused on every operation', async () => {
  const w = world();
  const { a, v1 } = await seeded(w);
  const r = await mk(w, rev(a, 'mine', { parents: [v1], digest: D('b') }));
  for (const scope of [{ tenantId: 8, companyId: 70, projectId: null }, { tenantId: 7, companyId: 71, projectId: null }, { tenantId: 7, companyId: 70, projectId: 701 }]) {
    const ctx: ValidationContext = { scope };
    const c = await createRevision(w.env, ctx, rev(a, `x${scope.tenantId}${scope.companyId}${scope.projectId}`, { parents: [v1] }));
    assert.ok(!c.ok); assert.equal(c.code, 'wrong_tenant');
    const h = await advanceHead(w.env, ctx, { assetUid: a, expectedRevisionUid: v1, revisionUid: r, actor: ALICE, idempotencyKey: 'x' });
    assert.ok(!h.ok); assert.equal(h.code, 'wrong_tenant');
    for (const res of [await impactOf(w.env, ctx, v1), await staleDependencies(w.env, ctx, v1),
      await tombstoneRevision(w.env, ctx, { revisionUid: r, actor: ALICE, reason: 'x' }),
      await setLegalHold(w.env, ctx, { revisionUid: r, hold: true, actor: ALICE, reason: 'x' })]) {
      assert.ok(!res.ok); assert.equal(res.code, 'wrong_tenant');
    }
    const reg = await registerAsset(w.env, ctx, { scope: SCOPE, kind: 'document', accessClass: 'internal', approvalPolicy: 'p', actor: ALICE, idempotencyKey: 'other' });
    assert.ok(!reg.ok); assert.equal(reg.code, 'wrong_tenant');
  }
  assert.equal(headOf(w, a).h, v1);
  // A dependency on another company's asset is refused: an edge never leaves the caller's company.
  const other = await registerAsset(w.env, { scope: { tenantId: 7, companyId: 71, projectId: null } }, {
    scope: { tenantId: 7, companyId: 71, projectId: 900 }, kind: 'image', accessClass: 'internal', approvalPolicy: 'p', actor: BOB, idempotencyKey: 'o',
  });
  assert.ok(other.ok);
  const oCtx: ValidationContext = { scope: { tenantId: 7, companyId: 71, projectId: null } };
  const ov = await createRevision(w.env, oCtx, rev(other.assetUid, 'o1', { source: { store: 'r2_object', locator: 'FILES', id: 'k', revision: D('a') } }));
  assert.ok(ov.ok);
  assert.ok((await advanceHead(w.env, oCtx, { assetUid: other.assetUid, expectedRevisionUid: null, revisionUid: ov.revisionUid, actor: BOB, idempotencyKey: 'o1' })).ok);
  const wide: ValidationContext = { scope: { tenantId: 7, companyId: 70, projectId: null } };
  const cross = await createRevision(w.env, wide, rev(a, 'cross', { parents: [v1], dependencies: [{ kind: 'read', assetUid: other.assetUid, revisionUid: ov.revisionUid }] }));
  assert.ok(!cross.ok); assert.equal(cross.code, 'wrong_tenant');
});

test('6. dependency cycles are refused', async () => {
  const w = world();
  const A = await seeded(w, 'A');
  const B = await seeded(w, 'B', { kind: 'document' });
  const C = await seeded(w, 'C', { kind: 'document' });
  // A2 reads B; B2 reads C; then C2 reading A would close A -> B -> C -> A.
  const a2 = await mk(w, rev(A.a, 'a2', { parents: [A.v1], dependencies: [{ kind: 'read', assetUid: B.a, revisionUid: B.v1 }] }));
  assert.ok((await head(w, A.a, A.v1, a2, 'a2')).ok);
  const b2 = await mk(w, rev(B.a, 'b2', { parents: [B.v1], dependencies: [{ kind: 'derived', assetUid: C.a, revisionUid: C.v1 }] }));
  assert.ok((await head(w, B.a, B.v1, b2, 'b2')).ok);
  const loop = await createRevision(w.env, CTX, rev(C.a, 'c2', { parents: [C.v1], dependencies: [{ kind: 'read', assetUid: A.a, revisionUid: a2 }] }));
  assert.ok(!loop.ok);
  assert.equal(loop.code, 'cyclic_dependency');
  assert.ok(loop.ids.includes(C.a));
  // A direct self-dependency is a cycle too (lineage is what `parents` is for).
  const self = await createRevision(w.env, CTX, rev(A.a, 'self', { parents: [a2], dependencies: [{ kind: 'read', assetUid: A.a, revisionUid: a2 }] }));
  assert.ok(!self.ok); assert.equal(self.code, 'cyclic_dependency');
  // A parent from another asset is not lineage: D5579's validator names it.
  const foreign = await createRevision(w.env, CTX, rev(A.a, 'foreign', { parents: [B.v1] }));
  assert.ok(!foreign.ok); assert.equal(foreign.code, 'unknown_reference');
  assert.equal(count(w, 'SELECT COUNT(*) AS n FROM work_graph_revisions WHERE asset_uid = ?', C.a), 1);
});

test('7. a dependency head advance names stale dependents and the approvals it invalidates', async () => {
  const w = world();
  const src = await seeded(w, 'src', { kind: 'document' });
  const out = await asset(w, 'out', { approvalPolicy: 'human_publication' });
  const o1 = await mk(w, rev(out, 'o1', { digest: D('b'), dependencies: [{ kind: 'read', assetUid: src.a, revisionUid: src.v1 }] }));
  const approval = { ref: 'apr_77', contentDigest: D('b'), reviewer: BOB, decidedAt: '2026-11-14T00:05:00Z' };
  assert.ok((await head(w, out, null, o1, 'o1', agent('run_o'), approval)).ok);
  // A second-level output reads the first.
  const top = await seeded(w, 'top', { kind: 'document' });
  const t2 = await mk(w, rev(top.a, 't2', { parents: [top.v1], dependencies: [{ kind: 'derived', assetUid: out, revisionUid: o1 }] }));
  assert.ok((await head(w, top.a, top.v1, t2, 't2')).ok);
  // A draft built on src v1 that never became a head.
  const oDraft = await mk(w, rev(out, 'o-draft', { parents: [o1], digest: D('c'), dependencies: [{ kind: 'read', assetUid: src.a, revisionUid: src.v1 }] }));

  const fresh = await staleDependencies(w.env, CTX, o1);
  assert.ok(fresh.ok); assert.deepEqual(fresh.stale, []);

  const s2 = await mk(w, rev(src.a, 's2', { parents: [src.v1], digest: D('d') }));
  const moved = await head(w, src.a, src.v1, s2, 's2');
  assert.ok(moved.ok);
  assert.deepEqual(moved.impact.outputs.map((o) => [o.revisionUid, o.isHead, o.depth]), [[o1, true, 1], [oDraft, false, 1], [t2, true, 2]]);
  assert.deepEqual(moved.impact.invalidatedApprovals, [{ assetUid: out, revisionUid: o1, approvalRef: 'apr_77', approvalDigest: D('b') }]);

  const stale = await staleDependencies(w.env, CTX, o1);
  assert.ok(stale.ok);
  assert.deepEqual(stale.stale, [{ edgeKind: 'read', toAssetUid: src.a, pinnedRevisionUid: src.v1, headRevisionUid: s2 }]);

  // A new revision pinned to the old dependency is refused at creation ...
  const pinnedOld = await createRevision(w.env, CTX, rev(out, 'o3', { parents: [o1], digest: D('e'), dependencies: [{ kind: 'read', assetUid: src.a, revisionUid: src.v1 }] }));
  assert.ok(!pinnedOld.ok); assert.equal(pinnedOld.code, 'stale_dependency');
  // ... and one created before the move is refused at the swap, atomically, with an approval of its exact bytes.
  const viaSwap = await head(w, out, o1, oDraft, 'o-draft', agent('run_o'), { ...approval, ref: 'apr_78', contentDigest: D('c') });
  assert.ok(!viaSwap.ok);
  assert.equal(viaSwap.code, 'stale_dependency');
  assert.deepEqual(viaSwap.ids, [src.a, src.v1, s2]);
  assert.equal(headOf(w, out).h, o1);

  const report = await impactOf(w.env, CTX, src.v1);
  assert.ok(report.ok);
  assert.equal(report.impact.outputs.length, 3);
});

test('8. a composite never mixes components that are not their heads', async () => {
  const w = world();
  const X = await seeded(w, 'X', { kind: 'document' });
  const Y = await seeded(w, 'Y', { kind: 'image' }, { source: { store: 'r2_object', locator: 'FILES', id: 'y', revision: D('a') } });
  const comp = await asset(w, 'comp', { kind: 'composite' });
  const parts = (y: string): Dependency[] => [{ kind: 'component', assetUid: X.a, revisionUid: X.v1 }, { kind: 'component', assetUid: Y.a, revisionUid: y }];
  const c1 = await mk(w, rev(comp, 'c1', { source: { store: 'd1_record', locator: 'release_manifests', id: 'm1', revision: '1' }, dependencies: parts(Y.v1) }));
  // Y moves on before the composite is accepted.
  const y2 = await mk(w, rev(Y.a, 'y2', { parents: [Y.v1], digest: D('9'), source: { store: 'r2_object', locator: 'FILES', id: 'y', revision: D('9') } }));
  assert.ok((await head(w, Y.a, Y.v1, y2, 'y2')).ok);
  const mixed = await head(w, comp, null, c1, 'c1');
  assert.ok(!mixed.ok);
  assert.equal(mixed.code, 'composite_incompatible');
  assert.deepEqual(mixed.ids, [Y.a, Y.v1, y2]);
  assert.equal(headOf(w, comp).h, null);
  // Pinning the old Y now is refused at creation; pinning the heads is accepted.
  const old = await createRevision(w.env, CTX, rev(comp, 'c-old', { source: { store: 'd1_record', locator: 'release_manifests', id: 'm2', revision: '1' }, dependencies: parts(Y.v1) }));
  assert.ok(!old.ok); assert.equal(old.code, 'composite_incompatible');
  const c2 = await mk(w, rev(comp, 'c2', { source: { store: 'd1_record', locator: 'release_manifests', id: 'm3', revision: '1' }, dependencies: parts(y2) }));
  assert.ok((await head(w, comp, null, c2, 'c2')).ok);
  // A composite with no components, or components on a non-composite, is malformed.
  const empty = await createRevision(w.env, CTX, rev(comp, 'c-empty', { parents: [c2] }));
  assert.ok(!empty.ok); assert.equal(empty.code, 'malformed');
  const stray = await createRevision(w.env, CTX, rev(X.a, 'x-stray', { parents: [X.v1], dependencies: [{ kind: 'component', assetUid: Y.a, revisionUid: y2 }] }));
  assert.ok(!stray.ok); assert.equal(stray.code, 'malformed');
});

test('9. tombstones are one-way, never under a legal hold, never the head; nothing is deleted', async () => {
  const w = world();
  const { a, v1 } = await seeded(w);
  const v2 = await mk(w, rev(a, 'v2', { parents: [v1], digest: D('b') }));
  assert.ok((await head(w, a, v1, v2, 'v2')).ok);

  const onHead = await tombstoneRevision(w.env, CTX, { revisionUid: v2, actor: ALICE, reason: 'r' });
  assert.ok(!onHead.ok); assert.equal(onHead.code, 'is_head');
  const byAgent = await tombstoneRevision(w.env, CTX, { revisionUid: v1, actor: agent('run_x'), reason: 'r' });
  assert.ok(!byAgent.ok); assert.equal(byAgent.code, 'person_required');

  const held = await setLegalHold(w.env, CTX, { revisionUid: v1, hold: true, actor: BOB, reason: 'litigation' });
  assert.ok(held.ok && held.changed);
  const blocked = await tombstoneRevision(w.env, CTX, { revisionUid: v1, actor: ALICE, reason: 'r' });
  assert.ok(!blocked.ok); assert.equal(blocked.code, 'legal_hold');
  assert.equal(blocked.cost.d1Batches, 0, 'refused before any write');
  assert.equal(onHead.cost.d1Batches, 0, 'refused before any write');
  // The database refuses it too, whoever writes.
  assert.throws(() => w.db.prepare("UPDATE work_graph_revisions SET tombstoned_at = 'x', tombstoned_by_user_id = 1 WHERE revision_uid = ?").run(v1), /immutable/);

  assert.ok((await setLegalHold(w.env, CTX, { revisionUid: v1, hold: false, actor: BOB, reason: 'released' })).ok);
  const gone = await tombstoneRevision(w.env, CTX, { revisionUid: v1, actor: ALICE, reason: 'retention' });
  assert.ok(gone.ok && gone.changed);
  const twice = await tombstoneRevision(w.env, CTX, { revisionUid: v1, actor: ALICE, reason: 'retention' });
  assert.ok(twice.ok && !twice.changed);
  // A tombstone is one-way and the row is still there.
  assert.throws(() => w.db.prepare('UPDATE work_graph_revisions SET tombstoned_at = NULL, tombstoned_by_user_id = NULL WHERE revision_uid = ?').run(v1), /immutable/);
  assert.throws(() => w.db.prepare('DELETE FROM work_graph_revisions WHERE revision_uid = ?').run(v1), /never deleted/);
  assert.throws(() => w.db.prepare('UPDATE work_graph_revisions SET digest = ? WHERE revision_uid = ?').run(D('f'), v2), /immutable/);
  assert.throws(() => w.db.prepare('DELETE FROM work_graph_events').run(), /append-only/);
  // A tombstoned revision is never a parent again, and never a head.
  const child = await createRevision(w.env, CTX, rev(a, 'child', { parents: [v1] }));
  assert.ok(!child.ok); assert.equal(child.code, 'tombstoned');
  assert.throws(() => w.db.prepare('UPDATE work_graph_assets SET head_revision_uid = ? WHERE asset_uid = ?').run(v1, a), /live revision/);
  // A hold placed while a tombstone is in flight wins: the write re-checks the hold inside the UPDATE.
  const v3 = await mk(w, rev(a, 'v3', { parents: [v2], digest: D('c') }));
  const [hold3, tomb3] = await Promise.all([
    setLegalHold(w.env, CTX, { revisionUid: v3, hold: true, actor: BOB, reason: 'litigation' }),
    tombstoneRevision(w.env, CTX, { revisionUid: v3, actor: ALICE, reason: 'r' }),
  ]);
  assert.ok(hold3.ok && hold3.changed);
  assert.ok(!tomb3.ok); assert.equal(tomb3.code, 'legal_hold');
  assert.equal((w.db.prepare('SELECT tombstoned_at AS t FROM work_graph_revisions WHERE revision_uid = ?').get(v3) as any).t, null);
  const actions = (w.db.prepare("SELECT action FROM work_graph_events WHERE revision_uid = ? AND action IN ('tombstone', 'legal_hold_set', 'legal_hold_released') ORDER BY id").all(v1) as any[]).map((r) => r.action);
  assert.deepEqual(actions, ['legal_hold_set', 'legal_hold_released', 'tombstone']);
});

test('10. max versions and the size limit, including under concurrency', async () => {
  const w = world();
  const a = await asset(w, 'cap');
  const limits = { ...WORK_GRAPH_LIMITS, maxVersionsPerAsset: 3, maxRevisionBytes: 1000 };
  const big = await createRevision(w.env, CTX, rev(a, 'big', { byteLength: 1001 }), limits);
  assert.ok(!big.ok); assert.equal(big.code, 'size_limit');
  assert.ok((await createRevision(w.env, CTX, rev(a, 'edge', { byteLength: 1000 }), limits)).ok);
  const burst = await Promise.all(Array.from({ length: 6 }, (_, i) => createRevision(w.env, CTX, rev(a, `b${i}`, { digest: hex(i + 1) }), limits)));
  assert.equal(burst.filter((r) => r.ok).length, 2);
  assert.ok(burst.filter((r) => !r.ok).every((r) => !r.ok && r.code === 'max_versions'));
  assert.equal(count(w, 'SELECT COUNT(*) AS n FROM work_graph_revisions WHERE asset_uid = ?', a), 3);
  assert.equal(headOf(w, a).c, 3);
});

test('11. the audit row ties actor, run, charge, base, mutation, approval and published revision', async () => {
  const w = world();
  const a = await asset(w, 'legal', { kind: 'legal_template', approvalPolicy: 'human_publication' });
  const v1 = await mk(w, rev(a, 'l1', { digest: D('1'), source: { store: 'd1_record', locator: 'legal_template_versions', id: '5', revision: '1' } }));
  const ap1 = { ref: 'apr_1', contentDigest: D('1'), reviewer: BOB, decidedAt: '2026-11-14T00:01:00Z' };
  assert.ok((await head(w, a, null, v1, 'l1', ALICE, ap1)).ok);
  const v2 = await mk(w, rev(a, 'l2', { parents: [v1], digest: D('2'), author: agent('run_legal'), source: { store: 'd1_record', locator: 'legal_template_versions', id: '5', revision: '2' } }));
  const moved = await head(w, a, v1, v2, 'l2', agent('run_legal'), { ...ap1, ref: 'apr_2', contentDigest: D('2') });
  assert.ok(moved.ok);
  const ev = w.db.prepare(
    `SELECT actor_kind, actor_user_id, agent_run_id, charge_id, base_revision_uid, revision_uid, head_seq, approval_ref,
            approval_digest, approver_user_id, outcome, created_at
       FROM work_graph_events WHERE action = 'advance_head' AND idempotency_key = 'adv-l2'`,
  ).get() as any;
  assert.deepEqual({ ...ev }, {
    actor_kind: 'agent', actor_user_id: 11, agent_run_id: 'run_legal', charge_id: 'chg_run_legal', base_revision_uid: v1,
    revision_uid: v2, head_seq: 2, approval_ref: 'apr_2', approval_digest: D('2'), approver_user_id: 12, outcome: 'applied',
    created_at: NOW.toISOString(),
  });
  const created = w.db.prepare("SELECT base_revision_uid AS b, agent_run_id AS r FROM work_graph_events WHERE action = 'create_revision' AND revision_uid = ?").get(v2) as any;
  assert.deepEqual({ ...created }, { b: v1, r: 'run_legal' });
});

test('12. approvals: required by policy, given by a person, of the exact bytes', async () => {
  const w = world();
  const a = await asset(w, 'pub', { approvalPolicy: 'human_publication' });
  const v1 = await mk(w, rev(a, 'p1', { digest: D('1') }));
  const none = await head(w, a, null, v1, 'none');
  assert.ok(!none.ok); assert.equal(none.code, 'approval_required');
  const byAgent = await head(w, a, null, v1, 'agent', ALICE, { ref: 'apr', contentDigest: D('1'), reviewer: agent('run_r'), decidedAt: 'x' });
  assert.ok(!byAgent.ok); assert.equal(byAgent.code, 'agent_review');
  const otherBytes = await head(w, a, null, v1, 'bytes', ALICE, { ref: 'apr', contentDigest: D('2'), reviewer: BOB, decidedAt: 'x' });
  assert.ok(!otherBytes.ok); assert.equal(otherBytes.code, 'stale_approval');
  const revoked = await advanceHead(w.env, { ...CTX, revokedUserIds: new Set([12]) }, {
    assetUid: a, expectedRevisionUid: null, revisionUid: v1, actor: ALICE, idempotencyKey: 'rv',
    approval: { ref: 'apr', contentDigest: D('1'), reviewer: BOB, decidedAt: 'x' },
  });
  assert.ok(!revoked.ok); assert.equal(revoked.code, 'revoked_author');
  assert.equal(headOf(w, a).h, null);
  assert.ok((await head(w, a, null, v1, 'good', ALICE, { ref: 'apr', contentDigest: D('1'), reviewer: BOB, decidedAt: 'x' })).ok);
});

test('13. D5579 decides authority and digest format; every result carries its D1 cost', async () => {
  const w = world();
  const a = await asset(w, 'tpl', { kind: 'legal_template' });
  const fromR2 = await createRevision(w.env, CTX, rev(a, 'r2', { source: { store: 'r2_object', locator: 'FILES', id: 'x.pdf', revision: D('a') } }));
  assert.ok(!fromR2.ok); assert.equal(fromR2.code, 'authority_violation');
  const badDigest = await createRevision(w.env, CTX, rev(a, 'bad', { digest: 'A'.repeat(64) }));
  assert.ok(!badDigest.ok); assert.equal(badDigest.code, 'malformed');
  assert.equal(count(w, 'SELECT COUNT(*) AS n FROM work_graph_revisions'), 0);

  const v1 = await createRevision(w.env, CTX, rev(a, 'v1', { source: { store: 'd1_record', locator: 'legal_template_versions', id: '1', revision: '1' } }));
  assert.ok(v1.ok);
  // asset read, replay probe, batch of revision + count + event, sequence read-back.
  assert.deepEqual(v1.cost, { d1Statements: 6, d1Batches: 1 });
  const moved = await head(w, a, null, v1.revisionUid, 'v1');
  assert.ok(moved.ok);
  // asset read, replay probe, revision read, batch of swap + event, head read.
  assert.deepEqual(moved.cost, { d1Statements: 6, d1Batches: 1 });
  const replay = await head(w, a, null, v1.revisionUid, 'v1');
  assert.ok(replay.ok && replay.replayed);
  assert.deepEqual(replay.cost, { d1Statements: 2, d1Batches: 0 });
});
