/**
 * D7118 part 2 (#7118, canvas `Wellness Member Home`, boards WLM-01B, WLM-03, WLM-08 to WLM-10): Today, This week
 * and This month, each its own record (`wellbeingReflectionsApi`), on the member home and as its own view at
 * `/wellbeing?period=today|week|month`.
 *
 *   PeriodCards     the three periods on the home, each with its date and its own state (○ Not yet, ✓ Saved,
 *                   Couldn't be read); a failed read of all three says so with Retry, never "Not yet".
 *   ReflectionView  one period: the editor (every question optional, the draft kept on a failed save, a changed
 *                   copy refused and reloadable), its private history with Edit reflection and Delete, the month's
 *                   own summary of what was recorded, earlier check-ins, Export and the retention line.
 *   FourWeeks       D7118 part 3 (WLM-03W): "Your last four weeks, in words" on This week, the member's own numbers
 *                   for the four weeks ending this one; a blank week or question reads "no entry", never 0.
 *
 * Nothing here is scored, counted against the member or sent to a model. Days without an entry are left out.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { wellbeingReflectionsApi } from '../../lib/api/wellbeingReflections';
import { BTN, FIELD, ScoreDots } from './WellbeingParts';
import {
  FOUR_WEEKS_FOOT, LEFT_OUT, MONTH_PROMPTS, PRIVATE_LINE, QUESTIONS, RETENTION_LINE, SAVES_ONLY, TAB_WORDS, TEXT_MAX,
  WEEK_TOPICS, deviceTimezone, draftEmpty, draftFrom, fourWeekTable, historyLabel, historyLine, historyNote, isChanged, monthName,
  newRequestId, periodHref, periodLabel, periodState, saveBody, saveRefusal, summaryLines, toggleTopic,
} from './reflectionsModel';

const CARD = 'rounded-axal border border-stone-200 bg-stone-50 p-4 dark:border-gray-800 dark:bg-gray-900';
const SAGE_CHIP = 'inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300';
const QUIET_CHIP = 'inline-flex items-center gap-1 rounded-full border border-stone-300 px-2 py-0.5 text-[11px] font-semibold text-stone-600 dark:border-gray-700 dark:text-gray-300';
const ALERT = 'rounded-axal-sm border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200';

/** One read of `GET /today` in the device's zone. */
export function useTodayReflections() {
  const [read, setRead] = useState({ state: 'loading' });
  const tz = useMemo(() => deviceTimezone(), []);
  const load = useCallback(async () => {
    setRead({ state: 'loading' });
    try {
      const v = await wellbeingReflectionsApi.today(tz);
      setRead(v && v.day && v.week && v.month ? { state: 'ok', value: v } : { state: 'unreadable' });
    } catch { setRead({ state: 'unreadable' }); }
  }, [tz]);
  useEffect(() => { load(); }, [load]);
  return { read, reload: load, timezone: tz };
}

export function StateChip({ state, testid }) {
  if (state.kind === 'saved') return <span className={SAGE_CHIP} data-testid={testid}><span aria-hidden="true">✓</span> {state.word}</span>;
  if (state.kind === 'unreadable') return <span className={QUIET_CHIP} data-testid={testid}><span aria-hidden="true">?</span> {state.word}</span>;
  return <span className={QUIET_CHIP} data-testid={testid}><span aria-hidden="true">○</span> {state.word}</span>;
}

export function PrivateLine() {
  return (
    <p className="mt-3 flex items-start gap-2 text-xs text-stone-600 dark:text-gray-400" data-testid="reflection-private">
      <Lock size={13} className="mt-0.5 flex-none" aria-hidden="true" /> <span>{PRIVATE_LINE}</span>
    </p>
  );
}

const ACTION = {
  day: (saved) => (saved ? 'Edit reflection' : 'Begin today’s reflection'),
  week: (saved) => (saved ? 'Edit reflection' : 'Write this week’s reflection'),
  month: (saved) => (saved ? 'Edit reflection' : 'Write monthly reflection'),
};
export const HEADS = { day: 'How is today?', week: 'Looking at this week', month: 'Looking back' };

