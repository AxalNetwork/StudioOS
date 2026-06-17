// Task #3 — Reference palette of valid scoring dimension keys. Authors click a
// key to copy it, then paste into a loads / centroid / measures JSON blob. Keeps
// hand-typed keys aligned with the scorer's known value spectrums + skill axes.
import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { DIMENSION_KEYS, dimensionLabel } from './jsonFields';

function KeyRow({ kind, keys }) {
  const [copied, setCopied] = useState('');
  const copy = async (k) => {
    try {
      await navigator.clipboard?.writeText(k);
      setCopied(k);
      setTimeout(() => setCopied(''), 1200);
    } catch {
      /* clipboard unavailable — author can still read + type the key */
    }
  };
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1">
        {kind === 'values' ? 'Value spectrums (−2…+2)' : 'Skill axes (0…5)'}
      </div>
      <div className="flex flex-wrap gap-1">
        {keys.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => copy(k)}
            title={`${dimensionLabel(kind, k)} — click to copy "${k}"`}
            className="inline-flex items-center gap-1 text-[11px] font-mono px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            {copied === k ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3 opacity-50" />}
            {k}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function DimensionPalette() {
  return (
    <div className="mt-2 space-y-2 rounded border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 p-2">
      <KeyRow kind="values" keys={DIMENSION_KEYS.values} />
      <KeyRow kind="skills" keys={DIMENSION_KEYS.skills} />
    </div>
  );
}
