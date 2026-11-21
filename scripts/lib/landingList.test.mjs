// D6469 (#6469): the landing list on fixtures. Tiering is merge-policy's; a
// pending, red or draft PR is never listed; order follows the overlap report;
// an uncomputed mergeable state reads unknown; the sticky issue is edited in place.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { classify } from '../merge-policy.mjs';
import { MARKER, TITLE, eligibility, entry, history, landingOrder, policyFiles, render, ruleOf, tierOf } from './landingList.mjs';
import { collect, main, measure, upsertSticky } from '../landing-list.mjs';

const NOW = Date.parse('2026-11-15T12:00:00Z');
const SHA = n => String(n).padStart(40, 'a').slice(-40).replace(/[^a-f0-9]/g, 'a');
const REQUIRED = ['ci / fast', 'landing gate'];
const runs = (conclusion = 'success', status = 'completed') => REQUIRED.map((name, i) => ({ id: i + 1, name, status, conclusion }));
const f = (filename, status = 'added', extra = {}) => ({ filename, status, ...extra });

function fixture({ prs, files = {}, checks = {}, details = {}, issues = [], closed = [] }) {
  const writes = [];
  const api = async (method, path, body) => {
    if (method !== 'GET') { writes.push({ method, path, body }); return {}; }
    let m;
    if (path.startsWith('pulls?state=open')) return /page=1(&|$)/.test(path) ? prs : [];
    if (path.startsWith('pulls?state=closed')) return /page=1(&|$)/.test(path) ? closed : [];
    if ((m = /^pulls\/(\d+)\/files/.exec(path))) return /page=1(&|$)/.test(path) ? (files[m[1]] ?? []) : [];
    if ((m = /^pulls\/(\d+)$/.exec(path))) return details[m[1]] ?? { state: 'open', mergeable: true, mergeable_state: 'clean', changed_files: (files[m[1]] ?? []).length, head: prs.find(p => p.number === Number(m[1]))?.head };
    if (path.startsWith('rules/branches/')) return [{ type: 'required_status_checks', parameters: { required_status_checks: REQUIRED.map(context => ({ context })) } }];
    if ((m = /^commits\/([a-f0-9]{40})\/check-runs/.exec(path))) {
      const pr = prs.find(p => p.head.sha === m[1]);
      return { check_runs: checks[pr.number] ?? runs() };
    }
    if (path.startsWith('issues?state=open')) return /page=1(&|$)/.test(path) ? issues : [];
    throw new Error(`unexpected ${path}`);
  };
  return { api, writes };
}
const pr = (number, extra = {}) => ({ number, title: `PR ${number}`, state: 'open', draft: false, created_at: '2026-11-13T12:00:00Z',
  html_url: `https://github.com/AxalNetwork/StudioOS/pull/${number}`, head: { sha: SHA(number) }, base: { ref: 'main' }, labels: [], ...extra });

test('tiering is merge-policy.mjs over the REST file list, including renames and unknown statuses', () => {
  const rows = [f('documentation/x.md'), f('cloudflare-worker/src/routes/a.ts', 'modified'), f('documentation/y.md', 'renamed', { previous_filename: 'scripts/z.mjs' })];
  assert.deepEqual(tierOf(rows), classify([
    { path: 'documentation/x.md', status: 'A', patch: '' }, { path: 'cloudflare-worker/src/routes/a.ts', status: 'M', patch: '' },
    { path: 'documentation/y.md', status: 'R', previousPath: 'scripts/z.mjs', patch: '' },
  ]));
  assert.equal(tierOf([f('documentation/x.md')]).tier, 'T0');
  assert.equal(tierOf([f('cloudflare-worker/src/routes/a.ts', 'modified')]).tier, 'T1');
  assert.equal(tierOf([f('cloudflare-worker/sql/migrations/1.sql')]).tier, 'T2');
  assert.equal(tierOf([f('documentation/x.md', 'unchanged')]).tier, 'T2', 'an unknown status is T2, as merge-policy decides');
  assert.equal(policyFiles([f('documentation/x.md', 'removed')])[0].status, 'D');
  assert.equal(tierOf([f('frontend/test/a.test.mjs', 'modified', { patch: '@@ -1 +1 @@\n+test.skip("x")' })]).tier, 'T2');
  assert.equal(ruleOf('T2: protected path: scripts/a.mjs'), 'protected path');
  assert.equal(ruleOf('Timeout changed: frontend/test/a.test.mjs'), 'Timeout changed');
  assert.equal(ruleOf('T1: route, service, or page: x'), null);
});

