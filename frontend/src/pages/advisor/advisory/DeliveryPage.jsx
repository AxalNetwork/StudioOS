import React, { useMemo, useState } from 'react';
import { Building2, Calendar, Clock, FileText, Video } from 'lucide-react';
import {
  SESSIONS, DELIVERABLES, DELIVERABLE_TYPES, CONSULTING_SESSIONS, ACTION_PLANS,
  formatDay, formatRelativeDay,
} from '../../../data/advisor/advisory';
import {
  SubTabs, StatCard, SlideOver, Section, Field, StatusBadge, BulletList,
  Checklist, AiSample, RowCard, EmptyState, Chip, FilterChips, ProgressBar,
} from './kit';

// Delivery — the execution surface. Four sub-tabs: Consulting Sessions
// (structured advisory sessions), Action Plans (client action plans), Sessions
// (meeting notes, decisions, action items, AI summaries) and Deliverables
// (reports, decks, models, research, templates, playbooks).

export default function DeliveryPage() {
  const [tab, setTab] = useState('consulting');
  const tabs = [
    { id: 'consulting', label: `Consulting Sessions (${CONSULTING_SESSIONS.length})` },
    { id: 'plans', label: `Action Plans (${ACTION_PLANS.length})` },
    { id: 'sessions', label: `Sessions (${SESSIONS.length})` },
    { id: 'deliverables', label: `Deliverables (${DELIVERABLES.length})` },
  ];
  return (
    <div className="space-y-5">
      <SubTabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'consulting' && <ConsultingSessionsView />}
      {tab === 'plans' && <ActionPlansView />}
      {tab === 'sessions' && <SessionsView />}
      {tab === 'deliverables' && <DeliverablesView />}
    </div>
  );
}

function ConsultingSessionsView() {
  const [selectedId, setSelectedId] = useState(null);
  const selected = CONSULTING_SESSIONS.find((s) => s.id === selectedId) || null;

  const stats = useMemo(() => {
    const completed = CONSULTING_SESSIONS.filter((s) => s.status === 'Completed').length;
    const scheduled = CONSULTING_SESSIONS.filter((s) => s.status === 'Scheduled').length;
    const recs = CONSULTING_SESSIONS.reduce((a, s) => a + (s.recommendations?.length || 0), 0);
    const clients = new Set(CONSULTING_SESSIONS.map((s) => s.client)).size;
    return { completed, scheduled, recs, clients };
  }, []);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Sessions held" value={stats.completed} hint="Completed" />
        <StatCard label="Scheduled" value={stats.scheduled} hint="Upcoming" />
        <StatCard label="Recommendations" value={stats.recs} hint="Across sessions" />
        <StatCard label="Clients touched" value={stats.clients} hint="This view" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {CONSULTING_SESSIONS.map((s) => (
          <RowCard key={s.id} onClick={() => setSelectedId(s.id)}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold text-gray-900 dark:text-gray-100 truncate">{s.title}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5 flex items-center gap-1">
                  <Building2 size={12} className="text-gray-400" /> {s.client}
                </div>
              </div>
              <StatusBadge status={s.status} />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Chip tone="violet">{s.format}</Chip>
              <Chip><Calendar size={10} /> {formatRelativeDay(s.date)}</Chip>
              <Chip><Clock size={10} /> {s.duration}</Chip>
            </div>
          </RowCard>
        ))}
      </div>

      <ConsultingSessionDetail session={selected} onClose={() => setSelectedId(null)} />
    </div>
  );
}

function ConsultingSessionDetail({ session, onClose }) {
  if (!session) return <SlideOver open={false} onClose={onClose} />;
  const s = session;
  return (
    <SlideOver open onClose={onClose} title={s.title} subtitle={s.client}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={s.status} />
        <Chip tone="violet">{s.format}</Chip>
        <Chip><Calendar size={10} /> {formatDay(s.date)}</Chip>
        <Chip><Clock size={10} /> {s.duration}</Chip>
      </div>
      <Section title="Summary"><p className="text-sm text-gray-700 dark:text-gray-300">{s.summary}</p></Section>
      <Section title="Objectives"><BulletList items={s.objectives} tone="violet" /></Section>
      <Section title="Key topics">
        <div className="flex flex-wrap gap-1.5">
          {s.keyTopics.map((t) => <Chip key={t}>{t}</Chip>)}
        </div>
      </Section>
      <Section title="Outcomes">
        {s.outcomes.length ? <BulletList items={s.outcomes} tone="emerald" /> : <p className="text-sm text-gray-400 italic">Pending — session not yet held.</p>}
      </Section>
      <Section title="Recommendations">
        {s.recommendations.length ? <BulletList items={s.recommendations} tone="violet" /> : <p className="text-sm text-gray-400 italic">Pending — session not yet held.</p>}
      </Section>
    </SlideOver>
  );
}

