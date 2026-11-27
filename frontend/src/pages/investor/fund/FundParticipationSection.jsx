import React from 'react';
import { SectionLabel } from './FundWorkspaceSupport';
import LpApplicationForm from './LpApplicationForm';
import { Check, Clock } from 'lucide-react';
import { ProofDoor, SharedProofOfFunds, ProofOfFundsSheet } from '../ProofOfFunds';
import { SubscriptionBooklet } from '../../SpinoutLabLpBooklet';
import { MyCommitment } from '../../SpinoutLabLpCommitment';
import { FeeStatements } from '../../SpinoutLabLpFeeStatement';
import { MyNotices } from '../../SpinoutLabLpNotices';

export default function FundParticipationSection({
  showApply, applicationLoaded, application, prefill, setApplication, showPending, derived, proofOn, lpApplicationTarget, openProof, portal, err, load, proofTargets, proofKey, proofSheet, setProofSheet, setProofKey
}) {
return (
<>
      {/* application — a real submission, upserted per (applicant, fund). */}
      {showApply && application?.status !== 'declined' && (
        <div id="lp-application-entry" className="scroll-mt-6">
          <SectionLabel>Apply to participate</SectionLabel>
          <LpApplicationForm
            loaded={applicationLoaded}
            existing={application}
            prefill={prefill}
            onSubmitted={(saved) => setApplication(saved)}
          />
        </div>
      )}
      {showApply && application?.status === 'declined' && (
        <div className="rounded-xl border border-gray-200 p-4 text-sm dark:border-gray-700" data-testid="lp-application-status">
          <p className="font-semibold">Application declined</p>
          {application.review_note && <p>{application.review_note}</p>}
        </div>
      )}

      {/* An APPROVED application with no fund holding yet is mid-onboarding, not
          under review. The access ladder caps both at 'pending' on purpose
          (an applicant must never unlock the archive by their own row), so the
          distinction is made here, in what the page SAYS. */}
      {showPending && (
        <div className={`flex flex-wrap items-center gap-4 rounded-2xl border px-6 py-5 ${
          derived.applicationStatus === 'approved'
            ? 'border-violet-200 dark:border-violet-900 bg-violet-50 dark:bg-violet-950/30'
            : 'border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30'
        }`} data-testid="lp-application-status">
          {derived.applicationStatus === 'approved'
            ? <Check size={20} className="flex-none text-violet-600 dark:text-violet-400" />
            : <Clock size={20} className="flex-none text-amber-600 dark:text-amber-400" />}
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-gray-900 dark:text-gray-100">
              {derived.applicationStatus === 'approved'
                ? 'Application approved — onboarding in progress'
                : 'Application under review'}
            </div>
            <div className="mt-0.5 text-[12.5px] leading-relaxed text-gray-600 dark:text-gray-400">
              {derived.applicationStatus === 'approved'
                ? 'Your Subscription Booklet is below: read each part, tick what applies, then submit it. Reporting and participation activate once the general partner records your commitment on the fund’s register.'
                : 'Fund team review typically completes within five business days. On acceptance you proceed to KYC/AML and subscription documents.'}
            </div>
            {application?.review_note && (
              <div className="mt-2 rounded-lg bg-white/70 dark:bg-gray-900/50 px-3 py-2 text-[12px] leading-relaxed text-gray-600 dark:text-gray-300">
                <span className="font-semibold">Note from the fund team:</span> {application.review_note}
              </div>
            )}
            {proofOn && <ProofDoor target={lpApplicationTarget} onShare={openProof} />}
          </div>
        </div>
      )}

      {/* D716 (#1866): the Subscription Booklet, for the viewer's own approved application. */}
      {derived.applicationStatus === 'approved' && <SubscriptionBooklet />}

      {/* I5 · My commitment (D372) — the LP's own position, and where
          /lp-portal lands. Drawn for anyone with a holding, and when the read
          failed, so a failure is never mistaken for "no commitment". */}
      {(derived.holdings > 0 || (!portal && !!err)) && (
        <>
          <MyCommitment portal={portal} failed={!portal && !!err} onReload={load}
            proof={proofOn && proofTargets.status === 'ready' ? { targets: proofTargets.read, onShare: openProof } : null} />
          <FeeStatements portal={portal} failed={!portal && !!err} onReload={load} />
        </>
      )}
      {(derived.holdings > 0 || (!portal && !!err)) && (
        <section id="documents" aria-label="Documents" tabIndex={-1} className="scroll-mt-6">
          <MyNotices portal={portal} />
        </section>
      )}

      {/* D752 (#1891) · the proof of funds this investor shared, with views and Revoke. */}
      {proofOn && <SharedProofOfFunds key={proofKey} targetsState={proofTargets} onChanged={proofTargets.reload} />}
      {proofOn && proofSheet && (
        <ProofOfFundsSheet target={proofSheet} consent={proofTargets.read?.consent} minimumCents={proofTargets.read?.minimum_cents}
          onClose={() => setProofSheet(null)}
          onShared={() => { setProofKey((k) => k + 1); proofTargets.reload(); }}
          onTargetsChanged={proofTargets.reload} />
      )}


</>
);
}
