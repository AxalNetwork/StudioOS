import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api } from '../../../lib/api';
import { reportError } from '../../../lib/log';
import { railPressHeaders } from '../../../lib/railPage.js';
import { Lightbox, useRailOption } from '../../../ui';
import DeckReviewerPage from '../../DeckReviewerPage';
import { asList, currentVersion, versionLabel } from './pitchStudioModel';
import {
  NO_REVIEWS, NO_REVIEW_YET, REVIEW_COLUMNS, REVIEW_READ_ONLY, SCORE_NOT_RETURNED, UPLOAD_LINE,
  costLabel, estimateOf, historyRows, latestReview, pointerLabel, ranAt, reviewSentence,
} from './reviewModel';

/**
 * D900 (#2679, part 6 of #2434) — the studio's Review tab (PD14) at
 * `/raise/pitch/review`.
 *
 * "Review this version" reviews the current version's own cards
 * (`POST /api/decks/:id/review`), after a dialog that says what it reads, what
 * it costs and what it changes. The latest review of that version shows its
 * score only because the review returned one, its four columns each pointing
 * to a card, and the run's cost. "Reviews per version" reads every version's
 * runs (`GET /api/decks/:id/reviews`), with "Score not returned" where none
 * came back. Only the venture's founders run a review; an admin reads.
 *
 * Uploads and pasted text stay the reviewer's own (`DeckReviewerPage`,
 * embedded below), per user and outside the deck's history.
 */

const BTN = 'inline-flex min-h-[36px] items-center justify-center gap-2 whitespace-nowrap rounded-[9px] px-3.5 text-[12.5px] font-bold';
const GHOST = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const PRIMARY = `${BTN} bg-axal-violet text-white hover:bg-axal-violet-deep disabled:opacity-50`;
const CARD = 'rounded-[12px] border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';
const EYE = 'font-mono text-[10px] font-bold uppercase tracking-[.07em]';
const MUTED = 'text-[12.5px] leading-[1.45] text-axal-muted dark:text-gray-400';
const INK = 'text-axal-ink dark:text-gray-100';
const MONO = 'font-mono tabular-nums';
const PILL = 'inline-flex shrink-0 items-center rounded-full border border-axal-hairline bg-axal-ground px-2 py-0.5 font-mono text-[10.5px] font-bold text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400';
const SKEL = 'animate-pulse rounded-[9px] bg-axal-hairline dark:bg-gray-800';
const TONE = {
  ok: 'text-emerald-700 dark:text-emerald-400',
  amber: 'text-amber-800 dark:text-amber-300',
  bad: 'text-axal-destructive dark:text-red-400',
  violet: 'text-axal-violet dark:text-violet-300',
};

