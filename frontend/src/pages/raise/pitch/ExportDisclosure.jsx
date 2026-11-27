import React from 'react';
import { Link } from 'react-router-dom';
import {
  COPIES, COPY_LABEL, COPY_LINE, RECOVER_LINE, ackLabel, aspectNote, completedLines, editabilityOf, leavesOf, planOf, privateNote,
  reportLines, shortHash,
} from './exportDisclosureModel';

/**
 * D8771 (#8771) — the export dialog's disclosure parts, drawn by `ExportDialog.jsx`:
 *
 *   CopyPicker      who the file is for: Investor copy, Working copy or Custom.
 *   ExportPreview   the file before it is made, from the version's own cards:
 *                   its pages or slides and size, What leaves Axal VC row by
 *                   row, and for the editable formats what is native and what
 *                   falls back (`exportDisclosureModel`).
 *   NotesAck        the acknowledgment an export with notes asks for, quoting
 *                   the first private note it would carry.
 *   ExportCompleted the finished export: the frozen version, format, copy and
 *                   settings, the file's fingerprint, what the writer made,
 *                   Download again, and the version in Present.
 */

const MUTED = 'text-[12.5px] leading-[1.45] text-axal-muted dark:text-gray-400';
const INK = 'text-axal-ink dark:text-gray-100';
const EYE = 'text-[11px] font-bold uppercase tracking-[0.06em] text-axal-muted dark:text-gray-400';
const GHOST = 'inline-flex min-h-[36px] items-center justify-center gap-2 whitespace-nowrap rounded-[9px] border border-axal-hairline bg-white px-3.5 text-[12.5px] font-bold text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
/** The state glyphs: in the file a tick, staying in Axal VC a struck circle, a picture or fallback a triangle. */
const GLYPH = { in: '✓', out: '⊘', native: '✓', picture: '△' };
const STATE_WORDS = { in: 'In the file', out: 'Stays in Axal VC', native: 'Editable', picture: 'Picture or fallback' };

export function CopyPicker({ copy, onPick }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className={EYE} id="pitch-export-copy-label">Who it is for</span>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="radiogroup" aria-labelledby="pitch-export-copy-label">
        {COPIES.map((k) => {
          const on = k === copy;
          return (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onPick(k)}
              className={`flex flex-col gap-0.5 rounded-[10px] border px-3 py-2 text-left ${on ? 'border-axal-violet bg-axal-lavender dark:bg-violet-950/40' : 'border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900'}`}
              data-testid={`pitch-export-copy-${k}`}
            >
              <span className={`text-[13px] font-bold ${INK}`}>{COPY_LABEL[k]}</span>
            </button>
          );
        })}
      </div>
      <span role="status" className={MUTED} data-testid="pitch-export-copy-line">{COPY_LINE[copy]}</span>
    </div>
  );
}

