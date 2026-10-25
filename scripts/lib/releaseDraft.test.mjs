import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nextReleaseTag, parseRelease, releaseBadge } from '../../frontend/src/lib/release.js';
import { readMainCommits, dailyReleasePlan, draftPayload, readReleases, updateDraft, trimBody } from '../release-draft.mjs';
const sha = (n) => n.toString(16).padStart(40, '0');
const commit = (date, n = 1) => ({ sha: sha(n), date });
const commits = [commit('2026-03-25T12:00:00Z'), commit('2026-03-25T13:00:00Z', 2), commit('2026-04-02T12:00:00Z', 3)];
const marker = (day) => `<!-- studioos-daily-release:${day} -->`;

test('versions count commit months cumulatively, with zero-based active weeks and days reset monthly', () => {
  assert.equal(nextReleaseTag(['2026-03-25']), 'v1.0.1');
  assert.equal(nextReleaseTag(['2026-03-25', '2026-03-25', '2026-04-02']), 'v2.0.1');
  assert.equal(nextReleaseTag(['2026-12-31', '2027-01-01']), 'v2.0.1');
  assert.equal(nextReleaseTag(['2025-10-23', '2026-10-23']), 'v2.0.1');
  assert.equal(nextReleaseTag(['2026-10-18', '2026-10-19']), 'v1.0.2');
  assert.equal(nextReleaseTag(['2026-10-07', '2026-10-08']), 'v1.1.2');
  const october = Array.from({ length: 23 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`);
  const earlierMonths = [3, 4, 5, 6, 7, 8, 9].map((m) => `2026-${String(m).padStart(2, '0')}-25`);
  assert.equal(nextReleaseTag([...earlierMonths, ...october]), 'v8.3.23');
  assert.equal(nextReleaseTag(october.filter((d) => !d.endsWith('-02'))), 'v1.3.22');
  assert.equal(nextReleaseTag(['2026-10-01', '2026-10-08', '2026-10-22']), 'v1.2.3');
  assert.equal(nextReleaseTag(Array.from({ length: 31 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`)), 'v1.4.31');
  for (const days of [[], ['bad'], ['2026-02-30']]) assert.throws(() => nextReleaseTag(days));
});

test('one plan per UTC main commit day, exact final commit and comparison boundary', () => {
  assert.deepEqual(dailyReleasePlan(commits), [
    { date: '2026-03-25', target: sha(2), count: 2, tag: 'v1.0.1', previous: null },
    { date: '2026-04-02', target: sha(3), count: 1, tag: 'v2.0.1', previous: sha(2) },
  ]);
  assert.equal(dailyReleasePlan([commit('2026-03-25T23:30:00-02:00')])[0].date, '2026-03-26');
  assert.deepEqual(dailyReleasePlan([]), []);
  assert.throws(() => dailyReleasePlan([{ sha: 'main', date: '2026-03-25' }]), /SHA/);
  assert.throws(() => dailyReleasePlan([commit('bad')]), /date/);
});

test('draft names, dates, counts and comparison links describe that day, not publication day', () => {
  const [first, last] = dailyReleasePlan(commits).map((row) => draftPayload(row, 'test/repo'));
  assert.equal(first.tag_name, 'v1.0.1');
  assert.equal(last.target_commitish, sha(3));
  assert.equal(last.name, 'v2.0.1');
  assert.equal(last.draft, true);
  assert.equal(last.prerelease, false);
  assert.match(first.body, /2 commits on main/);
  assert.ok(first.body.includes(`/commits/${sha(2)}`));
  assert.ok(last.body.includes(`/compare/${sha(2)}...${sha(3)}`));
  assert.ok(last.body.includes(marker('2026-04-02')));
});

test('complete paginated release history is read', async () => {
  const calls = [];
  const result = await readReleases(async (path) => { calls.push(path); return path.endsWith('page=1') ? Array(100).fill({}) : [{ id: 101 }]; }, 'test/repo');
  assert.equal(result.length, 101);
  assert.deepEqual(calls, ['/repos/test/repo/releases?per_page=100&page=1', '/repos/test/repo/releases?per_page=100&page=2']);
});

function fake(releases) {
  const writes = [], pauses = [];
  const api = async (path, options) => {
    if (!options) return releases;
    writes.push({ path, ...options });
    return {};
  };
  return { api, writes, pauses, pause: async (ms) => pauses.push(ms) };
}

test('backfill creates every missing day despite legacy releases being published today', async () => {
  const f = fake([{ id: 10, tag_name: 'v0.28.0-alpha', draft: false, published_at: '2026-10-23T17:00:00Z' }]);
  assert.deepEqual(await updateDraft({ ...f, repo: 'test/repo', commits }), { days: 2, written: 2, frozen: 0, latest: 'v2.0.1' });
  assert.deepEqual(f.writes.map((w) => [w.path, w.method, w.body.tag_name, w.body.target_commitish]), [
    ['/repos/test/repo/releases', 'POST', 'v1.0.1', sha(2)], ['/repos/test/repo/releases', 'POST', 'v2.0.1', sha(3)],
  ]);
  assert.deepEqual(f.pauses, [1100, 1100]);
});

