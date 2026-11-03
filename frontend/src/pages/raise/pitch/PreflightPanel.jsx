import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import Sheet from '../../../ui/Sheet.jsx';
import { BlockGrid } from './BlockGrid';
import { cardColours } from './editorModel';
import { SLIDE_SIZES, aspectOf } from './gridModel';
import { measureBlocks } from './preflightMeasure';
import { deckAssistApi } from '../../../lib/api/deckAssist';
import { ADD_TOKENS_PATH } from '../../../lib/aiTokens';
import { reportError } from '../../../lib/log';
import { railPressHeaders } from '../../../lib/railPage';
import { refusalOf } from './newDeckModel';
import {
  ADD_TOKENS, ASK_FIX, BUILD, DIRTY_LINE, DISMISS, FIX_FIRST, FIX_WAITING, FREE_LINE, GROUPS, GROUP_NOTES, HELD_HERE, KEEP_EDITING, LATER,
  NOTHING_TO_FIX, NOT_A_PASS, NOT_KEPT, OUT_OF_DATE, READER_LINE, RECHECK, RECHECK_NOW, SHOW_ME, STALE_LINE, TITLE, TOKENS_OUT, TRY_AGAIN, UNDO,
  canAskFix, chargedLine, checkingLine, countsLine, fixBody, fixedLine, fixedSince, holdLine, notYet, passedLine, percent, slideState, stepOf,
  subLine, uncheckedBanner,
} from './preflightUiModel';

/**
 * D1370 (#3661, PF1–PF5) — "Check before you send": the results panel (a
 * 480px right Sheet, the full-height page below 640px), the gate before
 * Share and Export, the strip "Show me" leaves above the slide, and the
 * off-screen page each slide is measured on. The words are
 * `preflightUiModel.js`'s; the checks are `preflightModel.js`'s; the run is
 * `usePreflight.js`'s.
 *
 * Nothing here changes a slide. "Show me" selects the card and the block;
 * Dismiss (warnings only) is kept for the version (D4208); "Ask Eadwyn to
 * suggest a fix" (D4210, text checks only) shows its hold from the quote,
 * runs D899's card tool, and opens Ask, where the suggestion waits until
 * Accept places it. Out of tokens it reads "Not enough AI tokens · Add
 * tokens". A reader sees the findings with neither (pf5d).
 */

const BTN = 'inline-flex min-h-[36px] items-center justify-center gap-1.5 whitespace-nowrap rounded-[9px] px-3 text-[12.5px] font-bold max-sm:min-h-[44px]';
const GHOST = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const PRIMARY = `${BTN} bg-violet-600 text-white hover:bg-violet-700 dark:bg-violet-500 dark:hover:bg-violet-400`;
const OFF = `${BTN} cursor-not-allowed border border-dashed border-axal-hairline bg-white text-axal-muted dark:border-gray-700 dark:bg-gray-900 dark:text-gray-500`;
const EYE = 'font-mono text-[10px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const MUTED = 'text-[12.5px] leading-[1.45] text-axal-muted dark:text-gray-400';
const INK = 'text-axal-ink dark:text-gray-100';
const BOX = 'rounded-[12px] border border-axal-hairline bg-white p-3 dark:border-gray-700 dark:bg-gray-900';
const FIX_OPTION = 'deck:shorten';

const TONE = {
  fix: 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200',
  look: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
  unchecked: 'border-axal-hairline bg-axal-ground text-axal-ink dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100',
};

