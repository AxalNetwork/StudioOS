import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Sheet from '../../../ui/Sheet.jsx';
import { importDocument } from './deckV2Adapter';
import { reviewHref } from './OneClickBuild';
import {
  DOCUMENT_DROP, DOCUMENT_PASTE, DOCUMENT_PRIVACY, DOCUMENT_READING, DOCUMENT_SEND, DOCUMENT_TITLE, PASTE_MAX,
  documentProblem, importedLine, pasteProblem,
} from './documentImportModel';

/**
 * D1563 (#3810, deck v2 D2) — pd1's "Import a document", opened from the
 * Start from row (`StudioHome.jsx`) beside "Import a .pptx template".
 *
 *   Drop or paste   a .docx, a PDF or a .pptx deck, or the text pasted
 *   Progress        "Reading your document…"
 *   Then            the proposal it made, on New deck's `?proposal=` address:
 *                   paste, DOCX and PDF are an outline there (Build deck
 *                   quotes first, then lands on the shared OneClickBuild
 *                   review); a .pptx is its cards, straight on that review
 *                   (Accept / Accept all). No other editor surface.
 *
 * The file or text goes to the Worker once, through
 * `deckV2Adapter.importDocument`. Nothing is a version until it is accepted.
 */

const BTN = 'inline-flex min-h-[36px] items-center justify-center rounded-[9px] px-3 text-[12.5px] font-bold disabled:opacity-50';
const PRIMARY = `${BTN} bg-axal-violet text-white hover:bg-violet-700 dark:bg-violet-500 dark:hover:bg-violet-400`;
const MUTED = 'text-[12.5px] leading-[1.45] text-axal-muted dark:text-gray-400';
const INK = 'text-axal-ink dark:text-gray-100';
const EYE = 'font-mono text-[10px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';

export default function DocumentImport({ projectId, q = '', onClose }) {
  const navigate = useNavigate();
  const [reading, setReading] = useState(false);
  const [text, setText] = useState('');
  const [line, setLine] = useState('');

  const send = async (input) => {
    setLine(''); setReading(true);
    const answer = await importDocument(projectId, input);
    setReading(false);
    if (answer?.available === true && answer.value?.proposal?.id != null) {
      setLine(importedLine(answer.value) || '');
      navigate(reviewHref(q, answer.value.proposal.id));
      onClose?.();
      return;
    }
    setLine(answer?.reason || 'That document could not be imported. Nothing was changed.');
  };
  const pick = (file) => {
    const problem = documentProblem(file);
    if (problem) { setLine(problem); return; }
    send({ file });
  };
  const paste = () => {
    const problem = pasteProblem(text);
    if (problem) { setLine(problem); return; }
    send({ text });
  };

  return (
    <Sheet label={DOCUMENT_TITLE} title={DOCUMENT_TITLE} eyebrow="Start from" width={560} onClose={onClose} testId="pitch-document-import">
      <div className="flex flex-col gap-3">
        {reading ? <span className={MUTED} role="status" data-testid="pitch-document-reading">{DOCUMENT_READING}</span> : (
          <>
            <label className="flex cursor-pointer flex-col items-center gap-1 rounded-[12px] border border-dashed border-axal-hairline p-6 text-center dark:border-gray-700" data-testid="pitch-document-drop">
              <span className={`text-[13.5px] font-bold ${INK}`}>Drop a document here, or choose one</span>
              <span className={MUTED}>{DOCUMENT_DROP}</span>
              <span className={MUTED}>{DOCUMENT_PRIVACY}</span>
              <input type="file" accept=".docx,.pdf,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation"
                className="sr-only" data-testid="pitch-document-file" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={EYE}>{DOCUMENT_PASTE}</span>
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={7} maxLength={PASTE_MAX}
                className="w-full rounded-[9px] border border-axal-hairline bg-white p-2.5 text-[12.5px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                data-testid="pitch-document-paste" />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={PRIMARY} disabled={!text.trim()} onClick={paste} data-testid="pitch-document-send">{DOCUMENT_SEND}</button>
            </div>
          </>
        )}
        {line ? <span className={MUTED} role="status" data-testid="pitch-document-line">{line}</span> : null}
      </div>
    </Sheet>
  );
}
