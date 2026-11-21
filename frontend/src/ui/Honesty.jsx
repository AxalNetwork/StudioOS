/**
 * D5129 (#5129) — the platform's data states, drawn. One vocabulary, one look,
 * one component for every redesigned surface: the Platform States canvas
 * (`design/incoming/Platform States Page.dc.html`, board ST-13), redrawn into
 * this file rather than a new one beside it.
 *
 * WHY THESE ARE ONE FILE AND NOT FIVE COPIES. `Unrecorded` was written twice
 * (`lib/fundAnalytics.js` for the investor pages, `pages/advisor/expertise/kit`
 * for everything else) and `Unreadable` twice more, locally inside
 * `HqHomePage` and `SecurityPage` — with copy that had already drifted apart:
 * one closed "This is not a claim that none exist", the other "…that nothing
 * happened". Each new HQ page added another pair, and the distinction these
 * components exist to hold is precisely the one that drifts:
 *
 *   **Not recorded** (`Unrecorded`) — the store was read and holds no value
 *   for this. The product may not collect it yet, or this row may simply not
 *   have it. `DataState` draws its reason as VISIBLE text (phones and screen
 *   readers never see a hover). The `Unrecorded` alias still carries the
 *   reason as a title, because about 45 of its 500-odd `reason=` call sites
 *   already print the same reason beside it and would show it twice; a
 *   surface moves to visible reasons when its redesign is built (#5129).
 *
 *   **Unavailable** (`Unreadable`) — the read FAILED. Nothing is known either
 *   way, and a page that shows an empty state here is asserting something it
 *   cannot support. This is the one that silently becomes "there is nothing
 *   there" when it is rewritten from memory. The owner's answer to #5129's
 *   Question 2 (A, 2026-11-10): the SCREEN says "Unavailable"; `unreadable`
 *   stays the name in code, so `Unreadable` keeps its name and its importers.
 *
 * Neither ever renders a zero, and neither renders a bare em-dash: a dash is
 * indistinguishable from a real value a designer chose, and "0" is a claim.
 * See D56/D68. A measured zero is a Value and is drawn in ink like any figure.
 *
 * NO STATE RELIES ON COLOUR (ST-01's greyscale check, WCAG 1.4.1). Each chip
 * has its own glyph, border style and word:
 *   Not recorded   — em-dash,   dotted border
 *   Not applicable — no glyph,  no border
 *   Unavailable    — "!",       dashed border
 *   Refused        — ⊘,         solid ink border
 *   Stale          — clock,     dashed amber border, always with an age
 *   Partial        — half disc, solid amber border
 *   Provisional    — ◇,         dashed border, italic
 * Glyphs are aria-hidden; the word carries the meaning. Every colour below has
 * its `dark:` pair (the primitive's own test checks the pairs, since
 * `check-dark-mode` scans pages/ and components/ only).
 *
 * The state names, words and the mapping from the Worker's OperationalRead
 * (`stateFromRead`) live in `./dataState.js`, pure, and are re-exported here.
 */
import React, { useState } from 'react';
import { STATE_WORDS, UNAVAILABLE_REASON, normalizeState, partialCounts, staleAge } from './dataState.js';
import { parseStamp } from './parseStamp.js';

export {
  VALUE_STATES, MODIFIERS, STATE_WORDS, normalizeState, stateFromRead, staleAge, partialCounts, isRefusal,
  UNAVAILABLE_REASON, UNAVAILABLE_CLAIM, REFUSED_CLAIM, PARTIAL_REASON,
} from './dataState.js';

