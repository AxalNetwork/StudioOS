// D8507 (#8507) — hosted Stage A's receipt and sweep (`stageASweep.mjs`), and the workflow that runs them.
//   1. the sweep selects only the run's own Stage A names, never another run's, production's or a lookalike;
//   2. the receipt cannot widen the selection, and a torn last line is dropped and counted;
//   3. a list that could not be read is never counted as zero left;
//   4. the workflow: a receipt per run kept even on failure, an `if: always()` sweep in the same environment,
//      a sweep-only dispatch for an earlier run, the harness pinned to `github.sha`, and the harness writes
//      a receipt line for every kind it creates.
//
//   node --test scripts/lib/stageASweep.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RECEIPT_KINDS, isRunName, leftCount, parseReceipt, receiptLine, selectForSweep } from './stageASweep.mjs';
import { stageANames, stageASections, toCreate } from './stageARun.mjs';

const RUN = 'a12345678';
const OTHER = 'a12345679';
const TOML = readFileSync(new URL('../../wrangler.toml', import.meta.url), 'utf8');
const IDS = { d1: '11111111-2222-3333-4444-555555555555', kv: { TOKENS: 'a'.repeat(32), RATE_LIMITS: 'b'.repeat(32), OAUTH_KV: 'c'.repeat(32) } };

/** Everything one run creates, as the account would list it. */
function runResources(run) {
  const n = stageANames(run);
  const t = toCreate(stageASections(TOML, run, IDS));
  return {
    worker: [n.worker], d1: [t.d1], kv: n.kv.map((k, i) => ({ title: k.title, id: String(i).repeat(32) })),
    queue: t.queues, bucket: t.buckets, workflow: t.workflows,
  };
}
/** What production and the other environments hold: none of it may ever be selected. */
const PRODUCTION = {
  worker: ['studioos', 'studioos-preview', 'studioos-meeting-bot', 'studioos-s4594', `studioos-s4594-${RUN}x`, `xstudioos-s4594-${RUN}`],
  d1: ['studioos-db', 'studioos-db-preview', 'studioos-rehearsal-a12345678-dst', `studioos-rehearsal-${RUN}-src-old`, 'studioos-rehearsal-other-src'],
  kv: [{ title: 'studioos-tokens', id: 'f'.repeat(32) }, { title: `studioos-s4594-${RUN}-sessions`, id: 'e'.repeat(32) }],
  queue: ['studioos-agent-queue', 'studioos-agent-queue-preview', 'studioos-agent-queue-preview-dlq', `studioos-agent-queue-s4594-${RUN}-old`],
  bucket: ['studioos-files', 'studioos-files-preview', `studioos-files-s4594-${RUN}0`],
  workflow: ['studioos-agent-workflow', 'studioos-agent-workflow-preview'],
};
const merge = (...xs) => Object.fromEntries(Object.keys(xs[0]).map((k) => [k, xs.flatMap((x) => x[k])]));

test('selection: every resource the run creates is selected, and nothing else', () => {
  const mine = runResources(RUN);
  const listed = merge(mine, runResources(OTHER), PRODUCTION);
  const { delete: del, unread } = selectForSweep({ run: RUN, listed });
  assert.deepEqual(unread, []);
  const want = Object.entries(mine).flatMap(([kind, xs]) => xs.map((x) => `${kind}:${kind === 'kv' ? x.title : x}`)).sort();
  assert.deepEqual(del.map((d) => `${d.kind}:${d.name}`).sort(), want);
  assert.ok(del.length >= 8, `a run creates at least a Worker, a database, three KV namespaces and its queues (${del.length})`);
  for (const d of del) assert.ok(d.name.includes(RUN), `${d.name} carries the run`);
  assert.equal(del[0].kind, 'worker', 'the Worker goes first, so nothing is left bound to a deleted resource');
  assert.equal(del.at(-1).kind, 'd1', 'the database goes last');
  for (const d of del.filter((x) => x.kind === 'kv')) assert.match(d.id, /^[0-9a-f]{32}$/, 'a KV namespace is deleted by its id');
});

