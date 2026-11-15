/**
 * D4817 part 5 (#5311, canvas PF-05, addendum PFA08 and PFA12): the investor's
 * Value-add, in the shared Portfolio frame (`tab="value-add"`), at
 * `/portfolio/value-add`.
 *
 * In the canvas's order: the figure row (open commitments, in progress,
 * delivered, introductions made, overdue commitments, no support recorded),
 * the line saying what the ledger does not record, and the commitments table
 * (company, support item, owner, state, recorded, delivered, next or linked).
 * Then the introductions the ledger records, each with its meeting Not
 * recorded, and the Eadwyn summary band.
 *
 * ONE STORE. `portfolio_support_entries` (canvas IP3, migration 237) is read by
 * `GET /api/portfolio-support`: every row was written by a member recording
 * their own work. Introductions requested through the quota, dealroom
 * membership and calendar activity are access, not support, and none of them
 * is read into this page. The ledger records Promised, Delivered and
 * Withdrawn (D4642 added amendments and their history); In progress,
 * Cancelled, a due date and the meetings resulting are not recorded, and read
 * Not recorded with that reason, never 0.
 *
 * Every read stands alone (`usePortfolioReads`): the ledger, its figures (their
 * own aggregate read on the Worker, `totals: null` when it fails), a filtered
 * or later page of the commitments, and one entry's history. A failed one
 * reads Unreadable with a Retry for that source, and never as an empty ledger.
 * Writes (Log support, Mark delivered, Withdraw) report against the one entry
 * or form they touched, and leave the ledger's read standing.
 */
import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../hooks/useAuthSync';
import { WorkerRail } from '../../ui';
import { FillFormBar, FillLabel, useScopedFill } from '../../ui/useScopedFill.jsx';
import { SCOPED_FORMS } from '../../lib/fillScoped.js';
import { ZoneHeaderTools } from '../../workspaces/ZoneHeader';
import ZoneToolbar from '../../workspaces/ZoneToolbar';
import ZoneDraft from '../../workspaces/ZoneDraft';
import { investorZoneActions } from '../../workspaces/investorZoneActions';
import { investorZoneFilters } from '../../workspaces/investorZoneFilters';
import PortfolioFrame from '../portfolio/PortfolioFrame';
import { usePortfolioReads } from '../portfolio/usePortfolioReads';
import { FinancialMetric, Skeleton, SourceFailure } from '../portfolio/PortfolioParts';
import {
  HISTORY_LABEL, KINDS, NOT_IN_LEDGER, NOT_RECORDED, commitmentsOf, companySupportOf, figuresOf, hoursOf,
  inView, introductionsOf, ledgerParams, ledgerShape, totalsOf,
} from '../portfolio/valueAddModel';
import { day } from '../portfolio/portfolioModel';
import '../portfolio/valueAdd.css';

const SOURCES = {
  ledger: { call: () => api.portfolioSupportList(), shape: ledgerShape },
};

const companyHref = (uid) => `/portfolio/companies/${encodeURIComponent(uid)}`;
const LEDGER_CLAIM = 'That is not a claim that no support was given.';

