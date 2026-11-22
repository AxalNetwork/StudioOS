/**
 * D6966 (#6966, PGS07) — the admin entry points to a program's presentation, drawn once and
 * derived from the presentation map, so a program gains them by its map entry alone:
 *
 *   - `PresentationName`: on /admin/programs, a built-in program's name on a desktop row, a card
 *     or a phone row is a link to its public presentation (same tab), when it has one;
 *   - `manageDoor`: that program's existing "Open" door reads "Manage program" ("Manage" on a
 *     phone row), going where it went;
 *   - `ViewPresentationLink`: the program's admin page header gains "View presentation".
 *
 * A program with no map entry is drawn exactly as before.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Presentation } from 'lucide-react';
import { programFor } from './registry';

// D7121/#7116: global Wellness may retain an existing key or use a collision-safe seed key.
// Match the same recorded global identity as the seed; a studio row is independent.
function presentationFor(programKey, registryRow) {
  if (registryRow) {
    const wellness = registryRow.studio_only === null && ['wellness', 'wellbeing'].includes(String(registryRow.name || '').trim().toLowerCase());
    if (wellness) return programFor('wellness');
    if (programKey === 'wellness') return null;
  }
  return programFor(programKey);
}

const NAME = 'inline-flex min-h-[32px] items-center gap-1.5 text-violet-800 underline decoration-1 underline-offset-[3px] hover:text-violet-900 dark:text-violet-300 dark:hover:text-violet-200';
const HINT = 'font-mono text-[10.5px] font-semibold text-axal-muted dark:text-gray-400';
const PRES = 'inline-flex min-h-[44px] items-center justify-center gap-[7px] whitespace-nowrap rounded-[9px] border border-violet-300 bg-violet-50 px-3 text-[13px] font-bold text-violet-800 hover:bg-violet-100 sm:min-h-[36px] dark:border-violet-700 dark:bg-violet-950/40 dark:text-violet-200 dark:hover:bg-violet-900/40';

/**
 * A program's name: a link to its presentation when the map has one, else the plain name.
 * `hint` adds the canvas's "Opens the presentation · <address>" line under it.
 */
export function PresentationName({ programKey, name, className = '', hint = false, registryRow = null }) {
  const program = presentationFor(programKey, registryRow);
  if (!program) return <span className={className}>{name}</span>;
  return (
    <span className="inline-flex flex-col gap-0.5">
      <Link to={program.canonical} className={`${NAME} ${className}`.trim()} aria-label={`${name}, presentation`} data-testid={`programs-presentation-${programKey}`}>
        {name}<ArrowUpRight size={13} aria-hidden="true" />
      </Link>
      {hint ? <span className={HINT}>{`Opens the presentation · ${program.canonical}`}</span> : null}
    </span>
  );
}

/**
 * The catalogue's door for a program with a presentation: each `Open` link inside it reads
 * "Manage program" (or `label`), keeping its address, test id and style. Other doors pass through.
 */
export function manageDoor(door, programKey, name, label = 'Manage program', registryRow = null) {
  if (!door || !presentationFor(programKey, registryRow)) return door;
  const relabel = (el) => {
    if (!React.isValidElement(el)) return el;
    if (el.type === React.Fragment) return React.cloneElement(el, {}, React.Children.map(el.props.children, relabel));
    if (el.props.children === 'Open') {
      return React.cloneElement(el, { 'aria-label': `Manage program: ${name}`, className: `${el.props.className || ''} whitespace-nowrap`.trim() }, label);
    }
    return el;
  };
  return relabel(door);
}

/** "View presentation" for a program's admin page header; nothing when the program has none. */
export function ViewPresentationLink({ programKey, full = false, registryRow = null }) {
  const program = presentationFor(programKey, registryRow);
  if (!program) return null;
  return (
    <Link to={program.canonical} className={`${PRES}${full ? ' w-full' : ''}`} data-testid="programs-view-presentation">
      <Presentation size={14} aria-hidden="true" />View presentation<ArrowUpRight size={14} aria-hidden="true" />
    </Link>
  );
}
