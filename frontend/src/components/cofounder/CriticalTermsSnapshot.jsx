// Critical terms snapshot — 4 tiles, each inheriting the status of the clause
// it summarises. Values come straight from vm.snapshot (never faked).
//
// Only PROBLEM tiles are tinted, per the design: colour on this row means
// "look here". Tinting the healthy states too made every tile coloured in the
// happy path, so nothing stood out. The per-tile pill still carries the
// healthy status.
import React from 'react';
import StatusPill, { TONE_CARD } from './StatusPill';

const NEEDS_ATTENTION = new Set(['review', 'blocked']);

export default function CriticalTermsSnapshot({ tiles }) {
  const list = Array.isArray(tiles) ? tiles : [];
  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2.5">
        Critical terms snapshot
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="snapshot">
        {list.map((t) => (
          <div
            key={t.key}
            className={`rounded-2xl border p-3.5 ${NEEDS_ATTENTION.has(t.status) ? (TONE_CARD[t.tone] || TONE_CARD.gray) : TONE_CARD.gray}`}
          >
            <div className="text-[10.5px] uppercase tracking-wide text-gray-500 dark:text-gray-400">{t.label}</div>
            <div className="text-[14px] font-extrabold tabular-nums text-gray-900 dark:text-gray-50 mt-1 truncate" data-testid={t.testid}>
              {t.value}
            </div>
            <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5 truncate">{t.sub}</div>
            <div className="mt-2">
              <StatusPill status={t.status} size="xs" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
