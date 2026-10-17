import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import WorkspaceShell from '../workspaces/WorkspaceShell';
import WorkerRail from '../ui/WorkerRail';
import { api, fundReportingApi } from '../lib/api';
import { useAuth } from '../hooks/useAuthSync';
import { isSuperAdminUser } from '../lib/shellRole';
import { readableFund, readablePeriod, useFundReport } from '../hooks/useFundReport';
import { FundReadState, Recorded } from './FundPage';
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
      : <PeriodEditor key={`${data.fund.id}:${data.period.id || 'new'}:${data.period.revision || params.get('corrects') || ''}`}
        data={data} onSaved={(id) => { if (String(id) === periodId) reading.reload(); else navigate(`/funds/${data.fund.id}/reporting/${id}`, { replace: true }); }} />}
  </WorkspaceShell></div>;
}

export function PeriodEditor({ data, onSaved }) {
  const { user } = useAuth();
  // D712 decision 6: an admin issues a period only through the reporting
  // queue's pack. A non-admin GP of record keeps today's buttons.
  const admin = user?.role === 'admin';
  const [form, setForm] = useState(() => ({ ...structuredClone(data.period), period_start: data.period.period_start ?? '', period_end: data.period.period_end ?? '' }));
  const [pending, setPending] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState(null);
  const issued = data.period.status === 'issued';
  const editable = data.can_manage && !issued;
  const disabled = !editable || pending;
  useEffect(() => {
    if (!confirm) return undefined;
    const close = (event) => { if (event.key === 'Escape' && !pending) setConfirm(false); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [confirm, pending]);
  const change = (key, value) => setForm(previous => ({ ...previous, [key]: value }));
  const update = (section, index, key, value) => setForm(previous => ({ ...previous, narrative: { ...previous.narrative,
    [section]: previous.narrative[section].map((entry, i) => i !== index ? entry : key === null ? value : { ...entry, [key]: value }) } }));
  const add = (section, value) => setForm(previous => ({ ...previous, narrative: { ...previous.narrative, [section]: [...previous.narrative[section], value] } }));
  const remove = (section, index) => setForm(previous => ({ ...previous, narrative: { ...previous.narrative, [section]: previous.narrative[section].filter((_, i) => i !== index) } }));
  const save = async (issue) => {
    if (!editable || pending || (issue && !confirm)) return;
    setPending(true); setError(null);
    try {
      const result = await api.fundsSaveReportPeriod(data.fund.id, {
        period: form.period, period_start: form.period_start, period_end: form.period_end, narrative: form.narrative,
        ...(form.id ? { id: form.id, revision: form.revision } : {}), corrects_period_id: form.corrects_period_id ?? null, issue,
      });
      if (!Number.isSafeInteger(result?.period?.id) || result.period.id <= 0) throw new Error('Unreadable saved report.');
      setConfirm(false); onSaved(result.period.id);
    } catch (failure) {
      // Public API refusals are fixed sentences; unexpected errors stay generic.
      setError([400, 402, 403, 404, 409].includes(failure?.status) ? failure.message : 'Unreadable: the reporting period could not be saved. Try again.');
    } finally { setPending(false); }
  };
  return <>
    {form.corrects_period_id && <p>This period corrects <Link to={`/funds/${data.fund.id}/reporting/${form.corrects_period_id}`}>{form.corrects_period || `period ${form.corrects_period_id}`}</Link>. The original remains issued.</p>}
    {issued && <article className="fd-card"><h2>Issued · read-only</h2><dl><div><dt>Issued at</dt><dd><Recorded value={form.issued_at} reason="The issue timestamp was not recorded." /></dd></div><div><dt>Issued by</dt><dd><Recorded value={form.issued_by} reason="The issuing actor was not recorded." /></dd></div></dl><p>Issuing cannot be undone. Record a correcting period to change this report.</p></article>}
    {!Object.values(form.narrative).some(rows => rows.length) && <p>This period has no content yet.</p>}
    <section className="fd-facts fd-period" aria-label="Reporting period"><article className="fd-card"><label>Period label<input aria-label="Period label" maxLength={100} value={form.period} readOnly={!editable || Boolean(form.id)} disabled={pending} onChange={e => change('period', e.target.value)} /></label></article>
      <article className="fd-card"><label>Start date<input aria-label="Start date" type="date" value={form.period_start} readOnly={!editable} disabled={pending} onChange={e => change('period_start', e.target.value)} /></label>{!form.period_start && <Recorded value={null} reason="The start date has not been set for this period." />}</article>
      <article className="fd-card"><label>End date<input aria-label="End date" type="date" value={form.period_end} readOnly={!editable} disabled={pending} onChange={e => change('period_end', e.target.value)} /></label>{!form.period_end && <Recorded value={null} reason="The end date has not been set for this period." />}</article></section>
    {['letter', 'developments', 'outlook', 'subsequent'].map(section => <article className="fd-card" key={section}>
      <h2>{({ letter: 'Letter', developments: 'Key developments', outlook: 'Outlook', subsequent: 'Subsequent events' })[section]}</h2>
      {!form.narrative[section].length && <Recorded value={null} reason={`No ${section === 'letter' || section === 'outlook' ? 'paragraphs' : 'entries'} have been recorded in this section.`} />}
      {form.narrative[section].map((entry, index) => <div className="fd-entry" key={index}>
        {section === 'letter' || section === 'outlook'
          ? <label>{`${section} paragraph ${index + 1}`}<textarea aria-label={`${section} paragraph ${index + 1}`} maxLength={10000} value={entry} readOnly={!editable} disabled={pending} onChange={e => update(section, index, null, e.target.value)} /></label>
          : <><label>Date<input type="date" aria-label={`${section} date ${index + 1}`} value={section === 'developments' ? entry.date : entry.d} readOnly={!editable} disabled={pending} onChange={e => update(section, index, section === 'developments' ? 'date' : 'd', e.target.value)} /></label>
            {section === 'developments' && <label>Title<input aria-label={`Development title ${index + 1}`} maxLength={200} value={entry.title} readOnly={!editable} disabled={pending} onChange={e => update(section, index, 'title', e.target.value)} /></label>}
            <label>Text<textarea aria-label={`${section} text ${index + 1}`} maxLength={10000} value={section === 'developments' ? entry.body : entry.e} readOnly={!editable} disabled={pending} onChange={e => update(section, index, section === 'developments' ? 'body' : 'e', e.target.value)} /></label></>}
        {editable && <button type="button" disabled={disabled} onClick={() => remove(section, index)}>Remove {section} {index + 1}</button>}
      </div>)}
      {editable && <button type="button" disabled={disabled || form.narrative[section].length >= (section === 'letter' || section === 'outlook' ? 50 : 100)} onClick={() => add(section, section === 'letter' || section === 'outlook' ? '' : section === 'developments' ? { date: '', title: '', body: '' } : { d: '', e: '' })}>Add {section === 'letter' || section === 'outlook' ? `${section} paragraph` : section === 'developments' ? 'development' : 'subsequent event'}</button>}
    </article>)}
    {error && <p role="alert">{error}</p>}
    {admin && form.id && <PackCard data={data} user={user} onChanged={() => onSaved(form.id)} />}
    <div className="fd-actions">{editable && <><button type="button" disabled={pending} onClick={() => save(false)}>{pending ? 'Saving…' : 'Save draft'}</button>{!admin && <button type="button" disabled={pending} onClick={() => setConfirm(true)}>Issue</button>}</>}
      {issued && data.can_manage && !admin && <Link to={`/funds/${data.fund.id}/reporting/new?corrects=${form.id}`}>Issue a correcting period</Link>}
      <Link to={`/funds/${data.fund.id}`}>Back to fund</Link></div>
    {confirm && <div className="fd-confirm"><div className="fd-card" role="dialog" aria-modal="true" aria-labelledby="fd-issue-title"><h2 id="fd-issue-title">Issue this period?</h2><p>Issuing cannot be undone. LPs can read the issued report. Any change requires a separate correcting period.</p><div className="fd-actions"><button type="button" disabled={pending} autoFocus onClick={() => setConfirm(false)}>Keep draft</button><button type="button" disabled={pending} onClick={() => save(true)}>Confirm issue</button></div></div></div>}
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