function ActionPlansView() {
  const [selectedId, setSelectedId] = useState(null);
  const selected = ACTION_PLANS.find((p) => p.id === selectedId) || null;

  const stats = useMemo(() => {
    const active = ACTION_PLANS.filter((p) => p.status === 'In progress').length;
    const openItems = ACTION_PLANS.reduce((a, p) => a + p.items.filter((i) => !i.done).length, 0);
    const avgProgress = Math.round(ACTION_PLANS.reduce((a, p) => a + (p.progress || 0), 0) / (ACTION_PLANS.length || 1));
    const clients = new Set(ACTION_PLANS.map((p) => p.client)).size;
    return { active, openItems, avgProgress, clients };
  }, []);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Active plans" value={stats.active} hint="In progress" />
        <StatCard label="Open items" value={stats.openItems} hint="Across plans" />
        <StatCard label="Avg. progress" value={`${stats.avgProgress}%`} hint="All plans" />
        <StatCard label="Clients" value={stats.clients} hint="This view" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {ACTION_PLANS.map((p) => (
          <RowCard key={p.id} onClick={() => setSelectedId(p.id)}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold text-gray-900 dark:text-gray-100 truncate">{p.title}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5 flex items-center gap-1">
                  <Building2 size={12} className="text-gray-400" /> {p.client}
                </div>
              </div>
              <StatusBadge status={p.status} />
            </div>
            <div className="mt-3">
              <div className="text-[11px] text-gray-500 dark:text-gray-400 mb-1">Progress</div>
              <ProgressBar value={p.progress} tone={p.progress >= 75 ? 'emerald' : p.progress >= 40 ? 'amber' : 'violet'} />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Chip>Owner {p.owner}</Chip>
              <Chip><Calendar size={10} /> Due {formatRelativeDay(p.dueDate)}</Chip>
            </div>
          </RowCard>
        ))}
      </div>

      <ActionPlanDetail plan={selected} onClose={() => setSelectedId(null)} />
    </div>
  );
}

function ActionPlanDetail({ plan, onClose }) {
  if (!plan) return <SlideOver open={false} onClose={onClose} />;
  const p = plan;
  return (
    <SlideOver open onClose={onClose} title={p.title} subtitle={p.client}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={p.status} />
        <Chip>Owner {p.owner}</Chip>
        <Chip><Calendar size={10} /> Due {formatDay(p.dueDate)}</Chip>
      </div>
      <Section title="Objective"><p className="text-sm text-gray-700 dark:text-gray-300">{p.objective}</p></Section>
      <Section title="Progress"><ProgressBar value={p.progress} tone={p.progress >= 75 ? 'emerald' : p.progress >= 40 ? 'amber' : 'violet'} /></Section>
      <Section title="Action items">
        <Checklist items={p.items.map((i) => ({ label: `${i.label} — ${i.owner} · due ${formatDay(i.due)}`, done: i.done }))} />
      </Section>
    </SlideOver>
  );
}

function SessionsView() {
  const [selectedId, setSelectedId] = useState(null);
  const selected = SESSIONS.find((s) => s.id === selectedId) || null;

  const openActions = useMemo(
    () => SESSIONS.reduce((a, s) => a + s.actionItems.filter((i) => !i.done).length, 0),
    [],
  );

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Sessions logged" value={SESSIONS.length} hint="Recent meetings" />
        <StatCard label="Open action items" value={openActions} hint="Across sessions" />
        <StatCard label="Recordings" value={SESSIONS.filter((s) => s.recording === 'Available').length} hint="Available" />
        <StatCard label="Clients touched" value={new Set(SESSIONS.map((s) => s.client)).size} hint="This view" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {SESSIONS.map((s) => (
          <RowCard key={s.id} onClick={() => setSelectedId(s.id)}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold text-gray-900 dark:text-gray-100 truncate">{s.title}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5 flex items-center gap-1">
                  <Building2 size={12} className="text-gray-400" /> {s.client}
                </div>
              </div>
              <StatusBadge status={s.recording} />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Chip><Calendar size={10} /> {formatRelativeDay(s.date)}</Chip>
              <Chip><Clock size={10} /> {s.duration}</Chip>
              <Chip>{s.actionItems.filter((i) => !i.done).length} open actions</Chip>
            </div>
          </RowCard>
        ))}
      </div>

      <SessionDetail session={selected} onClose={() => setSelectedId(null)} />
    </div>
  );
}

