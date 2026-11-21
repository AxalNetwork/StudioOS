import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Lightbox, Unreadable } from '../../../ui';
import { narrativeExportsApi } from '../../../lib/api/narrativeExports';
import {
  ADMIN_LINE, CLIPBOARD_BLOCKED, DOCX_LATER, FORMATS, LOG_EMPTY, LOG_UNREADABLE, NO_WORDS, NO_WORDS_SUB, PDF_FAILED, UNSAVED_LINE,
  copiedLine, copyLabel, defaultInclude, exportFailure, exportLogLine, exportModel, exportText, hasWords, includedSections, pdfLabel, takeOutTitle,
} from './exportModel';
import { downloadNarrativePdf } from './narrativePdf';

/**
 * D6070 (#6070) — RAN22, "Take vN out": the format (Copy text, PDF; DOCX is
 * shown and not offered), the include checklist, a preview of exactly what
 * goes out, and the export log. A PDF is made only after the export log
 * records it; an admin (RAN27d, owner pick A) copies the text only, and the
 * copy is recorded with their read reason first. A blocked clipboard leaves
 * the text selected to copy by hand (RAN27e). Dark (RAN29) and the phone
 * sheet (RAN28b) are the same component. See `exportModel.js`.
 */

const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-axal-muted dark:text-gray-400';
const EYEBROW = 'text-[10.5px] font-extrabold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const BTN = 'inline-flex min-h-[44px] items-center justify-center rounded-[9px] bg-axal-violet px-3.5 py-2 text-[12.5px] font-bold text-white hover:bg-axal-violet-deep disabled:cursor-not-allowed disabled:opacity-50 dark:bg-violet-600 dark:hover:bg-violet-500 sm:min-h-[36px]';
const GHOST = 'inline-flex min-h-[44px] items-center justify-center rounded-[9px] border border-axal-hairline bg-white px-3 py-1.5 text-[12.5px] font-bold text-axal-ink hover:bg-axal-ground disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800 sm:min-h-[36px]';
const NOT_SET = 'rounded-full border border-dashed border-gray-300 bg-axal-ground px-2 py-0.5 text-[10.5px] font-semibold text-axal-muted dark:border-gray-600 dark:bg-gray-800 dark:text-gray-400';
const PANEL = 'rounded-[10px] border border-axal-hairline bg-axal-ground p-3 dark:border-gray-700 dark:bg-gray-950';

function useExportLog(projectId, reload) {
  const [state, setState] = useState({ status: 'loading', rows: [] });
  useEffect(() => {
    let alive = true;
    setState({ status: 'loading', rows: [] });
    narrativeExportsApi.log(projectId)
      .then((r) => { if (alive) setState({ status: 'ready', rows: Array.isArray(r?.exports) ? r.exports : [] }); })
      .catch(() => { if (alive) setState({ status: 'error', rows: [] }); });
    return () => { alive = false; };
  }, [projectId, reload]);
  return state;
}

function Formats({ format, onPick, admin }) {
  return (
    <div role="radiogroup" aria-label="Format" className="grid grid-cols-1 gap-2 sm:grid-cols-3" data-testid="export-formats">
      {FORMATS.map((f) => {
        const offered = f.ready && (!admin || f.id === 'text');
        const on = format === f.id;
        return (
          <button key={f.id} type="button" role="radio" aria-checked={on} disabled={!offered} onClick={() => onPick(f.id)}
            className={`flex min-h-[44px] flex-col items-start gap-0.5 rounded-[10px] border px-3 py-2 text-left disabled:cursor-not-allowed disabled:opacity-60 ${on
              ? 'border-axal-violet bg-axal-lavender dark:border-violet-400 dark:bg-violet-950/40'
              : 'border-axal-hairline bg-white hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800'}`}
            data-testid={`export-format-${f.id}`}>
            <span className={`text-[13px] font-bold ${INK}`}>{f.label}</span>
            <span className={`text-[11.5px] ${MUTED}`}>{!f.ready ? DOCX_LATER : !offered ? 'The venture’s founder only' : f.sub}</span>
          </button>
        );
      })}
    </div>
  );
}

