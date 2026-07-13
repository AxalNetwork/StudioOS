import React, { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { Lock, ShieldCheck, Check, X, Loader2 } from 'lucide-react';
import { api } from '../lib/api';

// Task #12 — public review page for an off-platform introduction invite.
// Reached via the single-use tokenized link in the branded invite email. It
// shows the requester summary + message (NEVER any email) and lets the
// recipient accept or decline before revealing their own contact details.
export default function NetworkIntroReviewPage() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null); // 'accepted' | 'declined'

  const load = useCallback(async () => {
    try {
      setError('');
      setData(await api.networkIntros.invite(token));
    } catch (e) {
      setError(e?.message || 'This review link is invalid or has expired.');
      setData(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const respond = async (accept) => {
    setBusy(true);
    setError('');
    try {
      if (accept) await api.networkIntros.inviteAccept(token);
      else await api.networkIntros.inviteDecline(token);
      setDone(accept ? 'accepted' : 'declined');
      await load();
    } catch (e) {
      setError(e?.message || 'Could not record your response.');
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">
        <div className="px-8 pt-8">
          <div className="text-lg font-bold text-violet-600 mb-6">⚡ AXAL Ventures</div>
        </div>

        {data === null ? (
          <div className="px-8 pb-10 flex items-center gap-2 text-sm text-gray-500">
            <Loader2 className="animate-spin" size={16} /> Loading…
          </div>
        ) : data === false ? (
          <div className="px-8 pb-10">
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">Link unavailable</h1>
            <p className="text-sm text-gray-500">{error}</p>
          </div>
        ) : (
          <div className="px-8 pb-8">
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-1">
              You have an introduction request
            </h1>
            <p className="text-sm text-gray-500 mb-5">
              {data.recipient_name ? `Hi ${data.recipient_name}, ` : ''}someone on Axal would like to connect.
            </p>

            <div className="flex items-center gap-3 rounded-xl border border-gray-200 dark:border-gray-800 p-4 mb-4">
              {data.requester?.photo_url ? (
                <img src={data.requester.photo_url} alt="" className="w-12 h-12 rounded-full object-cover" />
              ) : (
                <div className="w-12 h-12 rounded-full bg-violet-100 text-violet-700 flex items-center justify-center font-bold">
                  {(data.requester?.name || 'A')[0]}
                </div>
              )}
              <div className="min-w-0">
                <div className="font-semibold text-gray-900 dark:text-gray-100">{data.requester?.name}</div>
                <div className="text-xs text-gray-500 truncate">
                  {[data.requester?.role && data.requester.role[0].toUpperCase() + data.requester.role.slice(1),
                    data.requester?.company].filter(Boolean).join(' · ')}
                </div>
                {data.requester?.headline && (
                  <div className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">{data.requester.headline}</div>
                )}
              </div>
            </div>

            {data.message && (
              <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 text-sm text-gray-700 dark:text-gray-300 mb-4">
                “{data.message}”
              </div>
            )}

            <p className="text-xs text-gray-500 inline-flex items-start gap-1.5 mb-5">
              <Lock size={13} className="mt-0.5 flex-shrink-0" />
              Your contact details stay private. They only see your details if you accept.
            </p>

            {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

            {done === 'accepted' || data.status === 'connected' ? (
              <div className="rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-900/40 p-4 text-sm text-emerald-800 dark:text-emerald-200 inline-flex items-center gap-2">
                <ShieldCheck size={16} /> You’ve accepted — you’re now connected.
              </div>
            ) : done === 'declined' || data.status === 'declined' ? (
              <div className="rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-4 text-sm text-gray-600 dark:text-gray-300">
                You’ve declined this introduction.
              </div>
            ) : data.already_responded ? (
              <div className="rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-4 text-sm text-gray-600 dark:text-gray-300">
                This introduction is no longer awaiting your response.
              </div>
            ) : (
              <div className="flex gap-2">
                <button
                  disabled={busy}
                  onClick={() => respond(true)}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold px-4 py-2.5 disabled:opacity-50"
                >
                  <Check size={16} /> Accept
                </button>
                <button
                  disabled={busy}
                  onClick={() => respond(false)}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-sm font-semibold px-4 py-2.5 disabled:opacity-50"
                >
                  <X size={16} /> Decline
                </button>
              </div>
            )}

            {(done === 'accepted' || data.status === 'connected') && (
              <a
                href={data.register_url || '/register'}
                className="mt-4 block text-center text-sm font-medium text-violet-600 hover:text-violet-700"
              >
                New to Axal? Create your account to message directly →
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
