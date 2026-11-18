import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { deckFiguresApi } from '../../../lib/api/deckFigures.js';
import { deckCheckApi } from '../../../lib/api/deckCheck.js';
import { deckCommentsApi } from '../../../lib/api/deckComments.js';
import { deckEditorApi } from '../../../lib/api/deckEditor.js';
import { deckSourcesApi } from '../../../lib/api/deckSources.js';
import { reportError } from '../../../lib/log';
import usePreflight from './usePreflight';
import { PreflightMeasure } from './PreflightPanel';
import { mayRunCheck, refusalText } from './checkModel';
import {
  EXACT_LINE, NO_SCORE, STATUS, actionOf, cardHref, checkingLine, countPills, reviewOf,
} from './versionReviewModel';

/**
 * D6060 (#6060, Pitch Studio v2 build 6/9, PS-06 A and B) — Review of one
 * exact saved version, above the AI review (`PitchReview.jsx`, D900):
 * "Checking v7 · saved 8 Nov, 16:40", the counts by status, "No readiness
 * score", then the six groups `versionReviewModel.js` derives, each row with
 * its status, its card and Go to card (or Try again for what could not be
 * read or measured, Run the check for a version never checked).
 *
 * Every read is of the version the page names (`deck.id`): its figures
 * (D1523), the check's claims (D900), the freshness of its bound figures
 * (D896), its approvals (D1570) and the venture's brand kit. The preflight
 * (D1370) runs here on the saved version's own cards, each drawn off screen
 * at export size (`PreflightMeasure`); a card the page cannot draw is
 * "Couldn't check" with Try again, never a pass. It reads and measures only:
 * nothing on the version changes, and the founder's dismissals are read, not
 * written.
 */

const BTN = 'inline-flex min-h-[44px] items-center justify-center gap-1.5 whitespace-nowrap rounded-[8px] px-3 text-[12px] font-bold disabled:opacity-50 lg:min-h-[30px] lg:px-2.5';
const GHOST = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const CARD = 'rounded-[12px] border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';
const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-[12.5px] leading-[1.45] text-axal-muted dark:text-gray-400';
const EYE = 'font-mono text-[10px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const PILL = 'inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[10.5px] font-bold';
const TONE = {
  fix: 'border-red-200 bg-red-50 text-axal-destructive dark:border-red-900 dark:bg-red-950/40 dark:text-red-300',
  look: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300',
  unchecked: 'border-dashed border-gray-400 bg-white text-gray-700 dark:border-gray-500 dark:bg-gray-900 dark:text-gray-300',
  stale: 'border-orange-200 bg-orange-50 text-orange-800 dark:border-orange-900 dark:bg-orange-950/40 dark:text-orange-300',
  approval: 'border-violet-200 bg-violet-50 text-axal-violet dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300',
  qualitative: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300',
  passed: 'border-emerald-200 bg-emerald-50 text-axal-positive dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
  running: 'border-axal-hairline bg-axal-ground text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400',
};

