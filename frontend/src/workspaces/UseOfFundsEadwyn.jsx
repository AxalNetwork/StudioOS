import React, { useEffect, useRef, useState } from 'react';
import Lightbox from '../ui/Lightbox.jsx';
import { useRailOption } from '../ui/railCrumbs';
import { railPressHeaders } from '../lib/railPage';
import { useOfFundsApi } from '../lib/api/useOfFunds';
import RunEstimate from './RunEstimate';

const OPTIONS = { check: 'draft:raise/use-of-funds-check', runway: 'draft:raise/use-of-funds-runway', wording: 'form:uof-milestone-wording' };
const BUTTON = 'min-h-11 rounded-[9px] border border-violet-300 bg-white px-3 py-2 text-[13px] font-semibold text-violet-800 disabled:opacity-50 dark:border-violet-700 dark:bg-gray-900 dark:text-violet-200';
const PRIMARY = 'min-h-11 rounded-[9px] bg-violet-700 px-3 py-2 text-[13px] font-semibold text-white disabled:opacity-50 dark:bg-violet-600';
const INK = 'text-gray-900 dark:text-gray-100';
const MUTED = 'text-gray-600 dark:text-gray-300';
const SECTION_NAMES = { product: 'Product & engineering', 'go-to-market': 'GTM: sales and marketing', infrastructure: 'Infrastructure & data', operations: 'Operations, legal & compliance', reserve: 'Hiring / runway reserve' };
export function readingError(error) {
  if (error?.code === 'assist_off') return 'Eadwyn is off for this page. Switch to AI to run a reading.';
  if (error?.status === 402) return 'Your AI allowance cannot cover this run. Add AI tokens to continue.';
  if (error?.status === 409) return 'Not recorded: the required sources are missing, or this reading has expired. Read the current sources and try again.';
  if (error?.status === 403 || error?.status === 404) return 'This reading belongs to the venture founder.';
  return 'This reading is Unreadable. Try again.';
}
export function ReadingCitations({ reading }) {
  return <div className="space-y-3" data-testid="uof-reading-citations">
    {reading?.items?.length === 0 && <p className={`text-sm ${MUTED}`}>No sourced mismatch was returned. This does not certify the plan or the missing sources.</p>}
    {reading?.items?.map((item, i) => <div key={i} className="border-t border-violet-200 pt-3 dark:border-violet-800">
      <p className={`text-sm font-semibold leading-relaxed ${INK}`}>{item.text}</p>
      <ul className="mt-2 space-y-2">{item.citations.map(c => <li key={c.ref} className={`break-words text-xs ${MUTED}`}>
        <a href={c.href} className="font-bold text-violet-800 underline dark:text-violet-200">{c.label}</a>
        {' · Source: '}{c.source}{c.as_of ? ` · ${c.as_of}` : ' · Date not recorded'}
        <blockquote className="mt-1 whitespace-pre-wrap break-all rounded-lg bg-white/70 p-2 font-mono text-[11px] dark:bg-gray-900">{c.quote}</blockquote>
      </li>)}</ul>
    </div>)}
    {reading?.gaps?.map((g, i) => <p key={i} className={`text-xs ${MUTED}`}>{g.label} · {g.state === 'unreadable' ? 'Unreadable' : 'Not recorded'} · {g.reason}</p>)}
    {reading?.source_refs?.length > 0 && <details className={`text-xs ${MUTED}`}><summary>Sources read</summary><ul className="mt-2 space-y-1">{reading.source_refs.map(c => <li key={c.ref}><a href={c.href} className="font-semibold underline">{c.label}</a> · Source: {c.source} · {c.as_of ?? 'Date not recorded'}</li>)}</ul></details>}
    {reading?.cost_micro_usd != null && <p className={`text-xs ${MUTED}`}>Run charged <span className="font-mono">${(reading.cost_micro_usd / 1e6).toFixed(6)}</span> in AI tokens.</p>}
  </div>;
}
/** UF14. Preview is transient; only the explicit dialog's Keep persists a reading. */
export default function UseOfFundsEadwyn({ projectId, ai }) {
  const [mode, setMode] = useState(null), [proposal, setProposal] = useState(null), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [kept, setKept] = useState(null), [readError, setReadError] = useState(false);
  const [failedGaps, setFailedGaps] = useState([]);
  const serial = useRef(0), readSerial = useRef(0);
  useRailOption(mode === 'check' ? 'draft:raise/use-of-funds-check' : null, 'Check this plan');
  useRailOption(mode === 'runway' ? 'draft:raise/use-of-funds-runway' : null, 'Explain the runway');
  async function load() {
    const token = ++readSerial.current;
    setKept(null); setReadError(false);
    try { const r = await useOfFundsApi.readings(projectId); if (token === readSerial.current) setKept(r.items); }
    catch { if (token === readSerial.current) setReadError(true); }
  }
  useEffect(() => { serial.current++; setMode(null); setProposal(null); setError(''); setBusy(false); load(); return () => { serial.current++; readSerial.current++; }; }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps
  async function run(nextMode) {
    const token = ++serial.current;
    setMode(nextMode); setProposal(null); setError(''); setFailedGaps([]); setBusy(true);
    try {
      const r = await useOfFundsApi.previewReading(projectId, { mode: nextMode }, railPressHeaders(OPTIONS[nextMode]));
      if (token === serial.current) setProposal(r);
    } catch (e) { if (token === serial.current) { setError(readingError(e)); setFailedGaps(Array.isArray(e?.data?.gaps) ? e.data.gaps : []); } }
    finally { if (token === serial.current) setBusy(false); }
  }
  async function keep() {
    const token = serial.current; setBusy(true); setError('');
    try {
      const r = await useOfFundsApi.keepReading(projectId, proposal.receipt);
      if (token === serial.current) { readSerial.current++; setKept(old => [r.reading, ...(old ?? [])]); setProposal(null); setMode(null); setReadError(false); }
    } catch (e) { if (token === serial.current) setError(readingError(e)); }
    finally { if (token === serial.current) setBusy(false); }
  }
  function close() { serial.current++; setMode(null); setProposal(null); setError(''); setBusy(false); }
  return <section className="rounded-xl border border-violet-200 bg-violet-50 p-4 dark:border-violet-800 dark:bg-violet-950/30" data-testid="uof-eadwyn">
    <h3 className={`text-base font-extrabold ${INK}`}>Eadwyn · your plan</h3>
    <p className={`mt-1 text-sm ${MUTED}`}>Reads the plan against its sources. It never changes an amount, a share, a runway or a driver.</p>
    <RunEstimate ai={ai} task="workspace_explain" />
    <div className="mt-3 flex flex-wrap gap-2"><button className={BUTTON} disabled={busy} onClick={() => run('check')}>Check this plan</button><button className={BUTTON} disabled={busy} onClick={() => run('runway')}>Explain the runway</button></div>
    {readError && <p className={`mt-3 text-sm ${MUTED}`} role="status">Kept readings · Unreadable. <button className={BUTTON} onClick={load}>Try again</button></p>}
    {kept?.map((reading, i) => <details key={reading.uid ?? i} className="mt-3"><summary className={`cursor-pointer text-sm font-bold ${INK}`}>Kept {reading.mode === 'check' ? 'plan check' : 'runway reading'}</summary><p className={`my-2 text-xs ${MUTED}`}>Sources captured {reading.captured_at}. They may have changed since this reading.</p><ReadingCitations reading={reading} /></details>)}
    {mode && <Lightbox label={mode === 'check' ? 'Check this plan' : 'Explain the runway'} onClose={close} width={720} pageBelow="lg">
      <div className="max-h-[85vh] space-y-4 overflow-y-auto p-5" data-testid="uof-reading-dialog">
        <h2 className={`text-lg font-extrabold ${INK}`}>{mode === 'check' ? 'Proposal · plan check' : 'Proposal · explain the runway'}</h2>
        <p className={`text-sm ${MUTED}`}>Keep saves this reading and its source snapshot. It changes no plan value. Dismiss drops the proposal. A run that started is still charged.</p>
        {busy && <p className={`text-sm ${MUTED}`} role="status">Reading the recorded sources…</p>}
        {error && <p className={`text-sm ${MUTED}`} role="alert">{error} <button className={BUTTON} disabled={busy} onClick={() => run(mode)}>Try again</button></p>}
        {failedGaps.length > 0 && <ReadingCitations reading={{ gaps: failedGaps }} />}
        {proposal && <ReadingCitations reading={proposal.reading} />}
        <div className="flex flex-wrap gap-2">{proposal && <button className={PRIMARY} disabled={busy} onClick={keep}>Keep this reading</button>}<button className={BUTTON} onClick={close}>Dismiss</button></div>
      </div>
    </Lightbox>}
  </section>;
}

const LABEL_FIELD = /^milestone_label\.(product|go-to-market|infrastructure|operations|reserve)$/;
export function milestonePlacement(field, label, current) {
  return LABEL_FIELD.test(field) && typeof label === 'string' && label.trim() && label.length <= 200 && !String(current ?? '').trim()
    ? { field, value: label.trim() } : null;
}
/** UF6's name-only proposal, placed in the unsaved split form; its Save remains human. */
export function UseOfFundsMilestoneWording({ projectId, fields, values, setValue, busy: formBusy }) {
  const labels = fields.flatMap(f => f.parts ?? [f]).filter(f => LABEL_FIELD.test(f.name));
  const [roadmap, setRoadmap] = useState(null), [readError, setReadError] = useState(false), [okr, setOkr] = useState('');
  const [field, setField] = useState(labels[0]?.name ?? ''), [proposal, setProposal] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const serial = useRef(0);
  useRailOption('form:uof-milestone-wording', 'Suggest milestone wording');
  async function load() {
    const token = ++serial.current; setReadError(false);
    try { const r = await useOfFundsApi.readingRoadmap(projectId); if (token === serial.current) setRoadmap(r.items); }
    catch { if (token === serial.current) setReadError(true); }
  }
  useEffect(() => { setRoadmap(null); setOkr(''); setProposal(null); setError(''); setBusy(false); load(); return () => { serial.current++; }; }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps
  async function run() {
    const token = ++serial.current; setProposal(null); setError(''); setBusy(true);
    try { const r = await useOfFundsApi.previewReading(projectId, { mode: 'wording', okr_id: Number(okr) }, railPressHeaders(OPTIONS.wording)); if (token === serial.current) setProposal({ ...r, field }); }
    catch (e) { if (token === serial.current) setError(readingError(e)); }
    finally { if (token === serial.current) setBusy(false); }
  }
  const placement = proposal ? milestonePlacement(proposal.field, proposal.reading.items[0]?.text, values[proposal.field]) : null;
  return <section className="space-y-2 rounded-lg border border-violet-200 bg-violet-50 p-3 dark:border-violet-800 dark:bg-violet-950/30" data-testid="uof-milestone-wording">
    <p className={`text-sm font-bold ${INK}`}>Eadwyn · milestone name</p>
    <p className={`text-xs ${MUTED}`}>Accept places only the name below. Nothing is saved until Save split. Your existing wording stays.</p>
    <label className={`block text-xs ${MUTED}`}>Section<select aria-label="Milestone section" className={`mt-1 block min-h-11 w-full rounded-lg border bg-white p-2 dark:border-gray-700 dark:bg-gray-900 ${INK}`} value={field} onChange={e => { serial.current++; setField(e.target.value); setProposal(null); setBusy(false); }}>
      {labels.map(f => <option key={f.name} value={f.name}>{SECTION_NAMES[f.name.split('.')[1]]}</option>)}
    </select></label>
    <label className={`block text-xs ${MUTED}`}>Build roadmap item<select aria-label="Build roadmap item" className={`mt-1 block min-h-11 w-full rounded-lg border bg-white p-2 dark:border-gray-700 dark:bg-gray-900 ${INK}`} value={okr} onChange={e => { serial.current++; setOkr(e.target.value); setProposal(null); setBusy(false); }}>
      <option value="">Choose a recorded roadmap item</option>{roadmap?.map(r => <option key={r.id} value={r.id}>{r.objective}</option>)}
    </select></label>
    {readError && <p className={`text-xs ${MUTED}`}>Roadmap · Unreadable. <button type="button" onClick={load}>Try again</button></p>}
    {roadmap?.length === 0 && <p className={`text-xs ${MUTED}`}>Not recorded: add a Build roadmap item first.</p>}
    {String(values[field] ?? '').trim() && <p className={`text-xs ${MUTED}`}>Your milestone name stays. Clear it yourself to request new wording.</p>}
    <button type="button" className={BUTTON} disabled={formBusy || busy || !okr || !!String(values[field] ?? '').trim()} onClick={run}>{busy ? 'Reading the roadmap…' : 'Suggest wording from your roadmap'}</button>
    {error && <p className={`text-xs ${MUTED}`} role="alert">{error}</p>}
    {proposal && <><ReadingCitations reading={proposal.reading} /><div className="flex gap-2"><button type="button" className={PRIMARY} disabled={!placement || formBusy} onClick={() => { if (placement) { setValue(placement.field, placement.value); setProposal(null); } }}>Accept</button><button type="button" className={BUTTON} onClick={() => setProposal(null)}>Dismiss</button></div></>}
  </section>;
}
