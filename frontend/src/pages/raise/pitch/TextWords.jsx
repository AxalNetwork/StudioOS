import React, { useRef, useState } from 'react';
import { Bold, Italic, Link2 } from 'lucide-react';
import { groundOf, marksAt, retext, setMark, toggleMark } from './richText';

/**
 * D1515 (#3767, pd3) — a text block's words in `BlockTools.jsx`, with B · I ·
 * Accent · Link on D1500's rich-text model (`richText.js`).
 *
 *   B, I     bold and italic on the selected words (all of them when none
 *            are selected); pressed again, off. `aria-pressed` reads the
 *            selection
 *   Accent   the theme's accent colour on the selected words, when it reads
 *            against the card (4.5 : 1) and the text holds fewer than 3
 *            accent runs; otherwise the Worker's sentence and nothing changes
 *   Link     an https link on the selected words, typed in the line that
 *            opens (never a browser prompt); Remove link takes it off
 *
 * The words stay a textarea with `spellcheck`: typing keeps each run's marks
 * (`retext`) and says `{ typed: true }`, so the editor folds a burst of
 * typing into one undo step. Every mark press is one `onPatch`, so one step;
 * `paras: null` tells the editor the block is plain again.
 */

const SEG = 'inline-flex min-h-[32px] min-w-[32px] items-center justify-center gap-1 px-2.5 text-[12px] font-bold max-sm:min-h-[44px]';
const ON = 'bg-axal-lavender text-axal-violet dark:bg-violet-950/40 dark:text-violet-300';
const OFF = 'bg-white text-axal-ink dark:bg-gray-900 dark:text-gray-100';
const FIELD = 'w-full rounded-[9px] border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
const MUTED = 'text-[12.5px] leading-[1.45] text-axal-muted dark:text-gray-400';
const GHOST = 'inline-flex min-h-[32px] items-center rounded-[9px] border border-axal-hairline bg-white px-3 text-[12px] font-bold text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 max-sm:min-h-[44px]';

/** The block as a patch: its words and its runs, or `paras: null` when it is plain. */
const patchOf = (next) => ({ text: next.text, paras: Array.isArray(next.paras) ? next.paras : null });

export default function TextWords({ card, block, accent = '#6d28d9', onPatch }) {
  const box = useRef(null);
  const [sel, setSel] = useState({ start: 0, end: 0 });
  const [problem, setProblem] = useState(null);
  const [link, setLink] = useState(null); // the https link being typed, or null
  const read = () => {
    const n = box.current;
    const r = { start: n?.selectionStart ?? sel.start, end: n?.selectionEnd ?? sel.end };
    setSel(r);
    return r;
  };
  const marks = sel.end > sel.start ? marksAt(block, sel.start, sel.end) : {};
  const ground = groundOf(card);
  const done = (r) => {
    if (r.error) { setProblem(r.error); return; }
    setProblem(null);
    onPatch(patchOf(r.block));
  };
  const press = (mark) => {
    const { start, end } = read();
    if (mark === 'b' || mark === 'i') { done(toggleMark(block, start, end, mark, { ground })); return; }
    if (mark === 'accent') { done(setMark(block, start, end, 'accent', marksAt(block, start, end).accent ? undefined : accent, { ground })); return; }
    setLink(marksAt(block, start, end).href || 'https://');
  };
  const applyLink = (href) => {
    const r = setMark(block, sel.start, sel.end, 'href', href, { ground });
    done(r);
    if (!r.error) setLink(null);
  };

  return (
    <div className="flex flex-col gap-1.5" data-testid="pitch-tools-words">
      <span className="flex w-fit overflow-hidden rounded-[9px] border border-axal-hairline dark:border-gray-700" role="group" aria-label="Text marks">
        <button type="button" className={`${SEG} ${marks.b ? ON : OFF}`} aria-pressed={Boolean(marks.b)} aria-label="Bold" onMouseDown={(e) => e.preventDefault?.()} onClick={() => press('b')} data-testid="pitch-tools-mark-b"><Bold size={13} aria-hidden="true" /></button>
        <button type="button" className={`${SEG} ${marks.i ? ON : OFF}`} aria-pressed={Boolean(marks.i)} aria-label="Italic" onMouseDown={(e) => e.preventDefault?.()} onClick={() => press('i')} data-testid="pitch-tools-mark-i"><Italic size={13} aria-hidden="true" /></button>
        <button type="button" className={`${SEG} ${marks.accent ? ON : OFF}`} aria-pressed={Boolean(marks.accent)} onMouseDown={(e) => e.preventDefault?.()} onClick={() => press('accent')} data-testid="pitch-tools-mark-accent">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: accent }} aria-hidden="true" /> Accent
        </button>
        <button type="button" className={`${SEG} ${marks.href ? ON : OFF}`} aria-pressed={Boolean(marks.href)} onMouseDown={(e) => e.preventDefault?.()} onClick={() => press('href')} data-testid="pitch-tools-mark-link"><Link2 size={13} aria-hidden="true" /> Link</button>
      </span>
      {link != null ? (
        <span className="flex flex-wrap items-center gap-2" data-testid="pitch-tools-link">
          <input className={`${FIELD} max-w-[320px]`} value={link} spellCheck={false} aria-label="Link address (https)" onChange={(e) => setLink(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault?.(); applyLink(link); } }} data-testid="pitch-tools-link-field" />
          <button type="button" className={GHOST} onClick={() => applyLink(link)} data-testid="pitch-tools-link-apply">Apply link</button>
          {marksAt(block, sel.start, sel.end).href ? <button type="button" className={GHOST} onClick={() => applyLink(undefined)} data-testid="pitch-tools-link-remove">Remove link</button> : null}
          <button type="button" className={GHOST} onClick={() => setLink(null)}>Cancel</button>
        </span>
      ) : null}
      {problem ? <span className={MUTED} role="status" data-testid="pitch-tools-mark-problem">{problem}</span> : null}
      <textarea ref={box} className={`${FIELD} min-h-[64px]`} value={block.text || ''} maxLength={4000} aria-label="Words in this block" spellCheck
        onSelect={read} onKeyUp={read} onMouseUp={read}
        onChange={(e) => { setProblem(null); onPatch(patchOf(retext(block, e.target.value)), { typed: true }); }} data-testid="pitch-tools-text" />
    </div>
  );
}
