import { AskButtonView, PageAsk } from '../../ui/AskButton.jsx';

/**
 * D1497 (#3727, canvas TMA) — the Team page's Eadwyn button. It is "Ask",
 * never "Fill": a ghost button with the Eadwyn mark beside the purple primary,
 * its accessible name "Ask Eadwyn".
 *
 * D1443 (#3706): Ask opens the Ask panel, which slides out of the AIRail's left
 * edge (`ui/AskPanel.jsx`). `PageAsk` draws the button only while a rail serves
 * the viewer, so a page with no rail, a support session or an Explorer shows
 * no Ask. `AskButtonView` stays re-exported for the tests that draw it.
 *
 * The AIRail itself is not touched: it keeps model choices and consumption.
 */
export { AskButtonView };

export default function AskButton({ label } = {}) {
  return <PageAsk label={label} />;
}
