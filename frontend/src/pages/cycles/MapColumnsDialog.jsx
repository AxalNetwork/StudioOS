import { useEffect, useMemo, useState } from 'react';
import Lightbox from '../../ui/Lightbox';
import { Unreadable, actionGhost, actionPrimary } from '../../ui';
import { googleWorkspace } from '../../lib/api/googleWorkspace';
import {
  DONT_USE, DONT_USE_WORD, mappingProblems, moduleLabel, problemCopy, sourceWord, workspaceRefusal,
} from '../../lib/googleWorkspaceWords';

/**
 * D1091 (#2956), D1314 §3 — Map columns (GW4), the one dialog both Sheet
 * feeds use (#2958 Product roadmap, #2960 Revenue and traction).
 *
 * It reads the chosen Sheet's preview (`POST …/files/:uid/preview`, the first
 * five rows, stored nowhere), offers each column a field of the module or
 * "Don’t use", and saves the mapping as a draft (`PUT …/files/:uid/mapping`).
 * The feed validates its own fields before any sync writes a row.
 *
 * A field with a `type` ('date' or 'number') is checked against the preview:
 * "Date column has 3 rows that are not dates. They will be skipped.", with the
 * rows named and marked Skipped in the preview. The dialog says the check is
 * over the preview's rows only. Axal VC never changes the sheet.
 *
 * D1093 (#2958) and D1095 (#2960): a feed whose Worker stores its mapping in
 * another shape passes
 * `encode(mapping, header)` (what the PUT sends) and `decode(saved, header)`
 * (the saved mapping as `{ column: field }`, for the first guess). Both default
 * to the dialog's own shape, `{ column: field }`.
 */

const MUTED = 'text-axal-muted dark:text-gray-400';
const LABEL = 'text-[10.5px] font-bold uppercase tracking-axal-label text-axal-muted dark:text-gray-400';
const SELECT = 'w-full rounded-axal-sm border border-axal-hairline bg-white px-2.5 py-1.5 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 max-sm:min-h-[44px]';

/** Each column's first guess: the field with the same name, else "Don’t use". */
export function guessMapping(header, fields, saved = null) {
  const out = {};
  for (const col of header) {
    if (saved && Object.hasOwn(saved, col)) { out[col] = saved[col]; continue; }
    const hit = fields.find((f) => f.label.toLowerCase() === String(col).trim().toLowerCase() || f.key === String(col).trim().toLowerCase());
    out[col] = hit ? hit.key : DONT_USE;
  }
  return out;
}

const identity = (m) => m;

