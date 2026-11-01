import { AskButtonView } from '../../ui/AskButton.jsx';

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
 * #3706 to mount. D1604 (#3716) lifted it to `frontend/src/ui/AskButton.jsx`,
 * shared with the Pitch deck studio's header Ask; it is re-exported here.
 *
 * The AIRail itself is not touched: it keeps model choices and consumption.
 */
export { AskButtonView };

/** Until #3706's Ask panel exists there is nothing for Ask to open. */
export default function AskButton() {
  return null;
}
