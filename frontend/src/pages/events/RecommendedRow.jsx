import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Lightbox, Unreadable } from '../../ui';
import { CARD, Pill, Skeleton } from './MyEventsTabs';
import { timeLine } from './myEventsModel';
import {
  FORMATS, GOALS_MAX, HOST_NEVER, NOT_FOR_ME_DONE, NOT_FOR_ME_REASONS, NO_ATTENDEES, RANK_LINE, ROW_TITLE, SIGNALS, TOPICS, TOPICS_MAX,
  checkPrefs, explainQuoteLine, prefsToForm, reasonsOf, registerState, rowState, signalWord, travelWords,
} from './recommendationsModel';

/**
 * D3724 (#3724 Part D): "Recommended for you" (ME1, ME2, ME5), with Why this?
 * (ME3), Not for me (ME4), Tune recommendations (ME6) and the states (ME10).
 *
 * It imports no client: the page passes `read` (the adapter's answer) and
 * `act` (the adapter's writes). Every state but `ready` draws the page's own
 * `fallback` (today's Suggested card) under one line saying why, so nothing is
 * faked and nothing is lost.
 */
const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-axal-muted dark:text-gray-400';
const LINK = 'font-semibold text-axal-violet hover:text-axal-violet-deep dark:text-violet-300 dark:hover:text-violet-200';
const BTN = 'inline-flex min-h-[36px] items-center rounded-[8px] border border-axal-hairline px-2.5 text-[12px] font-semibold text-axal-ink hover:border-axal-violet focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:opacity-50 dark:border-gray-700 dark:text-gray-100';
const PRIMARY = 'inline-flex min-h-[36px] items-center rounded-[8px] bg-axal-violet px-3 text-[12px] font-bold text-white hover:bg-axal-violet-deep focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:opacity-50';
const CHIP = (on) => `inline-flex min-h-[32px] items-center rounded-full border px-3 text-[12px] font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${on
  ? 'border-axal-violet bg-violet-50 text-axal-ink dark:border-violet-400 dark:bg-violet-950/40 dark:text-gray-100'
  : 'border-axal-hairline text-axal-muted dark:border-gray-700 dark:text-gray-300'}`;
const FIELD = 'w-full rounded-[7px] border border-axal-hairline bg-white px-3 py-1.5 text-[12.5px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const zone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return null; } };

