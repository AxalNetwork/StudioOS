/**
 * D1152 (#3057) — the investor's Overview (DL1) on today's reads. Since D6165
 * it carries the deck the venture granted the investor (`DealDeck.jsx`). Since D4815
 * part 4 (DE04) the round's figures are the strip's and the one next action
 * is the header's, so this file repeats neither.
 *
 * D4815 part 41 (#5904, board DE04): the body is the investment cockpit, in
 * the canvas's grid. Scorecard (the eleven-scope strip with Strongest, Needs
 * attention and Changed, and Open scorecard; no overall score) beside What's
 * new (material changes, dated); Investment case (why this deal: summary,
 * thesis fit and its reasons, main evidence; beside it the firm's questions
 * and risks and what the scorecard is missing) beside Your position. Each
 * block reads on its own and fails on its own, with Try again. A founder and
 * studio staff keep the scorecard and the deal's details; the rest is the
 * investor's.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Unreadable } from '../../ui';
import { reportError } from '../../lib/log';
import { dealContextApi } from '../../lib/api/dealContext.js';
import { dealViewsApi } from '../../lib/api/dealViews.js';
import { tabHref } from '../dealPageModel';
import { CARD, EYE, SUB, H3 } from './DealFrame';
import {
  CASE_TAGS, caseNotes, missingEvidence, scoreSummary, termsAtGlance, thesisFitOf, whatsNewList, whatsNewOf,
} from './dealFrameModel';
import { DealDeckCard } from './DealDeck';
import { DealStrip, useScopeStrips } from '../../components/scoring/scorecard/Scorecard';
import { FOUNDER_PAGE, stripOf } from '../../components/scoring/scorecard/scorecardModel';
import { whatsNewOnce } from './dealVisit';

const LINK = 'text-[12.5px] font-bold text-axal-violet-deep hover:underline dark:text-violet-300';
// D4815 part 15 (#5908, DE15): a link standing on its own line is a 44px target on a phone; one inside a sentence stays inline.
const LINK_ALONE = `${LINK} w-fit max-md:inline-flex max-md:min-h-[44px] max-md:items-center`;
const TRY = 'w-fit rounded-axal-sm border border-axal-hairline bg-white px-2.5 py-1 text-[12px] font-bold text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800 max-sm:min-h-[44px]';

const SLOT = 'flex flex-col gap-2 rounded-axal-lg border border-dashed border-axal-muted bg-axal-ground px-4 py-4 dark:border-gray-600 dark:bg-gray-800/60';

/** A sibling canvas's board, drawn as a labelled grey frame (DL24). */
export function Slot({ slot, testId }) {
  return (
    <section className={SLOT} data-testid={testId}>
      <span className={EYE}>{slot.eye}</span>
      <h3 className={H3}>{slot.title}</h3>
      <p className={`m-0 ${SUB}`}>{slot.line}</p>
    </section>
  );
}

function Row({ label, value, missing }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-axal-hairline py-2 dark:border-gray-700">
      <span className="text-[13px] font-semibold text-axal-ink dark:text-gray-100">{label}</span>
      <span className={`font-mono text-[12.5px] font-bold ${missing ? 'text-axal-muted dark:text-gray-400' : 'text-axal-ink dark:text-gray-100'}`}>{value}</span>
    </div>
  );
}

function WhatsNew({ dealId, className = '' }) {
  const [read, setRead] = useState({ status: 'loading' });
  const load = () => {
    setRead({ status: 'loading' });
    whatsNewOnce(dealId).then((data) => setRead({ status: 'ready', data }))
      .catch((e) => { reportError('DealOverview:whatsNew', e); setRead({ status: 'unreadable' }); });
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [dealId]);
  const w = whatsNewOf(read);
  const rows = whatsNewList(w);
  return (
    <section className={`${CARD} flex min-w-0 flex-col gap-2 px-4 py-4 ${className}`} data-testid="deal-whats-new">
      <div className="flex items-center justify-between gap-3">
        <h3 className={H3}>What’s new</h3>
        {w.since && <span className={SUB} data-testid="deal-whats-new-since">Since {w.since}</span>}
      </div>
      {w.state === 'loading' && <p className={`m-0 ${SUB}`}>Reading…</p>}
      {w.state === 'unreadable' && <Unreadable what="What changed" claim="That is not a claim that nothing changed." onRetry={load} />}
      {w.state === 'first' && <p className={`m-0 ${SUB}`}>{w.line}</p>}
      {w.state === 'ready' && (rows.length
        ? (
          <ul className="m-0 flex list-none flex-col p-0" data-testid="deal-whats-new-list">
            {rows.map((r, i) => (
              <li key={i} className="grid grid-cols-[92px_minmax(0,1fr)] gap-3 border-t border-axal-hairline py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:text-gray-100">
                <span className="font-mono text-[12px] text-axal-muted dark:text-gray-400">{r.at}</span>
                <span>{r.text}</span>
              </li>
            ))}
          </ul>
        )
        : <p className={`m-0 ${SUB}`}>Nothing has changed since you last looked.</p>)}
      {w.state === 'ready' && w.unavailable.map((u) => <p key={u} className={`m-0 ${SUB}`}>Not read here: {u}</p>)}
    </section>
  );
}

