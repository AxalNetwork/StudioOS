import React from 'react';
import { CARD, LBL, ONBOARDING, MONO, SectionLabel, Chip } from './FundWorkspaceSupport';
import { onboardingStatus } from '../../../lib/lpCommitmentModel';
import { ShieldCheck, Lock, FileText } from 'lucide-react';

export default function FundOnboardingSection({
  kyc, application, applicationLoaded, portal
}) {
return (
<section id="apply" aria-label="Apply and onboarding" tabIndex={-1} className="space-y-6 scroll-mt-6">
      {/* onboarding */}
      <div>
        <SectionLabel>Onboarding requirements</SectionLabel>
        <div className={`${CARD} overflow-x-auto`}>
          <table className="w-full min-w-[680px] text-left">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                {['Requirement', 'What we collect', 'Typical time', 'Your status'].map((h) => (
                  <th key={h} className={`px-4 py-3 ${LBL}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ONBOARDING.map(([name, note, collect, time], i) => {
                // D372: each row's status is read from a record — Trust's KYC,
                // the application's self-certification, the LPA flag on the
                // caller's holdings — or says there is none. It was inferred
                // from the access ladder, which marked KYC complete for anyone
                // with a commitment.
                const status = onboardingStatus(name, {
                  kyc, application, applicationLoaded, holdings: portal?.lp_holdings || [],
                });
                return (
                  <tr key={name} className="border-b border-gray-100 dark:border-gray-800 last:border-b-0">
                    <td className="px-4 py-3">
                      <div className="text-[12.5px] font-bold text-gray-900 dark:text-gray-100">{name}</div>
                      <div className="text-[10.5px] text-gray-400 dark:text-gray-500">{note}</div>
                    </td>
                    <td className="px-4 py-3 text-[11px] leading-snug text-gray-600 dark:text-gray-400">{collect}</td>
                    <td className={`${MONO} px-4 py-3 text-[11px] text-gray-500 dark:text-gray-400`}>{time}</td>
                    <td className="px-4 py-3"><Chip tone={status[0]}>{status[1]}</Chip></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2.5 text-[11px] text-gray-400 dark:text-gray-500">
          The fund’s policy is that no capital moves before subscription documents are countersigned;
          the platform keeps no subscription-document record, so this table cannot show yours. Identity
          verification is submitted in Trust: your ID document is kept in the platform’s private
          document store and reviewed by the fund team. Accreditation is self-certified on your
          application and is not verified here.
        </p>
      </div>

      {/* compliance footer */}
      <div className={`${CARD} grid grid-cols-1 gap-5 p-5 md:grid-cols-3`}>
        {[
          [ShieldCheck, 'Eligibility.', 'Participation is limited to accredited investors. KYC/AML verification is required before any capital transfer; no funds move before countersigned subscription documents.'],
          [Lock, 'Confidentiality.', 'This workspace and its contents are confidential, provided to curated investors only, and may not be redistributed.'],
          [FileText, 'No offer.', 'Nothing here is an offer to sell securities. Any offering is made solely through the fund’s subscription documents and private placement memorandum.'],
        ].map(([Icon, bold, text]) => (
          <div key={bold} className="flex gap-2.5">
            <Icon size={15} className="mt-0.5 flex-none text-gray-400 dark:text-gray-500" />
            <div className="text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
              <strong className="text-gray-700 dark:text-gray-300">{bold}</strong> {text}
            </div>
          </div>
        ))}
      </div>
</section>
);
}
