/** #6012 — The project’s waitlist target and its permission-gated editor. */
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { cycleValidateApi } from '../../lib/api/cycleValidate';

export default function WaitlistBar({ projectId, value, canWrite, reload }) {
  const { hash } = useLocation();
  const [draft, setDraft] = useState(String(value ?? ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setDraft(String(value ?? ''));
  }, [value]);

  useEffect(() => {
    if (hash === '#waitlist-bar') document.getElementById?.('waitlist-bar')?.scrollIntoView?.({ block: 'center' });
  }, [hash]);

  const save = async (target) => {
    setBusy(true);
    setError('');
    try {
      await cycleValidateApi.setWaitlistTarget(projectId, target);
      reload();
    } catch (e) {
      setError(e?.message || 'The waitlist bar could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const inputClass = 'min-h-11 rounded-lg border border-axal-hairline px-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-600';
  const target = Number(draft);

  return (
    <section id="waitlist-bar" className="grid gap-2 rounded-xl border border-axal-hairline p-4">
      <h2 className="text-sm font-bold">Waitlist bar</h2>
      <p className="text-sm">{value == null ? 'No bar set' : `${value.toLocaleString()} sign-ups`}</p>
      {canWrite && (
        <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); if (!busy && Number.isInteger(target) && target >= 1 && target <= 10000000) save(target); }}>
          <label className="grid min-w-0 gap-1 text-sm">
            Target sign-ups
            <input className={`${inputClass} w-36 max-w-full`} type="number" inputMode="numeric" min="1" max="10000000" step="1" required value={draft}
              disabled={busy} onChange={(event) => setDraft(event.target.value)} />
          </label>
          <button className={inputClass} type="submit" disabled={busy || target === value}>Save bar</button>
          {value != null && <button className={inputClass} type="button" disabled={busy} onClick={() => save(null)}>Clear bar</button>}
        </form>
      )}
      {error && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{error}</p>}
    </section>
  );
}
