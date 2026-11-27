import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renamePlan, renameReleases } from '../release-alpha-rename.mjs';

const sha = (n) => n.toString(16).padStart(40, '0');
const RELEASES = [
  { id: 3, tag_name: 'v8.3.26', name: 'v8.3.26', draft: true, target_commitish: sha(3) },
  { id: 2, tag_name: 'v8.3.23', name: 'v8.3.23', draft: false, target_commitish: sha(2) },
  { id: 1, tag_name: 'v1.0.1', name: 'v1.0.1', draft: false, target_commitish: sha(1) },
  { id: 9, tag_name: 'v0.28.0-alpha', name: 'v0.28.0-alpha', draft: false },
];

/** A GitHub stand-in: `refs` maps tag → { type, sha }, annotated tags in `annotated`. */
function fake({ releases = RELEASES, refs = {}, annotated = {} } = {}) {
  const writes = [], pauses = [];
  const api = async (path, options = {}) => {
    if (!options.method) {
      if (path.includes('/releases?')) return path.endsWith('page=1') ? releases : [];
      const ref = path.match(/\/git\/ref\/tags\/(.+)$/);
      if (ref) {
        const r = refs[decodeURIComponent(ref[1])];
        if (!r) { if (options.allow404) return null; throw new Error('404'); }
        return { object: r };
      }
      const tag = path.match(/\/git\/tags\/(.+)$/);
      if (tag) return { object: { sha: annotated[tag[1]] } };
      throw new Error(`unexpected GET ${path}`);
    }
    writes.push({ path, method: options.method, body: options.body });
    return {};
  };
  return { api, writes, pauses, pause: async (ms) => pauses.push(ms) };
}

test('the plan: every unsuffixed release, oldest first; suffixed ones untouched', () => {
  const plan = renamePlan(RELEASES, 'alpha');
  // Mutation checked: drop .reverse() → v8.3.26 comes first.
  assert.deepEqual(plan.map((r) => [r.id, r.from, r.tag, r.draft]), [
    [1, 'v1.0.1', 'v1.0.1-alpha', false], [2, 'v8.3.23', 'v8.3.23-alpha', false], [3, 'v8.3.26', 'v8.3.26-alpha', true],
  ]);
  assert.equal(renamePlan([{ id: 5, tag_name: 'v1.0.2', name: 'Launch' }], 'alpha')[0].name, 'Launch', 'a custom title stays');
  // Mutation checked: skip the clash check → the plan renames onto another release's tag.
  assert.throws(() => renamePlan([...RELEASES, { id: 7, tag_name: 'v1.0.1-alpha' }], 'alpha'), /already belongs to release 7/);
  assert.throws(() => renamePlan(RELEASES, 'stable'), /stable/);
});

test('a published release gets a new tag on its old tag\'s commit, then moves onto it', async () => {
  const f = fake({ refs: { 'v1.0.1': { type: 'commit', sha: sha(11) }, 'v8.3.23': { type: 'tag', sha: 'a'.repeat(40) } }, annotated: { ['a'.repeat(40)]: sha(22) } });
  const done = await renameReleases({ ...f, repo: 't/r', stage: 'alpha' });
  assert.deepEqual(done, { drafts: 1, published: 2, tagsCreated: 2, tagsDeleted: 0, planned: 3 });
  // Mutation checked: tag target_commitish instead of the old tag's commit → sha(1), not sha(11).
  assert.deepEqual(f.writes.map((w) => [w.method, w.path, w.body]), [
    ['POST', '/repos/t/r/git/refs', { ref: 'refs/tags/v1.0.1-alpha', sha: sha(11) }],
    ['PATCH', '/repos/t/r/releases/1', { tag_name: 'v1.0.1-alpha', name: 'v1.0.1-alpha' }],
    // An annotated tag is followed to its commit.
    ['POST', '/repos/t/r/git/refs', { ref: 'refs/tags/v8.3.23-alpha', sha: sha(22) }],
    ['PATCH', '/repos/t/r/releases/2', { tag_name: 'v8.3.23-alpha', name: 'v8.3.23-alpha' }],
    // A draft has no tag yet: only its name and tag change.
    ['PATCH', '/repos/t/r/releases/3', { tag_name: 'v8.3.26-alpha', name: 'v8.3.26-alpha' }],
  ]);
  assert.deepEqual(f.pauses, [1100, 1100, 1100]);
  assert.ok(!f.writes.some((w) => w.method === 'DELETE'), 'old tags stay unless asked');
});

