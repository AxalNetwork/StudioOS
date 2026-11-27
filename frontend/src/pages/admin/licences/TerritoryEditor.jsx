/**
 * #4707 — the HQ licence page's territory. Moved out of `AdminLicences.jsx`
 * unchanged when the page was split by domain; the comments below are the
 * original ones.
 */
import React, { useId, useMemo, useState } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';
import { api } from '../../../lib/api';
import { reportError } from '../../../lib/log';
import { COVERAGE_TONE, heldState } from './Coverage';
import {
  NEW_LICENCE_STEPS, TERRITORY_CHOICES, TERRITORY_STEP, conflictSentence, conflictTitle, countryName, heldByOthers,
  readCountryCode, territoryConflicts, territoryPlan, territoryRefusal,
} from './issueLicenceFlowModel';

/* ------------------------------------------------------------------ *
 * Step 2 — the territory picker that refuses                          *
 * ------------------------------------------------------------------ */

export function TerritoryEditor({ licence, held, onSaved, onOpenLicence }) {
  const [codes, setCodes] = useState((licence.territories || []).join(', '));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  // Who holds what, excluding this licence's own countries — keeping your own
  // is not a conflict.
  // D5929: the same map New licence's territory step reads (`issueLicenceFlowModel.js`).
  const others = useMemo(() => heldByOthers(held, licence.uid), [held, licence.uid]);

  const entered = useMemo(
    () => codes.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean),
    [codes],
  );
  const clashes = entered.filter((c) => others.has(c));

  async function save() {
    setBusy(true); setErr(null);
    try {
      await api.licenceSetTerritories(licence.uid, entered);
      onSaved?.();
    } catch (e) {
      reportError('licence_territories_failed', e);
      setErr(e?.message || 'Could not save the territory.');
    } finally { setBusy(false); }
  }

  return (
    <div>
      <label className="text-[11px] uppercase tracking-wide text-gray-500" htmlFor="lic-terr">
        Countries — ISO 3166-1 alpha-2, comma separated
      </label>
      <input
        id="lic-terr"
        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm dark:border-gray-700"
        value={codes}
        onChange={(e) => setCodes(e.target.value)}
        placeholder="FR, BE, LU"
      />
      <p className="mt-2 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
        This refusal is the Axal-subsidiary rule: one country, one Axal licence.
        The ledger stores each licence&apos;s kind, but white-label exclusivity against other
        white-labels is not stored (owner decision D196), so this step refuses any country another
        licence already holds regardless of kind.
      </p>
      {clashes.length > 0 && (
        <div className="mt-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          <div className="flex items-start gap-1.5">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <div>
              {clashes.map((c) => {
                const holder = others.get(c);
                return (
                  <div key={c} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span>
                      <strong>{c}</strong> is held by {holder.licence_ref} ({holder.status}).
                    </span>
                    {onOpenLicence && holder.licence_uid && (
                      <button
                        type="button"
                        className="text-xs font-semibold text-red-900 underline hover:no-underline dark:text-red-200"
                        data-testid={`territory-clash-open-${c}`}
                        onClick={() => onOpenLicence(holder.licence_uid)}
                      >
                        Open {holder.licence_ref}
                      </button>
                    )}
                    <button
                      type="button"
                      className="text-xs font-semibold text-red-900 underline hover:no-underline dark:text-red-200"
                      data-testid={`territory-clash-remove-${c}`}
                      onClick={() => setCodes(entered.filter((x) => x !== c).join(', '))}
                    >
                      Remove {c} from list
                    </button>
                  </div>
                );
              })}
              <p className="mt-1.5">
                Two licences cannot hold one country, and a suspended holder still holds its
                territory — releasing it is a termination, not a lapse. This will be refused,
                not recorded with a warning.
              </p>
            </div>
          </div>
        </div>
      )}
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      <button
        type="button" onClick={save} disabled={busy || clashes.length > 0}
        className="mt-3 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : 'Save territory'}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * D5929 (#5929) — New licence, step 2 of 6 (Licences v2 board L21)    *
 * ------------------------------------------------------------------ */

const STEP_BTN = 'inline-flex min-h-[36px] items-center justify-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800 max-md:min-h-[44px]';
const STEP_PRIMARY = 'inline-flex min-h-[36px] items-center justify-center gap-1 rounded-md bg-violet-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-violet-800 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 max-md:min-h-[44px]';

/**
 * Step 2 of New licence: which countries the draft holds. Chips for the 27 EU states (a country another licence
 * holds carries its holder and the coverage grid's taken tone), and any other ISO code added by hand. Choosing a
 * country another licence holds shows the conflict at once, naming the holder, with the rule: a suspended licence
 * still holds its countries, and overlap is refused. Continue stays off while a conflict stands.
 *
 * `codes` and `setCodes` are the frame's, so Back, Continue and a refusal keep the countries chosen. `held` is the
 * holder read: an array, `undefined` while reading, `null` when it could not be read (then the Worker's refusal on
 * Continue is the only check, and the step says so). Continue saves through `PUT /:uid/territories`; the Worker's
 * refusal is shown in its own words and every chosen country stays chosen.
 */
export function TerritoryStep({ licence, codes, setCodes, held, onRetryHeld, onHeldStale, onLicence, onBack, onContinue }) {
  const h = useId();
  const otherId = useId();
  const [other, setOther] = useState('');
  const [otherErr, setOtherErr] = useState(null);
  const [refusal, setRefusal] = useState(null);
  const [busy, setBusy] = useState(false);
  const known = useMemo(() => (Array.isArray(held) ? held : []), [held]);
  const others = useMemo(() => heldByOthers(known, licence.uid), [known, licence.uid]);
  const conflicts = useMemo(() => territoryConflicts(codes, known, licence.uid), [codes, known, licence.uid]);
  const plan = territoryPlan(codes, conflicts);
  const extra = codes.filter((c) => !TERRITORY_CHOICES.includes(c));
  const toggle = (code) => { setRefusal(null); setCodes(codes.includes(code) ? codes.filter((c) => c !== code) : [...codes, code]); };
  const remove = (code) => { setRefusal(null); setCodes(codes.filter((c) => c !== code)); };

  function add(e) {
    e?.preventDefault?.();
    const r = readCountryCode(other);
    if (!r.ok) { setOtherErr(r.message); return; }
    setOtherErr(null); setOther('');
    if (!codes.includes(r.code)) { setRefusal(null); setCodes([...codes, r.code]); }
  }

  async function save() {
    if (!plan.ok || busy) return;
    setRefusal(null); setBusy(true);
    try {
      await api.licenceSetTerritories(licence.uid, plan.countries);
      let next = null;
      try { next = await api.licence(licence.uid); } catch (e) { reportError('new_licence_territory_reread_failed', e); }
      onLicence?.(next || { ...licence, territories: plan.countries });
      onContinue?.();
    } catch (e) {
      reportError('new_licence_territory_failed', e);
      const r = territoryRefusal(e);
      setRefusal(r);
      // A conflict the holder read did not show: someone took the country since. Read who holds what again.
      if (r.kind === 'conflict') onHeldStale?.();
    } finally { setBusy(false); }
  }

  const chip = (code, name) => {
    const holder = others.get(code);
    const on = codes.includes(code);
    return (
      <button
        key={code} type="button" role="checkbox" aria-checked={on} onClick={() => toggle(code)}
        data-testid={`nl-country-${code}`} data-held={holder ? holder.status || 'held' : undefined}
        title={holder ? `${name}: held by ${holder.brand_name || holder.licence_ref} (${holder.status})` : name}
        className={`inline-flex min-h-[32px] items-center gap-1.5 rounded-full border px-3 text-xs font-medium max-md:min-h-[44px] ${
          on ? 'border-violet-600 bg-violet-50 text-violet-900 dark:border-violet-500 dark:bg-violet-950/40 dark:text-violet-100'
            : holder ? COVERAGE_TONE[heldState(holder.status)] : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800'
        }`}
      >
        {on ? <span aria-hidden="true">✓</span> : null}{name}
        {holder ? <span className="text-[10.5px] font-semibold">· {holder.status === 'suspended' ? 'held, suspended' : 'held'}</span> : null}
      </button>
    );
  };

  return (
    <section aria-labelledby={h} data-testid={`nl-step-${TERRITORY_STEP + 1}`} data-step={NEW_LICENCE_STEPS[TERRITORY_STEP]}
      className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
      <h2 id={h} className="m-0 text-lg font-extrabold tracking-tight text-gray-900 dark:text-gray-100">
        Which countries does {licence.legal_entity_name || licence.licence_ref || 'this licence'} hold?
      </h2>
      {held === undefined ? <p className="m-0 text-sm text-gray-500 dark:text-gray-400" aria-busy="true" data-testid="nl-holders-reading">Reading which countries other licences hold…</p> : null}
      {held === null ? (
        <div role="alert" data-testid="nl-holders-unreadable" className="flex flex-wrap items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-[13px] text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100">
          <span aria-hidden="true">!</span>
          <div className="min-w-0 flex-1"><b>Who holds which country could not be read.</b> A conflict cannot be shown before you continue. The platform still refuses an overlap when you save.</div>
          {onRetryHeld ? <button type="button" className={STEP_BTN} onClick={onRetryHeld} data-testid="nl-holders-retry">Try again</button> : null}
        </div>
      ) : null}
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-1 text-[12.5px] font-semibold text-gray-800 dark:text-gray-200">EU member states</legend>
        <div className="flex flex-wrap gap-1.5" data-testid="nl-countries">
          {TERRITORY_CHOICES.map((code) => chip(code, countryName(code)))}
        </div>
      </fieldset>
      <div className="flex flex-col gap-2">
        {extra.length ? (
          <div className="flex flex-wrap gap-1.5" data-testid="nl-countries-other" role="group" aria-label="Other countries chosen">
            {extra.map((code) => chip(code, countryName(code)))}
          </div>
        ) : null}
        <form onSubmit={add} className="flex flex-wrap items-end gap-2">
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor={otherId} className="text-[12.5px] font-semibold text-gray-800 dark:text-gray-200">Another country</label>
            <input
              id={otherId} value={other} maxLength={2} placeholder="CH"
              onChange={(e) => { setOther(e.target.value); if (otherErr) setOtherErr(null); }}
              aria-invalid={otherErr ? 'true' : undefined} aria-describedby={`${otherId}-${otherErr ? 'e' : 'h'}`}
              data-testid="nl-country-other"
              className={`w-24 rounded-md border bg-white px-2.5 py-1.5 font-mono text-sm uppercase text-gray-900 dark:bg-gray-900 dark:text-gray-100 max-md:min-h-[44px] ${otherErr ? 'border-red-600 dark:border-red-400' : 'border-gray-300 dark:border-gray-700'}`}
            />
          </div>
          <button type="submit" className={STEP_BTN} data-testid="nl-country-add">Add</button>
          {otherErr
            ? <small id={`${otherId}-e`} className="basis-full text-xs text-red-700 dark:text-red-300" data-testid="nl-country-other-error"><span aria-hidden="true">✕ </span>{otherErr}</small>
            : <small id={`${otherId}-h`} className="basis-full text-xs text-gray-500 dark:text-gray-400">Outside the EU: its two-letter ISO code.</small>}
        </form>
      </div>
      {conflicts.map((c) => (
        <div key={c.code} role="alert" data-testid={`nl-conflict-${c.code}`}
          className="flex flex-wrap items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-[13px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          <span aria-hidden="true">!</span>
          <div className="min-w-0 flex-1"><b>{conflictTitle(c)}</b><div>{conflictSentence(c)}</div></div>
          <button type="button" className={STEP_BTN} onClick={() => remove(c.code)} data-testid={`nl-conflict-remove-${c.code}`}>Remove {c.name}</button>
        </div>
      ))}
      {refusal ? (
        <div role="alert" data-testid="nl-territory-refused"
          className={`flex flex-wrap items-start gap-2 rounded-md border p-3 text-[13px] ${refusal.kind === 'unknown' ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100' : 'border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100'}`}>
          <span aria-hidden="true">!</span>
          <div className="min-w-0 flex-1">
            <b>{refusal.kind === 'unknown' ? 'Outcome unknown.' : 'Not saved.'}</b> {refusal.message} Every country you chose is still chosen.
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 pt-4 dark:border-gray-800 max-md:sticky max-md:bottom-0 max-md:bg-white max-md:dark:bg-gray-950">
        <p className="m-0 max-w-xl text-xs text-gray-600 dark:text-gray-400" data-testid="nl-territory-note" id={`${h}-note`}>
          {plan.ok ? `${codes.length} ${codes.length === 1 ? 'country' : 'countries'} chosen. Saved to the draft when you continue.` : plan.why}
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={STEP_BTN} onClick={onBack} data-testid="nl-back">Back</button>
          <button
            type="button" className={STEP_PRIMARY} onClick={save} data-testid="nl-territory-continue"
            aria-disabled={!plan.ok || busy ? 'true' : undefined} aria-describedby={`${h}-note`} aria-busy={busy ? 'true' : undefined}
          >
            {busy ? 'Saving…' : 'Continue to commercial terms'}
          </button>
        </div>
      </div>
    </section>
  );
}
