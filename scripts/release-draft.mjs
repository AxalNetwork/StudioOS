#!/usr/bin/env node
/** Daily release drafts from the full first-parent history of main.
 * Published releases/tags are immutable. Only matching daily drafts refresh.
 * Publishing remains manual. --dry-run performs no release writes.
 */
import { execFileSync } from 'node:child_process';
import { nextReleaseTag } from '../frontend/src/lib/release.js';

const API = 'https://api.github.com';
// GitHub refuses a release body over 125,000 characters. The first release
// would otherwise list every PR since the repository began.
export const BODY_LIMIT = 120_000;

export function trimBody(body, limit = BODY_LIMIT) {
  if (body.length <= limit) return body;
  const cut = body.slice(0, limit);
  return `${cut.slice(0, cut.lastIndexOf('\n'))}\n\n…and more, cut to fit GitHub's size limit for a release.\n`;
}

/** First-parent commits represent when changes landed on main, in UTC. */
export function dailyReleasePlan(commits) {
  const grouped = new Map();
  for (const commit of commits) {
    if (!/^[a-f0-9]{40}$/.test(commit.sha)) throw new Error('Invalid commit SHA.');
    const date = new Date(commit.date);
    if (!Number.isFinite(date.getTime())) throw new Error('Invalid commit date.');
    const day = date.toISOString().slice(0, 10);
    const previous = grouped.get(day);
    grouped.set(day, { date: day, target: commit.sha, count: (previous?.count || 0) + 1 });
  }
  const days = [...grouped.keys()].sort();
  return days.map((day, i) => ({ ...grouped.get(day), tag: nextReleaseTag(days.slice(0, i + 1)), previous: i ? grouped.get(days[i - 1]).target : null }));
}

export function readMainCommits(run = execFileSync) {
  return run('git', ['log', 'origin/main', '--first-parent', '--reverse', '--format=%H%x09%cI'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    .trim().split('\n').filter(Boolean).map((line) => { const [sha, date] = line.split('\t'); return { sha, date }; });
}

export function draftPayload(row, repo) {
  const link = row.previous ? `https://github.com/${repo}/compare/${row.previous}...${row.target}` : `https://github.com/${repo}/commits/${row.target}`;
  return {
    tag_name: row.tag,
    target_commitish: row.target,
    name: row.tag,
    body: trimBody(`Daily release for **${row.date} (UTC)**.\n\n${row.count} commits on main.\n\n[Changes for this release](${link})\n\nVersion counts active months since the start; the zero-based active week counter and active commit-day count reset each month (weeks 0–4, days 1–31).\n\n<!-- studioos-daily-release:${row.date} -->\n`),
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

/** Read every page so older daily releases are matched rather than recreated. */
export async function readReleases(api, repo) {
  const releases = [];
  for (let page = 1; ; page++) {
    const batch = await api(`/repos/${repo}/releases?per_page=100&page=${page}`);
    releases.push(...batch);
    if (batch.length < 100) return releases;
  }
}

export async function updateDraft({ api = gh, repo, commits = readMainCommits(), dryRun = false, pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  const releases = (await readReleases(api, repo)).map((release) => ({ ...release }));
  const plan = dailyReleasePlan(commits);
  let written = 0, frozen = 0, previous = null;
  for (const row of plan) {
    const marker = `<!-- studioos-daily-release:${row.date} -->`;
    const sameTag = releases.find((r) => r.tag_name === row.tag);
    const sameDay = releases.find((r) => (r.body || '').includes(marker));
    if (sameTag && !(sameTag.body || '').includes(marker)) throw new Error(`Version already belongs to another release: ${row.tag}`);
    const published = [sameTag, sameDay].find((r) => r && !r.draft);
    if (published) {
      if (!/^[a-f0-9]{40}$/.test(published.target_commitish || '')) throw new Error('Published daily release must pin its commit.');
      previous = published.target_commitish;
      frozen++;
      continue;
    }
    const draft = sameTag || sameDay;
    const payload = draftPayload({ ...row, previous }, repo);
    previous = row.target;
    if (draft && Object.entries(payload).every(([key, value]) => draft[key] === value)) continue;
    let saved;
    if (!dryRun) {
      saved = await api(`/repos/${repo}/releases${draft ? `/${draft.id}` : ''}`, { method: draft ? 'PATCH' : 'POST', body: payload });
      // Stay below GitHub's secondary content-creation limit during backfills.
      await pause(1100);
    }
    // Simulate renames in dry runs too, without mutating the API snapshot.
    if (draft) Object.assign(draft, payload);
    else releases.push({ ...payload, id: saved?.id });
    written++;
  }
  return { days: plan.length, written, frozen, latest: plan.at(-1)?.tag || null };
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  const dryRun = process.argv.includes('--dry-run');
  if (!repo || !process.env.GITHUB_TOKEN) throw new Error('GITHUB_REPOSITORY and GITHUB_TOKEN are required.');
  const result = await updateDraft({ repo, dryRun });
  console.log(JSON.stringify(result));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(`release-draft: ${e.message}`); process.exit(1); });
}
