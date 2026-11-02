import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import {
  CHANGED_LINE, GONE_LINE, REFRESH_FROM_RECORDS, REFRESH_FROM_UPDATE, REFRESH_HELD, UPDATE_HELD, UPDATE_NONE, UPDATE_SAME,
  cardHasUpdateSlot, figureCard, updateForCard, updateLine,
} from './figuresModel';

/**
 * D1604 (#3716, pd6, pd24) — a live figure's two lines of explanation in the
 * editor, drawn under the card and never on Present, share or print:
 *
 *   FigureCard     the hover card for the figure area the pointer or the
 *                  keyboard is on (or the one selected): the record, as of
 *                  and the grade, "Open the record ›", "Not recorded" with
 *                  "Add in … ›", what changed in the store, and the
 *                  Projection label's footnote
 *   ChangedNotice  pd6's card line, "A figure on this card has changed in
 *                  its store.", each figure's value then and now, and
 *                  Refresh from records, which moves every stale figure on
 *                  the card to its store's snapshot (held until a version is
 *                  saved, like every other edit)
 *
 *   UpdateRefresh  D1584 (#3831): Refresh from the latest update, beside
 *                  Refresh from records. It reads the Worker's proposal for
 *                  the card's tiles bound to an update's figures, shows each
 *                  value then and now with its source and grade, and places
 *                  them on Accept (held until a version is saved). Discard
 *                  drops the proposal; nothing was saved by the read.
 *
 * It sits outside the area buttons, so nothing interactive is nested in one.
 */

const MUTED = 'text-[12px] leading-[1.45] text-axal-muted dark:text-gray-400';
const INK = 'text-axal-ink dark:text-gray-100';
const LINK = 'text-[12px] font-bold text-axal-violet hover:underline dark:text-violet-300';
const BTN = 'inline-flex min-h-[36px] items-center justify-center gap-2 whitespace-nowrap rounded-[9px] px-3.5 text-[12.5px] font-bold';
const GHOST = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;

function To({ link, testId }) {
  if (!link?.href) return null;
  return /^https?:/i.test(link.href)
    ? <a href={link.href} className={LINK} data-testid={testId}>{link.text}</a>
    : <Link to={link.href} className={LINK} data-testid={testId}>{link.text}</Link>;
}

export function FigureCard({ block, items, charts, today }) {
  const c = figureCard(block, items, charts, today);
  if (!c) return null;
  return (
    <div className="flex flex-col gap-1 rounded-[10px] border border-axal-hairline bg-white px-3 py-2 shadow-sm dark:border-gray-700 dark:bg-gray-900" role="note"
      aria-label={`${c.title}: where it comes from`} data-testid="pitch-figure-card">
      <span className={`text-[12.5px] font-bold ${INK}`}>{c.title}</span>
      {c.lines.map((l) => <span key={l} className={MUTED} data-testid="pitch-figure-card-line">{l}</span>)}
      {c.missing ? (
        <span className="flex flex-wrap items-center gap-2">
          <span className={`${MUTED} italic`} data-testid="pitch-figure-card-missing">{c.missing.text}</span>
          <To link={c.missing.link} testId="pitch-figure-card-add" />
        </span>
      ) : null}
      {c.changed.map((x) => (
        <span key={`${x.blockId}-${x.at}`} className={MUTED} data-testid="pitch-figure-card-changed">
          {x.state === 'gone' ? `${x.label}: ${GONE_LINE}` : x.now != null
            ? <>{x.label}: <s>{x.was}</s> → <b className={INK}>{x.now}</b></>
            : `${x.label}: a newer snapshot is recorded.`}
        </span>
      ))}
      {c.projection ? <span className={`${MUTED} italic`} data-testid="pitch-figure-card-projection">{c.projection.label} · {c.projection.note}</span> : null}
      <To link={c.link} testId="pitch-figure-card-open" />
    </div>
  );
}