function Count({ n, word, tone, testId }) {
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12px] font-bold ${TONE[tone]}`} data-testid={testId}>{n} {word}</span>;
}

/**
 * pf2 / pf2b / pf5e: "Ask Eadwyn to suggest a fix" on one finding. Its quote
 * gives the hold line; Run makes one proposal (D899's card tool, `tool:
 * 'preflight_fix'`), which waits in Ask: nothing is placed until Accept.
 */
function FixAction({ fix, testId }) {
  const { deckId, card, body, tokensOut, onTokens, onProposals, onOpenAsk } = fix;
  const [quote, setQuote] = useState(null);
  const [state, setState] = useState({ kind: 'idle' });
  useEffect(() => {
    if (tokensOut) return undefined;
    let live = true;
    Promise.resolve(deckAssistApi.quote(deckId, card, body)).then(
      (q) => { if (live) setQuote(q || null); },
      (e) => {
        const refusal = refusalOf(e);
        if (refusal?.topUp) onTokens?.();
        if (live) setState({ kind: 'refused', refusal });
      },
    );
    return () => { live = false; };
  }, [deckId, card, tokensOut]); // eslint-disable-line react-hooks/exhaustive-deps
  // Out of tokens is the editor's (`onTokens` from a 402 here or on any other press), so every row says it at once.
  if (tokensOut) {
    return (
      <span className="flex flex-wrap items-center gap-1.5 text-[12px] font-bold text-axal-muted dark:text-gray-400" role="status" data-testid={`${testId}-tokens`}>
        {TOKENS_OUT} · <a className="text-violet-700 underline dark:text-violet-300" href={ADD_TOKENS_PATH}>{ADD_TOKENS}</a>
      </span>
    );
  }
  const run = () => {
    if (!quote || quote.ai === false || state.kind === 'running') return;
    setState({ kind: 'running' });
    Promise.resolve(deckAssistApi.run(deckId, card, body, railPressHeaders(FIX_OPTION))).then(
      (r) => {
        if (!r?.proposal?.uid) { setState({ kind: 'refused', refusal: { message: 'Eadwyn returned nothing to suggest. Nothing was charged for a proposal.' } }); return; }
        setState({ kind: 'done', charged: chargedLine(r.cost?.charged_microusd, quote.hold_microusd) });
        onProposals?.();
        onOpenAsk?.();
      },
      (e) => {
        const refusal = refusalOf(e);
        if (refusal?.topUp) onTokens?.();
        setState({ kind: 'refused', refusal });
        reportError('pitch-preflight:fix', e);
      },
    );
  };
  if (state.kind === 'done') {
    return (
      <span className="flex flex-col gap-0.5" role="status" data-testid={`${testId}-waiting`}>
        <span className={`text-[12.5px] font-bold ${INK}`}>{FIX_WAITING}</span>
        {state.charged ? <span className="font-mono text-[10.5px] font-bold text-violet-700 dark:text-violet-300" data-testid={`${testId}-charged`}>{state.charged}</span> : null}
      </span>
    );
  }
  return (
    <span className="flex flex-col gap-0.5">
      <button type="button" className={GHOST} onClick={run} aria-disabled={!quote || quote.ai === false || state.kind === 'running' || undefined} data-testid={`${testId}-ask`}>
        {state.kind === 'running' ? 'Asking Eadwyn…' : ASK_FIX}
      </button>
      <span className="font-mono text-[10.5px] font-bold text-violet-700 dark:text-violet-300" data-testid={`${testId}-hold`}>{holdLine(quote)}</span>
      {state.kind === 'refused' && state.refusal?.message ? <span role="alert" className="text-[12px] font-semibold text-rose-700 dark:text-rose-300" data-testid={`${testId}-refused`}>{state.refusal.message}</span> : null}
    </span>
  );
}

/** One finding (pf2): the slide number, where, the defect, why it matters, and its actions. */
function FindingRow({ row, n, stale = false, readOnly = false, compact = false, fix = null, onShow, onDismiss, testId }) {
  const askable = !readOnly && Boolean(fix);
  return (
    <li className={`${BOX} flex gap-3`} aria-label={row.label} data-testid={testId}>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-axal-ground font-mono text-[12px] font-bold text-axal-ink dark:bg-gray-800 dark:text-gray-100" aria-hidden="true">{row.slide ?? '—'}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-1.5">
          {n != null ? <span className="font-mono text-[10.5px] font-bold text-axal-muted dark:text-gray-400" aria-hidden="true">{n}</span> : null}
          <span className={EYE}>{row.where}</span>
          {stale ? <span className="rounded-full bg-axal-ground px-1.5 py-0.5 text-[10px] font-bold text-axal-muted dark:bg-gray-800 dark:text-gray-400" data-testid={`${testId}-stale`}>{OUT_OF_DATE}</span> : null}
        </span>
        <span className={`text-[13px] font-bold leading-snug ${INK}`}>{row.headline}</span>
        {!compact && row.detail ? <span className={MUTED}>{row.detail}</span> : null}
        {!compact && row.fix ? <span className={MUTED}>{row.fix}</span> : null}
        <span className="mt-1 flex flex-wrap items-center gap-1.5">
          {onShow && (row.card != null || row.firstCard != null) ? <button type="button" className={GHOST} onClick={() => onShow(row)} data-testid={`${testId}-show`}>{SHOW_ME}</button> : null}
          {!compact && onDismiss && row.dismissible && !readOnly ? <button type="button" className={GHOST} onClick={() => onDismiss(row)} data-testid={`${testId}-dismiss`}>{DISMISS}</button> : null}
          {!compact && askable && BUILD.P2.live && !stale ? <FixAction fix={fix} testId={testId} /> : null}
          {!compact && askable && !BUILD.P2.live ? (
            <button type="button" className={OFF} aria-disabled="true" title={notYet()} data-testid={`${testId}-ask`}>
              {ASK_FIX}<span className="font-mono text-[10px] font-normal">{LATER}</span>
            </button>
          ) : null}
        </span>
      </span>
    </li>
  );
}

function Group({ title, note, count, tag = null, children, testId }) {
  return (
    <section className="flex flex-col gap-2" aria-label={title} data-testid={testId}>
      <span className="flex flex-wrap items-baseline gap-2">
        <span className={`text-[13px] font-extrabold ${INK}`}>{title}</span>
        <span className="font-mono text-[11px] font-bold text-axal-muted dark:text-gray-400">{count}</span>
        {tag ? <span className="rounded-full bg-axal-ground px-1.5 py-0.5 text-[10px] font-bold text-axal-muted dark:bg-gray-800 dark:text-gray-400">{tag}</span> : null}
        {note ? <span className={MUTED}>{note}</span> : null}
      </span>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">{children}</ul>
    </section>
  );
}

/** pf5a: a slide at a time, with the slides listed. */
function Checking({ progress, testId = 'pitch-preflight-checking' }) {
  const { done, total } = progress;
  const p = percent(done, total);
  return (
    <div className="flex flex-col gap-3" data-testid={testId}>
      <span className={`text-[13px] font-bold ${INK}`} role="status">{checkingLine(done, total)}</span>
      <div className="h-2 w-full overflow-hidden rounded-full bg-axal-ground dark:bg-gray-800" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p} aria-label={checkingLine(done, total)}>
        <div className="h-full bg-violet-600 dark:bg-violet-400" style={{ width: `${p}%` }} />
      </div>
      <ul className="m-0 grid list-none grid-cols-2 gap-1 p-0">
        {Array.from({ length: total }, (_, i) => (
          <li key={i} className="flex justify-between gap-2 text-[12px]"><span className={INK}>Slide {i + 1}</span><span className="text-axal-muted dark:text-gray-400">{slideState(i, done)}</span></li>
        ))}
      </ul>
      <span className={MUTED}>{KEEP_EDITING}</span>
    </div>
  );
}

/**
 * The results panel (PF2, PF4, PF5). `pf` is `usePreflight()`'s; `onShow(row)`
 * selects the finding's card and block and closes the panel.
 */
export function PreflightPanel({ pf, version, readOnly = false, deckId = null, tokensOut = false, onTokens, onProposals, onOpenAsk, onShow, onClose }) {
  const [openPassed, setOpenPassed] = useState(false);
  const [lastDismissed, setLastDismissed] = useState(null);
  const g = pf.groups;
  const slides = (pf.snapshot || {}).slides?.length ?? 0;
  const stale = Boolean(g) && !pf.current;
  const sub = subLine({ version, at: pf.at, slides: pf.running ? pf.progress.total : slides, current: !stale, running: Boolean(pf.running) });
  const fixed = fixedLine(fixedSince(pf.previous, g));
  const banner = uncheckedBanner(g);
  const nothing = g && !g.fix.length && !g.look.length && !g.unchecked.length;
  const dismiss = (row) => { pf.dismiss(row.id, row.severity); setLastDismissed(row); };
  // D4210: a text finding on one text block can ask for a fix, on the slides as they were checked.
  const fixOf = (row) => {
    if (deckId == null) return null;
    const block = ((pf.snapshot?.slides || [])[row.card]?.blocks || []).find((b) => b?.id === row.block) || null;
    return canAskFix(row, block) ? { deckId, card: row.card, body: fixBody(row, block), tokensOut, onTokens, onProposals, onOpenAsk } : null;
  };
  const recheck = !readOnly && !pf.running ? <button type="button" className={GHOST} onClick={pf.run} data-testid="pitch-preflight-recheck">{RECHECK}</button> : null;

  return (
    <Sheet label={TITLE} title={TITLE} eyebrow="Before you send" sub={sub} width={480} onClose={onClose} testId="pitch-preflight" headerActions={recheck}>
      <div className="flex flex-col gap-4">
        {pf.running ? <Checking progress={pf.progress} /> : null}
        {!pf.running && !g ? <span className={MUTED} role="status" data-testid="pitch-preflight-none">Not checked yet.</span> : null}
        {!pf.running && g ? (
          <>
            {readOnly ? <p className={`${BOX} m-0 ${MUTED}`} data-testid="pitch-preflight-reader">{READER_LINE}</p> : null}
            {stale ? (
              <div className={`${BOX} flex flex-wrap items-center justify-between gap-2`} role="status" data-testid="pitch-preflight-stale">
                <span className={`text-[12.5px] font-bold ${INK}`}>{STALE_LINE}</span>
                {!readOnly ? <button type="button" className={PRIMARY} onClick={pf.run} data-testid="pitch-preflight-recheck-now">{RECHECK_NOW}</button> : null}
              </div>
            ) : null}
            {fixed ? <span className="text-[12.5px] font-bold text-emerald-700 dark:text-emerald-300" role="status" data-testid="pitch-preflight-fixed">✓ {fixed}</span> : null}
            {banner ? (
              <div className={`${BOX} flex flex-wrap items-center justify-between gap-2`} data-testid="pitch-preflight-unchecked-banner">
                <span className={`text-[12.5px] ${INK}`}>{banner}</span>
                {!readOnly ? <button type="button" className={GHOST} onClick={pf.run}>{TRY_AGAIN}</button> : null}
              </div>
            ) : null}
            {nothing ? (
              <div className="flex flex-col gap-1" data-testid="pitch-preflight-nothing">
                <span className="text-[15px] font-extrabold text-emerald-700 dark:text-emerald-300">✓ {NOTHING_TO_FIX}</span>
                <span className={MUTED}>{passedLine(g.passed.length, slides)}</span>
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5" role="status" aria-label={countsLine({ fix: g.fix.length, look: g.look.length, unchecked: g.unchecked.length })} data-testid="pitch-preflight-counts">
                {g.fix.length ? <Count n={g.fix.length} word="to fix" tone="fix" testId="pitch-preflight-count-fix" /> : null}
                {g.look.length ? <Count n={g.look.length} word="to look at" tone="look" testId="pitch-preflight-count-look" /> : null}
                {g.unchecked.length ? <Count n={g.unchecked.length} word="couldn’t check" tone="unchecked" testId="pitch-preflight-count-unchecked" /> : null}
              </div>
            )}
            {g.fix.length ? (
              <Group title={GROUPS.fix} note={GROUP_NOTES.fix} count={g.fix.length} testId="pitch-preflight-fix">
                {g.fix.map((r, i) => <FindingRow key={r.id} row={r} n={i + 1} stale={stale} readOnly={readOnly} fix={fixOf(r)} onShow={onShow} testId={`pitch-preflight-row-${r.id}`} />)}
              </Group>
            ) : null}
            {lastDismissed && pf.dismissed.has(lastDismissed.id) ? (
              <div className={`${BOX} flex flex-wrap items-center justify-between gap-2`} role="status" data-testid="pitch-preflight-dismissed">
                <span className={`text-[12.5px] ${INK}`}>Dismissed · {lastDismissed.where} · {lastDismissed.headline}</span>
                <button type="button" className={GHOST} onClick={() => { pf.undismiss(lastDismissed.id); setLastDismissed(null); }} data-testid="pitch-preflight-undo">{UNDO}</button>
              </div>
            ) : null}
            {g.look.length ? (
              <Group title={GROUPS.look} note={readOnly ? null : GROUP_NOTES.look} count={g.look.length} testId="pitch-preflight-look">
                {g.look.map((r, i) => <FindingRow key={r.id} row={r} n={g.fix.length + i + 1} stale={stale} readOnly={readOnly} fix={fixOf(r)} onShow={onShow} onDismiss={dismiss} testId={`pitch-preflight-row-${r.id}`} />)}
              </Group>
            ) : null}
            {pf.notKept ? <span role="alert" className="text-[12.5px] font-semibold text-rose-700 dark:text-rose-300" data-testid="pitch-preflight-not-kept">{NOT_KEPT}</span> : null}
            {g.dismissed > 0 ? (
              <span className={MUTED} data-testid="pitch-preflight-dismissed-count">{g.dismissed} dismissed{BUILD.P1.live ? '' : ` · ${HELD_HERE}`}</span>
            ) : null}
            {g.unchecked.length ? (
              <Group title={GROUPS.unchecked} count={g.unchecked.length} tag={NOT_A_PASS} testId="pitch-preflight-unchecked">
                {g.unchecked.map((r) => <FindingRow key={r.id} row={{ ...r, dismissible: false }} stale={stale} readOnly compact={false} onShow={onShow} testId={`pitch-preflight-row-${r.id.replace(':', '-')}`} />)}
              </Group>
            ) : null}
            {g.passed.length ? (
              <section className="flex flex-col gap-1.5" data-testid="pitch-preflight-passed">
                <button type="button" className="self-start text-[12.5px] font-bold text-emerald-700 dark:text-emerald-300" aria-expanded={nothing || openPassed}
                  onClick={() => setOpenPassed((o) => !o)} data-testid="pitch-preflight-passed-toggle">
                  ✓ {GROUPS.passed} · {g.passed.length} {g.passed.length === 1 ? 'check' : 'checks'} {nothing || openPassed ? '▾' : '▸'}
                </button>
                {nothing || openPassed ? (
                  <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                    {g.passed.map((l) => <li key={l} className={`text-[12.5px] ${INK}`}>✓ {l}</li>)}
                  </ul>
                ) : null}
              </section>
            ) : null}
          </>
        ) : null}
        <span className={MUTED} data-testid="pitch-preflight-free">{FREE_LINE}</span>
      </div>
    </Sheet>
  );
}

/**
 * The gate before Share and Export (pf1c, pf1d): what is to fix, and the
 * warnings left. `gate` is `gateOf()`'s; "Send anyway" / "Export anyway" is
 * there only with nothing to fix.
 */
export function PreflightGate({ gate, progress = null, version, dirty = false, onShow, onFix, onAnyway, onClose }) {
  const [openLook, setOpenLook] = useState(false);
  const title = gate?.title || (gate?.kind === 'share' ? 'Before you share' : 'Before you export');
  const footer = progress ? null : (
    <div className="flex flex-wrap justify-end gap-2">
      {gate?.anyway ? <button type="button" className={GHOST} onClick={onAnyway} data-testid="pitch-preflight-gate-anyway">{gate.anyway}</button> : null}
      <button type="button" className={PRIMARY} onClick={onFix} data-testid="pitch-preflight-gate-fix">{FIX_FIRST}</button>
    </div>
  );
  const showLook = gate && (!gate.fix.length || openLook);
  return (
    <Sheet label={title} title={title} eyebrow={TITLE} sub={version != null ? `v${version}` : undefined} width={480} onClose={onClose} footer={footer} testId="pitch-preflight-gate">
      <div className="flex flex-col gap-3">
        {progress ? <Checking progress={progress} testId="pitch-preflight-gate-checking" /> : null}
        {!progress && gate ? (
          <>
            {gate.fix.length ? (
              <Group title="To fix first" count={gate.fix.length} testId="pitch-preflight-gate-fix-list">
                {gate.fix.map((r) => <FindingRow key={r.id} row={r} compact onShow={onShow} testId={`pitch-preflight-gate-row-${r.id}`} />)}
              </Group>
            ) : <span className="text-[14px] font-extrabold text-emerald-700 dark:text-emerald-300" data-testid="pitch-preflight-gate-nothing">✓ {NOTHING_TO_FIX}</span>}
            {gate.look.length && gate.fix.length ? (
              <button type="button" className={`self-start text-[12.5px] font-bold ${INK}`} aria-expanded={openLook} onClick={() => setOpenLook((o) => !o)} data-testid="pitch-preflight-gate-look-toggle">
                {gate.look.length} worth a look {openLook ? '▾' : '▸'}
              </button>
            ) : null}
            {gate.look.length && showLook ? (
              <Group title={GROUPS.look} note={GROUP_NOTES.lookGate} count={gate.look.length} testId="pitch-preflight-gate-look">
                {gate.look.map((r) => <FindingRow key={r.id} row={r} compact onShow={onShow} testId={`pitch-preflight-gate-row-${r.id}`} />)}
              </Group>
            ) : null}
            {gate.waitLine ? <span className={MUTED} data-testid="pitch-preflight-gate-wait">{gate.waitLine}</span> : null}
            {dirty ? <span className={MUTED} data-testid="pitch-preflight-gate-dirty">{DIRTY_LINE}</span> : null}
          </>
        ) : null}
      </div>
    </Sheet>
  );
}

/**
 * Where "Show me" leaves the founder (pf5g): the finding over the slide, with
 * Previous and Next through the findings and the way back to the panel.
 */
export function FindingStrip({ rows, id, onStep, onBack, onClose }) {
  const s = stepOf(rows, id);
  const row = rows[s.index];
  if (!row) return null;
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 rounded-[12px] border border-violet-200 bg-violet-50 px-3 py-2 dark:border-violet-900 dark:bg-violet-950/40" role="region" aria-label={s.line} data-testid="pitch-preflight-strip">
      <button type="button" className={GHOST} onClick={onBack} data-testid="pitch-preflight-strip-back"><ChevronLeft size={14} aria-hidden="true" />{TITLE}</button>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={EYE}>{s.line} · {row.where}</span>
        <span className={`truncate text-[12.5px] font-bold ${INK}`} aria-live="polite">{row.headline}</span>
      </span>
      <button type="button" className={GHOST} aria-disabled={!s.prev || undefined} onClick={() => s.prev && onStep(s.prev)} data-testid="pitch-preflight-strip-prev"><ChevronLeft size={14} aria-hidden="true" />Previous</button>
      <button type="button" className={GHOST} aria-disabled={!s.next || undefined} onClick={() => s.next && onStep(s.next)} data-testid="pitch-preflight-strip-next">Next<ChevronRight size={14} aria-hidden="true" /></button>
      <button type="button" className={GHOST} aria-label="Close the finding" onClick={onClose} data-testid="pitch-preflight-strip-close">×</button>
    </div>
  );
}

const str = (v) => String(v ?? '').trim();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** Images still loading, waited on for at most `ms`: one that never loads is left unmeasured. */
async function imagesReady(el, ms = 2000) {
  const imgs = typeof el.querySelectorAll === 'function' ? [...el.querySelectorAll('img')] : [];
  const end = Date.now() + ms;
  while (imgs.some((i) => !i.complete) && Date.now() < end) await wait(50);
}

/**
 * One slide drawn off screen at export size (1920 × 1080, or 1440 × 1080 at
 * 4:3), with `BlockGrid`'s print sizes, then measured. Hidden
 * (`visibility: hidden`, so nothing in it can take focus) and inert. A slide
 * with nothing to measure is done at once; a page that cannot lay it out (no
 * box) reports it failed: "Couldn't check", never a pass.
 */
export function PreflightMeasure({ card, index, theme, kit, onMeasured }) {
  const box = useRef(null);
  const report = useRef(onMeasured);
  report.current = onMeasured;
  const aspect = aspectOf(theme?.aspect);
  const size = SLIDE_SIZES[aspect] || { width: 1920, height: 1080 };
  const colours = cardColours(theme, kit);
  const blocks = Array.isArray(card?.blocks) ? card.blocks : [];
  useEffect(() => {
    let live = true;
    (async () => {
      await wait(0);
      const needs = blocks.some((b) => (b?.kind === 'text' && str(b.text)) || (b?.kind === 'image' && str(b.image_url)));
      const el = box.current;
      if (!needs) { if (live) report.current?.(index, {}, false); return; }
      if (!el || !(el.clientWidth > 0) || !(el.clientHeight > 0)) { if (live) report.current?.(index, {}, true); return; }
      await imagesReady(el);
      try { await Promise.race([globalThis.document?.fonts?.ready, wait(1500)]); } catch { /* fonts not ready: measure anyway */ }
      if (!live) return;
      const grid = el.querySelector('[data-testid="pitch-preflight-measure-grid"]');
      const cells = grid ? [...grid.children] : [];
      const m = measureBlocks(blocks.map((b, j) => ({ card: index, block: String(b.id), el: cells[j] || null })), globalThis.getComputedStyle);
      report.current?.(index, m, false);
    })();
    return () => { live = false; };
  }, [index]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div aria-hidden="true" inert style={{ position: 'fixed', left: -40000, top: 0, width: size.width, height: size.height, visibility: 'hidden', pointerEvents: 'none', overflow: 'hidden' }} data-testid="pitch-preflight-measure">
      <div ref={box} style={{ position: 'relative', width: '100%', height: '100%', background: card?.background?.color || colours.bg, color: colours.ink }}>
        <BlockGrid blocks={blocks} colours={colours} live size="print" aspect={aspect} testId="pitch-preflight-measure-grid" />
      </div>
    </div>
  );
}

