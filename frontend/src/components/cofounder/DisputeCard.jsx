// Dispute resolution — the design's standalone right-column card.
//
// Same generator input as the DisputeEditor inside the clause accordion
// (draft.deadlock → deadlock_clause), surfaced at top level because the design
// treats the mediation-vs-arbitration choice as a headline term rather than
// something buried behind a collapsed row. Both controls write the same state,
// so they can never disagree.
//
// Nothing here is a status: the segmented control shows what is CURRENTLY
// selected in the builder, not a decision Axal has on record.
import React from 'react';
import { DISPUTE } from '../../lib/cofounderAgreementViewModel';

export default function DisputeCard({ dispute, canEdit, disabledReason, onSelect }) {
  const d = dispute || {};
  const selected = d.mode === 'arbitration' ? DISPUTE[1].v : DISPUTE[0].v;

  return (
    <div data-testid="card-dispute">
      <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-3">
        Dispute resolution
      </div>

      <div
        className="flex gap-1 rounded-xl bg-gray-100 dark:bg-gray-800 p-1 mb-3"
        role="group"
        title={canEdit ? undefined : disabledReason}
      >
        {DISPUTE.map((o) => {
          const on = selected === o.v;
          return (
            <button
              key={o.v}
              type="button"
              disabled={!canEdit}
              onClick={() => canEdit && onSelect && onSelect(o.v)}
              aria-pressed={on}
              title={canEdit ? undefined : disabledReason}
              data-testid={`dispute-card-${o.label.toLowerCase().replace(/\s/g, '-')}`}
              className={`flex-1 text-[11.5px] font-bold rounded-lg py-1.5 transition disabled:cursor-not-allowed ${
                on
                  ? 'bg-white dark:bg-gray-900 text-violet-600 dark:text-violet-400 shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>

      <p className="text-[12px] text-gray-600 dark:text-gray-300 leading-relaxed" data-testid="dispute-card-explain">
        {d.explain}
      </p>
      {d.clauseSentence && (
        <p className="text-[10.5px] text-gray-400 dark:text-gray-500 mt-2 leading-snug" data-testid="dispute-card-sentence">
          Written into §4.4 verbatim: “{d.clauseSentence}”
        </p>
      )}
    </div>
  );
}