export default function InvestorPortfolioValueAdd() {
  const { user } = useAuth();
  const me = user?.id ?? null;
  const { reads, retry } = usePortfolioReads(SOURCES);
  const ledger = reads.ledger;
  const [filter, setFilter] = useState('all');
  const [offset, setOffset] = useState(0);
  const [pageKey, setPageKey] = useState(0);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState('');
  // D4642: the outcome of a write against ONE entry, named. It is kept apart
  // from the ledger's read: a refused Deliver says nothing about whether the
  // ledger could be read.
  const [notice, setNotice] = useState(null);
  // The Mark delivered / Withdraw confirmation (PFA08): the entry, the act and
  // a failed save's message, kept in place until the member confirms or cancels.
  const [confirming, setConfirming] = useState(null);
  // D4642: the amendment history of ONE entry, read on demand.
  const [history, setHistory] = useState(null);

  const companies = ledger.state === 'ok' ? ledger.value.companies : [];
  const figures = useMemo(() => figuresOf(ledger), [ledger]);
  const hours = useMemo(() => hoursOf(ledger), [ledger]);
  const intros = useMemo(() => introductionsOf(ledger, me), [ledger, me]);
  const byCompany = filter === 'company';
  const pagedView = !byCompany && (filter !== 'all' || offset > 0);

  /** Read the ledger and the commitments view again, each on its own. */
  const reload = useCallback(() => { retry('ledger'); setPageKey((n) => n + 1); }, [retry]);

  const logSupport = useCallback(() => {
    setForm((current) => (current ? null : { project_uid: '', kind: 'intro', state: 'promised', hours: '', summary: '', outcome: '', error: '', invalid: null }));
  }, []);
  const changeFilter = useCallback((next) => { setOffset(0); setFilter(next); setConfirming(null); }, []);
  const byCompanyView = useCallback(() => { changeFilter('company'); }, [changeFilter]);

  // D1595 (#3868) / D1424 (#3700): Ask on Log support's "What happened". The
  // Add form's parent is the chosen company's project id; nothing is read
  // until one is chosen. Outcome and hours are never filled.
  const parentId = form?.project_uid ? Number(companies.find((x) => x.project_uid === form.project_uid)?.project_id) || null : null;
  const fill = useScopedFill({
    scope: SCOPED_FORMS.support, parent: parentId, enabled: !!parentId,
    values: { summary: form?.summary || '' },
    onValues: (v) => setForm((current) => (current ? { ...current, ...v, error: '' } : current)),
  });

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return; // D4642: one pending save per card; a second submit waits
    if (!form?.project_uid || !form.summary.trim()) {
      setForm((current) => ({
        ...current,
        invalid: !current.project_uid ? 'company' : 'summary',
        error: !current.project_uid ? 'Choose the company this support is for.' : 'Describe the support before saving.',
      }));
      return;
    }
    // D4642: the draft's company must still be one this book holds.
    if (!companies.some((x) => x.project_uid === form.project_uid)) {
      setForm((current) => ({
        ...current,
        invalid: 'company',
        error: 'That company is no longer in this book, so this entry cannot be recorded against it. Pick a company again.',
      }));
      return;
    }
    setBusy('log');
    try {
      const created = await api.portfolioSupportLog({
        project_uid: form.project_uid,
        kind: form.kind,
        state: form.state,
        // An empty field is sent as absent, never as 0 — the store keeps
        // "nobody timed this" apart from "it took no time".
        ...(form.hours === '' ? {} : { hours: Number(form.hours) }),
        summary: form.summary.trim(),
        ...(form.outcome.trim() ? { outcome: form.outcome.trim() } : {}),
      });
      setForm(null);
      await fill.afterSave(created?.item?.id);
      reload();
    } catch (error) {
      // PFA08: the entries stay in the form, and the form says it did not save.
      setForm((current) => ({ ...current, invalid: null, error: `This did not save. Your entries are kept.${error?.message ? ` ${error.message}` : ''}`, failed: true }));
    } finally { setBusy(''); }
  };

  // D4642: one entry's transition, sent with the record and the revision the
  // page read, so the server refuses a stale edit instead of overwriting a
  // newer one. The outcome is reported against THAT entry.
  const move = async (row, next) => {
    if (busy) return; // a pending save owns the ledger until it settles
    setBusy(row.uid);
    setNotice(null);
    try {
      await api.portfolioSupportUpdate(row.uid, {
        state: next,
        project_uid: row.project_uid ?? undefined,
        ...(row.revision == null ? {} : { expected_revision: Number(row.revision) }),
      });
      setConfirming(null);
      reload();
    } catch (error) {
      const company = row.project_name || error?.data?.project_name || null;
      if (error?.code === 'changed_since_open') {
        // Someone else's change is the accepted one: read the ledger again so
        // the page shows their work, and say so.
        setConfirming(null);
        setNotice({
          entryUid: row.uid, kind: 'conflict',
          message: `${company ? `${company}: ` : ''}someone else changed this entry since this page read it. Their change is shown. Apply yours again if it still applies.`,
        });
        reload();
        return;
      }
      if (error?.code === 'state_is_terminal') {
        setConfirming(null);
        setNotice({ entryUid: row.uid, kind: 'blocked', message: `${company ? `${company}: ` : ''}${error?.message || 'this entry is already closed.'}` });
        return;
      }
      // PFA08: a failed save leaves the entry and its confirmation in place.
      setConfirming((current) => (current && current.uid === row.uid
        ? { ...current, error: `${company ? `${company}: ` : ''}this did not save. ${error?.message || 'The entry is unchanged.'}` }
        : current));
    } finally { setBusy(''); }
  };

  // Toggling, so a second click closes. A failed read is reported in place,
  // with its own Retry: an unreadable history is not an empty one.
  const readHistory = async (row) => {
    setHistory({ uid: row.uid, loading: true, error: false, items: [] });
    try {
      const result = await api.portfolioSupportHistory(row.uid);
      setHistory((h) => (h?.uid === row.uid ? { uid: row.uid, loading: false, error: false, items: Array.isArray(result?.items) ? result.items : [] } : h));
    } catch {
      setHistory((h) => (h?.uid === row.uid ? { uid: row.uid, loading: false, error: true, items: [] } : h));
    }
  };
  const openHistory = (row) => {
    if (history?.uid === row.uid) { setHistory(null); return; }
    readHistory(row);
  };

  const table = {
    filter, me, busy, history, confirming, noticeFor: notice?.entryUid || null,
    onAsk: (row, next) => { setNotice(null); setConfirming({ uid: row.uid, next, error: '' }); },
    onCancel: () => setConfirming(null),
    onConfirm: move,
    onHistory: openHistory,
    onHistoryRetry: readHistory,
    onPage: setOffset,
  };

  const totalsLost = ledger.state === 'ok' && !totalsOf(ledger);
  return (
    <PortfolioFrame
      tab="value-add"
      testid="investor-portfolio-value-add"
      description="Support promised and delivered to each company, with who recorded it and when."
      context="Support ledger · every entry recorded by a member"
      tools={(
        <ZoneHeaderTools role="investor">
          <button type="button" className="pf-icon-button" onClick={reload} aria-label="Reload the support ledger" data-testid="button-refresh-investor-value-add"><RefreshCw size={15} aria-hidden="true" /></button>
        </ZoneHeaderTools>
      )}
      notice={ledger.state === 'unreadable' ? (
        <SourceFailure what="The support ledger" claim={LEDGER_CLAIM} onRetry={() => retry('ledger')} testid="status-investor-value-add-error" retryTestid="button-retry-value-add-ledger" />
      ) : null}
      rail={<ValueAddRail ledger={ledger} />}
    >
      {/* D4642: ONE entry's write outcome, naming its company and the next action. */}
      {notice ? (
        <div className={notice.kind === 'conflict' ? 'pf-partial va-notice' : 'pf-failure'} role="status" data-testid={`status-va-support-${notice.kind}`}>
          <span>{notice.message}</span>
          <button type="button" className="pf-link-button" onClick={() => { setNotice(null); reload(); }}>Reload the ledger</button>
        </div>
      ) : null}

      <section className="pf-card va-figures-card" aria-labelledby="va-figures-title" data-testid="va-figures">
        <h2 id="va-figures-title" className="pf-sr">Support at a glance</h2>
        {totalsLost ? (
          <SourceFailure what="The ledger’s figures" claim="No count is shown in their place; the entries below were read." onRetry={() => retry('ledger')} testid="status-va-figures-unreadable" retryTestid="button-retry-va-figures" />
        ) : null}
        <div className="va-figures">
          {figures.map((f) => <FinancialMetric key={f.key} metric={f} onRetry={f.state === 'unreadable' ? () => retry('ledger') : undefined} />)}
        </div>
        <p className="pf-foot" data-testid="va-hours">
          Hours recorded: <b>{hours.state === 'loading' ? 'Reading…' : hours.text}</b>{hours.note ? ` · ${hours.note}` : ''}
        </p>
        <p className="pf-foot" data-testid="va-not-in-ledger">
          The ledger records Promised, Delivered and Withdrawn. In progress, Cancelled, a due date for a commitment and the meetings that came of an introduction are not recorded by it, so they read {NOT_RECORDED}.
        </p>
      </section>

      {form ? <LogForm form={form} setForm={setForm} companies={companies} onSubmit={submit} busy={busy === 'log'} onCancel={logSupport} fill={fill} /> : null}

      <section className="pf-card pf-table-card" aria-labelledby="va-commitments-title" data-testid="va-commitments">
        <div className="pf-card-head">
          <div>
            <h2 id="va-commitments-title">{byCompany ? 'Per-company support' : 'Commitments'}</h2>
            <p className="pf-sm">{byCompany ? 'Every company in the book, including those with nothing recorded' : filter === 'outstanding' ? 'Promised entries, still open' : filter === 'delivered' ? 'Delivered entries' : 'Promised, delivered and withdrawn, newest first'}</p>
          </div>
        </div>
        <ZoneToolbar
          role="investor"
          className="pf-toolbar"
          filters={investorZoneFilters('portfolio/value-add', { value: filter, onChange: changeFilter })}
          actions={investorZoneActions('portfolio/value-add', {
            handlers: { logSupport, byCompany: byCompanyView },
            view: {
              header: ['Company', 'Kind', 'State', 'Hours', 'What happened', 'Outcome'],
              rows: commitmentsOf(ledger, me).map((c) => c.row).filter(inView(filter)),
              cells: (row) => [row.project_name, row.kind, row.state, row.hours, row.summary, row.outcome],
            },
          })}
        />
        {byCompany ? <PerCompany read={ledger} onRetry={() => retry('ledger')} />
          : pagedView ? (
            <PagedCommitments key={`${filter}:${offset}:${pageKey}`} params={ledgerParams(filter, offset)}>
              {(read, again) => <Commitments read={read} onRetry={again} {...table} />}
            </PagedCommitments>
          ) : <Commitments read={ledger} onRetry={() => retry('ledger')} {...table} />}
        <p className="pf-foot va-boundary"><b>Evidence boundary.</b> Every row here was written by a person recording their own work. Introductions requested through the quota, dealroom membership and calendar activity are access, not support, and none of them is read into this ledger.</p>
      </section>

      <Introductions intros={intros} onRetry={() => retry('ledger')} />

      {/* The artboard's band. Accepting a draft stamps `accepted_at` and
          nothing else, and no LP report reads this store, so the foot says so. */}
      <ZoneDraft
        surface="portfolio/value-add"
        railOption="draft:support-summary"
        label="Proposal · quarterly support summary"
        accept="Accept summary"
        run="Draft the summary"
        foot="Drafted from the ledger rows, including the unkept promises. Accepting keeps the summary here — nothing carries it into an LP report."
        empty="Per company: what was delivered, what is still owed, and the hours recorded — written so an unmade promise appears rather than being rounded away."
        nothingToDraft="No support entry is recorded against an accessible company, so there is nothing to summarise."
      />
      <p className="pf-boundary">Investor workspace. The ledger is restricted to this investor’s accessible portfolio.</p>
    </PortfolioFrame>
  );
}