/* ---------- glyphs (the canvas's own 12px paths) ---------- */
const Svg = ({ children, className = '' }) => (
  <svg aria-hidden="true" focusable="false" width="11" height="11" viewBox="0 0 12 12" className={`flex-none ${className}`.trim()}>{children}</svg>
);
// Lines, circles and rects only — no <path>, <polygon> or <polyline> — so a page's
// own "no <p> inside a <p>" check, which reads markup as text, is not tripped by a glyph.
const GLYPHS = {
  not_recorded: <Svg><line x1="2" y1="6" x2="10" y2="6" stroke="currentColor" strokeWidth="1.8" /></Svg>,
  // The "!" of Unavailable carries the alert hue; the word and border still carry the meaning.
  unavailable: <Svg className="text-red-700 dark:text-red-400"><line x1="6" y1="1.6" x2="6" y2="7.6" stroke="currentColor" strokeWidth="2.2" /><circle cx="6" cy="10.2" r="1.2" fill="currentColor" /></Svg>,
  refused: <Svg><circle cx="6" cy="6" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.6" /><line x1="2.8" y1="9.2" x2="9.2" y2="2.8" stroke="currentColor" strokeWidth="1.6" /></Svg>,
  stale: <Svg><circle cx="6" cy="6" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.5" /><line x1="6" y1="3.2" x2="6" y2="6" stroke="currentColor" strokeWidth="1.5" /><line x1="6" y1="6" x2="7.9" y2="7.3" stroke="currentColor" strokeWidth="1.5" /></Svg>,
  // The half disc: a stroke as wide as the radius, dashed over half the circumference, turned to the right half.
  partial: <Svg><circle cx="6" cy="6" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.5" /><circle cx="6" cy="6" r="2.3" fill="none" stroke="currentColor" strokeWidth="4.6" strokeDasharray="7.23 14.46" transform="rotate(-90 6 6)" /></Svg>,
  provisional: <Svg><rect x="2.6" y="2.6" width="6.8" height="6.8" fill="none" stroke="currentColor" strokeWidth="1.5" transform="rotate(45 6 6)" /></Svg>,
  retry: <Svg><circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="21 5.4" transform="rotate(-60 6 6)" /><line x1="10.4" y1="1.6" x2="10.4" y2="4.8" stroke="currentColor" strokeWidth="1.6" /><line x1="10.4" y1="4.8" x2="7.2" y2="4.8" stroke="currentColor" strokeWidth="1.6" /></Svg>,
};
/** The glyph each state draws as text in a big tile slot; `null` draws none. */
const TILE_GLYPH = { not_recorded: '—', unavailable: '!', refused: '⊘' };

/* ---------- chip classes: v2 `.stt` shape, one border style per state ---------- */
const CHIP_BASE = 'inline-flex max-w-full items-center gap-[5px] rounded-full border py-px pl-1.5 pr-2 align-middle text-[11px] font-bold leading-[1.6]';
export const CHIP_CLASSES = Object.freeze({
  not_recorded: 'border-[1.5px] border-dotted border-gray-400 bg-transparent text-gray-600 dark:border-gray-500 dark:text-gray-400',
  not_applicable: 'border-transparent bg-transparent pl-0.5 text-gray-600 dark:text-gray-400',
  unavailable: 'border-[1.5px] border-dashed border-gray-400 bg-white text-gray-900 dark:border-gray-500 dark:bg-gray-900 dark:text-gray-100',
  refused: 'border-gray-900 bg-gray-50 text-gray-900 dark:border-gray-100 dark:bg-gray-800 dark:text-gray-100',
  stale: 'border-[1.5px] border-dashed border-amber-400 bg-transparent text-amber-800 dark:border-amber-500/60 dark:text-amber-300',
  partial: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-300',
  provisional: 'border-[1.5px] border-dashed border-gray-400 bg-transparent italic text-gray-600 dark:border-gray-500 dark:text-gray-400',
});
const WHY = 'text-[12px] font-normal leading-[1.45] text-gray-600 dark:text-gray-400';
const RETRY = 'relative -my-2.5 inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1 rounded-md px-1 text-[11.5px] font-bold text-violet-700 hover:underline focus-visible:outline-2 focus-visible:outline-violet-600 dark:text-violet-300';
const SKEL = 'inline-block rounded-[5px] bg-gray-200 dark:bg-gray-700';

// A Retry pressed anywhere marks the next few seconds as "after a user action":
// the Unavailable that answers it may be a fresh mount (most pages swap the
// failure for a loading state and back), and ST-09 announces only that one.
let lastRetryAt = 0;
const ANNOUNCE_MS = 15000;
const afterUserAction = () => Date.now() - lastRetryAt < ANNOUNCE_MS;

function Retry({ onRetry, label = 'Retry', onPressed }) {
  return (
    <button
      type="button"
      className={RETRY}
      onClick={(e) => { lastRetryAt = Date.now(); if (onPressed) onPressed(); onRetry(e); }}
      data-state-retry=""
    >
      {GLYPHS.retry} {label}
    </button>
  );
}

/**
 * The 11px chip only (ST-01). `kind`: not_recorded · not_applicable ·
 * unavailable · refused · stale · partial · provisional (`unreadable` reads as
 * unavailable). `label` replaces the word (a surface's own word in the same
 * shape: "Modelled", "Health · Unavailable"); `age` completes Stale ("Stale ·
 * 7 months old"), and a Stale with no age says "age not recorded" rather than
 * guess one. `lastGood` is a stamp: with no `age`, the age is worked out from it.
 */