export default function PitchReview({ reads, readOnly }) {
  const versions = reads.versions.status === 'ok' ? asList(reads.versions.data, 'versions', 'decks') : [];
  const current = currentVersion(versions);
  const deckId = current?.id || null;
  const cards = reads.deck.status === 'ok' && Array.isArray(reads.deck.data?.slides) ? reads.deck.data.slides.length : 0;
  const [history, setHistory] = useState({ status: 'idle', data: null });
  const [tick, setTick] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(null);
  // D771: the press names itself to the rail while the review runs, as the reviewer's presses do.
  useRailOption(busy ? 'review:deck-version' : null, 'Review this version');

  useEffect(() => {
    if (!deckId) { setHistory({ status: 'idle', data: null }); return undefined; }
    let alive = true;
    setHistory({ status: 'loading', data: null });
    api.deckReviews(deckId)
      .then((data) => { if (alive) setHistory({ status: 'ok', data }); })
      .catch((e) => { if (alive) { reportError('pitch-studio:reviews', e); setHistory({ status: 'error', data: null }); } });
    return () => { alive = false; };
  }, [deckId, tick]);

  const reviews = history.status === 'ok' ? asList(history.data, 'reviews') : [];
  // The Worker's own answer decides who may run: an admin reads only.
  const canRun = !readOnly && history.data?.viewer !== 'admin' && history.data?.viewer !== 'super_admin';
  const latest = latestReview(reviews, deckId);
  const estimate = estimateOf(reviews);

  const run = useCallback(async () => {
    setBusy(true);
    setFailed(null);
    try {
      await api.deckReviewVersion(deckId, railPressHeaders('review:deck-version'));
      setConfirm(false);
      setTick((t) => t + 1);
    } catch (e) {
      reportError('pitch-studio:review-run', e);
      setFailed(e?.message || 'The review could not be run. Nothing was saved. Try again.');
    } finally {
      setBusy(false);
    }
  }, [deckId]);

  let body;
  if (reads.projects.status === 'error' || (reads.projects.status === 'ok' && !reads.project)) {
    body = null; // No venture to read: the reviewer below still works on a file or text.
  } else if (reads.versions.status === 'error') {
    body = <Failed text="Your deck's versions could not be read." onRetry={reads.reload} testId="pitch-review-versions-error" />;
  } else if (reads.versions.status !== 'ok' || reads.projects.status !== 'ok') {
    body = <div className={`${SKEL} h-[140px]`} aria-busy="true" data-testid="pitch-review-loading" />;
  } else if (!current) {
    body = <p className={`m-0 ${MUTED}`} data-testid="pitch-review-no-deck">There is no deck to review yet. Build one, then review it here.</p>;
  } else {
    const label = versionLabel(current);
    body = (
      <>
        <section className={`${CARD} flex flex-col gap-4 p-4`} data-testid="pitch-review-current">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <span className={`text-[15px] font-extrabold ${INK}`}>Review {label}{current.title ? ` · ${current.title}` : ''}</span>
              {latest ? (
                <span className={MUTED} data-testid="pitch-review-ran">
                  Proposed by Eadwyn · ran <span className={MONO}>{ranAt(latest.created_at)}</span> · cost <span className={MONO}>{costLabel(latest.cost)}</span>
                </span>
              ) : (
                <span className={MUTED}>{history.status === 'ok' ? NO_REVIEW_YET : ' '}</span>
              )}
            </div>
            <div className="flex items-center gap-4">
              {latest ? <Score score={latest.overall_score} /> : null}
              {canRun ? (
                <button
                  type="button"
                  className={PRIMARY}
                  onClick={() => { setFailed(null); setConfirm(true); }}
                  disabled={history.status !== 'ok' || !cards}
                  data-testid="pitch-review-run"
                >
                  Review this version{estimate ? <span className={MONO}> · {estimate}</span> : null}
                </button>
              ) : null}
            </div>
          </div>
          {!canRun && history.status === 'ok' ? <p className={`m-0 ${MUTED}`} data-testid="pitch-review-readonly">{REVIEW_READ_ONLY}</p> : null}
          {history.status === 'error' ? (
            <Failed text="The reviews could not be read." onRetry={() => setTick((t) => t + 1)} testId="pitch-review-history-error" />
          ) : history.status === 'loading' ? (
            <div className={`${SKEL} h-[120px]`} aria-busy="true" />
          ) : latest ? (
            <>
              {latest.review.summary ? <p className={`m-0 text-[13px] leading-[1.55] ${INK}`} data-testid="pitch-review-summary">{latest.review.summary}</p> : null}
              <div className="grid gap-3.5 md:grid-cols-2" data-testid="pitch-review-columns">
                {REVIEW_COLUMNS.map((col) => (
                  <div key={col.key} className={`${CARD} flex flex-col gap-2 px-4 py-3.5`} data-testid={`pitch-review-col-${col.key}`}>
                    <span className={`${EYE} ${TONE[col.tone]}`}>{col.label}</span>
                    {(latest.review[col.key] || []).length ? (latest.review[col.key] || []).map((p, i) => (
                      <div key={i} className="flex items-start justify-between gap-3">
                        <span className={`text-[12.5px] leading-[1.45] ${INK}`}>{p.text}</span>
                        <span className={PILL}>{pointerLabel(p.card)}</span>
                      </div>
                    )) : <span className={MUTED}>None returned.</span>}
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </section>

        <section className={`${CARD} overflow-hidden`} data-testid="pitch-review-history">
          <div className={`border-b border-axal-hairline px-4 py-3 text-[13.5px] font-extrabold dark:border-gray-700 ${INK}`}>Reviews per version</div>
          {history.status === 'ok' && reviews.length ? (
            <table className="w-full border-collapse text-left text-[12.5px]">
              <thead>
                <tr className={`${EYE} text-axal-muted dark:text-gray-400`}>
                  <th scope="col" className="px-4 py-2 font-bold">Version</th>
                  <th scope="col" className="px-4 py-2 font-bold">Score</th>
                  <th scope="col" className="px-4 py-2 font-bold">Ran</th>
                  <th scope="col" className="px-4 py-2 font-bold">Cost</th>
                </tr>
              </thead>
              <tbody>
                {historyRows(reviews).map((r) => (
                  <tr key={r.key} className="border-t border-axal-hairline dark:border-gray-700" data-testid="pitch-review-history-row">
                    <td className={`px-4 py-2 font-bold ${INK}`}>{r.version}</td>
                    <td className={`px-4 py-2 ${r.scored ? `${MONO} font-bold ${INK}` : 'text-axal-muted dark:text-gray-400'}`}>{r.score}</td>
                    <td className={`px-4 py-2 ${MONO} text-axal-muted dark:text-gray-400`}>{r.when}</td>
                    <td className={`px-4 py-2 ${MONO} text-axal-muted dark:text-gray-400`}>{r.cost}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : history.status === 'ok' ? (
            <p className={`m-0 px-4 py-3 ${MUTED}`} data-testid="pitch-review-history-empty">{NO_REVIEWS}</p>
          ) : null}
          <p className={`m-0 border-t border-axal-hairline px-4 py-2.5 text-[11.5px] text-axal-muted dark:border-gray-700 dark:text-gray-400`}>
            A version without a score shows "{SCORE_NOT_RETURNED}".
          </p>
        </section>
      </>
    );
  }

  return (
    <div className="flex flex-col gap-5" data-testid="pitch-review">
      {body}
      <section className="flex flex-col gap-3" data-testid="pitch-review-uploads">
        <div className="flex flex-col gap-1">
          <h2 className={`m-0 text-[14px] font-extrabold ${INK}`}>Review an upload or pasted text</h2>
          <p className={`m-0 ${MUTED}`}>{UPLOAD_LINE}</p>
        </div>
        <DeckReviewerPage embedded />
      </section>
      {confirm && current ? (
        <Lightbox
          label="Review this version"
          title={`Review ${versionLabel(current)}?`}
          width={480}
          onClose={() => !busy && setConfirm(false)}
          testId="pitch-review-dialog"
          footer={(
            <div className="flex justify-end gap-2">
              <button type="button" className={GHOST} onClick={() => setConfirm(false)} disabled={busy}>Cancel</button>
              <button type="button" className={PRIMARY} onClick={run} disabled={busy} data-testid="pitch-review-confirm">{busy ? 'Reviewing…' : 'Run the review'}</button>
            </div>
          )}
        >
          <p className={`m-0 text-[13px] leading-[1.55] ${INK}`} data-testid="pitch-review-sentence">{reviewSentence(versionLabel(current), cards, estimate)}</p>
          {failed ? <p role="alert" className="m-0 mt-2 text-[12.5px] font-semibold text-axal-destructive dark:text-red-400" data-testid="pitch-review-failed">{failed}</p> : null}
        </Lightbox>
      ) : null}
    </div>
  );
}

function Score({ score }) {
  const returned = typeof score === 'number';
  return (
    <div className="flex flex-col items-end" data-testid="pitch-review-score">
      <span className={`${returned ? `${MONO} text-[26px]` : 'text-[13px]'} font-extrabold leading-none ${INK}`}>{returned ? Math.round(score) : SCORE_NOT_RETURNED}</span>
      {returned ? <span className="text-[11px] text-axal-muted dark:text-gray-400">of 100 · returned by the review</span> : null}
    </div>
  );
}

function Failed({ text, onRetry, testId }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-red-200 bg-red-50 px-3.5 py-2.5 text-[12.5px] font-semibold text-axal-destructive dark:border-red-900 dark:bg-red-950/30 dark:text-red-300" data-testid={testId}>
      <span>{text}</span>
      <button type="button" className={GHOST} onClick={onRetry}><RefreshCw size={13} aria-hidden="true" />Try again</button>
    </div>
  );
}
