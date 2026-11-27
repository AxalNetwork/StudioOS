// Task #7 (W-2) — Investor portal home quota bars.
//
// Two slim progress bars: warm intros used / quarter and active deal rooms /
// cap. Renders only for investor users.
//
// D8731 (#8731, canvas SIV-7): a figure whose read failed is Unreadable with
// Try again, never a default cap with 0 used, and the compact card (Studio's
// Usage & quota tile, whose own link is "Compare investor plans") carries no
// second link to the same page.
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CircleAlert, Sparkles, Handshake } from 'lucide-react';
import { api } from '../lib/api';

const known = (v) => v !== null && v !== undefined && v !== '';

/**
 * D8731: what each read says, or null where neither read recorded it. The
 * plan tier and the intro count come from either read; deal rooms only from
 * the billing read. `billing` and `intros` are null when their read failed.
 */
export function quotaView(billing, intros) {
  const q = billing?.quotas || {};
  const tier = known(billing?.tier) ? String(billing.tier) : known(intros?.tier) ? String(intros.tier) : null;
  const introsUsed = known(intros?.used) ? intros.used : q.intros_used;
  const introsCap = known(intros?.cap) ? intros.cap : q.intros_per_quarter;
  return {
    tier,
    intros: known(introsUsed) && known(introsCap) ? { used: introsUsed, cap: introsCap, quarter: intros?.quarter || null } : null,
    dealrooms: known(q.dealroom_used) && known(q.dealroom_max) ? { used: q.dealroom_used, cap: q.dealroom_max } : null,
    unreadable: !billing && !intros,
    planUnreadable: !billing && !!intros,
  };
}

const UNREADABLE = <span className="ihs-st ihs-un" data-testid="status-quota-row-unreadable"><span aria-hidden="true" className="ihs-sq-x" />Unreadable</span>;

function UnreadableRow({ label }) {
  return (
    <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-300">
      <span className="font-medium">{label}</span>{UNREADABLE}
    </div>
  );
}

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
  const [attempt, setAttempt] = useState(0);
  const retry = () => setAttempt((n) => n + 1);

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
      setBilling(b.status === 'fulfilled' ? b.value : null);
      setIntros(i.status === 'fulfilled' ? i.value : null);
      setSettled(true);
    });
    return () => { cancelled = true; };
  }, [user, attempt]);

  if (!user || user.role !== 'investor') return compact ? <div className="text-xs text-gray-500 dark:text-gray-400 py-3">Quota data is available only to the signed-in investor account.</div> : null;
  if (!settled) return compact ? <div className="text-xs text-gray-500 dark:text-gray-400 py-3">Loading quota records…</div> : null;
  return <QuotaBarsView view={quotaView(billing, intros)} compact={compact} onRetry={retry} />;
}

/** D8731: the bars as drawn from `quotaView`, so every read state can be rendered and tested without a fetch. */
export function QuotaBarsView({ view, compact = false, onRetry }) {
  if (view.unreadable) {
    if (!compact) return null;
    return (
      <p className="ihs-unr" role="alert" data-testid="status-quota-unreadable">
        <CircleAlert size={14} aria-hidden="true" />
        <span>Usage &amp; quota could not be read ·</span>
        <button type="button" className="sm-btn sm-btn-s sm-btn-sm" onClick={onRetry}>Try again</button>
      </p>
    );
  }

  return (
    <div data-card className={compact ? '' : 'rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 mb-4'}>
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
          Investor plan · {view.tier ? <span className="font-semibold capitalize text-gray-700 dark:text-gray-200">{view.tier}</span> : UNREADABLE}
        </div>
        {!compact && (
          <Link to="/pricing?for=investor" className="text-xs text-violet-700 dark:text-violet-300 hover:underline">
            Compare plans
          </Link>
        )}
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="flex items-start gap-2">
          <Sparkles size={14} className="text-violet-600 dark:text-violet-300 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            {view.intros ? (
              <Bar
                used={view.intros.used}
                cap={view.intros.cap}
                label="Warm intros / quarter"
                hint={view.intros.quarter ? `Resets ${view.intros.quarter}` : null}
              />
            ) : <UnreadableRow label="Warm intros / quarter" />}
          </div>
        </div>
        <div className="flex items-start gap-2">
          <Handshake size={14} className="text-violet-600 dark:text-violet-300 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            {view.dealrooms ? (
              <Bar
                used={view.dealrooms.used}
                cap={view.dealrooms.cap}
                label="Active deal rooms"
                hint={view.dealrooms.cap >= 100000 ? 'No cap on your plan.' : null}
              />
            ) : <UnreadableRow label="Active deal rooms" />}
          </div>
        </div>
      </div>
      {view.planUnreadable && (
        <p className="mt-3 text-[11px] text-gray-500 dark:text-gray-400" data-testid="status-quota-plan-unreadable">
          Your plan status could not be read ·{' '}
          <button type="button" className="font-semibold text-violet-700 hover:underline dark:text-violet-300" onClick={onRetry}>Try again</button>
        </p>
      )}
    </div>
  );
}
