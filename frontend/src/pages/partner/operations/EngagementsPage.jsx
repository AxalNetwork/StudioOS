import React, { useMemo, useState } from 'react';
import {
  Briefcase, CheckCircle2, RefreshCw, FileSignature, ListChecks, Calendar, DollarSign,
} from 'lucide-react';
import {
  PROJECTS, RETAINERS, CONTRACTS, DELIVERABLES, money, formatRelativeDay, formatDay,
} from '../../../data/partner/operations';
import {
  Avatar, Chip, SubTabs, SlideOver, Section, Field, StatCard, EmptyState, Badge, ProgressBar,
} from './kit';

// Engagements — project & contract management. Sub-tabs for active projects,
// completed projects, retainers, contracts, and deliverables, with status and
// progress. Projects open a detail slide-over.
const TABS = [
  { id: 'active', label: 'Active Projects', icon: Briefcase },
  { id: 'completed', label: 'Completed', icon: CheckCircle2 },
  { id: 'retainers', label: 'Retainers', icon: RefreshCw },
  { id: 'contracts', label: 'Contracts', icon: FileSignature },
  { id: 'deliverables', label: 'Deliverables', icon: ListChecks },
];

export default function EngagementsPage() {
  const [tab, setTab] = useState('active');
  const [project, setProject] = useState(null);

  const active = useMemo(() => PROJECTS.filter((p) => p.status === 'active'), []);
  const completed = useMemo(() => PROJECTS.filter((p) => p.status === 'completed'), []);
  const activeRetainerValue = useMemo(() => RETAINERS.filter((r) => r.status !== 'Closed').reduce((a, r) => a + r.monthly, 0), []);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Active projects" value={active.length} />
        <StatCard label="Retainers" value={RETAINERS.length} hint={`${money(activeRetainerValue)}/mo`} />
        <StatCard label="Contracts" value={CONTRACTS.length} />
        <StatCard label="Open deliverables" value={DELIVERABLES.filter((d) => d.status !== 'done').length} />
      </div>

      <SubTabs tabs={TABS} value={tab} onChange={setTab} />

      {tab === 'active' && <ProjectList projects={active} onOpen={setProject} emptyText="No active projects." />}
      {tab === 'completed' && <ProjectList projects={completed} onOpen={setProject} emptyText="No completed projects." />}
      {tab === 'retainers' && <Retainers />}
      {tab === 'contracts' && <Contracts />}
      {tab === 'deliverables' && <Deliverables />}

      <ProjectDetail project={project} onClose={() => setProject(null)} />
    </div>
  );
}

function ProjectList({ projects, onOpen, emptyText }) {
  if (projects.length === 0) return <EmptyState>{emptyText}</EmptyState>;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {projects.map((p) => (
        <button
          key={p.id}
          onClick={() => onOpen(p)}
          className="text-left rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 hover:border-violet-300 transition-colors"
        >
          <div className="flex items-center gap-2">
            <span className="font-semibold text-gray-900 dark:text-gray-100 truncate">{p.name}</span>
            <Badge>{p.status}</Badge>
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{p.client} · {p.type}</div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 line-clamp-2">{p.summary}</p>
          <div className="mt-3"><ProgressBar value={p.progress} tone={p.status === 'completed' ? 'emerald' : 'violet'} /></div>
          <div className="mt-2 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
            <span className="inline-flex items-center gap-1"><Calendar size={11} /> {formatDay(p.start)} → {formatDay(p.end)}</span>
            <span>{money(p.budget)}</span>
          </div>
        </button>
      ))}
    </div>
  );
}

