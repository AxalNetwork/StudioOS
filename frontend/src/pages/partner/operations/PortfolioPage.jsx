import React, { useState } from 'react';
import {
  Building2, Quote, Trophy, FileText, Calendar, Sparkles, MessageSquare,
} from 'lucide-react';
import {
  CLIENTS, PORTFOLIO_COMPANIES, CASE_STUDIES, SUCCESS_STORIES, REFERENCES, formatRelativeDay,
} from '../../../data/partner/operations';
import {
  Avatar, Chip, SubTabs, SlideOver, Section, Field, EmptyState, Badge, BulletList, RowCard,
} from './kit';

// Portfolio — proof of work. Sub-tabs for clients, portfolio companies supported,
// case studies (with a detail panel), success stories, and references.
const TABS = [
  { id: 'clients', label: 'Clients', icon: Building2 },
  { id: 'companies', label: 'Companies', icon: Sparkles },
  { id: 'cases', label: 'Case Studies', icon: FileText },
  { id: 'stories', label: 'Success Stories', icon: Trophy },
  { id: 'references', label: 'References', icon: MessageSquare },
];

export default function PortfolioPage() {
  const [tab, setTab] = useState('clients');
  const [caseStudy, setCaseStudy] = useState(null);

  return (
    <div className="space-y-4">
      <SubTabs tabs={TABS} value={tab} onChange={setTab} />

      {tab === 'clients' && <Clients />}
      {tab === 'companies' && <Companies />}
      {tab === 'cases' && <CaseStudies onOpen={setCaseStudy} />}
      {tab === 'stories' && <Stories />}
      {tab === 'references' && <References />}

      <CaseStudyDetail item={caseStudy} onClose={() => setCaseStudy(null)} />
    </div>
  );
}

function Clients() {
  if (CLIENTS.length === 0) return <EmptyState>No clients yet.</EmptyState>;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {CLIENTS.map((c) => (
        <div key={c.id} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-lg bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 flex items-center justify-center flex-shrink-0">
              <Building2 size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-gray-900 dark:text-gray-100 truncate">{c.name}</span>
                <Badge>{c.status}</Badge>
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{c.industry} · {c.stage}</div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <Chip tone="violet">{c.relationship}</Chip>
                <Chip><Calendar size={10} /> Since {c.since.slice(0, 4)}</Chip>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Companies() {
  if (PORTFOLIO_COMPANIES.length === 0) return <EmptyState>No portfolio companies yet.</EmptyState>;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {PORTFOLIO_COMPANIES.map((c) => (
        <div key={c.name} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
          <div className="font-medium text-gray-900 dark:text-gray-100">{c.name}</div>
          <Chip tone="emerald" className="mt-1.5">{c.sector}</Chip>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">{c.note}</p>
        </div>
      ))}
    </div>
  );
}

function CaseStudies({ onOpen }) {
  if (CASE_STUDIES.length === 0) return <EmptyState>No case studies yet.</EmptyState>;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {CASE_STUDIES.map((cs) => (
        <RowCard key={cs.id} onClick={() => onOpen(cs)}>
          <div className="flex items-center gap-2 mb-1">
            <span className="font-semibold text-gray-900 dark:text-gray-100">{cs.client}</span>
            <Chip tone="emerald">{cs.industry}</Chip>
          </div>
          <div className="text-sm text-gray-700 dark:text-gray-300">{cs.title}</div>
          <div className="mt-3 flex flex-wrap gap-2">
            {cs.metrics.slice(0, 3).map((m) => (
              <div key={m.label} className="rounded-lg bg-gray-50 dark:bg-gray-800 px-2.5 py-1.5">
                <div className="text-sm font-bold text-violet-700 dark:text-violet-300">{m.value}</div>
                <div className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">{m.label}</div>
              </div>
            ))}
          </div>
          <div className="text-xs text-gray-400 dark:text-gray-500 mt-3">{formatRelativeDay(cs.date)}</div>
        </RowCard>
      ))}
    </div>
  );
}

function Stories() {
  if (SUCCESS_STORIES.length === 0) return <EmptyState>No success stories yet.</EmptyState>;
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {SUCCESS_STORIES.map((s) => (
        <div key={s.id} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 flex flex-col">
          <Trophy size={18} className="text-amber-500" />
          <div className="text-lg font-bold text-violet-700 dark:text-violet-300 mt-2">{s.metric}</div>
          <div className="text-sm font-medium text-gray-900 dark:text-gray-100 mt-1">{s.headline}</div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 flex-1">“{s.quote}”</p>
          <div className="text-xs font-medium text-gray-600 dark:text-gray-400 mt-3">— {s.client}</div>
        </div>
      ))}
    </div>
  );
}

function References() {
  if (REFERENCES.length === 0) return <EmptyState>No references yet.</EmptyState>;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {REFERENCES.map((r) => (
        <div key={r.id} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
          <Quote size={16} className="text-violet-400" />
          <p className="text-sm text-gray-700 dark:text-gray-300 mt-1.5">“{r.quote}”</p>
          <div className="flex items-center gap-2.5 mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
            <Avatar name={r.name} size={36} />
            <div className="min-w-0">
              <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{r.name}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{r.title}, {r.company}</div>
            </div>
            <Chip className="ml-auto">{r.relationship}</Chip>
          </div>
        </div>
      ))}
    </div>
  );
}

function CaseStudyDetail({ item, onClose }) {
  if (!item) return <SlideOver open={false} onClose={onClose} />;
  return (
    <SlideOver open onClose={onClose} title={item.title} subtitle={`${item.client} · ${item.industry}`}>
      <div className="flex flex-wrap gap-1.5">
        {item.services.map((s) => <Chip key={s} tone="violet">{s}</Chip>)}
      </div>

      <div className="grid grid-cols-3 gap-2">
        {item.metrics.map((m) => (
          <div key={m.label} className="rounded-xl border border-gray-200 dark:border-gray-800 p-3 text-center">
            <div className="text-lg font-bold text-violet-700 dark:text-violet-300">{m.value}</div>
            <div className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400 mt-0.5">{m.label}</div>
          </div>
        ))}
      </div>

      <Section title="Challenge">
        <p className="text-sm text-gray-700 dark:text-gray-300">{item.challenge}</p>
      </Section>
      <Section title="Approach">
        <p className="text-sm text-gray-700 dark:text-gray-300">{item.approach}</p>
      </Section>
      <Section title="Results">
        <BulletList items={item.results} tone="emerald" />
      </Section>

      <Field label="Delivered">{formatRelativeDay(item.date)}</Field>
    </SlideOver>
  );
}
