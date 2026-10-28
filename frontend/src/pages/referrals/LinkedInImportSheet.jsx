import React, { useState } from 'react';
import Sheet from '../../ui/Sheet.jsx';
import BrandIcon from '../../ui/BrandIcon.jsx';
import { readLinkedInCsv } from '../../lib/linkedinCsv';

/**
 * D1353 (#3568, part 4 of #3564) — Refer & Earn's "Import from LinkedIn", end
 * to end, in the shared right Sheet (D1317).
 *
 *   1. Download your connections from LinkedIn: the data-export page, with the
 *      one-line path to Connections.
 *   2. Drop or choose Connections.csv. It is read in the browser.
 *   3. The preview: how many have an email (they can be invited) and how many
 *      have none, said in words, never dropped silently.
 *
 * Signing in with LinkedIn is no step here: LinkedIn gives no connections over
 * its API, so the file is the import. "Add to your invite list" hands the rows
 * with an email to the page, which gives each its personalised link. Nothing
 * is sent or saved by the sheet.
 */
export const EXPORT_URL = 'https://www.linkedin.com/mypreferences/d/download-my-data';
export const EXPORT_PATH = 'Settings → Data privacy → Get a copy of your data → Connections';
export const NO_EMAIL_LINE = 'LinkedIn didn’t include an email for these; invite them by sharing your link on LinkedIn.';
export const MAX_BYTES = 2 * 1024 * 1024;

const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-[12.5px] leading-snug text-axal-muted dark:text-gray-400';
const STEP = 'flex h-6 w-6 flex-none items-center justify-center rounded-full bg-axal-lavender font-mono text-[11px] font-bold text-axal-violet dark:bg-violet-950/50 dark:text-violet-300';
const BTN = 'inline-flex min-h-[40px] items-center justify-center rounded-[10px] px-4 text-[13px] font-bold disabled:cursor-not-allowed disabled:opacity-50';
const PRIMARY = `${BTN} bg-axal-violet text-white hover:bg-axal-violet-deep`;
const GHOST = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;

/** What a file read says, in the sheet's words. */
export function previewOf(read) {
  if (!read) return null;
  if (!read.header) return { ok: false, text: 'This file has no email column. Download Connections.csv from LinkedIn and choose it here.' };
  const n = read.rows.length;
  return {
    ok: n > 0,
    can: `${n} ${n === 1 ? 'has an email and can be invited' : 'have an email and can be invited'}`,
    cannot: read.no_email ? `${read.no_email} ${read.no_email === 1 ? 'has' : 'have'} no email` : null,
  };
}

export default function LinkedInImportSheet({ onAdd, onClose }) {
  const [file, setFile] = useState(null);
  const [read, setRead] = useState(null);
  const [error, setError] = useState(null);
  const [over, setOver] = useState(false);

  const take = (f) => {
    setError(null); setRead(null); setFile(null);
    if (!f) return;
    if (f.size > MAX_BYTES) { setError('That file is larger than 2 MB. Choose Connections.csv from the export.'); return; }
    const reader = new FileReader();
    reader.onload = () => { setFile(f.name); setRead(readLinkedInCsv(String(reader.result || ''))); };
    reader.onerror = () => setError('That file could not be read. Choose it again.');
    reader.readAsText(f);
  };
  const preview = previewOf(read);

  return (
    <Sheet label="Import from LinkedIn" eyebrow="Refer & Earn" title="Import from LinkedIn" width={520} onClose={onClose} testId="rf-linkedin-sheet"
      footer={(
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className={`${MUTED} mr-auto`}>Nothing is sent until you press Invite on a contact.</span>
          <button type="button" className={GHOST} onClick={onClose}>Cancel</button>
          <button type="button" className={PRIMARY} disabled={!preview?.ok} onClick={() => onAdd(read.rows, read.no_email)} data-testid="rf-linkedin-add">
            {preview?.ok ? `Add ${read.rows.length} to your invite list` : 'Add to your invite list'}
          </button>
        </div>
      )}>
      <ol className="m-0 flex list-none flex-col gap-5 p-0">
        <li className="flex gap-3" data-testid="rf-linkedin-step-1">
          <span className={STEP} aria-hidden="true">1</span>
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className={`text-[13.5px] font-bold ${INK}`}>Download your connections from LinkedIn</span>
            <span className={MUTED}>{EXPORT_PATH}. LinkedIn emails you a link to the file, usually within minutes.</span>
            <a className={`${GHOST} self-start gap-2`} href={EXPORT_URL} target="_blank" rel="noopener noreferrer" data-testid="rf-linkedin-export">
              <BrandIcon provider="linkedin" size={16} /> Open LinkedIn’s data export
            </a>
          </div>
        </li>
        <li className="flex gap-3" data-testid="rf-linkedin-step-2">
          <span className={STEP} aria-hidden="true">2</span>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className={`text-[13.5px] font-bold ${INK}`}>Drop or choose Connections.csv</span>
            <label
              className={`flex min-h-[96px] cursor-pointer flex-col items-center justify-center gap-1 rounded-[12px] border-2 border-dashed px-4 py-5 text-center ${over ? 'border-axal-violet bg-axal-lavender dark:bg-violet-950/40' : 'border-axal-hairline dark:border-gray-700'}`}
              onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
              onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer?.files?.[0]); }} data-testid="rf-linkedin-drop">
              <span className={`text-[13px] font-semibold ${INK}`}>{file || 'Drop the file here, or choose it'}</span>
              <span className={MUTED}>It is read in your browser.</span>
              <input type="file" accept=".csv,text/csv" className="sr-only" aria-label="Connections.csv"
                onChange={(e) => { take(e.target.files?.[0]); e.target.value = ''; }} data-testid="rf-linkedin-file" />
            </label>
            {error ? <span role="alert" className="text-[12.5px] font-semibold text-red-700 dark:text-red-300" data-testid="rf-linkedin-error">{error}</span> : null}
          </div>
        </li>
        <li className="flex gap-3" data-testid="rf-linkedin-step-3">
          <span className={STEP} aria-hidden="true">3</span>
          <div className="flex min-w-0 flex-col gap-1.5" aria-live="polite">
            <span className={`text-[13.5px] font-bold ${INK}`}>Check who can be invited</span>
            {!preview ? <span className={MUTED}>The counts show once the file is read.</span>
              : !preview.ok && !preview.can ? <span role="alert" className="text-[12.5px] font-semibold text-red-700 dark:text-red-300" data-testid="rf-linkedin-preview">{preview.text}</span>
                : (
                  <div className="flex flex-col gap-1.5" data-testid="rf-linkedin-preview">
                    <span className={`text-[13px] font-semibold ${INK}`} data-testid="rf-linkedin-can">{preview.can}</span>
                    {preview.cannot ? (
                      <span className={MUTED} data-testid="rf-linkedin-cannot"><b className={`font-semibold ${INK}`}>{preview.cannot}.</b> {NO_EMAIL_LINE}</span>
                    ) : null}
                  </div>
                )}
          </div>
        </li>
      </ol>
    </Sheet>
  );
}