/** A filtered or later page of the commitments: its own read, retried on its own. */
function PagedCommitments({ params, children }) {
  const sources = useMemo(() => ({ page: { call: () => api.portfolioSupportList(params), shape: ledgerShape } }), [params]);
  const { reads, retry } = usePortfolioReads(sources);
  return children(reads.page, () => retry('page'));
}

/**
 * The commitments table (canvas PF-05): company, support item, owner, state,
 * recorded, delivered, next or linked, and the row's act. `Mark delivered…`
 * and `Withdraw…` confirm in place, naming the entry and the company
 * (PFA08); a closed entry offers its recorded history.
 */
function Commitments({ read, onRetry, filter, me, busy, history, confirming, noticeFor, onAsk, onCancel, onConfirm, onHistory, onHistoryRetry, onPage }) {
  if (read.state === 'loading') return <div className="va-pad"><Skeleton rows={3} /></div>;
  if (read.state === 'unreadable') {
    return <div className="va-pad"><SourceFailure what="The support ledger" claim={LEDGER_CLAIM} onRetry={onRetry} testid="status-va-commitments-unreadable" retryTestid="button-retry-va-commitments" /></div>;
  }
  const rows = commitmentsOf(read, me).filter(inView(filter));
  const page = read.value.page;
  if (!rows.length) {
    return (
      <p className="pf-note va-pad-note" data-testid="va-commitments-empty">
        <b>{filter === 'outstanding' ? 'No promise is outstanding.' : filter === 'delivered' ? 'No entry is recorded as delivered.' : 'No support entry is recorded yet.'}</b>{' '}
        {filter === 'all' ? 'The ledger is empty because nothing has been logged, not because nothing was done. Log support records the first entry.' : 'Every recorded entry sits under another state.'}
      </p>
    );
  }
  return (
    <>
      <div className="pf-table-wrap">
        <table className="pf-table va-table">
          <caption>Support ledger · {rows.length} {rows.length === 1 ? 'entry' : 'entries'} on this page</caption>
          <thead><tr>
            <th scope="col">Company</th><th scope="col">Support item</th><th scope="col">Owner</th><th scope="col">State</th>
            <th scope="col">Recorded</th><th scope="col">Delivered</th><th scope="col">Next / linked</th><th scope="col"><span className="pf-sr">Act</span></th>
          </tr></thead>
          <tbody>
            {rows.map((c) => (
              <CommitmentRow key={c.uid} c={c} busy={busy} history={history} confirming={confirming} contested={noticeFor === c.uid}
                onAsk={onAsk} onCancel={onCancel} onConfirm={onConfirm} onHistory={onHistory} onHistoryRetry={onHistoryRetry} />
            ))}
          </tbody>
        </table>
      </div>
      {page && (page.offset > 0 || page.next_offset != null) ? (
        <nav aria-label="Support ledger pages" className="va-pages">
          <button type="button" className="pf-btn" disabled={!page.offset || Boolean(busy)} onClick={() => onPage(Math.max(0, page.offset - page.limit))}>Previous</button>
          <span aria-live="polite">{page.offset + 1}–{page.offset + read.value.entries.length} of {page.matching_total ?? page.total} matching entries</span>
          <button type="button" className="pf-btn" disabled={page.next_offset == null || Boolean(busy)} onClick={() => onPage(page.next_offset)}>Next</button>
        </nav>
      ) : null}
    </>
  );
}

