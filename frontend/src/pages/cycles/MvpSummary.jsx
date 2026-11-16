import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { MVP_TARGET_ANCHOR, mvpSummary } from './mvpTable.js';

/**
 * D6031 (#6031, BD8): Prototype / MVP's summary line above its table,
 * "N of M must-haves complete · target <date> · N blocked", with the progress
 * bar the board draws under it. A missing target date reads "Not recorded".
 *
 * D6022 (#6022): for a writer, Set when no date is recorded and Change when
 * one is; the Change form also offers Clear, which sends `null`. Each saves
 * through `PATCH /project/target` (`save(date)`) and then re-reads the module
 * (`onSaved`), which carries the burn-up's Ship mark. A refusal shows the
 * Worker's own sentence. A link ending `#mvp-target-date` (the overview's
 * Days to the MVP figure, Build's focus and attention) opens the form there.
 */
export default function MvpSummary({ facts, save, onSaved, hash: hashIn }) {
  const s = mvpSummary(facts);
  const location = useLocation();
  const hash = hashIn ?? location.hash;
  const atAnchor = hash === `#${MVP_TARGET_ANCHOR}`;
  const [editing, setEditing] = useState(() => atAnchor && s?.canSet === true);
  const [date, setDate] = useState(() => s?.target ? facts.target_date.slice(0, 10) : '');
  const [state, setState] = useState({ busy: false, error: '' });
  const input = useRef(null);
  useEffect(() => { if (editing && atAnchor) input.current?.focus?.(); }, [editing, atAnchor]);
  if (!s) return null;
  const write = async (value) => {
    setState({ busy: true, error: '' });
    try {
      await save(value);
      setState({ busy: false, error: '' });
      setEditing(false);
      onSaved?.();
    } catch (err) {
      setState({ busy: false, error: err?.message || 'The date was not saved.' });
    }
  };
  const submit = (e) => {
    e.preventDefault();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { setState({ busy: false, error: 'Choose a date.' }); return; }
    write(date);
  };
  const open = () => { setDate(s.target ? facts.target_date.slice(0, 10) : ''); setState({ busy: false, error: '' }); setEditing(true); };
  const BUTTON = 'rounded-[9px] border border-axal-hairline px-2.5 py-1 text-[12px] font-semibold text-axal-violet-deep hover:bg-axal-lavender dark:border-gray-700 dark:text-violet-300 dark:hover:bg-violet-900/30';
  return (
    <section className="flex min-w-0 flex-col gap-2 rounded-xl border border-axal-hairline bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900" data-testid="mvp-summary">
      <p className="m-0 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] font-semibold text-axal-ink dark:text-gray-100">
        <span data-testid="mvp-summary-complete">{s.complete}</span>
        <span aria-hidden="true">·</span>
        <span data-testid="mvp-summary-target">{s.targetText}</span>
        {s.canSet && !editing && (s.target
          ? <button type="button" className={BUTTON} onClick={open} data-testid="mvp-summary-change" aria-label="Change the MVP target date">Change</button>
          : <button type="button" className={BUTTON} onClick={open} data-testid="mvp-summary-set" aria-label="Set the MVP target date">Set</button>)}
        <span aria-hidden="true">·</span>
        <span data-testid="mvp-summary-blocked">{s.blockedText}</span>
      </p>
      {editing && (
        <form className="flex flex-wrap items-center gap-2" onSubmit={submit} data-testid="mvp-summary-form">
          <label className="text-[12px] font-semibold text-axal-muted dark:text-gray-400" htmlFor={MVP_TARGET_ANCHOR}>MVP target date</label>
          <input id={MVP_TARGET_ANCHOR} ref={input} type="date" value={date} onChange={(e) => setDate(e.target.value)}
            className="rounded-[9px] border border-axal-hairline bg-white px-2.5 py-1 text-[12.5px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" />
          <button type="submit" disabled={state.busy} className="rounded-[9px] bg-axal-violet px-3 py-1 text-[12px] font-bold text-white hover:bg-axal-violet-deep disabled:opacity-60 dark:hover:bg-violet-700">
            {state.busy ? 'Saving…' : 'Save'}
          </button>
          {s.target && (
            <button type="button" disabled={state.busy} className={BUTTON} onClick={() => write(null)} data-testid="mvp-summary-clear">Clear date</button>
          )}
          <button type="button" className={BUTTON} onClick={() => { setEditing(false); setState({ busy: false, error: '' }); }}>Cancel</button>
          {state.error && <span role="alert" className="text-[12px] text-red-700 dark:text-red-300">{state.error}</span>}
        </form>
      )}
      <div className="h-2.5 overflow-hidden rounded-full bg-axal-ground dark:bg-gray-800" role="progressbar" aria-valuenow={s.done} aria-valuemin={0} aria-valuemax={s.total}
        aria-label={`${s.done} of ${s.total} must-haves`}>
        <i className="block h-full bg-axal-violet" style={{ width: `${s.percent}%` }} />
      </div>
    </section>
  );
}
