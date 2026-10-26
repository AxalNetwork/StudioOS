/**
 * D1228 (#2384) — KYC & KYB's tab bodies (KYC1, KYC6, KYC9, KYC10) and one
 * person's case (KYC3), under the page header `ConsolePages.KycPage` draws.
 * Businesses, Renewals and Audit say "Not read here yet" with their reason
 * (`kycModel.WAITS`) until parts 6 and 7 draw them.
 *
 * D1233 (#3241): People is the queue alone (`consoles/KycConsole.jsx`, with
 * its figures), and the case is `KycCase.jsx`, where every decision is.
 */
import React from 'react';
import { NOT_YET, WAITS } from './kycModel';
import { KycPersonCase, KycPersonView } from './KycCase';

export { KycPersonCase, KycPersonView };

const box = 'flex flex-col gap-2 rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-900';

export function KycWait({ id }) {
  return (
    <div className="flex flex-col gap-1" data-testid={`kyc-wait-${id}`}>
      <span className="w-fit rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-[11px] font-bold text-gray-500 dark:border-gray-600 dark:text-gray-400">{NOT_YET}</span>
      <p className="m-0 text-[12.5px] text-axal-muted dark:text-gray-400">{WAITS[id]}</p>
    </div>
  );
}

function Section({ title, testId, children }) {
  return (
    <section className={box} data-testid={testId}>
      <h2 className="m-0 text-[15px] font-bold">{title}</h2>
      {children}
    </section>
  );
}

/** The body under the header for one view of `kycModel.viewOf`. */
export function KycTabBody({ view, people }) {
  if (view.person) return <KycPersonCase id={view.person} />;
  if (view.tab === 'businesses') return <Section title="Businesses" testId="kyc-businesses"><KycWait id="businesses" /></Section>;
  if (view.tab === 'renewals') return <Section title="Renewals" testId="kyc-renewals"><KycWait id="renewals" /></Section>;
  if (view.tab === 'audit') return <Section title="Audit" testId="kyc-audit"><KycWait id="audit" /></Section>;
  return <div className="flex min-w-0 flex-col gap-4" data-testid="kyc-people">{people}</div>;
}
