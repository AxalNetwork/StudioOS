import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2, RefreshCw } from 'lucide-react';
import { api } from '../../lib/api';
import {
  DISPUTE, DISPUTE_STATUS, disputeMoney, disputeReadFailure, stripeDate,
} from '../../components/hqReview/hqReviewCopy';

/**
 * D634 (#1392) — canvas `hq-dispute`: one billing dispute, at
 * `/admin/revenue/disputes/:disputeId`, opened from the Disputes rows of HQ ·
 * Revenue's Billing exceptions.
 *
 * It reads `GET /admin/billing/disputes/:id`, live from Stripe each time:
 * nothing is stored on the platform, so there is no stale copy to show when
 * the read fails. The two failures are different facts and read differently:
 * "Stripe is not configured" (503 `stripe_not_configured`) and "Stripe could
 * not be read" (any other failure), the second with "Try again".
 *
 * Evidence is filed on the Billing tab, as it was (D224); this page reads.
 */
export default function DisputePage() {
  const { disputeId } = useParams();
  const [state, setState] = useState({ loading: true, failure: null, dispute: null });
  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, failure: null }));
    try {
      const r = await api.adminBillingGetDispute(disputeId);
      setState({ loading: false, failure: null, dispute: r?.dispute || null });
    } catch (e) {
      setState({ loading: false, failure: disputeReadFailure(e), dispute: null });
    }
  }, [disputeId]);
  useEffect(() => { load(); }, [load]);
  return <DisputeView disputeId={disputeId} state={state} onRetry={load} />;
}

function Fact({ label, children }) {
  return (
    <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
      <div className="text-[10px] font-extrabold uppercase tracking-[.08em] text-gray-500">{label}</div>
      <div className="mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100">{children}</div>
    </div>
  );
}

/** The page body from its read. Rendered directly by the tests. */
export function DisputeView({ disputeId, state, onRetry }) {
  const d = state.dispute;
  return (
    <div className="mx-auto max-w-3xl p-4 md:p-6" data-testid="hq-dispute">
      <Link to="/admin/revenue" className="mb-3 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 dark:text-gray-400">
        <ArrowLeft size={14} /> Disputes
      </Link>
      <h1 className="break-all text-xl font-bold text-gray-900 dark:text-gray-100">Dispute {disputeId}</h1>
      <p className="mt-1 text-sm text-gray-500">{DISPUTE.sub}</p>

      <div className="mt-4">
        {state.loading && !d ? (
          <p className="text-sm text-gray-500" data-testid="hq-dispute-loading"><Loader2 className="mr-1 inline animate-spin" size={14} /> Reading Stripe…</p>
        ) : state.failure === 'not_configured' ? (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200" role="status" data-testid="hq-dispute-not-configured">
            <div className="font-semibold">{DISPUTE.notConfigured.title}</div>
            <div className="mt-0.5">{DISPUTE.notConfigured.body}</div>
          </div>
        ) : state.failure === 'unreadable' || !d ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300" role="alert" data-testid="hq-dispute-unreadable">
            <div className="font-semibold">{DISPUTE.unreadable.title}</div>
            <div className="mt-0.5">
              {DISPUTE.unreadable.body}
              {onRetry && <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 font-semibold underline"><RefreshCw size={11} /> Try again</button>}
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4" data-testid="hq-dispute-facts">
              <Fact label="Amount">{disputeMoney(d.amount, d.currency)}</Fact>
              <Fact label="Status">{DISPUTE_STATUS[d.status] || d.status}</Fact>
              <Fact label="Reason">{d.reason ? String(d.reason).replace(/_/g, ' ') : 'Not recorded: Stripe returned no reason.'}</Fact>
              <Fact label="Due">{stripeDate(d.due_by) || <span className="text-xs font-normal italic text-gray-500">{DISPUTE.nrDue}</span>}</Fact>
            </div>
            <dl className="mt-4 grid grid-cols-1 gap-x-4 gap-y-1 text-sm md:grid-cols-2" data-testid="hq-dispute-refs">
              <dt className="text-gray-500">Charge</dt>
              <dd className="break-all font-mono">{d.charge || 'Not recorded: Stripe returned no charge.'}</dd>
              <dt className="text-gray-500">Payment intent</dt>
              <dd className="break-all font-mono">{d.payment_intent || 'Not recorded: Stripe returned no payment intent.'}</dd>
            </dl>
            <div className="mt-4 rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-800" data-testid="hq-dispute-evidence">
              <div className="text-[10px] font-extrabold uppercase tracking-[.08em] text-gray-500">Evidence</div>
              {d.has_evidence || Number(d.submission_count) > 0 ? (
                <p className="mt-1">
                  Evidence sent · submitted {Number(d.submission_count) || 0} time{Number(d.submission_count) === 1 ? '' : 's'}.
                </p>
              ) : (
                <p className="mt-1 text-gray-500">{DISPUTE.noEvidence}</p>
              )}
              <p className="mt-1 text-xs text-gray-500">
                Evidence is filed on the <Link to="/admin?tab=billing" className="underline">Billing tab</Link>.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
