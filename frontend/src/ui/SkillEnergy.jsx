import React, { useId } from 'react';
import { SIZES, motionCss, skillEnergySpec } from './skillEnergyModel.js';

/**
 * D4120 (#4120): a skill's energy image — a coded, deterministic SVG of
 * radiating rays (the SkillEnergy canvas, style B). The rays point at the
 * skill's area on the 8-axis radar, in the area's hue and stroke rhythm; the
 * level sets their density; the slug makes each skill its own.
 *
 * It is decorative: `aria-hidden`, no text inside. The card around it carries
 * the skill's name, area and level.
 *
 * `theme` is 'light', 'dark' or 'auto' (the default), which draws both and lets
 * the page's `.dark` class pick one, so it follows the app's theme switch.
 * `motion` adds the canvas's 6 s shimmer, which stops under
 * prefers-reduced-motion; the default is still.
 */
function Drawing({ spec }) {
  const { uid, size, col, rx, glow, wash, dash, still, motion, strokes } = spec;
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" focusable="false" style={{ display: 'block', flex: 'none' }}>
      {motion ? <style>{motionCss(spec)}</style> : null}
      <defs>
        <clipPath id={`${uid}c`}><rect width="100" height="100" rx={rx} /></clipPath>
        <radialGradient id={`${uid}g`} cx={glow.cx} cy={glow.cy} r="72" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={col} stopOpacity={glow.opacity} />
          <stop offset="1" stopColor={col} stopOpacity="0" />
        </radialGradient>
      </defs>
      <g clipPath={`url(#${uid}c)`}>
        <rect width="100" height="100" fill={col} fillOpacity={wash} />
        <rect width="100" height="100" fill={`url(#${uid}g)`} />
        <g className={motion ? `${uid}m` : undefined}
          style={still ? { transform: `translate(${still.x}px,${still.y}px)`, opacity: still.opacity } : undefined}
          fill="none" stroke={col} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={dash || undefined}>
          {strokes.map((p, i) => <path key={i} d={p.d} strokeOpacity={p.op} strokeWidth={p.w} />)}
        </g>
      </g>
    </svg>
  );
}

export default function SkillEnergy({ slug, area, level = 3, size = 96, theme = 'auto', motion = false, className = '' }) {
  const px = SIZES.includes(size) ? size : 96;
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const draw = (t) => skillEnergySpec({ slug, area, level, size: px, theme: t, motion, idSuffix: id });
  if (theme === 'light' || theme === 'dark') {
    return <span className={`inline-block shrink-0 ${className}`} data-testid="skill-energy"><Drawing spec={draw(theme)} /></span>;
  }
  return (
    <span className={`inline-block shrink-0 ${className}`} data-testid="skill-energy">
      <span className="block dark:hidden"><Drawing spec={draw('light')} /></span>
      <span className="hidden dark:block"><Drawing spec={draw('dark')} /></span>
    </span>
  );
}
