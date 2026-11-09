/**
 * D4819 (#4819), Build part 3 — a licence's identity header (Licences v2
 * boards L03 and L04): the studio's name, then its reference, territory, type,
 * primary status, renewal, executed agreement and branch sync, each in its own
 * state. A fact with no value reads Not recorded; one whose read failed reads
 * Unavailable with Try again; none is ever 0 or a guess. The agreement and
 * branch lines are the Overview's own facts (`identityFacts`), so the header
 * and the Overview cannot disagree. The lifecycle actions are passed in as
 * `actions` and drawn where the canvas puts them, top right.
 */
import React from 'react';
import { identityFacts } from '../licenceOverviewModel';
import { FactState, TryAgain } from './LicenceOverview';

export default function LicenceIdentity({ licence: d, facts, retry, actions }) {
  const rows = identityFacts(d, facts);
  return (
    <header className="flex flex-wrap items-start justify-between gap-3" data-testid="licence-identity">
      <div className="min-w-0 flex-1">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">{d.brand_name}</h2>
        <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{d.legal_entity_name}</div>
        <div className="mt-1 text-[11px] font-medium text-gray-500 dark:text-gray-400" data-testid="licence-kind-pill">
          {d.kind === 'white_label'
            ? 'White-label · platform supervised, brand unsupervised'
            : 'Axal subsidiary · platform supervised'}
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4 xl:grid-cols-7" data-testid="licence-identity-facts">
          {rows.map((r) => (
            <div key={r.key} className="min-w-0" data-testid={`licence-identity-${r.key}`}>
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{r.label}</dt>
              <dd className="text-[13px]">
                <FactState state={r.state}>{r.text}</FactState>
                {r.retry && r.state === 'unavailable' && (
                  <div><TryAgain what={r.label.toLowerCase()} onClick={() => retry(r.retry)} /></div>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </div>
      {actions}
    </header>
  );
}
