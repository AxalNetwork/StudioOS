import React from 'react';
import { builtRelease, releaseBadge, releaseTitle } from '../lib/release';

/** Icon-only mark — favicons, tight spaces, and the icon half of the lockup. */
export const AXAL_MARK = '/axal-mark.png';

/**
 * The flat wordmark PNG. Kept for GENERATED ARTEFACTS only — `templates/brandKit.js`
 * feeds it into brand kits and PDFs, where a single flat image is the right
 * thing because there is no DOM to set type in. It is deliberately not used by
 * any screen: see the header below.
 */
export const AXAL_WORDMARK = '/axal-wordmark.png';

/**
 * Platform logo — the icon, plus "Axal VC" as REAL TEXT.
 *
 * WHY THE TEXT IS NOT AN IMAGE. It was one, briefly: the "unified platform
 * logo" change swapped this lockup for `/axal-wordmark.png`, a PNG with the
 * words baked in. That is 13 KB to draw two words, and the words are then
 * unselectable, unsearchable, invisible to a screen reader except through
 * `alt`, blurred when the page is zoomed, and frozen in one colour whatever the
 * theme or background does. Type belongs in the DOM.
 *
 * WHY IT LIVES HERE AND NOT AT THE CALL SITES. The login corner, the dashboard
 * header, the public nav and the public footer all render this component. When
 * each drew its own lockup they drifted — the nav used Space Grotesk at
 * `text-lg`, the app header a system font at `text-sm` — so "the logo" meant
 * two different things depending on which page you were looking at. One
 * component, one `size` scale, and the difference between the compact header
 * and the larger nav is a prop rather than a fork.
 *
 * The family comes from `--font-display` (`index.css`), which already resolves
 * to Space Grotesk with Inter and the system stack behind it. Naming the token
 * rather than the font means a brand change lands in one place.
 */
/**
 * The release beside the logo: `v0.2.0-alpha`, or the stage alone ("alpha")
 * when the build carries no release (local, CI, previews). See lib/release.js.
 * Amber is alpha, sky is beta; a stable release shows the version in grey.
 */
const BADGE_TONE = {
  alpha: 'bg-amber-100 text-amber-800 ring-amber-200',
  beta: 'bg-sky-100 text-sky-800 ring-sky-200',
  rc: 'bg-violet-100 text-violet-800 ring-violet-200',
  stable: 'bg-gray-100 text-gray-700 ring-gray-200',
};

export function ReleaseBadge({ tag = builtRelease(), className = '' }) {
  const badge = releaseBadge(tag);
  if (!badge) return null;
  return (
    <span
      data-testid="release-badge"
      title={releaseTitle(badge)}
      className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none tracking-wide ring-1 ring-inset ${BADGE_TONE[badge.stage] || BADGE_TONE.stable} ${className}`}
    >
      {badge.label}
    </span>
  );
}

const SIZE = {
  sm: { icon: 'h-7 w-7', text: 'text-sm' },
  md: { icon: 'h-8 w-8', text: 'text-base' },
  lg: { icon: 'h-9 w-9', text: 'text-lg' },
  xl: { icon: 'h-10 w-10', text: 'text-xl' },
};

export default function AxalLogo({
  size = 'md',
  markOnly = false,
  onDark = false,
  onLight = false,
  showRelease = false,
  className = '',
  ...props
}) {
  const scale = SIZE[size] || SIZE.md;

  const icon = (
    <img
      src={AXAL_MARK}
      // Decorative: the wordmark beside it carries the name, so announcing it
      // here would read "Axal VC Axal VC".
      alt=""
      aria-hidden="true"
      className={`${scale.icon} rounded-md object-contain flex-shrink-0`}
    />
  );

  if (markOnly) {
    return <img src={AXAL_MARK} alt="Axal VC" className={`${scale.icon} rounded-md object-contain flex-shrink-0 ${className}`} {...props} />;
  }

  return (
    <span className={`inline-flex items-center gap-2 ${className}`} {...props}>
      {icon}
      {/* `onDark` used to wrap the PNG in a white badge so its navy pixels stayed
          legible on the login photo. Real text needs no badge — it just changes
          colour, which also matches the note set beside it in AuthShell.
          `onLight` is the inverse: the app header still paints a white island
          in dark mode so the colourful mark stays on a light chip. Default
          `dark:text-gray-100` would then vanish on that chip. */}
      <span
        style={{ fontFamily: 'var(--font-display)' }}
        className={`${scale.text} font-bold tracking-tight ${
          onDark ? 'text-white' : onLight ? 'text-gray-900 dark:text-gray-900' : 'text-gray-900 dark:text-gray-100'
        }`}
      >
        Axal VC
      </span>
      {showRelease && <ReleaseBadge />}
    </span>
  );
}
