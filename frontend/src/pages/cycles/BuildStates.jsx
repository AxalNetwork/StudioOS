/**
 * D4846 part 2 (#6032; Build v2 boards BD14 A and C, BD14m) — Build's system
 * states, drawn: one chip per state (`BuildStateTag`) and one notice when some
 * module reads failed (`BuildPartialNotice`). The rules live in
 * `buildSystemStates.js`; this file only draws them.
 *
 * Not recorded, Not expected yet and Unavailable are D5129's platform states
 * and draw through its `StateChip` (`ui/Honesty.jsx`): dotted, borderless
 * and lighter, dashed with "!". Waiting, Needs attention and Read only are
 * Build's own and draw in the same 11px chip shape with their own glyph and
 * border, so no state relies on colour alone (ST-01). Every colour has its
 * `dark:` pair, from BD14 C's palette.
 */
import { PartialBanner, StateChip } from '../../ui/Honesty.jsx';
import { BUILD_STATE_WORDS, PLATFORM_KIND, moduleReads, withRowState } from './buildSystemStates.js';

const CHIP = 'inline-flex max-w-full items-center gap-[5px] rounded-full border py-px pl-1.5 pr-2 align-middle text-[11px] font-bold leading-[1.6]';

/** Build's own three, in BD14's colours (light, then BD14 C's dark palette). */
export const BUILD_CHIP_CLASSES = Object.freeze({
  waiting: 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-400/40 dark:bg-violet-400/10 dark:text-violet-300',
  attention: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/45 dark:bg-amber-500/10 dark:text-amber-300',
  read_only: 'border-gray-300 bg-gray-50 text-gray-600 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-400',
});

const Svg = ({ children }) => (
  <svg aria-hidden="true" focusable="false" width="11" height="11" viewBox="0 0 12 12" className="flex-none">{children}</svg>
);
// Lines, circles and rects only, as Honesty's glyphs, so a "no <p> in a <p>" check reading markup is not tripped.
const GLYPHS = {
  // ◷: a clock face, still working.
  waiting: <Svg><circle cx="6" cy="6" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.5" /><line x1="6" y1="6" x2="6" y2="3" stroke="currentColor" strokeWidth="1.5" /><line x1="6" y1="6" x2="3.6" y2="6" stroke="currentColor" strokeWidth="1.5" /></Svg>,
  // ▲ drawn as three strokes: a known blocker.
  attention: <Svg><line x1="6" y1="1.6" x2="1.4" y2="10.2" stroke="currentColor" strokeWidth="1.6" /><line x1="6" y1="1.6" x2="10.6" y2="10.2" stroke="currentColor" strokeWidth="1.6" /><line x1="1.4" y1="10.2" x2="10.6" y2="10.2" stroke="currentColor" strokeWidth="1.6" /></Svg>,
  // A padlock: read, not change.
  read_only: <Svg><rect x="2.4" y="5.4" width="7.2" height="5.2" rx="1" fill="none" stroke="currentColor" strokeWidth="1.4" /><circle cx="6" cy="5.4" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.4" /></Svg>,
};

/**
 * One Build state as one chip. `state` is one of `BUILD_STATES`; `label` is
 * the Worker's own word where the model keeps it ("Blocked"), else BD14's.
 */
export function BuildStateTag({ state, label, title, className = '' }) {
  const word = label || BUILD_STATE_WORDS[state] || BUILD_STATE_WORDS.not_recorded;
  const kind = Object.hasOwn(PLATFORM_KIND, state) ? PLATFORM_KIND[state] : 'not_recorded';
  if (kind) {
    // D5129's own chip; "Not expected yet" is its Not applicable shape, lighter and borderless.
    return <StateChip kind={kind} label={kind === 'unavailable' ? undefined : word} title={title} className={className} data-build-state={state} />;
  }
  return (
    <span className={`${CHIP} ${BUILD_CHIP_CLASSES[state]} ${className}`.trim()} title={title} data-build-state={state}>
      {GLYPHS[state]}{word}
    </span>
  );
}

/** A phone row whose pill is a Build state draws that state's chip as its value (BD14m), not a `ui/Pill`. */
export function phoneStateRow(row) {
  const next = withRowState(row);
  if (next === row) return row;
  const { state, ...rest } = next;
  return { ...rest, value: <BuildStateTag state={state.state} label={state.label} /> };
}

/**
 * BD14 A's "Partial read failure": one notice over the module cards when some
 * of them could not be read ("5 of 6 modules read · Operating systems could
 * not be read."), drawn through D5129's `PartialBanner`. Nothing when every
 * module was read. Its Retry re-reads only the cards that failed; each card
 * keeps its own Retry as well.
 */
export function BuildPartialNotice({ cards, onRetryCard }) {
  const reads = moduleReads(cards);
  if (!reads.show) return null;
  const retry = typeof onRetryCard === 'function' && reads.failed.some((f) => f.slug)
    ? () => reads.failed.forEach((f) => { if (f.slug) onRetryCard(f.slug); })
    : undefined;
  return (
    <PartialBanner
      lead={reads.lead}
      rest={reads.rest}
      missing={reads.failed.length}
      of={reads.total}
      sources={reads.failed.map((f) => ({ name: f.name, state: 'unavailable' }))}
      onRetry={retry}
      data-testid="build-partial-notice"
      data-read={reads.read}
      data-of={reads.total}
    />
  );
}
