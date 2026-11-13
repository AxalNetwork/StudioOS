import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Lightbox } from '../../../ui';
import { DraftDialog } from '../caprel/CapRelOutreach.jsx';
import * as v2 from './deckV2Adapter.js';
import {
  CONSENT_OFF, NO_MOST_READ, NO_VISITS, VIEWS_UNREAD, barsOf, mostReadWords, ndaPill, nextStepsOf, timelineRows,
} from './slideAnalyticsModel.js';

/**
 * D1573 (#3820, PD-8 · pd37) — "Viewer analytics" for one investor link,
 * opened from the Analytics cell of Share ▾'s investor links table
 * (`InvestorLinksTable.jsx`). It reads `deckV2Adapter.slideAnalytics` (the
 * Worker's `GET /api/decks/:id/investor-links/:shareId/analytics`) and writes
 * nothing.
 *
 * The investor and their NDA pill; TIME PER SLIDE, one bar per card over its
 * thumbnail, in the order the link shows them; MOST READ SLIDE; the VISIT
 * TIMELINE. With Time per slide off: "Visit counts only. Time per slide is off
 * for this link." A failed read: "Views could not be read." with Try again.
 * Nothing reads 0 for what was not counted: an untimed card is "Not read".
 *
 * #4272 (ps7s): two next steps under the sheet, for a link whose investor is in
 * Capital relationships: **Draft follow-up** opens Capital relationships' own
 * draft dialog on that prospect (a follow-up; Eadwyn drafts, nothing is sent),
 * and **Open in Capital relationships** goes to the prospect's record. A link
 * whose investor was typed in has neither: both are drawn off, with the reason.
 */

const MUTED = 'text-[12.5px] leading-[1.45] text-axal-muted dark:text-gray-400';
const EYE = 'font-mono text-[10px] font-semibold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const CARD = 'flex flex-col gap-2 rounded-[12px] border border-axal-hairline bg-white p-3 dark:border-gray-800 dark:bg-gray-900';
const GHOST = 'inline-flex min-h-[30px] w-fit items-center justify-center rounded-[8px] border border-axal-hairline bg-white px-2.5 text-[12px] font-bold text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
const PILL = {
  pos: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200',
  amb: 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
  mut: 'bg-axal-ground text-axal-muted dark:bg-gray-800 dark:text-gray-400',
};
const BAR_MAX = 90;

export default function ViewerAnalyticsSheet({ deck, row, projectId = null, onClose }) {
  const [answer, setAnswer] = useState(null);
  const [drafting, setDrafting] = useState(false);
  const next = nextStepsOf(row);
  const canDraft = next.ok && projectId != null;
  const load = useCallback(() => {
    if (!deck?.id || !row?.id) return;
    setAnswer(null);
    v2.slideAnalytics(deck.id, row.id).then(setAnswer);
  }, [deck?.id, row?.id]);
  useEffect(() => { load(); }, [load]);

  const value = answer?.available ? answer.value : null;
  const who = [row?.investor?.label || 'Not recorded', row?.investor?.fund].filter(Boolean).join(' · ');
  const pill = ndaPill(value?.nda ?? row?.nda);
  const most = mostReadWords(value);
  const rows = timelineRows(value);

  return (
    <Lightbox label="Viewer analytics" title="Viewer analytics" width={760} onClose={onClose} testId="viewer-analytics"
      footer={(
        <div className="flex flex-col gap-1.5" data-testid="viewer-analytics-next">
          <div className="flex flex-wrap justify-end gap-2">
            {next.ok ? (
              <Link className={`${GHOST} no-underline`} to={next.href} data-testid="viewer-analytics-open-caprel">Open in Capital relationships</Link>
            ) : (
              <button type="button" className={GHOST} disabled title={next.reason} data-testid="viewer-analytics-open-caprel">Open in Capital relationships</button>
            )}
            <button type="button" className={GHOST} disabled={!canDraft} title={next.ok ? undefined : next.reason}
              onClick={() => setDrafting(true)} data-testid="viewer-analytics-draft">Draft follow-up</button>
          </div>
          {!next.ok ? <p className={`m-0 text-right ${MUTED}`} data-testid="viewer-analytics-next-reason">{next.reason}</p> : null}
        </div>
      )}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <b className="text-[14px] text-axal-ink dark:text-gray-100">{who}</b>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${PILL[pill.tone]}`} data-testid="viewer-analytics-nda">{pill.words}</span>
        </div>
        {!answer ? <p className={`m-0 ${MUTED}`} data-testid="viewer-analytics-reading">Reading the views…</p> : null}
        {answer && !answer.available ? (
          <div className="flex flex-col gap-1.5" data-testid="viewer-analytics-unread">
            <p role="alert" className="m-0 text-[12.5px] font-semibold text-axal-destructive dark:text-red-300">{answer.unreadable ? VIEWS_UNREAD : answer.reason}</p>
            {answer.unreadable ? <button type="button" className={GHOST} onClick={load} data-testid="viewer-analytics-retry">Try again</button> : null}
          </div>
        ) : null}
        {value ? (
          <>
            <div className={CARD}>
              <span className={EYE}>Time per slide</span>
              {value.time_per_slide === false || !Array.isArray(value.cards) ? (
                <p className={`m-0 ${MUTED}`} data-testid="viewer-analytics-consent-off">{CONSENT_OFF}</p>
              ) : (
                <>
                  <div className="flex items-end gap-2 overflow-x-auto pb-1" data-testid="viewer-analytics-bars">
                    {barsOf(value).map((b) => (
                      <div key={b.uid} className="flex w-[72px] shrink-0 flex-col items-center gap-1" data-testid={`viewer-analytics-bar-${b.uid}`}>
                        <span className="font-mono text-[10.5px] text-axal-ink dark:text-gray-100">{b.label}</span>
                        <div className={`w-full rounded-t-[4px] ${b.most ? 'bg-axal-violet' : 'bg-violet-100 dark:bg-violet-950/60'}`} style={{ height: `${Math.max(2, Math.round(b.height * BAR_MAX))}px` }} aria-hidden="true" />
                        <div className="flex aspect-video w-full items-center justify-center rounded-[6px] border border-axal-hairline bg-axal-ground px-1 text-center text-[9.5px] font-semibold leading-tight text-axal-ink dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100">
                          <span className="line-clamp-2">{b.title}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className={EYE}>Most read slide</span>
                    <span className="text-[12.5px] font-bold text-axal-ink dark:text-gray-100" data-testid="viewer-analytics-most">{most || NO_MOST_READ}</span>
                  </div>
                </>
              )}
            </div>
            <div className={CARD}>
              <span className={EYE}>Visit timeline</span>
              {rows.length ? (
                <ul className="m-0 flex list-none flex-col p-0" data-testid="viewer-analytics-timeline">
                  {rows.map((r) => (
                    <li key={r.key} className="flex gap-3 border-t border-axal-hairline py-1.5 text-[12.5px] first:border-t-0 dark:border-gray-800">
                      <span className="font-mono text-[11.5px] text-axal-muted dark:text-gray-400">{r.at}</span>
                      <span className="text-axal-ink dark:text-gray-100">{r.words}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className={`m-0 ${MUTED}`}>{NO_VISITS}</p>}
            </div>
          </>
        ) : null}
      </div>
      {drafting && canDraft ? (
        <DraftDialog projectId={projectId} purpose="follow_up" prospect={{ id: next.prospectId, name: next.name }}
          onClose={() => setDrafting(false)} />
      ) : null}
    </Lightbox>
  );
}
