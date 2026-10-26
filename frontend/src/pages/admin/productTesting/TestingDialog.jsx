import React, { useState } from 'react';
import { Lightbox } from '../../../ui';
import { refusalText } from '../../testing/programmeModel';
import { fieldReady, toldLine } from './reviewModel';

/**
 * D1202 (#3152, TST3) — one of Product testing's dialogs A–H, from
 * `reviewModel.js` `dialogFor`. It says what the step changes, who is told and
 * what is recorded, before anything is sent; its button makes the one request
 * (`spec.call`). Never a browser pop-up.
 *
 * I is not its own dialog: a refusal is drawn inside the dialog that asked, in
 * the Worker's own words, and the dialog stays open. A full programme's Pick
 * shows the Worker's sentence before the request and its button is off.
 *
 * `onDone(message)` is called once the Worker answers yes, with the sentence
 * and, for the steps that tell people, who was told in counts only.
 */
const BTN = 'inline-flex min-h-[34px] items-center justify-center rounded-[9px] px-3.5 text-[13px] font-bold max-sm:min-h-[44px] disabled:cursor-not-allowed disabled:opacity-50';
const PRIMARY = `${BTN} bg-axal-violet text-white hover:bg-axal-violet-deep dark:bg-violet-500 dark:hover:bg-violet-400`;
const DANGER = `${BTN} border border-red-200 bg-white text-red-700 hover:bg-red-50 dark:border-red-400/50 dark:bg-gray-900 dark:text-red-300 dark:hover:bg-red-400/10`;
const GHOST = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const NEW = 'ml-1.5 inline-flex rounded-full border border-violet-200 bg-violet-50 px-1.5 text-[10px] font-bold text-axal-violet-deep dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-300';

export default function TestingDialog({ spec, api, ctx, onClose, onDone }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState(spec?.refusal || null);
  if (!spec) return null;
  const ready = fieldReady(spec, value) && !spec.refusal;

  async function confirm() {
    if (!ready || busy) return;
    setBusy(true);
    setRefusal(null);
    try {
      const out = await spec.call(api, ctx, spec.field ? value.trim() : undefined);
      const told = toldLine(out?.told);
      onDone?.([spec.done, told].filter(Boolean).join(' '));
    } catch (e) {
      // I · the Worker's sentence, inside this dialog.
      setRefusal(refusalText(e, 'Axal could not make this change. Nothing was changed. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Lightbox label={spec.title} title={spec.title} onClose={onClose} width={560} phone="sheet" testId={`testing-dialog-${spec.key}`}
      footer={(
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={GHOST} onClick={onClose} data-testid="testing-dialog-cancel">Cancel</button>
          <button type="button" className={spec.danger ? DANGER : PRIMARY} disabled={!ready || busy} onClick={confirm} data-testid="testing-dialog-confirm">
            {busy ? 'Working…' : spec.confirm}
          </button>
        </div>
      )}>
      <div className="flex flex-col gap-3">
        {spec.lead ? <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100" data-testid="testing-dialog-lead">{spec.lead}</p> : null}
        {spec.field ? (
          <label className="block">
            <span className="text-[10.5px] font-extrabold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400">{spec.field.label}</span>
            <textarea rows={3} value={value} onChange={(e) => setValue(e.target.value)} placeholder={spec.field.placeholder}
              className="mt-1 w-full rounded-lg border border-axal-hairline bg-white px-2.5 py-1.5 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
              data-testid="testing-dialog-field" />
            {spec.field.max ? <span className="mt-1 block font-mono text-[11px] text-axal-muted dark:text-gray-400">{value.trim().length} of {spec.field.min ?? 0}–{spec.field.max} characters</span> : null}
          </label>
        ) : null}
        <ul className="m-0 flex list-none flex-col gap-1 border-t border-axal-hairline p-0 pt-3 dark:border-gray-800" data-testid="testing-dialog-rows">
          {spec.rows.map((r, i) => (
            <li key={i} className="text-[13px] leading-relaxed text-axal-ink dark:text-gray-100">{r.t}{r.nw ? <span className={NEW}>New</span> : null}</li>
          ))}
        </ul>
        {refusal ? (
          <p role="alert" className="m-0 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] font-bold text-red-700 dark:border-red-400/40 dark:bg-red-400/10 dark:text-red-300" data-testid="testing-dialog-refusal">{refusal}</p>
        ) : null}
      </div>
    </Lightbox>
  );
}