function SessionDetail({ session, onClose }) {
  if (!session) return <SlideOver open={false} onClose={onClose} />;
  const s = session;
  return (
    <SlideOver open onClose={onClose} title={s.title} subtitle={s.client}>
      <div className="flex flex-wrap items-center gap-2">
        <Chip><Calendar size={10} /> {formatDay(s.date)}</Chip>
        <Chip><Clock size={10} /> {s.duration}</Chip>
        <Chip><Video size={10} /> {s.recording}</Chip>
      </div>
      <Field label="Attendees">{s.attendees.join(', ')}</Field>
      <Section title="AI summary"><AiSample>{s.aiSummary}</AiSample></Section>
      <Section title="Notes"><p className="text-sm text-gray-700 dark:text-gray-300">{s.notes}</p></Section>
      <Section title="Decisions"><BulletList items={s.decisions} tone="emerald" /></Section>
      <Section title="Action items">
        <Checklist items={s.actionItems.map((i) => ({ label: `${i.label} — ${i.owner} · due ${formatDay(i.due)}`, done: i.done }))} />
      </Section>
      <Section title="Follow-ups"><BulletList items={s.followUps} tone="violet" /></Section>
    </SlideOver>
  );
}

function DeliverablesView() {
  const [type, setType] = useState('all');
  const [selectedId, setSelectedId] = useState(null);

  const filterOptions = useMemo(() => ([
    { id: 'all', label: 'All', count: DELIVERABLES.length },
    ...DELIVERABLE_TYPES.map((t) => ({ id: t.id, label: t.label, count: DELIVERABLES.filter((d) => d.type === t.id).length })),
  ]), []);

  const visible = useMemo(
    () => DELIVERABLES.filter((d) => type === 'all' || d.type === type),
    [type],
  );
  const selected = DELIVERABLES.find((d) => d.id === selectedId) || null;
  const typeLabel = (id) => DELIVERABLE_TYPES.find((t) => t.id === id)?.label || id;

  return (
    <div className="space-y-5">
      <FilterChips options={filterOptions} value={type} onChange={setType} />
      {visible.length === 0 ? (
        <EmptyState>No deliverables of this type.</EmptyState>
      ) : (
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden divide-y divide-gray-100 dark:divide-gray-800">
          {visible.map((d) => (
            <button
              key={d.id}
              onClick={() => setSelectedId(d.id)}
              className="w-full text-left flex items-center gap-3 p-3.5 hover:bg-gray-50 dark:hover:bg-gray-900/50 transition-colors"
            >
              <FileText size={16} className="text-gray-400 flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{d.name}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{d.client} · {typeLabel(d.type)}</div>
              </div>
              <span className="hidden sm:block text-[11px] text-gray-400 tabular-nums">{formatDay(d.date)}</span>
              <StatusBadge status={d.status} />
            </button>
          ))}
        </div>
      )}

      {selected && (
        <SlideOver open onClose={() => setSelectedId(null)} title={selected.name} subtitle={selected.client}>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={selected.status} />
            <Chip tone="violet">{typeLabel(selected.type)}</Chip>
            <Chip>{selected.version}</Chip>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Client">{selected.client}</Field>
            <Field label="Type">{typeLabel(selected.type)}</Field>
            <Field label="Version">{selected.version}</Field>
            <Field label="Date">{formatDay(selected.date)} · {formatRelativeDay(selected.date)}</Field>
          </div>
          <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 p-6 text-center text-sm text-gray-500 dark:text-gray-400">
            Document preview is a placeholder in this demo.
          </div>
        </SlideOver>
      )}
    </div>
  );
}
