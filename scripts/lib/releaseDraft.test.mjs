// The release rules (frontend/src/lib/release.js) and the draft the workflow
// writes (scripts/release-draft.mjs). Run by release-draft.yml before it writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRelease, nextReleaseTag, releaseBadge, FIRST_RELEASE, RELEASE_STAGE } from '../../frontend/src/lib/release.js';
import { pickReleases, draftPayload, trimBody, BODY_LIMIT } from '../release-draft.mjs';

test('the product is in alpha, and the first release is v0.1.0-alpha', () => {
  assert.equal(RELEASE_STAGE, 'alpha');
  assert.equal(FIRST_RELEASE, 'v0.1.0-alpha');
});

test('tags parse; anything else is refused', () => {
  assert.deepEqual(parseRelease('v0.2.0-alpha'), { major: 0, minor: 2, patch: 0, stage: 'alpha', tag: 'v0.2.0-alpha' });
  assert.equal(parseRelease('v1.0.0').stage, 'stable');
  assert.equal(parseRelease('v0.3.1-beta.2').stage, 'beta');
  for (const bad of ['', '0.2.0', 'v0.2', 'v0.2.0-gamma', 'latest', null]) assert.equal(parseRelease(bad), null, String(bad));
});

test('each release is a minor bump at the current stage', () => {
  assert.equal(nextReleaseTag(null), 'v0.1.0-alpha');
  assert.equal(nextReleaseTag('v0.1.0-alpha'), 'v0.2.0-alpha');
  assert.equal(nextReleaseTag('v0.2.3-alpha'), 'v0.3.0-alpha');
  assert.equal(nextReleaseTag('v0.9.0-alpha', 'beta'), 'v0.10.0-beta');
  assert.equal(nextReleaseTag('v1.4.0', 'stable'), 'v1.5.0');
});

test('the badge shows a released tag, or the stage alone, never an unreleased version', () => {
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

test('the draft: next tag, on main, pre-release while alpha', () => {
  const first = draftPayload({ lastTag: null, notes: '* a PR' });
  assert.equal(first.tag_name, 'v0.1.0-alpha');
  assert.equal(first.target_commitish, 'main');
  assert.equal(first.draft, true);
  assert.equal(first.prerelease, true);
  assert.match(first.body, /first tagged release/);
  const next = draftPayload({ lastTag: 'v0.1.0-alpha', notes: '* b' });
  assert.equal(next.tag_name, 'v0.2.0-alpha');
  assert.match(next.body, /Changes since v0\.1\.0-alpha/);
  assert.equal(draftPayload({ lastTag: 'v1.0.0', notes: '', stage: 'stable' }).prerelease, false);
});

test("a body over GitHub's limit is cut on a line, with a note", () => {
  const long = Array.from({ length: 5000 }, (_, i) => `* PR ${i} by someone in https://example.test/${i}`).join('\n');
  const cut = trimBody(long);
  assert.ok(cut.length <= BODY_LIMIT + 200);
  assert.match(cut, /cut to fit/);
  assert.equal(trimBody('short'), 'short');
});
