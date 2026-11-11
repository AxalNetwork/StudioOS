import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WorkerRail } from '../../ui';
import ZoneHeader from '../../workspaces/ZoneHeader';
import { ZonePrimaryScope } from '../../workspaces/ZoneActions';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { api } from '../../lib/api';
import { FillFormBar, FillLabel, useScopedFill } from '../../ui/useScopedFill.jsx';
import { SCOPED_FORMS } from '../../lib/fillScoped.js';
import './investorPortfolioCanvas.css';
import './investorPortfolioValueAdd.css';
import ZoneToolbar from '../../workspaces/ZoneToolbar';
import ZoneDraft from '../../workspaces/ZoneDraft';
import { investorZoneActions } from '../../workspaces/investorZoneActions';
import { investorZoneFilters } from '../../workspaces/investorZoneFilters';

/**
 * Portfolio · Value-add — canvas IP3, the one zone in this series whose
 * `unbuilt` reasons were all TRUE.
 *
 * Five zones before it carried a sentence that the schema contradicted. This
 * one said "no support ledger exists to write to", and the schema agreed:
 * every table joining an investor to a company records the investor gaining
 * ACCESS to one — an intro REQUESTED against a paid quota, a dealroom joined, a
 * data room granted — never work done for one. Migration 237's header lists
 * them and why each fails.
 *
 * So this page was not corrected, it was built. `portfolio_support_entries` is
 * the store, `GET /portfolio-support` is the read, and the four chips are the
 * predicates over `state` that the artboard always specified.
 *
 * THE PAGE PREVIOUSLY MADE NO `api.*` CALL AT ALL and its four chips were dead
 * for a good reason. They are live now because there is something to filter.
 */

const KINDS = [
  ['intro', 'Introduction'],
  ['board_prep', 'Board prep'],
  ['hiring', 'Hiring'],
  ['customer', 'Customer'],
  ['fundraising', 'Fundraising'],
  ['other', 'Other'],
];
const KIND_LABEL = Object.fromEntries(KINDS);
const STATE_LABEL = { promised: 'Promised', delivered: 'Delivered', withdrawn: 'Withdrawn' };
// D4642: an amendment's own verb. `amended` covers a change that moved no
// state, which the other two labels would misreport as a transition.
const HISTORY_LABEL = { amended: 'Amended', delivered: 'Delivered', withdrawn: 'Withdrawn' };
const dateLabel = (value) => (value ? new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null);
/**
 * Hours, and the one place a zero must not be manufactured.
 *
 * `null` means nobody recorded a duration; `0` means someone recorded that it
 * took none. The column and every total keep them apart (D56/D68), which is
 * why the route returns `entries_without_hours` beside the sum instead of
 * folding the unmeasured entries in at zero.
 */
const hoursLabel = (value) => (value == null ? 'Not recorded' : `${Number(value).toLocaleString('en-US', { maximumFractionDigits: 12 })} h`);

const EMPTY = {
  entries: [], companies: [], untouched: [],
  totals: {
    delivered: 0, promised: 0, withdrawn: 0, entries: 0, hours_recorded: 0,
    entries_without_hours: 0, companies_in_book: 0, companies_supported: 0,
  },
};

