import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Calculator } from 'lucide-react';
import { StatCard, Section, Chip, FilterChips, EmptyState } from './advisor/network/kit';
import ErrorState from '../components/ErrorState';
import Skeleton from '../components/Skeleton';
import InfoStrip from '../components/InfoStrip';
import { api } from '../lib/api';
import {
  useFundAnalytics, fmtCents, fmtRate, Unrecorded,
} from '../lib/fundAnalytics';

/**
 * Fund Accounting — /funds/accounting, a tab of FundOpsWorkspace.
 *
 * Four fabricated sections became two real ones and two refusals:
 *
 *   LP capital accounts  REAL. limited_partners carries commitment, invested
 *                        and returns per LP. A GP sees every LP via
 *                        /funds/:id/lps; an LP sees only their own rows via
 *                        /funds/lp-portal, which is why this page branches on
 *                        role rather than gating the whole tab to admin.
 *   Statements           REAL. /funds/:id/report-periods are the issued
 *                        quarterly periods, each frozen into snapshot_json —
 *                        the reason a re-rendered old report does not silently
 *                        pick up today's marks.
 *   Fee & carry          PART REAL. management_fee and carried_interest are
 *                        contracted terms and are shown. The accrual BY PERIOD
 *                        that the old chart plotted has no table behind it.
 *   Fund expenses        GONE. There is no expense ledger in the schema at
 *                        all, so the section is removed rather than emptied —
 *                        an empty table implies zero expenses, which is itself
 *                        a false claim about a fund.
 */

const fmtExact = (cents) =>
  cents == null ? null : `$${Math.round(Number(cents) / 100).toLocaleString()}`;

/** Legacy limited_partners money columns are dollars; display-only here. */
const dollarsToCents = (v) => Math.round((Number(v) || 0) * 100);

