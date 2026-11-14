// #5999: a cycle root's one meter and Validate's "Set a target", shared by the phone root (`PhoneCycleRoot.jsx`) and the desktop Validate lead row (`ValidateLead` in `ValidateNextAction.jsx`).
import React, { useState } from 'react';
import { cycleValidateApi } from '../../lib/api/cycleValidate';
import { targetValue } from './validatePhone';

/**
 * Lifted out of `PhoneCycleRoot.jsx` (D703, #1665; D685 §5.12's target) so
 * both widths draw one meter from one read. The meter is the root's
 * (`rootMeter` in `validatePhone.js`, over `phoneMeter`): the Worker's label
 * and display, "· <reason>" with no target, a 7px bar against one. No meter
 * draws nothing.
 *
 * "Set a target" is Validate's alone, and only for a writer: the overview
 * read's `can_write` (#5999, the owner's option B), which the Worker sets by
 * the very gate PUT /interviews-target allows a save with (`canWrite`), and a
 * venture to save to (`projectId`). A reader, a read-only partner included,
 * sees the meter without the control. Both widths save
 * through the one writer, `cycleValidateApi.setInterviewsTarget` (PUT
 * /api/cycles/validate/interviews-target), with `targetValue`'s check and the
 * Worker's refusal in its own words, so the error sentence is the same.
 *
 *   meter      the root's meter, or null
 *   cycle      the cycle; the control is drawn for 'validate' only
 *   canWrite   the read's `can_write`; only `true` draws the control
 *   projectId  the venture a writer saves to
 *   api        `cycleValidateApi` (a test hands in its own)
 *   onChanged  called once a target is saved, so the overview is read again
 *   ids        the testid prefix: `phone` on the phone root, `validate` on desktop
 *   className  the meter's frame: `mt-5` under the phone focus, a lead-row card on desktop
 *
 * The phone root's markup is unchanged by the lift: `ids="phone"` and the
 * default frame give the same bytes it drew before.
 */

const NR = 'rounded border border-gray-300 px-1.5 text-[9.5px] font-bold text-gray-700 dark:border-gray-700 dark:text-gray-300';

/** The saved target's fallback sentence when the Worker gave none. */
export const TARGET_NOT_SAVED = 'The target could not be saved.';

export function TargetForm({ projectId, current, api, onSaved, onCancel, ids = 'phone' }) {
  const [text, setText] = useState(current == null ? '' : String(current));
  const [state, setState] = useState({ busy: false, error: null });
  const save = async (e) => {
    e?.preventDefault?.();
    const v = targetValue(text);
    if (v.error) { setState({ busy: false, error: v.error }); return; }
    setState({ busy: true, error: null });
    try {
      await api.setInterviewsTarget(projectId, v.value);
      onSaved?.();
    } catch (err) {
      setState({ busy: false, error: err?.message || TARGET_NOT_SAVED });
    }
  };
  return (
    <form className="mt-3 space-y-2" onSubmit={save} data-testid={`${ids}-target-form`}>
      <label className="block text-[12px] font-semibold text-gray-900 dark:text-gray-200">Interviews a month
        <input value={text} onChange={(e) => setText(e.target.value)} inputMode="numeric" data-testid={`${ids}-target-input`} placeholder="Leave empty for no target"
          className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-[13px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" />
      </label>
      {state.error && <p role="alert" className="m-0 text-[12px] font-semibold text-red-700 dark:text-red-300" data-testid={`${ids}-target-error`}>{state.error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={state.busy} data-testid={`${ids}-target-save`} className="rounded-md bg-violet-700 px-3 py-1.5 text-[12.5px] font-bold text-white disabled:opacity-50 dark:bg-violet-600">{state.busy ? 'Saving…' : 'Save'}</button>
        <button type="button" onClick={onCancel} className="rounded-md px-3 py-1.5 text-[12.5px] font-semibold text-gray-600 dark:text-gray-300">Cancel</button>
      </div>
    </form>
  );
}

/** Decision 2's one meter: the Worker's label and display, "· <reason>" with no target, the 7px bar against one. */
export function Meter({ meter, children, ids = 'phone', className = 'mt-5' }) {
  return (
    <div className={className} data-testid={`${ids}-meter`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11.5px] font-bold text-gray-900 dark:text-gray-100">{meter.label}</span>
        <span className="text-[11.5px] font-extrabold tabular-nums text-violet-700 dark:text-violet-300" data-testid={`${ids}-meter-value`}>
          {meter.display == null
            ? <span className={NR}>{meter.unreadable ? 'Unreadable' : 'Not recorded'}</span>
            : meter.target_reason ? <>{meter.display} <span className="font-semibold text-gray-600 dark:text-gray-400">· {meter.target_reason}</span></> : meter.display}
        </span>
      </div>
      {meter.pct != null && (
        <div className="mt-2 h-[7px] overflow-hidden rounded-full bg-[#ececf1] dark:bg-gray-800" role="progressbar" aria-label={meter.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={meter.pct}>
          <div className="h-full rounded-full bg-violet-700 dark:bg-violet-400" style={{ width: `${meter.pct}%` }} />
        </div>
      )}
      {meter.detail && <p className="mt-2 text-[11.5px] text-gray-600 dark:text-gray-400" data-testid={`${ids}-meter-detail`}>{meter.detail}</p>}
      {children}
    </div>
  );
}

/** The meter, and for a Validate writer "Set a target" / "Change the target" opening the form in place. */
export default function CycleMeter({ meter, cycle = 'validate', canWrite = false, projectId = null, api = cycleValidateApi, onChanged, ids = 'phone', className = 'mt-5' }) {
  const [editing, setEditing] = useState(false);
  if (!meter) return null;
  const writer = cycle === 'validate' && canWrite === true && projectId != null;
  return (
    <Meter meter={meter} ids={ids} className={className}>
      {writer && !editing && (
        <button type="button" onClick={() => setEditing(true)} data-testid={`${ids}-target-open`}
          className="mt-2 text-[12px] font-semibold text-violet-700 underline dark:text-violet-300">{meter.target == null ? 'Set a target' : 'Change the target'}</button>
      )}
      {writer && editing && (
        <TargetForm projectId={projectId} current={meter.target} api={api} ids={ids} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); onChanged?.(); }} />
      )}
    </Meter>
  );
}