export default function InvestorPortfolioValueAdd() {
  const [filter, setFilter] = useState('all');
  const [offset, setOffset] = useState(0);
  const generation = useRef(0);
  const [state, setState] = useState({ loading: true, error: '', data: EMPTY });
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState('');
  // D4642 (#4642): the outcome of a write against ONE entry, named. It is kept
  // apart from `state.error`, which means the LEDGER READ failed: a refused
  // Deliver used to be written into that field, so one entry's 409 blanked
  // every stat to "Unavailable" and the page said the ledger could not be
  // read — about a ledger it had just read.
  const [notice, setNotice] = useState(null);
  // D4642: the amendment history of ONE entry, fetched on demand. The ledger
  // row carries the latest state; `recorded_by` says who created the entry.
  // Neither says who amended it, which is the question a second member's edit
  // raises, so the row offers the recorded history rather than the page
  // guessing from what changed.
  const [history, setHistory] = useState(null);

  const load = useCallback(async () => {
    const request = ++generation.current;
    setState((current) => ({ ...current, loading: true, error: '' }));
    try {
      const params = {};
      if (offset) params.offset = offset;
      if (filter === 'outstanding' || filter === 'delivered') params.state = filter === 'outstanding' ? 'promised' : 'delivered';
      const result = await api.portfolioSupportList(params);
      if (request !== generation.current) return;
      if (offset && result?.entries?.length === 0) {
        setOffset(Math.max(0, offset - (result.page?.limit || offset)));
        return;
      }
      setState({ loading: false, error: '', data: { ...EMPTY, ...result, totals: { ...EMPTY.totals, ...(result?.totals || {}) } } });
    } catch (error) {
      if (request !== generation.current) return;
      // An unreadable ledger is not an empty one. The page says which it is
      // rather than drawing the empty state over a failed read.
      setState({ loading: false, error: error?.message || 'The support ledger could not be read.', data: EMPTY });
    }
  }, [filter, offset]);
  useEffect(() => { load(); }, [load]);

  const { entries, companies, untouched, totals, page } = state.data;
  // `company` is a VIEW, not a row predicate — the rollup rather than a
  // narrower set of entries. The other three read `state` directly.
  const byCompany = filter === 'company';
  const visible = useMemo(() => entries.filter((row) => (
    filter === 'delivered' ? row.state === 'delivered'
      : filter === 'outstanding' ? row.state === 'promised'
        : true
  )), [entries, filter]);

  const logSupport = useCallback(() => {
    setForm((current) => (current ? null : { project_uid: '', kind: 'intro', state: 'promised', hours: '', summary: '', outcome: '', error: '' }));
  }, []);
  const changeFilter = useCallback((next) => { setOffset(0); setFilter(next); }, []);
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
      setForm((current) => ({ ...current, error: 'A company and a description of what happened are both required.' }));
      return;
    }
    // D4642: the draft's company must still be one this book holds. Without
    // this the form kept a `project_uid` the reloaded book no longer has and
    // sent it, and the member read "Project not found" about a company they
    // had picked from this very list.
    if (!companies.some((x) => x.project_uid === form.project_uid)) {
      setForm((current) => ({
        ...current,
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
      await load();
    } catch (error) {
      setForm((current) => ({ ...current, error: error?.message || 'That entry could not be recorded.' }));
    } finally { setBusy(''); }
  };

  // D4642: one entry's transition. The request says which record and which
  // revision it means, so the server can refuse a stale edit instead of
  // overwriting a newer one; the outcome is reported against THAT entry.
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
      await load();
    } catch (error) {
      const company = row.project_name || error?.data?.project_name || null;
      if (error?.code === 'changed_since_open') {
        // Someone else's change is the accepted one. Take the row the server
        // handed back so the page shows their work rather than this stale copy,
        // and say so instead of silently discarding either edit.
        const fresh = error?.data?.item || null;
        if (fresh) {
          setState((current) => ({
            ...current,
            data: {
              ...current.data,
              entries: current.data.entries.map((x) => (x.uid === row.uid ? { ...x, ...fresh } : x)),
            },
          }));
        }
        setNotice({
          entryUid: row.uid, kind: 'conflict',
          message: `${company ? `${company}: ` : ''}someone else changed this entry since this page read it. Their change is shown. Apply yours again if it still applies.`,
        });
        return;
      }
      setNotice({
        entryUid: row.uid,
        kind: error?.code === 'state_is_terminal' ? 'blocked' : 'error',
        message: `${company ? `${company}: ` : ''}${error?.message || 'that entry could not be updated.'}`,
      });
    } finally { setBusy(''); }
  };

  // Toggling, so a second click closes rather than re-fetching. A failed fetch
  // is reported in place: an unreadable history is not an empty one, and the
  // row's own state is not in doubt because of it.
  const openHistory = async (row) => {
    if (history?.uid === row.uid) { setHistory(null); return; }
    setHistory({ uid: row.uid, loading: true, error: '', items: [] });
    try {
      const result = await api.portfolioSupportHistory(row.uid);
      setHistory({ uid: row.uid, loading: false, error: '', items: result?.items || [] });
    } catch (error) {
      setHistory({ uid: row.uid, loading: false, error: error?.message || 'This entry\u2019s history could not be read.', items: [] });
    }
  };

  const unreadable = Boolean(state.error);
  const totalsUnreadable = unreadable || state.data.page_state === 'unreadable';
  const hours = totals.entries > 0 && totals.entries_without_hours === totals.entries
    ? 'Not recorded'
    : hoursLabel(totals.hours_recorded);

  return <ZonePrimaryScope><div className="i4-shell ip3-shell"><main className="i4-portfolio ip3-value-add" data-testid="investor-portfolio-value-add">
    <ZoneHeader bucketPath="/portfolio" title="Value-add desk" intro="Support ledger — introductions, hours and outcomes per company."
      refresh={<button type="button" className="i4-icon-button" onClick={load} aria-label="Reload the support ledger"><RefreshCw size={15} /></button>} />
    <ZoneToolbar
      role="investor"
      className="mb-3"
      filters={investorZoneFilters('portfolio/value-add', { value: filter, onChange: changeFilter })}
      actions={investorZoneActions('portfolio/value-add', {
        handlers: { logSupport, byCompany: byCompanyView },
        view: {
          header: ['Company', 'Kind', 'State', 'Hours', 'What happened', 'Outcome'],
          rows: visible,
          cells: (row) => [row.project_name, KIND_LABEL[row.kind] || row.kind, STATE_LABEL[row.state] || row.state, row.hours, row.summary, row.outcome],
        },
      })}
    />
    {state.error && <div className="i4-error" data-testid="status-investor-value-add-error"><span>The support ledger could not be read. That is not a claim that no support was given.</span><button type="button" onClick={load}>Retry</button></div>}
    {/* D4642: ONE entry's write outcome, naming the entry's company and the
        next action. The ledger beside it stays readable, because it was read. */}
    {notice && <div className={notice.kind === 'conflict' ? 'i4-notice' : 'i4-error'} data-testid={`status-ip3-support-${notice.kind}`}>
      <span>{notice.message}</span>
      <button type="button" onClick={() => { setNotice(null); load(); }}>Reload the ledger</button>
    </div>}
    {state.loading ? <Skeleton /> : <>
      <section className="i4-stats">
        <Stat label="Delivered" value={totalsUnreadable ? 'Unavailable' : totals.delivered} note={totalsUnreadable ? 'Ledger totals unavailable' : `${totals.companies_supported} of ${totals.companies_in_book} ${totals.companies_in_book === 1 ? 'company' : 'companies'} in the book`} />
        <Stat label="Hours logged" value={totalsUnreadable ? 'Unavailable' : hours} note={totalsUnreadable ? 'Ledger totals unavailable' : totals.entries_without_hours === 0 ? (totals.entries ? 'Every entry carries an hour count' : 'No entry is recorded yet') : `${totals.entries_without_hours} ${totals.entries_without_hours === 1 ? 'entry carries' : 'entries carry'} no hours and ${totals.entries_without_hours === 1 ? 'is' : 'are'} not counted`} />
        <Stat label="Outstanding" value={totalsUnreadable ? 'Unavailable' : totals.promised} note={totalsUnreadable ? 'Ledger totals unavailable' : 'Promised and not yet delivered'} />
        <Stat label="No support at all" value={totalsUnreadable ? 'Unavailable' : untouched.length} note={totalsUnreadable ? 'Ledger totals unavailable' : untouched.length ? untouched.map((x) => x.name).join(', ') : 'Every company in the book has an entry'} />
      </section>
      {form && <LogForm form={form} setForm={setForm} companies={companies} onSubmit={submit} busy={busy === 'log'} onCancel={logSupport} fill={fill} />}
      {byCompany
        ? <PerCompany companies={companies} unreadable={unreadable} />
        : <section className="i4-card i4-positions ip3-ledger"><div className="i4-section-head"><div><h2>Support ledger</h2><p>{filter === 'outstanding' ? 'Promised entries, still open' : filter === 'delivered' ? 'Delivered entries' : `${visible.length} of ${entries.length} recorded ${entries.length === 1 ? 'entry' : 'entries'}`}</p></div><span>Promised entries stay visible until delivered or withdrawn</span></div><Ledger rows={visible} filter={filter} unreadable={unreadable} onMove={move} busy={busy} history={history} onHistory={openHistory} noticeFor={notice?.entryUid || null} /><p className="i4-seam-note"><span>Evidence boundary</span> Every row here was written by a person recording their own work. Introductions requested through the quota, dealroom membership and calendar activity are access, not support, and none of them is read into this ledger.</p></section>}
      {!byCompany && !totalsUnreadable && page && (page.offset > 0 || page.next_offset != null) && (
        <nav aria-label="Support ledger pages" className="flex flex-wrap items-center gap-3 py-2 text-sm">
          <button type="button" className="underline disabled:opacity-40" disabled={!page.offset || Boolean(busy)}
            onClick={() => setOffset(Math.max(0, page.offset - page.limit))}>Previous</button>
          <span aria-live="polite">{page.offset + 1}–{page.offset + entries.length} of {page.matching_total ?? page.total} matching entries</span>
          <button type="button" className="underline disabled:opacity-40" disabled={page.next_offset == null || Boolean(busy)}
            onClick={() => setOffset(page.next_offset)}>Next</button>
        </nav>
      )}
      {/* The artboard's band. Its foot read "Feeds the LP reporting pack." —
          false: accepting a draft stamps `accepted_at` and nothing else, and
          no LP report reads this store, so the foot now says what happens. */}
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
      <footer className="i4-boundary">Investor workspace · the ledger is restricted to this investor’s accessible portfolio.</footer>
    </>}
  </main><ValueAddRail totals={totals} unreadable={totalsUnreadable} /></div></ZonePrimaryScope>;
}