function CommitmentRow({ c, busy, history, confirming, contested, onAsk, onCancel, onConfirm, onHistory, onHistoryRetry }) {
  const asking = confirming?.uid === c.uid ? confirming : null;
  const open = history?.uid === c.uid ? history : null;
  return (
    <>
      <tr data-testid={`row-va-commitment-${c.uid}`} data-state={c.state} className={contested ? 'is-contested' : undefined}>
        <th scope="row" data-label="Company">
          {c.companyUid ? <Link className="pf-co" to={companyHref(c.companyUid)}>{c.company}</Link> : <span className="pf-co">{c.company}</span>}
          <small>{c.kind}</small>
        </th>
        <td data-label="Support item">{c.summary}<small>Hours: {c.hours}</small></td>
        <td data-label="Owner"><span title={c.owner.note || undefined}>{c.owner.text}</span></td>
        <td data-label="State"><span className={`pf-chip va-state is-${c.state}`}>{c.stateLabel}</span></td>
        <td data-label="Recorded" className="va-date">{c.recorded || 'Date not recorded'}{c.promised ? <small>promised {c.promised}</small> : null}</td>
        <td data-label="Delivered" className="va-date">
          {c.closed.date ? (c.state === 'withdrawn' ? `Withdrawn ${c.closed.date}` : c.closed.date) : <span className="pf-not-recorded">{c.closed.missing}</span>}
        </td>
        <td data-label="Next / linked">
          {c.outcome ? <>Outcome: {c.outcome}</> : <span className="pf-not-recorded">No outcome recorded yet</span>}
          {c.isIntro ? <small data-testid={`va-meeting-${c.uid}`}>Meeting resulting: <span className="pf-not-recorded" title={NOT_IN_LEDGER.meeting}>{NOT_RECORDED}</span></small> : null}
        </td>
        <td data-label="Act" className="va-act">
          {c.state === 'promised' ? (
            <span className="va-moves">
              <button type="button" className="pf-btn" disabled={!!busy} onClick={() => onAsk(c.row, 'delivered')} data-testid={`button-va-deliver-${c.uid}`}>Mark delivered…</button>
              <button type="button" className="pf-btn is-quiet" disabled={!!busy} onClick={() => onAsk(c.row, 'withdrawn')} data-testid={`button-va-withdraw-${c.uid}`}>Withdraw…</button>
            </span>
          ) : null}
          {c.revision > 1 ? (
            <button type="button" className="pf-btn is-quiet" onClick={() => onHistory(c.row)} aria-expanded={!!open} data-testid={`button-va-history-${c.uid}`}>
              {open ? 'Hide history' : `History · amended ${c.revision - 1} ${c.revision === 2 ? 'time' : 'times'}`}
            </button>
          ) : c.state !== 'promised' ? <small>Not amended since it was recorded</small> : null}
        </td>
      </tr>
      {asking ? (
        <tr className="va-sub"><td colSpan={8}>
          <div className="va-confirm" role="group" aria-label={`Confirm for ${c.company}`} data-testid={`va-confirm-${c.uid}`}>
            <p>
              {asking.next === 'delivered'
                ? <>Mark “{c.summary}” for <b>{c.company}</b> as delivered? Today’s date is recorded as the delivery date, and a delivered entry cannot be reopened.</>
                : <>Withdraw “{c.summary}” for <b>{c.company}</b>? The entry stays in the ledger as withdrawn and cannot be reopened.</>}
            </p>
            {asking.error ? <p className="va-error" role="alert" data-testid={`va-confirm-error-${c.uid}`}>{asking.error}</p> : null}
            <div className="pf-tools">
              <button type="button" className="pf-btn is-primary" disabled={!!busy} onClick={() => onConfirm(c.row, asking.next)} data-testid={`button-va-confirm-${c.uid}`}>
                {busy === c.uid ? 'Saving…' : asking.error ? 'Try saving again' : asking.next === 'delivered' ? 'Mark delivered' : 'Withdraw entry'}
              </button>
              <button type="button" className="pf-btn" disabled={busy === c.uid} onClick={onCancel}>Cancel</button>
            </div>
          </div>
        </td></tr>
      ) : null}
      {open ? (
        <tr className="va-sub"><td colSpan={8}>
          <div className="va-history" data-testid={`history-va-support-${c.uid}`}>
            {open.loading ? <small>Reading the history…</small>
              : open.error ? <SourceFailure what="This entry’s history" claim="The entry itself is as shown." onRetry={() => onHistoryRetry(c.row)} testid={`status-va-history-unreadable-${c.uid}`} retryTestid={`button-retry-va-history-${c.uid}`} />
                : open.items.length === 0 ? <small>No amendment is recorded.</small>
                  : (
                    <ul>{open.items.map((item) => (
                      <li key={item.uid}>
                        <b>{HISTORY_LABEL[item.action] || item.action}</b>
                        <span>{` by ${item.actor?.name || 'a member no longer on the account'}`}</span>
                        <small>{`${day(item.created_at) || 'Date not recorded'} · revision ${item.revision}${item.changed?.length ? ` · ${item.changed.join(', ')}` : ''}`}</small>
                      </li>
                    ))}</ul>
                  )}
          </div>
        </td></tr>
      ) : null}
    </>
  );
}

