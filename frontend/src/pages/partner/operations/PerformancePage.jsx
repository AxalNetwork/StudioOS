import React from 'react';
import {
  Clock, Target, Activity as ActivityIcon, CheckCircle2, Calendar,
} from 'lucide-react';
import {
  SCORECARD, RATINGS, FEEDBACK, OUTCOMES, RESPONSE_METRICS, ACTIVITY, formatRelativeDay,
} from '../../../data/partner/operations';
import {
  Avatar, Chip, Section, StatCard, EmptyState, Stars,
} from './kit';

// Performance — operational scorecard. Summary stat cards, category ratings,
// client feedback, business outcomes, response-time metrics, and recent activity.
export default function PerformancePage() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {SCORECARD.map((s) => <StatCard key={s.label} label={s.label} value={s.value} hint={s.hint} />)}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Section title="Ratings">
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 divide-y divide-gray-100 dark:divide-gray-800">
            {RATINGS.map((r) => (
              <div key={r.category} className="flex items-center justify-between gap-3 p-3">
                <span className="text-sm text-gray-900 dark:text-gray-100">{r.category}</span>
                <Stars value={r.score} />
              </div>
            ))}
          </div>
        </Section>

        <Section title="Response time">
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 divide-y divide-gray-100 dark:divide-gray-800">
            {RESPONSE_METRICS.map((m) => (
              <div key={m.label} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <div className="text-sm text-gray-900 dark:text-gray-100 inline-flex items-center gap-1.5"><Clock size={13} className="text-violet-500" /> {m.label}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Target {m.target}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{m.value}</div>
                  {m.met && <span className="text-[11px] text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-0.5"><CheckCircle2 size={11} /> Met</span>}
                </div>
              </div>
            ))}
          </div>
        </Section>
      </div>

      <Section title="Outcomes">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {OUTCOMES.map((o) => (
            <div key={o.label} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
              <Target size={16} className="text-violet-500" />
              <div className="text-2xl font-bold text-gray-900 dark:text-white mt-2">{o.value}</div>
              <div className="text-xs font-medium text-gray-700 dark:text-gray-300 mt-1">{o.label}</div>
              <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{o.hint}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Client feedback">
        {FEEDBACK.length === 0 ? (
          <EmptyState>No feedback yet.</EmptyState>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {FEEDBACK.map((f) => (
              <div key={f.id} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
                <div className="flex items-center justify-between">
                  <Stars value={f.rating} showValue={false} />
                  <span className="text-xs text-gray-400 dark:text-gray-500">{formatRelativeDay(f.date)}</span>
                </div>
                <p className="text-sm text-gray-700 dark:text-gray-300 mt-2">“{f.comment}”</p>
                <div className="flex items-center gap-2.5 mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
                  <Avatar name={f.author} size={32} />
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{f.author}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{f.client}</div>
                  </div>
                  <Chip className="ml-auto">{f.project}</Chip>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Recent activity">
        {ACTIVITY.length === 0 ? (
          <EmptyState>No recent activity.</EmptyState>
        ) : (
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
            {ACTIVITY.map((a) => (
              <div key={a.id} className="flex items-start gap-3 p-3">
                <div className="w-8 h-8 rounded-lg bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-300 flex items-center justify-center flex-shrink-0">
                  <ActivityIcon size={15} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-gray-900 dark:text-gray-100">{a.description}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 inline-flex items-center gap-1.5">
                    <Chip>{a.type}</Chip>
                    <span className="inline-flex items-center gap-1"><Calendar size={10} /> {formatRelativeDay(a.date)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
