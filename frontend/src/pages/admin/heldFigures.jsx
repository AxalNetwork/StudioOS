import React, { useEffect, useState } from 'react';
import { reportError } from '../../lib/log';
import { Unreadable, Unrecorded } from '../../ui';
import { glancesFromStudioGlance, loadStudioGlance } from './adminStudioOverview';

/**
 * D555 (#1155) — the HQ-held pages read the figures the Studio overview reads,
 * from the same glance (`GET /api/admin/studio/glance`), so a card here and
 * the overview line it opens from cannot disagree.
 *
 * `useHeldGlance()` → `{ status: 'loading' | 'unreadable' | 'ready', hq }`,
 * where `hq` is `glancesFromStudioGlance(...).hq` (accounts, approvals,
 * insights views). Off HQ there is no `hq` block, and the pages say so.
 */
export function useHeldGlance() {
  const [state, setState] = useState({ status: 'loading', hq: null });
  useEffect(() => {
    let cancelled = false;
    loadStudioGlance().then(
      (payload) => {
        if (cancelled) return;
        const g = glancesFromStudioGlance(payload, null);
        setState({ status: g.hq ? 'ready' : 'unreadable', hq: g.hq });
      },
      (e) => {
        reportError('admin-held:glance', e);
        if (!cancelled) setState({ status: 'unreadable', hq: null });
      },
    );
    return () => { cancelled = true; };
  }, []);
  return state;
}

/** The sentence for a glance that could not be read, or carried no HQ block. */
export const GLANCE_UNREADABLE = 'The Studio glance could not be read, so this is not a claim that the count is zero.';

/** One lane of the glance by its Worker key, or null. */
export function laneOf(hq, key) {
  return hq?.approvals?.kind === 'ready' ? hq.approvals.lanes.find((l) => l.key === key) || null : null;
}

const nf = (n) => Number(n).toLocaleString('en-US');

/**
 * One figure on a held card, in its four states: reading, unreadable, a number
 * (0 is a number), or not recorded with the reason.
 *
 * `value` is a number, `null` (unreadable) or `undefined` (not on the glance).
 */
export function Figure({ state, value, unit, reason, testId, children }) {
  let body;
  if (state.status === 'loading') body = <span className="text-axal-muted">Reading…</span>;
  else if (state.status === 'unreadable') body = <Unreadable what="This count" claim={GLANCE_UNREADABLE} />;
  else if (value === null) body = <Unreadable what="This count" claim={reason || 'That is not the same as zero.'} />;
  else if (value === undefined) body = <Unrecorded reason={reason} />;
  else body = <><span className="text-[16px] font-extrabold tabular-nums text-axal-ink">{nf(value)}</span>{unit ? ` ${unit}` : ''}{children}</>;
  return <p className="mt-2 text-[12.5px] text-axal-ink" data-testid={testId}>{body}</p>;
}

