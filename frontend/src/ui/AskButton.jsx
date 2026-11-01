import React, { useId } from 'react';
import { openAskPanel, useAskPanel } from './eadwynPanel.js';

/**
 * The shared Eadwyn "Ask" button (D1604, #3716; lifted from Team's D1497
 * `AskButtonView`, which now re-exports this one).
 *
 * It is "Ask", never "Fill": a ghost button with the Eadwyn mark, its
 * accessible name "Ask Eadwyn". The owner's rule, and the Pitch deck canvas's
 * pd40, give it these states, all from props:
 *
 *   waiting  N > 0     an amber "N waiting" pill; the name becomes
 *                      "Ask Eadwyn, N waiting". null (an unread count) and 0
 *                      draw nothing: a count that could not be read is never
 *                      "0 waiting".
 *   state 'running'    a spinner and "Asking…"; the name stays "Ask Eadwyn"
 *   state 'off'        AI paused: the mark greys, the name stays "Ask Eadwyn"
 *   state 'unreadable' muted
 *   state 'out'        out of AI tokens: an amber dot
 *   sub                a line under the button, tied to it by
 *                      `aria-describedby` (why it is off, unreadable or out)
 *
 * The word "Ask" is drawn on every width, at 44px tall on a phone. It runs
 * nothing itself: what it opens is its host's (`PageAsk` below opens #3706's
 * Ask panel, D1443; the Pitch deck studio: `DeckAsk`'s "Waiting for you" sheet).
 */
export const ASK_NAME = 'Ask Eadwyn';

/** "Ask Eadwyn", with ", N waiting" only for a counted N > 0. */
export function askButtonName(waiting) {
  return Number.isInteger(waiting) && waiting > 0 ? `${ASK_NAME}, ${waiting} waiting` : ASK_NAME;
}

// One text colour per state, never two stacked: two colour utilities of the
// same weight resolve by their order in the built CSS, not in this string.
const INK = 'text-axal-violet-deep dark:text-violet-300';
const MUTED_INK = 'text-axal-muted dark:text-gray-400';

export function AskButtonView({ onClick, disabled = false, expanded, waiting = null, state = 'rest', sub = null, testId = 'ask-eadwyn', buttonRef }) {
  const subId = useId();
  const running = state === 'running';
  const muted = state === 'off' || state === 'unreadable';
  const count = Number.isInteger(waiting) && waiting > 0 ? waiting : null;
  const button = (
    <button
      type="button"
      ref={buttonRef}
      onClick={onClick}
      disabled={disabled}
      aria-label={askButtonName(count)}
      aria-haspopup="dialog"
      aria-expanded={expanded}
      aria-describedby={sub ? subId : undefined}
      data-state={state}
      className={`relative inline-flex h-10 items-center gap-2 rounded-[9px] border border-axal-lavender-edge bg-transparent px-3.5 text-[13.5px] font-semibold hover:bg-axal-lavender focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-axal-violet disabled:opacity-45 max-sm:min-h-[44px] dark:border-violet-700/60 dark:hover:bg-violet-900/30 ${muted ? MUTED_INK : INK}`}
      data-testid={testId}
    >
      {running
        ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-axal-lavender-edge border-t-axal-violet dark:border-violet-800 dark:border-t-violet-300" aria-hidden="true" />
        : <img src="/eadwyn-ai.png" alt="" width="16" height="16" className={muted ? 'opacity-50 grayscale' : undefined} />}
      {running ? 'Asking…' : 'Ask'}
      {count ? (
        <span className="rounded-full bg-amber-200 px-1.5 py-px font-mono text-[10.5px] font-bold text-amber-900 dark:bg-amber-900/60 dark:text-amber-200" data-testid={`${testId}-waiting`}>
          {count} waiting
        </span>
      ) : null}
      {state === 'out' ? <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-amber-500 dark:bg-amber-400" aria-hidden="true" data-testid={`${testId}-out`} /> : null}
    </button>
  );
  if (!sub) return button;
  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      {button}
      <span id={subId} className="max-w-[260px] text-right text-[11.5px] text-axal-muted dark:text-gray-400" data-testid={`${testId}-sub`}>{sub}</span>
    </span>
  );
}

/**
 * D1443 (#3706) — THE PAGE'S ASK, connected. It opens the Ask panel
 * (`ui/AskPanel.jsx`), which slides out of the AIRail's left edge. It draws
 * nothing while no rail serves the viewer: a page with no rail, a support
 * session or an Explorer never shows Ask (AK13). `label` names what the panel
 * is about ("Team · Northwind Labs"); without it the rail's own page label is
 * used. The "N waiting" count waits on D1442's proposals-by-page read, so it is
 * not drawn: a count that is not read is never "0 waiting".
 */
export function PageAsk({ label, testId = 'ask-eadwyn' }) {
  const ask = useAskPanel();
  if (!ask.available) return null;
  return <AskButtonView onClick={() => openAskPanel(label)} expanded={ask.open} testId={testId} />;
}

export default AskButtonView;
