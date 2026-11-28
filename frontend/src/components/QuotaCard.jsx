// Investor quota card — a compact usage snapshot rendered *beside* paywalls
// and locked-tab previews (distinct from the home `InvestorQuotaBars`, which
// lives on the portal home). Fetches the investor's live billing + intro
// quotas and renders slim progress bars. Renders only for investor users and
// silently no-ops on error so it never breaks a paywall surface.
//
// #9019: a deal-room count the Worker could not read (or a billing read that
// failed) is Unavailable, never "0 / N".
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Gauge } from 'lucide-react';
import { api } from '../lib/api';

function UnavailableRow({ label, testId }) {
  return (
    <div data-testid={testId}>
      <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-300 mb-1">
        <span className="font-medium">{label}</span>
        <span>Unavailable</span>
      </div>
    </div>
  );
}

function QBar({ used, cap, label, testId }) {
  const capN = Number(cap) || 0;
  const usedN = Math.max(0, Number(used) || 0);
  // Mirror InvestorQuotaBars: only a sentinel >=100k is treated as "unlimited".
  const unlimited = capN >= 100000;
  const pct = unlimited ? (usedN > 0 ? 8 : 0) : Math.min(100, capN ? (usedN / capN) * 100 : 0);
  const danger = !unlimited && capN > 0 && usedN >= capN;
  const warn = !unlimited && capN > 0 && usedN / capN >= 0.8 && !danger;
  const barCls = danger ? 'bg-red-500' : warn ? 'bg-amber-500' : 'bg-violet-600';
  return (
    <div data-testid={testId}>
      <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-300 mb-1">
        <span className="font-medium">{label}</span>
        <span>{unlimited ? `${usedN} used · unlimited` : `${usedN} / ${capN}`}</span>
      </div>
      <div className="h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
        <div className={`h-full ${barCls} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function QuotaCard({ user, className = '' }) {
  const [billing, setBilling] = useState(null);
  const [intros, setIntros] = useState(null);
  const [settled, setSettled] = useState(false);
  const isInvestor = user?.role === 'investor';

  useEffect(() => {
    if (!isInvestor) return;
    let cancelled = false;
    Promise.allSettled([api.investorBillingStatus(), api.introductionsQuota()]).then(([b, i]) => {
      if (cancelled) return;
      if (b.status === 'fulfilled') setBilling(b.value);
      if (i.status === 'fulfilled') setIntros(i.value);
      setSettled(true);
    });
    return () => { cancelled = true; };
  }, [isInvestor]);

  if (!isInvestor) return null;

  const tier = String(billing?.tier || intros?.tier || 'free');
  const introsUsed = intros?.used ?? billing?.quotas?.intros_used ?? 0;
  const introsCap = intros?.cap ?? billing?.quotas?.intros_per_quarter ?? 3;
  const dealroomCap = billing?.quotas?.dealroom_max ?? 1;
  // #9019: null (count unreadable) or absent (billing read failed) is unknown.
  const rawDealrooms = billing?.quotas?.dealroom_used;
  const dealroomsUsed = typeof rawDealrooms === 'number' && Number.isFinite(rawDealrooms) ? rawDealrooms : null;

  return (
    <div className={`rounded-xl border border-violet-200 dark:border-violet-800/60 bg-violet-50/60 dark:bg-violet-900/20 p-4 ${className}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
          <Gauge size={14} className="text-violet-600 dark:text-violet-300" />
          Your usage · <span className="font-semibold capitalize text-gray-700 dark:text-gray-200">{tier}</span>
        </div>
        <Link to="/pricing?for=investor" className="text-xs text-violet-700 dark:text-violet-300 hover:underline">
          Compare plans
        </Link>
      </div>
      <div className="space-y-3">
        <QBar used={introsUsed} cap={introsCap} label="Warm intros / quarter" />
        {dealroomsUsed === null
          ? (settled ? <UnavailableRow label="Active deal rooms" testId="quota-card-dealrooms" /> : null)
          : <QBar used={dealroomsUsed} cap={dealroomCap} label="Active deal rooms" testId="quota-card-dealrooms" />}
      </div>
    </div>
  );
}