/**
 * The ledger. `Deliver` and `Withdraw` are the reason this table is a ledger
 * rather than a list: without a transition the `state` column would freeze at
 * `promised`, which is the exact defect that makes `investor_introductions`
 * useless for this purpose — its status is written once and updated by nothing.
 */
function Ledger({ rows, filter, unreadable, onMove, busy, history = null, onHistory = null, noticeFor = null }) {
  if (unreadable) return <div className="i4-empty"><AlertCircle size={16} />The support ledger could not be read. No claim is being made about what was or was not done.</div>;
  if (!rows.length) {
    return <div className="i4-empty ip3-empty"><AlertCircle size={18} /><div><strong>{filter === 'outstanding' ? 'No promise is outstanding.' : filter === 'delivered' ? 'No entry is recorded as delivered.' : 'No support entry is recorded yet.'}</strong><p>{filter === 'all' ? 'The ledger is empty because nothing has been logged, not because nothing was done. Log support records the first entry.' : 'Every recorded entry sits under another state.'}</p></div></div>;
  }
  return <div className="i4-table-wrap"><table><thead><tr><th>Company</th><th>Kind</th><th>State</th><th>Hours</th><th>What happened</th></tr></thead><tbody>{rows.map((row) => <tr key={row.uid} data-testid={`row-ip3-support-${row.uid}`} className={noticeFor === row.uid ? 'is-contested' : undefined}>
    <td><strong>{row.project_name || `Startup ${row.project_id}`}</strong><small>{dateLabel(row.delivered_at || row.promised_at || row.created_at) || 'Date not recorded'}</small></td>
    <td>{KIND_LABEL[row.kind] || row.kind}</td>
    <td><span className={`ip3-state is-${row.state}`}>{STATE_LABEL[row.state] || row.state}</span>{row.state === 'promised' && <span className="ip3-move">{/* D4642: the whole row, so the request can name the record and the revision it read. */}<button type="button" disabled={!!busy} onClick={() => onMove(row, 'delivered')}>Deliver</button><button type="button" disabled={!!busy} onClick={() => onMove(row, 'withdrawn')}>Withdraw</button></span>}</td>
    <td>{hoursLabel(row.hours)}</td>
    <td><strong>{row.summary}</strong><small>{row.outcome || 'No outcome recorded yet'}</small>
      {/* D4642: amended entries say so and offer the recorded history. An
          entry still at revision 1 has none, and claims none. */}
      {Number(row.revision) > 1
        ? <span className="ip3-amended"><small>{`Amended ${Number(row.revision) - 1} ${Number(row.revision) === 2 ? 'time' : 'times'}`}</small><button type="button" onClick={() => onHistory && onHistory(row)} aria-expanded={history?.uid === row.uid}>{history?.uid === row.uid ? 'Hide history' : 'History'}</button></span>
        : <span className="ip3-amended"><small>Not amended since it was recorded</small></span>}
      {history?.uid === row.uid && <div className="ip3-history" data-testid={`history-ip3-support-${row.uid}`}>
        {history.loading ? <small>Reading the history…</small>
          : history.error ? <small>{history.error}</small>
            : history.items.length === 0 ? <small>No amendment is recorded.</small>
              : <ul>{history.items.map((item) => <li key={item.uid}>
                <strong>{HISTORY_LABEL[item.action] || item.action}</strong>
                <span>{` by ${item.actor?.name || 'a member no longer on the account'}`}</span>
                <small>{`${dateLabel(item.created_at) || 'Date not recorded'} · revision ${item.revision}${item.changed?.length ? ` · ${item.changed.join(', ')}` : ''}`}</small>
              </li>)}</ul>}
      </div>}
    </td>
  </tr>)}</tbody></table></div>;
}

