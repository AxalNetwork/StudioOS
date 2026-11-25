/**
 * D6992 (#6992) — the Spin-Out Lab's programme card, one component for both
 * public surfaces that list programmes: `/events` (its Programs row) and the
 * Resources hub's "Programs & events" panel. Before #6992 the card lived in
 * `pages/events/PublicEventsPage.jsx` and the hub drew no card at all, so the
 * hub said "Nothing is scheduled right now." while `/events` showed an open
 * cohort.
 *
 * Fed by the cohort read and nothing typed: the cohort record from the public
 * `GET /spinout-lab/brief` (`useCohortRecord`, read once by the page and passed
 * in as `read`) for its name, start and application deadline, and its places
 * through `placesFromRecord`, the pure half of `useCohortPlaces`. A field the
 * record leaves blank reads "Not recorded" (`ui/Honesty.jsx`); it is never
 * left out, guessed or drawn as 0. The length is the Lab's sprint, computed
 * from `COHORT_WEEKS`.
 *
 * `LabProgramSlot` draws the card's slot in its read state: a loading line,
 * the card for an open cohort, the programmes' own empty line when no cohort
 * is open, or "Unavailable. We could not load the open cohort." with Try
 * again when the read failed. A failed read is never the empty line.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { DataState, Unrecorded } from '../../ui/Honesty';
import { COHORT_WEEKS, placesFromRecord } from '../../lib/spinoutLab';
import { studioLicenceEnquiryPath } from '../../lib/siteFirm';
import { numberWord } from '../../lib/numberWords';
import '../../pages/site/network2.css';

/** The Lab's sprint length, computed from the cohort timing the Worker runs. */
const COHORT_DAYS = COHORT_WEEKS * 7;

/** The programmes' empty line: the cohort read answered, and no cohort is open. */
export const PROGRAMS_EMPTY = 'No programme is open for applications right now.';

/** The line a failed cohort read draws, after "Unavailable". */
export const PROGRAMS_UNAVAILABLE = 'We could not load the open cohort.';

/** True when a cohort read (`useCohortRecord`'s value) holds an open, named cohort. */
export function hasOpenCohort(read) {
  return read?.status === 'ok' && Boolean(read.cohort?.open && read.cohort?.name);
}

/** One fact's value, or "Not recorded" when the record leaves it blank. */
function Fact({ k, v }) {
  return (
    <div>
      <dt>{k}</dt>
      {v == null || v === '' ? <dd><Unrecorded /></dd> : <dd className="ax-mono">{v}</dd>}
    </div>
  );
}

/** The card for an open cohort. `read` is `useCohortRecord`'s value with status 'ok'. */
export function LabProgramCard({ read }) {
  const cohort = read?.cohort || {};
  const places = placesFromRecord(read);
  return (
    <article className="ax-card ax-n2-program" data-testid="lab-program-card">
      <span className="ax-chip ax-n2-chip-green">Applications open</span>
      <h3 className="ax-n2-program-t">Spin-Out Lab · {cohort.name}</h3>
      <p className="ax-n2-program-d">
        {/* #6990: what the programme is, never what it promises. */}
        A {numberWord(COHORT_WEEKS)}-week programme for founders testing an idea or a new product. By application.
      </p>
      <dl className="ax-n2-facts">
        <Fact k="Starts" v={cohort.startLabel} />
        <Fact k="Applications close" v={cohort.deadlineLabel} />
        <Fact k="Duration" v={`${COHORT_DAYS} days`} />
        <Fact k="Places" v={places.status === 'ok' ? String(places.places) : null} />
      </dl>
      <Link to="/spinout-lab/apply" className="ax-btn ax-btn-primary ax-n2-program-cta">
        Apply to {cohort.name}
      </Link>
      <Link to={studioLicenceEnquiryPath('spinout-lab')} className="ax-n2-textlink">
        Ask about running the Lab at your studio
      </Link>
    </article>
  );
}

/**
 * The card's slot in its read state. `lineClass` is the surface's own class
 * for a one-sentence line (`ax-nw-empty` on the hub, `ax-empty` on `/events`);
 * `wrap` puts the card in the surface's grid or padding.
 */
export function LabProgramSlot({ read, lineClass = 'ax-nw-empty', wrap = (card) => card }) {
  const status = read?.status || 'loading';
  if (status === 'loading') return <p className={lineClass}>Loading…</p>;
  if (status !== 'ok') {
    return (
      <div className={lineClass} data-testid="lab-program-unavailable">
        <DataState state="unavailable" claim={PROGRAMS_UNAVAILABLE} onRetry={read?.retry} retryLabel="Try again" />
      </div>
    );
  }
  if (!hasOpenCohort(read)) return <p className={lineClass} data-testid="lab-program-empty">{PROGRAMS_EMPTY}</p>;
  return wrap(<LabProgramCard read={read} />);
}
