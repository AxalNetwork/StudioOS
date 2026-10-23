// The release rules (frontend/src/lib/release.js) and the draft the workflow
// writes (scripts/release-draft.mjs). Run by release-draft.yml before it writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRelease, nextReleaseTag, releaseBadge, FIRST_RELEASE, RELEASE_STAGE } from '../../frontend/src/lib/release.js';
import { pickReleases, draftPayload, trimBody, BODY_LIMIT, readReleases, updateDraft } from '../release-draft.mjs';

test('the product stays in alpha, while counter tags start at v1.1.1', () => {
  assert.equal(RELEASE_STAGE, 'alpha');
  assert.equal(FIRST_RELEASE, 'v1.1.1');
});

test('tags parse; anything else is refused', () => {
  assert.deepEqual(parseRelease('v0.2.0-alpha'), { major: 0, minor: 2, patch: 0, stage: 'alpha', tag: 'v0.2.0-alpha' });
  assert.equal(parseRelease('v1.0.0').stage, 'stable');
  assert.equal(parseRelease('v0.3.1-beta.2').stage, 'beta');
  for (const bad of ['', '0.2.0', 'v0.2', 'v0.2.0-gamma', 'latest', null]) assert.equal(parseRelease(bad), null, String(bad));
});

const now = new Date('2026-10-23T12:00:00Z');
const published = (date, tag = 'v0.8.0') => ({ tag_name: tag, draft: false, published_at: `${date}T08:00:00Z` });

test('counter tags count active months, Monday weeks and UTC days, never empty periods', () => {
  assert.equal(nextReleaseTag([], now), 'v1.1.1');
  const history = [published('2026-09-01'), published('2026-09-01'), published('2026-10-19')];
  assert.equal(nextReleaseTag(history, now), 'v2.2.3');
  assert.equal(nextReleaseTag([...history, published('2026-10-23')], now), 'v2.2.3');
  assert.equal(nextReleaseTag([published('2025-10-23')], now), 'v2.2.2');
  assert.equal(nextReleaseTag([published('2026-10-18')], now), 'v1.2.2');
  assert.equal(nextReleaseTag([published('2026-12-31')], new Date('2027-01-01T01:00:00Z')), 'v2.1.2');
});

test('drafts and unrecognized tags do not count; broken publication metadata fails closed', () => {
  assert.equal(nextReleaseTag([{ ...published('2026-09-01'), draft: true }, published('2026-09-02', 'nightly')], now), 'v1.1.1');
  assert.throws(() => nextReleaseTag([{ tag_name: 'v1.1.1', draft: false }], now), /publication date/);
  assert.throws(() => nextReleaseTag([published('2026-10-24')], now), /future/);
  assert.equal(nextReleaseTag([{ ...published('2026-10-22'), published_at: '2026-10-22T23:30:00-02:00' }], now), 'v1.1.1');
});

test('the badge shows a released tag, or the stage alone, never an unreleased version', () => {
  assert.deepEqual(releaseBadge('v1.4.15'), { label: 'v1.4.15', stage: 'stable' });
  assert.deepEqual(releaseBadge('v0.2.0-alpha'), { label: 'v0.2.0-alpha', stage: 'alpha' });
  assert.deepEqual(releaseBadge(''), { label: 'alpha', stage: 'alpha' });
  assert.deepEqual(releaseBadge('not-a-tag'), { label: 'alpha', stage: 'alpha' });
  assert.equal(releaseBadge('', 'stable'), null);
});

test('the last release is the newest PUBLISHED one; drafts never count', () => {
  const { last, draft } = pickReleases([
    { id: 3, tag_name: 'v0.3.0-alpha', draft: true, published_at: null },
    { id: 1, tag_name: 'v0.1.0-alpha', draft: false, published_at: '2026-10-01T00:00:00Z' },
    { id: 2, tag_name: 'v0.2.0-alpha', draft: false, published_at: '2026-10-20T00:00:00Z' },
    { id: 9, tag_name: 'nightly', draft: false, published_at: '2026-10-22T00:00:00Z' },
  ]);
  assert.equal(last.tag_name, 'v0.2.0-alpha');
  assert.equal(draft.id, 3);
  assert.deepEqual(pickReleases([]), { last: null, draft: null });
});

test('the draft uses plain counter tags and the last published release for notes', () => {
  const first = draftPayload({ releases: [], now, notes: '* a PR' });
  assert.equal(first.tag_name, 'v1.1.1');
  assert.equal(first.target_commitish, 'main');
  assert.equal(first.draft, true);
  assert.equal(first.prerelease, false);
  assert.match(first.body, /first tagged release/);
  const next = draftPayload({ releases: [published('2026-09-01')], now, notes: '* b' });
  assert.equal(next.tag_name, 'v2.2.2');
  assert.match(next.body, /Changes since v0\.8\.0/);
});

test('all release pages count, including dates before the most recent 100', async () => {
  const calls = [];
  const api = async (path) => { calls.push(path); return path.endsWith('page=1') ? Array(100).fill(published('2026-10-19')) : [published('2026-09-01')]; };
  const releases = await readReleases(api, 'test/repo');
  assert.equal(releases.length, 101);
  assert.deepEqual(calls, ['/repos/test/repo/releases?per_page=100&page=1', '/repos/test/repo/releases?per_page=100&page=2']);
  assert.equal(nextReleaseTag(releases, now), 'v2.2.3');
});

test('a published release today freezes that day: only the history GET is allowed', async () => {
  const calls = [];
  const result = await updateDraft({ repo: 'test/repo', now, api: async (...args) => { calls.push(args); return [published('2026-10-23'), { id: 99, draft: true }]; } });
  assert.equal(result.skipped, true);
  assert.deepEqual(calls, [['/repos/test/repo/releases?per_page=100&page=1']]);
});

for (const draft of [null, { id: 99, draft: true }]) {
  test(`a new release day ${draft ? 'refreshes only the draft' : 'creates a draft'}, never the published release`, async () => {
    const calls = [];
    const api = async (path, options) => {
      calls.push([path, options]);
      if (!options) return [published('2026-09-01'), ...(draft ? [draft] : [])];
      if (path.endsWith('/generate-notes')) return { body: '* merged change' };
      return {};
    };
    const result = await updateDraft({ api, repo: 'test/repo', now });
    assert.equal(result.skipped, false);
    assert.deepEqual(calls[1], ['/repos/test/repo/releases/generate-notes', { method: 'POST', body: { tag_name: 'v2.2.2', target_commitish: 'main', previous_tag_name: 'v0.8.0' } }]);
    assert.deepEqual(calls[2], [`/repos/test/repo/releases${draft ? '/99' : ''}`, { method: draft ? 'PATCH' : 'POST', body: result.payload }]);
    assert.equal(result.payload.tag_name, 'v2.2.2');
    assert.equal(result.payload.draft, true);
    assert.equal(result.payload.prerelease, false);
    assert.equal(calls.length, 3);
    calls.length = 0;
    await updateDraft({ api, repo: 'test/repo', now, dryRun: true });
    assert.equal(calls.length, 2);
  });
}

test("a body over GitHub's limit is cut on a line, with a note", () => {
  const long = Array.from({ length: 5000 }, (_, i) => `* PR ${i} by someone in https://example.test/${i}`).join('\n');
  const cut = trimBody(long);
  assert.ok(cut.length <= BODY_LIMIT + 200);
  assert.match(cut, /cut to fit/);
  assert.equal(trimBody('short'), 'short');
});
