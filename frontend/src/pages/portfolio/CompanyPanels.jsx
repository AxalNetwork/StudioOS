/**
 * D4817 part 6 (#5311, canvas PF-06 B, D and E; addendum PFA08, PFA12): three
 * of the company workspace's tabs, drawn from the pure `companyModel.js`.
 *
 *   - `CompanyFinancials`: investment history, return, valuation marks and
 *     distributions, from `GET /api/positions/:uid`, read and retried on its
 *     own. A per-company IRR and a financial action history are not recorded
 *     by the platform, and say so.
 *   - `CompanySupport`: this company's entries on the support ledger, each
 *     with its recorded history on request (`/api/portfolio-support/:uid/
 *     history`). Recording or amending support stays on Value-add.
 *   - `CompanyActivity` (D6227): one timeline, newest first, from the
 *     Worker's joined read `GET /api/positions/:uid/activity`; a source that
 *     failed is named with its own Retry, and older pages are read on request.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { positionActivityApi } from '../../lib/api/positionActivity';
import { NOT_RECORDED } from '../../lib/absence';
import { usePortfolioReads } from './usePortfolioReads';
import { FinancialMetric, Skeleton, SourceFailure } from './PortfolioParts';
import { day, markHistoryOf } from './portfolioModel';
import {
  COMPANY_SHAPES, activityOf, distributionsOf, returnOf, roundsOf, supportOf,
} from './companyModel';

const NR = ({ children = NOT_RECORDED, title }) => <span className="pf-not-recorded" title={title}>{children}</span>;

/** One company's `GET /api/positions/:uid`, read and retried on its own. */
function useDetail(uid) {
  const sources = useMemo(() => ({ detail: { call: () => api.positionsByProject(encodeURIComponent(uid)), shape: COMPANY_SHAPES.detail } }), [uid]);
  return usePortfolioReads(sources);
}

/* -------------------------------------------------------------- Financials */

