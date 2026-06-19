import React from 'react';
import { RISK_BAND_HEX, bandFromScore, shortLayerLabel } from '../lib/riskBands';

// Task #10 — 10-axis Venture Risk radar.
//
// Each axis plots one layer's de-risk confidence (0..100). A fuller polygon =
// a more de-risked company. The polygon is tinted by the OVERALL band; each
// vertex dot is tinted by that layer's own band so weak axes read at a glance.
//
// `layers` is the assessment's merged layer array ({ key, label, score }).
export default function RiskRadar({ layers = [], size = 300, band = 'medium', muted = false }) {
  const n = layers.length;
  if (!n) return null;

  const cx = size / 2;
  const cy = size / 2;
  // Leave room around the ring for axis labels.
  const radius = size / 2 - 56;
  const rings = [0.25, 0.5, 0.75, 1];

  const angleFor = (i) => (Math.PI * 2 * i) / n - Math.PI / 2;
  const point = (i, frac) => {
    const a = angleFor(i);
    return [cx + Math.cos(a) * radius * frac, cy + Math.sin(a) * radius * frac];
  };

  const dataPoints = layers.map((l, i) =>
    point(i, Math.max(0, Math.min(100, Number(l.score) || 0)) / 100),
  );
  const dataPath =
    dataPoints
      .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
      .join(' ') + ' Z';

  // No-data state: tint the (collapsed) polygon and vertices slate so an
  // unscored company never reads as a red "high risk" cluster at the center.
  const MUTED_HEX = '#cbd5e1';
  const accent = muted ? MUTED_HEX : (RISK_BAND_HEX[band] || RISK_BAND_HEX.medium);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label="Venture risk radar — de-risk confidence across ten layers"
      style={{ overflow: 'visible', maxWidth: '100%', height: 'auto' }}
    >
      {/* Grid rings */}
      {rings.map((frac, ri) => (
        <polygon
          key={`ring-${ri}`}
          points={layers.map((_, i) => point(i, frac).map((v) => v.toFixed(1)).join(',')).join(' ')}
          fill="none"
          className="stroke-slate-200 dark:stroke-slate-700"
          strokeWidth="1"
        />
      ))}

      {/* Spokes */}
      {layers.map((_, i) => {
        const [x, y] = point(i, 1);
        return (
          <line
            key={`spoke-${i}`}
            x1={cx}
            y1={cy}
            x2={x}
            y2={y}
            className="stroke-slate-200 dark:stroke-slate-700"
            strokeWidth="1"
          />
        );
      })}

      {/* Data polygon */}
      <path
        d={dataPath}
        fill={accent}
        fillOpacity="0.16"
        stroke={accent}
        strokeWidth="2"
        strokeLinejoin="round"
      />

      {/* Vertices, tinted by each layer's effective band. Prefer the
          backend-provided band (honours analyst band-only overrides) and fall
          back to deriving it from the score. */}
      {dataPoints.map(([x, y], i) => (
        <circle
          key={`pt-${i}`}
          cx={x}
          cy={y}
          r="3.5"
          fill={muted ? MUTED_HEX : (RISK_BAND_HEX[layers[i].band] || RISK_BAND_HEX[bandFromScore(layers[i].score)])}
          stroke="#fff"
          strokeWidth="1"
        />
      ))}

      {/* Axis labels */}
      {layers.map((l, i) => {
        const [x, y] = point(i, 1.16);
        const a = angleFor(i);
        const cos = Math.cos(a);
        const anchor = Math.abs(cos) < 0.3 ? 'middle' : cos > 0 ? 'start' : 'end';
        return (
          <text
            key={`lbl-${i}`}
            x={x}
            y={y}
            textAnchor={anchor}
            dominantBaseline="middle"
            fontSize="9.5"
            className="fill-slate-600 dark:fill-slate-300"
          >
            {shortLayerLabel(l.label) || l.key}
          </text>
        );
      })}
    </svg>
  );
}
