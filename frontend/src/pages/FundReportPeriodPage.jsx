import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import WorkspaceShell from '../workspaces/WorkspaceShell';
import WorkerRail from '../ui/WorkerRail';
import { api } from '../lib/api';
import { parseStamp } from '../ui/parseStamp.js';
import { fundReportDeliveryLabel, fundReportDeliveryTime, lpDeliveryLabel, lpDeliveryNote, lpDeliveryStateLabel } from '../lib/fundReportDelivery';
import { useLeaveGuard } from '../lib/leaveGuard';
import { fundReportsApi } from '../lib/api/fundReports.js';
import { fundReportingApi } from '../lib/api/fundReporting.js';
import { useAuth } from '../hooks/useAuthSync';
import { isSuperAdminUser } from '../lib/shellRole';
import { readableFund, readablePeriod, useFundReport } from '../hooks/useFundReport';
import { fmtDate, issuedFundRows } from '../lib/quarterlyReportViewModel.js';
import { FundReadState, Recorded } from './FundPage';
import { fundDraftsApi } from '../lib/api/fundDrafts.js';
import FundDraftBand from './FundDraftBand';
import ZoneDraft from '../workspaces/ZoneDraft';
import './fundPage.css';

export default function FundReportPeriodPage({ role = 'investor', reading: supplied }) {
  const { fundId, periodId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const resource = useFundReport(fundId, periodId, params.get('corrects'));
  const reading = supplied || resource;
  const data = !reading.loading && !reading.error && readableFund(reading.data) && readablePeriod(reading.data.period) ? reading.data : null;
  const denied = data && !data.can_manage && data.period.status !== 'issued';
  return <div className="fd-surface"><WorkspaceShell role={role} activeSlug="reporting" title={data?.period.period ? `Quarterly report · ${data.period.period}` : 'New reporting period'}
    scope={data?.fund.name} scopeHref={data ? `/funds/${data.fund.id}` : undefined}
    intro="The fund’s quarterly letter, developments, outlook and subsequent events."
    rail={<WorkerRail role="investor" workspace="Fund reporting" stance="GP-authored reporting" coverage={data ? ['Recorded reporting period'] : []}
      note="Issuing freezes the report. A correction is recorded as a separate period." />}>
    {reading.loading || reading.error || !data || denied ? <FundReadState reading={denied ? { ...reading, error: { status: 403 } } : reading} />
      : data.period.status === 'issued' ? <PeriodReader data={data} onChanged={reading.reload} />
      : <PeriodEditor key={`${data.fund.id}:${data.period.id || 'new'}:${data.period.revision || params.get('corrects') || ''}`}
        data={data} onDeleted={() => navigate(`/funds/${data.fund.id}`, { replace: true })} onSaved={(id) => { if (String(id) === periodId) reading.reload(); else navigate(`/funds/${data.fund.id}/reporting/${id}`, { replace: true }); }} />}
  </WorkspaceShell></div>;
}

/** D6250: the issued document reads only its frozen period, never today's fund totals. */
export function PeriodReader({ data, onChanged = () => {} }) {
  const { user } = useAuth();
  const { period: report, fund } = data;
  const figures = issuedFundRows(report.figures);
  const link = id => `/funds/${fund.id}/reporting/${id}`;
  const label = id => data.periods?.find(row => row.id === id)?.period || `period ${id}`;
  return <>
    <nav className="fd-actions fd-report-tools" aria-label="Report actions">
      <Link to={`/funds/${fund.id}`}>Back to fund</Link>
      <button type="button" onClick={() => window.print()}>Print</button>
      {!data.can_manage && <Link to="/spinout-lab/investor-workspace#reports">Your capital statement and PDF</Link>}
      {data.can_manage && user?.role !== 'admin' && !report.corrected_by_period_id && <Link to={`/funds/${fund.id}/reporting/new?corrects=${report.id}`}>Issue a correcting period</Link>}
    </nav>
    <div className="fd-report-reader">
      <article className="fd-card fd-report-letter" aria-label="Report letter">
        <header className="fd-report-mast"><div><small>Quarterly report to limited partners</small><h2>{fund.name}</h2>
          <p>{report.period} · <ReportDate value={report.period_start} reason="The start date was not recorded." /> – <ReportDate value={report.period_end} reason="The end date was not recorded." /></p></div>
          <dl><div><dt>Issued · read-only</dt><dd><ReportDate value={report.issued_at} stamp reason="The issue timestamp was not recorded." /></dd></div>
          <div><dt>Issued by</dt><dd><Recorded value={report.issued_by_name} reason={report.issued_by_name_reason || 'The issuer’s name was not recorded.'} /></dd></div>
          {data.can_manage && <div><dt>{report.lps_notified_at ? 'LPs notified at' : 'LP notices'}</dt><dd>
            {report.lps_notified_at && <time dateTime={report.lps_notified_at}>{fundReportDeliveryTime(report)} · </time>}{fundReportDeliveryLabel(report)}
          </dd></div>}
          {data.can_manage && report.lp_delivery && <div><dt>Delivered</dt><dd data-testid="period-lp-delivered">{lpDeliveryLabel(report)}{lpDeliveryNote(report) && <small>{lpDeliveryNote(report)}</small>}</dd></div>}</dl></header>
        {report.corrects_period_id && <p role="note">This report corrects <Link to={link(report.corrects_period_id)}>{report.corrects_period || label(report.corrects_period_id)}</Link>. The original remains issued.</p>}
        {report.corrected_by_period_id && <p role="note">Corrected by <Link to={link(report.corrected_by_period_id)}>{label(report.corrected_by_period_id)}</Link>. This report remains issued and readable.</p>}
        {Object.entries(SECTIONS).map(([section, title]) => <section key={section} aria-label={title}><h3>{title}</h3>
          {!report.narrative[section].length && <Recorded value={null} reason="No content was recorded in this section." />}
          {report.narrative[section].map((entry, index) => section === 'letter' || section === 'outlook'
            ? <p key={index}>{entry}</p>
            : <div className="fd-report-event" key={index}><ReportDate value={entry.date || entry.d} reason="The event date was not recorded." /><div>{section === 'developments' && <h4>{entry.title}</h4>}<p>{entry.body || entry.e}</p></div></div>)}
        </section>)}
        <p className="fd-report-foot">Issuing cannot be undone. Record a correcting period to change this report.</p>
      </article>
      <aside className="fd-card" aria-label="Figures as issued"><h2>Figures as issued</h2>
        {figures.length ? <dl>{figures.map(row => <div key={row.k}><dt>{row.k}</dt><dd>{row.v}{row.why && <small>{row.why}</small>}</dd></div>)}</dl>
          : <Recorded value={null} reason={report.figures_reason || 'No figures were frozen when this period was issued.'} />}
        <p>These figures are frozen at issue. Missing figures are not recalculated from today’s records.</p>
      </aside>
    </div>
    {data.can_manage && ('lp_deliveries' in report) && <LpDeliveryCard report={report} />}
    {data.can_manage && user?.role === 'admin' && <PackCard data={data} user={user} onChanged={onChanged} />}
  </>;
}

/**
 * D6240: each LP of an issued period and how far its delivery got, for the
 * fund's manager only (the Worker sends the list only past `requireFundGp`).
 * No rows reads the Worker's reason: Not recorded for a period issued before
 * delivery was recorded, never an empty list or 0 delivered.
 */
export function LpDeliveryCard({ report }) {
  const rows = Array.isArray(report.lp_deliveries) ? report.lp_deliveries : null;
  const reason = report.lp_deliveries_reason || 'Not recorded: no per-LP delivery was returned.';
  const unreadable = /^Unreadable/.test(reason);
  return <section className="fd-card fd-delivery" aria-label="Delivery to LPs" data-testid="period-lp-deliveries">
    <h2>Delivery to LPs</h2>
    {!rows ? <p data-testid="lp-deliveries-reason"><b>{unreadable ? 'Unreadable' : 'Not recorded'}</b> {reason.replace(/^(Not recorded|Unreadable):\s*/, '')}</p>
      : <table><thead><tr><th>LP</th><th>State</th><th>Made available</th><th>Opened</th></tr></thead><tbody>
        {rows.map(row => <tr key={row.lp_id} data-testid="row-lp-delivery">
          <td>{row.name || `LP ${row.lp_id}`}{row.lp_removed && <small>LP record removed</small>}</td>
          <td data-label="State"><span className={`fd-pill fd-delivery-${row.state}`}>{lpDeliveryStateLabel(row.state)}</span>{row.state === 'not_sent' && <small>No active linked account</small>}</td>
          <td data-label="Made available"><DeliveryStamp value={row.made_available_at} none={row.state === 'failed' ? 'Notice failed' : 'Not made available'} /></td>
          <td data-label="Opened"><DeliveryStamp value={row.opened_at} none="Not opened" /></td>
        </tr>)}
      </tbody></table>}
    <p>Made available means the LP’s account received the in-app notice. Opened records the first time that account read this report; LPs have no acknowledgement step.</p>
  </section>;
}

/** D6240: a delivery time in UTC, or what its absence means for that row (not a missing record). */
function DeliveryStamp({ value, none }) {
  const at = parseStamp(value);
  return at === null ? <small>{none}</small>
    : <time dateTime={value}>{new Date(at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC</time>;
}

function ReportDate({ value, stamp = false, reason }) {
  const at = parseStamp(value);
  return at === null ? <Recorded value={null} reason={reason} />
    : <time dateTime={value}>{stamp ? new Date(at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC' : fmtDate(value)}</time>;
}

const SECTIONS = { letter: 'Letter', developments: 'Key developments', outlook: 'Outlook', subsequent: 'Subsequent events' };
const validEntryDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
export function reportEntryError(section, entry) {
  if (section === 'letter' || section === 'outlook') return entry.trim() ? null : 'Enter a paragraph.';
  if (section === 'developments') {
    if (!validEntryDate(entry.date)) return 'Enter a valid date.';
    if (!entry.title.trim()) return 'Enter a title.';
    return entry.body.trim() ? null : 'Enter text.';
  }
  if (!validEntryDate(entry.d)) return 'Enter a valid date.';
  return entry.e.trim() ? null : 'Enter text.';
}

/** D6242 (#6242): the sentences the letter's draft shows in place of running or of Accept. */
export const LETTER_SAVE_FIRST = 'Save the draft first: the letter is drafted from the saved period’s dates and Key developments.';
export const LETTER_FULL = 'The letter already has 50 paragraphs. Remove one before adding the draft.';
export const LETTER_NOTHING = 'This period records no capital movement between its dates and no saved Key development, so there is nothing to draft the letter from.';

/**
 * D6242: the Letter section with an accepted draft added after what is there, one paragraph per blank-line block,
 * never past the editor's 50 paragraphs (the overflow joins the last one) or its 10,000 characters a paragraph.
 */
export function fillLetter(letter, text) {
  const room = 50 - letter.length;
  const paragraphs = String(text || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (room <= 0 || !paragraphs.length) return letter;
  const kept = paragraphs.length > room ? [...paragraphs.slice(0, room - 1), paragraphs.slice(room - 1).join('\n\n')] : paragraphs;
  return [...letter, ...kept.map((p) => p.slice(0, 10000))];
}

export function PeriodEditor({ data, onSaved, onDeleted }) {
  const { user } = useAuth();
  // D712 decision 6: an admin issues a period only through the reporting
  // queue's pack. A non-admin GP of record keeps today's buttons.
  const admin = user?.role === 'admin';
  const [form, setForm] = useState(() => ({ ...structuredClone(data.period), period_start: data.period.period_start ?? '', period_end: data.period.period_end ?? '' }));
  const [pending, setPending] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [validated, setValidated] = useState(false);
  const allowLeave = useRef(false);
  const [error, setError] = useState(null);
  const savedAt = parseStamp(form.updated_at);
  const issued = data.period.status === 'issued';
  const editable = data.can_manage && !issued;
  const disabled = !editable || pending;
  const dirty = editable && (['period', 'period_start', 'period_end'].some(key => form[key] !== (data.period[key] ?? ''))
    || JSON.stringify(form.narrative) !== JSON.stringify(data.period.narrative));
  useLeaveGuard(dirty, 'Leave this report with unsaved changes?', (message) => allowLeave.current || window.confirm(message));
  useEffect(() => {
    if (!confirm && !deleting) return undefined;
    const close = (event) => { if (event.key === 'Escape' && !pending) { setConfirm(false); setDeleting(false); } };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [confirm, deleting, pending]);
  const change = (key, value) => setForm(previous => ({ ...previous, [key]: value }));
  const update = (section, index, key, value) => setForm(previous => ({ ...previous, narrative: { ...previous.narrative,
    [section]: previous.narrative[section].map((entry, i) => i !== index ? entry : key === null ? value : { ...entry, [key]: value }) } }));
  const add = (section, value) => setForm(previous => ({ ...previous, narrative: { ...previous.narrative, [section]: [...previous.narrative[section], value] } }));
  const remove = (section, index) => setForm(previous => ({ ...previous, narrative: { ...previous.narrative, [section]: previous.narrative[section].filter((_, i) => i !== index) } }));
  const move = (section, index, offset) => setForm(previous => {
    const rows = [...previous.narrative[section]];
    const next = index + offset;
    if (next < 0 || next >= rows.length) return previous;
    [rows[index], rows[next]] = [rows[next], rows[index]];
    return { ...previous, narrative: { ...previous.narrative, [section]: rows } };
  });
  // D6252: Accept puts the drafted opening first in the letter, in the unsaved editor; saving and issuing stay the
  // page's own buttons. A letter already at its 50 paragraphs refuses rather than drops one.
  const acceptOpening = (text) => {
    if (form.narrative.letter.length >= 50) return 'The letter already has 50 paragraphs. Remove one before adding the opening.';
    setForm(previous => ({ ...previous, narrative: { ...previous.narrative, letter: [text, ...previous.narrative.letter] } }));
    return null;
  };
  // D6242: the whole letter's draft reads the SAVED dates and Key developments, so unsaved ones wait for Save draft.
  // Its Accept fills the unsaved Letter section; only Save draft writes the period.
  const letterDraftBlocked = !form.id || (dirty && (['period_start', 'period_end'].some(key => form[key] !== (data.period[key] ?? ''))
    || JSON.stringify(form.narrative.developments) !== JSON.stringify(data.period.narrative.developments))) ? LETTER_SAVE_FIRST : null;
  const acceptLetter = (item) => setForm(previous => ({ ...previous, narrative: { ...previous.narrative, letter: fillLetter(previous.narrative.letter, item?.body) } }));
  const hasInvalidEntries = Object.entries(form.narrative).some(([section, entries]) => entries.some(entry => reportEntryError(section, entry)));
  const validate = () => {
    setValidated(true);
    setError(null);
    return !hasInvalidEntries;
  };
  const deleteDraft = async () => {
    if (!editable || !form.id || !deleting || pending) return;
    setPending(true); setError(null);
    try {
      const result = await fundReportsApi.deleteDraft(data.fund.id, form.id, form.revision);
      if (result?.ok !== true) throw new Error('Delete was not confirmed.');
      allowLeave.current = true;
      onDeleted();
    } catch (failure) {
      setError([400, 402, 403, 404, 409].includes(failure?.status) ? failure.message : 'Unreadable: deletion could not be confirmed. Try again.');
      setDeleting(false);
    } finally { setPending(false); }
  };
  const save = async (issue) => {
    if (!editable || pending || (issue && !confirm) || !validate()) return;
    setPending(true); setError(null);
    try {
      const result = await api.fundsSaveReportPeriod(data.fund.id, {
        period: form.period, period_start: form.period_start, period_end: form.period_end, narrative: form.narrative,
        ...(form.id ? { id: form.id, revision: form.revision } : {}), corrects_period_id: form.corrects_period_id ?? null, issue,
      });
      if (!Number.isSafeInteger(result?.period?.id) || result.period.id <= 0) throw new Error('Unreadable saved report.');
      allowLeave.current = true;
      setConfirm(false); onSaved(result.period.id);
    } catch (failure) {
      // Public API refusals are fixed sentences; unexpected errors stay generic.
      setError([400, 402, 403, 404, 409].includes(failure?.status) ? failure.message : 'Unreadable: the reporting period could not be saved. Try again.');
    } finally { setPending(false); }
  };
  return <>
    {form.corrects_period_id && <p>This period corrects <Link to={`/funds/${data.fund.id}/reporting/${form.corrects_period_id}`}>{form.corrects_period || `period ${form.corrects_period_id}`}</Link>. The original remains issued.</p>}
    {issued && <article className="fd-card"><h2>Issued · read-only</h2><dl><div><dt>Issued at</dt><dd><Recorded value={form.issued_at} reason="The issue timestamp was not recorded." /></dd></div><div><dt>Issued by</dt><dd><Recorded value={form.issued_by} reason="The issuing actor was not recorded." /></dd></div>
      {data.can_manage && <div><dt>{data.period.lps_notified_at ? 'LPs notified at' : 'LP notices'}</dt><dd>
        {data.period.lps_notified_at && <time dateTime={data.period.lps_notified_at}>{fundReportDeliveryTime(data.period)} · </time>}
        {fundReportDeliveryLabel(data.period)}
      </dd></div>}
    </dl><p>Issuing cannot be undone. Record a correcting period to change this report.</p></article>}
    {!Object.values(form.narrative).some(rows => rows.length) && <p>This period has no content yet.</p>}
    <section className="fd-facts fd-period" aria-label="Reporting period"><article className="fd-card"><label>Period label<input aria-label="Period label" maxLength={100} value={form.period} readOnly={!editable || Boolean(form.id)} disabled={pending} onChange={e => change('period', e.target.value)} /></label></article>
      <article className="fd-card"><label>Start date<input aria-label="Start date" type="date" value={form.period_start} readOnly={!editable} disabled={pending} onChange={e => change('period_start', e.target.value)} /></label>{!form.period_start && <Recorded value={null} reason="The start date has not been set for this period." />}</article>
      <article className="fd-card"><label>End date<input aria-label="End date" type="date" value={form.period_end} readOnly={!editable} disabled={pending} onChange={e => change('period_end', e.target.value)} /></label>{!form.period_end && <Recorded value={null} reason="The end date has not been set for this period." />}</article></section>
    {editable && <FundDraftBand testId="letter-draft-band" title="Letter draft" run="Draft the opening"
      body="Draft the letter’s opening paragraph from this period’s recorded capital movements."
      writes="Accept writes into the draft. Issuing stays a human click."
      blocked={!form.id ? 'Save the draft first: the opening is drafted from the saved period’s dates.' : dirty && ['period_start', 'period_end'].some(key => form[key] !== (data.period[key] ?? '')) ? 'Save the new dates first: the opening is drafted from the saved period’s dates.' : null}
      onRun={() => fundDraftsApi.letter(data.fund.id, form.id)} onAccept={acceptOpening} />}
    {editable && <article className="fd-card" data-testid="letter-zone-draft"><ZoneDraft
      surface="funds/reporting"
      scopeKey={`${data.fund.id}:${form.id || 'new'}`}
      railOption="draft:quarterly-letter"
      scoped
      stateWords
      accent="indigo"
      label="Proposal · the quarterly letter"
      run="Draft the letter"
      accept="Accept into the letter"
      empty="The Letter section, drafted from this period’s recorded capital movements and its saved Key developments. Accept adds it to the editor below; nothing is saved until you press Save draft."
      nothingToDraft={LETTER_NOTHING}
      blocked={letterDraftBlocked}
      acceptBlocked={form.narrative.letter.length >= 50 ? LETTER_FULL : null}
      onAccepted={acceptLetter}
      foot="Nothing is saved or issued until you press Save draft or Issue."
    /></article>}
    {Object.keys(SECTIONS).map(section => <article className="fd-card" key={section}>
      <h2>{SECTIONS[section]}</h2>
      {!form.narrative[section].length && <Recorded value={null} reason={`No ${section === 'letter' || section === 'outlook' ? 'paragraphs' : 'entries'} have been recorded in this section.`} />}
      {form.narrative[section].map((entry, index) => {
        const entryError = validated ? reportEntryError(section, entry) : null;
        const errorId = entryError ? `report-${section}-${index}-error` : undefined;
        return <div className="fd-entry" key={index} role="group" aria-label={`${SECTIONS[section]} entry ${index + 1}`} aria-describedby={errorId}>
        {section === 'letter' || section === 'outlook'
          ? <label>{`${section} paragraph ${index + 1}`}<textarea aria-label={`${section} paragraph ${index + 1}`} maxLength={10000} value={entry} readOnly={!editable} disabled={pending} onChange={e => update(section, index, null, e.target.value)} /></label>
          : <><label>Date<input type="date" aria-label={`${section} date ${index + 1}`} value={section === 'developments' ? entry.date : entry.d} readOnly={!editable} disabled={pending} onChange={e => update(section, index, section === 'developments' ? 'date' : 'd', e.target.value)} /></label>
            {section === 'developments' && <label>Title<input aria-label={`Development title ${index + 1}`} maxLength={200} value={entry.title} readOnly={!editable} disabled={pending} onChange={e => update(section, index, 'title', e.target.value)} /></label>}
            <label>Text<textarea aria-label={`${section} text ${index + 1}`} maxLength={10000} value={section === 'developments' ? entry.body : entry.e} readOnly={!editable} disabled={pending} onChange={e => update(section, index, section === 'developments' ? 'body' : 'e', e.target.value)} /></label></>}
        {entryError && <p id={errorId} role="alert">{entryError}</p>}
        {editable && <div className="fd-actions">
          <button type="button" disabled={disabled || index === 0} aria-label={`Move ${section} ${index + 1} up`} onClick={() => move(section, index, -1)}>Move up</button>
          <button type="button" disabled={disabled || index === form.narrative[section].length - 1} aria-label={`Move ${section} ${index + 1} down`} onClick={() => move(section, index, 1)}>Move down</button>
          <button type="button" disabled={disabled} onClick={() => remove(section, index)}>Remove {section} {index + 1}</button>
        </div>}
      </div>;
      })}
      {editable && <button type="button" disabled={disabled || form.narrative[section].length >= (section === 'letter' || section === 'outlook' ? 50 : 100)} onClick={() => add(section, section === 'letter' || section === 'outlook' ? '' : section === 'developments' ? { date: '', title: '', body: '' } : { d: '', e: '' })}>Add {section === 'letter' || section === 'outlook' ? `${section} paragraph` : section === 'developments' ? 'development' : 'subsequent event'}</button>}
    </article>)}
    {editable && savedAt !== null && <p>Saved at <time dateTime={new Date(savedAt).toISOString()}>{new Date(savedAt).toLocaleString()}</time></p>}
    {validated && hasInvalidEntries && <p role="alert">Correct the marked entries before saving.</p>}
    {error && <p role="alert">{error}</p>}
    {admin && form.id && <PackCard data={data} user={user} onChanged={() => onSaved(form.id)} />}
    <div className="fd-actions">{editable && <><button type="button" disabled={pending} onClick={() => save(false)}>{pending ? 'Saving…' : 'Save draft'}</button>{!admin && <button type="button" disabled={pending} onClick={() => { if (validate()) setConfirm(true); }}>Issue</button>}{form.id && <button type="button" disabled={pending} onClick={() => setDeleting(true)}>Delete draft</button>}</>}
      {issued && data.can_manage && !admin && <Link to={`/funds/${data.fund.id}/reporting/new?corrects=${form.id}`}>Issue a correcting period</Link>}
      <Link to={`/funds/${data.fund.id}`}>Back to fund</Link></div>
    {deleting && <div className="fd-confirm"><div className="fd-card" role="dialog" aria-modal="true" aria-labelledby="fd-delete-title"><h2 id="fd-delete-title">Delete this draft?</h2><p>This removes the draft and any unsaved edits.</p><div className="fd-actions"><button type="button" disabled={pending} autoFocus onClick={() => setDeleting(false)}>Keep draft</button><button type="button" disabled={pending} onClick={deleteDraft}>Confirm deletion</button></div></div></div>}
    {confirm && <div className="fd-confirm"><div className="fd-card" role="dialog" aria-modal="true" aria-labelledby="fd-issue-title"><h2 id="fd-issue-title">Issue this period?</h2><p>Issuing cannot be undone. LPs can read the issued report. Eligible LP accounts receive an in-app notice. Any change requires a separate correcting period.</p><div className="fd-actions"><button type="button" disabled={pending} autoFocus onClick={() => setConfirm(false)}>Keep draft</button><button type="button" disabled={pending} onClick={() => save(true)}>Confirm issue</button></div></div></div>}
  </>;
}

const money = (line) => (line && Number.isFinite(line.cents) ? `$${(line.cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : null);

/**
 * D712 (#1777) — the period's quarterly pack in the reporting queue, for an
 * admin. Any Admin marks it prepared; a Super Admin who did not prepare it
 * issues it, with a typed acknowledgement when transactions are unmatched.
 * The figures come through the queue's audited read.
 */
export function PackCard({ data, user, onChanged }) {
  const superAdmin = isSuperAdminUser(user);
  const [state, setState] = useState({ loading: true });
  const [ack, setAck] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const label = data.period.period;
  const quarter = /^Q[1-4] \d{4}$/.test(String(label || ''));
  const load = async () => {
    setState({ loading: true });
    try {
      const list = await fundReportingApi.list({ fund_id: data.fund.id, kind: 'lp_quarterly_report', period: label });
      const rows = list?.items || [];
      const pack = rows.find((r) => r.status === 'draft' || r.status === 'prepared') || rows.find((r) => r.status === 'issued' && r.report_period_id === data.period.id) || null;
      const read = pack ? await fundReportingApi.read(pack.uid) : null;
      setState({ loading: false, administered: list?.administered !== false, pack, read });
    } catch (failure) {
      setState({ loading: false, failed: failure?.message || 'Unreadable: the reporting queue could not be read.' });
    }
  };
  useEffect(() => { load(); }, [data.fund.id, data.period.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (fn) => {
    setBusy(true); setError(null);
    try { await fn(); await load(); onChanged?.(); } catch (failure) { setError(failure?.message || 'The reporting queue refused that.'); } finally { setBusy(false); }
  };
  if (state.loading) return <article className="fd-card" aria-label="Quarterly pack"><h2>Quarterly pack</h2><p>Reading the reporting queue…</p></article>;
  if (state.failed) return <article className="fd-card" aria-label="Quarterly pack"><h2>Quarterly pack</h2><p role="alert">{state.failed}</p></article>;
  if (!state.administered) return <article className="fd-card" aria-label="Quarterly pack"><h2>Quarterly pack</h2><p>The fund&apos;s GP of record issues this period.</p></article>;
  const { pack, read } = state;
  if (!pack) {
    return <article className="fd-card" aria-label="Quarterly pack"><h2>Quarterly pack</h2>
      <p>No pack has been built for {label} yet.</p>
      {quarter && <button type="button" disabled={busy} onClick={() => act(() => fundReportingApi.build({ kind: 'lp_quarterly_report', period_label: label, fund_id: data.fund.id }))}>Build this quarter&apos;s pack</button>}
      {error && <p role="alert">{error}</p>}
    </article>;
  }
  const f = read?.figures || {};
  const ff = f.fund_figures || {};
  const lines = [['Committed', f.totals?.commitments], ['Called to date', f.totals?.called_to_date], ['Contributed this quarter', f.totals?.contributed_in_quarter],
    ['Investment value', ff.investment_value], ['Fund cash', ff.cash], ['Liabilities', ff.liabilities], ['Net asset value', ff.nav]];
  const unmatched = Number(f.unmatched_count || 0);
  const mine = pack.prepared_by != null && Number(pack.prepared_by) === Number(user?.id);
  return <article className="fd-card" aria-label="Quarterly pack"><h2>Quarterly pack · {pack.status}</h2>
    <dl>{lines.map(([k, line]) => <div key={k}><dt>{k}</dt><dd><Recorded value={money(line)} reason={line?.reason || 'Not recorded.'} /></dd></div>)}</dl>
    {f.lp_count != null && <p>{f.lp_count} capital statements in this pack, revision {pack.revision}.</p>}
    {pack.status === 'draft' && <button type="button" disabled={busy || !read} onClick={() => act(() => fundReportingApi.prepare(pack.uid, { figures_sha256: read.figures_sha256 }))}>Mark prepared</button>}
    {pack.status === 'prepared' && !superAdmin && <p>A Super Admin issues this period.</p>}
    {pack.status === 'prepared' && superAdmin && mine && <p>You prepared this pack, so another Super Admin issues it.</p>}
    {pack.status === 'prepared' && superAdmin && !mine && <>
      {unmatched > 0 && <div role="note" className="fd-caution"><p>{unmatched} transactions are unmatched. Type what you checked before you issue.</p>
        <label>Acknowledgement<textarea aria-label="Acknowledgement" maxLength={500} value={ack} onChange={(e) => setAck(e.target.value)} /></label></div>}
      <button type="button" disabled={busy || !read || (unmatched > 0 && !ack.trim())}
        onClick={() => act(() => fundReportingApi.issue(pack.uid, { figures_sha256: read.figures_sha256, ...(unmatched > 0 ? { acknowledgement: ack } : {}) }))}>Issue</button>
    </>}
    {pack.status === 'issued' && <button type="button" disabled={busy} onClick={() => act(() => fundReportingApi.correct(pack.uid))}>Issue a correcting period</button>}
    {error && <p role="alert">{error}</p>}
  </article>;
}
