import React from 'react';

/**
 * D1497 (#3727, canvas TMA) — the Team page's Eadwyn button. It is "Ask",
 * never "Fill": a ghost button with the Eadwyn mark beside the purple primary,
 * its accessible name "Ask Eadwyn".
 *
 * IT DRAWS NOTHING YET. Ask opens the Ask panel, which is #3706's and is not
 * on this base. The only Eadwyn panel that exists is D698's phone panel
 * (`ui/eadwynPanel.js`): it shows the rail's own body, serves a founder below
 * 1024px only, and closes at 1024px; registering with its `useEadwynTrigger()`
 * would also hide the rail's floating button. Wiring Ask to it would open the
 * rail's contents on a phone and nothing on a desktop, so `AskButton` renders
 * nothing and registers nothing. `AskButtonView` is the drawn button, kept for
 * #3706 (or #3693's shared Ask button, which replaces this file) to mount.
 *
 * The AIRail itself is not touched: it keeps model choices and consumption.
 */
export function AskButtonView({ onClick, disabled = false, expanded }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label="Ask Eadwyn" aria-haspopup="dialog" aria-expanded={expanded}
      className="inline-flex h-10 items-center gap-2 rounded-[9px] border border-axal-lavender-edge bg-transparent px-3.5 text-[13.5px] font-semibold text-axal-violet-deep hover:bg-axal-lavender focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-axal-violet disabled:opacity-45 dark:border-violet-700/60 dark:text-violet-300 dark:hover:bg-violet-900/30"
      data-testid="team-ask">
      <img src="/eadwyn-ai.png" alt="" width="16" height="16" />
      Ask
    </button>
  );
}

/** Until #3706's Ask panel exists there is nothing for Ask to open. */
export default function AskButton() {
  return null;
}
