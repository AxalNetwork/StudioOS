import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { reportError } from '../../../lib/log';
import { Lightbox } from '../../../ui';
import { versionRows } from './pitchStudioModel';
import {
  EXPORT_TITLE, FORMATS, OPTIONS_HTML_ONLY, exportButton, exportFailure, exportFileName, exportedLine,
  lastExportLine, optionsApply, whatExportDoes,
} from './presentExportModel';

/**
 * D901 (#2680) — the export dialog (PD17), opened from the current-deck card.
 *
 * PDF and PowerPoint go through today's `POST /api/decks/:id/export`; HTML
 * through `POST /api/decks/:id/export/html`. The Worker records every export
 * (`deck_exports`, with the file's fingerprint) before it hands the file over,
 * and the dialog says so before the write. Google Slides is drawn, not
 * offered: it is part 10. A failure reads as PD25 does: what could not be
 * produced, and that nothing was shared.
 */

const BTN = 'inline-flex min-h-[36px] items-center justify-center gap-2 whitespace-nowrap rounded-[9px] px-3.5 text-[12.5px] font-bold';
const GHOST = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const PRIMARY = `${BTN} bg-axal-violet text-white hover:bg-axal-violet-deep disabled:opacity-60`;
const MUTED = 'text-[12.5px] leading-[1.45] text-axal-muted dark:text-gray-400';
const INK = 'text-axal-ink dark:text-gray-100';

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ExportDialog({ versions, current, onClose }) {
  const rows = versionRows(versions);
  const [format, setFormat] = useState('pdf');
  const [versionId, setVersionId] = useState(current?.id ?? rows[0]?.id ?? null);
  const [notes, setNotes] = useState(true);
  const [sources, setSources] = useState(true);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(null);
  const [done, setDone] = useState(null);
  const [ledger, setLedger] = useState({ status: 'loading', rows: [] });
  const version = versions.find((v) => String(v.id) === String(versionId)) || current || null;

  const readLedger = useCallback(() => {
    if (!versionId) return;
    api.deckExportList(versionId)
      .then((r) => setLedger({ status: 'ok', rows: Array.isArray(r?.exports) ? r.exports : [] }))
      .catch((e) => { reportError('ExportDialog:ledger', e); setLedger({ status: 'error', rows: [] }); });
  }, [versionId]);
  useEffect(() => { readLedger(); }, [readLedger]);

  const run = async () => {
    if (!version?.id || busy) return;
    setBusy(true); setFailed(null); setDone(null);
    try {
      const r = format === 'html'
        ? await api.deckExportHtml(version.id, { notes, sources })
        : await api.deckExport(version.id, format);
      if (!r.ok) {
        const body = await r.json().catch(() => null);
        setFailed(exportFailure(format, r.status, body));
        return;
      }
      download(await r.blob(), exportFileName(version.title, version.version, format));
      setDone(exportedLine(format, version));
      readLedger();
    } catch (e) {
      reportError('ExportDialog:export', e);
      setFailed(exportFailure(format, 0, null));
    } finally { setBusy(false); }
  };

  const apply = optionsApply(format);
  return (
    <Lightbox
      label="Export"
      title={EXPORT_TITLE(version)}
      width={560}
      onClose={() => !busy && onClose()}
      testId="pitch-export-dialog"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={GHOST} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={PRIMARY} onClick={run} disabled={busy || !version?.id} data-testid="pitch-export-run">
            {busy ? 'Exporting…' : exportButton(format)}
          </button>
        </div>
      )}
    >
      <div className="flex flex-col gap-3.5">
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Format">
          {FORMATS.map((f) => {
            const on = f.id === format;
            return (
              <button
                key={f.id}
                type="button"
                role="radio"
                aria-checked={on}
                aria-disabled={!f.available}
                disabled={!f.available}
                onClick={() => f.available && setFormat(f.id)}
                className={`flex flex-col gap-0.5 rounded-[10px] border px-3 py-2.5 text-left ${on ? 'border-axal-violet bg-axal-lavender dark:bg-violet-950/40' : 'border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900'} ${f.available ? '' : 'cursor-not-allowed opacity-60'}`}
                data-testid={`pitch-export-format-${f.id}`}
              >
                <span className={`text-[13px] font-bold ${INK}`}>{f.label}</span>
                <span className="text-[11.5px] text-axal-muted dark:text-gray-400">{f.available ? f.line : f.reason}</span>
              </button>
            );
          })}
        </div>
        <label className={`flex items-center justify-between gap-3 text-[12.5px] ${INK}`}>
          <span>Version</span>
          <select
            className="min-h-[34px] rounded-[8px] border border-axal-hairline bg-white px-2 font-mono text-[12px] dark:border-gray-700 dark:bg-gray-900"
            value={versionId ?? ''}
            onChange={(e) => setVersionId(e.target.value)}
            data-testid="pitch-export-version"
          >
            {rows.map((r) => <option key={r.id} value={r.id}>{r.label} · saved {r.saved}{r.current ? ' · current' : ''}</option>)}
          </select>
        </label>
        <div className="flex flex-col gap-2 text-[12.5px]">
          <label className={`flex items-center gap-2 ${apply ? INK : 'text-axal-muted dark:text-gray-500'}`}>
            <input type="checkbox" checked={notes} disabled={!apply} onChange={(e) => setNotes(e.target.checked)} data-testid="pitch-export-notes" /> Include speaker notes
          </label>
          <label className={`flex items-center gap-2 ${apply ? INK : 'text-axal-muted dark:text-gray-500'}`}>
            <input type="checkbox" checked={sources} disabled={!apply} onChange={(e) => setSources(e.target.checked)} data-testid="pitch-export-sources" /> Include a Sources appendix
          </label>
          {!apply ? <span className={MUTED}>{OPTIONS_HTML_ONLY}</span> : null}
        </div>
        <p className={`m-0 ${MUTED}`} data-testid="pitch-export-what">{whatExportDoes(version)}</p>
        <span className="font-mono text-[11.5px] text-axal-muted dark:text-gray-400" data-testid="pitch-export-last">
          {ledger.status === 'error' ? 'The export history could not be read.' : ledger.status === 'ok' ? lastExportLine(ledger.rows) : ' '}
        </span>
        {failed ? (
          <div role="alert" className="rounded-[10px] bg-red-50 px-3 py-2.5 text-[12.5px] font-semibold text-axal-destructive dark:bg-red-950/40 dark:text-red-300" data-testid="pitch-export-failed">{failed}</div>
        ) : null}
        {done ? (
          <div role="status" className="rounded-[10px] bg-emerald-50 px-3 py-2.5 text-[12.5px] font-semibold text-axal-positive dark:bg-emerald-950/40 dark:text-emerald-300" data-testid="pitch-export-done">{done}</div>
        ) : null}
      </div>
    </Lightbox>
  );
}