/**
 * The per-company rollup — the `By company` chip and the `Per-company view` op,
 * which the artboard draws as two controls over one view.
 *
 * A company with no entry is shown WITH the others rather than hidden, because
 * "nothing was done for this one" is the row an LP report needs most and the
 * one a ledger of activity naturally omits.
 */
function PerCompany({ companies, unreadable }) {
  if (unreadable) return <section className="i4-card i4-positions ip3-ledger" data-testid="ip3-per-company"><div className="i4-section-head"><div><h2>Per-company support</h2></div></div><div className="i4-empty"><AlertCircle size={16} />The support ledger could not be read.</div></section>;
  return <section className="i4-card i4-positions ip3-ledger" data-testid="ip3-per-company">
    <div className="i4-section-head"><div><h2>Per-company support</h2><p>Every company in the book, including the ones with nothing recorded</p></div><span>Rollup · no write</span></div>
    {!companies.length
      ? <div className="i4-empty"><AlertCircle size={16} />No accessible portfolio company is recorded for this investor.</div>
      : <div className="i4-table-wrap"><table><thead><tr><th>Company</th><th>Entries</th><th>Delivered</th><th>Outstanding</th><th>Hours</th></tr></thead><tbody>{companies.map((row) => <tr key={row.project_id} data-testid={`row-ip3-company-${row.project_id}`}>
        <td><strong>{row.name}</strong>{row.entries === 0 && <small>Nothing recorded</small>}</td>
        <td>{row.entries}</td>
        <td>{row.delivered}</td>
        <td>{row.promised}</td>
        <td>{row.entries_without_hours === row.entries ? 'Not recorded' : `${Math.round(row.hours * 100) / 100} h`}{row.entries_without_hours > 0 && row.entries_without_hours < row.entries && <small>{row.entries_without_hours} without hours</small>}</td>
      </tr>)}</tbody></table></div>}
    <p className="i4-seam-note"><span>Counting rule</span> A company counts as supported when it has a recorded entry, never because it is in the book, sent an update, or appears in an introduction row.</p>
  </section>;
}