test('selection: another run, production, preview and lookalikes are never selected', () => {
  const { delete: del } = selectForSweep({ run: RUN, listed: merge(runResources(OTHER), PRODUCTION) });
  assert.deepEqual(del, []);
  for (const [kind, xs] of Object.entries(PRODUCTION)) for (const x of xs) assert.equal(isRunName(RUN, kind, kind === 'kv' ? x.title : x), false, `${kind} ${JSON.stringify(x)}`);
  assert.equal(isRunName(RUN, 'queue', 'studioos-agent-queue-s4594-a12345678'), true);
  assert.equal(isRunName(RUN, 'nonsense', 'studioos-s4594-a12345678'), false, 'an unknown kind selects nothing');
  assert.equal(isRunName('bad run', 'worker', 'studioos-s4594-bad run'), false);
  assert.throws(() => selectForSweep({ run: '', listed: {} }), /run id/);
  assert.throws(() => selectForSweep({ run: 'x'.repeat(21), listed: {} }), /run id/);
});

test('receipt: lines round-trip, are refused for a name that is not the run\'s, and cannot widen the sweep', () => {
  const at = new Date('2026-11-25T00:00:00Z');
  const line = receiptLine(RUN, { kind: 'kv', name: `studioos-s4594-${RUN}-tokens`, id: 'a'.repeat(32) }, at);
  assert.equal(line, `{"run":"${RUN}","kind":"kv","name":"studioos-s4594-${RUN}-tokens","id":"${'a'.repeat(32)}","at":"2026-11-25T00:00:00.000Z"}\n`);
  assert.throws(() => receiptLine(RUN, { kind: 'worker', name: 'studioos' }), /not run/);
  assert.throws(() => receiptLine(RUN, { kind: 'database', name: `studioos-s4594-${RUN}` }), /kind/);
  for (const kind of RECEIPT_KINDS) assert.ok(Object.hasOwn(runResources(RUN), kind), `${kind} is a listed kind`);

  const edited = [
    line,
    `{"run":"${RUN}","kind":"worker","name":"studioos","id":null}`,
    `{"run":"${OTHER}","kind":"worker","name":"studioos-s4594-${OTHER}","id":null}`,
    `{"run":"${RUN}","kind":"worker","name":"studioos-s4594-${RUN}","id":null}`,
    `{"run":"${RUN}","kind":"queue","name":"studioos-agent-q`, // torn last write
  ].join('\n');
  const r = parseReceipt(edited, RUN);
  assert.deepEqual(r.entries.map((e) => e.name), [`studioos-s4594-${RUN}-tokens`, `studioos-s4594-${RUN}`]);
  assert.equal(r.torn, 1);
  assert.deepEqual(r.refused, ['studioos', `studioos-s4594-${OTHER}`]);

  // Even fed straight to the selection, a receipt that names production selects nothing it does not list as the run's.
  const { delete: del, gone } = selectForSweep({ run: RUN, listed: PRODUCTION, receipt: [{ kind: 'worker', name: 'studioos', id: null }, ...r.entries] });
  assert.deepEqual(del, []);
  assert.deepEqual(gone.sort(), ['kv:studioos-s4594-a12345678-tokens', 'worker:studioos', 'worker:studioos-s4594-a12345678'].sort(), 'named but no longer listed: already gone');
});

test('receipt: a namespace the listing shows without an id takes the receipt\'s id', () => {
  const title = `studioos-s4594-${RUN}-tokens`;
  const { delete: del } = selectForSweep({ run: RUN, listed: { worker: [], d1: [], kv: [{ title }], queue: [], bucket: [], workflow: [] }, receipt: [{ kind: 'kv', name: title, id: 'd'.repeat(32) }] });
  assert.deepEqual(del, [{ kind: 'kv', name: title, id: 'd'.repeat(32) }]);
});

test('left: zero only when every list was read and none of the run\'s names remain', () => {
  const empty = { worker: [], d1: [], kv: [], queue: [], bucket: [], workflow: [] };
  assert.equal(leftCount({ run: RUN, listed: merge(empty, PRODUCTION, runResources(OTHER)) }).left, 0);
  const one = leftCount({ run: RUN, listed: { ...empty, queue: [`studioos-agent-queue-s4594-${RUN}-dlq`] } });
  assert.deepEqual([one.left, one.still], [1, [`queue:studioos-agent-queue-s4594-${RUN}-dlq`]]);
  const unread = leftCount({ run: RUN, listed: { ...empty, bucket: undefined } });
  assert.deepEqual([unread.left, unread.unread], [1, ['bucket']], 'a list that could not be read is never zero');
});

