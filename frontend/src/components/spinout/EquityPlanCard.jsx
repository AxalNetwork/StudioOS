// Option pools and vesting grants (D364) — GET /api/captable/equity-plan, the
// Carta-synced tables (migration 057) that nothing on the Lab read.
//
// What the store is, said on the card: it is per ACCOUNT, not per startup
// (both tables are keyed by user_id), and only a Carta sync fills it. Vested
// counts are shown as Carta reported them, never recomputed from the dates,
// with the date each row was written. Nothing recorded is "Not recorded",
// with where the terms live instead; a failed read is Unreadable.

import React from 'react';
import { Link } from 'react-router-dom';
import { Unreadable, Unrecorded } from '../../ui';

const CARD = 'rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-5';
const LBL = 'text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500';
const shares = (v) => (Number.isFinite(v) ? Math.round(v).toLocaleString() : null);
const day = (s) => (s ? String(s).slice(0, 10) : null);

/** A grant's vested fraction from the two imported counts, or null. */
export function vestedFraction(g) {
  if (!Number.isFinite(g?.total_shares) || g.total_shares <= 0 || !Number.isFinite(g?.vested_shares)) return null;
  return Math.max(0, Math.min(1, g.vested_shares / g.total_shares));
}

export default function EquityPlanCard({ plan, failed, onRetry }) {
  if (failed) {
    return (
      <div className={CARD} data-testid="card-equity-plan">
        <div className={`${LBL} mb-2`}>Option pools &amp; vesting · Carta</div>
        <Unreadable what="Your Carta option pools and vesting" claim="This is not a claim that none are recorded." onRetry={onRetry} />
      </div>
    );
  }
  if (!plan) return null; // Worker-only endpoint: absent in dev, so no card.
  const pools = Array.isArray(plan.pools) ? plan.pools : [];
  const grants = Array.isArray(plan.grants) ? plan.grants : [];
  return (
    <div className={CARD} data-testid="card-equity-plan">
      <div className={`${LBL} mb-1`}>Option pools &amp; vesting · Carta</div>
      <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-3">
        From your account's Carta sync, not from this startup's scenario. Vested counts are as Carta reported them.
      </p>
      {pools.length === 0 && grants.length === 0 ? (
        <div className="text-[12px] text-gray-600 dark:text-gray-300" data-testid="equity-plan-unrecorded">
          <Unrecorded reason="Only a Carta sync records option pools and vesting grants.">No pools or grants recorded</Unrecorded>
          <p className="mt-1.5 text-[11.5px] text-gray-500 dark:text-gray-400">
            Without Carta, founder vesting terms live in your{' '}
            <Link to="/spinout-lab/cofounder-agreement" className="text-violet-600 hover:underline">Co-founder Agreement</Link>.
          </p>
        </div>
      ) : (
        <>
          {pools.map((p) => (
            <div key={p.id} className="text-[12px] mb-2" data-testid="equity-pool">
              <div className="font-semibold text-gray-800 dark:text-gray-100">{p.name || 'Option pool'}</div>
              <div className="text-gray-500 dark:text-gray-400 tabular-nums">
                {shares(p.shares_authorized) ?? 'Authorized not recorded'} authorized · {shares(p.shares_issued) ?? 'issued not recorded'} issued · {shares(p.shares_available) ?? 'available not recorded'} available
                {day(p.as_of) ? ` · as of ${day(p.as_of)}` : ''}
              </div>
            </div>
          ))}
          {grants.length > 0 && (
            <div className="mt-3 space-y-2" data-testid="equity-grants">
              {grants.map((g) => {
                const f = vestedFraction(g);
                return (
                  <div key={g.id} className="text-[11.5px]">
                    <div className="flex justify-between text-gray-600 dark:text-gray-300 tabular-nums">
                      <span>Grant {g.security_id || g.id}{day(g.start_date) ? ` · from ${day(g.start_date)}` : ''}{Number.isFinite(g.cliff_months) ? ` · ${g.cliff_months}-mo cliff` : ''}</span>
                      <span>{shares(g.vested_shares) ?? '—'} of {shares(g.total_shares) ?? '—'} vested</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden mt-1">
                      {f !== null && <div className="h-full bg-violet-600" style={{ width: `${Math.round(f * 100)}%` }} />}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
