// Task #2 — On-screen skills radar (recharts) used by the Profile & Fit section,
// Network/Events archetype surfaces, and the admin Assessment Studio preview.
// Theme-agnostic mid-tone strokes (no Tailwind gray utilities) so it reads in
// both light + dark without dark-mode pairings.
import React from 'react';
import {
  ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
} from 'recharts';
import { skillRadarData } from '../../lib/assessmentMeta';

export default function SkillRadar({ skillVector, height = 300, accent = '#7c3aed', animate = true }) {
  const data = skillRadarData(skillVector, { short: true });
  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <RadarChart data={data} outerRadius="70%">
          <PolarGrid stroke="#94a3b8" strokeOpacity={0.45} />
          <PolarAngleAxis dataKey="axis" tick={{ fontSize: 11, fill: '#94a3b8' }} />
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
