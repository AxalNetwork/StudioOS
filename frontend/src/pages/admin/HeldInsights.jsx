import React from 'react';
import { Card } from '../../ui';
import HeldZone from './HeldZone';

/**
 * Admin · Insights on HQ-held accounts — S20's row, which links nowhere (D286).
 *
 * S20, verbatim: "No console fits yet for HQ-held accounts. This row will hold
 * the territory benchmark and activity funnel once there is a store for these
 * accounts. It does not borrow an HQ-only page." The HQ analytics page
 * (`/admin/analytics`) is `hqOnly` and reads every branch; the branch page
 * (`/branch/insights/analytics`) refuses on HQ. Neither is this row's, so
 * this page draws the sentence and no link, and the guard holds it to none.
 */
export const INSIGHTS_SENTENCE = 'No console fits yet for HQ-held accounts. This row will hold the territory '
  + 'benchmark and activity funnel once there is a store for these accounts. It does not borrow an HQ-only page.';

export default function HeldInsights() {
  return (
    <HeldZone
      workspace="Insights"
      stance="Nothing to read yet"
      coverage={[]}
      coverageNote="This row has no store to read for HQ-held accounts."
      unavailable={[
        ['Territory benchmark', 'Computed by HQ across branches (D148); no branch is provisioned and these accounts are not one.'],
        ['Activity funnel', 'There is no per-account activity store for HQ-held accounts to read a funnel from.'],
      ]}
    >
      <h1 className="text-[18px] font-extrabold tracking-tight text-axal-ink">Insights</h1>
      <Card className="mt-3 p-4" data-testid="held-insights-sentence">
        <p className="text-[12.5px] leading-relaxed text-axal-muted">{INSIGHTS_SENTENCE}</p>
      </Card>
    </HeldZone>
  );
}