export default function RecommendedRow({ read, act = {}, explorer = false, layout = 'side', fallback = null }) {
  const state = rowState(read);
  const [why, setWhy] = useState(null);
  const [notFor, setNotFor] = useState(null);
  const [tune, setTune] = useState(false);
  const [hidden, setHidden] = useState(() => new Map());
  const [saved, setSaved] = useState(() => new Map());
  const [line, setLine] = useState(null);

  if (state.kind !== 'ready') {
    // While the read is in flight, the fallback keeps its place, so the column does not jump.
    if (state.kind === 'loading') return fallback || <Skeleton lines={3} testId="my-events-recommended-loading" />;
    return (
      <div className="flex flex-col gap-2" data-testid="my-events-recommended" data-state={state.kind}>
        {state.kind === 'error'
          ? <div className={`${CARD} p-4`}><Unreadable what="Recommendations" claim="That is not the same as having none." onRetry={read?.reload} /></div>
          : <p className={`m-0 text-[12px] ${MUTED}`} role="note" data-testid="my-events-recommended-note">{state.line}</p>}
        {fallback}
      </div>
    );
  }

  const shown = state.events.filter((e) => !hidden.has(e.id));
  const isSaved = (e) => (saved.has(e.id) ? saved.get(e.id) : !!e.saved);
  const toggleSave = async (e) => {
    const next = !isSaved(e);
    setSaved((m) => new Map(m).set(e.id, next));
    const r = await act.feedback?.(e.id, { verdict: next ? 'saved' : null });
    if (!r?.available) { setSaved((m) => new Map(m).set(e.id, !next)); setLine(r?.reason || 'That did not go through.'); }
  };
  const grid = layout === 'grid';
  return (
    <section className={grid ? 'flex flex-col gap-2' : `${CARD} p-4`} aria-labelledby="my-events-recommended-title" data-testid="my-events-recommended" data-state="ready">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="my-events-recommended-title" className={`m-0 text-[15px] font-extrabold ${INK}`}>{ROW_TITLE}</h2>
        <button type="button" className={`${LINK} text-[12px]`} onClick={() => setTune(true)} data-testid="my-events-recommended-tune">Tune recommendations</button>
      </div>
      <p className={`m-0 text-[11.5px] ${MUTED}`}>{RANK_LINE}</p>
      {line ? <p className="m-0 text-[12px] text-axal-destructive dark:text-red-300" role="alert">{line}</p> : null}
      {hidden.size ? (
        <p className={`m-0 text-[12px] ${MUTED}`} role="status" data-testid="my-events-recommended-hidden">
          {NOT_FOR_ME_DONE}{' '}
          <button type="button" className={LINK} onClick={async () => {
            const [id] = [...hidden.keys()].slice(-1);
            setHidden((m) => { const n = new Map(m); n.delete(id); return n; });
            await act.feedback?.(id, { verdict: null });
          }} data-testid="my-events-recommended-undo">Undo</button>
        </p>
      ) : null}
      {!shown.length ? <p className={`m-0 text-[12.5px] ${MUTED}`}>Nothing to recommend right now.</p> : (
        <ul className={`m-0 list-none p-0 ${grid ? 'grid gap-2.5 md:grid-cols-2 lg:grid-cols-4' : 'flex flex-col gap-2'}`}>
          {shown.slice(0, grid ? 4 : 3).map((e) => {
            const reg = registerState(e, explorer);
            const reasons = reasonsOf(e, { explorer, limit: 2 });
            return (
              <li key={e.id} className={`flex flex-col gap-1 rounded-[10px] border border-axal-hairline p-2.5 dark:border-gray-700 ${grid ? 'bg-white dark:bg-gray-900' : ''}`} data-testid="my-events-recommended-card">
                <span className="flex flex-wrap items-center gap-1.5">
                  <Link to={`/events/${e.slug || e.id}`} className={`text-[13px] font-bold ${INK}`}>{e.title || 'Not recorded'}</Link>
                  {e.source === 'axal' || !e.source ? <Pill tone="info">Axal</Pill> : null}
                </span>
                <span className={`text-[11.5px] ${MUTED}`}>{timeLine(e, zone())}</span>
                {reasons.map((r) => <span key={r} className="text-[11.5px] text-violet-800 dark:text-violet-300">{r}</span>)}
                <span className="mt-1 flex flex-wrap items-center gap-1.5">
                  {reg.kind === 'open' || reg.kind === 'full'
                    ? <Link className={PRIMARY} to={`/events/${e.slug || e.id}`} data-testid="my-events-recommended-register">{reg.line}</Link>
                    : <span className={`text-[12px] font-bold ${MUTED}`}>{reg.line}</span>}
                  <button type="button" className={BTN} aria-pressed={isSaved(e)} onClick={() => toggleSave(e)}>{isSaved(e) ? 'Saved' : 'Save'}</button>
                  <button type="button" className={BTN} onClick={() => setNotFor(e)} data-testid="my-events-recommended-not-for-me">Not for me</button>
                  <button type="button" className={`${LINK} text-[12px]`} onClick={() => setWhy(e)} data-testid="my-events-recommended-why">Why this?</button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {why ? <WhyThis event={why} explorer={explorer} act={act} onClose={() => setWhy(null)} /> : null}
      {notFor ? <NotForMe event={notFor} act={act} onClose={() => setNotFor(null)} onHidden={(id, reason) => { setNotFor(null); setHidden((m) => new Map(m).set(id, reason)); }} /> : null}
      {tune ? <TunePanel act={act} signals={state.signals} onClose={() => setTune(false)} /> : null}
    </section>
  );
}

/** ME3: the stored reasons, free; Eadwyn's words only after the quote is shown. */
export function WhyThis({ event, explorer = false, act = {}, onClose }) {
  const reasons = reasonsOf(event, { explorer, limit: 6 });
  const [quote, setQuote] = useState(null);
  const [text, setText] = useState(null);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  // D4450: the price is a quote with an identity. Asking runs with that quote's
  // `quote_uid`; if it has expired (409 quote_stale) the member is shown a new
  // price and asks again. Nothing paid is retried on its own.
  const ask = async () => {
    setBusy(true);
    try {
      if (!quote?.available) { setQuote((await act.explainQuote?.(event.id)) || { available: false, reason: 'That did not go through.' }); return; }
      const r = await act.explain?.(event.id, quote.value?.quote_uid);
      if (r?.available) { setText(r.value?.text || null); return; }
      if (r?.stale) {
        const fresh = await act.explainQuote?.(event.id);
        setQuote(fresh?.available ? fresh : { available: false, reason: fresh?.reason || r.reason });
        setStale(true);
        return;
      }
      setQuote({ available: false, reason: r?.reason || 'That did not go through.' });
    } finally { setBusy(false); }
  };
  return (
    <Lightbox label={`Why ${event.title || 'this event'}`} title="Why you’re seeing this" sub={event.title || 'Not recorded'} onClose={onClose} width={480} phone="sheet" testId="my-events-why">
      <div className="flex flex-col gap-3 px-5 py-4 text-[13px]">
        {reasons.length ? (
          <ul className="m-0 flex list-disc flex-col gap-1 pl-5" data-testid="my-events-why-reasons">{reasons.map((r) => <li key={r} className={INK}>{r}</li>)}</ul>
        ) : <p className={`m-0 ${MUTED}`}>No reason was recorded for this pick.</p>}
        <p className={`m-0 text-[12px] ${MUTED}`}>These come from your own profile. Reading them is free. {NO_ATTENDEES}</p>
        <div className="flex flex-col gap-1.5 rounded-[10px] border border-axal-hairline p-3 dark:border-gray-700">
          <span className={`text-[12.5px] font-bold ${INK}`}>Ask Eadwyn why, in a few sentences</span>
          <span className={`text-[12px] ${MUTED}`} data-testid="my-events-why-cost">
            {quote?.available ? explainQuoteLine(quote.value) : quote ? quote.reason : 'The cost is shown before anything runs.'}
          </span>
          {stale && quote?.available ? <span className={`text-[12px] ${MUTED}`} role="status" data-testid="my-events-why-stale">That price had expired. This is the new one; nothing was charged.</span> : null}
          {text ? <p className={`m-0 ${INK}`} data-testid="my-events-why-text">{text}</p> : (
            <button type="button" className={`${BTN} w-fit`} disabled={busy || (quote && !quote.available)} onClick={ask} data-testid="my-events-why-ask">
              {busy ? 'Working…' : quote?.available ? 'Ask Eadwyn' : 'See the cost'}
            </button>
          )}
        </div>
      </div>
    </Lightbox>
  );
}

/** ME4: hide a pick, with a reason chip. The host never sees it. */
export function NotForMe({ event, act = {}, onClose, onHidden }) {
  const [reason, setReason] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true); setErr(null);
    const r = await act.feedback?.(event.id, { verdict: 'not_for_me', reason });
    setBusy(false);
    if (r?.available) onHidden(event.id, reason); else setErr(r?.reason || 'That did not go through.');
  };
  return (
    <Lightbox label={`Not for me: ${event.title || 'this event'}`} title="Not for me" sub={event.title || 'Not recorded'} onClose={onClose} width={440} phone="sheet" testId="my-events-not-for-me"
      footer={<div className="flex justify-end gap-2"><button type="button" className={BTN} onClick={onClose}>Cancel</button><button type="button" className={PRIMARY} disabled={busy} onClick={send} data-testid="my-events-not-for-me-hide">Hide it</button></div>}>
      <div className="flex flex-col gap-3 px-5 py-4 text-[13px]">
        <fieldset className="m-0 border-0 p-0">
          <legend className={`mb-2 text-[12.5px] font-bold ${INK}`}>What’s off? (optional)</legend>
          <div className="flex flex-wrap gap-1.5">
            {NOT_FOR_ME_REASONS.map((c) => <button key={c.key} type="button" className={CHIP(reason === c.key)} aria-pressed={reason === c.key} onClick={() => setReason(reason === c.key ? null : c.key)}>{c.label}</button>)}
          </div>
        </fieldset>
        <p className={`m-0 text-[12px] ${MUTED}`}>{HOST_NEVER} You’ll see fewer like it, and you can undo it.</p>
        {err ? <p className="m-0 text-[12px] text-axal-destructive dark:text-red-300" role="alert" data-testid="my-events-not-for-me-error">{err}</p> : null}
      </div>
    </Lightbox>
  );
}

/** ME6: what the picks are drawn from, and the switch that turns them off. */
export function TunePanel({ act = {}, signals = {}, initial = {}, onClose }) {
  const [p, setP] = useState({ interests: [], goals: '', formats: [], home_city: '', travel_km: '', enabled: true, ...initial });
  // The saved preferences are read before anything can be saved over them. A page that
  // passes no `prefs` read (a test, a preview) starts ready with `initial`.
  const [loaded, setLoaded] = useState(act.prefs ? 'loading' : 'ready');
  useEffect(() => {
    if (!act.prefs) return undefined;
    let alive = true;
    Promise.resolve(act.prefs()).then((r) => {
      if (!alive) return;
      if (r?.available) { setP((x) => ({ ...x, ...prefsToForm(r.value?.prefs) })); setLoaded('ready'); } else { setLoaded('failed'); setErr({ field: null, error: r?.reason || 'Your saved preferences could not be read.' }); }
    });
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [err, setErr] = useState(null);
  const [done, setDone] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => { setP((x) => ({ ...x, [k]: v })); setErr(null); setDone(null); };
  const save = async () => {
    const c = checkPrefs(p);
    if (!c.ok) { setErr(c); return; }
    setBusy(true);
    const r = await act.savePrefs?.(p);
    setBusy(false);
    if (r?.available) setDone('Saved. Your picks use these from now on.'); else setErr({ field: r?.field || null, error: r?.reason || 'That did not go through.' });
  };
  const goalsLeft = GOALS_MAX - (p.goals || '').length;
  return (
    <Lightbox label="Tune recommendations" title="Tune recommendations" sub="What your picks are drawn from" onClose={onClose} width={560} phone="sheet" testId="my-events-tune"
      footer={<div className="flex justify-end gap-2"><button type="button" className={BTN} onClick={onClose}>Close</button><button type="button" className={PRIMARY} disabled={busy || loaded !== 'ready'} onClick={save} data-testid="my-events-tune-save">Save preferences</button></div>}>
      <div className="flex flex-col gap-3 px-5 py-4 text-[13px]">
        <fieldset className="m-0 border-0 p-0"><legend className={`mb-1.5 text-[12.5px] font-bold ${INK}`}>Interests</legend>
          <div className="flex flex-wrap gap-1.5">{TOPICS.map((t) => {
            const on = p.interests.includes(t.key);
            return <button key={t.key} type="button" className={CHIP(on)} aria-pressed={on} disabled={!on && p.interests.length >= TOPICS_MAX} onClick={() => set('interests', on ? p.interests.filter((k) => k !== t.key) : [...p.interests, t.key])}>{t.label}</button>;
          })}</div></fieldset>
        <label className="flex flex-col gap-1"><span className={`text-[12.5px] font-bold ${INK}`}>Goals</span>
          <textarea className={FIELD} rows={3} value={p.goals} onChange={(e) => set('goals', e.target.value)} aria-invalid={err?.field === 'goals' || undefined} aria-describedby="tune-goals-left" />
          <span id="tune-goals-left" className={`text-[11.5px] ${goalsLeft < 0 ? 'text-axal-destructive dark:text-red-300' : MUTED}`}>{goalsLeft} characters left</span></label>
        <fieldset className="m-0 border-0 p-0"><legend className={`mb-1.5 text-[12.5px] font-bold ${INK}`}>Formats</legend>
          <div className="flex flex-wrap gap-1.5">{FORMATS.map((f) => {
            const on = p.formats.includes(f.key);
            return <button key={f.key} type="button" className={CHIP(on)} aria-pressed={on} onClick={() => set('formats', on ? p.formats.filter((k) => k !== f.key) : [...p.formats, f.key])}>{f.label}</button>;
          })}</div></fieldset>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex flex-col gap-1"><span className={`text-[12.5px] font-bold ${INK}`}>Home city</span>
            <input className={FIELD} value={p.home_city} onChange={(e) => set('home_city', e.target.value)} placeholder="Not recorded" /></label>
          <label className="flex flex-col gap-1"><span className={`text-[12.5px] font-bold ${INK}`}>Travel range (km)</span>
            <input className={FIELD} inputMode="numeric" value={p.travel_km} onChange={(e) => set('travel_km', e.target.value.replace(/[^0-9]/g, ''))} aria-invalid={err?.field === 'travel_km' || undefined} />
            <span className={`text-[11.5px] ${MUTED}`}>{travelWords(p.travel_km)}</span></label>
        </div>
        <div className="flex flex-col gap-1 rounded-[10px] border border-axal-hairline p-3 dark:border-gray-700">
          <span className={`text-[12.5px] font-bold ${INK}`}>What the picks use now</span>
          <ul className="m-0 grid list-none grid-cols-2 gap-x-3 gap-y-0.5 p-0 text-[12px]" data-testid="my-events-tune-signals">
            {SIGNALS.map((s) => <li key={s.key} className="flex justify-between gap-2"><span className={MUTED}>{s.label}</span><span className={INK}>{signalWord(signals[s.key])}</span></li>)}
          </ul>
        </div>
        <label className="flex items-center gap-2"><input type="checkbox" checked={p.enabled !== false} onChange={(e) => set('enabled', e.target.checked)} />
          <span className={INK}>Recommend events to me</span></label>
        {err ? <p className="m-0 text-[12px] text-axal-destructive dark:text-red-300" role="alert" data-testid="my-events-tune-error">{err.error}</p> : null}
        {done ? <p className="m-0 text-[12px] text-emerald-800 dark:text-emerald-200" role="status">{done}</p> : null}
      </div>
    </Lightbox>
  );
}
