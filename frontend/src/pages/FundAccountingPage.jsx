import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Calculator } from 'lucide-react';
import { StatCard, Section, Chip, FilterChips, EmptyState } from './advisor/network/kit';
import ErrorState from '../components/ErrorState';
import Skeleton from '../components/Skeleton';
import FundLedgerPanel from './investor/FundLedgerPanel';
import InfoStrip from '../components/InfoStrip';
import { api } from '../lib/api';
import {
  useFundAnalytics, fmtCents, fmtRate, Unrecorded,
} from '../lib/fundAnalytics';

/** Fund accounting: D628 operational ledger plus existing capital accounts and issued reports. */

const fmtExact = (cents) =>
  cents == null ? null : `$${Math.round(Number(cents) / 100).toLocaleString()}`;

/** Legacy limited_partners money columns are dollars; display-only here. */
const dollarsToCents = (v) => Math.round((Number(v) || 0) * 100);

export default function FundAccountingPage({ embedded = false }) {
  const { items, loading, error, reload } = useFundAnalytics();
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
        Not recorded: no capital account data is available.
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
            'Capital accounts and issued reports retain their recorded sources. The '
            + 'operational ledger below reads explicitly posted fees and expenses by '
            + 'fund and period. Missing entries remain Not recorded; a failed read is Unreadable.'
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

        <FundLedgerPanel />

        <Section title="Carry setting">
          <StatCard label="Carried interest setting" value={fmtRate(activeFund?.carried_interest) || <Unrecorded reason="No carry setting is recorded." />} hint="Fund setting; no carry accrual is inferred" />
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

  if (embedded) return loading || error || items.length === 0 ? <div className="space-y-6"><FundLedgerPanel />{content}</div> : content;
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <Calculator className="w-6 h-6 text-violet-600" /> Fund Accounting
        </h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
          Operational ledger, LP capital accounts and issued reporting periods.
        </p>
      </div>
      {loading || error || items.length === 0 ? <div className="space-y-6"><FundLedgerPanel />{content}</div> : content}
    </div>
  );
}