/** The `Log support` op. Writes one entry against a company already in the book. */
function LogForm({ form, setForm, companies, onSubmit, busy, onCancel, fill = null }) {
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value, error: '' }));
  return (
    <form className="i4-card ip3-form" onSubmit={onSubmit} data-testid="ip3-log-support">
      <div className="i4-section-head"><div><h2>Log support</h2><p>One entry, against one company in this book</p></div><button type="button" onClick={onCancel}>Cancel</button></div>
      <div className="ip3-fields">
        <label>Company<select value={form.project_uid} onChange={set('project_uid')} required><option value="">Choose a company</option>{companies.filter((x) => x.project_uid).map((x) => <option key={x.project_id} value={x.project_uid}>{x.name}</option>)}</select></label>
        <label>Kind<select value={form.kind} onChange={set('kind')}>{KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>State<select value={form.state} onChange={set('state')}><option value="promised">Promised</option><option value="delivered">Delivered</option></select></label>
        {/* Blank is sent as absent. An hours box that defaulted to 0 would put
            a measured zero in the ledger for every entry nobody timed. */}
        <label>Hours<input type="number" min="0" step="0.5" value={form.hours} onChange={set('hours')} placeholder="Leave blank if untimed" /></label>
      </div>
      <FillFormBar fill={fill} />
      <div className="ip3-wide">
        <FillLabel fill={fill} name="summary" label="What happened" value={form.summary}><label htmlFor="ip3-summary">What happened</label></FillLabel>
        <textarea id="ip3-summary" rows={2} value={form.summary} onChange={set('summary')} placeholder="Introduced them to a buyer at …" required />
      </div>
      <label className="ip3-wide">Outcome <em>(optional)</em><textarea rows={2} value={form.outcome} onChange={set('outcome')} placeholder="Leave blank until something comes of it" /></label>
      {form.error && <p className="ip3-form-error">{form.error}</p>}
      <div className="ip3-actions"><button type="submit" disabled={busy}>{busy ? 'Recording…' : 'Record entry'}</button></div>
    </form>
  );
}

