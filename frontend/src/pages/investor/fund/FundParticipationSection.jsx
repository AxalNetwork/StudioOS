import React from 'react';
import { SectionLabel } from './FundWorkspaceSupport';
import LpApplicationForm from './LpApplicationForm';
import { SharedProofOfFunds, ProofOfFundsSheet } from '../ProofOfFunds';
import { SubscriptionBooklet } from '../../SpinoutLabLpBooklet';
import { MyCommitment } from '../../SpinoutLabLpCommitment';
import { FeeStatements } from '../../SpinoutLabLpFeeStatement';
import { MyNotices } from '../../SpinoutLabLpNotices';

export default function FundParticipationSection({
  showApply, applicationLoaded, application, setApplication, derived, proofOn, openProof, portal, err, load, proofTargets, proofKey, proofSheet, setProofSheet, setProofKey
}) {
return (
<>
      {/* application — a real submission, upserted per (applicant, fund). */}
      {showApply && (
        <div>
          <SectionLabel>Apply to participate</SectionLabel>
          <LpApplicationForm
            loaded={applicationLoaded}
            existing={application}
            onSubmitted={(saved) => setApplication(saved)}
          />
        </div>
      )}

      {/* D6130 part 2: an application in review, or approved with no position yet,
          is said on the first screen (FundFirstScreen), with the note from the
          fund team and the proof-of-funds door. */}

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
