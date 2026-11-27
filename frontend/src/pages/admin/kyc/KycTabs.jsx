/**
 * D1228 (#2384) — KYC & KYB's tab bodies (KYC1, KYC6, KYC9, KYC10) and one
 * person's case (KYC3), under the page header `ConsolePages.KycPage` draws.
 * People, Businesses, Renewals and Audit each draw their own recorded reads.
 *
 * D1233 (#3241): People is the queue alone (`consoles/KycConsole.jsx`, with
 * its figures), and the case is `KycCase.jsx`, where every decision is.
 *
 * D1234 (#3242): Businesses is `KycBusinesses.jsx`, which the page passes in
 * as it passes People (so its doors are the page's), and a business's case is
 * `BusinessCase.jsx`.
 * D1235 (#3243): Renewals (`KycRenewals.jsx`, with how long a check lasts)
 * and Audit (`KycAudit.jsx`, with HQ's export) draw part 4's reads (D1232).
 */
import React from 'react';
import { KycPersonCase, KycPersonView } from './KycCase';
import { KycBusinessCase } from './BusinessCase';
import KycRenewals from './KycRenewals';
import KycAudit from './KycAudit';

export { KycPersonCase, KycPersonView };

/** The body under the header for one view of `kycModel.viewOf`. */
export function KycTabBody({ view, people, businesses = null }) {
  if (view.person) return <KycPersonCase id={view.person} />;
  if (view.business) return <KycBusinessCase id={view.business} />;
  if (view.tab === 'businesses') return <div className="flex min-w-0 flex-col gap-4" data-testid="kyc-businesses-tab">{businesses}</div>;
  if (view.tab === 'renewals') return <KycRenewals />;
  if (view.tab === 'audit') return <KycAudit />;
  return <div className="flex min-w-0 flex-col gap-4" data-testid="kyc-people">{people}</div>;
}
