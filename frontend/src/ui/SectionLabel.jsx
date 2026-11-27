import React from 'react';

/**
 * The uppercase eyebrow that sits above almost every zone in the Axal design
 * canvases — 106 of the 107 carry it, which makes it the single most common
 * element in the system and the reason this is the first primitive.
 *
 *   <SectionLabel>Portfolio</SectionLabel>
 *   <SectionLabel as="h2" tone="violet" tracking="wide">Capital calls</SectionLabel>
 *
 * Tracking: the canvases split between .07em and .09em (57 canvases each, but
 * .07em leads 175-70 on raw occurrences), with the System Sheet spec asking
 * for .11em in a distant third. `.07em` ships as the default via
 * `tracking-axal-label`; pass tracking="wide" for the spec's value where a
 * design calls for it explicitly. See documentation/architecture/DECISIONS.md D2.
 *
 * Renders a <div> by default because most eyebrows are decorative labels, not
 * document structure. Pass `as` when the label genuinely heads a section — a
 * screen-reader user should not meet a heading that leads nowhere.
 */
const TONES = {
  default: 'text-axal-muted dark:text-gray-400',
  faint: 'text-axal-faint dark:text-gray-500',
  ink: 'text-axal-ink dark:text-gray-100',
  violet: 'text-axal-violet dark:text-violet-300',
};

export default function SectionLabel({
  children,
  as: Tag = 'div',
  tone = 'default',
  tracking = 'normal',
  className = '',
  'data-testid': testId,
}) {
  const track = tracking === 'wide' ? 'tracking-axal-label-wide' : 'tracking-axal-label';
  return (
    <Tag
      data-testid={testId}
      className={`text-[10px] font-extrabold uppercase ${track} ${TONES[tone] ?? TONES.default} ${className}`}
    >
      {children}
    </Tag>
  );
}
