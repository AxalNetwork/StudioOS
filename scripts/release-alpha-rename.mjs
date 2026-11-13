#!/usr/bin/env node
/** One-off: give #2655's unsuffixed releases (v1.0.1 to v8.3.26) the stage
 * suffix every tag carries again (`nextReleaseTag`, `-alpha`).
 *
 * A draft has no tag yet, so only its tag and name change. A published release
 * gets a new tag on the same commit as its old one, then is moved onto it; the
 * old tag stays unless --delete-old-tags. Nothing is published, and a release
 * whose suffixed tag already belongs to another release fails before writing.
 * --dry-run plans without writes or waits.
 */
import { RELEASE_STAGE } from '../frontend/src/lib/release.js';
import { gh, readReleases } from './release-draft.mjs';

const UNSUFFIXED = /^v\d+\.\d+\.\d+$/;
const SHA = /^[a-f0-9]{40}$/;

/** What changes: one row per unsuffixed release, oldest first. */
export function renamePlan(releases, stage = RELEASE_STAGE) {
  if (!stage || stage === 'stable') throw new Error('A stable stage adds no suffix.');
  const taken = new Map(releases.map((r) => [r.tag_name, r.id]));
  return releases
    .filter((r) => UNSUFFIXED.test(r.tag_name || ''))
    .map((r) => {
      const tag = `${r.tag_name}-${stage}`;
      if (taken.has(tag)) throw new Error(`${tag} already belongs to release ${taken.get(tag)}.`);
      return { id: r.id, from: r.tag_name, tag, name: r.name === r.tag_name || !r.name ? tag : r.name, draft: !!r.draft, target: r.target_commitish };
    })
    .reverse();
}

/** The commit an existing tag points at, through an annotated tag if it is one. */
async function tagCommit(api, repo, tag) {
  const ref = await api(`/repos/${repo}/git/ref/tags/${encodeURIComponent(tag)}`, { allow404: true });
  if (!ref) return null;
  if (ref.object.type === 'tag') return (await api(`/repos/${repo}/git/tags/${ref.object.sha}`)).object.sha;
  return ref.object.sha;
}

export async function renameReleases({ api = gh, repo, stage = RELEASE_STAGE, dryRun = false, deleteOldTags = false, pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  const plan = renamePlan(await readReleases(api, repo), stage);
  const done = { drafts: 0, published: 0, tagsCreated: 0, tagsDeleted: 0, planned: plan.length };
  for (const row of plan) {
    if (dryRun) continue;
    if (!row.draft) {
      const sha = (await tagCommit(api, repo, row.from)) || (SHA.test(row.target || '') ? row.target : null);
      if (!sha) throw new Error(`${row.from}: no tag and no pinned commit to put ${row.tag} on.`);
      const existing = await tagCommit(api, repo, row.tag);
      if (existing && existing !== sha) throw new Error(`${row.tag} already exists on another commit.`);
      if (!existing) {
        await api(`/repos/${repo}/git/refs`, { method: 'POST', body: { ref: `refs/tags/${row.tag}`, sha } });
        done.tagsCreated++;
      }
    }
    await api(`/repos/${repo}/releases/${row.id}`, { method: 'PATCH', body: { tag_name: row.tag, name: row.name } });
    if (row.draft) done.drafts++; else done.published++;
    if (deleteOldTags && !row.draft) {
      await api(`/repos/${repo}/git/refs/tags/${encodeURIComponent(row.from)}`, { method: 'DELETE', allow404: true });
      done.tagsDeleted++;
    }
    // Stay below GitHub's secondary content-creation limit.
    await pause(1100);
  }
  return done;
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo || !process.env.GITHUB_TOKEN) throw new Error('GITHUB_REPOSITORY and GITHUB_TOKEN are required.');
  for (const row of renamePlan(await readReleases(gh, repo))) console.log(`${row.from} → ${row.tag}${row.draft ? ' (draft)' : ''}`);
  const result = await renameReleases({ repo, dryRun: process.argv.includes('--dry-run'), deleteOldTags: process.argv.includes('--delete-old-tags') });
  console.log(JSON.stringify(result));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(`release-alpha-rename: ${e.message}`); process.exit(1); });
}
