import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  COPIES, COPY_LABEL, COPY_LINE, FILE_NOT_KEPT, HISTORY_UNREADABLE, RECOVER_LINE, ackLabel, aspectNote, completedLines,
  editabilityOf, foldLine, historyFoot, historyRows, leavesOf, planOf, privateNote, reportLines, shortHash,
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
 *                   who recorded it and when, Download again, and the version
 *                   in Present. Its heading takes focus when it appears.
 *   ExportHistory   part 3 (PTX07, PTX06): the venture's recorded exports, with
 *                   what each carried, or Not recorded for an older row; an
 *                   unreadable history offers Try again and never reads as empty.
 *
 * Part 3 also locks the picker and both settings while an export runs, folds
 * the preview under one line on a phone (PTX11), and announces what a copy
 * puts in the file when it changes.
 */

const MUTED = 'text-[12.5px] leading-[1.45] text-axal-muted dark:text-gray-400';
const INK = 'text-axal-ink dark:text-gray-100';
const EYE = 'text-[11px] font-bold uppercase tracking-[0.06em] text-axal-muted dark:text-gray-400';
const GHOST = 'inline-flex min-h-[36px] items-center justify-center gap-2 whitespace-nowrap rounded-[9px] border border-axal-hairline bg-white px-3.5 text-[12.5px] font-bold text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
/** The state glyphs: in the file a tick, staying in Axal VC a struck circle, a picture or fallback a triangle. */
const GLYPH = { in: '✓', out: '⊘', native: '✓', picture: '△' };
const STATE_WORDS = { in: 'In the file', out: 'Stays in Axal VC', native: 'Editable', picture: 'Picture or fallback' };

export function CopyPicker({ copy, onPick, disabled = false, said = null }) {
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
              disabled={disabled}
              onClick={() => { if (!disabled) onPick(k); }}
              className={`flex flex-col gap-0.5 rounded-[10px] border px-3 py-2 text-left ${on ? 'border-axal-violet bg-axal-lavender dark:bg-violet-950/40' : 'border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900'}`}
              data-testid={`pitch-export-copy-${k}`}
            >
              <span className={`text-[13px] font-bold ${INK}`}>{COPY_LABEL[k]}</span>
            </button>
          );
        })}
      </div>
      <span className={MUTED} data-testid="pitch-export-copy-line">{COPY_LINE[copy]}</span>
      {/* PTX11: changing the copy says, politely, what goes into the file. */}
      <span role="status" aria-live="polite" className="sr-only" data-testid="pitch-export-copy-said">{said}</span>
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
  const [open, setOpen] = useState(false);
  if (!cards) return <span role="status" className={MUTED} data-testid="pitch-export-preview-reading">Reading the version to preview the file…</span>;
  const plan = planOf(format, cards, { notes, sources, theme, methodId });
  const leaves = leavesOf(format, slides, cards, { notes, sources });
  const editable = editabilityOf(format, cards, { sources });
  const aspect = aspectNote(format, theme);
  return (
    <section className="flex flex-col gap-2 rounded-[10px] border border-axal-hairline px-3 py-2.5 dark:border-gray-700" aria-labelledby="pitch-export-leaves-h" data-testid="pitch-export-preview">
      {/* PTX11, phone: the preview folds under one line that opens it; from 640 px it is always open. */}
      <button type="button" className={`flex min-h-[48px] items-center justify-between gap-2 text-left text-[12.5px] font-bold sm:hidden ${INK}`}
        aria-expanded={open} aria-controls="pitch-export-preview-body" onClick={() => setOpen((o) => !o)} data-testid="pitch-export-fold">
        <span>{foldLine(format, cards, { notes, sources, theme, methodId })}</span>
        <span aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      <div id="pitch-export-preview-body" className={`${open ? 'flex' : 'hidden'} flex-col gap-2 sm:flex`} data-testid="pitch-export-preview-body" data-open={open}>
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
      </div>
    </section>
  );
}

export function NotesAck({ cards, checked, onChange, disabled = false }) {
  const note = privateNote(cards);
  if (!note) return null;
  return (
    <div className="flex flex-col gap-1.5 rounded-[10px] border border-amber-300 bg-amber-50 px-3 py-2.5 dark:border-amber-700 dark:bg-amber-950/30" data-testid="pitch-export-ack">
      <span className={`text-[12.5px] font-bold ${INK}`}>Speaker notes leave Axal VC in this file</span>
      <blockquote className="m-0 border-l-2 border-amber-400 pl-2 text-[12.5px] italic text-axal-ink dark:text-gray-100" data-testid="pitch-export-ack-quote">
        Card {note.n} · {note.title}: “{note.quote}”
      </blockquote>
      <label className={`flex items-start gap-2 text-[12.5px] ${INK}`}>
        <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} data-testid="pitch-export-ack-check" />
        <span>{ackLabel(cards)}</span>
      </label>
    </div>
  );
}

/**
 * `done`: {format, version, notes, sources, line, hash, report, count, unit}.
 * `recorded`: who recorded it and when, read back from the ledger by its
 * fingerprint (`recordedLine`); null until that read returns it.
 */
