// Task #2 — On-screen skills radar (recharts) used by the Profile & Fit section,
// Network/Events archetype surfaces.
// Theme-agnostic mid-tone strokes (no Tailwind gray utilities) so it reads in
// both light + dark without dark-mode pairings.
import React from 'react';
import {
  ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
} from 'recharts';
import { skillRadarData } from '../../lib/assessmentMeta';
import { areaVars } from '../../lib/skillAreas.js';

/**
 * D4120 (#4120): each axis label in its area's colour, from the shared tokens
 * the area chips and SkillEnergy use. Light tokens are at least 4.5:1 on
 * white and dark tokens on #111827, so the label stays readable.
 */
export function AreaTick({ x, y, textAnchor, payload, data }) {
  const row = data?.[payload?.index];
  return (
    <text x={x} y={y} textAnchor={textAnchor} dominantBaseline="central" fontSize={11} style={areaVars(row?.slug)}
      className="fill-[var(--area-l)] dark:fill-[var(--area-d)]" data-testid="radar-axis">{payload?.value}</text>
  );
}

export default function SkillRadar({ skillVector, height = 300, accent = '#7c3aed', animate = true }) {
  const data = skillRadarData(skillVector, { short: true });
  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <RadarChart data={data} outerRadius="70%">
          <PolarGrid stroke="#94a3b8" strokeOpacity={0.45} />
          <PolarAngleAxis dataKey="axis" tick={(p) => <AreaTick {...p} data={data} />} />
          <PolarRadiusAxis domain={[0, 5]} tick={false} axisLine={false} />
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
