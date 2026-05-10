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

export default function InvestorQuotaBars({ user }) {
  const [billing, setBilling] = useState(null);
  const [intros, setIntros] = useState(null);

  useEffect(() => {
    if (!user || user.role !== 'investor') return;
    let cancelled = false;
    Promise.allSettled([
      api.investorBillingStatus(),
      api.introductionsQuota(),
    ]).then(([b, i]) => {
      if (cancelled) return;
      if (b.status === 'fulfilled') setBilling(b.value);
      if (i.status === 'fulfilled') setIntros(i.value);
    });
    return () => { cancelled = true; };
  }, [user]);

  if (!user || user.role !== 'investor') return null;
  if (!billing && !intros) return null;

  const tier = String(billing?.tier || intros?.tier || 'free');
  const introsUsed = intros?.used ?? billing?.quotas?.intros_used ?? 0;
  const introsCap = intros?.cap ?? billing?.quotas?.intros_per_quarter ?? 3;
  const dealroomCap = billing?.quotas?.dealroom_max ?? 1;
  // Active deal rooms used isn't carried on /investor/status today, so we
  // surface "—" with the cap. Backend already enforces the cap on join; the
  // bar is informational. Updating the count requires a future endpoint
  // (see follow-ups) — until then we render the cap so investors know what
  // they're paying for.
  const dealroomsUsed = billing?.quotas?.dealroom_used ?? null;

  return (
    <div data-card className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 mb-4">
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
              used={dealroomsUsed ?? 0}
              cap={dealroomCap}
              label="Deal rooms"
              hint={dealroomsUsed == null ? 'Per-account cap on concurrent deal rooms.' : null}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
