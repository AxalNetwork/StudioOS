import React, { useMemo, useState } from 'react';
import { MapPin, Building2, Mail, Users, Sparkles, ExternalLink } from 'lucide-react';
import {
  INTRODUCTION_CATEGORIES, CONTACTS, ORGANIZATIONS, CATEGORY_LABEL,
  organizationById, formatRelativeDay,
} from '../../../data/advisor/network';
import {
  Avatar, Chip, SearchInput, FilterChips, SlideOver, Section, Field, StrengthBar, EmptyState,
} from './kit';

// Introductions — the relationship-discovery directory. Contacts and
// organizations are unified into one browsable list; the introduction
// categories are surfaced as filters. Rows open a detail slide-over.

// Build the unified directory: people + organizations as one entry shape.
function useDirectory() {
  return useMemo(() => {
    const people = CONTACTS.map((c) => ({
      key: `contact:${c.id}`,
      kind: 'person',
      ref: c,
      name: c.name,
      subtitle: `${c.title}${c.org ? ` · ${c.org}` : ''}`,
      location: c.location,
      categories: c.categories,
      tags: c.tags,
      search: `${c.name} ${c.title} ${c.org} ${(c.tags || []).join(' ')}`.toLowerCase(),
    }));
    const orgs = ORGANIZATIONS.map((o) => ({
      key: `org:${o.id}`,
      kind: 'organization',
      ref: o,
      name: o.name,
      subtitle: `${o.industry} · ${o.stage}`,
      location: o.hq,
      categories: o.categories,
      tags: o.tags,
      search: `${o.name} ${o.industry} ${(o.tags || []).join(' ')}`.toLowerCase(),
    }));
    return [...people, ...orgs];
  }, []);
}

