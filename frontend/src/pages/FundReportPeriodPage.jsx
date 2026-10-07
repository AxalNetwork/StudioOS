import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import WorkspaceShell from '../workspaces/WorkspaceShell';
import WorkerRail from '../ui/WorkerRail';
import { api } from '../lib/api';
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
    <div className="fd-actions">{editable && <><button type="button" disabled={pending} onClick={() => save(false)}>{pending ? 'Saving…' : 'Save draft'}</button><button type="button" disabled={pending} onClick={() => setConfirm(true)}>Issue</button></>}
      {issued && data.can_manage && <Link to={`/funds/${data.fund.id}/reporting/new?corrects=${form.id}`}>Issue a correcting period</Link>}
      <Link to={`/funds/${data.fund.id}`}>Back to fund</Link></div>
    {confirm && <div className="fd-confirm"><div className="fd-card" role="dialog" aria-modal="true" aria-labelledby="fd-issue-title"><h2 id="fd-issue-title">Issue this period?</h2><p>Issuing cannot be undone. LPs can read the issued report. Any change requires a separate correcting period.</p><div className="fd-actions"><button type="button" disabled={pending} autoFocus onClick={() => setConfirm(false)}>Keep draft</button><button type="button" disabled={pending} onClick={() => save(true)}>Confirm issue</button></div></div></div>}
  </>;
}
