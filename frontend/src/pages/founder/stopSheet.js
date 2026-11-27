// D770 (#2095, D720 F3 §6) — the recording's Stop sheet. Pure, so the sheet
// and the tests read the same words.
//
// A recording's Stop no longer summarises or places by itself. The sheet asks
// "Summarise and place with Eadwyn", off by default, and `auto` comes only
// from that choice, never from the page's mode. Off, the recording and its
// transcript are saved, and the review offers Summarise and Structure later.
//
// THE QUOTE is D424's: measured, never modelled. It is the reader's own
// average for each of the two runs the choice starts, from
// `/api/ai/me/spend`'s `by_task`, the figure the fill bands quote before a
// run (`workspaces/RunEstimate.jsx`). The hold itself is the Worker's, inside
// `run()` (D762).
import { formatCost } from '../../ui/assistCost';
import { observedRunCost } from '../../ui/eadwynConfig';

export const STOP_CHOICE = 'Summarise and place with Eadwyn';

/** The router tasks the choice starts, with the words the quote names them by. */
export const STOP_TASKS = [
  { task: 'summarise_interview', label: 'summaries', one: 'summary' },
  { task: 'structure_interview', label: 'placements', one: 'placement' },
];

/** The sheet's sentence and its Stop button, for the choice as it stands. */
export function stopWords(on) {
  return on
    ? { body: 'The recording ends. Eadwyn transcribes it, writes the summary and proposes placements for you to review.', stop: 'Stop and process' }
    : { body: 'The recording ends. Eadwyn transcribes it, and the recording and its transcript are saved. You can summarise and place it from the review.', stop: 'Stop and save' };
}

/**
 * What the choice has cost THIS reader before, as `runEstimate` keeps its
 * states apart: nothing while loading; Unreadable when the usage log could
 * not be read; otherwise one line naming each run's average, or that there is
 * none to quote. `ai` is `useAiSpend()`'s result; without one, nothing.
 */
export function stopQuote(ai) {
  if (!ai) return null;
  if (ai.loading) return { state: 'loading' };
  if (ai.spendError || ai.spend?.recorded === false || ai.spend?.by_task_recorded === false) return { state: 'unreadable' };
  if (!ai.spend) return null;
  const parts = STOP_TASKS.map(({ task, label, one }) => {
    const seen = observedRunCost(ai.spend, task);
    return seen ? `your ${label} have averaged ${formatCost(seen.cost)}, over ${seen.calls}` : `no ${one} of yours is recorded yet`;
  });
  return { state: 'read', text: `Before you choose · ${parts.join('; ')}.` };
}
