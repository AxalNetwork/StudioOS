import React, { useMemo, useState } from 'react';
import { PhoneSheet } from '../../../ui/phone/PhoneSheet';
import { KIND_FILTERS, LAYER_ORDER, STATE_FILTERS, filterCatalog } from '../../../lib/templateCatalogModel';

// D717 (#1854) — the Templates tab's filters on a phone (board L12, frame
// `p-sheet`, `DESK:37`). The chips change a draft; only "Show [n] templates"
// applies it. Closing any other way (the scrim, Escape, a swipe, a route
// change) drops the draft (decision 7).

// The canvas's short layer names (`LEGAL:239`).
const LAYER_CHIP = { gp: 'Internal Management', fund: 'Fund Formation', portfolio: 'Investment Execution', compliance: 'Compliance' };
const STATE_CHIP = { all: 'All', has_body: 'Has a body', stub: 'Stub', unpublished: 'Unpublished', published: 'Published' };

const heading = 'mb-1.5 mt-2 text-[11px] font-extrabold uppercase tracking-[.08em] text-[#7d7889] dark:text-[#a29db0]';
const chipBase = 'min-h-[36px] rounded-[99px] border px-3 text-[13px] font-semibold';
const chipOn = 'border-[#881337] text-[#881337] dark:border-rose-300 dark:text-rose-300';
const chipOff = 'border-[#ececf1] text-[#18181b] dark:border-[#2a2733] dark:text-[#f4f3f7]';

function Group({ label, options, value, onPick }) {
  return (
    <div role="group" aria-label={label}>
      <div className={heading}>{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {options.map(([key, text]) => (
          <button key={key} type="button" aria-pressed={value === key} onClick={() => onPick(key)}
            className={`${chipBase} ${value === key ? chipOn : chipOff}`}>{text}</button>
        ))}
      </div>
    </div>
  );
}

export default function FilterSheet({ items, q, value, onApply, onClose, opener }) {
  const [draft, setDraft] = useState(value);
  // A layer outside LAYER_ORDER that the items carry gets a chip with its label.
  const layers = useMemo(() => {
    const extra = new Map((items || []).filter(row => row?.layer && !LAYER_ORDER.includes(row.layer))
      .map(row => [row.layer, row.layer_label || row.layer]));
    return [['all', 'All'], ...LAYER_ORDER.map(k => [k, LAYER_CHIP[k]]), ...extra];
  }, [items]);
  const n = filterCatalog(items, { q, ...draft }).length;
  const pick = key => v => setDraft(d => ({ ...d, [key]: v }));
  return (
    <PhoneSheet label="Filters" scrimClass="bg-[rgba(24,24,27,.35)]" opener={opener} onClose={onClose}>
      <div className="px-[2px] pb-[calc(28px+env(safe-area-inset-bottom))]" data-testid="template-filter-sheet">
        <Group label="Layer" options={layers} value={draft.layer} onPick={pick('layer')} />
        <Group label="State" options={STATE_FILTERS.map(k => [k, STATE_CHIP[k]])} value={draft.state} onPick={pick('state')} />
        <Group label="Kind" options={KIND_FILTERS.map(k => [k, k === 'all' ? 'All' : k])} value={draft.kind} onPick={pick('kind')} />
        <button type="button" data-testid="template-filter-show" onClick={() => onApply(draft)}
          className="mt-4 min-h-[50px] w-full rounded-[14px] bg-[#881337] text-[15px] font-bold text-white">
          {n === 1 ? 'Show 1 template' : `Show ${n} templates`}
        </button>
      </div>
    </PhoneSheet>
  );
}
