import React from 'react';

/**
 * The card surface used by 94 of the 107 design canvases. Four variants cover
 * every appearance in the corpus:
 *
 *   plain   — the default hairline-bordered panel
 *   accent  — violet-tinted, for the one card on a page that matters most
 *   dashed  — an add/attach affordance, or a not-yet-filled slot
 *   sunken  — recessed, for a nested block inside another card
 *
 *   <Card>…</Card>
 *   <Card variant="accent" padding="lg">…</Card>
 *   <Card as="button" onClick={…} interactive>…</Card>
 *
 * `interactive` adds hover/focus affordances and is implied when `as` is a
 * button or anchor — a clickable card that does not react to the pointer
 * reads as broken.
 */
const VARIANTS = {
  plain: 'bg-white dark:bg-gray-900 border border-axal-hairline dark:border-gray-700',
  accent: 'bg-axal-lavender dark:bg-violet-900/20 border border-axal-violet/25 dark:border-violet-700/40',
  dashed: 'bg-transparent border border-dashed border-axal-hairline dark:border-gray-700',
  sunken: 'bg-axal-ground dark:bg-gray-950/40 border border-transparent',
};

const PADDING = { none: '', sm: 'p-3', md: 'p-4', lg: 'p-6' };

export default function Card({
  children,
  as: Tag = 'div',
  variant = 'plain',
  padding = 'md',
  interactive,
  className = '',
  'data-testid': testId,
  ...rest
}) {
  const clickable = interactive ?? (Tag === 'button' || Tag === 'a');
  return (
    <Tag
      data-testid={testId}
      className={[
        'rounded-axal-lg',
        VARIANTS[variant] ?? VARIANTS.plain,
        PADDING[padding] ?? PADDING.md,
        clickable
          ? 'text-left w-full transition-colors hover:border-axal-violet/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-axal-violet/50'
          : '',
        className,
      ].filter(Boolean).join(' ')}
      {...rest}
    >
      {children}
    </Tag>
  );
}
