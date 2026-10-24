import React from 'react';
import { Link } from 'react-router-dom';
import { GradeDot } from '../pitch/SourcesBoards';
import { LEGEND_SOURCES } from '../pitch/sourcesModel';
import { CLAIM_STATES } from './storyModel';

/**
 * D910 (#2694) — NAR21, the Story's components, light and dark: the bound-
 * figure chip (normal, stale, missing), the five claim pills, the section
 * dots, the five source chips and the grade ramp. A component reaches a page
 * only with a read behind it: the claim pills other than "Founder's figure"
 * and the Mismatch dot are drawn here and nowhere else until #2430's claim
 * check states them.
 */

const MUTED = 'text-axal-muted dark:text-gray-400';
const INK = 'text-axal-ink dark:text-gray-100';

const PILL_TONE = {
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300',
  note: 'border-axal-lavender-edge bg-axal-lavender text-axal-violet dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300',
  bad: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300',
  grey: 'border-dashed border-gray-300 bg-axal-ground text-axal-muted dark:border-gray-600 dark:bg-gray-800 dark:text-gray-400',
  warn: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300',
};

/** One of the five claim states, as a pill. */
export function ClaimPill({ state }) {
  const s = CLAIM_STATES[state];
  if (!s) return null;
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-1.5 py-[1px] align-middle text-[10.5px] font-bold ${PILL_TONE[s.tone]}`} data-testid="claim-pill">
      <span aria-hidden="true">{s.icon}</span>{state}
    </span>
  );
}

const DOT = {
  Empty: 'bg-gray-300 dark:bg-gray-600',
  Written: 'bg-axal-violet dark:bg-violet-400',
  Stale: 'bg-amber-500',
  Mismatch: 'bg-red-700 dark:bg-red-400',
};

/** A section's state dot, with its word for a screen reader. */
export function SectionDot({ state }) {
  return <span role="img" aria-label={state} title={state} className={`mt-[5px] inline-block h-[9px] w-[9px] flex-none rounded-full ${DOT[state] || DOT.Empty}`} data-testid={`section-dot-${state}`} />;
}

const SOURCE_TEXT = {
  Connector: 'text-sky-700 dark:text-sky-300',
  Document: 'text-amber-800 dark:text-amber-300',
  Recorded: 'text-emerald-700 dark:text-emerald-300',
  Signed: 'text-axal-violet dark:text-violet-300',
  Typed: 'text-axal-muted dark:text-gray-400',
};

/** One of the five source chips: the source's icon and word. */
export function SourceKind({ source }) {
  const s = LEGEND_SOURCES.find((x) => x.id === source);
  if (!s) return null;
  return <span title={s.line} className={`font-mono text-[10.5px] font-bold ${SOURCE_TEXT[source]}`}>{s.icon} {source}</span>;
}

/** The grade ramp: four filled steps, strongest first, then the dashed gap. */
export function GradeRamp() {
  return (
    <span className={`inline-flex flex-wrap items-center gap-2.5 font-mono text-[10.5px] ${MUTED}`} data-testid="grade-ramp">
      {['Measured', 'Reviewed', 'Sourced', 'Stated', 'Not recorded'].map((g) => (
        <span key={g} className="inline-flex items-center gap-1"><GradeDot grade={g} />{g}</span>
      ))}
    </span>
  );
}

const CHIP_BOX = {
  normal: 'border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900',
  stale: 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30',
  missing: 'border-dashed border-gray-300 bg-axal-ground dark:border-gray-600 dark:bg-gray-800',
};

/**
 * A bound figure (NAR21): the record's value with its Source, date and grade;
 * Stale says since when; Missing says where to add it. `onRemove` draws the
 * remove control in the editor; it is a draft change, saved with Save version.
 */
export function BoundFigure({ figure, onRemove }) {
  const c = figure.chip;
  return (
    <span className={`inline-flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-[8px] border px-2 py-1 align-middle ${CHIP_BOX[figure.state]}`}
      title={c?.title || figure.note || undefined} data-testid={`bound-figure-${figure.state}`}>
      <span className={`text-[11.5px] font-semibold ${INK}`}>{figure.label}</span>
      {figure.value ? <span className={`font-mono text-[11.5px] font-bold ${INK}`}>{figure.value}</span> : null}
      {c ? (
        <span className={`inline-flex flex-wrap items-center gap-1 font-mono text-[10.5px] ${MUTED}`}>
          <SourceKind source={c.source} /><span>· {c.record}</span>{c.date ? <span>· {c.date}</span> : null}
          <span className="inline-flex items-center gap-1">· <GradeDot grade={c.grade} />{c.grade}</span>
        </span>
      ) : null}
      {figure.note ? <span className={`text-[11px] font-semibold ${figure.state === 'stale' ? 'text-amber-800 dark:text-amber-300' : MUTED}`}>{figure.note}</span> : null}
      {figure.fill ? <Link to={figure.fill.href} className="text-[11px] font-semibold text-axal-violet hover:text-axal-violet-deep dark:text-violet-300">{figure.fill.text}</Link> : null}
      {onRemove ? (
        <button type="button" onClick={onRemove} aria-label={`Remove ${figure.label}`} className={`ml-0.5 text-[12px] leading-none ${MUTED} hover:text-axal-ink dark:hover:text-gray-100`}>×</button>
      ) : null}
    </span>
  );
}

/** A typed number, underlined, with its claim pill. */
export function TypedClaim({ text, state }) {
  return (
    <span className="whitespace-nowrap" data-testid="typed-claim">
      <span className="border-b-2 border-amber-300 font-mono font-bold dark:border-amber-500">{text}</span>
      <span className="mx-1"><ClaimPill state={state} /></span>
    </span>
  );
}