export function CompanyFinancials({ uid, held }) {
  const { reads, retry } = useDetail(uid);
  const d = reads.detail;
  if (d.state === 'loading') return <section className="pf-card" data-testid="company-financials-loading"><Skeleton rows={3} /></section>;
  if (d.state === 'unreadable') {
    return (
      <section className="pf-card" aria-labelledby="pf-co-fin">
        <h2 className="pf-h2" id="pf-co-fin">Investment history, return and marks</h2>
        <SourceFailure what="This company’s rounds, marks and distributions" claim="No empty history or zero is shown in their place." onRetry={() => retry('detail')} testid="company-financials-unreadable" retryTestid="button-retry-company-financials" />
      </section>
    );
  }
  const detail = d.value;
  const rounds = roundsOf(detail);
  const marks = markHistoryOf(detail, { date: null });
  const dists = distributionsOf(detail);
  return (
    <>
      <div className="pf-co-fin">
        <section className="pf-card pf-table-card" aria-labelledby="pf-co-rounds" data-testid="company-rounds">
          <div className="pf-card-head"><h2 id="pf-co-rounds">Investment history · gross</h2></div>
          {rounds.rows.length ? (
            <div className="pf-table-wrap">
              <table className="pf-table">
                <caption>Every round recorded for {held ? 'your position' : 'this company'}, oldest first</caption>
                <thead><tr><th scope="col">Date</th><th scope="col">Round</th><th scope="col" className="n">Amount</th><th scope="col" className="n">Ownership after</th><th scope="col" className="n">Shares</th><th scope="col" className="n">Price / share</th></tr></thead>
                <tbody>
                  {rounds.rows.map((r) => (
                    <tr key={r.key} data-testid={`company-round-${r.key}`}>
                      <th scope="row" data-label="Date">{r.date || <NR />}</th>
                      <td data-label="Round">{r.round || <NR />}</td>
                      <td className="n" data-label="Amount">{r.amount || <NR />}</td>
                      <td className="n" data-label="Ownership after">{r.ownership || <NR />}</td>
                      <td className="n" data-label="Shares">{r.shares || <NR />}</td>
                      <td className="n" data-label="Price / share">{r.price || <NR />}</td>
                    </tr>
                  ))}
                  <tr className="pf-total" data-testid="company-rounds-total">
                    <th scope="row" data-label="Total">Total</th>
                    <td data-label="Round">{rounds.rows.length} {rounds.rows.length === 1 ? 'round' : 'rounds'}</td>
                    <td className="n" data-label="Amount">{rounds.total.amount}</td>
                    <td className="n" data-label="Ownership after">{rounds.total.ownership || <NR />}</td>
                    <td colSpan={2} className="pf-total-note">{rounds.total.missing ? `${rounds.total.missing} round${rounds.total.missing === 1 ? '' : 's'} with no amount recorded, left out of the total` : ''}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : <p className="pf-note" data-testid="company-rounds-none">No round is recorded for this company.</p>}
          <p className="pf-foot">The document behind each round is not part of this read.</p>
        </section>
        <section className="pf-card" aria-labelledby="pf-co-return" data-testid="company-return">
          <h2 className="pf-h2" id="pf-co-return">Return</h2>
          <div className="pf-co-metrics">{returnOf(detail).map((m) => <FinancialMetric key={m.key} metric={m} />)}</div>
        </section>
      </div>
      <section className="pf-card pf-table-card" aria-labelledby="pf-co-marks" data-testid="company-marks">
        <div className="pf-card-head"><h2 id="pf-co-marks">Valuation marks</h2><span className="pf-sm">Newest first</span></div>
        {marks.rows.length ? (
          <div className="pf-table-wrap">
            <table className="pf-table">
              <caption>Each mark with its date, event, basis and source</caption>
              <thead><tr><th scope="col">As of</th><th scope="col" className="n">FMV</th><th scope="col" className="n">Post-money</th><th scope="col">Event</th><th scope="col">Basis</th><th scope="col">Source</th></tr></thead>
              <tbody>
                {marks.rows.map((m) => (
                  <tr key={m.key} data-testid={`company-mark-${m.key}`}>
                    <th scope="row" data-label="As of">{m.date || <NR />}</th>
                    <td className="n" data-label="FMV">{m.fmv || <NR />}</td>
                    <td className="n" data-label="Post-money">{m.postMoney || <NR />}</td>
                    <td data-label="Event">{m.event || <NR />}</td>
                    <td data-label="Basis">{m.basis || <NR />}</td>
                    <td data-label="Source">{m.source || <NR />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="pf-note" data-testid="company-marks-none">No mark is recorded for this company. The position carries at cost for NAV until one is.</p>}
        <p className="pf-foot">Who recorded each mark is not part of this read. A priced round and a GP estimate are both marks and are never shown alike.</p>
      </section>
      <section className="pf-card pf-table-card" aria-labelledby="pf-co-dists" data-testid="company-distributions">
        <div className="pf-card-head"><h2 id="pf-co-dists">Distributions</h2></div>
        {dists.length ? (
          <div className="pf-table-wrap">
            <table className="pf-table">
              <caption>Realisations recorded against this company, newest first</caption>
              <thead><tr><th scope="col">Date</th><th scope="col" className="n">Amount</th><th scope="col">Kind</th><th scope="col">Note</th></tr></thead>
              <tbody>
                {dists.map((x) => (
                  <tr key={x.key} data-testid={`company-distribution-${x.key}`}>
                    <th scope="row" data-label="Date">{x.date || <NR />}</th>
                    <td className="n" data-label="Amount">{x.amount || <NR />}</td>
                    <td data-label="Kind">{x.kind || <NR />}</td>
                    <td data-label="Note">{x.note || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="pf-note" data-testid="company-distributions-none">No distribution is recorded for this company: $0 has come back.</p>}
      </section>
      <p className="pf-note" data-testid="company-financial-history">Financial action history — drafts, edits and who changed which figure — is {NOT_RECORDED.toLowerCase()}: the platform keeps each mark and round, not a log of changes to them.</p>
    </>
  );
}

/* ----------------------------------------------------------------- Support */

function EntryHistory({ uid }) {
  const sources = useMemo(() => ({ history: { call: () => api.portfolioSupportHistory(uid), shape: (v) => Array.isArray(v.items) } }), [uid]);
  const { reads, retry } = usePortfolioReads(sources);
  const h = reads.history;
  if (h.state === 'loading') return <Skeleton rows={1} />;
  if (h.state === 'unreadable') return <SourceFailure what="This entry’s history" claim="It is not a claim that nothing changed." onRetry={() => retry('history')} testid={`company-support-history-unreadable-${uid}`} retryTestid={`button-retry-support-history-${uid}`} />;
  if (!h.value.items.length) return <p className="pf-foot">No change is recorded for this entry.</p>;
  return (
    <ul className="pf-hist" data-testid={`company-support-history-${uid}`}>
      {h.value.items.map((e) => (
        <li key={e.uid || e.revision}>
          <span>{day(e.created_at) || NOT_RECORDED}</span>
          <span>{[e.to_state ? `${String(e.to_state).replace(/^\w/, (c) => c.toUpperCase())}` : e.action, e.actor?.name ? `by ${e.actor.name}` : null].filter(Boolean).join(' · ')}</span>
        </li>
      ))}
    </ul>
  );
}

export function CompanySupport({ uid, name, read, onRetry }) {
  const [open, setOpen] = useState(null);
  const s = supportOf(read, uid);
  return (
    <section className="pf-card" aria-labelledby="pf-co-support" data-testid="company-support">
      <div className="pf-card-head">
        <h2 className="pf-h2" id="pf-co-support">Support for {name}</h2>
        <Link className="pf-btn is-primary" to="/portfolio/value-add" data-testid="link-company-record-support">Record support…</Link>
      </div>
      {s.state === 'loading' ? <Skeleton rows={2} /> : null}
      {s.state === 'unreadable' ? <SourceFailure what="The support ledger" claim="It is not a claim that no support was given." onRetry={onRetry} testid="company-support-unreadable" retryTestid="button-retry-company-support" /> : null}
      {s.state === 'ok' ? (
        <>
          {s.figuresUnreadable ? <p className="pf-partial" data-testid="company-support-figures-unreadable">The ledger’s counts could not be read; the entries below are the page that was.</p> : null}
          {s.totals ? (
            <p className="pf-sm" data-testid="company-support-totals">{s.totals.promised} promised · {s.totals.delivered} delivered · {s.totals.withdrawn} withdrawn · {s.totals.hours} h recorded{s.totals.withoutHours ? ` · ${s.totals.withoutHours} with no hours recorded` : ''}</p>
          ) : null}
          {s.entries.length ? (
            <div className="pf-table-wrap">
              <table className="pf-table">
                <caption>Each entry, its state and its dates as recorded</caption>
                <thead><tr><th scope="col">Item</th><th scope="col">State</th><th scope="col">Promised</th><th scope="col">Delivered</th><th scope="col" className="n">Hours</th><th scope="col">History</th></tr></thead>
                <tbody>
                  {s.entries.map((e) => (
                    <React.Fragment key={e.key}>
                      <tr data-testid={`company-support-${e.uid}`}>
                        <th scope="row" data-label="Item">{e.summary || <NR />}{e.kind ? <small>{e.kind}</small> : null}{e.outcome ? <small>{e.outcome}</small> : null}</th>
                        <td data-label="State"><span className={`pf-chip ${e.stateKey === 'delivered' ? 'is-ok' : e.stateKey === 'promised' ? 'is-pending' : 'is-none'}`}>{e.state}</span></td>
                        <td data-label="Promised">{e.promised || <NR />}</td>
                        <td data-label="Delivered">{e.delivered || (e.withdrawn ? `Withdrawn ${e.withdrawn}` : <NR />)}</td>
                        <td className="n" data-label="Hours">{e.hours || <NR />}</td>
                        <td data-label="History">
                          <button type="button" className="pf-link-button" aria-expanded={open === e.uid} onClick={() => setOpen(open === e.uid ? null : e.uid)} data-testid={`button-company-support-history-${e.uid}`}>{open === e.uid ? 'Hide' : 'History'}</button>
                        </td>
                      </tr>
                      {open === e.uid ? <tr><td colSpan={6}><EntryHistory uid={e.uid} /></td></tr> : null}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="pf-note" data-testid="company-support-none">{s.inLedger ? `No support is recorded for ${name}.` : `${name} is not in your support ledger.`}</p>
          )}
          {s.beyondPage ? <p className="pf-foot" data-testid="company-support-more">{s.beyondPage} older {s.beyondPage === 1 ? 'entry' : 'entries'} for this company {s.beyondPage === 1 ? 'is' : 'are'} on later pages of the ledger, in Value-add.</p> : null}
          <p className="pf-foot" data-testid="company-support-scope">Support is Promised, Delivered or Withdrawn as recorded. Owners, due dates, In progress, Cancelled and the meetings that came of it are {NOT_RECORDED.toLowerCase()}: the ledger does not keep them. Recording, delivering and withdrawing stay on Value-add.</p>
        </>
      ) : null}
    </section>
  );
}

/* ---------------------------------------------------------------- Activity */

const SOURCES = [['all', 'All'], ['financial', 'Financial'], ['reports', 'Reports'], ['support', 'Support']];

/** D6227: the company's joined activity, read and retried as one Worker read. */
function useActivity(uid) {
  const sources = useMemo(() => ({ activity: { call: () => positionActivityApi.companyActivity(uid), shape: COMPANY_SHAPES.activity } }), [uid]);
  return usePortfolioReads(sources);
}

export function CompanyActivity({ uid }) {
  const [show, setShow] = useState('all');
  const { reads, retry } = useActivity(uid);
  const read = reads.activity;
  // Older pages, read on request from the cursor the last page gave. Dropped when the first page is read again.
  const [older, setOlder] = useState({ items: [], cursor: undefined, state: 'idle' });
  useEffect(() => { setOlder({ items: [], cursor: undefined, state: 'idle' }); }, [read]);
  const cursor = older.cursor !== undefined ? older.cursor : (read.state === 'ok' ? read.value.page?.next_cursor || null : null);
  const readOlder = () => {
    if (!cursor) return;
    setOlder((o) => ({ ...o, state: 'loading' }));
    Promise.resolve().then(() => positionActivityApi.companyActivity(uid, { before: cursor })).then(
      (v) => {
        if (!v || !Array.isArray(v.items)) { setOlder((o) => ({ ...o, state: 'unreadable' })); return; }
        setOlder((o) => ({ items: [...o.items, ...v.items], cursor: v.page?.next_cursor || null, state: 'idle' }));
      },
      () => setOlder((o) => ({ ...o, state: 'unreadable' })),
    );
  };
  const tl = activityOf(read, show, older.items);
  const none = show === 'all' ? 'No activity is recorded for this company.' : `No ${SOURCES.find(([k]) => k === show)[1].toLowerCase()} activity is recorded for this company.`;
  return (
    <>
      <div className="pf-card-head">
        <div className="pf-seg" role="group" aria-label="Activity source">
          {SOURCES.map(([k, label]) => <button key={k} type="button" aria-pressed={show === k} onClick={() => setShow(k)} data-testid={`button-company-activity-${k}`}>{label}</button>)}
        </div>
      </div>
      <section className="pf-card" aria-labelledby="pf-co-act" data-testid="company-activity-timeline">
        <h2 className="pf-h2" id="pf-co-act">Activity · newest first</h2>
        {tl.state === 'loading' ? <Skeleton rows={3} /> : null}
        {tl.state === 'unreadable' ? <SourceFailure what="This company’s activity" claim="It is not a claim that nothing happened." onRetry={() => retry('activity')} testid="company-activity-unreadable" retryTestid="button-retry-company-activity" /> : null}
        {tl.state === 'ok' ? (
          <>
            {tl.failed.map((f) => <SourceFailure key={f.source} what={f.what} claim="Its events are missing from this timeline; it is not a claim that none happened." onRetry={() => retry('activity')} testid={`company-activity-${f.source}-unreadable`} retryTestid={`button-retry-company-activity-${f.source}`} />)}
            {tl.outOfScope.map((f) => <p key={f.source} className="pf-note" data-testid={`company-activity-${f.source}-out-of-scope`}>{f.what}: {f.reason || NOT_RECORDED}</p>)}
            {tl.rows.length ? (
              <ul className="pf-hist" data-testid="company-activity-rows">
                {tl.rows.map((e) => <li key={e.key} data-testid={`company-activity-row-${e.key}`}><span>{e.date || NOT_RECORDED}</span><span>{e.href ? <Link to={e.href}>{e.text}</Link> : e.text}</span></li>)}
              </ul>
            ) : <p className="pf-note" data-testid="company-activity-none">{tl.complete ? none : 'Nothing is recorded in the sources that answered.'}</p>}
            {older.state === 'unreadable' ? <SourceFailure what="Older activity" claim="The rows above stand." onRetry={readOlder} testid="company-activity-older-unreadable" retryTestid="button-retry-company-activity-older" /> : null}
            {cursor && older.state !== 'unreadable' ? <button type="button" className="pf-link-button" onClick={readOlder} disabled={older.state === 'loading'} data-testid="button-company-activity-older">{older.state === 'loading' ? 'Reading…' : 'Show older activity'}</button> : null}
          </>
        ) : null}
      </section>
      <p className="pf-note" data-testid="company-activity-joined">One timeline, newest first: investments, valuation marks, distributions, the reports you received and their corrections, your own asks and waivers, and support with its amendments. Another investor’s asks, waivers and names are never in it.</p>
    </>
  );
}
