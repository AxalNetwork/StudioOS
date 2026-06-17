// Task #2 — Bipolar value-spectrum bar (−2..+2) with a centre tick + a marker
// dot positioned by the signed value. Used on the Scout Report reveal + hub.
import React from 'react';
import { VALUE_SPECTRUMS, valueLabel } from '../../lib/assessmentMeta';

export default function SpectrumBar({ slug, value }) {
  const meta = VALUE_SPECTRUMS[slug] || {};
  const v = Math.max(-2, Math.min(2, Number(value) || 0));
  const pct = ((v + 2) / 4) * 100; // map −2..+2 → 0..100
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2 text-xs">
        <span className="text-gray-500 dark:text-gray-400">{meta.low || 'Low'}</span>
        <span className="font-medium text-gray-700 dark:text-gray-300">{valueLabel(slug)}</span>
        <span className="text-gray-500 dark:text-gray-400">{meta.high || 'High'}</span>
      </div>
      <div className="relative h-2 rounded-full bg-gray-200 dark:bg-gray-700">
        <div className="absolute bottom-0 left-1/2 top-0 w-px bg-gray-400 dark:bg-gray-500" />
        <div
          className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-violet-600 shadow dark:border-gray-900"
          style={{ left: `${pct}%` }}
        />
      </div>
    </div>
  );
}
