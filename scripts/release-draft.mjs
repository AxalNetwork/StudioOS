#!/usr/bin/env node
/**
 * Keep ONE draft GitHub release ready for the owner to publish
 * (.github/workflows/release-draft.yml, on every push to main).
 *
 * - The last release is the newest published one (drafts excluded).
 * - The draft's tag is the next one, by `nextReleaseTag` (frontend/src/lib/release.js):
 *   cumulative active release months, weeks and days (UTC).
 * - Its notes are GitHub's own generated notes since the last release (merged
 *   PRs and their authors), so nothing is hand-written and CHANGELOG.md is
 *   untouched.
 * - Calendar counter tags are plain versions, without a stage suffix.
 *
 * Publishing is the owner's: it creates the tag on main and starts
 * release-published.yml, which redeploys so the logo's badge shows it.
 *
 * Env: GITHUB_TOKEN (contents: write), GITHUB_REPOSITORY (owner/name).
 * `--dry-run` prints what it would write and changes nothing.
 */
import { nextReleaseTag, parseRelease, releaseDays } from '../frontend/src/lib/release.js';

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
export function draftPayload({ releases = [], notes, now = new Date(), target = 'main' }) {
  const lastTag = pickReleases(releases).last?.tag_name;
  const tag = nextReleaseTag(releases, now);
  const intro = lastTag
    ? `Changes since ${lastTag}. Publishing this draft tags \`${target}\` and updates the version beside the logo.\n\n`
    : 'The first tagged release. Earlier history is in CHANGELOG.md. Publishing this draft tags `main` and updates the version beside the logo.\n\n';
  return {
    tag_name: tag,
    target_commitish: target,
    name: tag,
    body: trimBody(intro + (notes || '')),
    draft: true,
    prerelease: false,
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

/** Read every page: counting only the newest 100 releases would reset versions. */
export async function readReleases(api, repo) {
  const releases = [];
  for (let page = 1; ; page++) {
    const batch = await api(`/repos/${repo}/releases?per_page=100&page=${page}`);
    releases.push(...batch);
    if (batch.length < 100) return releases;
  }
}

export async function updateDraft({ api = gh, repo, now = new Date(), dryRun = false }) {
  const releases = await readReleases(api, repo);
  // Publishing freezes the day's release. Never update a published release or tag.
  if (releaseDays(releases).includes(now.toISOString().slice(0, 10))) {
    return { skipped: true, reason: 'A release is already published today; its version and tag stay fixed.' };
  }
  const { last, draft } = pickReleases(releases);
  const lastTag = last?.tag_name || null;
  const tag = nextReleaseTag(releases, now);
  const generated = await api(`/repos/${repo}/releases/generate-notes`, {
    method: 'POST',
    body: { tag_name: tag, target_commitish: 'main', ...(lastTag ? { previous_tag_name: lastTag } : {}) },
  });
  const payload = draftPayload({ releases, now, notes: generated.body });
  if (!dryRun) {
    if (draft) await api(`/repos/${repo}/releases/${draft.id}`, { method: 'PATCH', body: payload });
    else await api(`/repos/${repo}/releases`, { method: 'POST', body: payload });
  }
  return { skipped: false, payload };
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  const dryRun = process.argv.includes('--dry-run');
  if (!repo || !process.env.GITHUB_TOKEN) throw new Error('GITHUB_REPOSITORY and GITHUB_TOKEN are required.');
  const result = await updateDraft({ repo, dryRun });
  console.log(result.skipped ? result.reason : `draft: ${result.payload.tag_name}; body ${result.payload.body.length} chars`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(`release-draft: ${e.message}`); process.exit(1); });
}
