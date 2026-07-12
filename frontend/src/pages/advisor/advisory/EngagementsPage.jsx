import React, { useMemo, useState } from 'react';
import { Building2, Calendar, Clock } from 'lucide-react';
import {
  ENGAGEMENTS, ENGAGEMENT_MODELS, money, formatDay, formatRelativeDay,
} from '../../../data/advisor/advisory';
import {
  SubTabs, StatCard, SlideOver, Section, Field, StatusBadge, BulletList,
  ProgressBar, Checklist, RowCard, EmptyState, Chip,
} from './kit';

// Engagements — active delivery grouped by the five delivery models. Each model
// is a sub-tab (Projects, Retainers, Advisory Boards, Fractional Roles,
// Workshops); records open a model-specific detail panel.

export default function EngagementsPage() {
  const [model, setModel] = useState('projects');
  const [selectedId, setSelectedId] = useState(null);

  const stats = useMemo(() => {
    const all = Object.values(ENGAGEMENTS).flat();
    const active = all.filter((e) => ['Active', 'In progress'].includes(e.status));
    const mrr = (ENGAGEMENTS.retainers || []).filter((r) => r.status === 'Active').reduce((a, r) => a + (r.monthlyFee || 0), 0);
    return { total: all.length, active: active.length, mrr };
  }, []);

  const tabs = ENGAGEMENT_MODELS.map((m) => ({ id: m.id, label: `${m.label} (${(ENGAGEMENTS[m.id] || []).length})` }));
  const list = ENGAGEMENTS[model] || [];
  const selected = list.find((e) => e.id === selectedId) || null;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Total engagements" value={stats.total} hint="Across all models" />
        <StatCard label="Active" value={stats.active} hint="In progress or active" />
        <StatCard label="Retainer MRR" value={money(stats.mrr)} hint="Active retainers" />
        <StatCard label="Delivery models" value={ENGAGEMENT_MODELS.length} hint="Ways of working" />
      </div>

      <SubTabs tabs={tabs} value={model} onChange={setModel} />

      {list.length === 0 ? (
        <EmptyState>No engagements in this model.</EmptyState>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {list.map((e) => (
            <RowCard key={e.id} onClick={() => setSelectedId(e.id)}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold text-gray-900 dark:text-gray-100 truncate">{e.title}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5 flex items-center gap-1">
                    <Building2 size={12} className="text-gray-400" /> {e.client}
                  </div>
                </div>
                <StatusBadge status={e.status} />
              </div>
              <div className="mt-3">
                <ModelSummary model={model} e={e} />
              </div>
            </RowCard>
          ))}
        </div>
      )}

      <EngagementDetail model={model} engagement={selected} onClose={() => setSelectedId(null)} />
    </div>
  );
}

function ModelSummary({ model, e }) {
  if (model === 'projects') {
    return (
      <div>
        <div className="text-[11px] text-gray-500 dark:text-gray-400 mb-1">Progress</div>
        <ProgressBar value={e.progress} tone="violet" />
        <div className="text-xs text-gray-500 dark:text-gray-400 mt-2">Due {formatRelativeDay(e.end)}</div>
      </div>
    );
  }
  if (model === 'retainers') {
    return (
      <div className="flex flex-wrap gap-2">
        <Chip tone="violet">{money(e.monthlyFee)}/mo</Chip>
        <Chip>{e.hoursUsed}/{e.capacity} hrs used</Chip>
        {e.renewal && <Chip>Renews {formatRelativeDay(e.renewal)}</Chip>}
      </div>
    );
  }
  if (model === 'boards') {
    return (
      <div className="flex flex-wrap gap-2">
        <Chip tone="violet">{e.cadence}</Chip>
        {e.nextMeeting && <Chip><Calendar size={10} /> Next {formatRelativeDay(e.nextMeeting)}</Chip>}
      </div>
    );
  }
  if (model === 'fractional') {
    return (
      <div className="flex flex-wrap gap-2">
        <Chip tone="violet">{e.timeAllocation}</Chip>
        <Chip>{e.reporting}</Chip>
      </div>
    );
  }
  if (model === 'workshops') {
    return (
      <div className="flex flex-wrap gap-2">
        <Chip tone="violet">{e.workshopType}</Chip>
        <Chip><Calendar size={10} /> {formatDay(e.date)}</Chip>
        <Chip>{e.participants} people</Chip>
      </div>
    );
  }
  return null;
}

function EngagementDetail({ model, engagement, onClose }) {
  if (!engagement) return <SlideOver open={false} onClose={onClose} />;
  const e = engagement;
  return (
    <SlideOver open onClose={onClose} title={e.title} subtitle={e.client}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={e.status} />
        {e.start && <Chip>Started {formatDay(e.start)}</Chip>}
      </div>

      {model === 'projects' && <ProjectBlock e={e} />}
      {model === 'retainers' && <RetainerBlock e={e} />}
      {model === 'boards' && <BoardBlock e={e} />}
      {model === 'fractional' && <FractionalBlock e={e} />}
      {model === 'workshops' && <WorkshopBlock e={e} />}
    </SlideOver>
  );
}

