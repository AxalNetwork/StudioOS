import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Lightbox } from '../../../ui';
import { DraftDialog } from '../caprel/CapRelOutreach.jsx';
import * as v2 from './deckV2Adapter.js';
import FigureTile, { FigureBody } from './AnalyticsFigure.jsx';
import { linkStatusLine } from './shareModel.js';
import {
  ABSENCE, JOURNEY_NOTE, NO_MOST_READ, NO_VISITS, TIME_PER_CARD_NOTE,
  cardRows, investorFigures, journeyRows, mostReadWords, ndaPill, newerVersionOf, nextStepsOf,
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
 *
 * D6062 (#6062, Pitch Studio v2 PS-08 B): one investor's journey. Four tiles
 * (the version and NDA with the link's expiry, Visits with revisits, Time on
 * deck, Reached the ask), Time per card as horizontal bars ("Not read" is never
 * 0 s), the journey (link created, opened, the NDA, the ask, each revisit,
 * withdrawn), and, when the deck has a newer version than the link opens, a
 * line saying so (the links table's changes-since read, `since`). Each figure
 * keeps the four kinds of nothing apart (`AnalyticsFigure.jsx`): Tracking off,
 * Unavailable (the read failed), Measured zero, Not recorded. Reactions and
 * comments are not drawn: their founder read waits for proposal 9.
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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayWords = (v) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ''));
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : null;
};
/** The version the link opens: "v6", or "v6 · Seed variant". */
const versionOf = (row, deck) => (row?.version?.variant?.name ? `v${deck?.version ?? '?'} · ${row.version.variant.name}` : `v${deck?.version ?? '?'}`);
/** The link's expiry under it: "Link expires 22 Nov 2026", "Never expires", or Not recorded. */
const expiryLine = (row) => {
  if (!row) return 'Expiry not recorded';
  if (row.expires_at == null) return 'Never expires';
  return dayWords(row.expires_at) ? `Link expires ${dayWords(row.expires_at)}` : 'Expiry not recorded';
};