/** One read with its own state and Try again. `fetcher` is stable for the key. */
function useRead(fetcher, key, where) {
  const [read, setRead] = useState({ status: 'loading' });
  const load = useCallback(() => {
    let alive = true;
    setRead({ status: 'loading' });
    fetcher().then((data) => { if (alive) setRead({ status: 'ready', data }); })
      .catch((e) => { reportError(`DealOverview:${where}`, e); if (alive) setRead({ status: 'unreadable' }); });
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => load(), [load]);
  return [read, load];
}

function TryAgain({ onClick, testId }) {
  return <button type="button" className={TRY} onClick={onClick} data-testid={testId}>Try again</button>;
}

function SummaryCell({ label, children, testId }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-axal-sm border border-axal-hairline px-3 py-2 dark:border-gray-700" data-testid={testId}>
      <span className={EYE}>{label}</span>
      {children}
    </div>
  );
}

/** DE04's Scorecard: the strip, then Strongest, Needs attention and Changed, then Open scorecard. No overall score. */
function ScoreSummary({ dealId, strips, className = '' }) {
  let body;
  if (strips.status === 'loading') body = <p className={`m-0 ${SUB}`} aria-live="polite">Reading…</p>;
  else if (strips.status === 'error' && strips.error?.status === 403) {
    body = <p className={`m-0 ${SUB}`} data-testid="deal-score-strip-refused">The scope strip is for investors and studio staff. A founder’s own scorecard is on <Link to={FOUNDER_PAGE} className={LINK}>Raise › Scorecard</Link>.</p>;
  } else if (strips.status === 'error') body = <Unreadable what="The scorecard" claim="That is not a score of zero." onRetry={strips.retry} />;
  else {
    const strip = stripOf(strips.items.get(Number(dealId)));
    const sum = scoreSummary(strip);
    body = (
      <>
        <DealStrip read={strips} dealId={dealId} />
        {strip.state === 'closed' && <p className={`m-0 ${SUB}`}>The scorecard opens once you are invited to this deal or committed on it.</p>}
        {strip.state === 'locked' && <p className={`m-0 ${SUB}`}>{strip.reason || 'The founder has not shared this scorecard with investors.'}</p>}
        {strip.state === 'unreadable' && <TryAgain onClick={strips.retry} testId="deal-score-retry" />}
        {sum.state === 'open' && (
          <div className="grid gap-2 sm:grid-cols-3" data-testid="deal-score-summary">
            <SummaryCell label="Strongest" testId="deal-score-strongest">
              {sum.strongest ? <><b className="text-[13.5px] text-axal-ink dark:text-gray-100">{sum.strongest.label} · {sum.strongest.band}</b><em className={`not-italic ${SUB}`}>{sum.strongest.confidence}</em></> : <span className={SUB}>None yet</span>}
            </SummaryCell>
            <SummaryCell label="Needs attention" testId="deal-score-attention">
              {sum.attention ? <><b className="text-[13.5px] text-axal-ink dark:text-gray-100">{sum.attention.label} · {sum.attention.band}</b><em className={`not-italic ${SUB}`}>{sum.attention.confidence}</em></> : <span className={SUB}>None stands apart</span>}
            </SummaryCell>
            <SummaryCell label="Changed" testId="deal-score-changed">
              <b className="text-[13.5px] text-axal-muted dark:text-gray-400">Not recorded</b>
              <em className={`not-italic ${SUB}`}>{sum.changed.line}</em>
            </SummaryCell>
          </div>
        )}
        {sum.line && <p className={`m-0 ${SUB}`} data-testid="deal-score-line">{sum.line}</p>}
        {strip.state === 'open' && <Link to={`/deals/${dealId}/scorecard`} className={LINK_ALONE} data-testid="deal-score-open">Open scorecard</Link>}
      </>
    );
  }
  return (
    <section className={`${CARD} flex min-w-0 flex-col gap-3 px-4 py-4 ${className}`} data-testid="deal-score-slot">
      <h3 className={H3}>Scorecard</h3>
      {body}
    </section>
  );
}