function ProjectBlock({ e }) {
  return (
    <>
      <Section title="Progress"><ProgressBar value={e.progress} tone="violet" /></Section>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Start">{formatDay(e.start)}</Field>
        <Field label="Target end">{formatDay(e.end)} · {formatRelativeDay(e.end)}</Field>
      </div>
      <Section title="Objectives"><BulletList items={e.objectives} tone="emerald" /></Section>
      <Section title="Scope"><p className="text-sm text-gray-700 dark:text-gray-300">{e.scope}</p></Section>
      <Section title="Tasks"><Checklist items={e.tasks} /></Section>
      <Section title="Milestones">
        <Checklist items={e.milestones.map((m) => ({ label: `${m.label} — ${formatDay(m.date)}`, done: m.done }))} />
      </Section>
      <Section title="Deliverables"><BulletList items={e.deliverables} tone="violet" /></Section>
    </>
  );
}

function RetainerBlock({ e }) {
  const utilization = e.capacity ? Math.round((e.hoursUsed / e.capacity) * 100) : 0;
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Monthly fee" value={money(e.monthlyFee)} />
        <StatCard label="Hours / month" value={e.hoursPerMonth} />
      </div>
      <Section title={`Utilization — ${e.hoursUsed}/${e.capacity} hrs`}>
        <ProgressBar value={utilization} tone={utilization > 90 ? 'amber' : 'emerald'} />
      </Section>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Started">{formatDay(e.start)}</Field>
        <Field label="Renewal">{e.renewal ? `${formatDay(e.renewal)} · ${formatRelativeDay(e.renewal)}` : '—'}</Field>
      </div>
      <Section title="Scope"><p className="text-sm text-gray-700 dark:text-gray-300">{e.scope}</p></Section>
      <Section title="Services"><BulletList items={e.services} tone="violet" /></Section>
    </>
  );
}

function BoardBlock({ e }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Membership">{e.membership}</Field>
        <Field label="Cadence">{e.cadence}</Field>
        <Field label="Started">{formatDay(e.start)}</Field>
        <Field label="Next meeting">{formatDay(e.nextMeeting)} · {formatRelativeDay(e.nextMeeting)}</Field>
      </div>
      <Section title="Recommendations"><BulletList items={e.recommendations} tone="violet" /></Section>
      <Section title="Meetings">
        <div className="space-y-3">
          {e.meetings.map((m, i) => (
            <div key={i} className="rounded-lg border border-gray-200 dark:border-gray-800 p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{m.agenda}</span>
                <span className="text-[11px] text-gray-500 dark:text-gray-400">{formatDay(m.date)}</span>
              </div>
              <div className="mt-2"><BulletList items={m.decisions} tone="emerald" /></div>
            </div>
          ))}
        </div>
      </Section>
      <Section title="Materials"><BulletList items={e.materials} /></Section>
    </>
  );
}

function FractionalBlock({ e }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Role">{e.roleDefinition}</Field>
        <Field label="Time allocation">{e.timeAllocation}</Field>
        <Field label="Reporting">{e.reporting}</Field>
        <Field label="Start">{formatDay(e.start)} · {formatRelativeDay(e.start)}</Field>
      </div>
      <Section title="Responsibilities"><BulletList items={e.responsibilities} tone="violet" /></Section>
      <Section title="Performance targets">
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
          {e.performance.map((p, i) => (
            <div key={i} className="flex items-center justify-between p-2.5 text-sm">
              <span className="text-gray-700 dark:text-gray-300">{p.label}</span>
              <span className="flex items-center gap-2">
                <span className="text-[11px] text-gray-500 dark:text-gray-400">{p.target}</span>
                <StatusBadge status={p.status} />
              </span>
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}

function WorkshopBlock({ e }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Type">{e.workshopType}</Field>
        <Field label="Date">{formatDay(e.date)} · {formatRelativeDay(e.date)}</Field>
        <Field label="Participants">{e.participants}</Field>
        <Field label="Duration"><span className="inline-flex items-center gap-1"><Clock size={12} /> {e.duration}</span></Field>
      </div>
      <Section title="Agenda"><BulletList items={e.agenda} tone="violet" /></Section>
      <Section title="Outcomes">
        {e.outcomes.length ? <BulletList items={e.outcomes} tone="emerald" /> : <p className="text-sm text-gray-400 italic">Pending — workshop not yet held.</p>}
      </Section>
      {e.feedback && (
        <Section title="Feedback">
          <div className="flex items-center gap-2">
            <Chip tone="emerald">★ {e.feedback.rating}</Chip>
            <span className="text-sm text-gray-700 dark:text-gray-300">{e.feedback.note}</span>
          </div>
        </Section>
      )}
    </>
  );
}
