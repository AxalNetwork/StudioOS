import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, Loader2, FileText, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api';

const POLL_MS = 3000;
const MAX_POLLS = 60;

export default function IncorporateSuccessPage() {
  const [search] = useSearchParams();
  const id = search.get('incorporation_id');
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const pollsRef = useRef(0);

  useEffect(() => {
    if (!id) {
      setError('Missing incorporation reference. Please return to the wizard and try again.');
      return;
    }
    let cancelled = false;
    let timer = null;

    const tick = async () => {
      if (cancelled) return;
      try {
        const res = await api.legalIncorporateStatus(id);
        if (cancelled) return;
        setStatus(res);
        setError('');
        pollsRef.current += 1;
        if (res.status === 'pending_payment' && pollsRef.current < MAX_POLLS) {
          timer = setTimeout(tick, POLL_MS);
        }
      } catch (e) {
        if (cancelled) return;
        const msg = (e?.message || '').toLowerCase();
        const statusCode = e?.status;
        if (statusCode === 404 || msg.includes('not found')) {
          setError('We could not find this incorporation. Please return to the wizard and try again.');
        } else {
          setError('Something went wrong while confirming your payment. Please refresh or contact support.');
        }
      }
    };

    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [id]);

  if (!id) {
    return (
      <div className="max-w-3xl mx-auto py-12">
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-3xl mx-auto py-12">
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="max-w-3xl mx-auto py-12 text-center text-gray-500 flex items-center justify-center gap-2">
        <Loader2 className="animate-spin" size={16} /> Confirming payment...
      </div>
    );
  }

  const confirming = status.status === 'pending_payment';
  const paid = status.status === 'paid' || status.status === 'packet_processing' || status.status === 'packet_ready';
  const failed = status.status === 'failed';

  return (
    <div className="max-w-3xl mx-auto py-10">
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 dark:bg-gray-900 dark:border-gray-800">
        {confirming && (
          <div className="flex items-start gap-3">
            <Loader2 className="animate-spin text-violet-600 mt-1" size={20} />
            <div>
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Confirming payment</h2>
              <p className="text-sm text-gray-600 mt-1">
                We’re waiting for Stripe to confirm your payment. This usually takes a few seconds.
              </p>
            </div>
          </div>
        )}

        {paid && (
          <div className="space-y-5">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="text-emerald-600 mt-1" size={20} />
              <div>
                <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {status.company_name} — {status.status === 'packet_ready' ? 'Packet ready' : 'Payment confirmed'}
                </h2>
                <p className="text-sm text-gray-600 mt-1">
                  {status.status === 'packet_ready'
                    ? 'Your signing packet is ready. A link has been emailed to you. Please check your inbox and spam folder.'
                    : 'Your payment is confirmed. We’re preparing your signing packet and will email you a link once it’s ready.'}
                </p>
              </div>
            </div>

            <div className="border border-gray-200 rounded-lg p-4 dark:border-gray-700">
              <div className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2 dark:text-gray-300">Incorporation details</div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="text-gray-600">Company name</div>
                <div className="text-gray-900 dark:text-gray-100">{status.company_name}</div>
                <div className="text-gray-600">Jurisdiction</div>
                <div className="text-gray-900 dark:text-gray-100">{status.jurisdiction_id}</div>
                <div className="text-gray-600">Amount</div>
                <div className="text-gray-900 dark:text-gray-100">
                  {(status.amount_cents / 100).toFixed(2)} {status.currency?.toUpperCase()}
                </div>
                <div className="text-gray-600">Status</div>
                <div className="text-gray-900 dark:text-gray-100">{status.status}</div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <a
                href="/legal"
                className="inline-flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 text-white text-sm px-4 py-2 rounded-md"
              >
                <FileText size={14} /> Open Legal
              </a>
              <a
                href="/incorporate"
                className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-300"
              >
                Incorporate another
              </a>
            </div>
          </div>
        )}

        {failed && (
          <div className="flex items-start gap-3">
            <AlertTriangle className="text-red-600 mt-1" size={20} />
            <div>
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Something went wrong</h2>
              <p className="text-sm text-gray-600 mt-1">
                We couldn’t prepare your signing packet. Please contact support with your incorporation ID: <span className="font-mono">{status.id}</span>.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
