// D964 (#2797, Programs part 11) — PG14's Basics and How it runs fields
// (dc:463-464), shared by Propose a program and HQ's New program dialog, which
// takes the same two steps (D955 §5). Choices are toggle chips, each a button
// with `aria-pressed`; text fields are labelled inputs. `form` is
// proposalsModel's shape and `set(patch)` merges into it.
import React from 'react';
import { INPUT, SUB } from './parts';
import {
  CYCLE_LINE, JOIN_METHODS, PROPOSAL_GROUPS, WHO_WORDS, toggleWord,
} from './proposalsModel';

const EYEBROW = 'text-[11px] font-bold uppercase tracking-[.06em] text-axal-muted dark:text-gray-400';
const CHIP = 'inline-flex min-h-[32px] items-center gap-1 rounded-full border px-3 text-[12.5px] font-semibold';
const CHIP_ON = 'border-axal-lavender-edge bg-axal-lavender text-axal-violet dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-300';
const CHIP_OFF = 'border-axal-hairline bg-white text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';

export function Field({ label, children, testId }) {
  return (
    <label className="flex flex-col gap-1" data-testid={testId}>
      <span className={EYEBROW}>{label}</span>
      {children}
    </label>
  );
}

/** A row of toggle chips: `multi` toggles each through `toggle`, otherwise one is chosen (and chosen again clears it). */
export function ChipGroup({ label, options, value, onChange, multi = false, toggle = toggleWord, testId, disabled = false }) {
  const on = (o) => (multi ? value.includes(o) : value === o);
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-1.5" data-testid={testId}>
      <span className={EYEBROW}>{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button key={o} type="button" aria-pressed={on(o)} disabled={disabled}
            onClick={() => onChange(multi ? toggle(value, o) : (value === o ? null : o))}
            className={`${CHIP} ${on(o) ? CHIP_ON : CHIP_OFF}`} data-testid={`${testId}-${o}`}>
            {on(o) ? <span aria-hidden="true">✓</span> : null}{o}
          </button>
        ))}
      </div>
    </div>
  );
}

export function BasicsFields({ form, set, prefix, disabled = false }) {
  return (
    <div className="flex flex-col gap-3">
      <Field label="Name">
        <input value={form.name} onChange={(e) => set({ name: e.target.value })} maxLength={120} disabled={disabled} className={INPUT} data-testid={`${prefix}-name`} />
      </Field>
      <Field label="One-line purpose">
        <input value={form.purpose} onChange={(e) => set({ purpose: e.target.value })} maxLength={300} disabled={disabled} className={INPUT} data-testid={`${prefix}-purpose`} />
      </Field>
      <ChipGroup label="Who it is for" options={WHO_WORDS} value={form.who} multi disabled={disabled} onChange={(who) => set({ who })} testId={`${prefix}-who`} />
      <ChipGroup label="Group" options={PROPOSAL_GROUPS} value={form.group} disabled={disabled} onChange={(group) => set({ group })} testId={`${prefix}-group`} />
    </div>
  );
}

export function HowItRunsFields({ form, set, prefix, disabled = false }) {
  return (
    <div className="flex flex-col gap-3">
      <ChipGroup label="Join method" options={JOIN_METHODS} value={form.join_method} disabled={disabled} onChange={(join_method) => set({ join_method })} testId={`${prefix}-join`} />
      <div className="flex flex-col gap-1.5">
        <ChipGroup label="Cycle" options={['Rolling', 'Cohorts']} disabled={disabled}
          value={form.cycle === 'rolling' ? 'Rolling' : form.cycle === 'cohorts' ? 'Cohorts' : null}
          onChange={(v) => set({ cycle: v === 'Rolling' ? 'rolling' : v === 'Cohorts' ? 'cohorts' : null })} testId={`${prefix}-cycle`} />
        {form.cycle === 'cohorts' ? (
          <Field label="Weeks in a cohort">
            <input type="number" min={1} max={52} inputMode="numeric" value={form.cohort_weeks} disabled={disabled} onChange={(e) => set({ cohort_weeks: e.target.value })} className={`${INPUT} w-28 font-mono`} data-testid={`${prefix}-weeks`} />
          </Field>
        ) : null}
        <span className={SUB} data-testid={`${prefix}-cycle-line`}>{CYCLE_LINE}</span>
      </div>
      <Field label="Seats">
        <input type="number" min={1} inputMode="numeric" value={form.seats} disabled={disabled} onChange={(e) => set({ seats: e.target.value })} className={`${INPUT} w-28 font-mono`} data-testid={`${prefix}-seats`} />
      </Field>
      <Field label="Eligibility">
        <textarea rows={3} value={form.eligibility} disabled={disabled} maxLength={1000} onChange={(e) => set({ eligibility: e.target.value })} className={`${INPUT} py-2`} data-testid={`${prefix}-eligibility`} />
      </Field>
    </div>
  );
}

export { EYEBROW, CHIP, CHIP_ON, CHIP_OFF };
