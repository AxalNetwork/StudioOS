import React, { useMemo, useState } from 'react';
import {
  Building2, MapPin, Users, Banknote, PieChart, FileText, Globe, Calendar,
} from 'lucide-react';
import {
  ORGANIZATIONS, money, formatRelativeDay,
} from '../../../data/advisor/network';
import {
  Avatar, Chip, SearchInput, FilterChips, SlideOver, Section, Field, StatCard, EmptyState,
} from './kit';

// Organizations — company-profile workspace. A searchable, filterable directory
// of company profiles; each opens a detail slide-over with employees,
// leadership, funding history, ownership, industry, locations, and documents.

const INDUSTRY_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'startups', label: 'Startups' },
  { id: 'investors', label: 'Investors' },
  { id: 'partners', label: 'Service Partners' },
];

function matchesFilter(o, filter) {
  if (filter === 'all') return true;
  if (filter === 'investors') return o.categories.includes('investors');
  if (filter === 'partners') return o.categories.includes('service_providers') || o.categories.includes('partners');
  // startups = customers/organizations that aren't investors or service providers
  return o.categories.includes('customers');
}

export default function OrganizationsPage() {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState(null);

  const filterOptions = useMemo(
    () => INDUSTRY_FILTERS.map((f) => ({
      ...f,
      count: ORGANIZATIONS.filter((o) => matchesFilter(o, f.id)).length,
    })),
    [],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ORGANIZATIONS
      .filter((o) => matchesFilter(o, filter))
      .filter((o) => (q ? `${o.name} ${o.industry} ${(o.tags || []).join(' ')}`.toLowerCase().includes(q) : true))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [query, filter]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600 dark:text-gray-400">
        Company profiles across your network — leadership, funding, ownership, locations, and documents.
        Open any organization for the full profile.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <SearchInput value={query} onChange={setQuery} placeholder="Search organizations" />
        <span className="text-xs text-gray-500 dark:text-gray-400">{visible.length} organizations</span>
      </div>

      <FilterChips options={filterOptions} value={filter} onChange={setFilter} />

      {visible.length === 0 ? (
        <EmptyState>No organizations match your search.</EmptyState>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {visible.map((o) => (
            <button
              key={o.id}
              onClick={() => setSelected(o)}
              className="text-left rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 hover:border-violet-300 transition-colors"
            >
              <div className="flex items-start gap-3">
                <div className="w-11 h-11 rounded-lg bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 flex items-center justify-center flex-shrink-0">
                  <Building2 size={20} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-gray-900 dark:text-gray-100 truncate">{o.name}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{o.industry} · {o.stage}</div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 line-clamp-2">{o.description}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Chip><MapPin size={10} /> {o.hq}</Chip>
                    <Chip><Users size={10} /> {o.employeeCount}</Chip>
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      <OrgDetail org={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function OrgDetail({ org, onClose }) {
  if (!org) return <SlideOver open={false} onClose={onClose} />;
  const totalRaised = org.funding.reduce((a, r) => a + (r.amount || 0), 0);
  const latest = org.funding[org.funding.length - 1];
  return (
    <SlideOver open onClose={onClose} title={org.name} subtitle={`${org.industry} · ${org.stage}`}>
      <div className="flex items-center gap-3">
        <div className="w-14 h-14 rounded-xl bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 flex items-center justify-center flex-shrink-0">
          <Building2 size={26} />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {org.tags.map((t) => <Chip key={t} tone="emerald">{t}</Chip>)}
        </div>
      </div>

      <p className="text-sm text-gray-700 dark:text-gray-300">{org.description}</p>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Industry">{org.industry}</Field>
        <Field label="Founded"><span className="inline-flex items-center gap-1"><Calendar size={12} /> {org.founded}</span></Field>
        <Field label="Employees"><span className="inline-flex items-center gap-1"><Users size={12} /> {org.employeeCount}</span></Field>
        <Field label="Website"><span className="inline-flex items-center gap-1 break-all"><Globe size={12} /> {org.website?.replace(/^https?:\/\//, '')}</span></Field>
      </div>

      {org.funding.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Total raised" value={money(totalRaised)} hint={`${org.funding.length} round${org.funding.length > 1 ? 's' : ''}`} />
          <StatCard label="Latest valuation" value={money(latest?.valuation)} hint={latest?.round} />
        </div>
      )}

      <Section title="Leadership">
        <div className="space-y-2">
          {org.leadership.map((l) => (
            <div key={l.name} className="flex items-center gap-2.5">
              <Avatar name={l.name} size={32} />
              <div>
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{l.name}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">{l.title}</div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title={`Employees (${org.employees.length} key)`}>
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
          {org.employees.map((e) => (
            <div key={e.name} className="flex items-center justify-between p-2.5 text-sm">
              <span className="text-gray-900 dark:text-gray-100">{e.name}</span>
              <span className="text-gray-500 dark:text-gray-400">{e.role} · {e.team}</span>
            </div>
          ))}
        </div>
      </Section>

      {org.funding.length > 0 && (
        <Section title="Funding history">
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
            {[...org.funding].reverse().map((r, i) => (
              <div key={i} className="flex items-center gap-3 p-2.5">
                <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-300 flex items-center justify-center flex-shrink-0">
                  <Banknote size={15} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{r.round} · {money(r.amount)}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Lead: {r.lead} · {formatRelativeDay(r.date)}</div>
                </div>
                {r.valuation && <span className="text-xs text-gray-500 dark:text-gray-400">{money(r.valuation)} val.</span>}
              </div>
            ))}
          </div>
        </Section>
      )}

      {org.ownership.length > 0 && (
        <Section title="Ownership">
          <div className="space-y-2">
            {org.ownership.map((s) => (
              <div key={s.holder}>
                <div className="flex items-center justify-between text-xs mb-0.5">
                  <span className="text-gray-700 dark:text-gray-300 inline-flex items-center gap-1"><PieChart size={11} /> {s.holder}</span>
                  <span className="font-medium tabular-nums text-gray-600 dark:text-gray-400">{s.pct}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                  <div className="h-full bg-violet-500" style={{ width: `${s.pct}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title="Locations">
        <div className="flex flex-wrap gap-1.5">
          {org.locations.map((l) => <Chip key={l}><MapPin size={10} /> {l}</Chip>)}
        </div>
      </Section>

      <Section title="Documents">
        {org.documents.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">No documents on file.</p>
        ) : (
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
            {org.documents.map((d) => (
              <div key={d.name} className="flex items-center gap-2.5 p-2.5">
                <FileText size={15} className="text-gray-400 flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-gray-900 dark:text-gray-100 truncate">{d.name}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">{d.type} · {formatRelativeDay(d.date)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
    </SlideOver>
  );
}
