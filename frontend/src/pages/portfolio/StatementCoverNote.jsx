/**
 * D6888 (#6888): Eadwyn's covering-note proposal card for the statement sheet (D6217 PF-13a in the rail slot,
 * PF-13h as a collapsible card at 390).
 *
 * Nothing runs on mount: the investor presses Propose, and `POST /api/research/drafts` drafts from the statement's
 * own page 1 and page 2 figures for `asOf` and keeps nothing. The proposal offers Copy (the clipboard, for the
 * investor's own email), Edit (hands the text to the sheet's "Include as a cover note" box through `onEdit`) and
 * Discard (forgets it here; there is no record to delete). It reaches the PDF only through that box. When Eadwyn is
 * off or cannot answer, the card says "Eadwyn is unavailable. The statement does not need it." `StatementSheet.jsx`
 * mounts it in the sheet's rail for the chosen date (D6888 part 1).
 */
import React, { useLayoutEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { useRailOption } from '../../ui/railCrumbs';
import { railPressHeaders } from '../../lib/railPage.js';
import { bandPage } from '../../workspaces/ZoneDraft.jsx';
import { CHECKING } from '../../workspaces/draftCheck';
import {
  COVER_NOTE_CITE, COVER_NOTE_COPY_FAILED, COVER_NOTE_FOOT, COVER_NOTE_OFF_HINT, COVER_NOTE_OPTION, COVER_NOTE_PROPOSAL,
  COVER_NOTE_RUN, COVER_NOTE_SURFACE, COVER_NOTE_TASK, coverNoteNotice,
} from './coverNoteModel.js';

const BUTTON = 'inline-flex min-h-[44px] items-center rounded-[7px] border border-indigo-600 bg-indigo-600 px-3 text-[12px] font-bold text-white '
  + 'hover:bg-indigo-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-0 sm:py-1.5';
const GHOST = 'inline-flex min-h-[44px] items-center rounded-[7px] border border-gray-300 bg-white px-3 text-[12px] font-semibold text-gray-800 '
  + 'hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60 '
  + 'dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800 sm:min-h-0 sm:py-1.5';
const LABEL = 'text-[10px] font-extrabold uppercase tracking-[.09em] text-indigo-700 dark:text-indigo-300';
const SMALL = 'text-[11px] leading-relaxed text-gray-700 dark:text-gray-300';

export default function StatementCoverNote({ asOf, onEdit }) {
  const [body, setBody] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [copyNote, setCopyNote] = useState('');
  // A run answers only the date it was pressed for: choosing another quarter-end forgets the proposal.
  const runFor = useRef(0);
  useLayoutEffect(() => {
    runFor.current += 1;
    setBody(null); setBusy(false); setNotice(null); setCopyNote('');
  }, [asOf]);
  useRailOption(busy || body ? COVER_NOTE_OPTION : null, COVER_NOTE_RUN);

  const propose = async () => {
    const mine = ++runFor.current;
    setBusy(true); setNotice(null); setCopyNote('');
    try {
      const r = await api.research.zoneDraftRun(COVER_NOTE_SURFACE, asOf, bandPage(), railPressHeaders(COVER_NOTE_OPTION));
      if (mine !== runFor.current) return;
      const text = typeof r?.item?.body === 'string' ? r.item.body.trim() : '';
      if (text) setBody(text); else setNotice(coverNoteNotice(null));
    } catch (e) {
      if (mine !== runFor.current) return;
      setNotice(coverNoteNotice(e));
    } finally { if (mine === runFor.current) setBusy(false); }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(body);
      setCopyNote('Copied.');
    } catch {
      setCopyNote(COVER_NOTE_COPY_FAILED);
    }
  };

  return (
    <section
      data-testid="statement-cover-note"
      data-draft-surface="portfolio/statement"
      data-rail-option="draft:statement-cover-note"
      aria-label="Eadwyn · covering note proposal"
      className="flex flex-col gap-2 rounded-[10px] border border-indigo-200 bg-indigo-50/60 p-3.5 dark:border-indigo-900 dark:bg-indigo-950/25"
    >
      <span className={LABEL}>{COVER_NOTE_TASK}</span>
      {notice && notice.kind === 'off' ? (
        <div data-testid="statement-cover-note-off" className={SMALL}>
          <b className="text-gray-900 dark:text-gray-100">{notice.text}</b>
          <div>{COVER_NOTE_OFF_HINT}</div>
        </div>
      ) : body ? (
        <div data-testid="statement-cover-note-proposal" className="flex flex-col gap-2">
          <span className={LABEL}>{COVER_NOTE_PROPOSAL}</span>
          <p className="m-0 whitespace-pre-wrap text-[12.5px] leading-relaxed text-gray-900 dark:text-gray-100">{body}</p>
          <span className="text-[10.5px] text-gray-600 dark:text-gray-400">{COVER_NOTE_CITE}</span>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={GHOST} onClick={copy}>Copy</button>
            {onEdit ? <button type="button" className={GHOST} onClick={() => onEdit(body)}>Edit</button> : null}
            <button type="button" className={GHOST} onClick={() => { setBody(null); setCopyNote(''); }}>Discard</button>
          </div>
          {copyNote ? <p role="status" className={SMALL}>{copyNote}</p> : null}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={BUTTON} onClick={propose} disabled={busy || !asOf}>
            {busy ? 'Proposing…' : COVER_NOTE_RUN}
          </button>
        </div>
      )}
      {busy ? <p role="status" className={SMALL}>{CHECKING}</p> : null}
      {notice && notice.kind !== 'off' ? (
        <p data-testid="statement-cover-note-notice" className={SMALL}>
          {notice.text}
          {notice.link ? <> <a href={notice.link.href} className="font-semibold underline">{notice.link.label}</a></> : null}
        </p>
      ) : null}
      <p className="m-0 text-[10.5px] leading-relaxed text-gray-600 dark:text-gray-400">{COVER_NOTE_FOOT}</p>
    </section>
  );
}
