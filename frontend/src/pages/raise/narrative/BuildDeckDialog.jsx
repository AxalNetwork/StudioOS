import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { api } from '../../../lib/api';
import { cyclesApi } from '../../../lib/api/cycles';
import { Lightbox, Unrecorded } from '../../../ui';
import { narrativeOutline } from '../pitch/deckV2Adapter.js';
import {
  NEWEST_ONLY, PRICE_LOADING, PRICE_NONE, READS, REFUSED_LINE, REFUSED_TITLE, UNREADABLE_LINE, UNREADABLE_TITLE,
  canContinue, outlineLine, outlineState, priceLine, readByChange, savesView, studioHref, versionDrift, versionLine,
} from './buildDeckModel';
import { SLUG, homePart } from './narrativeModel';

/**
 * D9104 (#9104, RAN24b) — the confirm before the hand-off to Pitch deck
 * studio: "Build a deck from v[n]". It reads the deck outline only
 * (`narrativeOutline({ projectId })`, no `run`), so nothing runs and nothing
 * is charged here, and the deck versions (`api.deckListVersions`) for the next
 * number and the version that stays current. It shows what the build reads,
 * the outline's cards and what it leaves out, what it saves (not current), the
 * outline's price and the Read by sentence. Continue opens New deck with
 * `from=narrative` (part 2 builds that start). The adapter's answer is mapped
 * in `buildDeckModel.js`: a 403 or a 404 is the refused state (RAN27d), any
 * other failure is RAN27c's sentence with Try again, never a zero price.
 * Focus opens on the title, stays inside, and goes back to `returnFocusTo`.
 */

const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-axal-muted dark:text-gray-400';
const EYEBROW = 'text-[10.5px] font-extrabold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const BTN = 'inline-flex min-h-[44px] items-center justify-center rounded-[9px] bg-axal-violet px-3.5 py-2 text-[12.5px] font-bold text-white hover:bg-axal-violet-deep disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-[36px]';
const GHOST = 'inline-flex min-h-[44px] items-center justify-center rounded-[9px] border border-axal-hairline bg-white px-3.5 py-2 text-[12.5px] font-bold text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800 sm:min-h-[36px]';
const NOT_CURRENT = 'inline-flex items-center rounded-full border border-dashed border-gray-400 px-1.5 text-[12px] font-extrabold text-axal-ink dark:border-gray-500 dark:text-gray-100';
const BAD = 'flex items-start gap-2.5 rounded-[10px] border border-red-200 bg-red-50 px-3 py-2.5 text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200';
const WARN = 'flex items-start gap-2.5 rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2.5 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200';

function Bar({ width = '60%' }) {
  return <span className="block h-3 animate-pulse rounded bg-axal-ground dark:bg-gray-800" style={{ width }} aria-hidden="true" data-testid="build-deck-skeleton" />;
}

function Row({ label, children, testId }) {
  return (
    <div className="grid grid-cols-1 gap-1 border-t border-axal-hairline py-2.5 first:border-t-0 sm:grid-cols-[170px_minmax(0,1fr)] sm:gap-3 dark:border-gray-800" data-testid={testId}>
      <dt className={`text-[12.5px] ${MUTED}`}>{label}</dt>
      <dd className={`m-0 text-[13px] font-semibold leading-relaxed ${INK}`}>{children}</dd>
    </div>
  );
}

/** What it saves, with "not current" drawn as a bordered chip, so it never relies on colour (RAN29). */
function NotCurrentLine({ line }) {
  const at = line.indexOf('not current');
  if (at < 0) return <span>{line}</span>;
  return <span>{line.slice(0, at)}<b className={NOT_CURRENT} data-testid="build-deck-not-current">not current</b>{line.slice(at + 'not current'.length)}</span>;
}

/** The newest row from the module read, when the caller has none (Story). */
function useNewestRow(projectId, version, given) {
  const [row, setRow] = useState(given || null);
  useEffect(() => {
    if (given || !projectId) return undefined;
    let alive = true;
    cyclesApi.module('raise', projectId, SLUG)
      .then((data) => { if (alive) setRow((homePart(data)?.versions || []).find((v) => Number(v.version) === Number(version)) || null); })
      .catch(() => {});
    return () => { alive = false; };
  }, [projectId, version, given]);
  return row;
}