test('a pending, red, unreadable or draft PR is not listed; a green one is', async () => {
  const prs = [pr(1), pr(2), pr(3), pr(4, { draft: true }), pr(5)];
  const { api } = fixture({ prs, files: { 1: [f('documentation/a.md')], 2: [f('documentation/b.md')], 3: [f('documentation/c.md')], 5: [f('documentation/e.md')] },
    checks: { 2: runs('', 'in_progress'), 3: runs('failure'), 5: [{ id: 1, name: 'ci / fast', status: 'completed', conclusion: 'success' }] } });
  const list = await collect({ api, now: NOW });
  assert.deepEqual(list.entries.map(e => e.number), [1]);
  assert.deepEqual(list.excluded, { draft: 1, 'required check failed': 1, 'required check pending': 2 });
  assert.equal(eligibility({ draft: false, checks: { status: 'unknown' } }).listed, false);
  assert.equal(eligibility({ draft: false, checks: { status: 'none required' } }).listed, false);
  assert.equal(eligibility({ draft: true, checks: { status: 'passing' } }).listed, false);
  assert.equal(eligibility({ draft: false, checks: { status: 'passing' } }).listed, true);
});

test('a detail read that says draft or closed drops the PR', async () => {
  const prs = [pr(1), pr(2)];
  const { api } = fixture({ prs, files: { 1: [f('documentation/a.md')], 2: [f('documentation/b.md')] },
    details: { 1: { state: 'open', draft: true, head: prs[0].head }, 2: { state: 'closed', head: prs[1].head } } });
  const list = await collect({ api, now: NOW });
  assert.deepEqual(list.entries, []);
  assert.deepEqual(list.excluded, { draft: 1, 'not open': 1 });
});

test('order: T2 and model-changed first, each group in the overlap report\'s suggested order', () => {
  const mk = (number, tier, files, extra = {}) => ({ number, tier, files: files.map(p => f(p)), changed_files: files.length, modelChanged: false, ...extra });
  const shared = 'frontend/src/pages/x.jsx';
  const list = [
    mk(10, 'T1', [shared]), mk(11, 'T1', [shared, 'a', 'b']), mk(12, 'T0', ['c']),
    mk(20, 'T2', ['d', 'e']), mk(21, 'T1', ['f'], { modelChanged: true }), mk(22, 'T2', ['g', 'h', 'i']),
  ];
  // Owner group: #21 (1 file), #20 (2), #22 (3). Then the #10/#11 cluster, which leads with #10 (1 file, lower than #12),
  // keeps its own sequence #10 -> #11 (fewer files first) even though #12 sorts before #11 on its own.
  const order = landingOrder(list).map(e => e.number);
  assert.deepEqual(order.slice(0, 3), [21, 20, 22]);
  assert.ok(order.indexOf(10) < order.indexOf(11), 'the overlap cluster keeps its suggested sequence');
  assert.deepEqual(order, [21, 20, 22, 10, 11, 12]);
});

test('an unknown mergeable state is shown as unknown, never clean', async () => {
  const prs = [pr(1)];
  const { api } = fixture({ prs, files: { 1: [f('documentation/a.md')] }, details: { 1: { state: 'open', mergeable: null, mergeable_state: 'unknown', head: prs[0].head } } });
  const list = await collect({ api, now: NOW });
  assert.equal(list.entries[0].merge.status, 'unknown');
  const body = render(list.entries, { generatedAt: 'now' });
  assert.match(body, /mergeable: unknown/);
  assert.doesNotMatch(body, /mergeable: clean/);
});