export default function FundAccountingPage({ embedded = false }) {
  const { items, unavailable, loading, error, reload } = useFundAnalytics();
  const [fundId, setFundId] = useState(null);
  const [accounts, setAccounts] = useState({ rows: null, loading: false, error: null, scope: null });
  const [periods, setPeriods] = useState({ rows: null, error: null });

  const activeFund = useMemo(
    () => items.find((f) => String(f.id) === String(fundId)) || items[0] || null,
    [items, fundId],
  );

  const loadFundDetail = useCallback((id) => {
    if (!id) return;
    setAccounts({ rows: null, loading: true, error: null, scope: null });
    // GP path first. A non-admin gets 403 here by design, so fall through to
    // the LP's own portal rather than showing them an error for a page that
    // legitimately has something to tell them.
    api.fundsLpsList(id)
      .then((d) => setAccounts({ rows: d?.items || [], loading: false, error: null, scope: 'all' }))
      .catch(() => api.fundsLpPortal()
        .then((d) => {
          const mine = (d?.lps || d?.items || []).filter((r) => String(r.fund_id) === String(id));
          setAccounts({ rows: mine, loading: false, error: null, scope: 'own' });
        })
        .catch((e) => setAccounts({ rows: null, loading: false, error: e?.message || 'Could not load capital accounts.', scope: null })));

    api.fundsReportPeriods(id)
      .then((d) => setPeriods({ rows: d?.items || d?.periods || [], error: null }))
      .catch((e) => setPeriods({ rows: null, error: e?.message || 'Could not load reporting periods.' }));
  }, []);

  useEffect(() => { if (activeFund?.id) loadFundDetail(activeFund.id); }, [activeFund?.id, loadFundDetail]);

  let content;
  if (loading) {
    content = (
      <div className="space-y-4" aria-busy="true">
        <Skeleton h={16} w="60%" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} h={88} rounded="rounded-xl" />)}
        </div>
        <Skeleton.Table rows={4} cols={5} />
      </div>
    );
  } else if (error) {
    content = <ErrorState message={error} onRetry={reload} />;
  } else if (items.length === 0) {
    content = (
      <EmptyState>
        No funds are recorded yet. Capital accounts appear here once a fund and its LPs exist.
      </EmptyState>
    );
  } else {
    const unfunded = activeFund
      ? Math.max(0, activeFund.committed_cents - activeFund.called_cents)
      : null;
    const rows = accounts.rows || [];

    content = (
      <div className="space-y-6">
        <InfoStrip
          variant="info"
          storageKey="funds-accounting-basis"
          title="What this page can and cannot account for"
          body={
            'Capital accounts and issued reporting periods are read from D1. The '
            + 'management fee and carry RATES are contracted terms and are shown; '
            + 'accrued amounts per period are not, because no ledger records them. '
            + 'There is no fund expense table at all, so no expense section is '
            + 'shown — an empty one would imply zero expenses.'
          }
        />

        {items.length > 1 && (
          <FilterChips
            options={items.map((f) => ({ id: String(f.id), label: f.name, count: f.lp_count }))}
            value={String(activeFund?.id ?? '')}
            onChange={setFundId}
          />
        )}

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            label="Total commitments"
            value={fmtCents(activeFund?.committed_cents)}
            hint={`${activeFund?.lp_count || 0} LP${activeFund?.lp_count === 1 ? '' : 's'}`}
          />
          <StatCard label="Contributed" value={fmtCents(activeFund?.called_cents)} hint="Paid in to date" />
          <StatCard label="Distributed" value={fmtCents(activeFund?.distributed_cents)} hint="Returned to LPs" />
          <StatCard label="Unfunded" value={fmtCents(unfunded)} hint="Commitment not yet called" />
        </div>

        <Section title="Management fee & carry">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <StatCard
              label="Management fee"
              value={fmtRate(activeFund?.management_fee) || <Unrecorded reason="No management fee rate is set on this fund." />}
              hint="Contracted rate"
            />
            <StatCard
              label="Carried interest"
              value={fmtRate(activeFund?.carried_interest) || <Unrecorded reason="No carry rate is set on this fund." />}
              hint="Contracted rate"
            />
            <StatCard
              label="Accrued to date"
              value={<Unrecorded reason={unavailable.fee_accrual} />}
              hint={unavailable.fee_accrual}
            />
          </div>
        </Section>

        <Section
          title="LP capital accounts"
          action={accounts.scope === 'own'
            ? <Chip tone="blue">Your positions only</Chip>
            : accounts.scope === 'all' ? <Chip tone="violet">All LPs</Chip> : null}
        >
          {accounts.loading ? (
            <Skeleton.Table rows={4} cols={5} />
          ) : accounts.error ? (
            <ErrorState message={accounts.error} onRetry={() => loadFundDetail(activeFund?.id)} />
          ) : rows.length === 0 ? (
            <EmptyState>No LP is recorded against this fund yet.</EmptyState>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-900/60 text-gray-500 dark:text-gray-400">
                  <tr>
                    <th className="text-left font-medium px-4 py-2.5">Limited partner</th>
                    <th className="text-left font-medium px-4 py-2.5">Status</th>
                    <th className="text-right font-medium px-4 py-2.5">Commitment</th>
                    <th className="text-right font-medium px-4 py-2.5">Contributed</th>
                    <th className="text-right font-medium px-4 py-2.5">Unfunded</th>
                    <th className="text-right font-medium px-4 py-2.5">Returned</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {rows.map((lp) => {
                    const commitment = dollarsToCents(lp.commitment_amount);
                    const contributed = dollarsToCents(lp.invested_amount);
                    return (
                      <tr key={lp.id} className="bg-white dark:bg-gray-900">
                        <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-gray-100">
                          {lp.name || lp.email || `LP #${lp.id}`}
                        </td>
                        <td className="px-4 py-2.5">
                          <Chip tone={lp.lpa_signed ? 'emerald' : 'gray'}>
                            {lp.lpa_signed ? 'LPA signed' : 'LPA unsigned'}
                          </Chip>
                        </td>
                        <td className="px-4 py-2.5 text-right text-gray-600 dark:text-gray-400">{fmtExact(commitment)}</td>
                        <td className="px-4 py-2.5 text-right text-gray-600 dark:text-gray-400">{fmtExact(contributed)}</td>
                        <td className="px-4 py-2.5 text-right text-gray-600 dark:text-gray-400">
                          {fmtExact(Math.max(0, commitment - contributed))}
                        </td>
                        <td className="px-4 py-2.5 text-right font-medium text-gray-900 dark:text-gray-100">
                          {fmtExact(dollarsToCents(lp.returns))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <Section title="Issued reporting periods">
          {periods.error ? (
            <ErrorState message={periods.error} onRetry={() => loadFundDetail(activeFund?.id)} />
          ) : !periods.rows || periods.rows.length === 0 ? (
            <EmptyState>
              No reporting period has been issued for this fund. Issuing one freezes the
              period&apos;s figures so a report re-rendered later cannot pick up today&apos;s marks.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-800 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
              {periods.rows.map((p) => (
                <li key={p.id || p.period} className="flex items-center justify-between px-4 py-2.5 bg-white dark:bg-gray-900">
                  <span className="font-medium text-gray-900 dark:text-gray-100">{p.period || p.label || `Period ${p.id}`}</span>
                  <Chip tone={p.issued_at ? 'emerald' : 'gray'}>
                    {p.issued_at ? `Issued ${String(p.issued_at).slice(0, 10)}` : 'Draft'}
                  </Chip>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    );
  }

  if (embedded) return content;
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <Calculator className="w-6 h-6 text-violet-600" /> Fund Accounting
        </h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
          LP capital accounts, contracted terms and issued reporting periods.
        </p>
      </div>
      {content}
    </div>
  );
}
