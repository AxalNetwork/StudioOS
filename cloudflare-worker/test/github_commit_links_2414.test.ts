/** #2414 / D782: exact GitHub commit evidence, tested with real migration SQL and D1 statements. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { addMvpStores } from './_github_mvp_stores.mjs';
import { mvpRun } from '../src/integrations/providers/github/mvp.ts';
import { commitSha, releaseCommitSha, roadmapRun } from '../src/integrations/providers/github/roadmap.ts';

const MERGE = 'a'.repeat(40);
const RELEASE = 'b'.repeat(40);
const TAG = 'c'.repeat(40);
const REPO = '/repos/acme/app';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
function world() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  const baseline = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
  for (const table of ['mvp_features', 'roadmap_okrs']) db.exec(tableFromBaseline(baseline, table));
  for (const name of ['445_connector_fed_items.sql', '499_github_roadmap.sql']) db.exec(readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8'));
  addMvpStores(db);
  db.exec(`INSERT INTO mvp_features (id, project_id, title) VALUES (7, 101, 'Founder-owned title');
    INSERT INTO connector_fed_items (integration_id, project_id, module, kind, external_id, local_table, local_id)
    VALUES (31, 101, 'prototype_mvp', 'pull_request', 'pull:acme/app#12', 'mvp_features', 7);`);
  return { db, env: { DB: d1Over(db) } as any };
}

test('#2414: only merged PR commit evidence is kept; resync refreshes SHA without overwriting founder edits', async () => {
  const { db, env } = world();
  const sync = async (pull: any) => {
    const run = mvpRun(env, 31, 101);
    run.saw('acme/app', 'pulls', [{ number: 12, state: 'open', requested_reviewers: [{}], merge_commit_sha: MERGE, ...pull }]);
    await run.finish(async () => { throw new Error('No review read expected'); }, ['acme/app'], 100);
    return db.prepare('SELECT title, delivery_status, merge_commit_sha FROM mvp_features WHERE id = 7').get() as any;
  };
  try {
    assert.equal((await sync({})).merge_commit_sha, null, 'unmerged test-merge SHA is not evidence');
    const merged = { state: 'closed', merged_at: '2026-10-01T00:00:00Z' };
    assert.equal((await sync(merged)).merge_commit_sha, MERGE);
    db.exec("UPDATE mvp_features SET title = 'Founder edit', delivery_status = 'Review' WHERE id = 7");
    const again = await sync({ ...merged, merge_commit_sha: RELEASE });
    assert.deepEqual({ ...again }, { title: 'Founder edit', delivery_status: 'Review', merge_commit_sha: RELEASE });
    assert.equal((await sync({ ...merged, merge_commit_sha: 'bad' })).merge_commit_sha, null);
    assert.equal((await sync({ state: 'closed', merge_commit_sha: MERGE })).merge_commit_sha, null, 'closed unmerged stays unlinked');
  } finally { db.close(); }
});

test('#2414: release rows store a lightweight tag commit; resync refreshes it and deleted rows stay deleted', async () => {
  const { db, env } = world();
  let sha: string | null = RELEASE;
  const calls: string[] = [];
  const gh = async (path: string) => {
    calls.push(path);
    if (path.startsWith(`${REPO}/milestones?`)) return json([]);
    assert.equal(path, `${REPO}/git/ref/tags/releases%2Fv1`);
    return sha ? json({ object: { type: 'commit', sha } }) : json({}, 404);
  };
  const sync = async () => {
    const run = roadmapRun(env, 31, 101);
    run.saw('acme/app', 'releases', [{ id: 99, tag_name: 'releases/v1', name: 'Release', published_at: '2026-10-02T00:00:00Z' }]);
    return run.finish(gh, ['acme/app'], 100);
  };
  try {
    await sync();
    assert.equal(db.prepare('SELECT commit_sha FROM roadmap_releases').get()?.commit_sha, RELEASE);
    sha = MERGE;
    await sync();
    assert.equal(db.prepare('SELECT commit_sha FROM roadmap_releases').get()?.commit_sha, MERGE);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM roadmap_releases').get()?.n, 1);
    sha = null;
    await sync();
    assert.equal(db.prepare('SELECT commit_sha FROM roadmap_releases').get()?.commit_sha, null);
    db.exec('DELETE FROM roadmap_releases');
    await sync(); // unlinks the stale ledger row
    calls.length = 0;
    await sync();
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM roadmap_releases').get()?.n, 0);
    assert.equal(calls.some(path => path.startsWith(`${REPO}/git/`)), false);
  } finally { db.close(); }
});

test('#2414: annotated tags are peeled, never guessed from target_commitish or tag-object SHA', async () => {
  const calls: string[] = [];
  const resolved = await releaseCommitSha(async path => {
    calls.push(path);
    if (path === `${REPO}/git/ref/tags/v1`) return json({ object: { type: 'tag', sha: TAG }, target_commitish: 'main' });
    assert.equal(path, `${REPO}/git/tags/${TAG}`);
    return json({ object: { type: 'commit', sha: RELEASE } });
  }, REPO, 'v1', () => true);
  assert.deepEqual(resolved, { sha: RELEASE, partial: false });
  assert.equal(calls.length, 2);
  assert.equal(commitSha('B'.repeat(40)), RELEASE);
  for (const value of [null, 'main', 'abcdef0', 'g'.repeat(40)]) assert.equal(commitSha(value), null);
});

test('#2414: tag resolution is bounded and missing/malformed/non-commit results never become evidence', async () => {
  let calls = 0;
  const loop = async () => { calls++; return json({ object: { type: 'tag', sha: TAG } }); };
  assert.deepEqual(await releaseCommitSha(loop, REPO, 'v1', () => false), { sha: null, partial: true });
  assert.equal(calls, 0);
  assert.deepEqual(await releaseCommitSha(loop, REPO, 'v1', () => true), { sha: null, partial: false });
  assert.equal(calls, 2, 'a cyclic tag stops after its repeated object');
  for (const response of [json({}, 404), json({}, 409), json({ object: { type: 'commit', sha: 'main' } }), json({ object: { type: 'tree', sha: RELEASE } })]) {
    assert.deepEqual(await releaseCommitSha(async () => response, REPO, 'v1', () => true), { sha: null, partial: false });
  }
  await assert.rejects(releaseCommitSha(async () => json({}, 500), REPO, 'v1', () => true), /github_api_failed: 500/);
  assert.deepEqual(await releaseCommitSha(loop, REPO, '../bad', () => true), { sha: null, partial: false });
});


test('#2414: exhausted tag budget reports partial without publishing an unresolved release row', async () => {
  const { db, env } = world();
  const run = roadmapRun(env, 31, 101);
  run.saw('acme/app', 'releases', [{ id: 1, tag_name: 'v1' }]);
  let calls = 0;
  try {
    const result = await run.finish(async () => { calls++; return json([]); }, ['acme/app'], 2);
    assert.equal(result.roadmap_partial, true);
    assert.equal(calls, 1, 'only the milestone read fits before the ledger read uses the budget');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM roadmap_releases').get()?.n, 0);
  } finally { db.close(); }
});

test('#2414: a long annotated chain cannot read beyond the six-request cap', async () => {
  let calls = 0;
  const result = await releaseCommitSha(async () => {
    calls++;
    return json({ object: { type: 'tag', sha: calls.toString(16).padStart(40, '0') } });
  }, REPO, 'v1', () => true);
  assert.deepEqual(result, { sha: null, partial: false });
  assert.equal(calls, 6);
});


test('#2414: migration 534 preserves existing rows with unknown commit evidence', () => {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  try {
    const baseline = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
    for (const table of ['mvp_features', 'roadmap_okrs']) db.exec(tableFromBaseline(baseline, table));
    db.exec(readFileSync(new URL('../sql/migrations/499_github_roadmap.sql', import.meta.url), 'utf8'));
    db.exec("INSERT INTO mvp_features(id, project_id, title) VALUES(7, 101, 'Existing feature'); INSERT INTO roadmap_releases(id, project_id, repository, tag) VALUES(9, 101, 'acme/app', 'v1')");
    db.exec(readFileSync(new URL('../sql/migrations/534_github_commit_links.sql', import.meta.url), 'utf8'));
    assert.deepEqual({ ...db.prepare('SELECT title, merge_commit_sha FROM mvp_features WHERE id = 7').get() }, { title: 'Existing feature', merge_commit_sha: null });
    assert.deepEqual({ ...db.prepare('SELECT tag, commit_sha FROM roadmap_releases WHERE id = 9').get() }, { tag: 'v1', commit_sha: null });
  } finally { db.close(); }
});
