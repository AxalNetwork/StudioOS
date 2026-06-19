// Venture Risk radar — plots per-layer DE-RISK (100 − risk) across the 10
// layers so a larger filled area reads as "more derisked / safer". Mirrors the
// recharts setup in components/play/SkillRadar.jsx. Theme-agnostic mid-tone
// grid so it reads in light + dark.
import React from 'react';
import {
  ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, Tooltip,
} from 'recharts';

// Short axis labels so 10 spokes don't collide on small panels.
const SHORT = {
  founder: 'Founder', market: 'Market', competition: 'Compete', timing: 'Timing',
  financing: 'Finance', marketing: 'Marketing', distribution: 'Distrib',
  technology: 'Tech', product: 'Product', hiring: 'Hiring',
};

export default function RiskRadar({ layers = [], height = 280, accent = '#7c3aed' }) {
  const data = layers.map((l) => ({
    axis: SHORT[l.key] || l.label,
    derisk: Math.max(0, Math.min(100, 100 - (l.risk ?? 0))),
    band: l.band,
  }));

  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <RadarChart data={data} outerRadius="72%">
          <PolarGrid stroke="#94a3b8" strokeOpacity={0.4} />
          <PolarAngleAxis dataKey="axis" tick={{ fontSize: 10, fill: '#94a3b8' }} />
          <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
          <Tooltip
            formatter={(v) => [`${v}/100 derisked`, '']}
            contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
          />
          <Radar
            dataKey="derisk"
            stroke={accent}
            fill={accent}
            fillOpacity={0.32}
            isAnimationActive
            animationDuration={900}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}