export default function MapColumnsDialog({ file, fields, onClose, onSaved, encode = identity, decode = identity }) {
  const [read, setRead] = useState({ status: 'loading', rows: null });
  const [tick, setTick] = useState(0);
  const [mapping, setMapping] = useState(null);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  useEffect(() => {
    let alive = true;
    setRead({ status: 'loading', rows: null });
    Promise.resolve().then(() => googleWorkspace.preview(file.uid))
      .then((d) => { if (alive) setRead({ status: 'ready', rows: Array.isArray(d?.rows) ? d.rows : [] }); })
      .catch(() => { if (alive) setRead({ status: 'error', rows: null }); });
    return () => { alive = false; };
  }, [file.uid, tick]);

  const header = useMemo(() => (read.rows?.[0] || []).map((c, i) => String(c ?? '').trim() || `Column ${i + 1}`), [read.rows]);
  const body = useMemo(() => (read.rows || []).slice(1), [read.rows]);
  useEffect(() => { if (read.status === 'ready') setMapping(guessMapping(header, fields, decode(file.mapping ?? null, header))); }, [read.status, header, fields, file.mapping, decode]);
  const problems = mapping ? mappingProblems(header, body, mapping, fields) : [];
  const skipped = new Set(problems.flatMap((p) => p.rows.map((r) => r.row)));
  const used = mapping ? Object.values(mapping).filter((v) => v !== DONT_USE) : [];
  const twice = used.find((v, i) => used.indexOf(v) !== i);
  const target = moduleLabel(file.module) || 'this module';
  const day = String(file.last_synced_at || file.modified_time || '').slice(0, 10);

  const save = async () => {
    setBusy(true); setRefusal('');
    try { const saved = encode(mapping, header); await googleWorkspace.mapping(file.uid, saved); onSaved(saved); }
    catch (e) { setRefusal(workspaceRefusal(e)); setBusy(false); }
  };

  return (
    <Lightbox label="Map columns" title="Map columns" eyebrow={`Map “${file.name}” to ${target}`} onClose={() => { if (!busy) onClose(); }} width={720} testId="map-columns"
      footer={(
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className={`text-[12px] ${MUTED}`}>Axal VC reads this sheet. It never changes it.</span>
          <span className="flex gap-2">
            <button type="button" className={actionGhost} onClick={onClose} disabled={busy}>Cancel</button>
            <button type="button" className={actionPrimary} onClick={save} disabled={busy || !mapping || !used.length || !!twice} data-testid="map-columns-save">{busy ? 'Saving…' : 'Use this mapping'}</button>
          </span>
        </div>
      )}>
      <div className="flex flex-col gap-3 text-[13px] text-axal-ink dark:text-gray-200">
        <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="map-columns-source">From {sourceWord(file.kind)}{day ? ` · as of ${day}` : ''}</p>
        {read.status === 'loading' ? <p className={`m-0 ${MUTED}`} data-testid="map-columns-loading">Reading the first rows…</p> : null}
        {read.status === 'error' ? <Unreadable what={`“${file.name}”`} claim="Nothing was mapped." onRetry={() => setTick((n) => n + 1)} /> : null}
        {read.status === 'ready' && !header.length ? <p className="m-0" data-testid="map-columns-empty">The sheet’s first row is empty, so there are no columns to map.</p> : null}

        {problems.map((p) => {
          const copy = problemCopy(p);
          return (
            <div key={p.column} role="status" className="rounded-axal-sm border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200" data-testid="map-columns-problem">
              <p className="m-0 font-semibold">{copy.line}</p>
              <p className="m-0">{copy.rows} Only the preview’s rows are checked here.</p>
            </div>
          );
        })}
        {twice ? <p role="alert" className="m-0 text-[12.5px] text-red-700 dark:text-red-300" data-testid="map-columns-twice">Two columns go to the same field. Choose one.</p> : null}

        {mapping && header.length ? (
          <div className="flex flex-col gap-1.5" data-testid="map-columns-table">
            <div className="grid grid-cols-[minmax(0,1fr)_20px_minmax(0,1fr)] gap-2"><span className={LABEL}>Column in the sheet</span><span /><span className={LABEL}>Field in {target}</span></div>
            {header.map((col) => (
              <div key={col} className="grid grid-cols-[minmax(0,1fr)_20px_minmax(0,1fr)] items-center gap-2" data-testid="map-columns-row">
                <span className="min-w-0 break-words font-semibold">{col}</span>
                <span aria-hidden="true" className={MUTED}>→</span>
                <select className={SELECT} aria-label={`Field for the column ${col}`} value={mapping[col]}
                  onChange={(e) => setMapping({ ...mapping, [col]: e.target.value })} data-testid={`map-columns-field-${col}`}>
                  <option value={DONT_USE}>{DONT_USE_WORD}</option>
                  {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                </select>
              </div>
            ))}
          </div>
        ) : null}

        {mapping && body.length ? (
          <div className="flex flex-col gap-1" data-testid="map-columns-preview">
            <span className={LABEL}>Preview · first {body.length} {body.length === 1 ? 'row' : 'rows'}</span>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse font-mono text-[12px]">
                <thead><tr>{header.map((h) => <th key={h} className="border-b border-axal-hairline px-2 py-1 text-left font-semibold dark:border-gray-800">{h}</th>)}<th /></tr></thead>
                <tbody>
                  {body.map((r, i) => {
                    const skip = skipped.has(i + 2);
                    return (
                      <tr key={i} className={skip ? 'bg-amber-50 dark:bg-amber-900/30' : ''} data-testid={skip ? 'map-columns-skipped' : 'map-columns-kept'}>
                        {header.map((h, j) => <td key={h} className={`border-b border-axal-hairline px-2 py-1 dark:border-gray-800 ${skip ? 'text-axal-muted line-through dark:text-gray-400' : ''}`}>{String(r?.[j] ?? '')}</td>)}
                        <td className="px-2 py-1 text-[11px] font-bold text-amber-800 dark:text-amber-200">{skip ? 'Skipped' : ''}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
        {refusal ? <p role="alert" className="m-0 text-[12.5px] text-red-700 dark:text-red-300" data-testid="map-columns-refusal">{refusal}</p> : null}
      </div>
    </Lightbox>
  );
}
