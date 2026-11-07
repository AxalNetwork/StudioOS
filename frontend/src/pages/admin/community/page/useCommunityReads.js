/**
 * #4717 package 6 — THE PAGE'S ONE READ, the Community overview for the period (#4717 package 2), checked against its contract (package 6).
 * Split out of AdminCommunity.jsx; nothing here decides anything.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { communityApi } from '../../../../lib/api/community';
import { reportError } from '../../../../lib/log';
import { idle } from './parts';

/**
 * #4717 package 2: THE PAGE'S ONE READ, the Community overview for the period,
 * and every figure and row on the page under its `as_of`. Recent activity reads
 * its own rows. The Studio glance, the events and jobs lists, the analytics and
 * the circles list are the lightboxes' and consoles' reads, not this page's.
 * `reload()` reads it again.
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