/** One read of this version; a late answer for another version is dropped. `reload` reads it again from loading. */
function useRead(key, call) {
  const [state, setState] = useState({ status: key == null ? 'idle' : 'loading', data: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (key == null) { setState({ status: 'idle', data: null }); return undefined; }
    let live = true;
    setState({ status: 'loading', data: null });
    call().then((data) => { if (live) setState({ status: 'ok', data }); })
      .catch((e) => { if (live) setState({ status: 'error', data: null, error: e }); reportError('pitch-version-review:read', e); });
    return () => { live = false; };
  }, [key, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  return [state, useCallback(() => setTick((t) => t + 1), [])];
}

export function StatusPill({ status, label }) {
  return <span className={`${PILL} ${TONE[status] || TONE.running}`} data-status={status}>{label ?? STATUS[status]}</span>;
}

export default function VersionReview({ deck, version, projectId, readOnly }) {
  const deckId = deck?.id ?? null;
  const [figures, reloadFigures] = useRead(deckId, () => deckFiguresApi.list(deckId));
  const [check, reloadCheck] = useRead(deckId, () => deckCheckApi.read(deckId));
  const [refresh, reloadRefresh] = useRead(deckId, () => deckSourcesApi.refresh(deckId));
  const [approval, reloadApproval] = useRead(deckId, () => deckCommentsApi.approval(deckId));
  const [kit, reloadKit] = useRead(projectId, () => deckEditorApi.brandKit(projectId));
  const [checking, setChecking] = useState(false);
  const [checkFailed, setCheckFailed] = useState(null);

  // The preflight reads the saved version as it is: the kit's colours and the refresh rows, once both answered.
  const saved = useMemo(() => (deck ? { id: deck.id, version: deck.version ?? null, slides: Array.isArray(deck.slides) ? deck.slides : [], theme: deck.theme ?? null } : null), [deck]);
  const kitData = kit.status === 'ok' ? kit.data?.kit ?? null : null;
  const refreshData = refresh.status === 'ok' ? refresh.data : null;
  const pf = usePreflight({ deck: saved, kit: kitData, refresh: refreshData, readOnly: true });
  const settled = (r) => r.status === 'ok' || r.status === 'error' || r.status === 'idle';
  const ready = Boolean(saved) && settled(kit) && settled(refresh);
  useEffect(() => {
    if (!ready || pf.running || pf.current) return;
    pf.run();
  }, [ready, pf.running, pf.current]); // eslint-disable-line react-hooks/exhaustive-deps

  const pfView = pf.running
    ? { state: 'running', done: pf.running.done, total: pf.running.total }
    : pf.current && pf.groups
      ? { state: 'done', groups: pf.groups, checks: pf.result?.checks ?? [], dismissed: pf.groups.dismissed, kitFailed: kit.status === 'error' }
      : { state: 'waiting' };

  const canCheck = check.status === 'ok' && mayRunCheck(check.data, readOnly);
  const review = useMemo(
    () => reviewOf({ deck: saved, figures, check, refresh, approval, pf: pfView, canCheck }),
    // pfView is rebuilt every render; its parts are the inputs.
    [saved, figures, check, refresh, approval, canCheck, pf.running, pf.current, pf.groups, pf.result, kit.status], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const retry = { figures: reloadFigures, check: reloadCheck, refresh: reloadRefresh, approval: reloadApproval, kit: reloadKit };
  const runCheck = async () => {
    setChecking(true); setCheckFailed(null);
    try {
      await deckCheckApi.run(deckId);
      reloadCheck(); reloadFigures();
    } catch (e) {
      reportError('pitch-version-review:check', e);
      setCheckFailed(refusalText(e, 'The check could not run. Try again.'));
    } finally {
      setChecking(false);
    }
  };

  const pills = countPills(review.counts);
  return (
    <section className="flex flex-col gap-3.5" aria-labelledby="pitch-version-review-title" data-testid="pitch-version-review">
      <div className={`${CARD} flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:gap-4`} data-testid="pitch-version-review-head">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className={EYE}>Checking</span>
          <h2 id="pitch-version-review-title" className={`m-0 text-[16px] font-extrabold ${INK}`} data-testid="pitch-version-review-version">{checkingLine(deck, version?.created_at)}</h2>
          <span className="text-[12px] leading-[1.45] text-axal-muted dark:text-gray-400">{EXACT_LINE}</span>
        </div>
        <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0 lg:ml-auto lg:justify-end" aria-label="Results by status" data-testid="pitch-version-review-counts">
          {pills.map((p) => <li key={p.key} data-testid={`pitch-version-review-count-${p.key}`}><StatusPill status={p.key} label={p.label} /></li>)}
        </ul>
      </div>
      <p className={`m-0 ${MUTED}`} data-testid="pitch-version-review-no-score">{NO_SCORE}</p>
      {checkFailed ? <p role="alert" className="m-0 text-[12.5px] font-semibold text-axal-destructive dark:text-red-400" data-testid="pitch-version-review-check-failed">{checkFailed}</p> : null}
      <div className="grid gap-3.5 lg:grid-cols-2">
        {review.groups.map((g) => (
          <section key={g.key} className={`${CARD} flex min-w-0 flex-col gap-2 p-4`} aria-labelledby={`pitch-version-review-${g.key}`} data-testid={`pitch-version-review-group-${g.key}`}>
            <h3 id={`pitch-version-review-${g.key}`} className={`m-0 text-[13.5px] font-extrabold ${INK}`}>{g.title}</h3>
            <ul className="m-0 flex list-none flex-col p-0">
              {g.rows.map((r) => (
                <ReviewRow key={r.id} row={r} projectId={projectId} retry={retry} pf={pf}
                  runCheck={runCheck} checking={checking} />
              ))}
            </ul>
          </section>
        ))}
      </div>
      {pf.running && pf.running.done < pf.running.total ? (
        <PreflightMeasure key={`review-${pf.running.done}`} card={pf.running.snapshot.slides[pf.running.done]} index={pf.running.done}
          theme={pf.running.snapshot.theme} kit={kitData} onMeasured={pf.onMeasured} />
      ) : null}
      {pf.retrying && pf.snapshot ? (
        <PreflightMeasure key={`review-retry-${pf.retrying.index}`} card={pf.snapshot.slides[pf.retrying.index]} index={pf.retrying.index}
          theme={pf.snapshot.theme} kit={kitData} onMeasured={pf.onRetried} />
      ) : null}
    </section>
  );
}

function ReviewRow({ row, projectId, retry, pf, runCheck, checking }) {
  const action = actionOf(row);
  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-1.5 border-t border-axal-hairline py-2.5 first:border-t-0 dark:border-gray-700 sm:flex-nowrap"
      data-testid="pitch-version-review-row" data-status={row.status} data-card={Number.isInteger(row.card) ? row.card + 1 : undefined}>
      <span className="pt-0.5"><StatusPill status={row.status} /></span>
      <div className="flex min-w-0 flex-1 basis-[60%] flex-col gap-0.5">
        <b className={`text-[12.5px] leading-[1.4] ${INK}`}>{row.title}</b>
        {row.detail ? <small className="text-[11.5px] leading-[1.45] text-axal-muted dark:text-gray-400">{row.detail}</small> : null}
      </div>
      {action?.kind === 'card' ? (
        <Link to={cardHref(projectId, row.card)} className={GHOST} aria-label={`Go to card ${row.card + 1}: ${row.title}`} data-testid="pitch-version-review-go">{action.label}</Link>
      ) : action?.kind === 'retry' ? (
        <button type="button" className={GHOST} onClick={() => retry[action.read]?.()} data-testid="pitch-version-review-retry"><RefreshCw size={13} aria-hidden="true" />{action.label}</button>
      ) : action?.kind === 'remeasure' ? (
        <button type="button" className={GHOST} onClick={() => pf.retry(action.card)} disabled={Boolean(pf.retrying || pf.running)} data-testid="pitch-version-review-remeasure"><RefreshCw size={13} aria-hidden="true" />{action.label}</button>
      ) : action?.kind === 'run-check' ? (
        <button type="button" className={GHOST} onClick={runCheck} disabled={checking} data-testid="pitch-version-review-run-check">{checking ? 'Checking…' : action.label}</button>
      ) : null}
    </li>
  );
}
