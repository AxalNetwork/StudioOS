/**
 * D4811 part 22 (#4811) — a closing line's paper in the agreement lifecycle:
 * the shared pill (`LifecycleBadge`, light and dark pairs, glyph plus words)
 * and the detail beside it ("1 of 2 signed", "waiting for Axal’s countersign").
 * A paper state with no lifecycle word (Declined, no paper) is words only.
 * The rule is `closingPaperLifecycle` in `lib/contractLifecycle.js`.
 * Unreadable (D4811 part 24) is drawn as the desk's failed read is, in red with its dark pair.
 */
import { LifecycleBadge } from '../admin/contracts/LifecycleBadge';

export default function PaperState({ state, text = null }) {
  if (!state) return text;
  return (
    <span className="inline-flex flex-wrap items-center gap-1" data-paper-state={state.key}>
      {state.badge && <LifecycleBadge badge={state.badge} />}
      {state.detail && <span className={state.badge ? 'text-[11.5px] font-normal text-gray-600 dark:text-gray-400' : state.key === 'unreadable' ? 'text-red-700 dark:text-red-300' : undefined}>{state.detail}</span>}
    </span>
  );
}
