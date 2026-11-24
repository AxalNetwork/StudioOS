/**
 * D6868 (#6868, canvas PRM18 and PRM19 of `Portfolio v2 Rights and Request a Mark`): the top of Ownership & rights on
 * a company's Financials tab — the holding line, then "Rights under your documents": the reporting duties row and
 * the six rights, each with its document and clause, what is recorded and what you can do, and the investor's
 * requests that HQ record a right. The duties table and the read-only cap table follow it on the page.
 *
 * Prop-driven for the holding line and the duties (the page owns those reads); the rights read and the ask are this
 * component's own, so a failed rights read says so here and leaves the duties and the cap table standing. There is
 * no primary action: a right changes only when the document is amended, and HQ records it.
 *
 * States, kept apart:
 *   loading        the rights are being read
 *   unreadable     they could not be read: Retry, and no ask, because whether a request is already open is unknown
 *   none           no duty and no right is recorded (PRM19 a): said plainly, with "Ask HQ to record a right…"
 *   rows           the seven rows; a right with no row reads "Not recorded at closing" with "Ask HQ to record…"
 *
 * D6908: the Pro rata row's "What you can do" also reads the company's live round and the caller's own offer
 * (`portfolioProRataApi.get`, `proRataOfferModel.js`): "Series A is live · offer to you: up to $310,000 · respond by
 * 30 Nov 2026" with Open the round →, "Offer not recorded" with the round still linked, or "No live round". That read
 * is separate: when it fails, the row says so with Retry and the rights stand.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { portfolioRightsApi } from '../../lib/api/portfolioRights';
import { portfolioProRataApi } from '../../lib/api/portfolioProRata';
import { usePortfolioReads } from './usePortfolioReads';
import { Skeleton, SourceFailure } from './PortfolioParts';
import {
  DESCRIPTION_MAX, NOT_RECORDED_AT_CLOSING, RIGHTS_SHAPE, RIGHT_WORDS, askProblem, askRefusal, askableTypes, holdingCells,
  nothingRecorded, requestRows, rightsRows,
} from './rightsModel';
import { NOT_RECORDED } from './portfolioModel';
import { PRO_RATA_SHAPE, proRataAction } from './proRataOfferModel';
// D6907 part 2: Eadwyn's proposal of a right that is in the signed paper but not recorded (PRM18 rail).
import ClauseProposals from './ClauseProposals';

function Holding({ cells }) {
  return (
    <div className="pf-rights-hold" role="group" aria-label="Your holding" data-testid="rights-holding">
      {cells.map((c) => (
        <div key={c.key} data-testid={`rights-holding-${c.key}`}>
          <span className="pf-rights-label">{c.label}</span>
          <strong>{c.value || <span className="pf-not-recorded">{NOT_RECORDED}</span>}</strong>
          {c.note ? <span className="pf-sm">{c.note}</span> : null}
        </div>
      ))}
    </div>
  );
}

function AskForm({ types, start, onSend, onCancel }) {
  const [type, setType] = useState(start && types.includes(start) ? start : types[0]);
  const [description, setDescription] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const send = async (e) => {
    e.preventDefault();
    const problem = askProblem({ type, description }, types);
    if (problem) { setError(problem); return; }
    setSending(true); setError(null);
    try { await onSend({ type, description: description.trim() }); } catch (err) { setError(askRefusal(err)); setSending(false); }
  };
  return (
    <form className="pf-rights-ask" onSubmit={send} aria-label="Ask HQ to record a right" data-testid="rights-ask-form">
      <label>
        <span className="pf-rights-label">Right</span>
        <select value={type} onChange={(e) => setType(e.target.value)} data-testid="rights-ask-type">
          {types.map((t) => <option key={t} value={t}>{RIGHT_WORDS[t]}</option>)}
        </select>
      </label>
      <label>
        <span className="pf-rights-label">Where it is written</span>
        <textarea rows={3} maxLength={DESCRIPTION_MAX} value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder="The document and its clause, e.g. Side letter of 3 Feb 2026, §2" data-testid="rights-ask-description" />
      </label>
      <p className="pf-sm">HQ reads the signed document and records the right, or declines with a reason you read here. Nothing is recorded until HQ does.</p>
      {error ? <p className="pf-rights-error" role="alert" data-testid="rights-ask-error">{error}</p> : null}
      <div className="pf-rights-actions">
        <button type="button" className="pf-btn" onClick={onCancel} disabled={sending} data-testid="button-rights-ask-cancel">Cancel</button>
        <button type="submit" className="pf-btn is-primary" disabled={sending} data-testid="button-rights-ask-send">{sending ? 'Sending…' : 'Send to HQ'}</button>
      </div>
    </form>
  );
}

function Requests({ rows }) {
  if (!rows.length) return null;
  return (
    <div className="pf-table-wrap" data-testid="rights-requests">
      <table className="pf-table">
        <caption>Your requests to record a right · newest first</caption>
        <thead><tr><th scope="col">Right</th><th scope="col">What you described</th><th scope="col">State</th></tr></thead>
        <tbody>
          {rows.map((q) => (
            <tr key={q.key} data-testid={`rights-request-${q.key}`}>
              <th scope="row" data-label="Right">{q.right}</th>
              <td data-label="Described">{q.described}</td>
              <td data-label="State">
                <span className={`pf-chip ${q.state === 'open' ? 'is-pending' : q.state === 'recorded' ? 'is-ok' : 'is-late'}`} data-testid={`rights-request-state-${q.key}`}>{q.stateText}</span>
                {q.note ? <small data-testid={`rights-request-note-${q.key}`}>HQ: {q.note}</small> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** D6908: the live round and the caller's own offer, beside the Pro rata row's other action. */
