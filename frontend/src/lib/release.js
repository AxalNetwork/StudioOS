/**
 * The release shown beside the logo, and the rule that names the next one.
 *
 * The source of truth is the newest PUBLISHED GitHub release. The deploy reads
 * its tag and builds it into the SPA as `VITE_AXAL_RELEASE`
 * (`.github/workflows/cloudflare-worker-deploy.yml`). Publishing a release
 * redeploys `main` (`.github/workflows/release-published.yml`), so the badge
 * follows the release with no code change. `scripts/release-draft.mjs` keeps
 * daily drafts from main commit history, named by `nextReleaseTag`.
 *
 * New tags count active release periods without a stage suffix. RELEASE_STAGE
 * remains the fallback badge for builds with no published release; legacy
 * alpha, beta and rc tags continue to parse.
 */
export const RELEASE_STAGE = 'alpha';

/** The first release counts one active month and day, in week zero. */
export const FIRST_RELEASE = 'v1.0.1';

const TAG = /^v(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta|rc)(?:\.(\d+))?)?$/;

/** `v0.2.0-alpha` → its parts; anything else → null. */
export function parseRelease(tag) {
  const m = TAG.exec(String(tag || '').trim());
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    stage: m[4] || 'stable',
    tag: m[0],
  };
}

/** Active months accumulate; active week/day counters belong to the latest month.
 * Month weeks are seven-day blocks (1–7, 8–14, ...), numbered from zero.
 * Only blocks/days with main commits count: weeks 0–4, days 1–31.
 */
export function nextReleaseTag(commitDays) {
  const days = [...new Set(commitDays)].sort();
  if (!days.length) throw new Error('No active commit days.');
  const months = new Set();
  for (const day of days) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('Invalid commit day.');
    const date = new Date(`${day}T00:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day) throw new Error('Invalid commit day.');
    months.add(day.slice(0, 7));
  }
  const month = days.at(-1).slice(0, 7);
  const activeDays = days.filter((day) => day.slice(0, 7) === month);
  const activeWeeks = new Set(activeDays.map((day) => Math.floor((Number(day.slice(8)) - 1) / 7)));
  return `v${months.size}.${activeWeeks.size - 1}.${activeDays.length}`;
}

/**
 * What the badge says. A release tag shows itself; with no tag (local, CI and
 * preview builds, or before the first release is published) it shows the stage
 * alone. It never shows a version that was not released.
 */
export function releaseBadge(tag, stage = RELEASE_STAGE) {
  const parsed = parseRelease(tag);
  if (parsed) return { label: parsed.tag, stage: parsed.stage };
  if (stage === 'stable') return null;
  return { label: stage, stage };
}

const STAGE_TITLE = {
  alpha: 'Alpha: features are still being built and may change.',
  beta: 'Beta: features are complete and being tested.',
  rc: 'Release candidate.',
};

/** The badge's tooltip. */
export function releaseTitle(badge) {
  if (!badge) return '';
  return STAGE_TITLE[badge.stage] || 'Released version.';
}

/** The release this build carries: `VITE_AXAL_RELEASE`, set by the deploy. */
export function builtRelease() {
  try {
    return (import.meta.env && import.meta.env.VITE_AXAL_RELEASE) || '';
  } catch {
    return '';
  }
}
