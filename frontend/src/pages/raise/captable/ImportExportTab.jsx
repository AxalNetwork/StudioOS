import React, { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { cyclesApi } from '../../../lib/api/cycles';
import { capTableRecordApi } from '../../../lib/api/capTableRecord';
import { capTableRegisterApi } from '../../../lib/api/capTableRegister';
import { actionGhost, actionPrimary } from '../../../ui';
import MercuryRaiseFeed from '../../cycles/MercuryRaiseFeed';
import { AMBER, INK, LINK, MONO, MUTED, EYEBROW, ReadState, Section, TD, Table, useRead } from './CapTableTool';
import CapTableDialog, { useWrite } from './CapTableDialog';
import { day } from './capTableModel';
import {
  FIELDS, ROWS_MAX, TEMPLATE_CSV, counts, guessMap, importBody, mapWords, parseCsv, preview, proposeLabel,
} from './capTableImport';

/**
 * D1026 (#2863) — Import and export (CT14).
 *   - From Carta: D1020's binding, read only while connected.
 *   - From a spreadsheet: the template, a file, the column map, the preview
 *     checked against D1017's record, and "Propose [n] rows". Imports land as
 *     proposals, never on the record.
 *   - From Mercury: D840's SAFE requests, the same part Overview draws.
 *   - Export: the recorded register (CSV), the record and its history
 *     (spreadsheet), and the PDF snapshot to the data room. Each is audited on
 *     the Worker, and a download is refused rather than made without its row.
 */

const readLive = (id) => capTableRegisterApi.live(id);
const readRecord = (id) => capTableRecordApi.read(id);
const readModule = (id) => cyclesApi.module('raise', id, 'cap-table');
const TONE_ROW = {
  red: 'bg-red-50 dark:bg-red-950/30',
  amber: 'bg-amber-50 dark:bg-amber-950/30',
  green: '',
  plain: '',
};
const TONE_TEXT = {
  red: 'font-semibold text-red-700 dark:text-red-300',
  amber: 'font-semibold text-amber-800 dark:text-amber-300',
  green: 'font-semibold text-emerald-700 dark:text-emerald-300',
  plain: '',
};
const SELECT = 'rounded-[8px] border border-axal-hairline bg-white px-2 py-1 text-[12px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function downloadText(name, text) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

function CartaBlock({ projectId, reload, retry, onChanged }) {
  const live = useRead(readLive, projectId, reload);
  const [bind, setBind] = useState(false);
  const w = useWrite(() => { setBind(false); onChanged(); });
  const d = live.status === 'ready' ? live.data : null;
  const bound = d && d.carta_is_record;
  const elsewhere = d && d.connected && !bound && d.carta_project_id != null;
  return (
    <Section title="From Carta" testId="captable-carta">
      <ReadState read={live} what="Your Carta connection" claim="This is not a claim that Carta is not connected." onRetry={retry} testId="captable-carta">
        {!d?.connected ? (
          <div className="flex flex-col gap-2" data-testid="captable-carta-off">
            <span className={`text-[12.5px] ${INK}`}>Not connected. Carta is your record while connected, and StudioOS shows it read only.</span>
            <Link className={`${LINK} text-[12.5px]`} to="/account/connectors/carta">Connect Carta</Link>
          </div>
        ) : bound ? (
          <div className="flex flex-col gap-1" data-testid="captable-carta-record">
            <span className={`text-[12.5px] ${INK}`}>Carta is this venture’s record while connected. StudioOS shows it read only; change a holder in Carta.</span>
            <span className={`text-[12px] ${MUTED} ${MONO}`}>Last sync {d.last_synced_at ? day(d.last_synced_at) : 'not recorded'}{d.issuer_name ? ` · ${d.issuer_name}` : ''}</span>
            {d.last_error ? <span className={AMBER}>The last sync reported a problem. The rows shown are from the sync before it.</span> : null}
          </div>
        ) : (
          <div className="flex flex-col gap-2" data-testid="captable-carta-unbound">
            <span className={`text-[12.5px] ${INK}`}>{elsewhere ? 'Your Carta connection is the record for another of your ventures.' : 'Carta is connected, but not as this venture’s record.'}</span>
            <button type="button" className={`${actionGhost} w-fit`} onClick={() => setBind(true)} data-testid="captable-carta-bind">Make Carta this venture’s record</button>
          </div>
        )}
      </ReadState>
      {bind ? (
        <CapTableDialog title="Make Carta this venture’s record?" testId="captable-carta-dialog" write={w} onClose={() => setBind(false)} action="Make it the record"
          sub={elsewhere ? 'Carta’s rows move from your other venture to this one, and the next sync writes here. Co-founders see the change.' : 'Carta’s rows move to this venture, and the next sync writes here. Co-founders see the change.'}
          onAction={() => w.run(() => capTableRegisterApi.cartaVenture(projectId))} />
      ) : null}
    </Section>
  );
}

function SheetImport({ projectId, reload, retry, onChanged }) {
  const record = useRead(readRecord, projectId, reload);
  const [file, setFile] = useState(null);
  const [map, setMap] = useState({});
  const [filter, setFilter] = useState('all');
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState(null);
  const [readError, setReadError] = useState('');
  const w = useWrite((out) => { setConfirm(false); setResult(out); onChanged(); });
  const choose = async (e) => {
    const f = e.target.files?.[0];
    setResult(null); setReadError('');
    if (!f) return;
    try {
      const text = await f.text();
      const parsed = parseCsv(text);
      if (!parsed.headers.length) { setFile(null); setReadError('That file has no rows to read.'); return; }
      if (parsed.rows.length > ROWS_MAX) { setFile(null); setReadError(`That file has ${parsed.rows.length} rows; an import takes at most ${ROWS_MAX}.`); return; }
      setFile({ name: f.name, parsed, ref: await sha256Hex(text) });
      setMap(guessMap(parsed.headers));
    } catch {
      setFile(null); setReadError('That file could not be read as a CSV.');
    }
  };
  const rows = useMemo(() => (file && record.status === 'ready' ? preview(file.parsed, map, record.data) : []), [file, map, record]);
  const n = counts(rows);
  const shown = rows.filter((r) => (filter === 'errors' ? r.tone === 'red' : filter === 'changes' ? r.tone === 'amber' : true));
  return (
    <Section title="From a spreadsheet" testId="captable-sheet">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className={`text-[12.5px] ${INK}`}>Start from the template so the columns match.</span>
          <button type="button" className={actionGhost} onClick={() => downloadText('cap-table-import-template.csv', TEMPLATE_CSV)} data-testid="captable-sheet-template">Download the CSV template</button>
        </div>
        <label className="flex cursor-pointer flex-col gap-1 rounded-[10px] border-[1.5px] border-dashed border-violet-300 bg-violet-50 px-4 py-4 dark:border-violet-800 dark:bg-violet-950/30">
          <span className={`text-[13px] font-bold ${INK}`}>Choose a CSV file</span>
          <span className={`text-[12px] ${MUTED}`} data-testid="captable-sheet-file">{file ? `${file.name} · ${file.parsed.rows.length} ${file.parsed.rows.length === 1 ? 'row' : 'rows'} read` : 'Nothing is proposed until you press Propose.'}</span>
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={choose} data-testid="captable-sheet-input" />
        </label>
        {readError ? <p role="alert" className="m-0 text-[12px] font-semibold text-red-700 dark:text-red-300" data-testid="captable-sheet-error">{readError}</p> : null}
        {file ? (
          <ReadState read={record} what="The record the rows are checked against" claim="Nothing can be checked or proposed until it reads." onRetry={retry} testId="captable-sheet-record">
            <div className="flex flex-col gap-2" data-testid="captable-sheet-map">
              <span className={EYEBROW}>Column map</span>
              <div className="flex flex-wrap gap-2">
                {FIELDS.map((f) => (
                  <label key={f.id} className={`flex items-center gap-1.5 text-[12px] ${INK}`}>
                    {f.label} ←
                    <select className={SELECT} value={map[f.id] ?? ''} onChange={(e) => setMap((m) => ({ ...m, [f.id]: e.target.value === '' ? null : Number(e.target.value) }))} data-testid={`captable-sheet-map-${f.id}`}>
                      <option value="">Not in this file</option>
                      {file.parsed.headers.map((h, i) => <option key={`${h}-${i}`} value={i}>{h || `Column ${i + 1}`}</option>)}
                    </select>
                  </label>
                ))}
              </div>
              <span className={`text-[11.5px] ${MUTED}`} data-testid="captable-sheet-map-words">{mapWords(map, file.parsed.headers).join(' · ') || 'No column is mapped yet.'}</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2" data-testid="captable-sheet-filters">
              {[['all', `All rows ${n.all}`], ['errors', `Errors ${n.errors}`], ['changes', `Changes ${n.changes}`]].map(([id, label]) => (
                <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)} data-testid={`captable-sheet-filter-${id}`}
                  className={`rounded-full border px-3 py-1 text-[12px] font-bold ${filter === id ? 'border-axal-violet text-axal-ink dark:border-violet-400 dark:text-gray-100' : 'border-axal-hairline text-axal-muted dark:border-gray-700 dark:text-gray-400'}`}>{label}</button>
              ))}
            </div>
            <Table testId="captable-sheet-preview"
              cols={[{ key: 'r', label: 'Row' }, { key: 'h', label: 'Holder' }, { key: 't', label: 'Type' }, { key: 'c', label: 'Class' }, { key: 's', label: 'Shares' }, { key: 'd', label: 'Date' }, { key: 'k', label: 'Check' }]}
              rows={shown.map((r) => (
                <tr key={r.row} className={`border-b border-axal-ground last:border-b-0 dark:border-gray-800 ${TONE_ROW[r.tone]}`} data-testid={`captable-sheet-row-${r.tone}`}>
                  <td className={`${TD} ${MONO}`}>{r.row}</td><td className={TD}>{r.holder || '—'}</td><td className={TD}>{r.type || '—'}</td>
                  <td className={TD}>{r.className || '—'}</td><td className={`${TD} ${MONO}`}>{r.shares != null ? r.shares.toLocaleString('en-US') : '—'}</td>
                  <td className={`${TD} ${MONO}`}>{r.date ? day(r.date) : '—'}</td><td className={`${TD} ${TONE_TEXT[r.tone]}`}>{r.check}</td>
                </tr>
              ))} />
            <p className={`m-0 mt-2 text-[11.5px] ${MUTED}`}>Imports land as proposals, never on the record. A row with an error is left out, and a row that matches the record is left out so nothing counts twice.</p>
            <div className="mt-2 flex justify-end">
              <button type="button" className={actionPrimary} disabled={n.propose === 0} onClick={() => setConfirm(true)} data-testid="captable-sheet-propose">{proposeLabel(n.propose)}</button>
            </div>
          </ReadState>
        ) : null}
        {result ? <p className={`m-0 text-[12.5px] ${INK}`} data-testid="captable-sheet-done">{proposeLabel(result.proposed).replace('Propose', 'Proposed')}. Each waits for the owner’s Accept.</p> : null}
      </div>
      {confirm ? (
        <CapTableDialog title={`${proposeLabel(n.propose)}?`} testId="captable-sheet-dialog" write={w} onClose={() => setConfirm(false)} action={proposeLabel(n.propose)}
          sub="Each row becomes a proposal on the record’s Proposals. Nothing counts until the owner accepts it. Co-founders see the proposals."
          onAction={() => w.run(() => capTableRecordApi.importRows(projectId, importBody(rows, file.ref)))}>
          {n.errors ? <span className={`text-[12px] ${MUTED}`}>{n.errors} {n.errors === 1 ? 'row is' : 'rows are'} left out for errors.</span> : null}
        </CapTableDialog>
      ) : null}
    </Section>
  );
}