test('model-changed labels mark a PR "model-changed, owner lands", even at T0', () => {
  const e = entry({ ...pr(7, { labels: [{ name: 'bot:resolved' }] }), files: [f('documentation/a.md')], detail: { mergeable: true, mergeable_state: 'clean', changed_files: 1 } }, NOW);
  assert.equal(e.tier, 'T0');
  assert.equal(e.modelChanged, true);
  assert.equal(entry({ ...pr(8, { labels: ['main-repair'] }), files: [f('documentation/a.md')] }, NOW).modelChanged, true);
  const body = render([e], { generatedAt: 'now' });
  assert.match(body, /Owner lands: T2 and model-changed \(1\)[\s\S]*#7[\s\S]*model-changed, owner lands[\s\S]*T0 \/ T1 \(0\)/);
});

test('the rendered list links each PR, escapes titles, and carries the marker first', () => {
  const e = entry({ ...pr(9, { title: 'fix @owner <b>|x' }), files: [f('scripts/a.mjs')], detail: { mergeable: true, mergeable_state: 'clean', changed_files: 1 } }, NOW);
  const body = render([e], { generatedAt: '2026-11-15T12:00:00.000Z', excluded: { draft: 2 } });
  assert.ok(body.startsWith(MARKER));
  assert.match(body, /\[#9\]\(https:\/\/github\.com\/AxalNetwork\/StudioOS\/pull\/9\)/);
  assert.doesNotMatch(body, /@owner|<b>/);
  assert.match(body, /T2: protected path/);
  assert.match(body, /age: 2 d/);
  assert.match(body, /Not listed: 2 draft\./);
});

test('history: tier share and the T2 rules matched most often, a PR counted once per rule', async () => {
  const closed = [
    { number: 1, merged_at: '2026-11-10T00:00:00Z' }, { number: 2, merged_at: '2026-11-11T00:00:00Z' },
    { number: 3, merged_at: '2026-11-12T00:00:00Z' }, { number: 4, merged_at: null }, { number: 5, merged_at: '2026-11-13T00:00:00Z' },
  ];
  const { api } = fixture({ prs: [], closed, files: {
    1: [f('documentation/a.md')], 2: [f('cloudflare-worker/src/routes/a.ts', 'modified')],
    3: [f('scripts/a.mjs'), f('scripts/b.mjs')], 5: [f('package.json', 'modified'), f('unclassified/x', 'modified')],
  } });
  const all = await measure({ api, count: 10 });
  assert.equal(all.h.total, 4, 'an unmerged closed PR never counts');
  assert.deepEqual(all.h.counts, { T0: 1, T1: 1, T2: 2 });
  assert.equal(all.h.share.T2, 50);
  const m = await measure({ api, count: 3 });
  assert.deepEqual(m.results.map(r => r.number), [5, 3, 2], 'the newest three merges');
  assert.deepEqual(m.h.counts, { T0: 0, T1: 1, T2: 2 });
  assert.equal(m.h.share.T2, 66.7);
  assert.deepEqual(m.h.top, [{ rule: 'protected path', prs: 2 }, { rule: 'unmatched path', prs: 1 }]);
  assert.deepEqual(history([]).share, { T0: null, T1: null, T2: null });
});

test('the sticky issue is edited in place, created once, unchanged bodies write nothing', async () => {
  const author = 'github-actions[bot]';
  const mine = { number: 77, user: { login: author }, body: `${MARKER}\nold` };
  let fx = fixture({ prs: [], issues: [{ number: 1, user: { login: author }, body: 'other' }, { number: 2, user: { login: 'someone' }, body: `${MARKER}\nfake` }, mine] });
  assert.equal(await upsertSticky(fx.api, `${MARKER}\nnew`, { author }), 1);
  assert.deepEqual(fx.writes, [{ method: 'PATCH', path: 'issues/77', body: { body: `${MARKER}\nnew` } }]);
  fx = fixture({ prs: [], issues: [mine] });
  assert.equal(await upsertSticky(fx.api, mine.body, { author }), 0);
  assert.equal(fx.writes.length, 0);
  fx = fixture({ prs: [], issues: [] });
  assert.equal(await upsertSticky(fx.api, `${MARKER}\nfirst`, { author }), 1);
  assert.deepEqual(fx.writes, [{ method: 'POST', path: 'issues', body: { title: TITLE, body: `${MARKER}\nfirst` } }]);
  fx = fixture({ prs: [], issues: [] });
  assert.equal(await upsertSticky(fx.api, `${MARKER}\nfirst`, { author, dryRun: true }), 0);
  assert.equal(fx.writes.length, 0);
});

test('the CLI writes nothing but the sticky issue body: no label, merge, review or queue call', async () => {
  const prs = [pr(1, { labels: [{ name: 'main-repair' }] })];
  const fx = fixture({ prs, files: { 1: [f('documentation/a.md')] } });
  const list = await main(['--sticky'], { api: fx.api, log() {}, now: NOW, author: 'github-actions[bot]' });
  assert.equal(list.writes, 1);
  assert.deepEqual(fx.writes.map(w => `${w.method} ${w.path}`), ['POST issues']);
  await assert.rejects(main(['--dry-run'], { api: fx.api, log() {} }), /usage/);
  await assert.rejects(main(['--merge'], { api: fx.api, log() {} }), /usage/);
  const source = readFileSync(new URL('../landing-list.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\/labels|\/merge|\/reviews|auto-merge|enablePullRequestAutoMerge|'PUT'/);
});

test('the workflow step runs the list hourly after the overlap report with no new permission', () => {
  const source = readFileSync(new URL('../../.github/workflows/pr-overlap.yml', import.meta.url), 'utf8');
  assert.match(source, /- name: Update the owner's landing list[\s\S]*run: node scripts\/landing-list\.mjs --sticky/);
  assert.ok(source.indexOf('landing-list.mjs') > source.indexOf('scripts/pr-overlap.mjs'));
  assert.match(source, /cron: '31 \* \* \* \*'/);
});
