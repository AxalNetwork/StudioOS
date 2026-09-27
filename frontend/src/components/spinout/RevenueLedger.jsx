// The Revenue page's entry ledger (D363, migration 311): the canvas's
// "Revenue entries" table with its five filters, the investor-view toggle,
// manual entry, CSV import with column mapping, proof attachment, and the
// mix / confidence bars — all over GET /api/revenue/projects/:id/entries.
//
// Every figure is a sum of the Worker's integer cents (lib/revenueLedger.js).
// Verification is the Worker's: an entry is "Supported" once a document on
// this startup is attached and "Manual" until then. "Verified" is reserved
// for a Stripe charge sync, which does not exist yet, so "Verified revenue"
// reads Not recorded with that reason rather than 0%.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Eye, EyeOff, FileText, Loader2, Plus, Trash2, Upload, X } from 'lucide-react';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';
import { Unreadable, Unrecorded } from '../../ui';
import {
  IMPORT_FIELDS, LEDGER_FILTERS, LEDGER_STATUS, LEDGER_TYPES,
  fmtLedgerCents, guessMapping, mapImportRows, parseCsv, summarizeLedger,
} from '../../lib/revenueLedger';

const CARD = 'rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-5';
const LBL = 'text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500';
const INPUT = 'w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-[13px] text-gray-900 dark:text-gray-100';
const PILL_ON = 'border-teal-500 bg-teal-50 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300';
const PILL_OFF = 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-500 dark:text-gray-400';
const STATUS_CLS = {
  verified: 'text-emerald-700 bg-emerald-50 dark:bg-emerald-900/40 dark:text-emerald-300',
  supported: 'text-amber-700 bg-amber-50 dark:bg-amber-900/40 dark:text-amber-300',
  manual: 'text-gray-500 bg-gray-100 dark:bg-gray-800 dark:text-gray-400',
};
const typeLabel = (k) => LEDGER_TYPES.find((t) => t.k === k)?.label || k;
const today = () => new Date().toISOString().slice(0, 10);
const EMPTY_FORM = { customer: '', amount: '', received_on: '', revenue_type: '', proof_document_id: '' };

/**
 * A dollars string typed by the founder → integer cents, or null. Text-parsed,
 * like the Worker's CSV path: "1,200.50" → 120050; three decimals → null.
 */
