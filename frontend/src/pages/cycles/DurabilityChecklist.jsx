import { useState } from 'react';
import { tickLine } from './durableModel.js';

/**
 * D661 (#1474) — Durable company-building's further part: the durability
 * checklist from Grow's module read (`parts.checklist`, D664). Each item says
 * whether it is done and what says so: a Spin-Out Lab milestone, or the
 * founder's own tick ("typed"). An item no one has marked reads "Not done".
 *
 * With `onToggle(key, done)` the founder ticks an item by hand, or unticks
 * their own tick (`PUT /api/cycles/grow/checklist/:key`). An item a Lab
 * milestone marked is done by that milestone, so it carries no untick.
 *
 * D6122 (#6122, GR-24): each row is a ✓ (or an empty box) and the item, over
 * one line saying how it was ticked ("Spin-Out Lab · 2 Mar 2026", "By hand ·
 * 14 Jul 2026", "From Mercury, as of …") or how it will be ("Open · Ticks from
 * the Spin-Out Lab", "Open · Tick by hand"). Not applicable waits on its store.
 */
const TOGGLE = 'whitespace-nowrap rounded-md border border-axal-hairline px-2 py-0.5 text-[11px] font-semibold text-axal-ink hover:bg-axal-ground disabled:opacity-50 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800';

export default function DurabilityChecklist({ items, onToggle }) {
  const [busy, setBusy] = useState('');
  const [refusal, setRefusal] = useState('');
  const list = Array.isArray(items) ? items.filter((i) => i && i.key) : [];
  if (!list.length) return null;
  const done = list.filter((i) => i.done).length;
  const toggle = async (key, next) => {
    setBusy(key); setRefusal('');
    try { await onToggle(key, next); } catch (err) { setRefusal(err?.message || 'This could not be saved. Try again.'); } finally { setBusy(''); }
  };
  return (
    <section className="flex min-w-0 flex-col gap-2 rounded-xl border border-axal-hairline bg-white px-[18px] py-4 dark:border-gray-800 dark:bg-gray-900" data-testid="cycle-part-checklist">
      <div className="flex flex-wrap items-baseline justify-between gap-2.5">
        <h2 className="m-0 text-[15px] font-extrabold tracking-[-.015em] text-axal-ink dark:text-gray-100">Durability checklist</h2>
        <span className="text-[11px] text-axal-faint dark:text-gray-500">{done} of {list.length} done</span>
      </div>
      {refusal && <p role="alert" className="m-0 text-[12px] text-red-700 dark:text-red-300">{refusal}</p>}
      <ul className="m-0 flex list-none flex-col p-0">
        {list.map((i) => (
          <li key={i.key} className="flex items-start justify-between gap-2.5 border-b border-axal-ground py-[7px] text-[12px] last:border-b-0 dark:border-gray-800" data-done={i.done ? 'true' : 'false'}>
            <span className="flex min-w-0 items-start gap-2">
              <span aria-hidden="true" className={`mt-px grid h-4 w-4 flex-none place-items-center rounded border text-[10px] font-bold ${i.done ? 'border-emerald-600 bg-emerald-600 text-white dark:border-emerald-400 dark:bg-emerald-500' : 'border-axal-hairline dark:border-gray-600'}`}>{i.done ? '✓' : ''}</span>
              <span className="min-w-0">
                <span className="block font-semibold text-axal-ink dark:text-gray-100">{i.label || i.key}<span className="sr-only">{i.done ? ', done' : ', open'}</span></span>
                <span className={`block ${i.done ? 'text-emerald-700 dark:text-emerald-300' : 'text-axal-muted dark:text-gray-400'}`} data-testid={`checklist-how-${i.key}`}>{tickLine(i)}</span>
              </span>
            </span>
            <span className="flex flex-none items-center gap-2">
              {onToggle && !i.done && <button type="button" className={TOGGLE} disabled={busy === i.key} onClick={() => toggle(i.key, true)} data-testid={`checklist-tick-${i.key}`}>Mark done</button>}
              {onToggle && i.done && i.source === 'manual' && <button type="button" className={TOGGLE} disabled={busy === i.key} onClick={() => toggle(i.key, false)} data-testid={`checklist-untick-${i.key}`}>Undo</button>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