export default function ViewerAnalyticsSheet({ deck, row, projectId = null, since = null, changes = null, onClose }) {
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
  const failed = Boolean(answer && !answer.available);
  const figs = value ? investorFigures(value) : null;
  const journey = value ? journeyRows(value, row) : [];
  const newer = newerVersionOf(since, row?.investor?.label || 'This investor');
  const timed = Boolean(value) && value.time_per_slide !== false && Array.isArray(value.cards);
  const status = row ? linkStatusLine({ ...row, ...(value ? { status: value.status, withdrawn_at: value.withdrawn_at } : {}) }) : null;

  return (
    <Lightbox label="Viewer analytics" title="Viewer analytics" width={980} onClose={onClose} testId="viewer-analytics"
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
          {status ? <span className={MUTED} data-testid="viewer-analytics-status">{status}</span> : null}
        </div>
        {!answer ? (
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4" aria-busy="true" data-testid="viewer-analytics-reading">
            <span className="sr-only">Reading the views…</span>
            {[0, 1, 2, 3].map((i) => <div key={i} className="h-[74px] animate-pulse rounded-[12px] bg-axal-hairline dark:bg-gray-800" />)}
          </div>
        ) : null}
        {failed ? (
          <div className="flex flex-col gap-1.5" data-testid="viewer-analytics-unread">
            {answer.unreadable ? (
              <FigureBody fig={{ kind: 'unreadable', why: ABSENCE.unreadable.line }} onRetry={load} testId="viewer-analytics-unreadable" retryTestId="viewer-analytics-retry" />
            ) : <p role="alert" className="m-0 text-[12.5px] font-semibold text-axal-destructive dark:text-red-300">{answer.reason}</p>}
          </div>
        ) : null}
        {value ? (
          <>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4" data-testid="viewer-analytics-tiles">
              <FigureTile label="Version">
                <span className="flex min-w-0 flex-col gap-0.5" data-testid="viewer-analytics-version">
                  <b className="text-[14px] text-axal-ink dark:text-gray-100">{versionOf(row, deck)}</b>
                  <em className="text-[11.5px] not-italic text-axal-muted dark:text-gray-400">{expiryLine(row)}</em>
                </span>
              </FigureTile>
              <FigureTile label="Visits" fig={figs.visits} testId="viewer-analytics-visits" />
              <FigureTile label="Time on deck" fig={figs.time} testId="viewer-analytics-time" />
              <FigureTile label="Reached the ask" fig={figs.ask} testId="viewer-analytics-ask" />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className={CARD}>
                <span className={EYE}>Time per card · all visits</span>
                {!timed ? (
                  <FigureBody fig={{ kind: 'tracking_off' }} testId="viewer-analytics-consent-off" />
                ) : (
                  <>
                    <div className="flex flex-col gap-1.5" data-testid="viewer-analytics-bars">
                      {cardRows(value).map((b) => (
                        <div key={b.uid} className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_auto] items-center gap-2 text-[12px] md:grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto]" data-testid={`viewer-analytics-bar-${b.uid}`}>
                          <span className="truncate text-axal-ink dark:text-gray-100" title={b.title}>{`${b.n} · ${b.title}`}</span>
                          <span className="h-2.5 overflow-hidden rounded-full" aria-hidden="true">
                            {b.read ? <span className={`block h-full rounded-full ${b.most ? 'bg-axal-violet dark:bg-violet-400' : 'bg-violet-300 dark:bg-violet-700'}`} style={{ width: `${Math.max(4, Math.round(b.height * 100))}%` }} />
                              : <span className="block h-full w-full rounded-full border border-dashed border-gray-300 dark:border-gray-600" />}
                          </span>
                          <span className={`text-right font-mono text-[11.5px] ${b.read ? 'text-axal-ink dark:text-gray-100' : 'italic text-axal-muted dark:text-gray-400'}`}>{b.label}</span>
                        </div>
                      ))}
                    </div>
                    <p className={`m-0 ${MUTED}`}>{TIME_PER_CARD_NOTE}</p>
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className={EYE}>Most read card</span>
                      <span className="text-[12.5px] font-bold text-axal-ink dark:text-gray-100" data-testid="viewer-analytics-most">{most || NO_MOST_READ}</span>
                    </div>
                  </>
                )}
              </div>
              <div className={CARD}>
                <span className={EYE}>Journey</span>
                {journey.some((r) => r.kind !== 'created' && r.kind !== 'withdrawn') ? null : <p className={`m-0 ${MUTED}`}>{NO_VISITS}</p>}
                {journey.length ? (
                  <ul className="m-0 flex list-none flex-col p-0" data-testid="viewer-analytics-timeline">
                    {journey.map((r) => (
                      <li key={r.key} className="flex gap-3 border-t border-axal-hairline py-1.5 text-[12.5px] first:border-t-0 dark:border-gray-800" data-testid={`viewer-analytics-step-${r.kind}`}>
                        <span className="w-[7.5rem] shrink-0 font-mono text-[11.5px] text-axal-muted dark:text-gray-400">{r.at}</span>
                        <span className="text-axal-ink dark:text-gray-100">{r.words}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <p className={`m-0 ${MUTED}`}>{JOURNEY_NOTE}</p>
              </div>
            </div>
            {newer ? (
              <div className="flex flex-col gap-1 rounded-[12px] border border-amber-300 bg-amber-50 p-3 dark:border-amber-500/50 dark:bg-amber-500/10" data-testid="viewer-analytics-newer">
                <span className="flex flex-wrap items-center gap-2">
                  <b className="rounded-full border border-amber-400 px-2 py-px text-[11px] text-amber-800 dark:border-amber-500/60 dark:text-amber-300">{newer.chip}</b>
                  <span className="text-[12.5px] text-axal-ink dark:text-gray-100">{newer.line}</span>
                </span>
                {changes ? <span className={MUTED}>{changes}</span> : null}
              </div>
            ) : null}
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
