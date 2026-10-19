import { Check, Trash2, Wand2 } from 'lucide-react';
import { PROPOSAL_COPY as T, changedCount, proposalRows } from '../lib/deckProposal';

/**
 * D767 (#2096) — a "Fill from project" proposal beside the current version.
 * Keep and Discard are the founder's; nothing is written until Keep.
 */
export default function DeckProposalPanel({ proposal, currentSlides, onKeep, onDiscard, busy = false }) {
  if (!proposal) return null;
  const rows = proposalRows(currentSlides, proposal.slides);
  const changed = changedCount(currentSlides, proposal.slides);
  return (
    <section
      aria-label={T.title}
      data-testid="deck-proposal"
      className="mb-4 rounded-lg border border-violet-300 bg-violet-50/60 p-3 dark:border-violet-800 dark:bg-violet-950/30"
    >
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-violet-900 dark:text-violet-200">
            <Wand2 className="h-4 w-4" aria-hidden="true" /> {T.title}
          </h3>
          <p className="mt-0.5 text-xs text-gray-600 dark:text-slate-400" data-testid="deck-proposal-lede">
            {T.lede} {changed === 1 ? '1 slide changes.' : `${changed} slides change.`}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onDiscard(proposal)}
            disabled={busy}
            data-testid="button-deck-proposal-discard"
            className="flex min-h-[36px] items-center gap-1.5 rounded border border-gray-300 bg-white px-3 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" /> {T.discard}
          </button>
          <button
            type="button"
            onClick={() => onKeep(proposal)}
            disabled={busy}
            data-testid="button-deck-proposal-keep"
            className="flex min-h-[36px] items-center gap-1.5 rounded bg-violet-600 px-3 text-sm text-white hover:bg-violet-700 disabled:opacity-50"
          >
            <Check className="h-4 w-4" aria-hidden="true" /> {T.keep}
          </button>
        </div>
      </div>
      <table className="mt-3 w-full table-fixed text-left text-xs" data-testid="deck-proposal-rows">
        <thead className="text-gray-500 dark:text-slate-400">
          <tr>
            <th className="w-8 py-1 font-medium">#</th>
            <th className="py-1 font-medium">{T.current}</th>
            <th className="py-1 font-medium">{T.proposed}</th>
            <th className="w-20 py-1 font-medium" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.index} className="border-t border-violet-200/70 align-top dark:border-violet-900/50" data-changed={r.changed ? 'true' : 'false'}>
              <td className="py-1.5 text-gray-500">{r.index + 1}</td>
              <td className="py-1.5 pr-2 text-gray-700 dark:text-slate-300">
                <div className="truncate font-medium">{r.current?.title || T.none}</div>
                {r.current?.excerpt && <div className="line-clamp-2 text-gray-500 dark:text-slate-400">{r.current.excerpt}</div>}
              </td>
              <td className="py-1.5 pr-2 text-gray-900 dark:text-slate-100">
                <div className="truncate font-medium">{r.proposed?.title || T.none}</div>
                {r.proposed?.excerpt && <div className="line-clamp-2 text-gray-600 dark:text-slate-300">{r.proposed.excerpt}</div>}
              </td>
              <td className={`py-1.5 ${r.changed ? 'font-semibold text-violet-700 dark:text-violet-300' : 'text-gray-400'}`}>
                {r.changed ? T.changed : T.same}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