function Rows({ rows, testId }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0" data-testid={testId}>
      {rows.map((r) => (
        <li key={r.key} className="flex gap-2 text-[12.5px] leading-[1.45]" data-testid={`${testId}-${r.key}`} data-state={r.state}>
          <span aria-hidden="true" className={r.state === 'out' ? 'text-axal-muted dark:text-gray-400' : r.state === 'picture' ? 'text-amber-700 dark:text-amber-300' : 'text-axal-positive dark:text-emerald-300'}>{GLYPH[r.state]}</span>
          <span className={INK}>
            <b>{r.label}</b> <span className="sr-only">({STATE_WORDS[r.state]})</span>· <span className="text-axal-muted dark:text-gray-400">{r.detail}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The file before it is made. `cards` null: the version is still being read. */
export function ExportPreview({ format, slides, cards, notes, sources, theme, methodId }) {
  if (!cards) return <span role="status" className={MUTED} data-testid="pitch-export-preview-reading">Reading the version to preview the file…</span>;
  const plan = planOf(format, cards, { notes, sources, theme, methodId });
  const leaves = leavesOf(format, slides, cards, { notes, sources });
  const editable = editabilityOf(format, cards, { sources });
  const aspect = aspectNote(format, theme);
  return (
    <section className="flex flex-col gap-2 rounded-[10px] border border-axal-hairline px-3 py-2.5 dark:border-gray-700" aria-labelledby="pitch-export-leaves-h" data-testid="pitch-export-preview">
      <span className={`font-mono text-[12px] ${INK}`} data-testid="pitch-export-plan">{plan.line} · {plan.size}</span>
      {aspect ? <span className={MUTED} data-testid="pitch-export-aspect">{aspect}</span> : null}
      <h3 id="pitch-export-leaves-h" className={`m-0 ${EYE}`}>What leaves Axal VC in this file</h3>
      <Rows rows={leaves} testId="pitch-export-leaves" />
      {editable ? (
        <>
          <h3 className={`m-0 ${EYE}`}>What is editable in this file</h3>
          <Rows rows={editable} testId="pitch-export-editable" />
        </>
      ) : null}
    </section>
  );
}

export function NotesAck({ cards, checked, onChange }) {
  const note = privateNote(cards);
  if (!note) return null;
  return (
    <div className="flex flex-col gap-1.5 rounded-[10px] border border-amber-300 bg-amber-50 px-3 py-2.5 dark:border-amber-700 dark:bg-amber-950/30" data-testid="pitch-export-ack">
      <span className={`text-[12.5px] font-bold ${INK}`}>Speaker notes leave Axal VC in this file</span>
      <blockquote className="m-0 border-l-2 border-amber-400 pl-2 text-[12.5px] italic text-axal-ink dark:text-gray-100" data-testid="pitch-export-ack-quote">
        Card {note.n} · {note.title}: “{note.quote}”
      </blockquote>
      <label className={`flex items-start gap-2 text-[12.5px] ${INK}`}>
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid="pitch-export-ack-check" />
        <span>{ackLabel(cards)}</span>
      </label>
    </div>
  );
}

/** `done`: {format, version, notes, sources, line, hash, report, count, unit, at, by}. */
export function ExportCompleted({ done, onDownloadAgain, presentTo }) {
  const said = completedLines(done);
  const lines = reportLines(done.report);
  const short = shortHash(done.hash);
  return (
    <div role="status" className="flex flex-col gap-1.5 rounded-[10px] bg-emerald-50 px-3 py-2.5 text-[12.5px] text-axal-positive dark:bg-emerald-950/40 dark:text-emerald-300" data-testid="pitch-export-completed">
      <span className="font-semibold" data-testid="pitch-export-done" tabIndex={-1}>{done.line}</span>
      <span className={INK} data-testid="pitch-export-done-what">{said.what}{done.count != null ? ` · ${done.count} ${done.unit}${done.count === 1 ? '' : 's'}` : ''}</span>
      <span className={INK} data-testid="pitch-export-done-settings">{said.settings}</span>
      <span className="font-mono text-[11.5px] text-axal-muted dark:text-gray-400" data-testid="pitch-export-done-hash" title={done.hash || undefined}>
        Fingerprint {short ? `${short}…` : 'Not recorded'}
      </span>
      {lines ? (
        <span className={INK} data-testid="pitch-export-done-report">The writer made: {lines.length ? lines.join(' · ') : 'no editable areas'}.</span>
      ) : null}
      <span className={MUTED} data-testid="pitch-export-done-recover">{RECOVER_LINE(done.version)}</span>
      <div className="flex flex-wrap items-center gap-2">
        {onDownloadAgain ? <button type="button" className={GHOST} onClick={onDownloadAgain} data-testid="pitch-export-download-again">Download again</button> : null}
        {presentTo ? <Link to={presentTo} className="text-[12.5px] font-bold text-axal-violet hover:underline dark:text-violet-300" data-testid="pitch-export-present-link">Open this version in Present ›</Link> : null}
      </div>
    </div>
  );
}
