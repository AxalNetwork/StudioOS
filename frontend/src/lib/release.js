/**
 * The release shown beside the logo, and the rule that names the next one.
 *
 * The source of truth is the newest PUBLISHED GitHub release. The deploy reads
 * its tag and builds it into the SPA as `VITE_AXAL_RELEASE`
 * (`.github/workflows/cloudflare-worker-deploy.yml`). Publishing a release
 * redeploys `main` (`.github/workflows/release-published.yml`), so the badge
 * follows the release with no code change. `scripts/release-draft.mjs` keeps
 * one draft release ready for the owner to publish, named by `nextReleaseTag`.
 *
 * New tags count active release periods without a stage suffix. RELEASE_STAGE
 * remains the fallback badge for builds with no published release; legacy
 * alpha, beta and rc tags continue to parse.
 */
export const RELEASE_STAGE = 'alpha';

/** The first release counts one active month, week and day. */
export const FIRST_RELEASE = 'v1.1.1';

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

/** Published release dates only; invalid history must not reset the counters. */
export function releaseDays(releases) {
  return [...new Set(releases.filter((r) => !r.draft && parseRelease(r.tag_name)).map((r) => {
    const date = new Date(r.published_at || NaN);
    if (!Number.isFinite(date.getTime())) throw new Error('Published release has no valid publication date.');
    return date.toISOString().slice(0, 10);
  }))];
}

/** Count active UTC months, Monday-start weeks and days, including today's draft. */
export function nextReleaseTag(releases = [], now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const days = new Set([...releaseDays(releases), today]);
  const months = new Set();
  const weeks = new Set();
  for (const day of days) {
    if (day > today) throw new Error('Publication date is in the future.');
    months.add(day.slice(0, 7));
    const monday = new Date(`${day}T00:00:00Z`);
    monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
    weeks.add(monday.toISOString().slice(0, 10));
  }
  return `v${months.size}.${weeks.size}.${days.size}`;
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
