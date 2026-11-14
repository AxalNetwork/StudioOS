import { useState } from 'react';
import { mvpSummary } from './mvpTable.js';

/**
 * D6031 (#6031, BD8): Prototype / MVP's summary line above its table,
 * "N of M must-haves complete · target <date> · N blocked", with the progress
 * bar the board draws under it. A missing target date reads "Not recorded"
 * and, for a writer, offers Set, which saves through `PATCH /project/target`
 * (`save(date)`) and then re-reads the module (`onSaved`).
 */
export default function MvpSummary({ facts, save, onSaved }) {
  const s = mvpSummary(facts);
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState('');
  const [state, setState] = useState({ busy: false, error: '' });
  if (!s) return null;
  const submit = async (e) => {
    e.preventDefault();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { setState({ busy: false, error: 'Choose a date.' }); return; }
    setState({ busy: true, error: '' });
    try {
      await save(date);
      setState({ busy: false, error: '' });
      setEditing(false);
      onSaved?.();
    } catch (err) {
      setState({ busy: false, error: err?.message || 'The date was not saved.' });
    }
  };
  const BUTTON = 'rounded-[9px] border border-axal-hairline px-2.5 py-1 text-[12px] font-semibold text-axal-violet-deep hover:bg-axal-lavender dark:border-gray-700 dark:text-violet-300 dark:hover:bg-violet-900/30';
  return (
    <section className="flex min-w-0 flex-col gap-2 rounded-xl border border-axal-hairline bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900" data-testid="mvp-summary">
      <p className="m-0 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] font-semibold text-axal-ink dark:text-gray-100">
        <span data-testid="mvp-summary-complete">{s.complete}</span>
        <span aria-hidden="true">·</span>
        <span data-testid="mvp-summary-target">{s.targetText}</span>
        {!s.target && s.canSet && !editing && (
          <button type="button" className={BUTTON} onClick={() => setEditing(true)} data-testid="mvp-summary-set">Set</button>
        )}
        <span aria-hidden="true">·</span>
        <span data-testid="mvp-summary-blocked">{s.blockedText}</span>
      </p>
      {editing && (
        <form className="flex flex-wrap items-center gap-2" onSubmit={submit} data-testid="mvp-summary-form">
          <label className="text-[12px] font-semibold text-axal-muted dark:text-gray-400" htmlFor="mvp-target-date">MVP target date</label>
          <input id="mvp-target-date" type="date" value={date} onChange={(e) => setDate(e.target.value)}
            className="rounded-[9px] border border-axal-hairline bg-white px-2.5 py-1 text-[12.5px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" />
          <button type="submit" disabled={state.busy} className="rounded-[9px] bg-axal-violet px-3 py-1 text-[12px] font-bold text-white hover:bg-axal-violet-deep disabled:opacity-60 dark:hover:bg-violet-700">
            {state.busy ? 'Saving…' : 'Save'}
          </button>
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
