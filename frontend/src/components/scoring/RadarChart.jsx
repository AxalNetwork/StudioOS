// Dimension radar — SVG only, zero math. Every coordinate is precomputed by
// radarGeometry() in lib/scoringViewModel.js.
//
// The dashed overlay sits at 70% of every axis — the evenly-distributed
// profile that reaches the engine's Tier-2 COMPOSITE threshold, never a
// per-dimension minimum (the engine defines none) and never a "cohort median"
// (no cohort aggregate exists).
//
// Labels sit outside the 320×320 plot (the design's own anchor rule), so
// radarGeometry widens the viewBox to contain them. Default SVG clipping stays
// ON — nothing can overhang the card.

export default function RadarChart({ radar }) {
  if (!radar) return null;
  const { viewBox, cx, cy, rings, axes, youPoints, benchPoints, dots, labels } = radar;

  return (
    <svg
      viewBox={viewBox}
      className="w-full h-auto"
      role="img"
      aria-label="Dimension radar — each axis is the percentage of that dimension's weighted maximum"
      data-testid="scoring-radar"
    >
      {rings.map((r) => (
        <circle key={`ring-${r}`} cx={cx} cy={cy} r={r} fill="none" className="stroke-gray-200 dark:stroke-gray-700" strokeWidth="1" />
      ))}
      {axes.map((a) => (
        <line key={`axis-${a.key}`} x1={cx} y1={cy} x2={a.x} y2={a.y} className="stroke-gray-200 dark:stroke-gray-700" strokeWidth="1" />
      ))}
      {benchPoints && (
        <polygon points={benchPoints} fill="none" stroke="#a1a1aa" strokeWidth="1.5" strokeDasharray="4 3" data-testid="radar-threshold" />
      )}
      {youPoints && (
        <polygon points={youPoints} fill="rgba(124,58,237,0.18)" stroke="#7c3aed" strokeWidth="2" strokeLinejoin="round" data-testid="radar-you" />
      )}
      {dots.map((d) => (
        <circle key={`dot-${d.key}`} cx={d.x} cy={d.y} r="3" fill="#7c3aed" />
      ))}
      {labels.map((l) => (
        <text
          key={`label-${l.key}`}
          x={l.x}
          y={l.y}
          textAnchor={l.anchor}
          fontSize="10"
          fontWeight="600"
          className="fill-gray-500 dark:fill-gray-400"
        >
          {l.name}
        </text>
      ))}
    </svg>
  );
}