export function ChangedNotice({ changed, readOnly = false, onRefresh }) {
  if (!changed?.length) return null;
  const canRefresh = !readOnly && changed.some((x) => x.state === 'stale');
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-amber-300 bg-amber-50 px-3 py-2 dark:border-amber-700 dark:bg-amber-950/40" role="status" data-testid="pitch-figure-changed">
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[12.5px] font-bold text-amber-900 dark:text-amber-200">{CHANGED_LINE}</span>
        {changed.map((x) => (
          <span key={`${x.blockId}-${x.at}`} className="text-[12px] text-amber-900 dark:text-amber-200">
            {x.state === 'gone' ? `${x.label}: ${GONE_LINE}` : x.now != null
              ? <>{x.label}: <s>{x.was}</s> → <b>{x.now}</b></>
              : `${x.label}: a newer snapshot is recorded.`}
          </span>
        ))}
        {canRefresh ? <span className="text-[11.5px] text-amber-800 dark:text-amber-300">{REFRESH_HELD}</span> : null}
      </span>
      {canRefresh ? (
        <button type="button" className={GHOST} onClick={onRefresh} data-testid="pitch-figure-refresh">
          <RefreshCw size={14} aria-hidden="true" /> {REFRESH_FROM_RECORDS}
        </button>
      ) : null}
    </div>
  );
}

const PRIMARY = `${BTN} bg-axal-violet text-white hover:bg-axal-violet-deep`;

/**
 * `derive()` resolves to the Worker's answer (or rejects); `onAccept(proposals)`
 * places them. Drawn only where the card holds a tile an update reports, and
 * never while read-only.
 */
export function UpdateRefresh({ card, cardIndex, readOnly = false, derive, onAccept }) {
  const [state, setState] = useState({ status: 'idle', data: null });
  if (readOnly || !derive || !cardHasUpdateSlot(card)) return null;
  const read = () => {
    setState({ status: 'loading', data: null });
    Promise.resolve().then(derive).then(
      (data) => setState({ status: 'ready', data }),
      () => setState({ status: 'error', data: null }),
    );
  };
  const close = () => setState({ status: 'idle', data: null });
  if (state.status === 'idle' || state.status === 'loading') {
    return (
      <div className="flex justify-end">
        <button type="button" className={GHOST} onClick={read} disabled={state.status === 'loading'} aria-busy={state.status === 'loading'} data-testid="pitch-update-refresh">
          <RefreshCw size={14} aria-hidden="true" /> {state.status === 'loading' ? 'Reading the latest update…' : REFRESH_FROM_UPDATE}
        </button>
      </div>
    );
  }
  const box = 'flex flex-col gap-1.5 rounded-[10px] border border-axal-hairline bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-900';
  if (state.status === 'error') {
    return (
      <div className={box} role="status" data-testid="pitch-update-error">
        <span className={MUTED}>The latest update could not be read. Nothing on the card changed.</span>
        <span className="flex gap-2">
          <button type="button" className={GHOST} onClick={read} data-testid="pitch-update-retry">Try again</button>
          <button type="button" className={GHOST} onClick={close}>Close</button>
        </span>
      </div>
    );
  }
  const d = state.data || {};
  const { proposals, missing } = updateForCard(d, cardIndex);
  const empty = !d.update ? (d.reason || 'No investor update has been sent yet.') : !proposals.length ? (missing.length ? UPDATE_NONE : UPDATE_SAME) : null;
  return (
    <div className={box} role="region" aria-label={REFRESH_FROM_UPDATE} data-testid="pitch-update-proposal">
      <span className={`text-[12.5px] font-bold ${INK}`}>{REFRESH_FROM_UPDATE}</span>
      {empty ? <span className={MUTED} data-testid="pitch-update-empty">{empty}</span> : null}
      {proposals.map((p) => (
        <span key={p.block_id} className="flex flex-col" data-testid="pitch-update-row">
          <span className={`text-[12px] ${INK}`}>{p.label}: {p.was ? <><s>{p.was}</s> → </> : null}<b>{p.now}</b></span>
          <span className={MUTED}>{updateLine(d.update, p)}</span>
        </span>
      ))}
      {missing.map((m) => <span key={m.block_id} className={`${MUTED} italic`} data-testid="pitch-update-missing">{m.label}: {m.reason}</span>)}
      {proposals.length ? <span className="text-[11.5px] text-axal-muted dark:text-gray-400">{UPDATE_HELD}</span> : null}
      <span className="flex gap-2">
        {proposals.length ? <button type="button" className={PRIMARY} onClick={() => { onAccept?.(proposals); close(); }} data-testid="pitch-update-accept">Accept</button> : null}
        <button type="button" className={GHOST} onClick={close} data-testid="pitch-update-discard">{proposals.length ? 'Discard' : 'Close'}</button>
      </span>
    </div>
  );
}

