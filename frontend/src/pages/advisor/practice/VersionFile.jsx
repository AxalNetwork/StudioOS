import React, { useId, useState } from 'react';
import { FileText } from 'lucide-react';
import { DELIVERABLE_FILE_ACCEPT, DELIVERABLE_FILE_LIMITS_LINE } from './deliveryTrail';

/**
 * #5961 (D4833-p3) — a deliverable version's stored file (D5960): its name,
 * its size and a Download, on the advisor's Delivery sheet and on the
 * client's received list.
 *
 * READ-ONLY. A stored file belongs to a version, and a version is never edited
 * (D4712), so this offers a download and nothing else: no replace, no remove.
 *
 * A DOWNLOAD THAT FAILS SAVES NOTHING. `download()` resolves `{ blob,
 * filename }` only for a body that arrived and is not empty (the client
 * methods check `response.ok` and the size); anything else is said here as an
 * alert with Retry, and no file is handed to the browser.
 *
 * `FileChoice` is the other half: choosing a version's file before it is
 * saved, in the Add version dialog and the New work product form. It runs no
 * model and stores nothing; the page posts the chosen file with the version.
 */

/** Hands a downloaded blob to the browser as a file. Nothing is kept once the link has been clicked. */
export function saveBlob(blob, filename) {
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return;
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'document';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click?.();
    if (typeof a.remove === 'function') a.remove(); else a.parentNode?.removeChild?.(a);
  } finally {
    setTimeout(() => { try { URL.revokeObjectURL(url); } catch { /* already gone */ } }, 0);
  }
}

const plainRefusal = (e) => e?.message || 'The file could not be downloaded.';

/**
 * `describeError` turns a failed download into the sentence shown; by default
 * the Worker's own (D258's `request` reading). A surface with its own rule for
 * raw error text (Raise, #5070) passes its reader.
 */
export default function VersionFile({ name, sizeLabel = null, download = null, testid, save = saveBlob, describeError = plainRefusal }) {
  const [state, setState] = useState({ busy: false, error: '' });
  const run = async () => {
    setState({ busy: true, error: '' });
    try {
      const got = await download();
      if (!got?.blob || !got.blob.size) throw new Error('The file came back empty.');
      save(got.blob, got.filename || name);
      setState({ busy: false, error: '' });
    } catch (e) {
      setState({ busy: false, error: describeError(e) });
    }
  };
  return (
    <div data-testid={testid} className="grid gap-1">
      <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-axal-hairline bg-axal-ground px-3 py-2 text-[12.5px] text-axal-ink dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-100">
        <FileText size={14} aria-hidden="true" className="shrink-0 text-axal-faint dark:text-gray-400" />
        <span className="min-w-0 flex-1 truncate" data-testid={`${testid}-name`}>
          {name}
          {sizeLabel && <span className="text-axal-faint tabular-nums dark:text-gray-400"> · {sizeLabel}</span>}
        </span>
        {download && (
          <button type="button" onClick={run} disabled={state.busy} data-testid={`${testid}-download`}
            aria-label={`Download ${name}`}
            className="shrink-0 rounded-md px-2 py-0.5 text-[12px] font-semibold text-emerald-700 hover:underline disabled:opacity-50 dark:text-emerald-300">
            {state.busy ? 'Downloading…' : 'Download'}
          </button>
        )}
      </div>
      {state.error && (
        <p role="alert" data-testid={`${testid}-error`}
          className="flex flex-wrap items-center gap-2 text-[11.5px] font-semibold text-red-700 dark:text-red-300">
          <span>{state.error} Nothing was saved.</span>
          <button type="button" onClick={run} disabled={state.busy} data-testid={`${testid}-retry`}
            className="font-semibold text-emerald-700 hover:underline dark:text-emerald-300">
            Retry
          </button>
        </p>
      )}
    </div>
  );
}

/**
 * #5961 (D4833-p3) — "Choose a file" for a version's document: a PDF, JPEG or
 * PNG of at most 10 MB (D5960). The chosen file's name and Remove replace the
 * limits line. The input is visually hidden behind its label, which takes the
 * focus ring.
 */
export function FileChoice({ file, onChoose, testid, buttonClass }) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <input id={id} type="file" accept={DELIVERABLE_FILE_ACCEPT} className="peer sr-only" data-testid={testid}
        onChange={(e) => { const f = e.target.files?.[0] || null; onChoose(f); e.target.value = ''; }} />
      <label htmlFor={id} className={`${buttonClass} cursor-pointer peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-500`}>
        Choose a file
      </label>
      {file
        ? <span className="flex min-w-0 flex-1 items-center gap-2 text-[12px] text-axal-ink dark:text-gray-100" data-testid={`${testid}-name`}>
          <span className="min-w-0 truncate">{file.name}</span>
          <button type="button" className="shrink-0 text-[11.5px] font-semibold text-axal-muted hover:underline dark:text-gray-300"
            data-testid={`${testid}-clear`} onClick={() => onChoose(null)}>Remove</button>
        </span>
        : <span className="text-[11px] text-axal-faint dark:text-gray-400">{DELIVERABLE_FILE_LIMITS_LINE}</span>}
    </div>
  );
}