function Checklist({ model, include, onChange }) {
  const toggle = (key) => {
    const keys = new Set(include.keys);
    if (keys.has(key)) keys.delete(key); else keys.add(key);
    onChange({ ...include, keys });
  };
  const chosen = includedSections(model, include).length;
  return (
    <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0" data-testid="export-checklist">
      <legend className="flex w-full items-baseline justify-between">
        <span className={EYEBROW}>What is included</span>
        <span className={`font-mono text-[11.5px] ${MUTED}`}>{chosen} of {model.sections.length} sections</span>
      </legend>
      {model.sections.map((s) => (
        <label key={s.key} className={`flex min-h-[32px] items-center gap-2 text-[13px] ${s.body ? INK : MUTED}`} data-testid={`export-section-${s.key}`}>
          <input type="checkbox" checked={Boolean(s.body) && include.keys.has(s.key)} disabled={!s.body} onChange={() => toggle(s.key)} />
          <span>{s.label}</span>
          {!s.body ? <span className={NOT_SET}>Not recorded, left out</span> : null}
        </label>
      ))}
      <span className="mt-1 border-t border-axal-hairline pt-1.5 dark:border-gray-800" />
      <label className={`flex min-h-[32px] items-center gap-2 text-[13px] ${model.oneLiner ? INK : MUTED}`}>
        <input type="checkbox" checked={include.oneLiner && Boolean(model.oneLiner)} disabled={!model.oneLiner} onChange={() => onChange({ ...include, oneLiner: !include.oneLiner })} data-testid="export-one-liner" />
        Positioning one-liner {!model.oneLiner ? <span className={NOT_SET}>Not recorded</span> : null}
      </label>
      <label className={`flex min-h-[32px] items-center gap-2 text-[13px] ${INK}`}>
        <input type="checkbox" checked={include.notes} onChange={() => onChange({ ...include, notes: !include.notes })} data-testid="export-notes" /> Audience notes
      </label>
      <label className={`flex min-h-[32px] items-center gap-2 text-[13px] ${INK}`}>
        <input type="checkbox" checked={include.sources} onChange={() => onChange({ ...include, sources: !include.sources })} data-testid="export-sources" /> Sources
      </label>
    </fieldset>
  );
}

function ExportLog({ log }) {
  return (
    <section className="flex flex-col gap-1" data-testid="export-log">
      <span className={EYEBROW}>Export log</span>
      {log.status === 'loading' ? <span className={`text-[12px] ${MUTED}`}>Reading…</span>
        : log.status === 'error' ? <p role="alert" className="m-0 text-[12px] text-red-700 dark:text-red-300" data-testid="export-log-unreadable">{LOG_UNREADABLE}</p>
          : !log.rows.length ? <span className={`text-[12px] ${MUTED}`} data-testid="export-log-empty">{LOG_EMPTY} Copy by the founder is not logged.</span>
            : (
              <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                {log.rows.slice(0, 5).map((r) => <li key={r.id} className={`text-[12px] ${INK}`} data-testid="export-log-row">{exportLogLine(r)}</li>)}
              </ul>
            )}
    </section>
  );
}