export function StateChip({ kind, label, age, lastGood, now, className = '', children, ...rest }) {
  const k = normalizeState(kind) || 'not_recorded';
  let word = label;
  if (word == null) {
    if (k === 'stale') {
      const a = age || (lastGood != null ? staleAge(lastGood, now ?? Date.now()) : null);
      word = `Stale · ${a || 'age not recorded'}`;
    } else word = STATE_WORDS[k];
  }
  const glyph = GLYPHS[k];
  return (
    <span className={`${CHIP_BASE} ${CHIP_CLASSES[k] || CHIP_CLASSES.not_recorded} ${className}`.trim()} data-platform-state={k} {...rest}>
      {glyph}{word}{children}
    </span>
  );
}

function Skeleton({ size }) {
  if (size === 'tile') {
    return (
      <span className="flex w-full flex-col gap-1.5" aria-busy="true" aria-label="Loading" data-platform-state="loading">
        <span className={`${SKEL} h-2.5 w-[46%]`} />
        <span className={`${SKEL} h-[26px] w-[62%]`} />
        <span className={`${SKEL} h-2.5 w-[80%]`} />
      </span>
    );
  }
  if (size === 'block') {
    return (
      <div className="flex flex-col" aria-busy="true" aria-label="Loading" data-platform-state="loading">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-3.5 border-t border-gray-100 py-2.5 first:border-t-0 dark:border-gray-800">
            <span className={`${SKEL} h-3 w-[60px]`} /><span className={`${SKEL} h-3 w-[180px]`} /><span className={`${SKEL} ml-auto h-3 w-[80px]`} />
          </div>
        ))}
      </div>
    );
  }
  return <span className={`${SKEL} h-4 w-[84px] align-middle`} aria-busy="true" aria-label="Loading" data-platform-state="loading" />;
}

/**
 * One slot in one state (ST-02, ST-03). Exactly one state applies.
 *
 *   state    value · none · not_recorded · not_applicable · unavailable · refused · loading
 *            (`unreadable` and `unrecorded` read as their screen words' states)
 *   what     the thing, as it starts a sentence: "Payments"
 *   reason   visible text under or beside the chip — why, or where it is set
 *            (`reasonVisible={false}` puts it on the chip's title instead: the alias's default)
 *   claim    what this is NOT evidence of; Unavailable and Refused should always carry one
 *   onRetry  Unavailable only: draws Retry (never on Refused: a refusal is an answer);
 *            `retryLabel` keeps a shipped surface's own word ("Try again") until its redesign
 *   accessRoute  Refused only: the route to access, a node ("Ask the founder to share")
 *   stale    with state="value": `{ age, lastGood }` draws the Stale chip beside the figure
 *   provisional  with state="value": true, or the surface's word, draws the Provisional chip
 *   size     inline (default; a sentence, a cell, a row's edge) · tile · block
 *   children the figure (value), the empty sentence (none), or the word (not_recorded)
 *
 * Unavailable is `role="alert"` only after a user action (a Retry); on first load
 * it is plain text, so a page of failures does not shout (ST-09). `announce="always"`
 * keeps the alert on first load, as every failed read shipped before this redraw
 * did (the `Unreadable` alias passes it, so no shipped page goes quiet).
 */