test('a rerun reuses a suffixed tag already on the same commit, and refuses one on another', async () => {
  const one = [{ id: 1, tag_name: 'v1.0.1', name: 'v1.0.1', draft: false, target_commitish: sha(1) }];
  const same = fake({ releases: one, refs: { 'v1.0.1': { type: 'commit', sha: sha(1) }, 'v1.0.1-alpha': { type: 'commit', sha: sha(1) } } });
  assert.equal((await renameReleases({ ...same, repo: 't/r', stage: 'alpha' })).tagsCreated, 0);
  assert.deepEqual(same.writes.map((w) => w.method), ['PATCH']);
  const other = fake({ releases: one, refs: { 'v1.0.1': { type: 'commit', sha: sha(1) }, 'v1.0.1-alpha': { type: 'commit', sha: sha(9) } } });
  // Mutation checked: ignore the existing tag's commit → the release moves to a different commit.
  await assert.rejects(renameReleases({ ...other, repo: 't/r', stage: 'alpha' }), /another commit/);
  assert.deepEqual(other.writes, []);
});

test('a published release with no tag uses its pinned commit, and with neither it fails before writing', async () => {
  const pinned = fake({ releases: [{ id: 1, tag_name: 'v1.0.1', name: 'v1.0.1', draft: false, target_commitish: sha(5) }] });
  await renameReleases({ ...pinned, repo: 't/r', stage: 'alpha' });
  assert.deepEqual(pinned.writes[0].body, { ref: 'refs/tags/v1.0.1-alpha', sha: sha(5) });
  const loose = fake({ releases: [{ id: 1, tag_name: 'v1.0.1', name: 'v1.0.1', draft: false, target_commitish: 'main' }] });
  await assert.rejects(renameReleases({ ...loose, repo: 't/r', stage: 'alpha' }), /no tag and no pinned commit/);
  assert.deepEqual(loose.writes, []);
});

test('--delete-old-tags removes a published release\'s old tag after the move; dry run writes nothing', async () => {
  const f = fake({ refs: { 'v1.0.1': { type: 'commit', sha: sha(1) }, 'v8.3.23': { type: 'commit', sha: sha(2) } } });
  const done = await renameReleases({ ...f, repo: 't/r', stage: 'alpha', deleteOldTags: true });
  // Mutation checked: delete before the PATCH → the DELETE precedes the move.
  const order = f.writes.map((w) => `${w.method} ${w.path}`);
  assert.ok(order.indexOf('PATCH /repos/t/r/releases/1') < order.indexOf('DELETE /repos/t/r/git/refs/tags/v1.0.1'));
  assert.equal(done.tagsDeleted, 2, 'a draft has no tag to delete');
  const dry = fake();
  assert.deepEqual(await renameReleases({ ...dry, repo: 't/r', stage: 'alpha', dryRun: true }), { drafts: 0, published: 0, tagsCreated: 0, tagsDeleted: 0, planned: 3 });
  assert.deepEqual(dry.writes, []);
  assert.deepEqual(dry.pauses, []);
});

test('the workflow runs only by hand, dry by default, in the draft updater\'s lane', () => {
  const yml = readFileSync('.github/workflows/release-alpha-rename.yml', 'utf8');
  assert.match(yml, /^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(yml, /^\s+(push|schedule|release):/m);
  assert.match(yml, /dry_run:[\s\S]*?default: true/);
  assert.match(yml, /delete_old_tags:[\s\S]*?default: false/);
  assert.match(yml, /group: release-draft/);
});