/** The introductions the ledger records, each with its meeting Not recorded and why. */
function Introductions({ intros, onRetry }) {
  let body;
  if (intros.state === 'loading') body = <Skeleton rows={2} />;
  else if (intros.state === 'unreadable') body = <SourceFailure what="Introductions" claim="That is not a claim that none was made." onRetry={onRetry} testid="status-va-intros-unreadable" retryTestid="button-retry-va-intros" />;
  else if (!intros.rows.length) {
    body = (
      <p className="pf-note" data-testid="va-intros-none">
        <span className="pf-not-recorded">{NOT_RECORDED}</span> · {intros.complete ? 'No introduction entry is recorded in the support ledger.' : 'No introduction entry is among the entries read.'}
      </p>
    );
  } else {
    body = (
      <div className="pf-table-wrap">
        <table className="pf-table va-table" data-testid="va-intros-table">
          <caption>Introduction entries · {intros.rows.length}</caption>
          <thead><tr>
            <th scope="col">Company</th><th scope="col">Introduction</th><th scope="col">State</th><th scope="col">Recorded</th><th scope="col">Delivered</th><th scope="col">Meeting resulting</th>
          </tr></thead>
          <tbody>
            {intros.rows.map((c) => (
              <tr key={c.uid} data-testid={`row-va-intro-${c.uid}`} data-state={c.state}>
                <th scope="row" data-label="Company">{c.companyUid ? <Link className="pf-co" to={companyHref(c.companyUid)}>{c.company}</Link> : <span className="pf-co">{c.company}</span>}</th>
                <td data-label="Introduction">{c.summary}{c.outcome ? <small>Outcome: {c.outcome}</small> : null}</td>
                <td data-label="State"><span className={`pf-chip va-state is-${c.state}`}>{c.stateLabel}</span></td>
                <td data-label="Recorded" className="va-date">{c.recorded || 'Date not recorded'}</td>
                <td data-label="Delivered" className="va-date">{c.closed.date || <span className="pf-not-recorded">{c.closed.missing}</span>}</td>
                <td data-label="Meeting resulting"><span className="pf-not-recorded">{NOT_RECORDED}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <section className="pf-card" aria-labelledby="va-intros-title" data-testid="va-intros">
      <div className="pf-card-head">
        <h2 id="va-intros-title">Introductions</h2>
        {intros.state === 'ok' && intros.complete ? <span className="pf-sm">{intros.delivered} delivered · {intros.promised} promised</span> : null}
      </div>
      {intros.state === 'ok' && !intros.complete ? <p className="pf-partial" data-testid="va-intros-partial">{intros.reason}</p> : null}
      {body}
      <p className="pf-foot">
        These are the introduction entries members recorded in the support ledger. Meetings resulting: <span className="pf-not-recorded">{NOT_RECORDED}</span> — {NOT_IN_LEDGER.meeting.charAt(0).toLowerCase()}{NOT_IN_LEDGER.meeting.slice(1)} An introduction requested through the quarterly quota is access to a company, not support given to one, and is not counted here.
      </p>
    </section>
  );
}

/**
 * The per-company rollup — the `By company` chip and the `Per-company view`
 * op. A company with no entry is shown WITH the others rather than hidden.
 */
function PerCompany({ read, onRetry }) {
  if (read.state === 'loading') return <div className="va-pad"><Skeleton rows={3} /></div>;
  if (read.state === 'unreadable') return <div className="va-pad" data-testid="va-per-company"><SourceFailure what="The support ledger" claim={LEDGER_CLAIM} onRetry={onRetry} testid="status-va-per-company-unreadable" /></div>;
  const rows = companySupportOf(read);
  return (
    <div data-testid="va-per-company">
      {!rows.length ? <p className="pf-note va-pad-note">No accessible portfolio company is recorded for this investor.</p> : (
        <div className="pf-table-wrap">
          <table className="pf-table va-table">
            <caption>Per company · all entries in scope</caption>
            <thead><tr>
              <th scope="col">Company</th><th scope="col" className="n">Entries</th><th scope="col" className="n">Delivered</th>
              <th scope="col" className="n">Outstanding</th><th scope="col" className="n">Withdrawn</th><th scope="col" className="n">Hours</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} data-testid={`row-va-company-${r.key}`}>
                  <th scope="row" data-label="Company">
                    {r.uid ? <Link className="pf-co" to={companyHref(r.uid)}>{r.name}</Link> : <span className="pf-co">{r.name}</span>}
                    {r.entries === 0 ? <small>No support recorded</small> : null}
                  </th>
                  <td className="n" data-label="Entries">{r.entries}</td>
                  <td className="n" data-label="Delivered">{r.delivered}</td>
                  <td className="n" data-label="Outstanding">{r.promised}</td>
                  <td className="n" data-label="Withdrawn">{r.withdrawn}</td>
                  <td className="n" data-label="Hours">{r.hours}{r.untimed > 0 && r.untimed < r.entries ? <small>{r.untimed} without hours</small> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="pf-foot va-pad-note"><b>Counting rule.</b> A company counts as supported when it has a recorded entry, never because it is in the book, sent an update, or appears in an introduction row.</p>
    </div>
  );
}

/**
 * The `Log support` op (addendum PFA08): labelled fields, the error tied to
 * its field, and a failed save that keeps every entry.
 */
function LogForm({ form, setForm, companies, onSubmit, busy, onCancel, fill = null }) {
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value, error: '', invalid: null, failed: false }));
  const companyError = form.invalid === 'company';
  const summaryError = form.invalid === 'summary';
  return (
    <form className="pf-card va-form" onSubmit={onSubmit} data-testid="va-log-support" noValidate>
      <div className="pf-card-head">
        <div><h2>Log support</h2><p className="pf-sm">One entry, against one company in this book. Owner: you.</p></div>
        <button type="button" className="pf-btn" onClick={onCancel}>Cancel</button>
      </div>
      <div className="va-fields">
        <label htmlFor="va-company">Company</label>
        <select id="va-company" value={form.project_uid} onChange={set('project_uid')} aria-invalid={companyError || undefined} aria-describedby={companyError ? 'va-form-error' : undefined}>
          <option value="">Choose a company</option>
          {companies.filter((x) => x.project_uid).map((x) => <option key={x.project_id} value={x.project_uid}>{x.name}</option>)}
        </select>
        <label htmlFor="va-kind">Support type</label>
        <select id="va-kind" value={form.kind} onChange={set('kind')}>{KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <label htmlFor="va-state">State</label>
        <select id="va-state" value={form.state} onChange={set('state')}><option value="promised">Promised</option><option value="delivered">Delivered</option></select>
        {/* Blank is sent as absent. An hours box that defaulted to 0 would put
            a measured zero in the ledger for every entry nobody timed. */}
        <label htmlFor="va-hours">Hours</label>
        <input id="va-hours" type="number" min="0" step="0.5" value={form.hours} onChange={set('hours')} placeholder="Leave blank if untimed" />
      </div>
      <FillFormBar fill={fill} />
      <div className="va-wide">
        <FillLabel fill={fill} name="summary" label="What happened" value={form.summary}><label htmlFor="va-summary">What happened</label></FillLabel>
        <textarea id="va-summary" rows={2} value={form.summary} onChange={set('summary')} placeholder="Introduced them to a buyer at …"
          aria-invalid={summaryError || undefined} aria-describedby={summaryError ? 'va-form-error' : undefined} />
      </div>
      <div className="va-wide">
        <label htmlFor="va-outcome">Outcome <em>(optional)</em></label>
        <textarea id="va-outcome" rows={2} value={form.outcome} onChange={set('outcome')} placeholder="Leave blank until something comes of it" />
      </div>
      {form.error ? <p id="va-form-error" className="va-error" role="alert" data-testid="va-form-error">{form.error}</p> : null}
      <div className="pf-tools">
        <button type="submit" className="pf-btn is-primary" disabled={busy} data-testid="button-va-record">{busy ? 'Recording…' : form.failed ? 'Try saving again' : 'Record entry'}</button>
      </div>
    </form>
  );
}

function ValueAddRail({ ledger }) {
  const t = totalsOf(ledger);
  return (
    <WorkerRail
      workspace="Portfolio"
      role="investor"
      className="pf-rail"
      stance="Support ledger"
      note="Recorded support work, written by the people who did it. Introductions requested through the quota, dealroom membership and calendar activity are never relabelled as value-add."
      coverage={[
        ledger.state === 'loading' ? 'Reading the support ledger'
          : !t ? 'Support ledger figures unreadable'
            : `${t.entries} recorded ${t.entries === 1 ? 'entry' : 'entries'} across ${t.companies_in_book} accessible ${t.companies_in_book === 1 ? 'company' : 'companies'}`,
        !t ? 'Hours unavailable' : `${t.entries_without_hours} ${t.entries_without_hours === 1 ? 'entry carries' : 'entries carry'} no hour count`,
      ]}
      unavailable={[
        ['Inferred support', 'A company is counted as supported only from a recorded entry, never from the position book, an update, or an introduction row.'],
        ['Outbound', 'Nothing is sent to a company from this page; recording that support happened does not perform it.'],
      ]}
    />
  );
}
