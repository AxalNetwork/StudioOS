import React, { useState } from 'react';
import { contractsApi } from '../../../lib/api/contracts';
import { reportError } from '../../../lib/log';
import { ReadState, button, card, input, useRead } from './parts';

/**
 * D4811 (#4811) part 17 — an agreement's cross-border checks (board CT-15):
 * counterparty jurisdiction, governing law (as chosen, never defaulted to
 * Delaware), countries of performance, and four reviews (tax, data transfer,
 * local counsel, sanctions / trade). While any is open the Worker refuses to
 * send the agreement, and this panel says which. An agreement with no record
 * is not marked cross-border.
 */
export const FACT_FIELDS = Object.freeze([['counterparty_jurisdiction', 'Counterparty jurisdiction'], ['governing_law', 'Governing law'], ['performance_countries', 'Countries of performance']]);
export const REVIEW_FIELDS = Object.freeze([['tax', 'Tax review'], ['data_transfer', 'Data-transfer mechanism'], ['local_counsel', 'Local-counsel review'], ['sanctions', 'Sanctions / trade review']]);
const STATE = { resolved: ['Resolved', 'text-emerald-800 dark:text-emerald-300'], not_applicable: ['Not applicable', 'text-axal-muted'], open: ['◷ Open', 'font-semibold text-amber-800 dark:text-amber-300'] };

/** "5 of 7 resolved" (not applicable counts as settled), or null with no record. */
export function resolvedLine(checks) {
  if (!checks) return null;
  const settled = checks.filter((c) => c.state !== 'open').length;
  return `${settled} of ${checks.length} resolved`;
}

/** The form's starting values from a record (or empty: nothing is defaulted). */
export function formOf(record) {
  const f = {};
  for (const [k] of FACT_FIELDS) f[k] = record?.[k] ?? '';
  for (const [k] of REVIEW_FIELDS) { f[`${k}_status`] = record?.[`${k}_status`] ?? 'open'; f[`${k}_note`] = record?.[`${k}_note`] ?? ''; }
  return f;
}

export default function CrossBorderPanel({ uid }) {
  const [rev, setRev] = useState(0);
  const read = useRead(() => contractsApi.crossBorder(uid), [uid, rev]);
  const [editing, setEditing] = useState(false);
  return <section aria-label="Cross-border" className={`${card} space-y-2 p-4 text-[12.5px]`} data-testid="cross-border-panel">
    <ReadState read={read} what="Cross-border checks">{read.data && (editing
      ? <Form uid={uid} record={read.data.record} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); setRev((n) => n + 1); }} />
      : <View data={read.data} onEdit={() => setEditing(true)} />)}</ReadState>
  </section>;
}

function View({ data, onEdit }) {
  if (!data.checks) return <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-axal-muted">Not marked cross-border.</p>
    <button type="button" className={button} onClick={onEdit}>Mark as cross-border</button></div>;
  return <>
    <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="font-bold">Cross-border <span className="font-normal text-axal-muted">{resolvedLine(data.checks)}</span></h3>
      <button type="button" className={button} onClick={onEdit}>Edit checks</button></div>
    <ul className="divide-y divide-axal-hairline">{data.checks.map((c) => <li key={c.key} className="flex flex-wrap items-start justify-between gap-2 py-1.5">
      <span><b>{c.label}</b><span className="block text-axal-muted">{c.value || (c.state === 'open' ? 'Not entered' : '')}</span></span>
      <span className={STATE[c.state]?.[1]}>{STATE[c.state]?.[0]}</span></li>)}</ul>
    {data.open.length > 0 && <p role="status" className="text-amber-800 dark:text-amber-300" data-testid="cross-border-held">Send for signature is held: {data.open.join(', ')} {data.open.length === 1 ? 'is' : 'are'} open.</p>}
  </>;
}

function Form({ uid, record, onCancel, onSaved }) {
  const [f, setF] = useState(() => formOf(record));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  async function save() {
    setBusy(true); setError('');
    try { await contractsApi.saveCrossBorder(uid, f); onSaved(); }
    catch (e) { reportError('contracts:cross-border', e); setError(e?.message || 'The checks were not saved.'); }
    finally { setBusy(false); }
  }
  return <div role="group" aria-label="Cross-border checks" className="space-y-2" data-testid="cross-border-form">
    <p className="text-axal-muted">Governing law is what the agreement says. Nothing is filled in for you.</p>
    {FACT_FIELDS.map(([k, label]) => <label key={k} className="block font-semibold">{label}<input className={input} maxLength={k === 'performance_countries' ? 300 : 200} value={f[k]} onChange={set(k)} /></label>)}
    {REVIEW_FIELDS.map(([k, label]) => <fieldset key={k} className="rounded-lg border border-axal-hairline p-2"><legend className="px-1 font-semibold">{label}</legend>
      <select aria-label={`${label} status`} className={input} value={f[`${k}_status`]} onChange={set(`${k}_status`)}>
        <option value="open">Open</option><option value="resolved">Resolved</option><option value="not_applicable">Not applicable</option></select>
      <input aria-label={`${label} note`} className={`${input} mt-1`} maxLength={500} value={f[`${k}_note`]} onChange={set(`${k}_note`)} placeholder="How it was resolved, or why it does not apply" /></fieldset>)}
    {error && <p role="alert" className="text-red-700 dark:text-red-300">{error}</p>}
    <div className="flex gap-2"><button type="button" className={button} onClick={onCancel}>Cancel</button>
      <button type="button" className={`${button} bg-violet-600 text-white`} disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save checks'}</button></div>
  </div>;
}
