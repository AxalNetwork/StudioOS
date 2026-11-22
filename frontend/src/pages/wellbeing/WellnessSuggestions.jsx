/**
 * D7119 part 2 (#7119, canvas `Wellness Member Home`, WLM-04, WLM-05, WLM-05B, WLM-05C): Recommendations on the
 * Wellness home, and Choose interests.
 *
 *   SuggestionsSection      the suggestions from the member's own choices, each with Why this? (what was used and
 *                           what never is), Dismiss with Undo, View and Browse all; its states: loading, a failed read
 *                           (never "none match"), suggestions off, nothing chosen yet, no match, and the cards
 *   InterestsPanel          the kinds of support (each off until chosen), formats, languages, a price limit,
 *                           suggestions on or off, and separately the permission to use topics ticked on chosen kinds
 *                           of reflection; Save, and Reset all after a confirmation
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { wellbeingRecommendationsApi } from '../../lib/api/wellbeingRecommendations';
import { BTN, FIELD } from './WellbeingParts';
import { GroupSeatPanel } from './GroupSessions';
import {
  FORMAT_WORDS, RESOURCES_APART, SOURCES, SOURCE_WORDS, cardFacts, chosenLine, excludedLine, isPrefsChanged, prefsBody,
  prefsDraft, prefsRefusal, sectionState, toggleIn,
} from './recommendationsModel';

const CARD = 'rounded-axal border border-stone-200 bg-stone-50 p-4 dark:border-gray-800 dark:bg-gray-900';
const ALERT = 'rounded-axal-sm border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200';
const SWITCH = (on) => `inline-flex min-h-[44px] items-center gap-2 rounded-full border px-3 text-xs font-semibold ${on
  ? 'border-emerald-600 bg-emerald-50 text-emerald-900 dark:border-emerald-500 dark:bg-emerald-950/40 dark:text-emerald-200'
  : 'border-stone-300 bg-white text-stone-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300'}`;

function useRead(call) {
  const [read, setRead] = useState({ state: 'loading' });
  const load = useCallback(async () => {
    setRead((r) => (r.state === 'ok' ? r : { state: 'loading' }));
    try { const v = await call(); setRead(v && typeof v === 'object' ? { state: 'ok', value: v } : { state: 'unreadable' }); }
    catch { setRead({ state: 'unreadable' }); }
  }, [call]);
  useEffect(() => { load(); }, [load]);
  return [read, load];
}

/** WLM-04 / WLM-05B: the member's own choices. */
export function InterestsPanel({ prefs, onSaved, onClose }) {
  const [draft, setDraft] = useState(() => prefsDraft(prefs));
  const [state, setState] = useState({ busy: false, error: null, changed: false, confirmReset: false });
  useEffect(() => { setDraft(prefsDraft(prefs)); }, [prefs]);
  const opts = prefs.support_type_options || [];
  const save = async (e) => {
    e?.preventDefault?.();
    const body = prefsBody(draft, prefs);
    if (!body) { onClose?.(); return; }
    if (body.problem) { setState((s) => ({ ...s, error: body.problem, changed: false })); return; }
    setState({ busy: true, error: null, changed: false, confirmReset: false });
    try { await wellbeingRecommendationsApi.savePreferences(body); setState({ busy: false, error: null, changed: false, confirmReset: false }); onSaved?.(); }
    catch (err) { setState({ busy: false, error: prefsRefusal(err), changed: isPrefsChanged(err), confirmReset: false }); }
  };
  const reset = async () => {
    setState((s) => ({ ...s, busy: true, error: null }));
    try { await wellbeingRecommendationsApi.resetPreferences(); setState({ busy: false, error: null, changed: false, confirmReset: false }); onSaved?.(); }
    catch { setState({ busy: false, error: 'Nothing was reset. Try again.', changed: false, confirmReset: false }); }
  };
  return (
    <form onSubmit={save} className={`${CARD} space-y-4`} aria-label="Choose interests" data-testid="interests-panel">
      <div>
        <h3 className="text-[15px] font-bold text-stone-900 dark:text-gray-100">Choose interests</h3>
        <p className={FIELD.note}>Each one is your choice and starts off. They change which providers are suggested. Your reflections never change them unless you allow it below.</p>
      </div>
      <fieldset>
        <legend className={FIELD.label}>Kinds of support</legend>
        <div className="flex flex-wrap gap-2">
          {opts.map((o) => {
            const on = draft.support_types.includes(o.key);
            return (
              <button key={o.key} type="button" role="switch" aria-checked={on} className={SWITCH(on)}
                onClick={() => setDraft({ ...draft, support_types: toggleIn(draft.support_types, o.key) })} data-testid={`interest-${o.key}`}>
                {on ? 'On' : 'Off'} · {o.label}
              </button>
            );
          })}
        </div>
      </fieldset>
      <fieldset>
        <legend className={FIELD.label}>Formats</legend>
        <div className="flex flex-wrap gap-2">
          {Object.entries(FORMAT_WORDS).map(([k, label]) => {
            const on = draft.formats.includes(k);
            return <button key={k} type="button" role="switch" aria-checked={on} className={SWITCH(on)} onClick={() => setDraft({ ...draft, formats: toggleIn(draft.formats, k) })} data-testid={`interest-format-${k}`}>{label}</button>;
          })}
        </div>
        <p className={`${FIELD.note} mt-1`}>None chosen means both.</p>
      </fieldset>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block"><span className={FIELD.label}>Languages (optional)</span>
          <input className={FIELD.input} value={draft.languages} placeholder="en, fr" onChange={(e) => setDraft({ ...draft, languages: e.target.value })} data-testid="interest-languages" /></label>
        <label className="block"><span className={FIELD.label}>Price limit per session, in dollars (optional)</span>
          <input className={FIELD.input} type="number" min="0" step="1" value={draft.price} placeholder="No limit" onChange={(e) => setDraft({ ...draft, price: e.target.value })} data-testid="interest-price" /></label>
      </div>
      <div className="border-t border-dashed border-stone-300 pt-3 dark:border-gray-700">
        <button type="button" role="switch" aria-checked={draft.topic_consent} className={SWITCH(draft.topic_consent)}
          onClick={() => setDraft({ ...draft, topic_consent: !draft.topic_consent })} data-testid="interest-topic-consent">
          {draft.topic_consent ? 'On' : 'Off'} · Use topics I tick in my reflections
        </button>
        <p className={`${FIELD.note} mt-1`} data-testid="interest-topic-scope">{prefs.topic_consent_scope || 'Only the topics you choose on a reflection. Never what you write, never your answers, never your bookings.'} Turning it off stops their use at once, here and in the directory.</p>
        {draft.topic_consent ? (
          <fieldset className="mt-2">
            <legend className={FIELD.label}>Topics may come from</legend>
            <div className="flex flex-wrap gap-2">
              {SOURCES.map((s) => {
                const on = draft.topic_sources.includes(s);
                return <button key={s} type="button" role="switch" aria-checked={on} className={SWITCH(on)} onClick={() => setDraft({ ...draft, topic_sources: toggleIn(draft.topic_sources, s) })} data-testid={`interest-source-${s}`}>{SOURCE_WORDS[s]}</button>;
              })}
            </div>
          </fieldset>
        ) : null}
      </div>
      <button type="button" role="switch" aria-checked={draft.suggestions} className={SWITCH(draft.suggestions)} onClick={() => setDraft({ ...draft, suggestions: !draft.suggestions })} data-testid="interest-suggestions">
        {draft.suggestions ? 'On' : 'Off'} · Show suggestions on my Wellness home
      </button>
      {state.error ? <p className={ALERT} role="alert" data-testid="interests-error">{state.error}{state.changed ? <> <button type="button" className="font-semibold underline" onClick={onSaved}>Reload</button></> : null}</p> : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {state.confirmReset ? (
          <span className="flex flex-wrap items-center gap-2 text-xs text-stone-700 dark:text-gray-300">
            Forget every choice, the permission and every dismissal?
            <button type="button" className={BTN.danger} disabled={state.busy} onClick={reset} data-testid="button-interests-reset-confirm">Reset all</button>
            <button type="button" className={BTN.ghost} onClick={() => setState((s) => ({ ...s, confirmReset: false }))}>Keep them</button>
          </span>
        ) : <button type="button" className={BTN.ghost} onClick={() => setState((s) => ({ ...s, confirmReset: true }))} data-testid="button-interests-reset">Reset all</button>}
        <span className="flex gap-2">
          {onClose ? <button type="button" className={BTN.ghost} onClick={onClose}>Cancel</button> : null}
          <button type="submit" className={BTN.primary} disabled={state.busy} data-testid="button-interests-save">{state.busy ? 'Saving…' : 'Save'}</button>
        </span>
      </div>
    </form>
  );
}

function RecCard({ item, onDismiss, onSeats }) {
  const [why, setWhy] = useState(false);
  const [seats, setSeats] = useState(false);
  const f = cardFacts(item);
  return (
    <article className={`${CARD} flex flex-col gap-2 ${f.available ? '' : 'opacity-80'}`} aria-labelledby={`rec-${item.kind}-${item.uid}`} data-testid={`rec-${item.kind}-${item.uid}`}>
      <span className="text-[11px] font-bold uppercase tracking-wide text-stone-500 dark:text-gray-400">{f.kind || (item.kind === 'session' ? 'Group session' : 'Provider')}</span>
      <h3 id={`rec-${item.kind}-${item.uid}`} className="text-[15px] font-bold text-stone-900 dark:text-gray-100">{f.title}</h3>
      {f.byline ? <p className="text-xs text-stone-600 dark:text-gray-400">{f.byline}</p> : null}
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        {f.facts.map(([k, v]) => (
          <div key={k}><dt className="text-stone-500 dark:text-gray-400">{k}</dt><dd className="text-stone-800 dark:text-gray-200">{v || 'Not recorded'}</dd></div>
        ))}
      </dl>
      <p className={`text-xs font-semibold ${f.available ? 'text-emerald-800 dark:text-emerald-300' : 'text-stone-600 dark:text-gray-400'}`} data-testid={`rec-next-${item.uid}`}>{f.next}</p>
      {why ? (
        <div className="rounded-axal-sm border border-stone-200 bg-white p-3 text-xs dark:border-gray-800 dark:bg-gray-950" role="region" aria-label={`Why ${f.title} is suggested`} data-testid={`rec-why-${item.uid}`}>
          <b className="text-stone-900 dark:text-gray-100">Suggested because:</b>
          <ul className="ml-4 list-disc text-stone-700 dark:text-gray-300">{(item.why?.used || []).map((r) => <li key={r.label}>{r.label}</li>)}</ul>
          <b className="mt-1 block text-stone-900 dark:text-gray-100">Not used:</b>
          <ul className="ml-4 list-disc text-stone-700 dark:text-gray-300">{(item.why?.not_used || []).map((r) => <li key={r}>{r}</li>)}</ul>
        </div>
      ) : null}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
        <span className="flex gap-1.5">
          <button type="button" className={BTN.ghost} aria-expanded={why} onClick={() => setWhy((w) => !w)} data-testid={`button-rec-why-${item.uid}`}>Why this?</button>
          <button type="button" className={BTN.ghost} onClick={() => onDismiss(item)} data-testid={`button-rec-dismiss-${item.uid}`}>Dismiss</button>
        </span>
        {item.kind === 'expert'
          ? <Link className={BTN.ghost} to={`/wellbeing/expert/${encodeURIComponent(item.uid)}`} data-testid={`rec-view-${item.uid}`}>View</Link>
          : <button type="button" className={BTN.ghost} aria-expanded={seats} onClick={() => setSeats((v) => !v)} data-testid={`rec-seats-${item.uid}`}>See seats</button>}
      </div>
      {/* D7120 part 2 (WLM-07): the group seat decision opens under its card. */}
      {seats && item.kind === 'session' ? <GroupSeatPanel uid={item.uid} onChanged={onSeats} onClose={() => setSeats(false)} /> : null}
    </article>
  );
}

/** WLM-05: the Recommendations section on the home. */
export function SuggestionsSection({ onSeats } = {}) {
  const [prefs, reloadPrefs] = useRead(wellbeingRecommendationsApi.preferences);
  const [recs, reloadRecs] = useRead(wellbeingRecommendationsApi.recommendations);
  const [choosing, setChoosing] = useState(false);
  const [undo, setUndo] = useState(null);
  const [error, setError] = useState(null);
  const reload = () => { reloadPrefs(); reloadRecs(); };
  const dismiss = async (item) => {
    setError(null);
    try { await wellbeingRecommendationsApi.dismiss(item.kind, item.uid); setUndo(item); reloadRecs(); }
    catch { setError('That suggestion wasn’t dismissed. Try again.'); }
  };
  const undoDismiss = async () => {
    if (!undo) return;
    try { await wellbeingRecommendationsApi.undoDismiss(undo.kind, undo.uid); setUndo(null); reloadRecs(); }
    catch { setError('The suggestion wasn’t brought back. Try again.'); }
  };
  const st = sectionState(recs);
  const v = recs.state === 'ok' ? recs.value : null;
  return (
    <section className={`${CARD} space-y-3`} aria-labelledby="h-rec" data-testid="recommendations">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="h-rec" className="text-[15px] font-bold text-stone-900 dark:text-gray-100">Recommendations</h2>
        <span className="flex gap-2">
          {prefs.state === 'ok' ? <button type="button" className={BTN.ghost} onClick={() => setChoosing((c) => !c)} aria-expanded={choosing} data-testid="button-choose-interests">Choose interests</button> : null}
          <Link className={BTN.ghost} to="/wellbeing/book" data-testid="rec-browse-all">Browse all →</Link>
        </span>
      </div>
      {prefs.state === 'ok' ? <p className="text-sm text-stone-700 dark:text-gray-300" data-testid="rec-chosen">{chosenLine(prefs.value)}</p> : null}
      {choosing && prefs.state === 'ok' ? <InterestsPanel prefs={prefs.value} onSaved={() => { setChoosing(false); reload(); }} onClose={() => setChoosing(false)} /> : null}
      {st === 'loading' ? <div className="grid grid-cols-1 gap-3 md:grid-cols-2" aria-busy="true">{[0, 1].map((i) => <div key={i} className={`${CARD} h-40 animate-pulse`} />)}</div>
        : st === 'unreadable' ? (
          <div className="text-sm text-stone-700 dark:text-gray-300" role="alert" data-testid="rec-unreadable">
            Suggestions couldn’t be read. This is not a claim that none match. <button type="button" className={BTN.ghost} onClick={reload}>Retry</button>
          </div>
        ) : st === 'off' ? (
          <p className="text-sm text-stone-700 dark:text-gray-300" data-testid="rec-off">Suggestions are off. You can still browse every provider.</p>
        ) : st === 'choose_interests' ? (
          <p className="text-sm text-stone-700 dark:text-gray-300" data-testid="rec-choose">Choose interests to see suggestions. Until then, Browse all lists every provider in the directory’s own order.</p>
        ) : st === 'no_match' ? (
          <p className="text-sm text-stone-700 dark:text-gray-300" data-testid="rec-none">Nothing fits what you chose right now. Browse all, or change your interests.</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2" data-testid="rec-cards">
            {v.items.map((item) => <RecCard key={`${item.kind}:${item.uid}`} item={item} onDismiss={dismiss} onSeats={onSeats} />)}
          </div>
        )}
      {undo ? (
        <p className="text-xs text-stone-700 dark:text-gray-300" role="status" data-testid="rec-undo">
          Dismissed {undo.kind === 'session' ? undo.title : undo.name}. <button type="button" className="font-semibold underline" onClick={undoDismiss} data-testid="button-rec-undo">Undo</button>
        </p>
      ) : null}
      {error ? <p className={ALERT} role="alert">{error}</p> : null}
      {v && excludedLine(v.excluded) ? <p className={FIELD.note} data-testid="rec-excluded">{excludedLine(v.excluded)}</p> : null}
      <p className={FIELD.note}>{RESOURCES_APART}</p>
    </section>
  );
}
