#!/usr/bin/env node
/**
 * Keep ONE draft GitHub release ready for the owner to publish
 * (.github/workflows/release-draft.yml, on every push to main).
 *
 * - The last release is the newest published one (drafts excluded).
 * - The draft's tag is the next one, by `nextReleaseTag` (frontend/src/lib/release.js):
 *   v0.1.0-alpha first, then a minor bump per release at the current stage.
 * - Its notes are GitHub's own generated notes since the last release (merged
 *   PRs and their authors), so nothing is hand-written and CHANGELOG.md is
 *   untouched.
 * - Alpha, beta and rc drafts are marked pre-release.
 *
 * Publishing is the owner's: it creates the tag on main and starts
 * release-published.yml, which redeploys so the logo's badge shows it.
 *
 * Env: GITHUB_TOKEN (contents: write), GITHUB_REPOSITORY (owner/name).
 * `--dry-run` prints what it would write and changes nothing.
 */
import { FIRST_RELEASE, nextReleaseTag, parseRelease, RELEASE_STAGE } from '../frontend/src/lib/release.js';

const API = 'https://api.github.com';
// GitHub refuses a release body over 125,000 characters. The first release
// would otherwise list every PR since the repository began.
export const BODY_LIMIT = 120_000;

export function trimBody(body, limit = BODY_LIMIT) {
  if (body.length <= limit) return body;
  const cut = body.slice(0, limit);
  return `${cut.slice(0, cut.lastIndexOf('\n'))}\n\n…and more, cut to fit GitHub's size limit for a release.\n`;
}

/** The newest published release, and the existing draft (if any), from a releases page. */
export function pickReleases(releases) {
  const published = releases.filter((r) => !r.draft && parseRelease(r.tag_name));
  published.sort((a, b) => new Date(b.published_at) - new Date(a.published_at));
  const draft = releases.find((r) => r.draft) || null;
  return { last: published[0] || null, draft };
}

/** The draft to write, from the last release's tag and the generated notes. */
export function draftPayload({ lastTag, notes, stage = RELEASE_STAGE, target = 'main' }) {
  const tag = lastTag ? nextReleaseTag(lastTag, stage) : FIRST_RELEASE;
  const intro = lastTag
    ? `Changes since ${lastTag}. Publishing this draft tags \`${target}\` and updates the version beside the logo.\n\n`
    : 'The first tagged release. Earlier history is in CHANGELOG.md. Publishing this draft tags `main` and updates the version beside the logo.\n\n';
  return {
    tag_name: tag,
    target_commitish: target,
    name: tag,
    body: trimBody(intro + (notes || '')),
    draft: true,
    prerelease: stage !== 'stable',
  };
}

async function gh(path, { method = 'GET', body } = {}) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${method} ${path}: HTTP ${r.status} ${(await r.text()).slice(0, 300)}`);
  return r.status === 204 ? null : r.json();
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  const dryRun = process.argv.includes('--dry-run');
  if (!repo || !process.env.GITHUB_TOKEN) throw new Error('GITHUB_REPOSITORY and GITHUB_TOKEN are required.');

  const { last, draft } = pickReleases(await gh(`/repos/${repo}/releases?per_page=100`));
  const lastTag = last?.tag_name || null;
  const tag = lastTag ? nextReleaseTag(lastTag) : FIRST_RELEASE;
  const generated = await gh(`/repos/${repo}/releases/generate-notes`, {
    method: 'POST',
    body: { tag_name: tag, target_commitish: 'main', ...(lastTag ? { previous_tag_name: lastTag } : {}) },
  });
  const payload = draftPayload({ lastTag, notes: generated.body });

  console.log(`last published: ${lastTag || 'none'}; draft: ${payload.tag_name} (${draft ? 'update' : 'create'}); body ${payload.body.length} chars`);
  if (dryRun) return;
  if (draft) await gh(`/repos/${repo}/releases/${draft.id}`, { method: 'PATCH', body: payload });
  else await gh(`/repos/${repo}/releases`, { method: 'POST', body: payload });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(`release-draft: ${e.message}`); process.exit(1); });
}
