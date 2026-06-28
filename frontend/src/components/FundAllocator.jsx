import React from 'react';

// Task #2 / Task #8 — THE ASK Use-of-Funds allocator (shared).
//
// Fixed, canonical sections in a fixed order; founders only set the
// percentages. Persisted as structured data ({ label, pct }, non-zero only)
// by BOTH the intake form (FounderPortal) and the post-intake deck-side editor
// (UseOfFundsEditor). Labels contain colons, so the allocation is stored as
// JSON, never delimited text. Do NOT rename/add/remove sections — the labels
// are the storage key the deck assembler maps back onto these slots.
export const FUND_SECTIONS = [
  'Product & engineering',
  'GTM: sales and marketing',
  'Infrastructure & data',
  'Operations, legal & compliance',
  'Hiring / runway reserve',
];

/**
 * Map a stored `use_of_funds` value into the fixed 5-slot percentage array.
 * Structured JSON ([{ label, pct }]) is matched onto the canonical sections by
 * exact label; legacy free-text or unknown labels degrade to all-zeros so the
 * editor opens empty and the founder can enter a fresh allocation.
 */
export function allocToValues(raw) {
  const values = [0, 0, 0, 0, 0];
  const s = (raw ?? '').toString().trim();
  if (!s.startsWith('[')) return values;
  try {
    const arr = JSON.parse(s);
    if (!Array.isArray(arr)) return values;
    for (const x of arr) {
      const label = String(x?.label ?? '').trim();
      const i = FUND_SECTIONS.indexOf(label);
      if (i >= 0) {
        values[i] = Math.max(0, Math.min(100, Math.round(Number(x?.pct) || 0)));
      }
    }
  } catch { /* legacy / malformed → all-zeros */ }
  return values;
}

/**
 * Serialize the 5-slot percentage array into the canonical `use_of_funds`
 * storage string. Drops 0% sections; returns '' when nothing is allocated so
 * the server normalizer clears the field.
 */
export function valuesToUseOfFunds(values) {
  const alloc = FUND_SECTIONS
    .map((label, i) => ({ label, pct: Number(values[i]) || 0 }))
    .filter((x) => x.pct > 0);
  return alloc.length ? JSON.stringify(alloc) : '';
}

/** Sum of the allocation (drives the total / valid indicator). */
export function fundsTotal(values) {
  return values.reduce((a, b) => a + (Number(b) || 0), 0);
}

/** Saving is allowed only when the total is exactly 100% or all-zero (clear). */
export function fundsValid(values) {
  const t = fundsTotal(values);
  return t === 0 || t === 100;
}

/**
 * Structured Use-of-Funds allocator. Five fixed sections, each a slider + a
 * numeric input (0–100). Saving is allowed only when the total is exactly 100%
 * or all sections are 0 (no allocation). Stateless — the parent owns `values`.
 */
export function FundAllocator({ values, total, valid, onChange }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="block text-sm text-gray-600 font-medium">Use of Funds (%)</label>
        <span className={`text-sm font-semibold ${valid ? 'text-gray-700 dark:text-gray-300' : 'text-red-500'}`}>Total: {total}%</span>
      </div>
      <div className="space-y-3">
        {FUND_SECTIONS.map((label, i) => (
          <div key={label} className="flex items-center gap-3">
            <span className="flex-1 min-w-0 text-sm text-gray-700 dark:text-gray-300">{label}</span>
            <input type="range" min={0} max={100} step={1} value={values[i]} onChange={e => onChange(i, e.target.value)} className="w-28 sm:w-40 accent-violet-500" />
            <input type="number" min={0} max={100} value={values[i]} onChange={e => onChange(i, e.target.value)} className="w-16 bg-gray-50 border border-gray-700 rounded-lg px-2 py-1 text-gray-900 text-sm dark:text-gray-100" aria-label={`${label} percentage`} />
          </div>
        ))}
      </div>
      {!valid && (
        <p className="text-xs text-red-500 mt-2">Allocation must total exactly 100% (currently {total}%). Leave all at 0 to skip.</p>
      )}
      <p className="text-xs text-gray-500 mt-1">Set the percentage of the raise going to each area. Sections left at 0% are omitted.</p>
    </div>
  );
}

export default FundAllocator;