/** Copy to the clipboard; false when the browser refused, so the text is shown selected instead. */
async function toClipboard(text) {
  try {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch { return false; }
}

export default function ExportDialog({ projectId, read, sources, admin = false, unsaved = false, onClose, now }) {
  // The export date is when the dialog opened, so the preview and the file say the same day.
  const [openedAt] = useState(() => now || new Date().toISOString());
  const model = useMemo(() => exportModel(read, sources, openedAt), [read, sources, openedAt]);
  const [include, setInclude] = useState(() => defaultInclude(model));
  const [format, setFormat] = useState('text');
  const [state, setState] = useState({ busy: false, done: null, error: null, blocked: false });
  const [reload, setReload] = useState(0);
  const log = useExportLog(projectId, reload);
  const area = useRef(null);
  const text = model ? exportText(model, include) : '';
  const count = model ? includedSections(model, include).length : 0;

  useEffect(() => {
    if (state.blocked && area.current) { area.current.focus(); area.current.select(); }
  }, [state.blocked]);

  const record = useCallback((fmt) => narrativeExportsApi.record(projectId, { version: model.version, format: fmt }), [projectId, model]);

  const copy = async () => {
    setState({ busy: true, done: null, error: null, blocked: false });
    if (admin) {
      // Owner pick A: an admin's copy is recorded with their read reason before anything is copied.
      try { await record('text'); } catch (e) { setState({ busy: false, done: null, error: exportFailure(e, { admin: true }), blocked: false }); return; }
      setReload((n) => n + 1);
    }
    const ok = await toClipboard(text);
    setState({ busy: false, done: ok ? copiedLine(count) : null, error: null, blocked: !ok });
  };

  const pdf = async () => {
    setState({ busy: true, done: null, error: null, blocked: false });
    try { await record('pdf'); } catch (e) { setState({ busy: false, done: null, error: exportFailure(e), blocked: false }); return; }
    setReload((n) => n + 1);
    try {
      const { pages } = await downloadNarrativePdf(model, include);
      setState({ busy: false, done: `Downloaded v${model.version} as PDF · ${pages} ${pages === 1 ? 'page' : 'pages'}`, error: null, blocked: false });
    } catch {
      setState({ busy: false, done: null, error: PDF_FAILED, blocked: false });
    }
  };

  const title = model ? takeOutTitle(model) : 'Export and copy';
  const empty = model && !hasWords(model);
  const primary = format === 'pdf' && !admin
    ? <button type="button" className={BTN} disabled={state.busy || !count} onClick={pdf} data-testid="export-pdf">{state.busy ? 'Recording…' : pdfLabel(count)}</button>
    : <button type="button" className={BTN} disabled={state.busy || !count} onClick={copy} data-testid="export-copy">{state.busy ? 'Copying…' : copyLabel(count)}</button>;

  return (
    <Lightbox label={title} eyebrow="Export and copy" title={title} onClose={onClose} width={860} size="tall" testId="narrative-export-dialog"
      footer={model && !empty ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {state.done ? <span role="status" className="mr-auto text-[12.5px] font-semibold text-emerald-700 dark:text-emerald-300" data-testid="export-done">{state.done}</span> : null}
          <button type="button" className={GHOST} onClick={onClose}>Close</button>
          {primary}
        </div>
      ) : (
        <div className="flex justify-end"><button type="button" className={GHOST} onClick={onClose}>Close</button></div>
      )}>
      {!model ? <Unreadable what={`Version ${read?.version ?? ''}`.trim()} claim="This is not a claim that it is empty. Nothing was exported." />
        : empty ? (
          <div className="flex flex-col gap-1.5" data-testid="export-no-words">
            <span className={`text-[14px] font-bold ${INK}`}>{NO_WORDS(model)}</span>
            <span className={`text-[12.5px] ${MUTED}`}>{NO_WORDS_SUB}</span>
          </div>
        ) : (
          <div className="flex flex-col gap-3.5">
            <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="export-names">
              v{model.version} · {model.audience ? `for ${model.audience}` : 'audience not recorded'} · {model.date} · {model.revision != null ? `revision ${model.revision}` : 'revision not recorded'}
            </p>
            {admin ? <p role="note" className={`m-0 rounded-[9px] border border-axal-hairline bg-axal-ground px-3 py-2 text-[12.5px] dark:border-gray-700 dark:bg-gray-800 ${INK}`} data-testid="export-admin">{ADMIN_LINE}</p> : null}
            {unsaved ? <p role="note" className="m-0 rounded-[9px] border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200" data-testid="export-unsaved">{UNSAVED_LINE}</p> : null}
            <Formats format={admin ? 'text' : format} onPick={setFormat} admin={admin} />
            <div className="grid grid-cols-1 gap-3.5 md:grid-cols-[260px_minmax(0,1fr)]">
              <Checklist model={model} include={include} onChange={setInclude} />
              <div className="flex min-w-0 flex-col gap-3">
                {state.error ? <p role="alert" className="m-0 text-[12.5px] font-semibold text-red-700 dark:text-red-300" data-testid="export-error">{state.error}</p> : null}
                {state.blocked ? (
                  <div className="flex flex-col gap-1.5" data-testid="export-blocked">
                    <p role="alert" className="m-0 text-[12.5px] font-semibold text-amber-900 dark:text-amber-200">{CLIPBOARD_BLOCKED}</p>
                    <textarea ref={area} readOnly value={text} rows={10} aria-label="The text to copy"
                      className="w-full rounded-[9px] border border-axal-hairline bg-white p-2 font-mono text-[12px] text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100" />
                  </div>
                ) : (
                  <section className={PANEL} aria-label="Preview" data-testid="export-preview">
                    <span className={EYEBROW}>{format === 'pdf' && !admin ? 'Preview · every page carries the version and date' : 'Preview'}</span>
                    <pre className={`m-0 mt-1.5 max-h-[320px] overflow-auto whitespace-pre-wrap font-sans text-[12.5px] leading-relaxed ${INK}`}>{text}</pre>
                  </section>
                )}
                <ExportLog log={log} />
              </div>
            </div>
          </div>
        )}
    </Lightbox>
  );
}
