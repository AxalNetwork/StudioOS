/** #5830: the founder's bound survey, qualifying mapping and private review queue; no automatic confirmation/sharing. */
import React, { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { connectorPilotReturn } from '../account/connectorPilotReturn';
import Lightbox from '../../ui/Lightbox';
import { typeformApi } from '../../lib/api/typeform';
import { mappingInput, mappingShape, typeformCount, typeformFailure } from './typeformJourneyModel';

const BOX = 'min-w-0 space-y-3 rounded-xl border border-axal-hairline bg-white p-4 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const BTN = 'min-h-[44px] cursor-pointer rounded-lg border border-axal-hairline px-3 py-2 hover:border-axal-violet focus-visible:outline focus-visible:outline-2 disabled:cursor-default dark:border-gray-700';
const INPUT = 'min-h-[44px] rounded-lg border border-axal-hairline bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-900';
const KINDS = ['loi', 'pre_sale', 'waitlist', 'need_to_have', 'would_pay'];
export default function TypeformJourney(props) { return <VentureTypeform key={props.projectId} {...props} />; }
function VentureTypeform({ projectId, api = typeformApi }) {
  const [returnParams] = useSearchParams();
  const [notice, setNotice] = useState('');
  const returnNote = connectorPilotReturn(returnParams, 'typeform');
  const [read, setRead] = useState(null), [status, setStatus] = useState(null), [reviews, setReviews] = useState(null), [mappings, setMappings] = useState([]);
  const [round, setRound] = useState(0), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [dialog, setDialog] = useState(null), [form, setForm] = useState(''), [page, setPage] = useState(1), [field, setField] = useState('');
  const [pendingTarget, setPendingTarget] = useState(null);
  const [targets, setTargets] = useState(null), [targetsError, setTargetsError] = useState(false);
  const [draft, setDraft] = useState({ kind: 'need_to_have', choices: '', equals: 'true', min: '', keep_text: false, hypothesis: '', experiment: '' });
  const alive = useRef(true), action = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let live = true;
    if (!projectId) { setLoading(false); return undefined; }
    setLoading(true); setError('');
    api.forms(projectId, page).then(async out => {
      if (!live) return;
      setRead(out);
      if (!out.binding?.own || out.binding.access_state !== 'ok') { setStatus(null); setReviews(null); setMappings([]); setLoading(false); return; }
      const values = await Promise.allSettled([api.syncStatus(projectId), api.reviews(projectId), api.mappings(projectId)]);
      if (!live) return;
      if (values[0].status === 'fulfilled') setStatus(values[0].value.status);
      if (values[1].status === 'fulfilled') setReviews(values[1].value);
      if (values[2].status === 'fulfilled') setMappings(values[2].value.items || []);
      if (values.some(x => x.status === 'rejected')) setError('Unreadable: part of this survey could not be read. Counts below may be stale; read again.');
      setLoading(false);
    }).catch(e => { if (live) { setRead(null); setReviews(null); setStatus(null); setMappings([]); setError(typeformFailure(e)); setLoading(false); } });
    return () => { live = false; };
  }, [api, projectId, page, round]);
  useEffect(() => {
    if (dialog !== 'mapping') return undefined;
    let live = true; setTargets(null); setTargetsError(false);
    Promise.resolve().then(() => api.targets(projectId)).then(value => { if (live) setTargets(value); }).catch(() => { if (live) setTargetsError(true); });
    return () => { live = false; };
  }, [api, projectId, dialog]);
  async function run(fn, close = true, refresh = true) {
    if (action.current) return;
    action.current = true; setBusy(true); setError(''); setNotice('');
    try { const result = await fn(); if (!alive.current) return; if (close) setDialog(null); if (refresh) setRound(n => n + 1); if (result?.outcome && result.outcome !== 'ok') setNotice(`Import outcome: ${result.outcome}. Read the status before continuing.`); }
    catch (e) { if (alive.current) setError(typeformFailure(e)); }
    finally { action.current = false; if (alive.current) setBusy(false); }
  }
  const own = read?.binding?.own && read?.capability?.can_bind;
  const fields = (read?.binding?.fields || []).filter(f => mappingShape(f.type));
  const selected = fields.find(f => f.id === field), shape = mappingShape(selected?.type);
  const rule = mappingInput(selected, draft);
  const saveMapping = async () => {
    const next = mappings.filter(m => m.field_id !== rule.field_id).map(m => ({ field_id: m.field_id, kind: m.kind, keep_text: !!m.keep_text, ...JSON.parse(m.rule_json || '{}') }));
    const result = await api.setMappings(projectId, [...next, rule]);
    if (!alive.current) return;
    const mapped = result.items?.find(m => m.field_id === rule.field_id);
    if (!mapped) throw new Error('mapping_not_recorded');
    const target = { field_mapping_id: mapped.id, hypothesis_id: Number(draft.hypothesis), experiment_id: draft.experiment ? Number(draft.experiment) : null };
    setPendingTarget(target);
    try { await api.evidenceMapping(projectId, target); if (alive.current) setPendingTarget(null); }
    catch { throw { data: { error: 'mapping_target_pending' } }; }
  };
  return <section className={BOX} aria-label="Typeform survey evidence" data-testid="typeform-journey">
    <h2 className="font-bold">Typeform survey evidence</h2>
    {returnNote && <p role="status">{returnNote}</p>}
    <p>Only completed, qualifying answers can be proposed. Confirmation is your decision; quotations stay private and are not permission to publish.</p>
    <div className="flex flex-wrap gap-2"><Link className={BTN} to={`/account/connectors/typeform?project_id=${encodeURIComponent(projectId)}`}>Connect or reconnect Typeform</Link><button type="button" className={BTN} disabled={busy || loading} onClick={() => setRound(n => n + 1)}>Read survey again</button>
      {read?.capability?.can_bind && <button type="button" className={BTN} disabled={busy} onClick={() => { setForm(read.binding?.form_id || ''); setDialog('form'); }}>Choose form</button>}
      {own && <><button type="button" className={BTN} disabled={busy} onClick={() => run(() => api.check(projectId))}>Check form access</button><button type="button" className={BTN} disabled={busy} onClick={() => setDialog('unbind')}>Unbind form</button></>}
      {own && read.binding.access_state === 'ok' && <><button type="button" className={BTN} disabled={busy || !!pendingTarget} onClick={() => run(() => api.sync(projectId))}>Import responses</button><button type="button" className={BTN} disabled={busy} onClick={() => { if (!pendingTarget) setField(fields[0]?.id || ''); setDialog('mapping'); }}>{pendingTarget ? 'Finish hypothesis link' : 'Map question'}</button><button type="button" className={BTN} disabled={busy || !!pendingTarget} onClick={() => run(() => api.prepare(projectId))}>Prepare review queue</button></>}
    </div>
    {notice && <p role="status">{notice}</p>}{pendingTarget && <p role="alert">The question rule was saved, but its hypothesis link is unfinished. Finish the link before importing or preparing more reviews.</p>}{loading && <p role="status">Reading survey…</p>}{busy && <p role="status">Working…</p>}{error && <p role="alert">{error}</p>}
    {!projectId && <p>Choose a venture first.</p>}
    {read && !read.binding && <p>Not recorded: no survey selected for this venture.</p>}
    {read?.binding && <p>Form: {read.binding.form_id} · Access: {read.binding.access_state} · Checked: {read.binding.checked_at || 'Not recorded'}</p>}
    {read?.binding && !read.binding.own && <p>Only the member whose connection holds this form can import and review it.</p>}
    {status && <><p>Import: {status.state} · Last successful import: {status.last_synced_at || 'Not recorded'} · Data through: {status.checkpoint || 'Not recorded'}</p><dl className="grid grid-cols-1 gap-3 sm:grid-cols-3"><div><dt>Completed submissions</dt><dd>{typeformCount(status.completed)}</dd></div><div><dt>Qualifying answers</dt><dd>{typeformCount(status.qualifying)}</dd></div><div><dt>Confirmed evidence</dt><dd>{typeformCount(reviews?.counts?.confirmed_signals)}</dd></div></dl>
      {status.state === 'ok' && status.completed === 0 && <p>This survey has no completed submissions.</p>}
      {status.completed > 0 && status.qualifying === 0 && <p>Completed submissions exist, but no stored answers match the current rules.</p>}
      {status.state !== 'ok' && <p>Import is {status.state}; a delayed or failed sync does not mean the survey is empty.</p>}
      {!!status.needs_remap?.length && <p>Map these questions again: {status.needs_remap.map(f => f.field_id).join(', ')}</p>}
    </>}
    {reviews && <div><h3 className="font-bold">Private review queue</h3>{!reviews.rows?.length && <p>No imported answers await review. Import and prepare the queue when eligible answers exist.</p>}
      {(reviews.rows || []).map(row => <article key={row.id} className="my-2 rounded-lg border border-axal-hairline p-3 dark:border-gray-700"><p>Hypothesis {row.hypothesis_id} · {row.direction} · Mapping version {row.mapping_version} · {row.status}</p>
        <button type="button" className={BTN} onClick={() => setDialog({ kind: 'quote', row })}>Review private quotation</button>
        {row.status === 'pending' && <><button type="button" className={BTN} disabled={busy} onClick={() => setDialog({ kind: 'confirm', row })}>Accept as evidence</button><button type="button" className={BTN} disabled={busy} onClick={() => run(() => api.decide(projectId, row.id, 'dismiss'))}>Dismiss</button></>}
        {row.status === 'confirmed' && <button type="button" className={BTN} disabled={busy} onClick={() => setDialog({ kind: 'unlink', row })}>Unlink evidence</button>}
      </article>)}
      {reviews.next_before && <button type="button" className={BTN} disabled={busy} onClick={() => run(async () => { const next = await api.reviews(projectId, reviews.next_before); if (alive.current) setReviews(r => ({ ...next, rows: [...r.rows, ...next.rows] })); }, false, false)}>Older reviews</button>}
    </div>}
    <p>Disconnect on the connector page stops imports and removes the binding. Accepted evidence and hypothesis links are not automatically unlinked. Unlink them here before disconnecting if you want them withdrawn. Disconnecting does not authorize publishing quotations. Remapping retracts affected reviewed evidence and requires review again.</p>
    {dialog && <Lightbox label="Typeform review" title={typeof dialog === 'string' ? ({ form: 'Choose form', mapping: 'Map a question', unbind: 'Unbind this form' }[dialog]) : dialog.kind === 'quote' ? 'Private quotation' : 'Review evidence change'} width={560} onClose={() => !busy && setDialog(null)} footer={<div className="flex justify-end gap-2"><button type="button" className={BTN} disabled={busy} onClick={() => setDialog(null)}>Cancel</button>
      {dialog === 'form' && <button type="button" className={BTN} disabled={busy || !form} onClick={() => run(() => api.select(projectId, form))}>Use this form</button>}
      {dialog === 'unbind' && <button type="button" className={BTN} disabled={busy} onClick={() => run(() => api.select(projectId, null))}>Unbind form</button>}
      {dialog === 'mapping' && !pendingTarget && <button type="button" className={BTN} disabled={busy || !rule || !targets?.hypotheses?.some(h => String(h.id) === draft.hypothesis) || (draft.experiment && !targets?.experiments?.some(e => String(e.id) === draft.experiment && String(e.hypothesis_id) === draft.hypothesis))} onClick={() => run(saveMapping)}>Save mapping</button>}
      {dialog === 'mapping' && pendingTarget && <><button type="button" className={BTN} disabled={busy} onClick={() => run(async () => { await api.evidenceMapping(projectId, pendingTarget); if (alive.current) setPendingTarget(null); })}>Retry hypothesis link</button><button type="button" className={BTN} disabled={busy} onClick={() => { setPendingTarget(null); setDialog(null); setNotice('The saved rule remains. Its link is unfinished; choose Map question to finish or change it later. Any affected evidence stays retracted until reviewed again.'); setRound(n => n + 1); }}>Leave link unfinished</button></>}
      {typeof dialog === 'object' && ['confirm', 'unlink'].includes(dialog.kind) && <button type="button" className={BTN} disabled={busy} onClick={() => run(() => api.decide(projectId, dialog.row.id, dialog.kind))}>{dialog.kind === 'confirm' ? 'Accept as evidence' : 'Unlink evidence'}</button>}
    </div>}>
      {dialog === 'form' && <fieldset><legend>Your Typeform forms</legend>{read?.forms_error ? <p role="alert">The form list could not be read. Cancel and read again.</p> : (read?.forms?.items || []).map(f => <label key={f.id} className="flex min-h-[44px] items-center gap-2"><input type="radio" name="typeform-form" value={f.id} checked={form === f.id} onChange={() => setForm(f.id)} />{f.title || f.id}</label>)}{page < (read?.forms?.page_count || 1) && <button type="button" className={BTN} onClick={() => setPage(n => n + 1)}>Next forms page</button>}{page > 1 && <button type="button" className={BTN} onClick={() => setPage(n => n - 1)}>Previous forms page</button>}</fieldset>}
      {dialog === 'unbind' && <p>Stop importing this form. Stored per-form history remains; it cannot propose or confirm new evidence while unbound.</p>}
      {dialog === 'mapping' && <form noValidate onSubmit={e => e.preventDefault()}><fieldset disabled={busy || !!pendingTarget} className="space-y-3"><legend className="font-semibold">Question rule and evidence target</legend>
        <label className="flex flex-col">Question (stable ID)<select className={INPUT} value={field} onChange={e => setField(e.target.value)}>{fields.map(f => <option key={f.id} value={f.id}>{f.ref || f.id} · {f.type}</option>)}</select></label>
        <label className="flex flex-col">Demand kind<select className={INPUT} value={draft.kind} onChange={e => setDraft(d => ({ ...d, kind: e.target.value }))}>{KINDS.map(k => <option key={k}>{k}</option>)}</select></label>
        {shape === 'choice' && <label className="flex flex-col">Qualifying choice IDs, comma separated<input className={INPUT} value={draft.choices} onChange={e => setDraft(d => ({ ...d, choices: e.target.value }))} /></label>}
        {shape === 'boolean' && <label className="flex flex-col">Qualifying answer<select className={INPUT} value={draft.equals} onChange={e => setDraft(d => ({ ...d, equals: e.target.value }))}><option value="true">Yes</option><option value="false">No</option></select></label>}
        {shape === 'number' && <label className="flex flex-col">Lowest qualifying number<input className={INPUT} inputMode="decimal" value={draft.min} onChange={e => setDraft(d => ({ ...d, min: e.target.value }))} /></label>}
        {shape === 'text' && <label className="flex min-h-[44px] items-center gap-2"><input type="checkbox" checked={draft.keep_text} onChange={e => setDraft(d => ({ ...d, keep_text: e.target.checked }))} />Keep this selected answer’s private quotation for review</label>}
        {targetsError ? <p role="alert">Hypotheses or experiments could not be read. Close and retry the mapping; no target is guessed.</p> : !targets ? <p role="status">Reading this venture’s hypotheses and experiments…</p> : <>
          <label className="flex flex-col">Hypothesis<select className={INPUT} value={draft.hypothesis} onChange={e => setDraft(d => ({ ...d, hypothesis: e.target.value, experiment: '' }))}><option value="">Choose a hypothesis</option>{targets.hypotheses.map(h => <option key={h.id} value={h.id}>{h.code} · {h.claim}</option>)}</select></label>
          <label className="flex flex-col">Experiment (optional)<select className={INPUT} value={draft.experiment} onChange={e => setDraft(d => ({ ...d, experiment: e.target.value }))}><option value="">No experiment selected</option>{targets.experiments.filter(e => String(e.hypothesis_id) === draft.hypothesis).map(e => <option key={e.id} value={e.id}>{e.title} · {e.status}</option>)}</select></label>
          {!targets.hypotheses.length && <p>No recorded hypotheses. Add one in Experiments before mapping survey evidence.</p>}
        </>}
        <p>Redacted preview: a completed response matching the selected rule will propose evidence for this hypothesis. Nothing is accepted automatically. Changed mappings retract affected evidence.</p>
      </fieldset>{pendingTarget && <p role="status">Retry hypothesis link sends only the retained target. It does not save the question rule again or repeat its retractions. You may leave the link unfinished; that does not undo the saved rule.</p>}</form>}
      {typeof dialog === 'object' && <><p>Hypothesis {dialog.row.hypothesis_id} · {dialog.row.direction} · Mapping version {dialog.row.mapping_version}</p>{dialog.kind === 'quote' ? <blockquote className="whitespace-pre-wrap break-words">{dialog.row.private_answer || 'Not recorded: private quotation was not retained.'}</blockquote> : <p>{dialog.kind === 'confirm' ? 'Confirm only this selected answer as evidence. The quotation stays private; sharing requires a separate permission.' : 'Remove this survey evidence link. The source remains withdrawn from confirmation until reviewed through the recorded rules.'}</p>}</>}
      {error && <p role="alert">{error}</p>}
    </Lightbox>}
  </section>;
}
