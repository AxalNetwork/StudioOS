/**
 * The header heart (D7118 part 2, canvas `Wellness Member Home` WLM-02, WLM-02B, WLM-09F): the popover opens Today
 * directly. It reads `GET /api/wellbeing/reflections/today` in the device's zone and answers in one of four states:
 *   loading     a skeleton and "Checking today's reflection…"
 *   couldn't    "Couldn't load your check-in." with Retry: never "Take a minute", never a sign anything was skipped
 *   saved       ✓ Saved HH:MM, with Edit reflection (the full Today view)
 *   not yet     Energy, Stress and Sleep, one optional line, and Save today, which writes today's own record only
 * "Open full Wellness home →" always goes to /wellbeing. Escape closes it and focus returns to the heart.
 */
import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { Heart, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { wellbeingReflectionsApi } from '../lib/api/wellbeingReflections';
import { dayLabel, deviceTimezone, periodHref, periodState } from '../pages/wellbeing/reflectionsModel';

// The editor loads when the popover opens on a day not yet saved, so the shell's first visit stays small.
const ReflectionEditor = lazy(() => import('../pages/wellbeing/Reflections').then((m) => ({ default: m.ReflectionEditor })));

function StateChip({ state, testid }) {
  const mark = state.kind === 'saved' ? '✓' : state.kind === 'unreadable' ? '?' : '○';
  const cls = state.kind === 'saved'
    ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
    : 'border border-stone-300 text-stone-600 dark:border-gray-700 dark:text-gray-300';
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`} data-testid={testid}><span aria-hidden="true">{mark}</span> {state.word}</span>;
}

/** Today's state in one line: the Account sheet row and the popover use it. */
export function CheckInStatus({ status, day, timezone }) {
  if (status === 'loading') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
        <Loader2 size={13} className="animate-spin" /> Checking today’s reflection…
      </span>
    );
  }
  if (status !== 'ready') return <span className="text-xs text-gray-600 dark:text-gray-400">Couldn’t load your check-in</span>;
  const st = periodState('day', day, timezone);
  return (
    <span className={`text-xs ${st.kind === 'saved' ? 'font-medium text-emerald-700 dark:text-emerald-300' : 'text-gray-600 dark:text-gray-400'}`}>
      {st.kind === 'saved' ? '✓' : st.kind === 'unreadable' ? '?' : '○'} {st.word} · opens Today
    </span>
  );
}

/** Today's read, in the device's zone. */
export function useTodayCheckIn(active = true) {
  const [today, setToday] = useState({ status: 'loading', day: null, timezone: deviceTimezone(), date: null });
  const load = useCallback(async () => {
    const tz = deviceTimezone();
    setToday({ status: 'loading', day: null, timezone: tz, date: null });
    try {
      const v = await wellbeingReflectionsApi.today(tz);
      if (!v?.day) throw new Error('no day');
      setToday({ status: 'ready', day: v.day, timezone: tz, date: v.today || v.day.period_start });
    } catch { setToday({ status: 'error', day: null, timezone: tz, date: null }); }
  }, []);
  useEffect(() => { if (active) load(); }, [active, load]);
  return { ...today, reload: load };
}

/** The Account sheet's row description: it reads Today on its own. */
export function TodayStatusLine() {
  const t = useTodayCheckIn(true);
  return <CheckInStatus status={t.status} day={t.day} timezone={t.timezone} />;
}

export default function FounderWellbeingMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const button = useRef(null);
  const today = useTodayCheckIn(open);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => { if (ref.current && !ref.current.contains(event.target)) setOpen(false); };
    const onKeyDown = (event) => { if (event.key === 'Escape') { setOpen(false); button.current?.focus(); } };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const st = today.status === 'ready' ? periodState('day', today.day, today.timezone) : null;
  const dateLine = today.date ? dayLabel(today.date) : null;
  return (
    <div className="relative" ref={ref}>
      <button
        ref={button}
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label="Wellness: today’s check-in"
        aria-expanded={open}
        aria-haspopup="dialog"
        data-testid="wellness-heart"
        className={`relative rounded-lg p-2 transition-colors ${
          open
            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
            : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
        }`}
      >
        <Heart size={18} />
      </button>

      {open && (
        <div
          className="fixed left-2 right-2 top-14 z-50 overflow-hidden rounded-xl border border-stone-200 bg-stone-50 shadow-xl dark:border-gray-800 dark:bg-gray-900 sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-96"
          role="dialog"
          aria-label="Wellness · today’s reflection"
          data-testid="wellness-popover"
        >
          <div className="flex items-center gap-3 border-b border-stone-200 px-4 py-3 dark:border-gray-800">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
              <Heart size={16} />
            </div>
            <div>
              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Wellness</div>
              <div className="text-[11px] text-gray-600 dark:text-gray-400">A private space to check in</div>
            </div>
          </div>

          <div className="space-y-3 px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wide text-stone-500 dark:text-gray-400">Today{dateLine ? ` · ${dateLine}` : ''}</span>
              {st ? <StateChip state={st} testid="wellness-popover-state" /> : null}
            </div>
            {today.status === 'loading' ? (
              <div data-testid="wellness-popover-loading">
                <div className="h-8 animate-pulse rounded bg-stone-200 dark:bg-gray-800" />
                <p className="mt-2 text-xs text-gray-600 dark:text-gray-400" role="status">Checking today’s reflection…</p>
              </div>
            ) : today.status !== 'ready' ? (
              <div role="alert" data-testid="wellness-popover-error">
                <p className="text-sm text-gray-800 dark:text-gray-200"><b>Couldn’t load your check-in.</b> Your reflections are unchanged; this isn’t a sign you skipped anything.</p>
                <button type="button" onClick={today.reload} data-testid="button-wellness-retry"
                  className="mt-2 rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100">Retry</button>
              </div>
            ) : st.kind === 'saved' ? (
              <div data-testid="wellness-popover-saved">
                <p className="text-sm text-gray-700 dark:text-gray-300">You reflected today. You can change it any time today.</p>
                <Link to={periodHref('day')} onClick={() => setOpen(false)} data-testid="wellness-popover-edit"
                  className="mt-2 inline-flex rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100">Edit reflection</Link>
              </div>
            ) : st.kind === 'unreadable' ? (
              <p className="text-sm text-gray-700 dark:text-gray-300" data-testid="wellness-popover-unreadable">Today’s reflection couldn’t be read. It is unchanged.</p>
            ) : (
              <Suspense fallback={<div className="h-24 animate-pulse rounded bg-stone-200 dark:bg-gray-800" />}>
                <ReflectionEditor cadence="day" periodStart={today.day.period_start} reflection={null} timezone={today.timezone} compact onSaved={today.reload} />
              </Suspense>
            )}
          </div>

          <div className="border-t border-stone-200 px-4 py-3 dark:border-gray-800">
            <Link to="/wellbeing" onClick={() => setOpen(false)} className="text-xs font-semibold text-axal-violet" data-testid="wellness-open-home">Open full Wellness home →</Link>
          </div>
        </div>
      )}
    </div>
  );
}