export default function BuildDeckDialog({ projectId, version, row = null, revision = null, onClose, returnFocusTo }) {
  const navigate = useNavigate();
  const title = useRef(null);
  const [answer, setAnswer] = useState(null);
  const [decks, setDecks] = useState({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const newestRow = useNewestRow(projectId, version, row);

  useEffect(() => {
    let alive = true;
    setAnswer(null);
    // The outline only: no `run`, so no build, no hold and no charge.
    narrativeOutline({ projectId }).then((r) => { if (alive) setAnswer(r); });
    return () => { alive = false; };
  }, [projectId, attempt]);
  useEffect(() => {
    let alive = true;
    api.deckListVersions(projectId)
      .then((data) => { if (alive) setDecks({ status: 'ready', data }); })
      .catch(() => { if (alive) setDecks({ status: 'error' }); });
    return () => { alive = false; };
  }, [projectId, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const state = outlineState(answer);
  const saves = savesView(decks);
  const read = state.version ?? version;
  const drift = state.kind === 'ready' ? versionDrift(version, state.version) : null;
  const price = state.kind === 'ready' ? priceLine(state.outline) : null;
  const go = () => { onClose?.(); navigate(studioHref(projectId)); };

  const loading = state.kind === 'loading';
  const body = state.kind === 'refused' ? (
    <div role="alert" className="flex flex-col gap-1.5 rounded-[10px] border border-axal-hairline px-3 py-3 dark:border-gray-700" data-testid="build-deck-refused">
      <span className={`inline-flex w-fit items-center gap-1 rounded-full border border-axal-hairline px-2 py-0.5 text-[10.5px] font-bold ${MUTED} dark:border-gray-700`}><Lock size={11} aria-hidden="true" />Refused</span>
      <b className={`text-[14px] ${INK}`}>{REFUSED_TITLE}</b>
      <span className={`text-[12.5px] ${MUTED}`}>{REFUSED_LINE}</span>
    </div>
  ) : state.kind === 'unreadable' ? (
    <div role="alert" className={BAD} data-testid="build-deck-unreadable">
      <span aria-hidden="true" className="font-extrabold">✕</span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <b className="text-[13px]">{UNREADABLE_TITLE}</b>
        <span className="text-[12.5px]">{UNREADABLE_LINE}</span>
      </div>
      <button type="button" className={GHOST} onClick={retry} data-testid="build-deck-retry">Try again</button>
    </div>
  ) : state.kind === 'empty' ? (
    <div role="status" className="flex flex-col gap-1 rounded-[10px] border border-dashed border-axal-hairline px-3 py-3 dark:border-gray-700" data-testid={`build-deck-empty-${state.why}`}>
      <b className={`text-[13.5px] ${INK}`}>{state.line}</b>
      <span className={`text-[12.5px] ${MUTED}`}>Nothing was read into a deck and nothing was charged.</span>
    </div>
  ) : (
    <>
      {state.warning ? <p role="status" className={`${WARN} m-0 text-[12.5px]`} data-testid="build-deck-warning"><span aria-hidden="true" className="font-extrabold">!</span>{state.warning}</p> : null}
      {drift ? <p role="status" className={`${WARN} m-0 text-[12.5px]`} data-testid="build-deck-drift"><span aria-hidden="true" className="font-extrabold">!</span>{drift}</p> : null}
      <dl className="m-0 flex flex-col" aria-busy={loading || undefined} data-testid="build-deck-facts">
        <Row label="What it reads" testId="build-deck-reads">{READS(read)}</Row>
        <Row label="Outline" testId="build-deck-outline">{loading ? <Bar width="70%" /> : <span>{outlineLine(state.outline)}</span>}</Row>
        <Row label="What it saves" testId="build-deck-saves">
          {saves.kind === 'loading' ? <Bar width="80%" /> : (
            <NotCurrentLine line={saves.line} />
          )}
        </Row>
        <Row label="Price, from the outline" testId="build-deck-price">
          {loading ? <span className={MUTED}>{PRICE_LOADING}</span>
            : price ? <span><span className="font-mono">{price.split(' · ')[0]}</span>{price.slice(price.indexOf(' · '))}</span>
              : <span className="flex flex-wrap items-center gap-1.5"><Unrecorded /><span className={`text-[12px] font-normal ${MUTED}`}>{PRICE_NONE}</span></span>}
        </Row>
        <Row label="Read by" testId="build-deck-read-by">{readByChange(saves.next, read)}</Row>
      </dl>
    </>
  );

  return (
    <Lightbox label={`Build a deck from v${version}`} onClose={onClose} width={760} testId="build-deck-dialog" initialFocus={title} returnFocusTo={returnFocusTo}
      footer={(
        <div className="flex flex-col gap-2">
          <p className={`m-0 text-[12px] ${MUTED}`} data-testid="build-deck-foot">The studio names the version it read. {NEWEST_ONLY}</p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" className={GHOST} onClick={onClose} data-testid="build-deck-cancel">Cancel</button>
            <button type="button" className={BTN} disabled={!canContinue(state)} onClick={go} data-testid="build-deck-continue">Continue to Pitch deck studio</button>
          </div>
        </div>
      )}>
      <div className="flex flex-col gap-3 px-5 py-[18px]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <span className={EYEBROW}>Build a deck</span>
            <h2 ref={title} tabIndex={-1} className={`m-0 mt-0.5 text-[20px] font-extrabold tracking-[-.02em] outline-none ${INK}`} data-testid="build-deck-title">Build a deck from v{version}</h2>
            <p className={`m-0 mt-1 text-[12.5px] ${MUTED}`} data-testid="build-deck-version-line">{versionLine(version, newestRow, revision)}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" data-testid="build-deck-close"
            className="-mr-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[20px] leading-none text-axal-muted hover:bg-gray-100 hover:text-axal-ink dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100">×</button>
        </div>
        {body}
      </div>
    </Lightbox>
  );
}
