import React, { useState } from 'react';
import Sheet from '../../../ui/Sheet.jsx';
import { pptxImport } from './deckV2Adapter';
import { deckLayoutsApi } from '../../../lib/api/deckLayouts';
import {
  TEMPLATE_DROP, TEMPLATE_PRIVACY, TEMPLATE_READING, TEMPLATE_SAVE, TEMPLATE_TITLE,
  areaRange, countsLine, fileProblem, fontLine, placedOf, unplacedOf,
} from './brandTemplateModel';

/**
 * D1572 (#3819, deck v2 D11) — pd30, "Import a .pptx template", opened from
 * the Start from row (`StudioHome.jsx`). Four steps:
 *
 *   1 · Drop      ".pptx up to 50 MB", "Your file’s text is read only to map the layouts."
 *   2 · Progress  "Reading your template…"
 *   3 · Report    the colours and fonts found (a font off the OFL list with its
 *                 stand-in), "[10] layouts found · [8] placed on whole cells ·
 *                 [2] could not be placed", each unplaced layout with its reason
 *   4 · Save as your layouts, which keeps the placed ones for the venture
 *
 * The file goes to the Worker once, through `deckV2Adapter.pptxImport`; the
 * report stores nothing. Save sends only the placed layouts, and the Worker
 * checks each one again.
 */

const BTN = 'inline-flex min-h-[36px] items-center justify-center rounded-[9px] px-3 text-[12.5px] font-bold disabled:opacity-50';
const PRIMARY = `${BTN} bg-axal-violet text-white hover:bg-violet-700 dark:bg-violet-500 dark:hover:bg-violet-400`;
const GHOST = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const EYE = 'font-mono text-[10px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const MUTED = 'text-[12.5px] leading-[1.45] text-axal-muted dark:text-gray-400';
const INK = 'text-axal-ink dark:text-gray-100';

export default function TemplateImport({ projectId, onClose, onSaved }) {
  const [step, setStep] = useState('drop'); // drop · reading · report · saved
  const [report, setReport] = useState(null);
  const [line, setLine] = useState('');
  const [busy, setBusy] = useState(false);

  const read = async (file) => {
    const problem = fileProblem(file);
    if (problem) { setLine(problem); return; }
    setLine(''); setStep('reading');
    const answer = await pptxImport(projectId, file);
    if (answer?.available === true) { setReport(answer.value); setStep('report'); return; }
    setStep('drop');
    setLine(answer?.unreadable ? (answer.reason || 'That template could not be read.') : (answer?.reason || 'Importing a template is not switched on.'));
  };

  const save = async () => {
    const layouts = placedOf(report);
    if (!layouts.length) return;
    setBusy(true); setLine('');
    try {
      const r = await deckLayoutsApi.save(projectId, report?.source_name ?? null, layouts);
      setStep('saved');
      setLine(`${r?.saved ?? layouts.length} ${layouts.length === 1 ? 'layout' : 'layouts'} saved for this venture.`);
      onSaved?.(r);
    } catch (e) { setLine(e?.data?.message || e?.message || 'Your layouts could not be saved. Nothing was saved.'); }
    finally { setBusy(false); }
  };

  const unplaced = unplacedOf(report);
  const placed = placedOf(report);
  return (
    <Sheet label={TEMPLATE_TITLE} title={TEMPLATE_TITLE} eyebrow="Start from" width={560} onClose={onClose} testId="pitch-template-import">
      <div className="flex flex-col gap-3">
        {step === 'drop' ? (
          <label className="flex cursor-pointer flex-col items-center gap-1 rounded-[12px] border border-dashed border-axal-hairline p-6 text-center dark:border-gray-700" data-testid="pitch-template-drop">
            <span className={`text-[13.5px] font-bold ${INK}`}>Drop a template here, or choose one</span>
            <span className={MUTED}>{TEMPLATE_DROP}</span>
            <span className={MUTED}>{TEMPLATE_PRIVACY}</span>
            <input type="file" accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation" className="sr-only"
              data-testid="pitch-template-file" onChange={(e) => read(e.target.files?.[0] ?? null)} />
          </label>
        ) : null}
        {step === 'reading' ? <span className={MUTED} role="status" data-testid="pitch-template-reading">{TEMPLATE_READING}</span> : null}
        {(step === 'report' || step === 'saved') && report ? (
          <div className="flex flex-col gap-3" data-testid="pitch-template-report">
            {report.source_name ? <span className={`text-[13px] font-bold ${INK}`}>{report.source_name}</span> : null}
            <span className={EYE}>Colours found</span>
            <div className="flex flex-wrap gap-2">
              {(report.colours || []).map((c) => (
                <span key={c.role} className={`inline-flex items-center gap-1 ${MUTED}`}>
                  <span className="inline-block h-3 w-3 rounded-full border border-axal-hairline dark:border-gray-700" style={{ background: c.hex }} aria-hidden="true" />{c.hex}
                </span>
              ))}
              {!(report.colours || []).length ? <span className={MUTED}>No colours in this template’s theme.</span> : null}
            </div>
            <span className={EYE}>Fonts found</span>
            <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
              {(report.fonts || []).map((f) => <li key={f.role} className={MUTED} data-testid={`pitch-template-font-${f.role}`}>{fontLine(f)}</li>)}
            </ul>
            <span className={`text-[12.5px] font-bold ${INK}`} data-testid="pitch-template-counts">{countsLine(report.counts)}</span>
            {placed.length ? (
              <ul className="m-0 flex list-none flex-col gap-0.5 p-0" aria-label="Layouts placed on whole cells">
                {placed.map((l, i) => <li key={`${l.name}-${i}`} className={MUTED}><b className={INK}>{l.name}</b> · {l.areas.map(areaRange).join(', ')}</li>)}
              </ul>
            ) : null}
            {unplaced.length ? (
              <ul className="m-0 flex list-none flex-col gap-0.5 p-0" aria-label="Layouts that could not be placed" data-testid="pitch-template-unplaced">
                {unplaced.map((l, i) => <li key={`${l.name}-${i}`} className={MUTED}><b className={INK}>{l.name}</b> · {l.why}</li>)}
              </ul>
            ) : null}
            {step === 'report' ? (
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className={PRIMARY} disabled={busy || !placed.length} onClick={save} data-testid="pitch-template-save">{busy ? 'Saving…' : TEMPLATE_SAVE}</button>
                <button type="button" className={GHOST} onClick={() => { setReport(null); setStep('drop'); setLine(''); }}>Choose another file</button>
              </div>
            ) : null}
          </div>
        ) : null}
        {line ? <span className={MUTED} role="status" data-testid="pitch-template-line">{line}</span> : null}
      </div>
    </Sheet>
  );
}