function MercuryBlock({ projectId, reload, retry, onChanged }) {
  const mod = useRead(readModule, projectId, reload);
  const part = mod.status === 'ready' ? mod.data?.parts?.mercury : null;
  return (
    <ReadState read={mod} what="Your Mercury SAFE requests" claim="This is not a claim that there are none." onRetry={retry} testId="captable-mercury">
      {part
        ? <MercuryRaiseFeed slug="cap-table" part={part} projectId={projectId} reload={onChanged} />
        : (
          <Section title="From Mercury" testId="captable-mercury-none">
            <p className={`m-0 text-[12.5px] ${MUTED}`}>Mercury’s SAFE requests come from the owner’s own Mercury, and only the owner sees them. Each one the owner accepts is recorded and appears in the record for you too.</p>
          </Section>
        )}
    </ReadState>
  );
}

function ExportBlock({ projectId }) {
  const [busy, setBusy] = useState(null);
  const [said, setSaid] = useState({});
  const [snap, setSnap] = useState(false);
  const w = useWrite((out) => { setSnap(false); setSaid((s) => ({ ...s, snapshot: `Added to the data room as ${out?.file?.name || 'the snapshot'}, under NDA and seen by nobody until you share it.` })); });
  const run = async (key, fn) => {
    setBusy(key); setSaid((s) => ({ ...s, [key]: '' }));
    try { await fn(); setSaid((s) => ({ ...s, [key]: 'Downloaded.' })); } catch (e) { setSaid((s) => ({ ...s, [key]: e?.message || 'The export could not be made. Nothing was downloaded.' })); } finally { setBusy(null); }
  };
  const row = (key, title, sub, label, onClick) => (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-axal-ground py-2 last:border-b-0 dark:border-gray-800" data-testid={`captable-export-${key}`}>
      <span className="flex flex-col"><span className={`text-[13px] font-bold ${INK}`}>{title}</span>{sub ? <span className={`text-[11.5px] ${MUTED}`}>{sub}</span> : null}{said[key] ? <span className={`text-[11.5px] ${INK}`} role="status">{said[key]}</span> : null}</span>
      <button type="button" className={actionGhost} disabled={busy != null} onClick={onClick} data-testid={`captable-export-${key}-go`}>{busy === key ? 'Preparing…' : label}</button>
    </div>
  );
  return (
    <Section title="Export" testId="captable-export">
      {row('csv', 'Cap table (CSV)', 'The recorded register: holders, then securities. A missing figure is an empty cell.', 'Download', () => run('csv', () => capTableRegisterApi.exportCsv(projectId)))}
      {row('history', 'Cap table and history (spreadsheet)', 'The record’s issuances, voids with their reasons, and its history.', 'Download', () => run('history', () => capTableRecordApi.exportCsv(projectId)))}
      {row('snapshot', 'Add the snapshot to the data room', 'A PDF stamped As of today, kept under NDA and seen by nobody until you share it.', 'Add', () => setSnap(true))}
      {snap ? (
        <CapTableDialog title="Add the snapshot to the data room?" testId="captable-snapshot-dialog" write={w} onClose={() => setSnap(false)} action="Add to the data room"
          sub="A PDF of the recorded cap table, stamped As of today. It is filed under NDA and nobody sees it until you share it."
          onAction={() => w.run(() => capTableRegisterApi.snapshot(projectId))} />
      ) : null}
    </Section>
  );
}

export default function ImportExportTab({ projectId, reload: outer, retry: outerRetry }) {
  const [local, setLocal] = useState(0);
  const reload = `${outer}:${local}`;
  const refresh = useCallback(() => setLocal((n) => n + 1), []);
  const retry = useCallback(() => { outerRetry?.(); refresh(); }, [outerRetry, refresh]);
  return (
    <div className="grid gap-3.5 lg:grid-cols-3" data-testid="captable-import-export">
      <div className="flex flex-col gap-3.5">
        <CartaBlock projectId={projectId} reload={reload} retry={retry} onChanged={refresh} />
        <MercuryBlock projectId={projectId} reload={reload} retry={retry} onChanged={refresh} />
        <ExportBlock projectId={projectId} />
      </div>
      <div className="flex flex-col gap-3.5 lg:col-span-2">
        <SheetImport projectId={projectId} reload={reload} retry={retry} onChanged={refresh} />
      </div>
    </div>
  );
}
