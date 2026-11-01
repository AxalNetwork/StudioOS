import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import { googleWorkspace } from '../../../lib/api/googleWorkspace';
import { reportError } from '../../../lib/log';
import { Lightbox } from '../../../ui';
import { versionRows } from './pitchStudioModel';
import {
  EXPORT_TITLE, FORMATS, OPTIONS_WHERE, GOOGLE_CONNECT, GOOGLE_CONNECT_HREF, GOOGLE_CONNECT_LINK, GOOGLE_STATE_UNREADABLE, OPEN_LINK,
  chartsAsTextLine, exportButton, exportDiagnostic, exportFailure, exportFileName, exportedLine, googleCreatedLine, googleOpenHref, googleState,
  lastExportLine, needsConnect, optionsApply, whatExportDoes,
} from './presentExportModel';

/**
 * D901 (#2680) — the export dialog (PD17), opened from the current-deck card.
 *
 * PDF and PowerPoint go through today's `POST /api/decks/:id/export`; HTML
 * through `POST /api/decks/:id/export/html`. D1112 (#2992): both carry the
 * two options, speaker notes and the Sources appendix, for every format. The Worker records every export
 * (`deck_exports`, with the file's fingerprint) before it hands the file over,
 * and the dialog says so before the write. A failure reads as PD25 does: what
 * could not be produced, and that nothing was shared.
 *
 * D904 (#2683): Google Slides creates a new, editable presentation in the
 * member's own Drive (`POST /api/decks/:id/export/google-slides`). Until
 * Google is connected the dialog says so, with the one link that connects it,
 * and offers no Export; after it, "Created in Google Slides · Open ›".
 *
 * D1604 (#3716, pd8b): the Slides-suite file (.odp) through D1603's
 * `POST /api/decks/:id/export/odp` (#3882, on main), with the same two
 * options, the same ledger row and the same failure sentence. Opened from the
 * header's Share ▾ › Export….
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
  const [failRef, setFailRef] = useState(null);
  const [done, setDone] = useState(null);
  const [ledger, setLedger] = useState({ status: 'loading', rows: [] });
  const [google, setGoogle] = useState({ status: 'idle', state: null });
  const [created, setCreated] = useState(null);
  const version = versions.find((v) => String(v.id) === String(versionId)) || current || null;

  const readLedger = useCallback(() => {
    if (!versionId) return;
    api.deckExportList(versionId)
      .then((r) => setLedger({ status: 'ok', rows: Array.isArray(r?.exports) ? r.exports : [] }))
      .catch((e) => { reportError('ExportDialog:ledger', e); setLedger({ status: 'error', rows: [] }); });
  }, [versionId]);
  useEffect(() => { readLedger(); }, [readLedger]);

  // D1091's connection read, once, when Google Slides is first chosen.
  useEffect(() => {
    if (format !== 'google_slides' || google.status !== 'idle') return;
    setGoogle({ status: 'loading', state: null });
    googleWorkspace.mine()
      .then((m) => setGoogle({ status: 'ok', state: googleState(m) }))
      .catch((e) => { reportError('ExportDialog:google', e); setGoogle({ status: 'ok', state: 'unreadable' }); });
  }, [format, google.status]);
  const isGoogle = format === 'google_slides';
  const connectFirst = isGoogle && google.state === 'connect';

  const run = async () => {
    if (!version?.id || busy) return;
    setBusy(true); setFailed(null); setFailRef(null); setDone(null); setCreated(null);
    try {
      if (format === 'google_slides') {
        const res = await api.deckExportGoogleSlides(version.id, { notes, sources });
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          setFailed(exportFailure(format, res.status, body));
          if (needsConnect(body)) setGoogle({ status: 'ok', state: 'connect' });
          if (body?.error === 'export_not_recorded_created') setCreated({ converted: body.converted, href: googleOpenHref(body.url), charts: null });
          return;
        }
        setCreated({ converted: body?.converted, href: googleOpenHref(body?.url), charts: body?.charts });
        readLedger();
        return;
      }
      const r = format === 'html'
        ? await api.deckExportHtml(version.id, { notes, sources })
        : format === 'odp'
          ? await api.deckExportOdp(version.id, { notes, sources })
          : await api.deckExport(version.id, format, { notes, sources });
      if (!r.ok) {
        const body = await r.json().catch(() => null);
        setFailed(exportFailure(format, r.status, body));
        setFailRef(exportDiagnostic(body));
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
          <button type="button" className={PRIMARY} onClick={run} disabled={busy || !version?.id || connectFirst || (isGoogle && google.status === 'loading')} data-testid="pitch-export-run">
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
                onClick={() => { if (!f.available) return; setFormat(f.id); setCreated(null); setFailed(null); }}
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
          {apply && (notes || sources) ? <span className={MUTED} data-testid="pitch-export-where">{OPTIONS_WHERE[format]}</span> : null}
        </div>
        {isGoogle && connectFirst ? (
          <div className="flex flex-col gap-1.5 rounded-[10px] border border-axal-hairline px-3 py-2.5 dark:border-gray-700" data-testid="pitch-export-google-connect">
            <span className={`text-[12.5px] ${INK}`}>{GOOGLE_CONNECT}</span>
            <Link to={GOOGLE_CONNECT_HREF} className="text-[12.5px] font-bold text-axal-violet hover:underline dark:text-violet-300" data-testid="pitch-export-google-connect-link">{GOOGLE_CONNECT_LINK}</Link>
          </div>
        ) : null}
        {isGoogle && google.state === 'unreadable' ? <span className={MUTED} data-testid="pitch-export-google-unreadable">{GOOGLE_STATE_UNREADABLE}</span> : null}
        <p className={`m-0 ${MUTED}`} data-testid="pitch-export-what">{whatExportDoes(version, format)}</p>
        <span className="font-mono text-[11.5px] text-axal-muted dark:text-gray-400" data-testid="pitch-export-last">
          {ledger.status === 'error' ? 'The export history could not be read.' : ledger.status === 'ok' ? lastExportLine(ledger.rows) : ' '}
        </span>
        {failed ? (
          <div role="alert" className="rounded-[10px] bg-red-50 px-3 py-2.5 text-[12.5px] font-semibold text-axal-destructive dark:bg-red-950/40 dark:text-red-300" data-testid="pitch-export-failed">
            {failed}
            {failRef ? <span className="mt-1 block font-mono text-[11px] font-normal" data-testid="pitch-export-failed-ref">{failRef}</span> : null}
          </div>
        ) : null}
        {created ? (
          <div role="status" className="flex flex-col gap-1 rounded-[10px] bg-emerald-50 px-3 py-2.5 text-[12.5px] font-semibold text-axal-positive dark:bg-emerald-950/40 dark:text-emerald-300" data-testid="pitch-export-google-created">
            <span>
              {googleCreatedLine(created.converted)}
              {created.href ? <> · <a href={created.href} target="_blank" rel="noopener noreferrer" className="underline" data-testid="pitch-export-google-open">{OPEN_LINK}</a></> : null}
            </span>
            {chartsAsTextLine(created.charts) ? <span className="font-normal" data-testid="pitch-export-google-charts">{chartsAsTextLine(created.charts)}</span> : null}
          </div>
        ) : null}
        {done ? (
          <div role="status" className="rounded-[10px] bg-emerald-50 px-3 py-2.5 text-[12.5px] font-semibold text-axal-positive dark:bg-emerald-950/40 dark:text-emerald-300" data-testid="pitch-export-done">{done}</div>
        ) : null}
      </div>
    </Lightbox>
  );
}
