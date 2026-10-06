/**
 * D556 — the Worker AI rail on Admin Studio.
 *
 * The admin home was the one Admin page with no rail. Its coverage is the
 * studio glance (D443), the one read the needs-a-decision strip and the cards
 * already render from, so the rail can only say what those two read. It does
 * not make a read of its own either: `loadStudioGlance` shares one in-flight
 * request between every caller on the page, so this adds no request.
 *
 * Each line says how one block of the glance answered, in the words the page
 * uses for it: read, not recorded here, or could not be read. A block that is
 * not on this tier's glance draws no line rather than a line that claims it.
 */
import { useEffect, useState } from 'react';
import { WorkerRail } from '../../ui';
import { reportError } from '../../lib/log';
import { glancesFromStudioGlance, loadStudioGlance, UNAVAILABLE } from './adminStudioOverview';

const STATE = {
  ready: 'read',
  empty: 'read',
  unrecorded: 'not recorded here',
  unreadable: 'could not be read',
};

/** One coverage line per block of the glance, or none for a block the tier does not carry. */
export function studioRailCoverage(g) {
  if (!g) return [];
  const blocks = g.hq
    ? [
      ['Accounts', g.hq.accounts],
      ['Approvals', g.hq.approvals],
      ['Programme clock', g.programme],
      ['Template library', g.contracts],
      ['Insights', g.hq.insights],
    ]
    : [
      ['Seats', g.seats],
      ['Approvals', g.approvals],
      ['Programme clock', g.programme],
      ['Template library', g.contracts],
      ['Agreements ending', g.contracts?.agreements],
      ['Share rate', g.insights?.share],
    ];
  return blocks
    .filter(([, view]) => view && STATE[view.kind])
    .map(([label, view]) => `${label}: ${STATE[view.kind]}`);
}

export default function StudioRail({ user, glance: glanceProp }) {
  const [fetched, setFetched] = useState(null);
  useEffect(() => {
    if (glanceProp !== undefined) return undefined;
    let cancelled = false;
    loadStudioGlance().then(
      (value) => { if (!cancelled) setFetched(value); },
      (e) => {
        reportError('admin-studio:rail', e);
        if (!cancelled) setFetched(UNAVAILABLE);
      },
    );
    return () => { cancelled = true; };
  }, [glanceProp]);
  const glance = glanceProp === undefined ? fetched : glanceProp;
  const failed = glance === UNAVAILABLE;
  const coverage = glance && !failed ? studioRailCoverage(glancesFromStudioGlance(glance, user)) : [];
  return (
    <WorkerRail
      workspace="Studio"
      role="admin"
      stance="Read-only summary"
      note="This rail summarises the studio glance: the one read the needs-a-decision strip and the cards below render from. It takes no action."
      coverage={coverage}
      coverageNote={glance == null ? 'Loading…' : failed ? 'The studio glance could not be read.' : undefined}
      data-testid="admin-studio-rail"
    />
  );
}
