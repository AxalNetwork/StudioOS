import React from 'react';

/** Icon-only mark — favicons, tight spaces. */
export const AXAL_MARK = '/axal-mark.png';

/** Full lockup: gradient icon + “Axal VC” wordmark. */
export const AXAL_WORDMARK = '/axal-wordmark.png';

const HEIGHT = {
  sm: 'h-7',
  md: 'h-8',
  lg: 'h-9',
  xl: 'h-10',
};

/**
 * Platform logo — always the icon + text lockup unless `markOnly`.
 * On dark/photo backgrounds, set `onDark` for a light badge so the navy text reads.
 */
export default function AxalLogo({
  size = 'md',
  markOnly = false,
  onDark = false,
  className = '',
  ...props
}) {
  const src = markOnly ? AXAL_MARK : AXAL_WORDMARK;
  const alt = 'Axal VC';
  const img = (
    <img
      src={src}
      alt={alt}
      className={`${HEIGHT[size] || size} w-auto object-contain flex-shrink-0 ${className}`}
      {...props}
    />
  );

  if (onDark && !markOnly) {
    return (
      <span className="inline-flex rounded-lg bg-white/95 px-2.5 py-1.5 shadow-sm">
        {img}
      </span>
    );
  }

  return img;
}
