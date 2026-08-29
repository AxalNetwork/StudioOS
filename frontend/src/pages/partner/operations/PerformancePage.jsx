import React, { useEffect, useState } from 'react';
import { Info } from 'lucide-react';
import { api } from '../../../lib/api';
import {
  Chip, Section, StatCard, EmptyState, Stars, formatDay, moneyUsd,
} from './kit';

// Performance — the live BD scorecard (Wave 1a; previously a fixture of
// invented ratings, NPS and response-time metrics).
//
// Everything shown is computed by services/bdAnalytics.ts over the partner's
// real quotes and engagements, plus the reviews founders actually left. The
// win rate shows its work (win_rate_basis) rather than presenting a bare
// percentage, and metrics with no backing data — NPS, response times — are
// stated as not tracked instead of being invented.
export default function PerformancePage() {
  const [analytics, setAnalytics] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const a = await api.quotesAnalytics();
        setAnalytics(a);
      } catch (e) {
        setError(e?.message || 'Could not load analytics.');
      }
      // Founder reviews across recent completed engagements (bounded fetch).
      try {
        const eng = await api.listEngagements();
        const done = (eng.items || [])
          .filter((x) => ['delivered', 'reviewed', 'invoiced'].includes(x.status))
          .slice(0, 12);
        const all = [];
        for (const e of done) {
          try {
            const r = await api.listEngagementReviews(e.id);
            for (const rv of r.items || []) {
              if (rv.reviewer_role === 'founder') all.push({ ...rv, engagement: e });
            }
          } catch { /* one unreadable engagement must not blank the page */ }
        }
        all.sort((x, y) => String(y.created_at).localeCompare(String(x.created_at)));
        setFeedback(all);
      } catch { setFeedback([]); }
      setLoading(false);
    })();
  }, []);

  if (loading) {
    return <div className="py-16 text-center text-sm text-gray-500 dark:text-gray-400">Computing your scorecard…</div>;
  }

  const p = analytics?.pipeline || null;
  const f = analytics?.forecast || null;
  const d = analytics?.delivery || null;
  const avgRating = feedback?.length
    ? feedback.reduce((a, r) => a + (Number(r.rating) || 0), 0) / feedback.length
    : null;

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-900/20 px-4 py-2.5 text-sm text-rose-700 dark:text-rose-300">{error}</div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard
          label="Win rate"
          value={p?.win_rate_pct != null ? `${p.win_rate_pct}%` : '—'}
          hint={p?.win_rate_pct != null ? `${p.accepted} of ${p.accepted + p.rejected} decided` : 'no decided quotes yet'}
        />
        <StatCard label="Open proposals" value={p ? p.pending : '—'} hint={p ? moneyUsd(p.open_value) : undefined} />
        <StatCard label="Won value" value={p ? moneyUsd(p.won_value) : '—'} hint={p?.average_deal_size != null ? `avg ${moneyUsd(p.average_deal_size)}` : undefined} />
        <StatCard
          label="Decision cycle"
          value={p?.median_cycle_days != null ? `${p.median_cycle_days}d` : '—'}
          hint="median, submit → decision"
        />
        <StatCard label="Active engagements" value={d ? d.active : '—'} hint={d ? moneyUsd(d.active_value) : undefined} />
        <StatCard
          label="Completion rate"
          value={d?.completion_rate_pct != null ? `${d.completion_rate_pct}%` : '—'}
          hint={d ? `${d.delivered} delivered · ${d.cancelled} cancelled` : undefined}
        />
      </div>

      {p?.win_rate_basis && (
        <div className="flex items-start gap-2 text-xs text-gray-500 dark:text-gray-400">
          <Info size={13} className="mt-0.5 flex-shrink-0" />
          <span>{p.win_rate_basis}</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Section title="Weighted forecast (open pipeline)">
          {f && f.by_stage?.length ? (
            <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 divide-y divide-gray-100 dark:divide-gray-800">
              {f.by_stage.map((s) => (
                <div key={s.stage} className="flex items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <div className="text-sm text-gray-900 dark:text-gray-100 capitalize">{s.stage}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {s.count} × weighted at {Math.round(s.weight * 100)}%
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold tabular-nums">{moneyUsd(s.weighted)}</div>
                    <div className="text-[11px] text-gray-400 tabular-nums">of {moneyUsd(s.value)}</div>
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-between gap-3 p-3 bg-gray-50/60 dark:bg-gray-800/40">
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">Weighted total</span>
                <span className="text-sm font-bold tabular-nums">{moneyUsd(f.weighted_value)}</span>
              </div>
            </div>
          ) : (
            <EmptyState>No open proposals to forecast. Send proposals from Engagements → Open requests.</EmptyState>
          )}
          {f?.note && <p className="text-[11px] text-gray-400 mt-2">{f.note}</p>}
        </Section>

        <Section title={`Founder feedback${feedback?.length ? ` (${feedback.length})` : ''}`}>
          {avgRating != null && (
            <div className="mb-2.5 flex items-center gap-2">
              <Stars value={avgRating} />
              <span className="text-xs text-gray-500 dark:text-gray-400">across {feedback.length} review{feedback.length === 1 ? '' : 's'}</span>
            </div>
          )}
          {!feedback || feedback.length === 0 ? (
            <EmptyState>
              No founder reviews yet. Reviews are left by founders after you
              mark an engagement delivered — they cannot be authored here.
            </EmptyState>
          ) : (
            <div className="space-y-2.5">
              {feedback.slice(0, 8).map((r) => (
                <div key={r.id || r.uid} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3.5">
                  <div className="flex items-center justify-between">
                    <Stars value={r.rating} showValue={false} />
                    <span className="text-[11px] text-gray-400">{formatDay(r.created_at)}</span>
                  </div>
                  {r.comment && <p className="text-sm text-gray-700 dark:text-gray-300 mt-2">“{r.comment}”</p>}
                  {r.engagement?.need_title && (
                    <div className="mt-2.5 pt-2.5 border-t border-gray-100 dark:border-gray-800">
                      <Chip>{r.engagement.need_title}</Chip>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>

      <p className="text-[11px] text-gray-400 dark:text-gray-500">
        Response-time and NPS metrics are not tracked yet, so they are not shown.
        Every figure on this page is computed from your quotes, engagements and
        founder reviews.
      </p>
    </div>
  );
}