export function DataState({
  state, what, reason, reasonVisible = true, claim, onRetry, retryLabel = 'Retry', announce = 'after-action', accessRoute, stale, provisional, size = 'inline', as, children, action, className = '', ...rest
}) {
  const s = normalizeState(state) || 'not_recorded';
  const [retried, setRetried] = useState(false);
  const Root = as || (size === 'block' ? 'div' : 'span');
  const base = { 'data-platform-state': s, ...rest };

  if (s === 'loading') return <Skeleton size={size} />;

  if (s === 'value') {
    const mods = [
      stale ? <StateChip key="stale" kind="stale" age={stale.age} lastGood={stale.lastGood} /> : null,
      provisional ? <StateChip key="prov" kind="provisional" label={typeof provisional === 'string' ? provisional : undefined} /> : null,
    ];
    return (
      <Root className={`inline-flex flex-wrap items-center gap-x-2 gap-y-1 ${className}`.trim()} {...base}>
        <span className={provisional ? 'italic text-gray-600 dark:text-gray-400' : 'text-gray-900 dark:text-gray-100'}>{children}</span>
        {mods}
        {stale?.lastGood && size !== 'inline' ? <span className={`basis-full ${WHY}`}>Last good {String(stale.lastGood).slice(0, 10)}</span> : null}
      </Root>
    );
  }

  if (s === 'none') {
    const sentence = children ?? (what ? `No ${String(what).toLowerCase()}.` : 'None.');
    return (
      <Root
        className={size === 'block'
          ? `flex items-center justify-between gap-2.5 rounded-[9px] bg-gray-50 p-3 text-[13px] text-gray-900 dark:bg-gray-800/60 dark:text-gray-100 ${className}`.trim()
          : `text-gray-600 dark:text-gray-400 ${className}`.trim()}
        {...base}
      >
        <span>{sentence}</span>{action || null}
      </Root>
    );
  }

  if (s === 'unavailable') {
    const lead = what ? `${what} could not be read.` : null;
    const why = [lead, claim, reason].filter(Boolean);
    const text = why.length ? why.join(' ') : UNAVAILABLE_REASON;
    const alert = announce === 'always' || retried || afterUserAction();
    const retry = onRetry ? <Retry onRetry={onRetry} label={retryLabel} onPressed={() => setRetried(true)} /> : null;
    if (size === 'block') {
      return (
        <Root className={`flex items-start gap-2.5 rounded-[9px] border-[1.5px] border-dashed border-gray-400 bg-white p-3 text-[12.5px] leading-normal dark:border-gray-500 dark:bg-gray-900 ${className}`.trim()} role={alert ? 'alert' : undefined} {...base}>
          <span className="mt-[3px]">{GLYPHS.unavailable}</span>
          <span className="flex flex-1 flex-col gap-[3px]">
            <StateChip kind="unavailable" className="self-start" />
            {lead ? <b className="text-gray-900 dark:text-gray-100">{lead}</b> : null}
            <span className={WHY}>{[claim, reason].filter(Boolean).join(' ') || (lead ? null : UNAVAILABLE_REASON)}</span>
          </span>
          {retry}
        </Root>
      );
    }
    if (size === 'tile') {
      return (
        <Root className={`flex flex-col items-start gap-1.5 ${className}`.trim()} role={alert ? 'alert' : undefined} {...base}>
          <span aria-hidden="true" className="inline-grid h-[30px] w-[30px] place-items-center rounded-lg border-[1.5px] border-dashed border-gray-400 text-[18px] font-extrabold text-red-700 dark:border-gray-500 dark:text-red-400">{TILE_GLYPH.unavailable}</span>
          <StateChip kind="unavailable" />
          <span className={WHY}>{text}</span>
          {retry}
        </Root>
      );
    }
    // Inline: the chip, then "<what> could not be read. <claim>", then Retry.
    return (
      <Root className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-gray-900 dark:text-gray-100 ${className}`.trim()} role={alert ? 'alert' : undefined} {...base}>
        <StateChip kind="unavailable" />
        <span>{what ? <>{what} could not be read. {claim}</> : claim || (reason ? null : UNAVAILABLE_REASON)}{reason ? <>{what || claim ? ' ' : ''}{reason}</> : null}</span>
        {retry}
      </Root>
    );
  }

  if (s === 'refused') {
    const text = claim || reason || 'The read was refused. That is not a claim that nothing is recorded.';
    const lead = what ? `Nothing of ${String(what)} is shown here, because the read was refused.` : null;
    if (size === 'block') {
      return (
        <Root className={`flex items-start gap-2.5 rounded-[9px] border border-gray-900 bg-gray-50 p-3 text-[12.5px] leading-normal dark:border-gray-100 dark:bg-gray-800 ${className}`.trim()} {...base}>
          <span className="mt-[3px] text-gray-900 dark:text-gray-100">{GLYPHS.refused}</span>
          <span className="flex flex-1 flex-col gap-[3px]">
            <b className="text-gray-900 dark:text-gray-100">Refused.</b>
            <span className={WHY}>{[lead, text].filter(Boolean).join(' ')}</span>
            {accessRoute || null}
          </span>
        </Root>
      );
    }
    if (size === 'tile') {
      return (
        <Root className={`flex flex-col items-start gap-1.5 ${className}`.trim()} {...base}>
          <span aria-hidden="true" className="inline-grid h-[30px] w-[30px] place-items-center rounded-lg border border-gray-900 bg-gray-50 text-[18px] font-bold text-gray-900 dark:border-gray-100 dark:bg-gray-800 dark:text-gray-100">{TILE_GLYPH.refused}</span>
          <StateChip kind="refused" />
          <span className={WHY}>{[lead, text].filter(Boolean).join(' ')}</span>
          {accessRoute || null}
        </Root>
      );
    }
    return (
      <Root className={`inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] ${className}`.trim()} {...base}>
        <StateChip kind="refused" />
        <span className={WHY}>{[lead, text].filter(Boolean).join(' ')}</span>
        {accessRoute || null}
      </Root>
    );
  }

  // not_recorded and not_applicable: the chip and its reason as visible text.
  const word = children ?? STATE_WORDS[s];
  if (!reasonVisible || !reason) {
    if (size !== 'tile') {
      // The chip alone is the slot, so a page that reads the slot's first element reads the word.
      return <StateChip kind={s} label={word} className={className} title={!reasonVisible && reason ? reason : undefined} {...rest} />;
    }
  }
  const chip = <StateChip kind={s} label={word} />;
  if (size === 'tile') {
    return (
      <Root className={`flex flex-col items-start gap-1.5 ${className}`.trim()} {...base}>
        {s === 'not_recorded' ? <span aria-hidden="true" className="text-[26px] font-medium leading-[1.1] text-gray-600 dark:text-gray-400">{TILE_GLYPH.not_recorded}</span> : null}
        {chip}
        {reason && reasonVisible ? <span className={WHY}>{reason}</span> : null}
      </Root>
    );
  }
  return (
    <Root className={`inline-flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5 ${className}`.trim()} {...base}>
      {chip}
      {reason ? <span className={WHY}><span aria-hidden="true">· </span>{reason}</span> : null}
    </Root>
  );
}

/**
 * One banner above a block whose summary was built from several sources, at
 * least one not read (ST-03, ST-05). Drawn once per block, never as a chip on
 * every figure. `role="status"`: the page is still usable.
 *
 *   sources   [{ name, state }] — the sources NOT read ('unavailable' or 'refused');
 *             readable ones may be listed too and are ignored
 *   missing   how many were not read (defaults to the count in `sources`)
 *   of        how many sources the block reads
 *   rest      the sentence after ("The rest is current.")
 *   withheld  sentences for totals not shown ("Remaining is not shown while commitments cannot be read.")
 *   onRetry   Retry, only when an unavailable source is among them (a refusal is not retried)
 *   lead      the bold words in place of "N of M sources unavailable · …" where a surface counts
 *             its own things (Build's "5 of 6 modules read", D4846 part 2, #6032)
 */
export function PartialBanner({ missing, of, sources = [], rest, withheld = [], onRetry, lead: leadIn, className = '', ...rest2 }) {
  const counts = partialCounts(sources);
  const n = missing ?? counts.missing;
  const names = [...counts.unavailable, ...counts.refused].map((x) => x.name).filter(Boolean);
  const verb = counts.refused.length && !counts.unavailable.length ? 'refused' : counts.refused.length ? 'not read' : 'unavailable';
  const lead = leadIn ?? `${n}${of != null ? ` of ${of}` : ''} ${Number(of ?? n) === 1 ? 'source' : 'sources'} ${verb}${names.length ? ` · ${names.join(', ')}` : ''}.`;
  const canRetry = onRetry && (counts.unavailable.length > 0 || counts.missing === 0);
  const extra = Array.isArray(withheld) ? withheld : [withheld];
  return (
    <div role="status" className={`flex items-center gap-2.5 rounded-[9px] border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] leading-[1.45] text-gray-900 dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-gray-100 ${className}`.trim()} data-platform-state="partial" {...rest2}>
      <span className="text-amber-800 dark:text-amber-300">{GLYPHS.partial}</span>
      <span className="flex-1">
        <span className="sr-only">Partial: </span>
        <b>{lead}</b> {rest ?? 'The rest is current.'}
        {extra.filter(Boolean).map((w, i) => <span key={i}> {w}</span>)}
      </span>
      {canRetry ? <Retry onRetry={onRetry} /> : null}
    </div>
  );
}

const pad = (n) => String(n).padStart(2, '0');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "14:30 UTC" on the reference day, "31 Mar 2026 09:12 UTC" on another. Never a guessed time. */
function utcTime(ms, refMs) {
  const d = new Date(ms);
  const t = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
  const r = refMs == null ? null : new Date(refMs);
  const sameDay = r && r.getUTCFullYear() === d.getUTCFullYear() && r.getUTCMonth() === d.getUTCMonth() && r.getUTCDate() === d.getUTCDate();
  return sameDay ? t : `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()} ${t}`;
}

/**
 * The faint footer under a block (ST-06, D4858): when the read happened, when
 * the source last changed, and where it came from.
 *
 *   meta      an OperationalReadMeta (`status`, `read_at`, `source_updated_at`, `completeness_reason`, `source`)
 *   lastGood  a last-good time, where the store records one (#5247): draws Stale with its age
 *   stale     true to draw Stale without a recorded time ("age not recorded")
 *   onRetry   Retry, on an unavailable read
 */
export function ProvenanceLine({ meta, lastGood, stale = false, now, onRetry, className = '', ...rest }) {
  const m = meta || {};
  const nowMs = now ?? Date.now();
  const readMs = parseStamp(m.read_at);
  const srcMs = parseStamp(m.source_updated_at);
  const parts = [];
  const status = m.status;
  if (status === 'unavailable') parts.push(readMs != null ? `Tried ${utcTime(readMs, nowMs)}` : 'Read time not recorded');
  else parts.push(readMs != null ? `Read ${utcTime(readMs, nowMs)}` : 'Read time not recorded');
  if (status === 'unavailable') parts.push(<StateChip key="un" kind="unavailable" />);
  else if (lastGood != null || stale) {
    parts.push(<StateChip key="st" kind="stale" lastGood={lastGood ?? undefined} now={nowMs} />);
    const lg = parseStamp(lastGood);
    parts.push(lg != null ? `last good ${utcTime(lg, null).replace(/ \d\d:\d\d UTC$/, '')}` : 'this store records no last-good time');
  } else parts.push(srcMs != null ? `source last changed ${utcTime(srcMs, readMs ?? nowMs)}` : 'source time not recorded');
  if (status === 'partial') {
    parts.push(<StateChip key="pt" kind="partial" />);
    if (m.completeness_reason) parts.push(m.completeness_reason);
  }
  if (m.source) parts.push(`from ${m.source}`);
  const out = [];
  parts.forEach((p, i) => {
    if (i) out.push(<span key={`s${i}`} aria-hidden="true">·</span>);
    out.push(typeof p === 'string' ? <span key={`p${i}`}>{p}</span> : p);
  });
  return (
    <div className={`flex flex-wrap items-center gap-1.5 font-mono text-[11.5px] text-gray-600 dark:text-gray-400 ${className}`.trim()} data-provenance="" {...rest}>
      {out}
      {status === 'unavailable' && onRetry ? <Retry onRetry={onRetry} /> : null}
    </div>
  );
}

/**
 * A value the store does not have — `DataState state="not_recorded"`, kept
 * under its old name for its importers, drawn as the Not recorded chip.
 *
 * `reason` is the server's own explanation, where it sends one — the
 * `unavailable` map on the HQ and licence endpoints. Here it stays on the
 * chip's title, as before the redraw, because many call sites already print
 * it beside the chip; `reasonVisible` draws it as text instead, which is what
 * a redesigned surface passes (or it uses `DataState` directly). `children`
 * overrides the words for the cases that are not literally "not recorded"
 * ("Not yet measured").
 */
export function Unrecorded({ children = 'Not recorded', reason, reasonVisible = false, size }) {
  return <DataState state="not_recorded" reason={reason} reasonVisible={reasonVisible} size={size}>{children}</DataState>;
}

/**
 * A read that failed — `DataState state="unavailable"`, kept under its code
 * name for its importers. The screen says "Unavailable" (Q2 = A).
 *
 * `claim` is the sentence that says what this is NOT evidence of, and it
 * differs by zone — an unreadable licence list is not a claim that no
 * licences exist; an unreadable audit feed is not a claim that nothing
 * happened. It is a required prop rather than a default because the generic
 * version is the one that reads as boilerplate and gets skipped. The words it
 * draws, after the chip, are the same sentence as before the redraw. It stays
 * `role="alert"` on first load (`announce="always"`), as it shipped; a redesigned
 * surface passes `announce="after-action"` for ST-09's quieter rule.
 */
export function Unreadable({ what, claim, onRetry, size, announce = 'always' }) {
  return <DataState state="unavailable" what={what} claim={claim} onRetry={onRetry} size={size} announce={announce} as={size === 'block' || size === 'tile' ? undefined : 'p'} />;
}