/** WLM-01 / WLM-01B: the three periods on the home, each in its own state. */
export function PeriodCards({ read, timezone, onRetry }) {
  if (read.state === 'loading') {
    return (
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3" data-testid="reflection-periods-loading" aria-busy="true">
        {[0, 1, 2].map((i) => <div key={i} className={`${CARD} h-36 animate-pulse`} />)}
      </div>
    );
  }
  if (read.state !== 'ok') {
    return (
      <div className={`${CARD} text-sm text-stone-700 dark:text-gray-300`} role="alert" data-testid="reflection-periods-unreadable">
        <b>Couldn’t load your reflections.</b> They are unchanged; this isn’t a sign you skipped anything.
        <div className="mt-2"><button type="button" className={BTN.ghost} onClick={onRetry} data-testid="button-retry-reflections">Retry</button></div>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3" data-testid="reflection-periods">
      {['day', 'week', 'month'].map((cadence) => {
        const slot = read.value[cadence];
        const st = periodState(cadence, slot, timezone);
        const saved = st.kind === 'saved';
        return (
          <section key={cadence} className={`${CARD} flex flex-col gap-2 ${cadence === 'day' ? 'ring-1 ring-emerald-200 dark:ring-emerald-900' : ''}`}
            aria-labelledby={`period-${cadence}`} data-testid={`reflection-period-${cadence}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wide text-stone-500 dark:text-gray-400">{TAB_WORDS[cadence]}</span>
                <h2 id={`period-${cadence}`} className="text-[15px] font-bold text-stone-900 dark:text-gray-100">{HEADS[cadence]}</h2>
                <span className="text-xs text-stone-600 dark:text-gray-400" data-testid={`reflection-period-date-${cadence}`}>{periodLabel(cadence, slot.period_start, slot.period_end)}</span>
              </div>
              <StateChip state={st} testid={`reflection-period-state-${cadence}`} />
            </div>
            <div className="mt-auto flex flex-wrap gap-2">
              <Link to={periodHref(cadence)} className={saved ? BTN.ghost : BTN.primary} data-testid={`reflection-period-open-${cadence}`}>{ACTION[cadence](saved)}</Link>
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** The editor for one period. The draft stays on screen whatever the save answers. */
export function ReflectionEditor({ cadence, periodStart, reflection, timezone, onSaved, compact = false }) {
  const [draft, setDraft] = useState(() => draftFrom(cadence, reflection));
  const [save, setSave] = useState({ saving: false, error: null, changed: false, ok: null });
  const attempt = useRef(null);
  const base = useRef(reflection);
  useEffect(() => { base.current = reflection; setDraft(draftFrom(cadence, reflection)); setSave({ saving: false, error: null, changed: false, ok: null }); attempt.current = null; }, [cadence, reflection]);
  const touch = (next) => { setDraft(next); attempt.current = null; setSave((s) => ({ ...s, ok: null })); };
  const empty = draftEmpty(cadence, draft);

  const submit = async (e) => {
    e?.preventDefault?.();
    if (empty || save.saving) return;
    // One request id per attempt: a retry of a save whose answer was lost lands once.
    if (!attempt.current) attempt.current = newRequestId();
    setSave({ saving: true, error: null, changed: false, ok: null });
    try {
      const out = await wellbeingReflectionsApi.save(cadence, periodStart, saveBody(cadence, draft, base.current, timezone, attempt.current));
      attempt.current = null;
      setSave({ saving: false, error: null, changed: false, ok: 'Saved. Only you can read it.' });
      onSaved?.(out);
    } catch (err) {
      setSave({ saving: false, error: saveRefusal(err), changed: isChanged(err), ok: null });
    }
  };

  const qs = QUESTIONS[cadence];
  return (
    <form onSubmit={submit} className="space-y-3" aria-label={`${TAB_WORDS[cadence]} reflection`} data-testid={`reflection-editor-${cadence}`}>
      {qs.map((x) => (
        <ScoreDots key={x.key} name={`${cadence}-${x.key}`} label={x.label} low={x.low} high={x.high} value={draft.scores[x.key] ?? null}
          onChange={(v) => { const scores = { ...draft.scores }; if (v == null) delete scores[x.key]; else scores[x.key] = v; touch({ ...draft, scores }); }} />
      ))}
      {cadence === 'month' ? MONTH_PROMPTS.map((p) => (
        <label key={p.key} className="block">
          <span className={FIELD.label}>{p.label} (optional)</span>
          <textarea rows={3} maxLength={TEXT_MAX} className={FIELD.input} placeholder={p.hint} value={draft.month[p.key]}
            onChange={(e) => touch({ ...draft, month: { ...draft.month, [p.key]: e.target.value } })} data-testid={`reflection-month-${p.key}`} />
        </label>
      )) : (
        <label className="block">
          <span className={FIELD.label}>{cadence === 'day' ? 'One line for today (optional)' : 'Private note (optional)'}</span>
          <textarea rows={compact ? 2 : 3} maxLength={TEXT_MAX} className={FIELD.input} placeholder="Anything you want to remember…" value={draft.text}
            onChange={(e) => touch({ ...draft, text: e.target.value })} data-testid={`reflection-text-${cadence}`} />
        </label>
      )}
      {cadence === 'week' ? (
        <fieldset>
          <legend className={FIELD.label}>Topics (optional, up to 8)</legend>
          <div className="flex flex-wrap gap-1.5">
            {[...new Set([...WEEK_TOPICS, ...draft.topics])].map((t) => (
              <button key={t} type="button" aria-pressed={draft.topics.includes(t)} onClick={() => touch({ ...draft, topics: toggleTopic(draft.topics, t) })}
                className={`min-h-[36px] rounded-full border px-3 text-xs font-semibold ${draft.topics.includes(t)
                  ? 'border-emerald-600 bg-emerald-50 text-emerald-900 dark:border-emerald-500 dark:bg-emerald-950/40 dark:text-emerald-200'
                  : 'border-stone-300 bg-white text-stone-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300'}`}
                data-testid={`reflection-topic-${t}`}>{t}</button>
            ))}
          </div>
          <p className={`${FIELD.note} mt-1`}>Topics stay in your journal. They are used for suggestions only if you allow it in Choose interests.</p>
        </fieldset>
      ) : null}
      {save.error ? (
        <div className={ALERT} role="alert" data-testid="reflection-save-error">
          {save.error}
          {save.changed ? <> <button type="button" className="font-semibold underline" onClick={() => onSaved?.(null)} data-testid="button-reflection-reload">Reload the newer version</button></> : null}
        </div>
      ) : null}
      {save.ok ? <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-300" role="status" data-testid="reflection-save-ok">{save.ok}</p> : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {!compact ? <span className={FIELD.note}>{cadence === 'month' ? SAVES_ONLY.month(monthName(periodStart)) : SAVES_ONLY[cadence]}</span> : <span />}
        <button type="submit" className={BTN.primary} disabled={empty || save.saving} data-testid={`button-reflection-save-${cadence}`}>
          {save.saving ? 'Saving…' : save.error ? 'Try again' : cadence === 'day' ? 'Save today' : cadence === 'week' ? (reflection ? 'Save changes' : 'Save this week') : `Save ${monthName(periodStart) || 'this month'}`}
        </button>
      </div>
    </form>
  );
}

/** A period's private history, newest first, with Edit reflection and Delete. A failed read says so. */
function ReflectionHistory({ cadence, timezone, version, onEdit, onDeleted }) {
  const [read, setRead] = useState({ state: 'loading' });
  const [confirm, setConfirm] = useState(null);
  const [del, setDel] = useState({ busy: false, error: null });
  const load = useCallback(async () => {
    setRead({ state: 'loading' });
    try {
      const v = await wellbeingReflectionsApi.history(cadence, 12);
      setRead(Array.isArray(v?.reflections) ? { state: 'ok', value: v.reflections } : { state: 'unreadable' });
    } catch { setRead({ state: 'unreadable' }); }
  }, [cadence]);
  useEffect(() => { load(); }, [load, version]);
  const remove = async (r) => {
    setDel({ busy: true, error: null });
    try { await wellbeingReflectionsApi.remove(r.uid); setConfirm(null); setDel({ busy: false, error: null }); await load(); onDeleted?.(r); }
    catch { setDel({ busy: false, error: 'This reflection wasn’t deleted. Try again.' }); }
  };
  const title = cadence === 'day' ? 'Recent days' : cadence === 'week' ? 'Recent weeks' : 'Earlier months';
  return (
    <section className={CARD} aria-labelledby={`hist-${cadence}`} data-testid={`reflection-history-${cadence}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 id={`hist-${cadence}`} className="text-[15px] font-bold text-stone-900 dark:text-gray-100">{title}</h2>
        <span className="text-xs text-stone-500 dark:text-gray-400">private to you</span>
      </div>
      {read.state === 'loading' ? <div className="h-20 animate-pulse rounded bg-stone-200 dark:bg-gray-800" /> : read.state !== 'ok' ? (
        <div className="text-sm text-stone-700 dark:text-gray-300" role="alert" data-testid={`reflection-history-unreadable-${cadence}`}>
          Your past reflections couldn’t be read. They are unchanged. <button type="button" className={BTN.ghost} onClick={load}>Retry</button>
        </div>
      ) : !read.value.length ? (
        <p className="text-sm text-stone-600 dark:text-gray-400" data-testid={`reflection-history-none-${cadence}`}>Nothing saved yet.</p>
      ) : (
        <ul className="divide-y divide-stone-200 dark:divide-gray-800">
          {read.value.map((r) => (
            <li key={r.uid} className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid={`reflection-history-row-${r.period_start}`}>
              <div className="min-w-0 text-sm">
                <b className="text-stone-900 dark:text-gray-100">{historyLabel(cadence, r.period_start)}</b>{' '}
                <span className="text-stone-700 dark:text-gray-300">{historyLine(cadence, r, timezone)}</span>
                {historyNote(cadence, r) ? <span className="text-stone-500 dark:text-gray-400"> · {historyNote(cadence, r)}</span> : null}
              </div>
              {confirm === r.uid ? (
                <span className="flex flex-wrap items-center gap-2 text-xs text-stone-700 dark:text-gray-300">
                  Delete it for good?
                  <button type="button" className={BTN.danger} disabled={del.busy} onClick={() => remove(r)} data-testid={`button-reflection-delete-confirm-${r.period_start}`}>Delete</button>
                  <button type="button" className={BTN.ghost} onClick={() => setConfirm(null)}>Keep it</button>
                </span>
              ) : (
                <span className="flex gap-1.5">
                  {r.readable === false ? null : <button type="button" className={BTN.ghost} onClick={() => onEdit(r)} data-testid={`button-reflection-edit-${r.period_start}`}>Edit reflection</button>}
                  <button type="button" className={BTN.ghost} onClick={() => setConfirm(r.uid)} data-testid={`button-reflection-delete-${r.period_start}`}>Delete</button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {del.error ? <p className={`${ALERT} mt-2`} role="alert">{del.error}</p> : null}
      <p className={`${FIELD.note} mt-2`}>{LEFT_OUT[cadence]}</p>
    </section>
  );
}

/** WLM-03W: the four weeks ending this one, in the member's own numbers. `table` is `fourWeekTable`'s. */
export function FourWeeksTable({ table }) {
  if (!table) return <p className="text-sm text-stone-600 dark:text-gray-400" data-testid="four-weeks-none">Nothing answered in the last four weeks.</p>;
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm" data-testid="four-weeks-table">
          <thead>
            <tr className="text-xs text-stone-500 dark:text-gray-400">
              <th scope="col" className="py-1 pr-3 font-semibold">Question</th>
              {table.columns.map((c) => <th key={c.start} scope="col" className="py-1 pr-3 font-semibold">{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r) => (
              <tr key={r.key} className="border-t border-stone-200 dark:border-gray-800" data-testid={`four-weeks-row-${r.key}`}>
                <th scope="row" className="py-1.5 pr-3 font-semibold text-stone-900 dark:text-gray-100">{r.label}</th>
                {r.cells.map((c, i) => (
                  <td key={table.columns[i].start} className={`py-1.5 pr-3 ${c.empty ? 'text-xs text-stone-500 dark:text-gray-400' : 'font-mono text-stone-900 dark:text-gray-100'}`}>{c.text}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={`${FIELD.note} mt-2`}>{FOUR_WEEKS_FOOT}</p>
    </>
  );
}

/** WLM-03W: one more read, the saved weeks, laid on the four week starts ending this one. A failed read says so. */
function FourWeeks({ currentStart, version }) {
  const [read, setRead] = useState({ state: 'loading' });
  const load = useCallback(async () => {
    setRead({ state: 'loading' });
    try {
      const v = await wellbeingReflectionsApi.history('week', 8);
      setRead(Array.isArray(v?.reflections) ? { state: 'ok', value: v.reflections } : { state: 'unreadable' });
    } catch { setRead({ state: 'unreadable' }); }
  }, []);
  useEffect(() => { load(); }, [load, version]);
  return (
    <section className={CARD} aria-labelledby="four-weeks" data-testid="four-weeks">
      <h2 id="four-weeks" className="mb-2 text-[15px] font-bold text-stone-900 dark:text-gray-100">Your last four weeks, in words</h2>
      {read.state === 'loading' ? <div className="h-16 animate-pulse rounded bg-stone-200 dark:bg-gray-800" /> : read.state !== 'ok' ? (
        <div className="text-sm text-stone-700 dark:text-gray-300" role="alert" data-testid="four-weeks-unreadable">
          Your last four weeks couldn’t be read. They are unchanged. <button type="button" className={BTN.ghost} onClick={load}>Retry</button>
        </div>
      ) : <FourWeeksTable table={fourWeekTable(currentStart, read.value)} />}
    </section>
  );
}

/** WLM-03M: what the member recorded in the month, counted only from what was written. */
function MonthSummary({ month, version }) {
  const [read, setRead] = useState({ state: 'loading' });
  const load = useCallback(async () => {
    setRead({ state: 'loading' });
    try { const v = await wellbeingReflectionsApi.monthSummary(month); setRead(v && 'days_recorded' in v ? { state: 'ok', value: v } : { state: 'unreadable' }); }
    catch { setRead({ state: 'unreadable' }); }
  }, [month]);
  useEffect(() => { load(); }, [load, version]);
  const lines = read.state === 'ok' ? summaryLines(read.value) : null;
  return (
    <section className={CARD} aria-labelledby="month-summary" data-testid="reflection-month-summary">
      <h2 id="month-summary" className="mb-2 text-[15px] font-bold text-stone-900 dark:text-gray-100">What you recorded in {monthName(`${month}-01`)}</h2>
      {read.state === 'loading' ? <div className="h-16 animate-pulse rounded bg-stone-200 dark:bg-gray-800" /> : !lines ? (
        <p className="text-sm text-stone-700 dark:text-gray-300" role="alert">What you recorded couldn’t be read. <button type="button" className={BTN.ghost} onClick={load}>Retry</button></p>
      ) : (
        <dl className="grid grid-cols-2 gap-3">
          <div><dt className="text-xs text-stone-500 dark:text-gray-400">Daily reflections</dt><dd className="text-lg font-bold text-stone-900 dark:text-gray-100" data-testid="reflection-month-days">{lines.days.n}<small className="block text-xs font-normal text-stone-600 dark:text-gray-400">{lines.days.note}</small></dd></div>
          <div><dt className="text-xs text-stone-500 dark:text-gray-400">Weekly reflections</dt><dd className="text-lg font-bold text-stone-900 dark:text-gray-100" data-testid="reflection-month-weeks">{lines.weeks.n}<small className="block text-xs font-normal text-stone-600 dark:text-gray-400">{lines.weeks.note}</small></dd></div>
        </dl>
      )}
      <p className={`${FIELD.note} mt-2`}>Only what you wrote is counted. Days without a reflection are left out, not shown as missing. Shown only to you; never a score.</p>
    </section>
  );
}

/** The check-ins saved before reflections had their own periods: kept with their own dates, never filed as a day or a week. */
function EarlierCheckins() {
  const [read, setRead] = useState({ state: 'loading' });
  const [error, setError] = useState(null);
  const load = useCallback(async () => {
    setRead({ state: 'loading' });
    try { const v = await wellbeingReflectionsApi.earlier(30); setRead(Array.isArray(v?.earlier) ? { state: 'ok', value: v.earlier } : { state: 'unreadable' }); }
    catch { setRead({ state: 'unreadable' }); }
  }, []);
  useEffect(() => { load(); }, [load]);
  if (read.state === 'ok' && !read.value.length) return null;
  const remove = async (uid) => {
    setError(null);
    try { await wellbeingReflectionsApi.removeEarlier(uid); await load(); } catch { setError('That check-in wasn’t deleted. Try again.'); }
  };
  return (
    <section className={CARD} aria-labelledby="earlier-checkins" data-testid="reflection-earlier">
      <h2 id="earlier-checkins" className="mb-1 text-[15px] font-bold text-stone-900 dark:text-gray-100">Earlier check-ins</h2>
      <p className={FIELD.note}>Saved before Today, This week and This month were separate. Each keeps its own date; none is counted as a day or a week.</p>
      {read.state === 'loading' ? <div className="mt-2 h-12 animate-pulse rounded bg-stone-200 dark:bg-gray-800" /> : read.state !== 'ok' ? (
        <p className="mt-2 text-sm text-stone-700 dark:text-gray-300" role="alert">Your earlier check-ins couldn’t be read. <button type="button" className={BTN.ghost} onClick={load}>Retry</button></p>
      ) : (
        <ul className="mt-2 divide-y divide-stone-200 dark:divide-gray-800">
          {read.value.map((x) => (
            <li key={x.uid} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm" data-testid={`reflection-earlier-${x.uid}`}>
              <span><b className="text-stone-900 dark:text-gray-100">{periodLabel('day', x.day, x.day) || x.day}</b> <span className="text-stone-600 dark:text-gray-400">· {x.label || 'Earlier check-in'}</span></span>
              <button type="button" className={BTN.ghost} onClick={() => remove(x.uid)}>Delete</button>
            </li>
          ))}
        </ul>
      )}
      {error ? <p className={`${ALERT} mt-2`} role="alert">{error}</p> : null}
    </section>
  );
}

/** Export: the member's own file, saved on this device. A failed export says so. */
function ExportButton() {
  const [state, setState] = useState({ busy: false, error: null });
  const run = async () => {
    setState({ busy: true, error: null });
    try {
      const data = await wellbeingReflectionsApi.exportFile();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = 'my-reflections.json'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setState({ busy: false, error: null });
    } catch { setState({ busy: false, error: 'The export couldn’t be made. Nothing was changed; try again.' }); }
  };
  return (
    <>
      <button type="button" className={`${BTN.ghost} mt-2`} onClick={run} disabled={state.busy} data-testid="reflection-export">{state.busy ? 'Preparing…' : 'Export my reflections'}</button>
      {state.error ? <p className={`${ALERT} mt-2`} role="alert">{state.error}</p> : null}
    </>
  );
}

/** WLM-03: one period's view, reached from the home, the heart or `/wellbeing?period=`. */
export function ReflectionView({ cadence, read, timezone, onRetry, onChanged }) {
  const [editing, setEditing] = useState(null); // a past reflection opened from history
  const [version, setVersion] = useState(0);
  useEffect(() => { setEditing(null); }, [cadence]);
  if (read.state === 'loading') return <div className={`${CARD} h-64 animate-pulse`} data-testid="reflection-view-loading" aria-busy="true" />;
  if (read.state !== 'ok') {
    return (
      <div className={`${CARD} text-sm text-stone-700 dark:text-gray-300`} role="alert" data-testid="reflection-view-unreadable">
        <b>Couldn’t load your reflection.</b> It is unchanged; nothing you saved is lost.
        <div className="mt-2"><button type="button" className={BTN.ghost} onClick={onRetry}>Retry</button></div>
      </div>
    );
  }
  const slot = read.value[cadence];
  const periodStart = editing ? editing.period_start : slot.period_start;
  const periodEnd = editing ? editing.period_end : slot.period_end;
  const reflection = editing || slot.reflection;
  const st = editing ? periodState(cadence, { reflection: editing }, timezone) : periodState(cadence, slot, timezone);
  const saved = (out) => { setVersion((v) => v + 1); if (editing && out) setEditing({ ...editing, ...out }); onChanged?.(); };
  return (
    <div className="space-y-4" data-testid={`reflection-view-${cadence}`}>
      <header>
        <span className="text-[11px] font-bold uppercase tracking-wide text-stone-500 dark:text-gray-400">Reflection · {TAB_WORDS[cadence]}</span>
        <h1 className="text-2xl font-extrabold text-stone-900 dark:text-gray-100">{cadence === 'month' ? `Looking back on ${monthName(slot.period_start)}` : HEADS[cadence]}</h1>
        <p className="text-sm text-stone-600 dark:text-gray-400">Answer what you like; every question is optional.</p>
      </header>
      <nav aria-label="Reflections" className="flex flex-wrap gap-1.5">
        {['day', 'week', 'month'].map((c) => (
          <Link key={c} to={periodHref(c)} aria-current={c === cadence ? 'page' : undefined}
            className={`min-h-[44px] rounded-full px-4 py-2.5 text-sm font-semibold ${c === cadence ? 'bg-stone-900 text-white dark:bg-gray-100 dark:text-gray-900' : 'border border-stone-300 text-stone-700 dark:border-gray-700 dark:text-gray-300'}`}
            data-testid={`reflection-tab-${c}`}>{TAB_WORDS[c]}</Link>
        ))}
      </nav>
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
        <section className={`${CARD} lg:col-span-7`} aria-labelledby="reflection-edit">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 id="reflection-edit" className="text-[15px] font-bold text-stone-900 dark:text-gray-100">
                {editing ? `Edit ${historyLabel(cadence, periodStart)}` : cadence === 'day' ? 'Today’s reflection' : cadence === 'week' ? (reflection ? 'Edit this week’s reflection' : 'This week’s reflection') : 'Monthly reflection'}
              </h2>
              <span className="text-xs text-stone-600 dark:text-gray-400" data-testid="reflection-view-date">{periodLabel(cadence, periodStart, periodEnd)}{cadence === 'day' && !editing ? ` · your local day (${timezone})` : cadence === 'week' ? ' · weeks start on Monday in your time zone' : ''}</span>
            </div>
            <StateChip state={st} testid="reflection-view-state" />
          </div>
          {reflection && reflection.readable === false ? (
            <p className={ALERT} role="alert">This reflection couldn’t be read. It is unchanged; nothing is shown or saved over it.</p>
          ) : (
            <ReflectionEditor cadence={cadence} periodStart={periodStart} reflection={reflection || null} timezone={timezone} onSaved={(out) => { if (out === null) { onRetry(); return; } saved(out); }} />
          )}
          {editing ? <button type="button" className={`${BTN.ghost} mt-3`} onClick={() => setEditing(null)} data-testid="button-reflection-back-current">Back to {TAB_WORDS[cadence].toLowerCase()}</button> : null}
          <PrivateLine />
        </section>
        <div className="space-y-4 lg:col-span-5">
          {cadence === 'month' ? <MonthSummary month={slot.period_start.slice(0, 7)} version={version} /> : null}
          <ReflectionHistory cadence={cadence} timezone={timezone} version={version} onEdit={(r) => setEditing(r)}
            onDeleted={(r) => { if (editing?.uid === r.uid) setEditing(null); onChanged?.(); }} />
          {cadence === 'week' ? <FourWeeks currentStart={slot.period_start} version={version} /> : null}
          {cadence === 'week' ? <EarlierCheckins /> : null}
          <section className={CARD} aria-labelledby="reflection-keep" data-testid="reflection-retention">
            <h2 id="reflection-keep" className="mb-1 text-[15px] font-bold text-stone-900 dark:text-gray-100">Keeping and removing</h2>
            <p className="text-sm text-stone-700 dark:text-gray-300">{RETENTION_LINE}</p>
            <ExportButton />
          </section>
        </div>
      </div>
    </div>
  );
}