function Retainers() {
  if (RETAINERS.length === 0) return <EmptyState>No retainers.</EmptyState>;
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 dark:bg-gray-800/50 text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
          <tr>
            <th className="px-4 py-2.5 font-medium">Client</th>
            <th className="px-4 py-2.5 font-medium">Scope</th>
            <th className="px-4 py-2.5 font-medium">Monthly</th>
            <th className="px-4 py-2.5 font-medium">Renewal</th>
            <th className="px-4 py-2.5 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-800 bg-white dark:bg-gray-900">
          {RETAINERS.map((r) => (
            <tr key={r.id}>
              <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{r.client}</td>
              <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{r.scope}</td>
              <td className="px-4 py-3 text-gray-900 dark:text-gray-100">{money(r.monthly)}</td>
              <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{formatRelativeDay(r.renewal)}</td>
              <td className="px-4 py-3"><Badge>{r.status}</Badge></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Contracts() {
  if (CONTRACTS.length === 0) return <EmptyState>No contracts.</EmptyState>;
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 dark:bg-gray-800/50 text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
          <tr>
            <th className="px-4 py-2.5 font-medium">Contract</th>
            <th className="px-4 py-2.5 font-medium">Client</th>
            <th className="px-4 py-2.5 font-medium">Type</th>
            <th className="px-4 py-2.5 font-medium">Value</th>
            <th className="px-4 py-2.5 font-medium">Term</th>
            <th className="px-4 py-2.5 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-800 bg-white dark:bg-gray-900">
          {CONTRACTS.map((c) => (
            <tr key={c.id}>
              <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{c.title}</td>
              <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{c.client}</td>
              <td className="px-4 py-3"><Chip>{c.type}</Chip></td>
              <td className="px-4 py-3 text-gray-900 dark:text-gray-100">{money(c.value)}</td>
              <td className="px-4 py-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">{formatDay(c.start)} → {formatDay(c.end)}</td>
              <td className="px-4 py-3"><Badge>{c.status}</Badge></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Deliverables() {
  if (DELIVERABLES.length === 0) return <EmptyState>No deliverables.</EmptyState>;
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
      {DELIVERABLES.map((d) => (
        <div key={d.id} className="flex items-center gap-3 p-3">
          <ListChecks size={16} className="text-gray-400 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{d.name}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{d.client} · {d.project}</div>
          </div>
          <span className="text-xs text-gray-500 dark:text-gray-400 hidden sm:inline">{d.owner}</span>
          <span className="text-xs text-gray-500 dark:text-gray-400 w-20 text-right">{formatRelativeDay(d.due)}</span>
          <Badge>{d.status}</Badge>
        </div>
      ))}
    </div>
  );
}

function ProjectDetail({ project, onClose }) {
  if (!project) return <SlideOver open={false} onClose={onClose} />;
  const deliverables = DELIVERABLES.filter((d) => d.project === project.name && d.client === project.client);
  return (
    <SlideOver open onClose={onClose} title={project.name} subtitle={`${project.client} · ${project.type}`}>
      <div className="flex items-center gap-2">
        <Badge>{project.status}</Badge>
        <Chip><DollarSign size={10} /> {money(project.budget)}</Chip>
      </div>

      <p className="text-sm text-gray-700 dark:text-gray-300">{project.summary}</p>

      <div>
        <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">Progress</div>
        <ProgressBar value={project.progress} tone={project.status === 'completed' ? 'emerald' : 'violet'} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Start">{formatDay(project.start)}</Field>
        <Field label="Target end">{formatDay(project.end)}</Field>
        <Field label="Lead">{project.lead}</Field>
        <Field label="Budget">{money(project.budget)}</Field>
      </div>

      <Section title="Team">
        <div className="space-y-2">
          {project.team.map((t) => (
            <div key={t} className="flex items-center gap-2.5">
              <Avatar name={t} size={30} />
              <span className="text-sm text-gray-900 dark:text-gray-100">{t}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title={`Deliverables (${deliverables.length})`}>
        {deliverables.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">No deliverables recorded.</p>
        ) : (
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
            {deliverables.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-2 p-2.5">
                <div className="min-w-0">
                  <div className="text-sm text-gray-900 dark:text-gray-100 truncate">{d.name}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">{d.owner} · {formatRelativeDay(d.due)}</div>
                </div>
                <Badge>{d.status}</Badge>
              </div>
            ))}
          </div>
        )}
      </Section>
    </SlideOver>
  );
}