export default function IntroductionsPage() {
  const directory = useDirectory();
  const [category, setCategory] = useState('contacts');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);

  const filterOptions = useMemo(
    () => INTRODUCTION_CATEGORIES.map((c) => ({
      id: c.id,
      label: c.label,
      count: directory.filter((e) => e.categories.includes(c.id)).length,
    })),
    [directory],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return directory
      .filter((e) => e.categories.includes(category))
      .filter((e) => (q ? e.search.includes(q) : true))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [directory, category, query]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600 dark:text-gray-400">
        A browsable directory of your contacts and organizations. Filter by introduction category, search,
        and open any record for a detail view.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <SearchInput value={query} onChange={setQuery} placeholder="Search people, companies, tags" />
        <span className="text-xs text-gray-500 dark:text-gray-400">{visible.length} in {CATEGORY_LABEL[category]}</span>
      </div>

      <FilterChips options={filterOptions} value={category} onChange={setCategory} />

      {visible.length === 0 ? (
        <EmptyState>No records in {CATEGORY_LABEL[category]} match your search.</EmptyState>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {visible.map((e) => (
            <button
              key={e.key}
              onClick={() => setSelected(e)}
              className="text-left rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 hover:border-violet-300 transition-colors"
            >
              <div className="flex items-start gap-3">
                {e.kind === 'person' ? (
                  <Avatar name={e.name} />
                ) : (
                  <div className="w-10 h-10 rounded-lg bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 flex items-center justify-center flex-shrink-0">
                    <Building2 size={18} />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-gray-900 dark:text-gray-100 truncate">{e.name}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{e.subtitle}</div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Chip tone={e.kind === 'person' ? 'blue' : 'violet'}>
                      {e.kind === 'person' ? 'Contact' : 'Organization'}
                    </Chip>
                    {e.location && (
                      <Chip><MapPin size={10} /> {e.location}</Chip>
                    )}
                    {(e.tags || []).slice(0, 2).map((t) => <Chip key={t} tone="emerald">{t}</Chip>)}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      <DetailPanel entry={selected} onClose={() => setSelected(null)} onOpenEntry={setSelected} directory={directory} />
    </div>
  );
}

function DetailPanel({ entry, onClose, onOpenEntry, directory }) {
  if (!entry) return <SlideOver open={false} onClose={onClose} />;
  return entry.kind === 'person'
    ? <PersonDetail entry={entry} onClose={onClose} onOpenEntry={onOpenEntry} directory={directory} />
    : <OrgDetail entry={entry} onClose={onClose} />;
}

function PersonDetail({ entry, onClose, onOpenEntry, directory }) {
  const c = entry.ref;
  const org = organizationById(c.orgId);
  return (
    <SlideOver open onClose={onClose} title={c.name} subtitle={`${c.title}${c.org ? ` · ${c.org}` : ''}`}>
      <div className="flex items-center gap-3">
        <Avatar name={c.name} size={56} />
        <div className="flex flex-wrap gap-1.5">
          {c.categories.filter((id) => id !== 'contacts').map((id) => (
            <Chip key={id} tone="violet">{CATEGORY_LABEL[id]}</Chip>
          ))}
        </div>
      </div>

      {c.headline && <p className="text-sm text-gray-700 dark:text-gray-300">{c.headline}</p>}

      <div className="grid grid-cols-2 gap-4">
        <Field label="Location"><span className="inline-flex items-center gap-1"><MapPin size={12} /> {c.location}</span></Field>
        <Field label="Email"><span className="inline-flex items-center gap-1 break-all"><Mail size={12} /> {c.email}</span></Field>
        <Field label="Mutual connections"><span className="inline-flex items-center gap-1"><Users size={12} /> {c.mutuals}</span></Field>
        <Field label="Last interaction">{formatRelativeDay(c.lastInteraction)}</Field>
      </div>

      <Section title="Relationship strength">
        <StrengthBar value={c.strength} />
      </Section>

      {c.bio && (
        <Section title="About">
          <p className="text-sm text-gray-700 dark:text-gray-300">{c.bio}</p>
        </Section>
      )}

      {org && (
        <Section title="Organization">
          <button
            onClick={() => {
              const orgEntry = directory.find((e) => e.kind === 'organization' && e.ref.id === org.id);
              if (orgEntry) onOpenEntry(orgEntry);
            }}
            className="w-full flex items-center gap-3 rounded-lg border border-gray-200 dark:border-gray-800 p-3 hover:border-violet-300 text-left"
          >
            <div className="w-9 h-9 rounded-lg bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 flex items-center justify-center">
              <Building2 size={16} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{org.name}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">{org.industry} · {org.stage}</div>
            </div>
            <ExternalLink size={14} className="text-gray-400" />
          </button>
        </Section>
      )}
    </SlideOver>
  );
}

function OrgDetail({ entry, onClose }) {
  const o = entry.ref;
  return (
    <SlideOver open onClose={onClose} title={o.name} subtitle={`${o.industry} · ${o.stage}`}>
      <p className="text-sm text-gray-700 dark:text-gray-300">{o.description}</p>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Headquarters">{o.hq}</Field>
        <Field label="Founded">{o.founded}</Field>
        <Field label="Employees">{o.employeeCount}</Field>
        <Field label="Website"><span className="break-all">{o.website?.replace(/^https?:\/\//, '')}</span></Field>
      </div>
      <Section title="Leadership">
        <div className="space-y-1.5">
          {o.leadership.map((l) => (
            <div key={l.name} className="flex items-center gap-2 text-sm">
              <Avatar name={l.name} size={28} />
              <span className="text-gray-900 dark:text-gray-100 font-medium">{l.name}</span>
              <span className="text-gray-500 dark:text-gray-400">· {l.title}</span>
            </div>
          ))}
        </div>
      </Section>
      <div className="flex flex-wrap gap-1.5">
        {o.tags.map((t) => <Chip key={t} tone="emerald">{t}</Chip>)}
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 inline-flex items-center gap-1">
        <Sparkles size={12} /> Full company profile lives on the Organizations tab.
      </p>
    </SlideOver>
  );
}
