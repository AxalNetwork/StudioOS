import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { spinoutLab } from '../lib/api';
import { reportError } from '../lib/log';
import { Unrecorded, Unreadable } from '../ui';
import { dateInZone } from '../lib/zoneTime';
import { ProgramPanel, ProgramPresentation } from './programs/kit';
import { programFor } from './programs/registry';
import CONTENT, { APPLY_HREF, SIGN_IN_HREF } from './programs/content/spinout-lab.js';

/**
 * `/spinout-lab/brief` — the Spin-Out Lab's public presentation (D6966, #6966; boards PGS01 to
 * PGS03 of `design/incoming/Program Spin-Out Lab Presentation Page.dc.html`). Signed out,
 * refreshable, and the page `/programs/spinout-lab` resolves to.
 *
 * It replaces the four-page print document of D141. That page's "Save as PDF" called
 * `window.print()`, so the "download" was the browser's print dialog; the PDF is now a real
 * committed file (`frontend/public/program-briefs/axal-vc-spinout-lab-v1.pdf`, built by
 * `scripts/build-program-briefs.mjs` from the same content), linked with `download`, and
 * "Print this page" stays as its own, quieter action.
 *
 * ONE READ. The availability panel reads the public `GET /api/spinout-lab/brief`: the cohort's
 * name, start, application deadline and places, the zone they are enforced in, and
 * `applications_open`. Everything else on the page is the programme's own description, in
 * `pages/programs/content/spinout-lab.js`. The PDF reads nothing live: it never prints a date or a
 * place. Download PDF works before the read answers and after it fails.
 */

const CLAIM = 'This is not a statement that applications are closed.';

/** The time of day an instant falls at in a zone ("23:59"), or null. */
function timeInZone(iso, zone) {
  if (!iso || !zone) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
  } catch {
    return null;
  }
}

/** "America/New_York" → "New York". */
const zoneCity = (zone) => (zone ? zone.split('/').pop().replace(/_/g, ' ') : null);

/**
 * The panel's state from the read (PGS02): `loading` while it is in flight, `unavailable` when
 * it failed, `closed` when it answered that nothing is open, otherwise `open` with each field
 * as read, a missing one as null (drawn "Not recorded", never 0). Pure, for the tests.
 */
export function labPanelState(read) {
  if (read.status === 'loading') return { state: 'loading' };
  if (read.status === 'error') return { state: 'unavailable' };
  const d = read.data || {};
  if (d.applications_open !== true) return { state: 'closed' };
  const c = d.cohort || {};
  const zone = d.zone || null;
  const places = Number.isInteger(c.places) && c.places > 0 ? c.places : null;
  return {
    state: 'open',
    name: c.name || null,
    starts: dateInZone(c.start_date, zone),
    applyBy: dateInZone(c.close_at, zone),
    closesAt: timeInZone(c.close_at, zone),
    city: zoneCity(zone),
    places,
    placesReason: d.places_unreadable ? 'The cohort size setting could not be read.' : 'No cohort size is set.',
  };
}

/** The words on the Apply action: the cohort the read named, or the next one. */
export const applyLabel = (s) => (s.state === 'open' && s.name ? `Apply to ${s.name} →` : 'Apply to the next cohort →');

const NOT_READ = 'The cohort record did not name it.';

function Row({ k, v, reason }) {
  return (
    <div className="pgs-coh-r">
      <dt>{k}</dt>
      <dd>{v === null || v === undefined || v === '' ? <Unrecorded reason={reason} /> : v}</dd>
    </div>
  );
}

/** The cohort card inside the panel, in each of PGS02's states. */
function Cohort({ s, onRetry }) {
  const k = <div className="pgs-coh-k">Next cohort</div>;
  if (s.state === 'loading') {
    return (
      <div className="pgs-coh" aria-busy="true" data-testid="lab-panel-loading">
        <span className="sr-only">Loading the cohort dates</span>
        {k}
        <dl>
          {['Cohort', 'Starts', 'Apply by', 'Places'].map((l, i) => (
            <div className="pgs-coh-r" key={l}><dt>{l}</dt><dd><span className="pgs-skel" style={{ width: [120, 92, 100, 28][i] }} /></dd></div>
          ))}
        </dl>
      </div>
    );
  }
  if (s.state === 'unavailable') {
    return (
      <div className="pgs-coh" data-testid="lab-panel-unavailable">
        {k}
        <div className="pgs-coh-err">
          <Unreadable what="The cohort dates" claim={CLAIM} onRetry={onRetry} size="block" />
        </div>
      </div>
    );
  }
  if (s.state === 'closed') {
    return (
      <div className="pgs-coh" data-testid="lab-panel-closed">
        {k}
        <p className="pgs-coh-msg"><b>Applications are closed.</b> The next cohort date is not set yet.</p>
      </div>
    );
  }
  return (
    <div className="pgs-coh" data-testid="lab-panel-open">
      {k}
      <dl>
        <Row k="Cohort" v={s.name} reason={NOT_READ} />
        <Row k="Starts" v={s.starts} reason={NOT_READ} />
        <Row k="Apply by" v={s.applyBy} reason={NOT_READ} />
        <Row k="Places" v={s.places} reason={s.placesReason} />
      </dl>
      {s.closesAt && s.city ? <p className="pgs-coh-note">{`Applications close at ${s.closesAt} ${s.city} time.`}</p> : null}
    </div>
  );
}

/** PGS02: the Lab's availability panel. Closed has no Apply; a failed read keeps Apply, because the Worker picks the cohort. */
export function LabAvailabilityPanel({ program, s, onRetry }) {
  const action = s.state === 'closed'
    ? (
      <p className="pgs-panel-fine">
        Nothing is open to apply for right now; the next cohort appears here when it is set. You can use StudioOS on your own meanwhile:{' '}
        <Link to="/for-founders" className="pgs-panel-link">For founders →</Link>
      </p>
    )
    : (
      <>
        <Link to={APPLY_HREF} className="ax-btn ax-btn-lg ax-btn-bright" data-testid="lab-panel-apply">{applyLabel(s)}</Link>
        <p className="pgs-panel-fine">
          You create a free account first. Already a member?{' '}
          <Link to={SIGN_IN_HREF} className="pgs-panel-link" data-testid="lab-panel-signin">Sign in</Link>
        </p>
      </>
    );
  return (
    <ProgramPanel program={program} action={action}>
      <Cohort s={s} onRetry={onRetry} />
    </ProgramPanel>
  );
}

/** The page's sections, with the Next step band's Apply removed while nothing is open (PGS02B). */
export function contentFor(s) {
  if (s.state !== 'closed') return CONTENT;
  return { ...CONTENT, next: { ...CONTENT.next, actions: CONTENT.next.actions.filter((a) => a.id !== 'apply') } };
}

export default function SpinoutLabBriefPage() {
  const program = programFor('spinout-lab');
  const [read, setRead] = useState({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => { setRead({ status: 'loading' }); setAttempt((a) => a + 1); }, []);

  useEffect(() => {
    let alive = true;
    spinoutLab.brief()
      .then((data) => { if (alive) setRead({ status: 'ok', data }); })
      .catch((e) => {
        if (!alive) return;
        setRead({ status: 'error' });
        reportError('SpinoutLabBriefPage:load', e);
      });
    return () => { alive = false; };
  }, [attempt]);

  const s = labPanelState(read);
  return (
    <ProgramPresentation
      program={program}
      content={contentFor(s)}
      labels={{ apply: applyLabel(s) }}
      panel={<LabAvailabilityPanel program={program} s={s} onRetry={retry} />}
      testId="spinout-brief-page"
    />
  );
}
