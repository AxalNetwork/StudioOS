import React, { useMemo, useState } from 'react';
import { Building2 } from 'lucide-react';
import {
  CLIENTS, CLIENT_SEGMENTS, money, formatDay, formatRelativeDay,
} from '../../../data/advisor/advisory';
import {
  FilterChips, StatCard, SlideOver, Section, Field, StatusBadge, BulletList,
  ProgressBar, Timeline, RowCard, EmptyState, Chip,
} from './kit';

// Clients — account workspace. Segmented client list; each opens a detail panel
// with the company profile, engagement history/timeline, and a health scorecard.

export default function ClientsPage() {
  const [segment, setSegment] = useState('all');
  const [selectedId, setSelectedId] = useState(null);

  const filterOptions = useMemo(() => ([
    { id: 'all', label: 'All', count: CLIENTS.length },
    ...CLIENT_SEGMENTS.map((s) => ({ id: s.id, label: s.label, count: CLIENTS.filter((c) => c.segment === s.id).length })),
  ]), []);

  const visible = useMemo(
    () => CLIENTS.filter((c) => segment === 'all' || c.segment === segment),
    [segment],
  );

  const stats = useMemo(() => {
    const active = CLIENTS.filter((c) => c.segment !== 'past');
    const arr = active.reduce((a, c) => a + (c.annualRevenue || 0), 0);
    const ltv = CLIENTS.reduce((a, c) => a + (c.lifetimeValue || 0), 0);
    const avgHealth = Math.round(active.reduce((a, c) => a + c.health.engagementScore, 0) / (active.length || 1));
    return { activeCount: active.length, arr, ltv, avgHealth };
  }, []);

  const selected = CLIENTS.find((c) => c.id === selectedId) || null;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Active clients" value={stats.activeCount} hint="Active + strategic" />
        <StatCard label="Annual revenue" value={money(stats.arr)} hint="Recurring across accounts" />
        <StatCard label="Lifetime value" value={money(stats.ltv)} hint="All clients" />
        <StatCard label="Avg. health" value={stats.avgHealth} hint="Engagement score" />
      </div>

      <FilterChips options={filterOptions} value={segment} onChange={setSegment} />

      {visible.length === 0 ? (
        <EmptyState>No clients in this segment.</EmptyState>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {visible.map((c) => (
            <RowCard key={c.id} onClick={() => setSelectedId(c.id)}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold text-gray-900 dark:text-gray-100 truncate flex items-center gap-1.5">
                    <Building2 size={14} className="text-gray-400" /> {c.name}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
                    {c.profile.industry} · {c.profile.stage}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <StatusBadge status={c.status} />
                  <Chip tone={c.segment === 'strategic' ? 'violet' : c.segment === 'past' ? 'gray' : 'emerald'}>
                    {CLIENT_SEGMENTS.find((s) => s.id === c.segment)?.label}
                  </Chip>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[11px] text-gray-500 dark:text-gray-400">Lifetime value</div>
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{money(c.lifetimeValue)}</div>
                </div>
                <div>
                  <div className="text-[11px] text-gray-500 dark:text-gray-400 mb-1">Health</div>
                  <ProgressBar value={c.health.engagementScore} tone={c.health.engagementScore >= 75 ? 'emerald' : c.health.engagementScore >= 50 ? 'amber' : 'violet'} />
                </div>
              </div>
            </RowCard>
          ))}
        </div>
      )}

      <ClientDetail client={selected} onClose={() => setSelectedId(null)} />
    </div>
  );
}

function ClientDetail({ client, onClose }) {
  if (!client) return <SlideOver open={false} onClose={onClose} />;
  const p = client.profile;
  const h = client.health;
  return (
    <SlideOver open onClose={onClose} title={client.name} subtitle={`${p.industry} · ${p.stage}`}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={client.status} />
        <Chip tone="violet">{CLIENT_SEGMENTS.find((s) => s.id === client.segment)?.label}</Chip>
        <Chip>Client since {formatDay(client.since)}</Chip>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Lifetime value" value={money(client.lifetimeValue)} />
        <StatCard label="Annual revenue" value={money(client.annualRevenue)} />
      </div>

      <Section title="Company profile">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Industry">{p.industry}</Field>
          <Field label="Stage">{p.stage}</Field>
          <Field label="Business model">{p.businessModel}</Field>
          <Field label="Revenue">{p.revenue}</Field>
          <Field label="Funding">{p.funding}</Field>
          <Field label="Markets">{p.markets.join(', ')}</Field>
        </div>
        <div className="mt-3">
          <Field label="Products"><div className="flex flex-wrap gap-1.5 mt-1">{p.products.map((pr) => <Chip key={pr}>{pr}</Chip>)}</div></Field>
        </div>
      </Section>

      <Section title="Challenges"><BulletList items={p.challenges} tone="rose" /></Section>
      <Section title="Goals"><BulletList items={p.goals} tone="emerald" /></Section>

      <Section title="Health scorecard">
        <div className="space-y-3">
          <HealthRow label="Engagement score" value={h.engagementScore} />
          <HealthRow label="Satisfaction" value={h.satisfaction} />
          <HealthRow label="Goal progress" value={h.goalProgress} />
          <HealthRow label="Renewal probability" value={h.renewalProbability} />
          <div className="grid grid-cols-2 gap-4 pt-1">
            <Field label="Responsiveness"><StatusBadge status={h.responsiveness} /></Field>
          </div>
        </div>
      </Section>

      <Section title="Expansion opportunities"><BulletList items={h.expansion} tone="violet" /></Section>

      <Section title="Engagement history">
        <Timeline events={[...client.history].reverse()} renderMeta={(e) => `${formatDay(e.date)} · ${formatRelativeDay(e.date)}`} />
      </Section>
    </SlideOver>
  );
}

function HealthRow({ label, value }) {
  const tone = value >= 75 ? 'emerald' : value >= 50 ? 'amber' : 'rose';
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-gray-600 dark:text-gray-400">{label}</span>
      </div>
      <ProgressBar value={value} tone={tone} />
    </div>
  );
}
