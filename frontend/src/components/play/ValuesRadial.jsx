// Task #40 — Values radial (recharts) for the Profile & Fit section. Plots the
// 15-dimension values vector as a wheel so the card shows shape at a glance
// instead of a flat "high / low" list. Scores are stored -2..+2; we map to a
// 0..4 domain (2 = balanced centre) so every spoke is positive and the lean
// reads as distance from centre. Theme-agnostic mid-tone strokes (no Tailwind
// gray utilities) so it reads in both light + dark.
import React from 'react';
import {
  ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
} from 'recharts';

function shortLabel(v) {
  const raw = v.dimension_label || v.dimension_slug || '';
  return raw.length > 16 ? `${raw.slice(0, 15)}…` : raw;
}

export default function ValuesRadial({ vector, height = 210, accent = '#7c3aed', animate = true }) {
  const data = (Array.isArray(vector) ? vector : [])
    .filter((v) => Number(v.confidence) > 0)
    .map((v) => ({
      dim: shortLabel(v),
      value: Math.max(0, Math.min(4, (Number(v.score) || 0) + 2)),
    }));
  // A radar needs at least 3 spokes to read as a shape; callers fall back to a
  // list below that threshold.
  if (data.length < 3) return null;
  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <RadarChart data={data} outerRadius="70%">
          <PolarGrid stroke="#94a3b8" strokeOpacity={0.45} />
          <PolarAngleAxis dataKey="dim" tick={{ fontSize: 10, fill: '#94a3b8' }} />
          <PolarRadiusAxis domain={[0, 4]} tick={false} axisLine={false} />
          <Radar
            dataKey="value"
            stroke={accent}
            fill={accent}
            fillOpacity={0.35}
            isAnimationActive={animate}
            animationDuration={1300}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}
