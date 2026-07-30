import React, { useMemo, useState } from 'react';
import {
  Package, Clock, DollarSign, Layers, Cpu, Building2, CheckCircle2,
} from 'lucide-react';
import {
  SERVICES, EXPERTISE, TECHNOLOGIES, CAPABILITY_INDUSTRIES, STAGES_SUPPORTED, TYPICAL_ENGAGEMENTS,
} from '../../../data/partner/operations';
import {
  Chip, SearchInput, FilterChips, SlideOver, Section, Field, StrengthBar, EmptyState,
  Badge, BulletList, RowCard,
} from './kit';

// Capabilities — the service catalog. Browsable services (each opens a detail
// panel), plus the firm's expertise, technologies, industries, company stages
// supported, and its typical engagement shapes.
const CATEGORY_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'Strategy', label: 'Strategy' },
  { id: 'Sales', label: 'Sales' },
  { id: 'Marketing', label: 'Marketing' },
  { id: 'RevOps', label: 'RevOps' },
];

const LEVEL_PCT = { Expert: 95, Advanced: 75, Intermediate: 55 };

export default function CapabilitiesPage() {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState(null);

  const filterOptions = useMemo(
    () => CATEGORY_FILTERS.map((f) => ({
      ...f,
      count: f.id === 'all' ? SERVICES.length : SERVICES.filter((s) => s.category === f.id).length,
    })),
    [],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return SERVICES
      .filter((s) => (filter === 'all' ? true : s.category === filter))
      .filter((s) => (q ? `${s.name} ${s.summary} ${s.category}`.toLowerCase().includes(q) : true));
  }, [query, filter]);

  return (
    <div className="space-y-6">
      <Section title="Services offered">
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <SearchInput value={query} onChange={setQuery} placeholder="Search services" />
          <span className="text-xs text-gray-500 dark:text-gray-400">{visible.length} services</span>
        </div>
        <div className="mb-3"><FilterChips options={filterOptions} value={filter} onChange={setFilter} /></div>

        {visible.length === 0 ? (
          <EmptyState>No services match your search.</EmptyState>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {visible.map((s) => (
              <RowCard key={s.id} onClick={() => setSelected(s)}>
                <div className="flex items-start gap-3">
                  <div className="w-11 h-11 rounded-lg bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 flex items-center justify-center flex-shrink-0">
                    <Package size={20} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-900 dark:text-gray-100 truncate">{s.name}</span>
                      <Chip tone="violet">{s.category}</Chip>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5 line-clamp-2">{s.summary}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <Chip><DollarSign size={10} /> {s.priceRange}</Chip>
                      <Chip><Clock size={10} /> {s.duration}</Chip>
                    </div>
                  </div>
                </div>
              </RowCard>
            ))}
          </div>
        )}
      </Section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Section title="Expertise">
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 divide-y divide-gray-100 dark:divide-gray-800">
            {EXPERTISE.map((e) => (
              <div key={e.area} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <div className="text-sm text-gray-900 dark:text-gray-100 truncate">{e.area}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">{e.level} · {e.years} yrs</div>
                </div>
                <StrengthBar value={LEVEL_PCT[e.level] || 50} />
              </div>
            ))}
          </div>
        </Section>

        <Section title="Technologies">
          <div className="space-y-3">
            {TECHNOLOGIES.map((g) => (
              <div key={g.group} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
                <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2 inline-flex items-center gap-1.5"><Cpu size={13} className="text-violet-500" /> {g.group}</div>
                <div className="flex flex-wrap gap-1.5">
                  {g.items.map((t) => <Chip key={t}>{t}</Chip>)}
                </div>
              </div>
            ))}
          </div>
        </Section>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Section title="Industries">
          <div className="flex flex-wrap gap-1.5">
            {CAPABILITY_INDUSTRIES.map((i) => <Chip key={i} tone="emerald"><Building2 size={10} /> {i}</Chip>)}
          </div>
        </Section>

        <Section title="Company stages supported">
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 divide-y divide-gray-100 dark:divide-gray-800">
            {STAGES_SUPPORTED.map((s) => (
              <div key={s.stage} className="flex items-start justify-between gap-3 p-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100 inline-flex items-center gap-1.5"><Layers size={13} className="text-violet-500" /> {s.stage}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{s.note}</div>
                </div>
                <Badge tone={s.fit === 'Core' ? 'emerald' : s.fit === 'Active' ? 'blue' : 'amber'}>{s.fit}</Badge>
              </div>
            ))}
          </div>
        </Section>
      </div>

      <Section title="Typical engagements">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {TYPICAL_ENGAGEMENTS.map((e) => (
            <div key={e.name} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
              <div className="font-medium text-gray-900 dark:text-gray-100">{e.name}</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Chip><Clock size={10} /> {e.duration}</Chip>
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-2">{e.format}</div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">{e.description}</p>
            </div>
          ))}
        </div>
      </Section>

      <ServiceDetail service={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function ServiceDetail({ service, onClose }) {
  if (!service) return <SlideOver open={false} onClose={onClose} />;
  return (
    <SlideOver open onClose={onClose} title={service.name} subtitle={service.category}>
      <div className="flex items-center gap-3">
        <div className="w-14 h-14 rounded-xl bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 flex items-center justify-center flex-shrink-0">
          <Package size={26} />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Chip tone="violet">{service.category}</Chip>
          <Chip>{service.pricingModel}</Chip>
        </div>
      </div>

      <p className="text-sm text-gray-700 dark:text-gray-300">{service.summary}</p>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Pricing"><span className="inline-flex items-center gap-1"><DollarSign size={12} /> {service.priceRange}</span></Field>
        <Field label="Duration"><span className="inline-flex items-center gap-1"><Clock size={12} /> {service.duration}</span></Field>
        <Field label="Pricing model">{service.pricingModel}</Field>
      </div>

      <Section title="Deliverables">
        <BulletList items={service.deliverables} tone="violet" />
      </Section>

      <Section title="Outcomes">
        <div className="space-y-1.5">
          {service.outcomes.map((o) => (
            <div key={o} className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
              <CheckCircle2 size={15} className="text-emerald-500 mt-0.5 flex-shrink-0" />
              <span>{o}</span>
            </div>
          ))}
        </div>
      </Section>
    </SlideOver>
  );
}
