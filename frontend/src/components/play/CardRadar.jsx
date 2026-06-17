// Task #2 — Inline-SVG skills radar used INSIDE the exportable trading card.
// Hex colors + raw SVG only (no Tailwind utilities) so html2canvas — which can't
// parse Tailwind 4's oklch colors — rasterizes it reliably. 8 axes, domain 0..5.
import React from 'react';
import { SKILL_AXIS_ORDER, SKILL_AXES_SHORT } from '../../lib/assessmentMeta';

export default function CardRadar({
  skillVector = {},
  size = 240,
  accent = '#a78bfa',
  gridColor = '#3f3f5e',
  labelColor = '#cbd5e1',
}) {
  const cx = size / 2;
  const cy = size / 2;
  const R = size * 0.32;
  const axes = SKILL_AXIS_ORDER;
  const n = axes.length;
  const angle = (i) => (i / n) * Math.PI * 2 - Math.PI / 2;
  const pt = (i, r) => ({ x: cx + Math.cos(angle(i)) * R * r, y: cy + Math.sin(angle(i)) * R * r });

  const rings = [0.25, 0.5, 0.75, 1].map((r) =>
    axes.map((_, i) => { const p = pt(i, r); return `${p.x.toFixed(1)},${p.y.toFixed(1)}`; }).join(' '),
  );

  const poly = axes
    .map((slug, i) => {
      const v = Math.max(0, Math.min(5, Number(skillVector?.[slug]) || 0)) / 5;
      const p = pt(i, v);
      return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Skills radar">
      {rings.map((r, i) => (
        <polygon key={i} points={r} fill="none" stroke={gridColor} strokeWidth="1" />
      ))}
      {axes.map((_, i) => {
        const p = pt(i, 1);
        return <line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke={gridColor} strokeWidth="1" />;
      })}
      <polygon points={poly} fill={accent} fillOpacity="0.4" stroke={accent} strokeWidth="2" />
      {axes.map((slug, i) => {
        const p = pt(i, 1.2);
        const dx = p.x - cx;
        const anchor = Math.abs(dx) < 6 ? 'middle' : dx > 0 ? 'start' : 'end';
        return (
          <text
            key={slug}
            x={p.x}
            y={p.y}
            fill={labelColor}
            fontSize="9"
            fontFamily="system-ui, sans-serif"
            textAnchor={anchor}
            dominantBaseline="middle"
          >
            {SKILL_AXES_SHORT[slug]}
          </text>
        );
      })}
    </svg>
  );
}
