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
 * The stage is a product decision. Moving to beta is this one line, in one
 * reviewed PR: the next draft is then named `-beta`, and so is the badge once
 * that release is published.
 */
export const RELEASE_STAGE = 'alpha';

/** The first tag, when no release has been published yet. */
export const FIRST_RELEASE = `v0.1.0-${RELEASE_STAGE}`;

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

/**
 * The next release's tag. While pre-1.0, each release is a minor bump at the
 * current stage: v0.1.0-alpha → v0.2.0-alpha. The owner can still rename the
 * draft before publishing it (a patch, or 1.0.0).
 */
export function nextReleaseTag(lastTag, stage = RELEASE_STAGE) {
  const last = parseRelease(lastTag);
  if (!last) return `v0.1.0-${stage}`;
  const suffix = stage === 'stable' ? '' : `-${stage}`;
  return `v${last.major}.${last.minor + 1}.0${suffix}`;
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
