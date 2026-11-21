// D7175 part 2 (#7175, canvas D7041, board RS-13 B5): the export preview.
// What the file will say, before it is downloaded, with a Markdown and a JSON
// tab: each tab reads the export it names (the saved version, the same words
// as the page) and nothing is downloaded until Download is pressed on a tab
// that answered with its own format. A tab that fails says so in its place,
// with Retry, and downloads nothing. Escape, Close and Cancel return focus to
// the control that opened it (RS-13 C4).
import React, { useEffect, useRef, useState } from 'react';
import { useEscapeClose } from '../../components/useEscapeClose.js';

const FORMATS = [['md', 'Markdown'], ['json', 'JSON']];
const ghost = 'min-h-[44px] rounded-lg border border-axal-hairline bg-white px-3 py-1.5 text-[12px] font-semibold text-axal-ink hover:bg-axal-ground '
  + 'disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800 md:min-h-[32px]';
const primary = 'min-h-[44px] rounded-lg bg-violet-700 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-violet-800 '
  + 'disabled:cursor-not-allowed disabled:bg-violet-200 disabled:text-violet-800 dark:bg-violet-500 dark:hover:bg-violet-400 dark:disabled:bg-violet-950 dark:disabled:text-violet-300 md:min-h-[32px]';
const segOn = 'bg-violet-700 text-white dark:bg-violet-500 dark:text-white';
const segOff = 'bg-white text-axal-ink hover:bg-axal-ground dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';

/**
 * `load(format)` resolves to `{ text, name, version }` or throws an Error
 * whose message says what came back; `onDownload({ format, text, name,
 * version })` writes the file; `onClose()` closes and returns focus.
 * `evidence` is drawn beside the heading (the page's chip), `note` under it.
 */
export default function ExportPreview({ initialFormat = 'md', load, onDownload, onClose, evidence = null, note = null }) {
  const [format, setFormat] = useState(initialFormat === 'json' ? 'json' : 'md');
  const [tabs, setTabs] = useState({}); // format -> { state: loading | ok | failed, got, error }
  const heading = useRef(null);
  const radios = useRef({});
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  useEscapeClose(onClose);
  // Focus lands on the dialog heading (RS-13 RCA00, step 9).
  useEffect(() => { heading.current?.focus?.(); }, []);

  const read = async (f) => {
    setTabs((t) => ({ ...t, [f]: { state: 'loading' } }));
    try {
      const got = await load(f);
      if (alive.current) setTabs((t) => ({ ...t, [f]: { state: 'ok', got } }));
    } catch (e) {
      if (alive.current) setTabs((t) => ({ ...t, [f]: { state: 'failed', error: e?.message || 'The export did not answer. Nothing was downloaded.' } }));
    }
  };
  useEffect(() => {
    if (!tabs[format]) read(format);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [format]);

  const keys = (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const next = format === 'md' ? 'json' : 'md';
    setFormat(next);
    radios.current[next]?.focus?.();
  };

  const tab = tabs[format] || { state: 'loading' };
  const ext = format === 'md' ? '.md' : '.json';
  return (
    <div className="fixed inset-0 z-50" role="presentation">
      <div className="absolute inset-0 bg-[rgba(24,24,27,.42)] dark:bg-[rgba(3,7,18,.66)]" onClick={onClose} aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-labelledby="export-preview-title" data-testid="export-preview"
        className="absolute inset-x-0 bottom-0 flex max-h-[90vh] flex-col rounded-t-[20px] border border-axal-hairline bg-white shadow-xl dark:border-gray-800 dark:bg-gray-950 md:inset-x-auto md:bottom-auto md:left-1/2 md:top-16 md:w-[720px] md:-translate-x-1/2 md:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-axal-hairline px-5 py-3.5 dark:border-gray-800">
          <div className="min-w-0">
            <h2 id="export-preview-title" ref={heading} tabIndex={-1}
              className="text-[18px] font-extrabold tracking-tight text-axal-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 dark:text-gray-100 dark:focus-visible:ring-offset-gray-950">
              Export preview
            </h2>
            <p className="mt-1 text-[12px] text-axal-muted">
              {`What the file will say, before it is downloaded · the same evidence words as the page${tab.got?.version ? ` · saved version ${tab.got.version}` : ''}`}
            </p>
            {note ? <p className="mt-1 text-[12px] font-semibold text-amber-800 dark:text-amber-300">{note}</p> : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {evidence}
            <button type="button" onClick={onClose} aria-label="Close export preview"
              className="grid h-11 w-11 place-items-center rounded-lg text-axal-muted hover:bg-axal-ground dark:text-gray-400 dark:hover:bg-gray-800 md:h-8 md:w-8">✕</button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-5 py-3">
          {tab.state === 'loading' && (
            <div role="status" aria-busy="true" data-testid="export-preview-loading">
              <span className="sr-only">{`Reading the ${format === 'md' ? 'Markdown' : 'JSON'} export.`}</span>
              {['w-7/12', 'w-10/12', 'w-9/12', 'w-6/12'].map((w) => <div key={w} aria-hidden="true" className={`mt-2 h-3 ${w} rounded bg-gray-200 dark:bg-gray-800`} />)}
            </div>
          )}
          {tab.state === 'failed' && (
            <div role="alert" data-testid="export-preview-failed"
              className="rounded-[10px] border border-red-200 bg-red-50 px-3.5 py-3 text-[12.5px] text-axal-ink dark:border-red-900 dark:bg-red-950/40 dark:text-gray-100">
              <b className="block">{tab.error}</b>
              <button type="button" className={`${ghost} mt-2`} onClick={() => read(format)}>Retry</button>
            </div>
          )}
          {tab.state === 'ok' && (
            <pre data-testid={`export-preview-${format}`}
              className="whitespace-pre-wrap break-words rounded-lg border border-axal-hairline bg-axal-ground p-3 font-mono text-[11.5px] leading-relaxed text-axal-ink dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
              {tab.got.text}
            </pre>
          )}
        </div>
        <div className="flex flex-col gap-2 border-t border-axal-hairline px-5 py-3 dark:border-gray-800 md:flex-row md:items-center md:justify-between">
          <div role="radiogroup" aria-label="Format" onKeyDown={keys}
            className="inline-flex self-start overflow-hidden rounded-lg border border-axal-hairline dark:border-gray-700">
            {FORMATS.map(([f, label]) => (
              <button key={f} type="button" role="radio" aria-checked={format === f ? 'true' : 'false'} tabIndex={format === f ? 0 : -1}
                ref={(n) => { radios.current[f] = n; }} onClick={() => setFormat(f)}
                className={`min-h-[44px] px-3 text-[12px] font-semibold md:min-h-[32px] ${format === f ? segOn : segOff}`}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex gap-2 md:justify-end">
            <button type="button" className={`${ghost} flex-1 md:flex-none`} onClick={onClose}>Cancel</button>
            <button type="button" className={`${primary} flex-1 md:flex-none`} disabled={tab.state !== 'ok'}
              onClick={() => onDownload({ format, ...tab.got })}>
              {`Download ${ext}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
