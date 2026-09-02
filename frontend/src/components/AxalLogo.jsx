import React from 'react';

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
          colour, which also matches the note set beside it in AuthShell. */}
      <span
        style={{ fontFamily: 'var(--font-display)' }}
        className={`${scale.text} font-bold tracking-tight ${
          onDark ? 'text-white' : 'text-gray-900 dark:text-gray-100'
        }`}
      >
        Axal VC
      </span>
    </span>
  );
}
