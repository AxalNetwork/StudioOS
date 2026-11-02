import React, { useCallback, useEffect, useRef, useState } from 'react';
import AskIntent from '../../ui/AskIntent.jsx';
import { AskButtonView } from '../../ui/AskButton.jsx';
import Lightbox from '../../ui/Lightbox.jsx';
import { FillGlyph } from '../../ui/FillMark.jsx';
import { fillsApi } from '../../lib/api/fills.js';
import { railProposalsApi } from '../../lib/api/railProposals.js';
import { refusalView } from '../../lib/fillSheet.js';
import { reportError } from '../../lib/log.js';
import { acceptReport, rowLines, waitingRows } from '../../lib/fillForms.js';

/**
 * D1328 (#3489, part 5 of #2431) — a module's Ask (AF1) and the row proposals
 * waiting for it (AF16). D1443 part 4 (#3992): the rows are the Ask panel's
 * row cards, drawn in the panel above the conversation (`AskIntent`), no
 * longer a D1317 `Sheet`.
 *
 *   The trigger   the shared "Ask" (`AskButtonView`), with "N waiting": the member's own row
 *                 proposals for this module's Add form and this venture
 *                 (`GET /api/ai/rail/proposals`, `option=form:<form>`). A
 *                 failed read draws no count, never "0 waiting".
 *   The panel     each proposal with Accept, Edit and Discard; "Accept all
 *                 (N)" and "Discard all". Accept is `POST /api/fills/rows/accept`
 *                 (each row through the form's own writer, at most 50, each
 *                 outcome reported). Edit opens the Add form with the row's
 *                 values, which Save writes (`onEdit`). Discard is the
 *                 proposal's own decision, one at a time, and Discard all asks
 *                 first. "Ask Eadwyn for rows" runs the form's handler for up
 *                 to five rows (D1326), only while AI is on.
 *
 * Nothing is written without the member's press, and no model name or option
 * key is drawn.
 */
const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-axal-muted dark:text-gray-400';
const BTN = 'inline-flex min-h-[36px] items-center justify-center rounded-[9px] bg-axal-violet px-3.5 text-[12.5px] font-bold text-white hover:bg-axal-violet-deep dark:hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50 max-sm:min-h-[44px]';
const GHOST = 'inline-flex min-h-[36px] items-center justify-center rounded-[9px] border border-axal-hairline bg-white px-3 text-[12.5px] font-semibold text-axal-ink hover:bg-axal-ground disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800 max-sm:min-h-[44px]';
const NOTE = 'm-0 rounded-[10px] border px-3 py-2.5 text-[12.5px]';
const INFO = 'border-axal-hairline bg-axal-ground text-axal-ink dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100';
const BAD = 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300';
const ASK_ROWS = 5;
/** The live reads and writes; a test hands its own. One object, so a render never makes a new read. */
const SOURCE = Object.freeze({ proposals: railProposalsApi, fills: fillsApi });

/** The module trigger and its panel. `target` is `moduleFillTarget`'s `{ page, form, label }`. */
export function FillModule({ target, projectId, moduleName, aiOff = false, refresh = 0, onChanged, onEdit, source = SOURCE }) {
  const [read, setRead] = useState({ status: 'loading', rows: [] });
  const [open, setOpen] = useState(false);
  const opener = useRef(null);
  const load = useCallback(async () => {
    setRead((r) => ({ ...r, status: 'loading' }));
    try {
      const reply = await source.proposals.list({ option: `form:${target.form}`, status: 'proposed' });
      setRead({ status: 'ready', rows: waitingRows(reply, projectId) });
    } catch (e) {
      reportError('fill-rows:read', e);
      setRead({ status: 'unreadable', rows: [] });
    }
  }, [source, target.form, projectId]);
  // Read on mount, and again when the page re-reads (`refresh`): an Edit saved elsewhere decides a row.
  useEffect(() => { load(); }, [load, refresh]);
  return (
    <>
      <span ref={opener} className="inline-flex">
        <AskButtonView onClick={() => setOpen(true)} expanded={open} waiting={read.status === 'ready' ? read.rows.length : null}
          state={aiOff ? 'off' : read.status === 'unreadable' ? 'unreadable' : 'rest'} testId="fill-module-trigger" />
      </span>
      {open ? (
        <FillRowsPanel target={target} projectId={projectId} moduleName={moduleName} read={read} reload={load} aiOff={aiOff} source={source}
          onChanged={onChanged} onEdit={(p) => { setOpen(false); onEdit?.(p); }} onClose={() => { setOpen(false); opener.current?.querySelector?.('button')?.focus?.(); }} />
      ) : null}
    </>
  );
}