export function typedAmountToCents(raw) {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(raw ?? '').trim().replace(/^\$/, '').replace(/,/g, ''));
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number((m[2] || '').padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

export default function RevenueLedger({ project, canEdit }) {
  const [read, setRead] = useState({ status: 'loading', entries: [] }); // loading | ok | failed
  const [docs, setDocs] = useState(null); // null = not read / failed
  const [filter, setFilter] = useState('all');
  const [investorView, setInvestorView] = useState(false);
  const [modal, setModal] = useState(null); // 'manual' | 'import' | null
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [csv, setCsv] = useState(null); // { name, headers, rows, mapping, defaultType }
  const [importResult, setImportResult] = useState(null);
  const [rowErr, setRowErr] = useState({ uid: null, message: '' });

  const load = useCallback(async () => {
    setRead((r) => ({ ...r, status: 'loading' }));
    try {
      const res = await api.revenueEntries(project.id);
      setRead({ status: 'ok', entries: Array.isArray(res?.entries) ? res.entries : [] });
    } catch (e) {
      reportError('spinout-revenue:ledger', e);
      setRead({ status: 'failed', entries: [] });
    }
    try {
      const d = await api.listDocuments(project.id);
      setDocs(Array.isArray(d) ? d : d?.documents || []);
    } catch (e) {
      reportError('spinout-revenue:ledger-docs', e);
      setDocs(null);
    }
  }, [project.id]);
  useEffect(() => { load(); }, [load]);

  const entries = read.entries;
  const summary = useMemo(() => summarizeLedger(entries), [entries]);
  const shown = useMemo(() => {
    const f = LEDGER_FILTERS.find((x) => x.k === filter) || LEDGER_FILTERS[0];
    // Investor view is the same rows without the unevidenced ones — a view,
    // not a different ledger.
    return entries.filter(f.test).filter((e) => !investorView || e.verification !== 'manual');
  }, [entries, filter, investorView]);

  const openManual = () => { setErr(''); setForm({ ...EMPTY_FORM, received_on: '' }); setModal('manual'); };
  const formCents = typedAmountToCents(form.amount);
  const formReady = form.customer.trim() && formCents !== null && /^\d{4}-\d{2}-\d{2}$/.test(form.received_on)
    && LEDGER_TYPES.some((t) => t.k === form.revenue_type);

  const saveManual = async () => {
    if (!formReady || busy) return;
    setBusy(true); setErr('');
    try {
      await api.revenueEntryCreate(project.id, {
        customer: form.customer.trim(),
        amount_cents: formCents,
        received_on: form.received_on,
        revenue_type: form.revenue_type,
        proof_document_id: form.proof_document_id ? Number(form.proof_document_id) : null,
      });
      setModal(null);
      await load();
    } catch (e) {
      reportError('spinout-revenue:ledger-create', e);
      setErr(e?.message || 'The entry could not be saved.');
    } finally { setBusy(false); }
  };

  const onFile = async (file) => {
    setErr(''); setImportResult(null);
    try {
      const text = await file.text();
      const all = parseCsv(text);
      if (all.length < 2) throw new Error('The file needs a header row and at least one entry.');
      const [headers, ...rows] = all;
      setCsv({ name: file.name, headers, rows, mapping: guessMapping(headers), defaultType: '' });
    } catch (e) {
      reportError('spinout-revenue:ledger-csv', e);
      setErr(e?.message || 'The file could not be read as CSV.');
    }
  };
  const mapped = csv ? mapImportRows(csv.rows, csv.mapping, csv.defaultType) : [];
  const importReady = csv && csv.mapping.customer != null && csv.mapping.amount != null && csv.mapping.received_on != null
    && (csv.mapping.revenue_type != null || LEDGER_TYPES.some((t) => t.k === csv.defaultType));

  const runImport = async () => {
    if (!importReady || busy) return;
    setBusy(true); setErr('');
    try {
      const res = await api.revenueEntriesImport(project.id, mapped);
      setImportResult({ inserted: Number.isInteger(res?.inserted) ? res.inserted : null, rejected: res?.rejected || [] });
      await load();
    } catch (e) {
      reportError('spinout-revenue:ledger-import', e);
      // A refused import still lists why each row failed.
      if (Array.isArray(e?.data?.rejected)) setImportResult({ inserted: 0, rejected: e.data.rejected });
      setErr(e?.message || 'The import could not be saved.');
    } finally { setBusy(false); }
  };

  const attachProof = async (entry, docId) => {
    setRowErr({ uid: null, message: '' });
    try {
      await api.revenueEntryUpdate(project.id, entry.uid, { proof_document_id: docId ? Number(docId) : null });
      await load();
    } catch (e) {
      reportError('spinout-revenue:ledger-proof', e);
      setRowErr({ uid: entry.uid, message: `${e?.message || 'Proof could not be attached.'} The entry is unchanged.` });
    }
  };
  const remove = async (entry) => {
    setRowErr({ uid: null, message: '' });
    try {
      await api.revenueEntryDelete(project.id, entry.uid);
      await load();
    } catch (e) {
      reportError('spinout-revenue:ledger-delete', e);
      setRowErr({ uid: entry.uid, message: `${e?.message || 'The entry could not be removed.'} It is still on the ledger.` });
    }
  };

  const docName = (id) => (docs || []).find((d) => Number(d.id) === Number(id))?.title || `Document ${id}`;
  const pct = (part) => (summary.totalCents > 0 ? Math.round((part / summary.totalCents) * 100) : 0);

  return (
    <div className="space-y-5" data-testid="revenue-ledger">
      {/* Ledger KPIs — sums of recorded entries, never the self-reported total. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { k: 'total', label: 'Ledger total', value: read.status === 'failed' ? null : fmtLedgerCents(summary.totalCents), sub: `${summary.count} entr${summary.count === 1 ? 'y' : 'ies'}` },
          { k: 'customers', label: 'Paying customers (ledger)', value: read.status === 'failed' ? null : String(summary.customers), sub: 'distinct customer names' },
          { k: 'verified', label: 'Verified revenue', value: summary.verifiedShare === null ? 'unrecorded' : `${Math.round(summary.verifiedShare * 100)}%`, sub: 'Stripe-synced share' },
          { k: 'proof', label: 'Proof coverage', value: read.status === 'failed' ? null : `${summary.proofBacked} of ${summary.count}`, sub: 'entries with a document' },
        ].map((kpi) => (
          <div key={kpi.k} className={`${CARD} !p-4`} data-testid={`ledger-kpi-${kpi.k}`}>
            <div className="text-[17px] font-extrabold text-gray-900 dark:text-gray-50 tabular-nums truncate">
              {read.status === 'loading' ? <Loader2 size={14} className="animate-spin text-gray-400" /> : kpi.value === 'unrecorded'
                ? <Unrecorded reason="Verified means synced from a Stripe charge, and no charge sync exists yet — the Stripe import records MRR and customer counts only." />
                : kpi.value === null ? <Unrecorded reason="The ledger could not be read.">Unreadable</Unrecorded> : kpi.value}
            </div>
            <div className="text-[11px] font-bold text-gray-600 dark:text-gray-300 mt-0.5">{kpi.label}</div>
            <div className="text-[10px] text-gray-400 dark:text-gray-500 truncate">{kpi.sub}</div>
          </div>
        ))}
      </div>

      <div className={CARD} data-testid="card-ledger">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <div className={LBL}>Revenue entries</div>
          <div className="flex flex-wrap gap-1.5">
            {LEDGER_FILTERS.map((f) => (
              <button key={f.k} type="button" onClick={() => setFilter(f.k)} data-testid={`ledger-filter-${f.k}`}
                className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border ${filter === f.k ? PILL_ON : PILL_OFF}`}>
                {f.label}
              </button>
            ))}
            <button type="button" onClick={() => setInvestorView((v) => !v)} data-testid="ledger-investor-view"
              className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border inline-flex items-center gap-1 ${investorView ? PILL_ON : PILL_OFF}`}>
              {investorView ? <EyeOff size={11} /> : <Eye size={11} />} {investorView ? 'Investor view on' : 'Investor view'}
            </button>
          </div>
        </div>
        <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-3">
          {investorView ? 'Investor view hides entries with no evidence attached.' : 'Supported entries have a document attached; manual entries do not yet.'}
        </p>
        {canEdit && (
          <div className="flex flex-wrap gap-2 mb-3">
            <button type="button" onClick={openManual} data-testid="ledger-add-manual" className="text-[12px] font-bold text-white bg-teal-600 hover:bg-teal-700 rounded-lg px-3 py-1.5 inline-flex items-center gap-1.5">
              <Plus size={13} /> Add manually
            </button>
            <button type="button" onClick={() => { setErr(''); setCsv(null); setImportResult(null); setModal('import'); }} data-testid="ledger-import" className="text-[12px] font-bold text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800 rounded-lg px-3 py-1.5 inline-flex items-center gap-1.5">
              <Upload size={13} /> Import CSV
            </button>
          </div>
        )}
        {read.status === 'loading' ? (
          <div className="py-6 text-center"><Loader2 size={16} className="animate-spin text-gray-400 inline" /></div>
        ) : read.status === 'failed' ? (
          <div className="py-4" data-testid="ledger-unreadable">
            <Unreadable what="The revenue ledger" claim="This is not a claim that no revenue is recorded." onRetry={load} />
          </div>
        ) : shown.length === 0 ? (
          <p className="text-[12px] text-gray-500 dark:text-gray-400 py-6 text-center" data-testid="ledger-empty">
            {entries.length === 0 ? 'No revenue entries recorded yet.' : 'No entries match this filter.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left text-[10px] font-bold uppercase tracking-wider text-gray-400 border-b border-gray-100 dark:border-gray-800">
                  <th className="py-2 pr-2">Customer</th><th className="py-2 pr-2 text-right">Amount</th><th className="py-2 pr-2">Type</th>
                  <th className="py-2 pr-2">Date</th><th className="py-2 pr-2">Status</th><th className="py-2 pr-2">Proof</th>{canEdit && <th />}
                </tr>
              </thead>
              <tbody>
                {shown.map((e) => (
                  <tr key={e.uid} className="border-b border-gray-50 dark:border-gray-800/60 align-top" data-testid={`ledger-row-${e.uid}`}>
                    <td className="py-2 pr-2">
                      <div className="font-semibold text-gray-900 dark:text-gray-50">{e.customer}</div>
                      <div className="text-[10.5px] text-gray-400">{e.source === 'csv' ? 'CSV import' : e.source === 'stripe' ? 'Stripe' : 'Manual'}</div>
                      {rowErr.uid === e.uid && <div className="text-[10.5px] text-rose-600 dark:text-rose-400" data-testid={`ledger-row-error-${e.uid}`}>{rowErr.message}</div>}
                    </td>
                    <td className="py-2 pr-2 text-right font-mono font-bold tabular-nums">{fmtLedgerCents(e.amount_cents)}</td>
                    <td className="py-2 pr-2">{typeLabel(e.revenue_type)}</td>
                    <td className="py-2 pr-2 font-mono text-gray-600 dark:text-gray-300">{e.received_on}</td>
                    <td className="py-2 pr-2">
                      <span className={`text-[10.5px] font-semibold rounded-full px-2 py-0.5 ${STATUS_CLS[e.verification] || STATUS_CLS.manual}`} title={LEDGER_STATUS[e.verification]?.note}>
                        {LEDGER_STATUS[e.verification]?.label || e.verification}
                      </span>
                    </td>
                    <td className="py-2 pr-2">
                      {canEdit && docs !== null ? (
                        <select value={e.proof_document_id ?? ''} onChange={(ev) => attachProof(e, ev.target.value)} data-testid={`ledger-proof-${e.uid}`}
                          className="max-w-[160px] rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-1.5 py-1 text-[11px]">
                          <option value="">No proof</option>
                          {docs.map((d) => <option key={d.id} value={d.id}>{d.title || d.doc_type || `Document ${d.id}`}</option>)}
                        </select>
                      ) : e.proof_document_id != null ? (
                        <span className="inline-flex items-center gap-1 text-[11px]"><FileText size={11} /> {docName(e.proof_document_id)}</span>
                      ) : <span className="text-[11px] text-gray-400">None</span>}
                    </td>
                    {canEdit && (
                      <td className="py-2">
                        <button type="button" onClick={() => remove(e)} aria-label={`Remove ${e.customer}`} className="text-gray-400 hover:text-rose-600"><Trash2 size={13} /></button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[10.5px] text-gray-400 dark:text-gray-500 mt-2" data-testid="ledger-mode-note">
          The design's Week 3 / Week 4 mode tabs are not built: they would only reword this page, so nothing would stand behind them.
        </p>
        {canEdit && docs === null && read.status === 'ok' && (
          <p className="text-[10.5px] text-amber-600 dark:text-amber-400 mt-2" data-testid="ledger-docs-unreadable">
            Your documents could not be read, so proof cannot be attached right now.
          </p>
        )}
      </div>

      {/* Mix & confidence — shares of the recorded total, by type and by evidence. */}
      {read.status === 'ok' && summary.count > 0 && (
        <div className={CARD} data-testid="card-ledger-mix">
          <div className={`${LBL} mb-3`}>Revenue mix &amp; confidence</div>
          <div className="space-y-2">
            {LEDGER_TYPES.map((t) => (
              <div key={t.k} className="text-[11.5px]">
                <div className="flex justify-between"><span className="text-gray-600 dark:text-gray-300">{t.label}</span><span className="font-mono">{fmtLedgerCents(summary.byType[t.k])} · {pct(summary.byType[t.k])}%</span></div>
                <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-800"><div className="h-full rounded-full bg-teal-500" style={{ width: `${pct(summary.byType[t.k])}%` }} /></div>
              </div>
            ))}
            <div className="pt-2 mt-2 border-t border-gray-100 dark:border-gray-800 text-[11.5px] flex flex-wrap gap-x-4 gap-y-1">
              {['supported', 'manual'].map((v) => (
                <span key={v}>{LEDGER_STATUS[v].label}: <b className="font-mono">{fmtLedgerCents(summary.byVerification[v])}</b> ({pct(summary.byVerification[v])}%)</span>
              ))}
              <span>Verified: <Unrecorded reason="No Stripe charge sync exists yet." /></span>
            </div>
          </div>
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" role="dialog" aria-modal="true"
          onClick={() => !busy && setModal(null)} data-testid={`modal-ledger-${modal}`}>
          <div className={`${CARD} w-full max-w-lg`} onClick={(ev) => ev.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div className="text-[14px] font-bold text-gray-900 dark:text-gray-50">{modal === 'manual' ? 'Add a revenue entry' : 'Import revenue from CSV'}</div>
              <button type="button" onClick={() => setModal(null)} className="text-gray-400"><X size={16} /></button>
            </div>
            {modal === 'manual' ? (
              <div className="space-y-3">
                <label className="block"><span className={LBL}>Customer / company</span>
                  <input className={INPUT} value={form.customer} maxLength={200} onChange={(ev) => setForm({ ...form, customer: ev.target.value })} data-testid="ledger-input-customer" /></label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block"><span className={LBL}>Amount (USD)</span>
                    <input className={INPUT} inputMode="decimal" value={form.amount} placeholder="1,200.00" onChange={(ev) => setForm({ ...form, amount: ev.target.value })} data-testid="ledger-input-amount" /></label>
                  <label className="block"><span className={LBL}>Date received</span>
                    <input className={INPUT} type="date" max={today()} value={form.received_on} onChange={(ev) => setForm({ ...form, received_on: ev.target.value })} data-testid="ledger-input-date" /></label>
                </div>
                <div><span className={LBL}>Revenue type</span>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {LEDGER_TYPES.map((t) => (
                      <button key={t.k} type="button" onClick={() => setForm({ ...form, revenue_type: t.k })} data-testid={`ledger-type-${t.k}`}
                        className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border ${form.revenue_type === t.k ? PILL_ON : PILL_OFF}`}>{t.label}</button>
                    ))}
                  </div>
                </div>
                <label className="block"><span className={LBL}>Proof (optional)</span>
                  {docs === null ? <p className="text-[11px] text-amber-600">Your documents could not be read; attach proof later.</p> : (
                    <select className={INPUT} value={form.proof_document_id} onChange={(ev) => setForm({ ...form, proof_document_id: ev.target.value })} data-testid="ledger-input-proof">
                      <option value="">None yet</option>
                      {docs.map((d) => <option key={d.id} value={d.id}>{d.title || d.doc_type || `Document ${d.id}`}</option>)}
                    </select>
                  )}</label>
                <p className="text-[10.5px] text-gray-400">Grants, investment capital and non-operating cash are not customer revenue.</p>
                {err && <p className="text-[11.5px] text-rose-600" role="alert" data-testid="ledger-form-error">{err}</p>}
                <button type="button" onClick={saveManual} disabled={!formReady || busy} data-testid="ledger-save"
                  className="w-full text-[13px] font-bold text-white bg-teal-600 rounded-lg py-2 disabled:opacity-50">
                  {busy ? 'Saving…' : 'Save revenue entry'}
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <input type="file" accept=".csv,text/csv" data-testid="ledger-csv-file" onChange={(ev) => { const f = ev.target.files?.[0]; if (f) onFile(f); ev.target.value = ''; }} className="text-[12px]" />
                {csv && (
                  <>
                    <div className={LBL}>Column mapping · {csv.name} · {csv.rows.length} row{csv.rows.length === 1 ? '' : 's'}</div>
                    {IMPORT_FIELDS.map((f) => (
                      <label key={f.k} className="flex items-center justify-between gap-2 text-[12px]">
                        <span className="text-gray-600 dark:text-gray-300">{f.label}</span>
                        <select value={csv.mapping[f.k] ?? ''} data-testid={`ledger-map-${f.k}`}
                          onChange={(ev) => setCsv({ ...csv, mapping: { ...csv.mapping, [f.k]: ev.target.value === '' ? null : Number(ev.target.value) } })}
                          className="rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-1.5 py-1 text-[11.5px]">
                          <option value="">{f.k === 'revenue_type' ? 'Not in file' : 'Choose a column'}</option>
                          {csv.headers.map((h, i) => <option key={`${h}-${i}`} value={i}>{h || `Column ${i + 1}`}</option>)}
                        </select>
                      </label>
                    ))}
                    {csv.mapping.revenue_type == null && (
                      <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]"><span className="text-gray-500">Type for every row:</span>
                        {LEDGER_TYPES.map((t) => (
                          <button key={t.k} type="button" onClick={() => setCsv({ ...csv, defaultType: t.k })}
                            className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${csv.defaultType === t.k ? PILL_ON : PILL_OFF}`}>{t.label}</button>
                        ))}
                      </div>
                    )}
                    <div className="text-[11px] text-gray-500 dark:text-gray-400" data-testid="ledger-csv-preview">
                      {mapped.slice(0, 3).map((r, i) => <div key={i} className="font-mono truncate">{r.customer || '—'} · {r.amount || '—'} · {r.received_on || '—'} · {r.revenue_type || '—'}</div>)}
                    </div>
                    <p className="text-[10.5px] text-gray-400">Each row is checked by the server; rows it cannot read exactly are listed, not rounded. Imported entries start as Manual until proof is attached.</p>
                  </>
                )}
                {importResult && (
                  <div className="text-[11.5px]" data-testid="ledger-import-result">
                    <div className="font-semibold">{importResult.inserted === null ? 'Recorded count not returned' : `${importResult.inserted} recorded`} · {importResult.rejected.length} refused</div>
                    {importResult.rejected.slice(0, 8).map((r) => <div key={r.index} className="text-rose-600">Row {r.index + 2}: {r.message}</div>)}
                  </div>
                )}
                {err && <p className="text-[11.5px] text-rose-600" role="alert" data-testid="ledger-import-error">{err}</p>}
                <button type="button" onClick={runImport} disabled={!importReady || busy} data-testid="ledger-run-import"
                  className="w-full text-[13px] font-bold text-white bg-teal-600 rounded-lg py-2 disabled:opacity-50">
                  {busy ? 'Importing…' : 'Validate & import'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
