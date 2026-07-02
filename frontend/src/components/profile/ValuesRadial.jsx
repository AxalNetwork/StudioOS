// Personal Values Profile — radial bar chart. Mirrors the "values wheel"
// reference for the Profile & Fit section. Consumes the /api/values/me vector
// shape ({ dimension_slug, dimension_label, score −2..+2, confidence 0..1,
// pole_low, pole_high, is_bipolar }). Each dimension becomes one concentric
// bar whose length is the strength of the lean (|score| scaled by confidence)
// and whose colour + label encode the direction of the lean.
//
// Theme-agnostic mid-tone strokes (no Tailwind gray utilities) so it reads in
// both light and dark, matching SkillRadar.jsx.
import React from 'react';
import {
  ResponsiveContainer, RadialBarChart, RadialBar, PolarAngleAxis, Legend, Tooltip,
} from 'recharts';

// Lean direction → colour. High pole = brand violet, low pole = amber,
// balanced = slate. Deliberately only three hues so the wheel reads as a
// single system rather than a rainbow.
const LEAN = {
  high: { color: '#7c3aed', label: 'Leans to first pole' },
  low: { color: '#f59e0b', label: 'Leans to second pole' },
  balanced: { color: '#94a3b8', label: 'Balanced' },
};

function leanOf(v) {
  const s = Number(v.score) || 0;
  if (s > 0.2) return 'high';
  if (s < -0.2) return 'low';
  return 'balanced';
}

// The pole the dimension currently leans toward (falls back to the dimension
// name when balanced or when a pole label is missing).
function leanPole(v) {
  const dir = leanOf(v);
  if (dir === 'high') return v.pole_high || v.dimension_label || v.dimension_slug;
  if (dir === 'low') return v.pole_low || v.dimension_label || v.dimension_slug;
  return v.dimension_label || v.dimension_slug;
}

/**
 * @param {Array} vector  /api/values/me vector rows.
 * @param {number} max    max dimensions to plot (strongest first).
 * @param {number} height chart height in px.
 */
export default function ValuesRadial({ vector = [], max = 8, height = 220 }) {
  const rows = (Array.isArray(vector) ? vector : [])
    .filter((v) => Number(v.confidence) > 0)
    // strength = how far from centre (0..2) weighted by confidence, → 0..100.
    .map((v) => {
      const strength = Math.min(1, Math.abs(Number(v.score) || 0) / 2) * (Number(v.confidence) || 0);
      const dir = leanOf(v);
      return {
        slug: v.dimension_slug,
        name: leanPole(v),
        dimension: v.dimension_label || v.dimension_slug,
        value: Math.round(strength * 100),
        fill: LEAN[dir].color,
        dir,
      };
    })
    .sort((a, b) => b.value - a.value)
    .slice(0, max);

  if (rows.length === 0) return null;

  return (
    <div style={{ width: '100%', height }} aria-label="Personal values profile radial chart">
      <ResponsiveContainer>
        <RadialBarChart
          data={rows}
          innerRadius="22%"
          outerRadius="100%"
          startAngle={90}
          endAngle={-270}
          barSize={9}
        >
          <PolarAngleAxis type="number" domain={[0, 100]} tick={false} axisLine={false} />
          <RadialBar
            dataKey="value"
            cornerRadius={5}
            background={{ fill: '#94a3b8', fillOpacity: 0.15 }}
            isAnimationActive
            animationDuration={1100}
          />
          <Legend
            iconSize={9}
            layout="vertical"
            verticalAlign="middle"
            align="right"
            width={110}
            wrapperStyle={{ fontSize: 11 }}
            formatter={(_value, entry) => entry?.payload?.name || ''}
          />
          <Tooltip
            cursor={false}
            contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #94a3b8' }}
            formatter={(value, _name, item) => [`${value}/100`, item?.payload?.dimension]}
          />
        </RadialBarChart>
      </ResponsiveContainer>
    </div>
  );
}