function Stat({ label, value, note }) { return <article className="i4-stat ip3-stat"><div><span>{label}</span><b>{value}</b><small>{note}</small></div></article>; }
function Skeleton() { return <div className="i4-skeleton" aria-busy="true"><i /><i /><i /><i /></div>; }
function ValueAddRail({ totals, unreadable }) {
  return (
    <WorkerRail
      workspace="Portfolio"
      role="investor"
      className="i4-rail ip3-rail"
      stance="Support ledger"
      note="Recorded support work, written by the people who did it. Introductions requested through the quota, dealroom membership and calendar activity are never relabelled as value-add."
      coverage={[
        unreadable ? 'Support ledger unreadable' : `${totals.entries} recorded ${totals.entries === 1 ? 'entry' : 'entries'} across ${totals.companies_in_book} accessible ${totals.companies_in_book === 1 ? 'company' : 'companies'}`,
        unreadable ? 'Hours unavailable' : `${totals.entries_without_hours} ${totals.entries_without_hours === 1 ? 'entry carries' : 'entries carry'} no hour count`,
      ]}
      unavailable={[
        ['Inferred support', 'A company is counted as supported only from a recorded entry, never from the position book, an update, or an introduction row.'],
        ['Outbound', 'Nothing is sent to a company from this page; recording that support happened does not perform it.'],
      ]}
    />
  );
}