const WF = readFileSync(new URL('../../.github/workflows/agent-stage-a.yml', import.meta.url), 'utf8');
const job = (name) => { const m = new RegExp(`\\n  ${name}:\\n([\\s\\S]*?)(?=\\n  [a-z][a-z-]*:\\n|$)`).exec(WF); assert.ok(m, `job ${name}`); return m[1]; };

test('workflow: the sweep job runs always, after Stage A, in the same environment, and fails on anything left', () => {
  const a = job('stage-a');
  const s = job('sweep');
  assert.match(s, /^ {4}needs: stage-a$/m);
  assert.match(s, /^ {4}if: \$\{\{ always\(\) \}\}$/m, 'runs after a pass, a failure, a cancellation or a timeout');
  const env = (j) => /^ {4}environment: (\S+)$/m.exec(j)?.[1];
  assert.ok(env(a), 'Stage A names an environment');
  assert.equal(env(s), env(a), 'the sweep holds the same credentials as the run it sweeps');
  assert.match(s, /node scripts\/agent-stage-a-sweep\.mjs --run "a\$\{RUN_ID\}" --receipt /);
  assert.match(s, /name: agent-stage-a-receipt[\s\S]*run-id: \$\{\{ steps\.which\.outputs\.github_run_id \}\}/, 'the receipt of the run being swept');
  assert.match(s, /Fetch the receipt\n\s+continue-on-error: true/, 'a missing receipt does not stop the sweep');
  assert.match(s, /Resources left: /);
  assert.match(s, /actions: read/, 'reading another run\'s artifact');
  assert.doesNotMatch(s, /continue-on-error: true\n\s+uses: actions\/upload|- name: Sweep\n\s+continue-on-error/, 'the sweep step itself fails the job');
});

test('workflow: a receipt per run kept even on failure, a sweep-only dispatch, the harness pinned', () => {
  const a = job('stage-a');
  assert.match(a, /--receipt "\$RUNNER_TEMP\/agent-stage-a-receipt\.jsonl"/);
  assert.match(a, /- name: Keep the receipt\n\s+if: always\(\)\n\s+uses: actions\/upload-artifact@[0-9a-f]{40}[^\n]*\n\s+with:\n\s+name: agent-stage-a-receipt/);
  assert.match(WF, /workflow_dispatch:\n\s+inputs:\n\s+sweep_run_id:/);
  assert.match(a, /^ {4}if: \$\{\{ inputs\.sweep_run_id == '' \}\}$/m, 'a sweep-only dispatch creates nothing');
  assert.match(job('sweep'), /case "\$id" in ''\|\*\[!0-9\]\*\) /, 'the dispatched id is digits or the job stops');
  for (const j of [a, job('sweep')]) {
    assert.match(j, /actions\/checkout@[0-9a-f]{40}[^\n]*\n\s+with:\n\s+ref: \$\{\{ github\.sha \}\}/, 'the harness revision is pinned');
    assert.match(j, /Harness: \\`\$\{GITHUB_SHA\}\\`/, 'and the summary states it');
  }
  assert.doesNotMatch(WF, /^\s+(schedule|push|pull_request):/m, 'still dispatch only');
});

test('harness: a receipt line is written for every kind Stage A creates, the Worker before its deploy', () => {
  const src = readFileSync(new URL('../agent-stage-a.mjs', import.meta.url), 'utf8');
  for (const kind of RECEIPT_KINDS) assert.match(src, new RegExp(`receipt\\('${kind}'`), `${kind}`);
  assert.ok(src.indexOf("receipt('worker'") < src.indexOf("wrangler(['deploy', '--config', FLAT_PATH])"), 'a killed deploy is still swept');
  assert.match(src, /harness: HARNESS/, 'the summary names the commit the harness ran from');
});
