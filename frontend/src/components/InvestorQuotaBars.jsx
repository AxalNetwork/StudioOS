// Task #7 (W-2) — Investor portal home quota bars.
//
// Two slim progress bars: warm intros used / quarter and active deal rooms /
// cap. Renders only for investor users; silently no-ops on error so it never
// breaks the portal home if the worker is rate-limiting.
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, Handshake } from 'lucide-react';
import { api } from '../lib/api';

function Bar({ used, cap, label, hint, accent }) {
  const capN = Number(cap) || 0;
  const usedN = Math.max(0, Number(used) || 0);
  // The worker only uses a sentinel >=100k for deal-room cap; intros + seats
  // are real numeric quotas (Institutional intros = 100/qtr) so we never
  // treat them as unlimited unless the cap really is huge.
  const unlimited = capN >= 100000;
  const pct = unlimited ? Math.min(100, usedN > 0 ? 8 : 0) : Math.min(100, capN ? (usedN / capN) * 100 : 0);
  const danger = !unlimited && capN > 0 && usedN >= capN;
  const warn = !unlimited && capN > 0 && usedN / capN >= 0.8 && !danger;
  const barCls = danger ? 'bg-red-500' : warn ? 'bg-amber-500' : (accent || 'bg-violet-600');
  return (
    <div>
      <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-300 mb-1">
        <span className="font-medium">{label}</span>
        <span>{unlimited ? `${usedN} used (unlimited)` : `${usedN} / ${capN}`}</span>
      </div>
      <div className="h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
        <div className={`h-full ${barCls} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      {hint && <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">{hint}</div>}
    </div>
  );
}

export default function InvestorQuotaBars({ user, compact = false }) {
  const [billing, setBilling] = useState(null);
  const [intros, setIntros] = useState(null);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    // An admin previewing the investor role must never request or present a
    // different investor's quota. The authenticated quota endpoints decide
    // access; permanent investor accounts remain the only viewer that renders.
    if (!user || user.role !== 'investor') {
      setSettled(true);
      return;
    }
    let cancelled = false;
    setSettled(false);
    Promise.allSettled([
      api.investorBillingStatus(),
      api.introductionsQuota(),
    ]).then(([b, i]) => {
      if (cancelled) return;
      if (b.status === 'fulfilled') setBilling(b.value);
      if (i.status === 'fulfilled') setIntros(i.value);
      setSettled(true);
    });
    return () => { cancelled = true; };
  }, [user]);

  if (!user || user.role !== 'investor') return compact ? <div className="text-xs text-gray-500 dark:text-gray-400 py-3">Quota data is available only to the signed-in investor account.</div> : null;
  if (!settled) return compact ? <div className="text-xs text-gray-500 dark:text-gray-400 py-3">Loading quota records…</div> : null;
  if (!billing && !intros) return compact ? <div className="text-xs text-gray-500 dark:text-gray-400 py-3">Quota records are unavailable in this environment.</div> : null;

  const tier = String(billing?.tier || intros?.tier || 'free');
  const introsUsed = intros?.used ?? billing?.quotas?.intros_used ?? 0;
  const introsCap = intros?.cap ?? billing?.quotas?.intros_per_quarter ?? 3;
  const dealroomCap = billing?.quotas?.dealroom_max ?? 1;
  // Worker /api/billing/investor/status now returns `dealroom_used` (count of
  // rows in investor_dealroom_members for this user). Falls back to 0 when
  // the field is absent (older worker version) so the bar still renders.
  const dealroomsUsed = billing?.quotas?.dealroom_used ?? 0;

  return (
    <div data-card className={compact ? '' : 'rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 mb-4'}>
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
          Investor plan · <span className="font-semibold capitalize text-gray-700 dark:text-gray-200">{tier}</span>
        </div>
        <Link to="/pricing/investor" className="text-xs text-violet-700 dark:text-violet-300 hover:underline">
          Compare plans
        </Link>
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="flex items-start gap-2">
          <Sparkles size={14} className="text-violet-600 dark:text-violet-300 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <Bar
              used={introsUsed}
              cap={introsCap}
              label="Warm intros / quarter"
              hint={intros?.quarter ? `Resets ${intros.quarter}` : null}
            />
          </div>
        </div>
        <div className="flex items-start gap-2">
          <Handshake size={14} className="text-violet-600 dark:text-violet-300 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <Bar
              used={dealroomsUsed}
              cap={dealroomCap}
              label="Active deal rooms"
              hint={dealroomCap >= 100000 ? 'No cap on your plan.' : null}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
