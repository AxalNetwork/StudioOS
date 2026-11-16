// D5997 (#5997): "Trying to learn:", the venture's validation objective, at the top of Validate's desktop lead (`ValidateLead`), with the writer's edit control and V11's after-Pivot restate prompt.
import React, { useState } from 'react';
import { cycleValidateApi } from '../../lib/api/cycleValidate';

/**
 * Board V1 draws the objective as a read-only line under the Validate title,
 * "Trying to learn: <the question>". Until the V2 header is built it leads
 * the overview's lead row. No board draws an edit field, so the control is
 * this file's (D5997): a writer gets "Write it" (Not recorded) or "Change",
 * which opens one field in place with Save, Cancel and, over a saved
 * objective, Clear. A reader sees the line and nothing to press.
 *
 * Board V11's "After Pivot: restate the objective" is drawn when the read
 * says `restate` (the Worker sets it only for a writer who reads decisions,
 * when the current decision is Pivot and the objective predates it), with
 * the canvas's own words and "Update the objective" opening the same field.
 *
 *   part       the overview read's `objective`; undefined (an older read) draws nothing
 *   canWrite   the read's `can_write`; only `true` draws a control
 *   projectId  the venture a writer saves to
 *   api        `cycleValidateApi` (a test hands in its own)
 *   onChanged  called once a save lands, so the overview is read again
 */

/** The Worker's limit (`OBJECTIVE_MAX` in `services/validateWriters.ts`), checked here first with the Worker's sentence. */
export const OBJECTIVE_MAX = 280;
export const OBJECTIVE_TOO_LONG = `Keep what you are trying to learn to ${OBJECTIVE_MAX} characters`;
export const OBJECTIVE_NOT_SAVED = 'What you are trying to learn could not be saved.';

/** The text a save sends: whitespace collapsed, empty is null (a clear), or the error sentence. */
export function objectiveValue(text) {
  const v = String(text ?? '').replace(/\s+/g, ' ').trim();
  if ([...v].length > OBJECTIVE_MAX) return { error: OBJECTIVE_TOO_LONG };
  return { value: v || null };
}

const LABEL = 'shrink-0 font-bold text-axal-ink dark:text-gray-100';
const NR = 'rounded border border-gray-300 px-1.5 text-[10.5px] font-bold text-gray-700 dark:border-gray-700 dark:text-gray-300';
const ACT = 'text-[12.5px] font-semibold text-violet-700 underline hover:text-violet-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-700 dark:text-violet-300 dark:hover:text-violet-200';

function ObjectiveForm({ projectId, current, api, onSaved, onCancel }) {
  const [text, setText] = useState(current ?? '');
  const [state, setState] = useState({ busy: false, error: null });
  const send = async (raw) => {
    const v = objectiveValue(raw);
    if (v.error) { setState({ busy: false, error: v.error }); return; }
    setState({ busy: true, error: null });
    try {
      await api.setObjective(projectId, v.value);
      onSaved?.();
    } catch (err) {
      setState({ busy: false, error: err?.message || OBJECTIVE_NOT_SAVED });
    }
  };
  const left = OBJECTIVE_MAX - [...text].length;
  return (
    <form className="mt-2 space-y-2" onSubmit={(e) => { e.preventDefault(); send(text); }} data-testid="validate-objective-form">
      <label className="block text-[12px] font-semibold text-gray-900 dark:text-gray-200">Trying to learn
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} data-testid="validate-objective-input"
          placeholder="The one question this validation answers"
          className="mt-1 block w-full resize-y rounded-md border border-gray-300 bg-white px-2 py-1.5 text-[13px] text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" />
      </label>
      <p className={`m-0 text-[11.5px] ${left < 0 ? 'font-semibold text-red-700 dark:text-red-300' : 'text-gray-600 dark:text-gray-400'}`} data-testid="validate-objective-left">
        {left < 0 ? `${-left} over the limit` : `${left} characters left`}
      </p>
      {state.error && <p role="alert" className="m-0 text-[12px] font-semibold text-red-700 dark:text-red-300" data-testid="validate-objective-error">{state.error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={state.busy} data-testid="validate-objective-save" className="rounded-md bg-violet-700 px-3 py-1.5 text-[12.5px] font-bold text-white disabled:opacity-50 dark:bg-violet-600">{state.busy ? 'Saving…' : 'Save'}</button>
        {current && <button type="button" disabled={state.busy} onClick={() => send(null)} data-testid="validate-objective-clear" className="rounded-md border border-gray-300 px-3 py-1.5 text-[12.5px] font-semibold text-gray-700 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300">Clear</button>}
        <button type="button" onClick={onCancel} className="rounded-md px-3 py-1.5 text-[12.5px] font-semibold text-gray-600 dark:text-gray-300">Cancel</button>
      </div>
    </form>
  );
}

export default function ValidateObjective({ part, canWrite = false, projectId = null, api = cycleValidateApi, onChanged }) {
  const [editing, setEditing] = useState(false);
  if (!part || typeof part !== 'object') return null;
  const ok = part.state === 'ok';
  const text = ok && typeof part.text === 'string' && part.text.trim() ? part.text : null;
  const writer = ok && canWrite === true && projectId != null;
  const restate = writer && part.restate === true && !editing;
  return (
    <section aria-label="Trying to learn" data-testid="validate-objective" data-state={ok ? (text ? 'recorded' : 'not_recorded') : 'unavailable'}
      className="rounded-xl border border-axal-hairline bg-white px-[18px] py-3 dark:border-gray-800 dark:bg-gray-900">
      <p className="m-0 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[13.5px] leading-relaxed text-axal-ink dark:text-gray-200" data-testid="validate-objective-line">
        <span className={LABEL}>Trying to learn:</span>
        {!ok ? <span className="text-gray-600 dark:text-gray-400" data-testid="validate-objective-unavailable">{part.reason || 'This could not be read.'}</span>
          : text ? <span className="min-w-0 break-words" data-testid="validate-objective-text">{text}</span>
            : <span className={NR} data-testid="validate-objective-empty">Not recorded</span>}
        {writer && !editing && (
          <button type="button" onClick={() => setEditing(true)} className={ACT} data-testid="validate-objective-open">{text ? 'Change' : 'Write it'}</button>
        )}
      </p>
      {writer && editing && (
        <ObjectiveForm projectId={projectId} current={text} api={api} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); onChanged?.(); }} />
      )}
      {restate && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-axal-hairline pt-3 dark:border-gray-800" data-testid="validate-objective-restate">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[10px] font-extrabold uppercase tracking-[.09em] text-gray-600 dark:text-gray-400">After Pivot</span>
            <b className="text-[14px] text-axal-ink dark:text-gray-100">Restate what you’re trying to learn</b>
            <p className="m-0 text-[12.5px] text-gray-600 dark:text-gray-400">Your decision changes the customer or offer. Update the objective and hypotheses before planning a build.</p>
          </div>
          <button type="button" onClick={() => setEditing(true)} data-testid="validate-objective-update"
            className="rounded-[9px] border border-axal-hairline bg-white px-3.5 py-2 text-[12.5px] font-bold text-axal-ink hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800">Update the objective</button>
        </div>
      )}
    </section>
  );
}