function ProRataAction({ action, onRetry }) {
  if (action.kind === 'loading') return <span className="pf-sm" data-testid="rights-pro-rata-round-loading">Reading the live round…</span>;
  if (action.kind === 'unreadable') {
    return (
      <span className="pf-sm" data-testid="rights-pro-rata-round-unreadable">
        {action.line} <button type="button" className="pf-btn is-quiet" onClick={onRetry} data-testid="button-retry-pro-rata">Retry</button>
      </span>
    );
  }
  if (action.kind === 'none') return <span className="pf-sm" data-testid="rights-pro-rata-no-round">{action.line}</span>;
  return (
    <span className="pf-rights-round" data-testid="rights-pro-rata-round">
      <span data-testid="rights-pro-rata-offer" data-recorded={action.offerRecorded ? 'yes' : 'no'}>{action.line}</span>
      {action.href
        ? <Link className="pf-btn is-quiet" to={action.href} data-testid="rights-pro-rata-open-round">Open the round →</Link>
        : action.hrefNote ? <small data-testid="rights-pro-rata-no-page">{action.hrefNote}</small> : null}
    </span>
  );
}

function RightsTable({ rows, canAsk, onAsk, reportsHref, proRata, onRetryProRata }) {
  return (
    <div className="pf-table-wrap">
      <table className="pf-table pf-rights-table" data-testid="rights-table">
        <caption>{rows.length} rights · from the documents you signed · read only</caption>
        <thead><tr><th scope="col">Right</th><th scope="col">Source · document and clause</th><th scope="col">What is recorded</th><th scope="col">What you can do</th></tr></thead>
        <tbody>
          {rows.map((r) => {
            if (r.kind === 'duties') {
              return (
                <tr key={r.key} data-testid="rights-row-reporting">
                  <th scope="row" data-label="Right">{r.label}</th>
                  <td data-label="Source">{r.state === 'recorded' ? 'Listed below, each with its clause' : r.state === 'none' ? '—' : null}</td>
                  <td data-label="Recorded">
                    {r.state === 'recorded' ? `${r.count} ${r.count === 1 ? 'duty' : 'duties'} · listed below`
                      : r.state === 'none' ? <span className="pf-chip is-none">None</span>
                        : r.state === 'unreadable' ? <span className="pf-chip is-unreadable">Unreadable · see below</span>
                          : <span className="pf-sm">Reading…</span>}
                  </td>
                  <td data-label="You can">{reportsHref ? <Link className="pf-btn is-quiet" to={reportsHref} data-testid="rights-see-reporting">See reporting →</Link> : null}</td>
                </tr>
              );
            }
            return (
              <tr key={r.key} data-testid={`rights-row-${r.type}`} data-state={r.state}>
                <th scope="row" data-label="Right">{r.label}</th>
                <td data-label="Source">
                  {r.source ? <>{r.source.doc}<small>{r.source.signed}</small></> : <span className="pf-chip is-none">{NOT_RECORDED_AT_CLOSING}</span>}
                </td>
                <td data-label="Recorded">{r.terms || <span className="pf-not-recorded">{NOT_RECORDED_AT_CLOSING}</span>}</td>
                <td data-label="You can">
                  {r.type === 'pro_rata' && proRata ? <ProRataAction action={proRata} onRetry={onRetryProRata} /> : null}
                  {r.state === 'recorded' ? <span className="pf-sm">Read only</span>
                    : r.open ? <span className="pf-chip is-pending" data-testid={`rights-open-${r.type}`}>Requested{r.open.since ? ` · ${r.open.since}` : ''}</span>
                      : canAsk ? <button type="button" className="pf-btn" onClick={() => onAsk(r.type)} data-testid={`button-rights-ask-${r.type}`}>Ask HQ to record…</button>
                        : <span className="pf-sm">No action until HQ records it</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * `position` is the caller's position from the positions read; `route` the holding route the duties record;
 * `duties` `{ state, count }` from the duties read; `reportsHref` the company's Reports tab.
 */
export default function OwnershipRights({ uid, position, route, duties, reportsHref, canAsk = true }) {
  const sources = useMemo(() => ({
    rights: { call: () => portfolioRightsApi.company(uid), shape: RIGHTS_SHAPE },
    // D6908: read on its own, so a failed round read leaves the rights standing and says so in the Pro rata row.
    proRata: { call: () => portfolioProRataApi.get(uid), shape: PRO_RATA_SHAPE },
  }), [uid]);
  const { reads, retry } = usePortfolioReads(sources);
  const [asking, setAsking] = useState(null);
  const [sent, setSent] = useState(null);
  const read = reads.rights;

  const send = async ({ type, description }) => {
    await portfolioRightsApi.ask({ projectUid: uid, type, description });
    setAsking(null);
    setSent(`Sent. HQ answers on this page: Recorded, or Declined with a reason.`);
    retry('rights');
  };

  // Kept outside `body` so a refreshed rights read does not unmount Eadwyn's card; null while the rights are unread.
  const proposable = read.state === 'ok' && canAsk ? askableTypes(rightsRows(read.value, duties)) : null;

  let body;
  if (read.state === 'loading') {
    body = <Skeleton rows={3} />;
  } else if (read.state !== 'ok') {
    body = (
      <SourceFailure what="Your rights in this company" claim="That is not a claim that none is recorded. The duties and the cap table below are read on their own."
        onRetry={() => retry('rights')} testid="rights-unreadable" retryTestid="button-retry-rights" />
    );
  } else {
    const rows = rightsRows(read.value, duties);
    const askable = askableTypes(rows);
    const reqs = requestRows(read.value.requests);
    const empty = nothingRecorded(rows);
    body = (
      <>
        {empty ? (
          <div className="pf-rights-empty" data-testid="rights-none">
            <b>Your documents grant no reporting duty, and no other right is recorded.</b>
            <p className="pf-sm">The duties read succeeded and returned none; HQ recorded no right at closing. If a document you signed grants one, ask HQ to record it.</p>
          </div>
        ) : (
          <RightsTable rows={rows} canAsk={canAsk && askable.length > 0} onAsk={(t) => { setSent(null); setAsking({ type: t }); }} reportsHref={reportsHref}
            proRata={proRataAction(reads.proRata)} onRetryProRata={() => retry('proRata')} />
        )}
        {asking ? (
          <AskForm types={askable} start={asking.type} onSend={send} onCancel={() => setAsking(null)} />
        ) : canAsk && askable.length ? (
          empty ? <div className="pf-rights-actions"><button type="button" className="pf-btn is-primary" onClick={() => { setSent(null); setAsking({ type: null }); }} data-testid="button-rights-ask">Ask HQ to record a right…</button></div> : null
        ) : null}
        {sent ? <p className="pf-sm" role="status" data-testid="rights-ask-sent">{sent}</p> : null}
        <Requests rows={reqs} />
      </>
    );
  }

  return (
    <>
      <Holding cells={holdingCells(position, route)} />
      <section className="pf-card pf-rights-card" aria-labelledby="pf-co-rights-list" data-testid="company-rights">
        <div className="pf-card-head">
          <h3 className="pf-h2" id="pf-co-rights-list">Rights under your documents</h3>
          <span className="pf-chip">Read only</span>
        </div>
        <p className="pf-sm">Each right names its document and clause, or says {NOT_RECORDED_AT_CLOSING}. Nothing here is inferred. To change a right, the document is amended.</p>
        {body}
      </section>
      {canAsk ? (
        <ClauseProposals uid={uid} askable={proposable}
          onSent={(type) => { setSent(`Sent to HQ: ${RIGHT_WORDS[type]}, from Eadwyn’s proposal. HQ answers on this page: Recorded, or Declined with a reason.`); retry('rights'); }} />
      ) : null}
    </>
  );
}
