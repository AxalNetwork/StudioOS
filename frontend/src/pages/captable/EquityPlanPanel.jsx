import React, { useEffect, useState } from 'react';
import { Layers, Info } from 'lucide-react';
import { api } from '../../lib/api';

// Equity plan — option pools and vesting grants (Wave 2).
//
// The Cap Table Pro canvas asks for "a grant-level pool burn-down ledger with
// vesting". Both tables have existed since migration 057 and are written on
// every Carta sync; the only file in the worker that named either of them was
// the importer. A founder who connected Carta had this in D1 and was never
// shown it.
//
// Every number below is a share count that came from the provider. Nothing is
// modelled: vested totals are reported as imported rather than recomputed from
// the dates, because putting a second, differently-derived vested number in
// front of a founder is worse than showing the provider's own answer with a
// date on it.
//
// What this panel does NOT do — and why — is the SAFE conversion detail the
// same canvas asks for (cap vs discount, MFN inheritance). Those terms are not
// stored anywhere: `valuation_cap` exists only on `deals` (the investor-side
// pipeline), and `discount_rate` and MFN appear in no table. Rendering a
// conversion from terms the database does not hold would be inventing
// fiduciary numbers.

function fmtShares(n) {
  if (n == null) return 'Not recorded';
  const v = Number(n);
  if (!Number.isFinite(v)) return 'Not recorded';
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export default function EquityPlanPanel() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.getEquityPlan()
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setErr(e?.message || 'Could not load the equity plan'); });
    return () => { cancelled = true; };
  }, []);

  if (err) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
        <p className="text-sm text-red-600 dark:text-red-400">{err}</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
        <p className="text-sm text-gray-500">Loading equity plan…</p>
      </div>
    );
  }

  const { pools = [], grants = [], summary = {} } = data;
  const empty = pools.length === 0 && grants.length === 0;

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
      <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 inline-flex items-center gap-2">
          <Layers size={15} className="text-violet-500" /> Equity plan
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Option pools and vesting grants, as recorded by your cap-table provider.
        </p>
      </div>

      <div className="p-5 space-y-5">
        {empty ? (
          <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-sm text-gray-500 dark:text-gray-400">
            <p className="font-medium text-gray-700 dark:text-gray-300">No option pool or grants recorded.</p>
            <p className="mt-1">
              Connect Carta under Settings → Integrations and your pools and vesting
              schedules appear here on the next sync.
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                ['Authorized', summary.shares_authorized],
                ['Issued', summary.shares_issued],
                ['Available', summary.shares_available],
                ['Unvested', summary.unvested_shares],
              ].map(([label, v]) => (
                <div key={label} className="rounded-xl border border-gray-200 dark:border-gray-800 p-4">
                  <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</div>
                  <div className="text-lg font-bold text-gray-900 dark:text-white mt-0.5 tabular-nums">
                    {fmtShares(v)}
                  </div>
                  <div className="text-[11px] text-gray-400 mt-0.5">shares</div>
                </div>
              ))}
            </div>

            {pools.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
                  Pools ({pools.length})
                </h3>
                <div className="rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
                  {pools.map((p) => {
                    const auth = Number(p.shares_authorized) || 0;
                    const issued = Number(p.shares_issued) || 0;
                    const pct = auth > 0 ? Math.min(100, Math.round((issued / auth) * 100)) : null;
                    return (
                      <div key={p.id} className="p-3">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{p.name}</span>
                          <span className="text-xs text-gray-500 dark:text-gray-400 tabular-nums whitespace-nowrap">
                            {fmtShares(p.shares_issued)} / {fmtShares(p.shares_authorized)}
                          </span>
                        </div>
                        {pct !== null && (
                          <div className="mt-2 h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                            <div className="h-full bg-violet-500" style={{ width: `${pct}%` }} />
                          </div>
                        )}
                        <div className="text-[11px] text-gray-400 mt-1.5">
                          {fmtShares(p.shares_available)} available · {p.source} · as of {fmtDate(p.as_of)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {grants.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
                  Grants ({grants.length})
                </h3>
                <div className="rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
                  {grants.map((g) => {
                    const total = Number(g.total_shares) || 0;
                    const vested = Number(g.vested_shares) || 0;
                    const pct = total > 0 ? Math.min(100, Math.round((vested / total) * 100)) : null;
                    return (
                      <div key={g.id} className="p-3">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-sm text-gray-900 dark:text-gray-100">
                            Grant #{g.id}
                            {g.start_date && (
                              <span className="text-xs text-gray-500 dark:text-gray-400"> · from {fmtDate(g.start_date)}</span>
                            )}
                          </span>
                          <span className="text-xs text-gray-500 dark:text-gray-400 tabular-nums whitespace-nowrap">
                            {fmtShares(g.vested_shares)} / {fmtShares(g.total_shares)} vested
                          </span>
                        </div>
                        {pct !== null && (
                          <div className="mt-2 h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                            <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
                          </div>
                        )}
                        <div className="text-[11px] text-gray-400 mt-1.5">
                          {g.cliff_months != null ? `${g.cliff_months}-month cliff` : 'Cliff not recorded'}
                          {' · '}
                          {g.total_months != null ? `${g.total_months}-month term` : 'Term not recorded'}
                          {' · '}{g.source} · as of {fmtDate(g.as_of)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}

        <div className="flex items-start gap-2 text-[11px] text-gray-500 dark:text-gray-400">
          <Info size={13} className="mt-0.5 flex-shrink-0" />
          <span>
            Vested amounts are shown exactly as your provider reported them, not
            recalculated from the dates. SAFE conversion detail (cap vs discount,
            MFN) is <strong>not shown</strong>: those terms are not stored, and
            deriving them would mean inventing the numbers.
          </span>
        </div>
      </div>
    </div>
  );
}
