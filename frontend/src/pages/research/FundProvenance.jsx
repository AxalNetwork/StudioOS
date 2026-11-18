/**
 * D7167 (#7167) — the pieces the fund Sheet and the full profile share
 * (FND-P01 to FND-P03): the source card with its three dates, the proposed
 * fields with their own sources, the manager's vehicles by label, and the
 * size chart of this vehicle alone. Read from `fundProfileRead.js`; nothing
 * here computes a figure the Worker did not return.
 */
import React from 'react';
import { ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { NOT_RECORDED } from './researchStates.js';
import { UNAVAILABLE, datesOf, historyView, listOf, proposedRows, sourceChip } from './fundProfileRead.js';

const DT = 'text-[10px] font-extrabold uppercase tracking-[.08em] text-axal-faint dark:text-gray-400';
const FAINT = 'text-[11.5px] text-axal-faint dark:text-gray-400';

/** A state chip: Not recorded, Unavailable or Withdrawn, each with a non-colour cue. */
export function StateChip({ kind = 'nr', children }) {
  const tone = kind === 'un'
    ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300'
    : kind === 'rf'
      ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200'
      : 'border-axal-hairline bg-axal-ground text-axal-muted dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300';
  const mark = kind === 'un' ? '!' : kind === 'rf' ? '⊘' : null;
  const word = children || (kind === 'un' ? UNAVAILABLE : kind === 'rf' ? 'Withdrawn' : NOT_RECORDED);
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-bold ${tone}`}>
      {mark ? <span aria-hidden="true">{mark}</span> : null}{word}
    </span>
  );
}

/** The chip on a figure: publisher and reported date, linked to the list. */
export function SourceChip({ provenance }) {
  const text = sourceChip(provenance);
  if (!text) return null;
  const { href } = listOf(provenance);
  const cls = 'inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-800 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-200';
  return href
    ? <a href={href} target="_blank" rel="noreferrer" className={cls} data-testid="fund-source-chip">{text}</a>
    : <span className={cls} data-testid="fund-source-chip">{text}</span>;
}

/** Reported, Imported on and Source use reviewed: three dates, never merged. */
export function ThreeDates({ provenance }) {
  return (
    <dl className="grid gap-2 sm:grid-cols-3" data-testid="fund-three-dates">
      {datesOf(provenance).map((d) => (
        <div key={d.key} className="rounded-lg border border-axal-hairline px-3 py-2 dark:border-gray-800">
          <dt className={DT}>{d.label}</dt>
          <dd className="m-0 font-mono text-[12.5px] font-semibold text-axal-ink dark:text-gray-100">{d.text}</dd>
          <dd className={`m-0 ${FAINT}`}>{d.hint}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The source card (FND-P02): the list, its publisher and terms, the three dates and the link. */
export function SourceDatesCard({ provenance, reason = null }) {
  const l = listOf(provenance);
  return (
    <div data-testid="fund-provenance-card" className="space-y-2 rounded-lg border border-axal-hairline bg-axal-ground p-3 dark:border-gray-800 dark:bg-gray-900">
      <div className={DT}>Source</div>
      <div className="text-[12.5px] font-semibold text-axal-ink dark:text-gray-100">{l.title || NOT_RECORDED}</div>
      <div className="text-[11.5px] text-axal-muted dark:text-gray-400">Published by {l.publisher || NOT_RECORDED} · Terms: <span className="font-semibold">{l.terms}</span></div>
      {reason ? <div className={FAINT}>{reason}</div> : null}
      <ThreeDates provenance={provenance} />
      {l.href ? (
        <a href={l.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] font-semibold text-axal-violet dark:text-violet-300">
          View the list <ExternalLink size={12} aria-hidden="true" /><span className="sr-only"> (opens the publisher’s page in a new tab)</span>
        </a>
      ) : null}
    </div>
  );
}

/** The proposed fields, each with its source chip or the reason it is not recorded. */
export function ProposedFields({ proposed, keys }) {
  return (
    <dl className="grid grid-cols-[minmax(120px,auto)_minmax(0,1fr)] items-baseline gap-x-4 gap-y-3 text-[12.5px]" data-testid="fund-proposed-fields">
      {proposedRows(proposed, keys).map((r) => (
        <React.Fragment key={r.key}>
          <dt className={DT}>{r.label}</dt>
          <dd className="m-0">
            {r.state === 'recorded'
              ? <><span className="font-semibold text-axal-ink dark:text-gray-100">{r.text}</span> <SourceChip provenance={r.provenance} /></>
              : <><StateChip kind={r.state === 'unavailable' ? 'un' : 'nr'} /><span className={`mt-1 block ${FAINT}`}>{r.reason}</span></>}
          </dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

/**
 * The manager's vehicles by label (FND-P02) and the size of this vehicle
 * alone. Each line is a separate vehicle; sizes are never added up or drawn
 * as one line.
 */
export function VehicleHistory({ history, item, profileHref = null }) {
  const v = historyView(history, item);
  const max = Math.max(1, ...v.observations.rows.map((o) => o.cents));
  return (
    <div className="space-y-4">
      <section aria-labelledby="fund-vehicles-h" data-testid="fund-vehicle-history">
        <h2 id="fund-vehicles-h" className="text-sm font-extrabold tracking-tight">{v.manager ? `Vehicles by ${v.manager}` : 'Vehicles by this manager'}</h2>
        {v.vehicles.state === 'ok' ? (
          <ul className="mt-2 divide-y divide-axal-hairline dark:divide-gray-800">
            {v.vehicles.rows.map((r) => (
              <li key={r.uid} className="flex flex-wrap items-baseline justify-between gap-2 py-1.5 text-[12.5px]">
                <span className="font-semibold">{r.label}</span>
                <span className="font-mono">{r.size ? `${r.size} ${r.currency}` : NOT_RECORDED}</span>
                <span className={FAINT}>{r.reported ? `reported ${r.reported}` : 'reported date not recorded'}</span>
                {r.current
                  ? <span className="text-[11px] font-bold text-violet-800 dark:text-violet-200">This vehicle</span>
                  : profileHref ? <Link to={profileHref(r.uid)} className="text-[12px] font-semibold text-axal-violet underline dark:text-violet-300">Open<span className="sr-only"> {r.label}</span></Link> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-axal-muted dark:text-gray-400">
            <StateChip kind={v.vehicles.state === 'unavailable' ? 'un' : 'nr'} />{v.vehicles.state === 'unavailable' ? 'The manager’s vehicles could not be read just now.' : v.vehicles.reason}
          </p>
        )}
        <p className={`mt-1 ${FAINT}`}>Each line is a separate vehicle, labelled as the list labels it. Sizes are never added up or drawn as one line.</p>
      </section>
      <section aria-labelledby="fund-obs-h" data-testid="fund-vehicle-observations">
        <h2 id="fund-obs-h" className="text-sm font-extrabold tracking-tight">Reported size of this vehicle</h2>
        {v.observations.state === 'unavailable' ? (
          <p className="mt-2 flex items-center gap-2 text-[12px] text-axal-muted"><StateChip kind="un" /> The reported sizes could not be read just now.</p>
        ) : v.observations.rows.length ? (
          <ul className="mt-2 space-y-1.5" aria-label={`Reported size of ${v.observations.name}, ${v.observations.rows.length} ${v.observations.rows.length === 1 ? 'observation' : 'observations'}`}>
            {v.observations.rows.map((o) => (
              <li key={o.key} className="grid grid-cols-[96px_minmax(0,1fr)_auto] items-center gap-2 text-[12px]">
                <span className="font-mono text-axal-muted">{o.when || NOT_RECORDED}</span>
                <span className="h-2 rounded bg-violet-600" style={{ width: `${Math.max(2, (o.cents / max) * 100)}%` }} aria-hidden="true" />
                <span className="font-mono font-semibold">{o.text} {o.currency}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 flex items-center gap-2 text-[12px] text-axal-muted"><StateChip /> No size of this vehicle is recorded.</p>
        )}
        <p className={`mt-1 ${FAINT}`}>
          Only observations of {v.observations.name} are plotted{v.observations.rows.length === 1 ? '; with one observation there is no line' : ''}. Other vehicles are not added to it.
          {v.observations.unlabelled ? ` ${v.observations.unlabelled} older ${v.observations.unlabelled === 1 ? 'report names' : 'reports name'} no vehicle, so ${v.observations.unlabelled === 1 ? 'it is' : 'they are'} not shown here.` : ''}
        </p>
      </section>
    </div>
  );
}