/**
 * DE04's Investment case. Why this deal: the deal's summary, the investor's thesis fit with its reasons,
 * and the main evidence, which opens on the Evidence tab (reading it here would log an open of the
 * founder's evidence the investor did not make). Beside it: the firm's notes tagged Question or Risk,
 * and the scopes the scorecard has not enough recorded for. Each part reads and fails on its own.
 */
function InvestmentCase({ deal, strips, className = '' }) {
  const id = deal.id;
  const [fitRead, retryFit] = useRead(() => dealViewsApi.fit([id]), `fit:${id}`, 'fit');
  const [qRead, retryQ] = useRead(() => dealContextApi.notes(id, { limit: 3, tag: 'Question' }), `q:${id}`, 'questions');
  const [rRead, retryR] = useRead(() => dealContextApi.notes(id, { limit: 3, tag: 'Risk' }), `r:${id}`, 'risks');
  const fit = thesisFitOf(fitRead, id);
  const notes = caseNotes({ Question: qRead, Risk: rRead });
  const missing = strips.status === 'loading' ? { state: 'loading' }
    : strips.status === 'error' ? { state: 'unreadable' } : missingEvidence(stripOf(strips.items.get(Number(id))));
  const retryNotes = () => { if (qRead.status === 'unreadable') retryQ(); if (rRead.status === 'unreadable') retryR(); };
  return (
    <section className={`${CARD} flex min-w-0 flex-col gap-3 px-4 py-4 ${className}`} data-testid="deal-case">
      <h3 className={H3}>Investment case</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-2 text-[12.5px] leading-[1.55]" data-testid="deal-case-why">
          <span className={EYE}>Why this deal</span>
          {deal.description
            ? <p className="m-0 text-axal-ink dark:text-gray-100" data-testid="deal-case-summary">{deal.description}</p>
            : <p className={`m-0 ${SUB}`} data-testid="deal-case-summary">No summary is recorded on this deal.</p>}
          <div className="flex flex-col gap-1" data-testid="deal-case-fit">
            {fit.state === 'loading' && <p className={`m-0 ${SUB}`}>Reading your thesis fit…</p>}
            {fit.state === 'unreadable' && (
              <>
                <p className={`m-0 ${SUB}`}>{fit.line || 'Fit to your thesis could not be read.'} That is not a claim that it does not fit.</p>
                <TryAgain onClick={retryFit} testId="deal-case-fit-retry" />
              </>
            )}
            {fit.state === 'scored' && (
              <>
                <b className="text-axal-ink dark:text-gray-100">{fit.line}</b>
                {fit.reasons.length > 0 && <ul className="m-0 list-disc pl-4 text-axal-ink dark:text-gray-100">{fit.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
              </>
            )}
            {['unavailable', 'not_set', 'not_enough'].includes(fit.state) && <p className={`m-0 ${SUB}`}>{fit.line}</p>}
          </div>
          <p className="m-0" data-testid="deal-case-evidence">
            <span className="text-axal-muted dark:text-gray-400">Main evidence: </span>
            <Link to={tabHref(id, 'evidence')} className={LINK_ALONE}>Open the shared evidence</Link>
          </p>
        </div>
        <div className="flex min-w-0 flex-col gap-2 text-[12.5px] leading-[1.55]" data-testid="deal-case-open">
          <span className={EYE}>Open questions · risks</span>
          {notes.state === 'loading' && <p className={`m-0 ${SUB}`}>Reading your firm’s notes…</p>}
          {notes.state === 'unreadable' && (
            <>
              <p className={`m-0 ${SUB}`}>Your firm’s questions and risks could not be read. That is not a claim that there are none.</p>
              <TryAgain onClick={retryNotes} testId="deal-case-notes-retry" />
            </>
          )}
          {notes.state === 'none' && <p className={`m-0 ${SUB}`} data-testid="deal-case-notes-none">No note at your firm is tagged {CASE_TAGS.join(' or ')}. <Link to={tabHref(id, 'notes')} className={LINK}>Add one in Notes</Link></p>}
          {notes.state === 'some' && (
            <ul className="m-0 list-disc pl-4 text-axal-ink dark:text-gray-100" data-testid="deal-case-notes">
              {notes.rows.map((n) => <li key={n.uid}><span className="text-axal-muted dark:text-gray-400">{n.tag}: </span>{n.text}</li>)}
            </ul>
          )}
          {notes.state === 'some' && notes.more > 0 && <Link to={tabHref(id, 'notes')} className={LINK_ALONE} data-testid="deal-case-notes-more">{notes.more} more in Notes</Link>}
          <div data-testid="deal-case-missing">
            {missing.state === 'loading' && <p className={`m-0 ${SUB}`}>Reading the scorecard…</p>}
            {missing.state === 'unreadable' && (
              <>
                <p className={`m-0 ${SUB}`}>What the scorecard is missing could not be read.</p>
                <TryAgain onClick={strips.retry} testId="deal-case-missing-retry" />
              </>
            )}
            {['some', 'none', 'closed'].includes(missing.state) && <p className={`m-0 ${missing.state === 'some' ? 'text-axal-ink dark:text-gray-100' : SUB}`}>{missing.line}</p>}
          </div>
        </div>
      </div>
    </section>
  );
}

export default function DealOverview({ deal, investor, position = null }) {
  const strips = useScopeStrips([Number(deal.id)]);
  return (
    <div className="flex flex-col gap-3.5" data-testid="deal-overview">
      {!investor && deal.description && <p className={`m-0 ${SUB}`}>{deal.description}</p>}
      {/* D4815 part 41 (#5904): DE04's grid, Scorecard beside What's new, Investment case beside Your position. */}
      <div className="grid gap-3.5 lg:grid-cols-12">
        <ScoreSummary dealId={deal.id} strips={strips} className={investor ? 'lg:col-span-7' : 'lg:col-span-12'} />
        {investor && <WhatsNew dealId={deal.id} className="lg:col-span-5" />}
        {investor && <InvestmentCase deal={deal} strips={strips} className="lg:col-span-7" />}
        {investor && position && <div className="flex min-w-0 flex-col lg:col-span-5">{position}</div>}
      </div>
      <div className="grid gap-3.5 lg:grid-cols-3">
        <section className={`${CARD} flex flex-col gap-1 px-4 py-4 lg:col-span-2`} data-testid="deal-details">
          <h3 className={H3}>About this deal</h3>
          <Row label="SPV jurisdiction" value={deal.spv_jurisdiction || 'Not recorded'} missing={!deal.spv_jurisdiction} />
          <Row label="Lead partner" value={deal.lead_partner_name || 'Not recorded'} missing={!deal.lead_partner_name} />
          <Row label="Days in stage" value={deal.days_in_stage == null ? 'Not recorded' : `${deal.days_in_stage} days`} missing={deal.days_in_stage == null} />
          <Row label="Website" missing={!deal.website}
            value={deal.website ? <a href={deal.website} target="_blank" rel="noreferrer" className="text-axal-violet-deep hover:underline dark:text-violet-300">{deal.website}</a> : 'Not recorded'} />
        </section>
        <div className="flex min-w-0 flex-col gap-3.5">
          <section className={`${CARD} flex flex-col gap-1 px-4 py-4`} data-testid="deal-terms">
            <h3 className={H3}>Terms at a glance</h3>
            {termsAtGlance(deal).map((t) => <Row key={t.label} {...t} />)}
            {investor && <Link to={`/deals/${deal.id}/terms`} className="mt-1 w-fit text-[12.5px] font-bold text-axal-violet-deep max-md:inline-flex max-md:min-h-[44px] max-md:items-center dark:text-violet-300">Full terms</Link>}
          </section>
          {/* D4815 part 4 (DE04): the round's size and committed total are the strip's, and the one next
              action is the header's, so neither is drawn again here. */}
          <section className={`${CARD} flex flex-col gap-2 px-4 py-4`} data-testid="deal-round">
            <h3 className={H3}>The round</h3>
            <p className={`m-0 ${SUB}`}>The round size and the committed total are in the strip above. Other investors’ names and amounts are not shown.</p>
          </section>
          {/* D6165 (#6165): the investor's granted deck; a founder or staff member reads none here. */}
          {investor && <DealDeckCard dealId={deal.id} />}
        </div>
      </div>
    </div>
  );
}