test('only matching drafts refresh; published daily versions and legacy releases are fixed', async () => {
  const f = fake([
    { id: 10, tag_name: 'v0.28.0-alpha', draft: false },
    { id: 11, tag_name: 'v1.0.1', draft: false, target_commitish: sha(1), body: marker('2026-03-25') },
    { id: 12, tag_name: 'v2.0.1', draft: true, body: marker('2026-04-02') },
    { id: 13, tag_name: 'v90.1.1', draft: true, body: marker('2026-05-01') },
  ]);
  assert.deepEqual(await updateDraft({ ...f, repo: 'test/repo', commits }), { days: 2, written: 1, frozen: 1, latest: 'v2.0.1' });
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].path, '/repos/test/repo/releases/12');
  assert.equal(f.writes[0].method, 'PATCH');
  assert.ok(f.writes[0].body.body.includes(`/compare/${sha(1)}...${sha(3)}`), 'late changes after frozen release remain in next comparison');
});

test('unchanged drafts are idempotent and dry-run makes no release writes or waits', async () => {
  const releases = dailyReleasePlan(commits).map((r, i) => ({ id: i + 1, ...draftPayload(r, 'test/repo') }));
  const f = fake(releases);
  assert.equal((await updateDraft({ ...f, repo: 'test/repo', commits })).written, 0);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.pauses, []);
  const dry = fake([]);
  assert.equal((await updateDraft({ ...dry, repo: 'test/repo', commits, dryRun: true })).written, 2);
  assert.deepEqual(dry.writes, []);
  assert.deepEqual(dry.pauses, []);
});

test('an unrelated release with the same tag fails before writing', async () => {
  const f = fake([{ id: 30, tag_name: 'v1.0.1', draft: false, body: 'unrelated' }]);
  await assert.rejects(updateDraft({ ...f, repo: 'test/repo', commits }), /another release/);
  assert.deepEqual(f.writes, []);
});

test('workflow fetches complete main history and versions still parse in the badge', () => {
  assert.match(readFileSync('.github/workflows/release-draft.yml', 'utf8'), /fetch-depth: 0/);
  assert.equal(parseRelease('v0.28.0-alpha').stage, 'alpha');
  assert.deepEqual(releaseBadge('v8.3.23'), { label: 'v8.3.23', stage: 'stable' });
  assert.equal(parseRelease('bad'), null);
  assert.deepEqual(releaseBadge(''), { label: 'alpha', stage: 'alpha' });
});

test('long notes remain bounded', () => {
  assert.match(trimBody('row\n'.repeat(500), 100), /cut to fit/);
  assert.equal(trimBody('short'), 'short');
});

 test('history reader requests full first-parent landing dates in ancestry order', () => {
  let call;
  const rows = readMainCommits((...args) => { call = args; return `${sha(1)}\t2026-03-25T12:00:00Z\n`; });
  assert.deepEqual(call.slice(0, 2), ['git', ['log', 'origin/main', '--first-parent', '--reverse', '--format=%H%x09%cI']]);
  assert.deepEqual(rows, [commit('2026-03-25T12:00:00Z')]);
});

test('a published daily release with an unpinned target fails without writing', async () => {
  const f = fake([{ id: 11, tag_name: 'v1.0.1', draft: false, target_commitish: 'main', body: marker('2026-03-25') }]);
  await assert.rejects(updateDraft({ ...f, repo: 'test/repo', commits }), /pin its commit/);
  assert.deepEqual(f.writes, []);
});

test('renaming a draft frees its old tag before a later day reuses that version', async () => {
  const f = fake([
    { id: 1, tag_name: 'v1.1.2', draft: true, body: marker('2026-03-01') },
    { id: 2, tag_name: 'v2.2.2', draft: true, body: marker('2026-03-08') },
  ]);
  const result = await updateDraft({ ...f, repo: 'test/repo', commits: [commit('2026-03-01T12:00:00Z'), commit('2026-03-08T12:00:00Z', 2)] });
  assert.equal(result.written, 2);
  assert.deepEqual(f.writes.map((w) => [w.path, w.body.tag_name]), [['/repos/test/repo/releases/1', 'v1.0.1'], ['/repos/test/repo/releases/2', 'v1.1.2']]);
  f.writes.length = 0;
  assert.equal((await updateDraft({ ...f, repo: 'test/repo', commits: [commit('2026-03-01T12:00:00Z'), commit('2026-03-08T12:00:00Z', 2)], dryRun: true })).written, 2);
  assert.deepEqual(f.writes, []);
});
