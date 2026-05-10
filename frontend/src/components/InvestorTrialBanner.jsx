// Task #7 (W-2) — Investor trial countdown banner.
//
// Renders only for investor users in an active 14-day Pro trial. Auto-hides
// after the trial expires. Silent on error so the banner is never blocking.
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, X } from 'lucide-react';
import { api } from '../lib/api';

const DISMISS_KEY = 'axal:investor_trial_banner_dismissed_at';

export default function InvestorTrialBanner({ user }) {
  const [status, setStatus] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!user || user.role !== 'investor') return;
    let cancelled = false;
    api.investorBillingStatus()
      .then((s) => { if (!cancelled) setStatus(s); })
      .catch(() => { /* silent */ });
    try {
      const d = localStorage.getItem(DISMISS_KEY);
      if (d) {
        // Only honour dismissal for 24h so the user keeps seeing it as the
        // deadline approaches.
        const ts = Number(d);
        if (Number.isFinite(ts) && Date.now() - ts < 24 * 3600 * 1000) {
          setDismissed(true);
        }
      }
    } catch { /* ignore */ }
    return () => { cancelled = true; };
  }, [user]);

  if (!user || user.role !== 'investor' || !status || dismissed) return null;
  if (String(status.status || '').toLowerCase() !== 'trialing') return null;
  if (!status.trial_ends_at) return null;

  const ends = new Date(status.trial_ends_at);
  if (Number.isNaN(ends.getTime())) return null;
  const msLeft = ends.getTime() - Date.now();
  if (msLeft <= 0) return null;
  const daysLeft = Math.max(1, Math.ceil(msLeft / (24 * 3600 * 1000)));

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* ignore */ }
    setDismissed(true);
  };

  return (
    <div className="rounded-xl border border-violet-300 dark:border-violet-700 bg-gradient-to-r from-violet-50 to-indigo-50 dark:from-violet-900/30 dark:to-indigo-900/30 px-4 py-3 flex items-center gap-3 mb-4">
      <div className="w-8 h-8 rounded-lg bg-violet-600 text-white flex items-center justify-center flex-shrink-0">
        <Sparkles size={16} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          14-day Professional trial — {daysLeft} day{daysLeft === 1 ? '' : 's'} left
        </div>
        <div className="text-xs text-gray-600 dark:text-gray-300">
          Full access to deal flow, intros, and Market Intelligence exports until {ends.toLocaleDateString()}.
        </div>
      </div>
      <Link
        to="/pricing/investor"
        className="text-sm font-medium px-3 py-1.5 rounded-md bg-violet-600 hover:bg-violet-700 text-white whitespace-nowrap"
      >
        Upgrade now
      </Link>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss trial banner"
        className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
      >
        <X size={16} />
      </button>
    </div>
  );
}