export function ExportCompleted({ done, recorded = null, onDownloadAgain, presentTo }) {
  const said = completedLines(done);
  const lines = reportLines(done.report);
  const short = shortHash(done.hash);
  // PTX11: when the export is done, focus moves to its heading.
  const headRef = useRef(null);
  useEffect(() => { headRef.current?.focus?.(); }, [done]);
  return (
    <div role="status" className="flex flex-col gap-1.5 rounded-[10px] bg-emerald-50 px-3 py-2.5 text-[12.5px] text-axal-positive dark:bg-emerald-950/40 dark:text-emerald-300" data-testid="pitch-export-completed">
      <h3 ref={headRef} className="m-0 text-[12.5px] font-semibold outline-none" data-testid="pitch-export-done" tabIndex={-1}>{done.line}</h3>
      <span className={INK} data-testid="pitch-export-done-what">{said.what}{done.count != null ? ` · ${done.count} ${done.unit}${done.count === 1 ? '' : 's'}` : ''}</span>
      <span className={INK} data-testid="pitch-export-done-settings">{said.settings}</span>
      <span className="font-mono text-[11.5px] text-axal-muted dark:text-gray-400" data-testid="pitch-export-done-hash" title={done.hash || undefined}>
        Fingerprint {short ? `${short}…` : 'Not recorded'}
      </span>
      {lines ? (
        <span className={INK} data-testid="pitch-export-done-report">The writer made: {lines.length ? lines.join(' · ') : 'no editable areas'}.</span>
      ) : null}
      {recorded ? <span className={INK} data-testid="pitch-export-done-recorded">{recorded}</span> : null}
      <span className={MUTED} data-testid="pitch-export-done-recover">{RECOVER_LINE(done.version)}</span>
      <div className="flex flex-wrap items-center gap-2">
        {onDownloadAgain ? <button type="button" className={GHOST} onClick={onDownloadAgain} data-testid="pitch-export-download-again">Download again</button> : null}
        {presentTo ? <Link to={presentTo} className="text-[12.5px] font-bold text-axal-violet hover:underline dark:text-violet-300" data-testid="pitch-export-present-link">Open this version in Present ›</Link> : null}
      </div>
    </div>
  );
}

const CELL = 'border-b border-axal-hairline px-2 py-1.5 text-left align-top dark:border-gray-700';
const HEADS = ['When', 'Version', 'Format', 'Copy', 'Speaker notes', 'Sources appendix', 'Fingerprint', 'By', 'File'];

/**
 * PTX07 and PTX06: the venture's recorded exports, folded under one button.
 * `ledger`: {status: 'loading'|'ok'|'error', rows}. `fileHash`: the fingerprint
 * of the file this dialog made, the only one Download again can save.
 */
export function ExportHistory({ ledger, fileHash = null, onRetry, onDownloadAgain = null }) {
  const [open, setOpen] = useState(false);
  if (ledger.status === 'error') {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2" data-testid="pitch-export-history-failed">
        <span className={MUTED}>{HISTORY_UNREADABLE}</span>
        <button type="button" className={GHOST} onClick={onRetry} data-testid="pitch-export-history-retry">Try again</button>
      </div>
    );
  }
  if (ledger.status !== 'ok') return null;
  // Confirmed empty: the dialog's last-export line already says "No export recorded yet."
  if (!ledger.rows.length) return null;
  const rows = historyRows(ledger.rows, { fileHash });
  return (
    <section className="flex flex-col gap-1.5" aria-labelledby="pitch-export-history-h" data-testid="pitch-export-history">
      <h3 id="pitch-export-history-h" className="m-0">
        <button type="button" className={`flex min-h-[36px] items-center gap-1.5 text-[12.5px] font-bold ${INK}`} aria-expanded={open}
          aria-controls="pitch-export-history-body" onClick={() => setOpen((o) => !o)} data-testid="pitch-export-history-toggle">
          <span aria-hidden="true">{open ? '▾' : '▸'}</span> Export history ({rows.length})
        </button>
      </h3>
      {open ? (
        <div id="pitch-export-history-body" className="flex flex-col gap-1.5">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[11.5px] text-axal-ink dark:text-gray-100" data-testid="pitch-export-history-table">
              <thead>
                <tr>{HEADS.map((t) => <th key={t} scope="col" className={`${CELL} font-bold text-axal-muted dark:text-gray-400`}>{t}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} data-testid={`pitch-export-history-row-${r.key}`} data-recorded={r.recorded}>
                    <td className={CELL}>{r.when}</td>
                    <td className={`${CELL} font-mono`}>{r.version}</td>
                    <td className={CELL}>{r.format}</td>
                    {[['copy', r.copy], ['notes', r.notes], ['sources', r.sources]].map(([k, v]) => (
                      <td key={k} className={`${CELL} ${r.recorded ? '' : 'italic text-axal-muted dark:text-gray-400'}`} data-testid={`pitch-export-history-${k}-${r.key}`}>
                        {r.recorded ? null : <span aria-hidden="true">○ </span>}{v}
                      </td>
                    ))}
                    <td className={`${CELL} font-mono`}>{r.hash}</td>
                    <td className={CELL}>{r.by}</td>
                    <td className={CELL} data-testid={`pitch-export-history-file-${r.key}`}>
                      {r.again && onDownloadAgain
                        ? <button type="button" className="font-bold text-axal-violet hover:underline dark:text-violet-300" onClick={onDownloadAgain} data-testid={`pitch-export-history-again-${r.key}`}>Download again</button>
                        : <span className="text-axal-muted dark:text-gray-400">{FILE_NOT_KEPT}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <span className={MUTED} data-testid="pitch-export-history-foot">{historyFoot(ledger.rows)}</span>
        </div>
      ) : null}
    </section>
  );
}
