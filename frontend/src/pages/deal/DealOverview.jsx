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
 * and risks and what the scorecard is missing; one case read since D9109)
 * beside Your position. Each block reads on its own and fails on its own,
 * with Try again. A founder and
 * studio staff keep the scorecard and the deal's details; the rest is the
 * investor's.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Unreadable } from '../../ui';
import { reportError } from '../../lib/log';
import { dealContextApi } from '../../lib/api/dealContext.js';
import { useActiveCompany } from '../../contexts/ActiveCompanyContext.js';
import { notesHref, tabHref } from '../dealPageModel';
import { CARD, EYE, SUB, H3 } from './DealFrame';
import {
  caseView, scoreSummary, termsAtGlance, whatsNewList, whatsNewOf,
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

/**
 * One read with its own state and Try again. `fetcher` is stable for the key. With `keep`, Try again
 * on a read that answered keeps that answer (marked `reloading`) until the new one arrives (D9109).
 */
function useRead(fetcher, key, where, { keep = false } = {}) {
  const [read, setRead] = useState({ status: 'loading' });
  const load = useCallback(() => {
    let alive = true;
    setRead((was) => (keep && was.status === 'ready' ? { ...was, reloading: true } : { status: 'loading' }));
    fetcher().then((data) => { if (alive) setRead({ status: 'ready', data }); })
      .catch((e) => { reportError(`DealOverview:${where}`, e); if (alive) setRead({ status: 'unreadable', error: e }); });
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
 * DE04's Investment case (D9109, #9109), from the one case read (`GET /api/deals/:id/case`, D6173).
 * Why this deal: the deal's summary, the investor's thesis fit with its reasons, and the main evidence
 * as counts (the case read logs no evidence open; the Evidence tab, where the open is real, stays the
 * way in). Beside it: the firm's notes tagged Question or Risk, then what the scorecard is missing.
 * Each block says why when it has nothing, and one Try again reads the case again while the blocks
 * that drew keep drawing.
 */
function InvestmentCase({ deal, className = '' }) {
  const id = deal.id;
  const { company } = useActiveCompany();
  const [read, retry] = useRead(() => dealContextApi.investmentCase(id), `case:${id}:${company?.id ?? ''}`, 'case', { keep: true });
  const v = caseView(read);
  if (v.state === 'hidden') return null;
  const reading = (testId) => <p className={`m-0 ${SUB}`} aria-live="polite" data-testid={testId}>Reading…</p>;
  const failed = (line, testId) => (
    <>
      <p className={`m-0 ${SUB}`} data-testid={testId}>{line}</p>
      <TryAgain onClick={retry} testId={`${testId}-retry`} />
    </>
  );
  /** One block's state: loading, its reason with Try again, or its own reason when nothing is recorded. */
  const unless = (b, testId, recorded) => {
    if (b.state === 'loading') return reading(`${testId}-reading`);
    if (b.state === 'unreadable') return failed(b.line, `${testId}-unreadable`);
    if (b.state === 'not_recorded') return <p className={`m-0 ${SUB}`} data-testid={`${testId}-none`}>{b.line}</p>;
    return recorded();
  };
  let why; let open;
  if (v.state === 'loading') { why = reading('deal-case-why-reading'); open = reading('deal-case-open-reading'); }
  else if (v.state === 'unreadable') { why = failed(v.why, 'deal-case-why-unreadable'); open = failed(v.open, 'deal-case-open-unreadable'); }
  else if (v.state === 'firm_required') {
    const ask = <p className={`m-0 ${SUB}`}>{v.line} Pick it in the company switcher, then the case reads again.</p>;
    why = <div data-testid="deal-case-firm">{ask}</div>;
    open = <div data-testid="deal-case-firm-open">{ask}</div>;
  } else {
    why = (
      <>
        <div className="flex flex-col gap-1" data-testid="deal-case-fit">
          {unless(v.fit, 'deal-case-fit', () => (
            <>
              <b className="text-axal-ink dark:text-gray-100">{v.fit.line}</b>
              {v.fit.reasons.length > 0 && <ul className="m-0 list-disc pl-4 text-axal-ink dark:text-gray-100">{v.fit.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
            </>
          ))}
        </div>
        <div className="flex flex-col gap-1" data-testid="deal-case-evidence">
          <span className="text-axal-muted dark:text-gray-400">Main evidence</span>
          {unless(v.evidence, 'deal-case-evidence', () => (
            <>
              <ul className="m-0 list-disc pl-4 text-axal-ink dark:text-gray-100" data-testid="deal-case-evidence-list">
                {v.evidence.rows.map((g) => <li key={g.key}>{g.text}{g.newest && <span className="text-axal-muted dark:text-gray-400"> · newest {g.newest}</span>}</li>)}
              </ul>
              {v.evidence.partial && <p className={`m-0 ${SUB}`} data-testid="deal-case-evidence-partial">{v.evidence.partial}</p>}
            </>
          ))}
          <Link to={tabHref(id, 'evidence')} className={LINK_ALONE}>Open the shared evidence</Link>
        </div>
      </>
    );
    open = (
      <>
        {unless(v.notes, 'deal-case-notes', () => (
          <ul className="m-0 list-disc pl-4 text-axal-ink dark:text-gray-100" data-testid="deal-case-notes">
            {v.notes.rows.map((n) => <li key={n.uid}><span className="text-axal-muted dark:text-gray-400">{n.tag}: </span>{n.text}</li>)}
          </ul>
        ))}
        {v.notes.state === 'not_recorded' && <Link to={notesHref(id)} className={LINK_ALONE} data-testid="deal-case-notes-add">Add one in Firm notes</Link>}
        {v.notes.state === 'recorded' && v.notes.more && <Link to={notesHref(id)} className={LINK_ALONE} data-testid="deal-case-notes-more">{v.notes.more}</Link>}
        <div className="flex flex-col gap-1" data-testid="deal-case-missing">
          {unless(v.missing, 'deal-case-missing', () => (
            <p className={`m-0 ${v.missing.thin ? 'text-axal-ink dark:text-gray-100' : SUB}`} data-testid="deal-case-missing-line">{v.missing.line}</p>
          ))}
        </div>
      </>
    );
  }
  return (
    <section className={`${CARD} flex min-w-0 flex-col gap-3 px-4 py-4 ${className}`} data-testid="deal-case">
      <h3 className={H3}>Investment case</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-2 text-[12.5px] leading-[1.55]" data-testid="deal-case-why">
          <span className={EYE}>Why this deal</span>
          {deal.description
            ? <p className="m-0 text-axal-ink dark:text-gray-100" data-testid="deal-case-summary">{deal.description}</p>
            : <p className={`m-0 ${SUB}`} data-testid="deal-case-summary">No summary is recorded on this deal.</p>}
          {why}
        </div>
        <div className="flex min-w-0 flex-col gap-2 text-[12.5px] leading-[1.55]" data-testid="deal-case-open">
          <span className={EYE}>Open questions · risks</span>
          {open}
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
        {investor && <InvestmentCase deal={deal} className="lg:col-span-7" />}
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
