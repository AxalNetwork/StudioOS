/**
 * #4717 package 6 — THE PAGE'S ONE READ, the Community overview for the period (#4717 package 2), checked against its contract (package 6).
 * Split out of AdminCommunity.jsx; nothing here decides anything.
 */
import { useCallback, useEffect, useState } from 'react';
import { communityApi } from '../../../../lib/api/community';
import { reportError } from '../../../../lib/log';
import { checkOverview } from '../model/contract.js';
import { idle } from './parts';

/**
 * #4717 package 2: THE PAGE'S ONE READ, the Community overview for the period,
 * and every figure and row on the page under its `as_of`. Recent activity reads
 * its own rows. The Studio glance, the events and jobs lists, the analytics and
 * the circles list are the lightboxes' and consoles' reads, not this page's.
 * `reload()` reads it again.
 *
 * #4717 package 6: every answer is checked against the read's contract
 * (`model/contract.js`). A block that breaks it is still drawn as unreadable
 * by its builder; the paths that broke it go to the error log (paths only,
 * never a value), so a drift between the worker and the page is seen, not
 * just survived.
 */
export function useCommunityReads(weeks) {
  const [reads, setReads] = useState({ overview: idle });
  const [asOf, setAsOf] = useState(null);
  const [tick, setTick] = useState(0);

  // D931's Community read: the period figures. A new period reads it alone again.
  useEffect(() => {
    let live = true;
    setReads((r) => ({ ...r, overview: idle }));
    communityApi.overview({ weeks }).then(
      (data) => {
        if (!live) return;
        if (!data || !data.blocks || Number(data.weeks) !== weeks) {
          reportError('admin-community:overview', new Error('The Community read answered another shape or period'));
          setReads((r) => ({ ...r, overview: { status: 'error', data: null } }));
          return;
        }
        const problems = checkOverview(data);
        if (problems.length) reportError('admin-community:contract', new Error(`The Community read broke its contract at ${problems.length} place(s): ${problems.slice(0, 8).join('; ')}`));
        setReads((r) => ({ ...r, overview: { status: 'ready', data } }));
        setAsOf(Date.now());
      },
      (e) => { reportError('admin-community:overview', e); if (live) setReads((r) => ({ ...r, overview: { status: 'error', data: null } })); },
    );
    return () => { live = false; };
  }, [tick, weeks]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { reads, asOf, reload, tick };
}
