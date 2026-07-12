import React, { useMemo, useState } from 'react';
import { Building2, Calendar, Clock, FileText, Video } from 'lucide-react';
import {
  SESSIONS, DELIVERABLES, DELIVERABLE_TYPES, formatDay, formatRelativeDay,
} from '../../../data/advisor/advisory';
import {
  SubTabs, StatCard, SlideOver, Section, Field, StatusBadge, BulletList,
  Checklist, AiSample, RowCard, EmptyState, Chip, FilterChips,
} from './kit';

// Delivery — the execution surface. Two sub-tabs: Sessions (meeting notes,
// decisions, action items, AI summaries) and Deliverables (reports, decks,
// models, research, templates, playbooks).

export default function DeliveryPage() {
  const [tab, setTab] = useState('sessions');
  const tabs = [
    { id: 'sessions', label: `Sessions (${SESSIONS.length})` },
    { id: 'deliverables', label: `Deliverables (${DELIVERABLES.length})` },
  ];
  return (
    <div className="space-y-5">
      <SubTabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'sessions' ? <SessionsView /> : <DeliverablesView />}
    </div>
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
