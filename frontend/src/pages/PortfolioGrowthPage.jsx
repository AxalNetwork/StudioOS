import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Rocket } from 'lucide-react';
import { StatCard, Section, Chip, FilterChips, EmptyState } from './advisor/network/kit';
import ErrorState from '../components/ErrorState';
import Skeleton from '../components/Skeleton';
import InfoStrip from '../components/InfoStrip';
import { api } from '../lib/api';

/**
 * Portfolio Growth — /portfolio/growth, a tab of PortfolioWorkspace.
 *
 * The page had three sections and read data/portfolioAnalytics.js for all of
 * them, with zero API calls. Checked one at a time against the schema:
 *
 *   Introductions        REAL, and previously UNSERVED. investor_introductions
 *                        is a live table and GET /api/introductions/ had no
 *                        consumer anywhere in the app — a working endpoint
 *                        with no UI, sitting next to a mock of itself.
 *                        Now wired, along with the real quarterly quota.
 *   Initiatives board    WITHDRAWN. There is no growth_initiatives,
 *                        value_creation or portfolio_initiative table
 *                        anywhere in cloudflare-worker/sql. Progress bars and
 *                        KPI chips over a table that does not exist are not a
 *                        wiring gap, they are a claim about portfolio
 *                        companies nobody made.
 *   Growth benchmarks    WITHDRAWN. "Portfolio median vs industry median"
 *                        needs a licensed industry dataset. Same call as the
 *                        Funds research tab (DECISIONS.md D9): it returns when
 *                        a source is licensed, not before.
 *
 * One correction worth recording: the fixture gave each introduction a
 * talent/customer/capital `type`, and the filter chips were built on it.
 * investor_introductions has no such column, so the filter is by `status`,
 * which is real. Keeping the old chips would have meant deriving the type
 * from nothing.
 */

const STATUS_TONE = {
  accepted: 'emerald',
  meeting_set: 'emerald',
  in_progress: 'violet',
  pending: 'blue',
  requested: 'blue',
  declined: 'gray',
};

const titleCase = (s) =>
  String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) || 'Unknown';

export default function PortfolioGrowthPage({ embedded = false }) {
  const [intros, setIntros] = useState({ rows: null, loading: true, error: null });
  const [quota, setQuota] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');

  const load = useCallback(() => {
    setIntros((s) => ({ ...s, loading: true, error: null }));
    api.listIntroductions()
      .then((d) => setIntros({ rows: d?.introductions || [], loading: false, error: null }))
      .catch((e) => setIntros({ rows: null, loading: false, error: e?.message || 'Could not load introductions.' }));
    // The quota is a nice-to-have beside the list; a failure here must not
    // blank the list itself, so it fails quietly into "no quota shown".
    api.introductionsQuota().then(setQuota).catch(() => setQuota(null));
  }, []);

  useEffect(() => load(), [load]);

  const rows = intros.rows || [];

  const statusOptions = useMemo(() => {
    const counts = rows.reduce((acc, r) => {
      const k = r.status || 'unknown';
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {});
    return [
      { id: 'all', label: 'All', count: rows.length },
      ...Object.keys(counts).map((s) => ({ id: s, label: titleCase(s), count: counts[s] })),
    ];
  }, [rows]);

  const visible = useMemo(
    () => (statusFilter === 'all' ? rows : rows.filter((r) => (r.status || 'unknown') === statusFilter)),
    [rows, statusFilter],
  );

  let content;
  if (intros.loading) {
    content = (
      <div className="space-y-4" aria-busy="true">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} h={88} rounded="rounded-xl" />)}
        </div>
        <Skeleton.Table rows={5} cols={4} />
      </div>
    );
  } else if (intros.error) {
    content = <ErrorState message={intros.error} onRetry={load} />;
  } else {
    const landed = rows.filter((r) => r.status === 'accepted' || r.status === 'meeting_set').length;
    content = (
      <div className="space-y-6">
        <InfoStrip
          variant="info"
          storageKey="portfolio-growth-scope"
          title="What this tab covers now"
          body={
            'Introductions are read from your live introduction record. The '
            + 'value-creation initiative board and the portfolio-vs-industry '
            + 'benchmark chart have been withdrawn: no table records growth '
            + 'initiatives, and industry benchmarks need a licensed dataset. '
            + 'Both returned invented numbers about real portfolio companies, '
            + 'so they are gone rather than left in place.'
          }
        />

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Introductions made" value={rows.length} hint="All time" />
          <StatCard label="Accepted or meeting set" value={landed} hint="Reached a conversation" />
          <StatCard
            label="Remaining this quarter"
            value={quota ? quota.remaining : '—'}
            hint={quota ? `${quota.used} of ${quota.cap} used · ${quota.quarter}` : 'Quota unavailable'}
          />
          <StatCard label="Tier" value={quota ? titleCase(quota.tier) : '—'} hint="Sets the quarterly cap" />
        </div>

        <Section title="Introductions">
          {rows.length > 0 && (
            <div className="mb-3">
              <FilterChips options={statusOptions} value={statusFilter} onChange={setStatusFilter} />
            </div>
          )}
          {rows.length === 0 ? (
            <EmptyState>
              No introduction has been requested yet. Requests you make appear here with their status.
            </EmptyState>
          ) : visible.length === 0 ? (
            <EmptyState>No introduction matches this filter.</EmptyState>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-900/60 text-gray-500 dark:text-gray-400">
                  <tr>
                    <th className="text-left font-medium px-4 py-2.5">Requested</th>
                    <th className="text-left font-medium px-4 py-2.5">Status</th>
                    <th className="text-left font-medium px-4 py-2.5">Quarter</th>
                    <th className="text-left font-medium px-4 py-2.5">Message</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {visible.map((r) => (
                    <tr key={r.uid} className="bg-white dark:bg-gray-900">
                      <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                        {String(r.created_at || '').slice(0, 10) || '—'}
                      </td>
                      <td className="px-4 py-2.5">
                        <Chip tone={STATUS_TONE[r.status] || 'gray'}>{titleCase(r.status)}</Chip>
                      </td>
                      <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400">{r.quarter || '—'}</td>
                      <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400 max-w-md truncate" title={r.message || ''}>
                        {r.message || <span className="italic text-gray-400 dark:text-gray-500">No message</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
          <Rocket className="w-6 h-6 text-violet-600" /> Portfolio Growth
        </h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
          Introductions you have requested across the portfolio, and your quarterly quota.
        </p>
      </div>
      {content}
    </div>
  );
}
