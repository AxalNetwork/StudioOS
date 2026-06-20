// "Your range of matches" — co-founders, investors, partners, mentors/coaches
// ranked by values alignment + skill complementarity. Counts are free; full
// detail is studio-tier (the worker redacts names for free users and the card
// triggers the paywall). Includes the "Book a consultation with Guillaume" CTA.
import React, { useEffect, useState } from 'react';
import { Users, Lock, Loader2, CalendarCheck, Sparkles } from 'lucide-react';
import { api } from '../../lib/api';

function triggerPaywall() {
  try {
    window.dispatchEvent(new CustomEvent('studioos:tier_required', {
      detail: { required: 'studio', message: 'See your full match list and why each is a fit.' },
    }));
  } catch { /* no-op */ }
}

function scoreTone(s) {
  if (s >= 70) return 'text-emerald-600';
  if (s >= 50) return 'text-amber-600';
  return 'text-gray-500';
}

export default function MatchesCard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [booking, setBooking] = useState(false);
  const [booked, setBooked] = useState(false);

  useEffect(() => {
    let cancel = false;
    api.bestfitMatches()
      .then((d) => { if (!cancel) setData(d); })
      .catch(() => { if (!cancel) setData(null); })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, []);

  const book = async () => {
    setBooking(true);
    try {
      await api.bestfitConsult({ topic: 'Best-fit consultation' });
      setBooked(true);
    } catch { /* surfaced via disabled state */ }
    setBooking(false);
  };

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-5">
        <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 size={14} className="animate-spin" /> Finding your matches…</div>
      </div>
    );
  }
  if (!data) return null;

  if (!data.viewer_ready) {
    return (
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2 mb-1"><Users size={15} className="text-violet-600" /> Your matches</h3>
        <p className="text-sm text-gray-500 flex items-center gap-1"><Sparkles size={13} className="text-violet-500" /> Complete a bit more of the advisor conversation to unlock matches.</p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2"><Users size={15} className="text-violet-600" /> Your range of matches</h3>
        {!data.full && <button onClick={triggerPaywall} className="text-[11px] text-violet-600 hover:text-violet-700 inline-flex items-center gap-1"><Lock size={11} /> Unlock all</button>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {(data.types || []).map((t) => (
          <div key={t.type} className="border border-gray-100 dark:border-gray-800 rounded-lg p-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{t.label}</span>
              <span className="text-xs font-bold text-violet-600">{t.count}</span>
            </div>
            {t.top.length === 0 ? (
              <p className="text-[11px] text-gray-400">No matches yet.</p>
            ) : (
              <ul className="space-y-1">
                {t.top.map((m, i) => (
                  <li key={i} className="flex items-center justify-between text-[11px]">
                    <span className={`truncate ${m.locked ? 'text-gray-400 italic' : 'text-gray-700 dark:text-gray-300'}`}>
                      {m.locked ? <span className="inline-flex items-center gap-1"><Lock size={9} /> Locked</span> : m.name}
                    </span>
                    <span className={`font-semibold ${scoreTone(m.match_score)}`}>{m.match_score}</span>
                  </li>
                ))}
              </ul>
            )}
            {t.locked && (
              <button onClick={triggerPaywall} className="mt-1.5 text-[10px] text-violet-600 hover:underline">+ {t.count - 1} more · unlock</button>
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-800">
        {booked ? (
          <p className="text-xs text-emerald-600 flex items-center gap-1.5"><CalendarCheck size={14} /> Request sent — Guillaume will review your best-fit report and follow up.</p>
        ) : (
          <button onClick={book} disabled={booking} className="text-xs px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50 inline-flex items-center gap-1.5">
            {booking ? <Loader2 size={13} className="animate-spin" /> : <CalendarCheck size={13} />} Book a consultation with Guillaume
          </button>
        )}
      </div>
    </div>
  );
}