/** AF16: the waiting rows, each decided by the member. */
export function FillRowsPanel({ target, projectId, moduleName, read, reload, aiOff = false, onChanged, onEdit, onClose, source = SOURCE }) {
  const [busy, setBusy] = useState(null);
  const [report, setReport] = useState(null);
  const [asking, setAsking] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [askNote, setAskNote] = useState(null);
  const rows = read.status === 'ready' ? read.rows : [];
  const where = moduleName || 'this module';

  const accept = async (uids) => {
    if (busy || !uids.length) return;
    setBusy('accept'); setReport(null);
    try {
      const reply = await source.fills.acceptRows({ page: target.page, form: target.form, project: projectId, proposals: uids.slice(0, 50) });
      const done = acceptReport(reply, uids.length);
      setReport({ tone: 'info', ...done });
      if (done.created) onChanged?.();
    } catch (e) {
      reportError('fill-rows:accept', e);
      setReport({ tone: 'bad', line: (typeof e?.message === 'string' && e.message) || 'Nothing was added. Try again.', refused: [] });
    } finally { setBusy(null); await reload(); }
  };
  const discard = async (uids) => {
    if (busy || !uids.length) return;
    setBusy('discard'); setReport(null);
    let failed = 0;
    // One decision per proposal (D777 part 3): there is no bulk decision.
    for (const uid of uids) {
      try { await source.proposals.decide(uid, 'discard'); } catch (e) { failed += 1; reportError('fill-rows:discard', e); }
    }
    setReport(failed ? { tone: 'bad', line: `${failed} could not be discarded. Try again.`, refused: [] } : { tone: 'info', line: uids.length === 1 ? 'Discarded.' : `Discarded ${uids.length}.`, refused: [] });
    setBusy(null); setConfirmDiscard(false);
    await reload();
  };
  const ask = async () => {
    if (asking || aiOff) return;
    setAsking(true); setAskNote(null);
    try {
      const events = await source.fills.run({ page: target.page, option: `form:${target.form}`, project: projectId, input: { rows: ASK_ROWS } });
      const end = events.find((e) => e.event === 'done')?.data || null;
      if (!end) setAskNote(refusalView(null).text);
      else if (end.refusal) setAskNote(refusalView(end.refusal, { charged: end.charged_microusd }).text);
      else if (!(end.proposals || []).length) setAskNote('Eadwyn found nothing new to propose. Nothing was guessed.');
    } catch (e) {
      reportError('fill-rows:ask', e);
      setAskNote(refusalView({ code: e?.code, message: e?.message }).text);
    } finally { setAsking(false); await reload(); }
  };

  const refusedBy = new Map((report?.refused || []).map((r) => [r.uid, r.text]));
  const footer = (
    <div className="flex flex-col gap-2 max-sm:sticky max-sm:bottom-0">
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={GHOST} disabled={!!busy || !rows.length} onClick={() => setConfirmDiscard(true)} data-testid="fill-rows-discard-all">Discard all</button>
        <button type="button" className={BTN} disabled={!!busy || !rows.length} onClick={() => accept(rows.map((r) => r.uid))} data-testid="fill-rows-accept-all">{`Accept all (${Math.min(rows.length, 50)})`}</button>
      </div>
      <span className={`text-[11.5px] ${MUTED}`}>{`Each item is added to ${where} as you accept it.`}</span>
    </div>
  );

  return (
    <>
      <AskIntent label={`Proposals for ${where}`} eyebrow="Ask Eadwyn" title={rows.length ? `${rows.length} ${rows.length === 1 ? 'proposal' : 'proposals'} for ${where}` : `Proposals for ${where}`}
        onClose={onClose} footer={footer} testId="fill-rows-panel">
        <div className="flex flex-col gap-3">
          {report ? (
            <div role="status" className={`${NOTE} ${report.tone === 'bad' ? BAD : INFO}`} data-testid="fill-rows-report">{report.line}</div>
          ) : null}
          {read.status === 'loading' ? <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="fill-rows-loading">Reading what is waiting…</p> : null}
          {read.status === 'unreadable' ? (
            <div role="alert" className={`${NOTE} ${BAD} flex flex-col gap-2`} data-testid="fill-rows-unreadable">
              <span>Unreadable: the proposals waiting for {where} could not be read. This is not a claim that none is waiting.</span>
              <button type="button" className={`${GHOST} self-start`} onClick={reload} data-testid="fill-rows-retry">Try again</button>
            </div>
          ) : null}
          {read.status === 'ready' && !rows.length ? (
            <p className={`${NOTE} ${INFO}`} data-testid="fill-rows-none">{`Nothing is waiting for ${where}.`}</p>
          ) : null}
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {rows.map((p) => {
              const { title, rest } = rowLines(p.row, target.page, target.form);
              return (
                <li key={p.uid} className="flex flex-col gap-1.5 rounded-[10px] border border-axal-hairline px-3 py-2.5 dark:border-gray-700" data-testid={`fill-rows-item-${p.uid}`}>
                  <span className={`text-[13px] ${INK}`}>{`${target.label} `}<span className="rounded bg-axal-lavender px-1 font-semibold dark:bg-violet-950/40">{title}</span>?</span>
                  {rest.map((line) => <span key={line} className={`text-[12px] ${MUTED}`}>{line}</span>)}
                  <span className={`inline-flex items-center gap-1 text-[11.5px] ${MUTED}`}><span className="text-axal-violet dark:text-violet-300"><FillGlyph size={12} /></span>Eadwyn · proposed</span>
                  {refusedBy.has(p.uid) ? <span role="alert" className="text-[12px] text-red-700 dark:text-red-300" data-testid={`fill-rows-why-${p.uid}`}>{refusedBy.get(p.uid)}</span> : null}
                  <span className="flex flex-wrap gap-2">
                    <button type="button" className={GHOST} disabled={!!busy} onClick={() => accept([p.uid])} aria-label={`Accept ${title}`} data-testid={`fill-rows-accept-${p.uid}`}>Accept</button>
                    <button type="button" className={GHOST} disabled={!!busy} onClick={() => onEdit?.(p)} aria-label={`Edit ${title}`} data-testid={`fill-rows-edit-${p.uid}`}>Edit</button>
                    <button type="button" className={GHOST} disabled={!!busy} onClick={() => discard([p.uid])} aria-label={`Discard ${title}`} data-testid={`fill-rows-discard-${p.uid}`}>Discard</button>
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-col gap-1 border-t border-axal-hairline pt-3 dark:border-gray-800">
            <button type="button" className={`${GHOST} self-start`} disabled={aiOff || asking || !!busy} onClick={ask} data-testid="fill-rows-ask">
              {asking ? 'Eadwyn is checking your records…' : `Ask Eadwyn for up to ${ASK_ROWS}`}
            </button>
            <span className={`text-[11.5px] ${MUTED}`}>{aiOff ? 'AI assistance is off on this page.' : 'Uses AI tokens. Nothing is added until you accept it.'}</span>
            {askNote ? <span role="status" className={`text-[12px] ${INK}`} data-testid="fill-rows-ask-note">{askNote}</span> : null}
          </div>
        </div>
      </AskIntent>
      {confirmDiscard ? (
        <Lightbox size="fit" width={420} label="Discard all proposals" title={`Discard ${rows.length} ${rows.length === 1 ? 'proposal' : 'proposals'}?`} onClose={() => setConfirmDiscard(false)} testId="fill-rows-confirm"
          footer={<div className="flex justify-end gap-2 p-4">
            <button type="button" className={GHOST} onClick={() => setConfirmDiscard(false)}>Cancel</button>
            <button type="button" className={GHOST} disabled={!!busy} onClick={() => discard(rows.map((r) => r.uid))} data-testid="fill-rows-confirm-discard">Discard all</button>
          </div>}>
          <p className={`m-0 p-4 text-[13px] ${INK}`}>{`Eadwyn’s proposals for ${where} go. Nothing in ${where} changes.`}</p>
        </Lightbox>
      ) : null}
    </>
  );
}

