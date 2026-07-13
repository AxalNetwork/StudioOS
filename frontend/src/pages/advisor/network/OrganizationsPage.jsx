import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Building2, MapPin, Banknote, Globe, Link2, Calendar, Layers,
  Target, Ticket, Users2, Loader2, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { api } from '../../../lib/api';
import {
  Chip, SearchInput, FilterChips, SlideOver, Section, Field, EmptyState,
} from './kit';

// Organizations — real VC funds / deep-tech investors served from the backend
// `organizations` table (Task #16). Server-side search + type/region filtering
// + pagination keep the directory responsive across ~3,000 rows. Each row opens
// a slide-over profile populated from the fund/investor fields in the source
// CSVs; portfolio-company-only modules (leadership, employees, ownership, cap
// table, documents) are simply not rendered — investors have no such data.

const PAGE_SIZE = 24;
const MAX_TYPE_CHIPS = 6;

function cleanUrl(url) {
  return (url || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
}

export default function OrganizationsPage() {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [type, setType] = useState('all');
  const [region, setRegion] = useState('');
  const [page, setPage] = useState(1);

  const [facets, setFacets] = useState(null);
  const [data, setData] = useState({ items: [], total: 0, page: 1, page_size: PAGE_SIZE });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [selectedUid, setSelectedUid] = useState(null);

  // Debounce the search box so we don't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  // Reset to the first page whenever the query/filters change.
  useEffect(() => { setPage(1); }, [debounced, type, region]);

  useEffect(() => {
    let cancelled = false;
    api.getOrganizationFacets()
      .then((f) => { if (!cancelled) setFacets(f); })
      .catch(() => { /* facets are best-effort; filters just won't populate */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.listOrganizations({
      q: debounced,
      type: type === 'all' ? undefined : type,
      region: region || undefined,
      page,
      page_size: PAGE_SIZE,
    })
      .then((res) => { if (!cancelled) setData(res); })
      .catch((e) => { if (!cancelled) setError(e.message || 'Failed to load organizations'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [debounced, type, region, page]);

  const typeOptions = useMemo(() => {
    const opts = [{ id: 'all', label: 'All', count: facets?.total }];
    (facets?.types || []).slice(0, MAX_TYPE_CHIPS).forEach((t) => {
      opts.push({ id: t.value, label: t.value, count: t.count });
    });
    return opts;
  }, [facets]);

  const total = data.total || 0;
  const from = total === 0 ? 0 : (data.page - 1) * data.page_size + 1;
  const to = Math.min(data.page * data.page_size, total);
  const totalPages = Math.max(1, Math.ceil(total / data.page_size));

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600 dark:text-gray-400">
        A directory of {facets?.total ? facets.total.toLocaleString() : 'thousands of'} real
        VC funds and deep-tech investors — HQ, focus, ticket size, fund size, and known LPs.
        Open any organization for the full profile.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <SearchInput value={query} onChange={setQuery} placeholder="Search by name, HQ, sector, or type" />
        {(facets?.regions?.length || 0) > 0 && (
          <select
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-700 dark:text-gray-200 outline-none"
          >
            <option value="">All regions</option>
            {facets.regions.map((r) => (
              <option key={r.value} value={r.value}>{r.value} ({r.count})</option>
            ))}
          </select>
        )}
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {total.toLocaleString()} organizations
        </span>
      </div>

      <FilterChips options={typeOptions} value={type} onChange={setType} />

      {error ? (
        <EmptyState>{error}</EmptyState>
      ) : loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400">
          <Loader2 size={20} className="animate-spin" />
        </div>
      ) : data.items.length === 0 ? (
        <EmptyState>No organizations match your search.</EmptyState>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {data.items.map((o) => (
              <button
                key={o.uid}
                onClick={() => setSelectedUid(o.uid)}
                className="text-left rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 hover:border-violet-300 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <div className="w-11 h-11 rounded-lg bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 flex items-center justify-center flex-shrink-0">
                    <Building2 size={20} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-gray-900 dark:text-gray-100 truncate">{o.name}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                      {[o.org_type, o.hq_country].filter(Boolean).join(' · ') || 'Investor'}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {o.hq_country && <Chip><MapPin size={10} /> {o.hq_country}</Chip>}
                      {o.fund_size && <Chip tone="emerald"><Banknote size={10} /> {o.fund_size}</Chip>}
                      {(o.sector_tags || []).slice(0, 2).map((t) => (
                        <Chip key={t} tone="violet">{t}</Chip>
                      ))}
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between pt-1">
            <span className="text-xs text-gray-500 dark:text-gray-400">
              Showing {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-800 text-sm text-gray-600 dark:text-gray-300 disabled:opacity-40 hover:border-violet-300"
              >
                <ChevronLeft size={14} /> Prev
              </button>
              <span className="text-xs text-gray-500 dark:text-gray-400 tabular-nums">
                Page {data.page} / {totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-800 text-sm text-gray-600 dark:text-gray-300 disabled:opacity-40 hover:border-violet-300"
              >
                Next <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </>
      )}

      <OrgDetail uid={selectedUid} onClose={() => setSelectedUid(null)} />
    </div>
  );
}

function OrgDetail({ uid, onClose }) {
  const [org, setOrg] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const lastUid = useRef(null);

  useEffect(() => {
    if (!uid) { setOrg(null); setError(null); return undefined; }
    let cancelled = false;
    lastUid.current = uid;
    setLoading(true);
    setError(null);
    setOrg(null);
    api.getOrganization(uid)
      .then((o) => { if (!cancelled) setOrg(o); })
      .catch((e) => { if (!cancelled) setError(e.message || 'Failed to load organization'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [uid]);

  if (!uid) return <SlideOver open={false} onClose={onClose} />;

  const yearly = org ? Object.entries(org.yearly_raised || {}).sort((a, b) => a[0].localeCompare(b[0])) : [];
  const ticket = org && (org.min_ticket || org.max_ticket)
    ? [org.min_ticket, org.max_ticket].filter(Boolean).join(' – ')
    : null;

  return (
    <SlideOver
      open
      onClose={onClose}
      title={org?.name || (loading ? 'Loading…' : 'Organization')}
      subtitle={org ? [org.org_type, org.hq_country].filter(Boolean).join(' · ') : undefined}
    >
      {loading && (
        <div className="flex items-center justify-center py-10 text-gray-400">
          <Loader2 size={20} className="animate-spin" />
        </div>
      )}
      {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}

      {org && (
        <>
          <div className="flex items-center gap-3">
            <div className="w-14 h-14 rounded-xl bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 flex items-center justify-center flex-shrink-0">
              <Building2 size={26} />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(org.sector_tags || []).map((t) => <Chip key={t} tone="emerald">{t}</Chip>)}
            </div>
          </div>

          {org.sector_focus_text && (
            <p className="text-sm text-gray-700 dark:text-gray-300">{org.sector_focus_text}</p>
          )}

          <div className="grid grid-cols-2 gap-4">
            {org.org_type && <Field label="Type">{org.org_type}</Field>}
            {org.hq_country && (
              <Field label="HQ"><span className="inline-flex items-center gap-1"><MapPin size={12} /> {org.hq_country}</span></Field>
            )}
            {org.website && (
              <Field label="Website">
                <a href={org.website} target="_blank" rel="noreferrer"
                   className="inline-flex items-center gap-1 break-all text-violet-600 dark:text-violet-400 hover:underline">
                  <Globe size={12} /> {cleanUrl(org.website)}
                </a>
              </Field>
            )}
            {org.linkedin && (
              <Field label="LinkedIn">
                <a href={org.linkedin} target="_blank" rel="noreferrer"
                   className="inline-flex items-center gap-1 text-violet-600 dark:text-violet-400 hover:underline">
                  <Link2 size={12} /> Profile
                </a>
              </Field>
            )}
            {org.fund_size && (
              <Field label="Fund size"><span className="inline-flex items-center gap-1"><Banknote size={12} /> {org.fund_size}</span></Field>
            )}
            {org.latest_fund_date && (
              <Field label="Latest fund"><span className="inline-flex items-center gap-1"><Calendar size={12} /> {org.latest_fund_date}</span></Field>
            )}
            {org.fund_number && <Field label="Fund number">{org.fund_number}</Field>}
            {org.parent_company && <Field label="Parent company">{org.parent_company}</Field>}
            {ticket && (
              <Field label="Ticket size"><span className="inline-flex items-center gap-1"><Ticket size={12} /> {ticket}</span></Field>
            )}
            {org.dt_deal_count && (
              <Field label="Deep-tech deals"><span className="inline-flex items-center gap-1"><Users2 size={12} /> {org.dt_deal_count}</span></Field>
            )}
            {org.deep_tech_only != null && (
              <Field label="Deep-tech only">{org.deep_tech_only ? 'Yes' : 'No'}</Field>
            )}
          </div>

          {(org.stage_focus || []).length > 0 && (
            <Section title="Investment stage focus">
              <div className="flex flex-wrap gap-1.5">
                {org.stage_focus.map((s) => <Chip key={s} tone="blue"><Layers size={10} /> {s}</Chip>)}
              </div>
            </Section>
          )}

          {(org.region_focus || []).length > 0 && (
            <Section title="Region focus">
              <div className="flex flex-wrap gap-1.5">
                {org.region_focus.map((r) => <Chip key={r}><Target size={10} /> {r}</Chip>)}
              </div>
            </Section>
          )}

          {org.additional_focus && (
            <Section title="Specific / additional focus">
              <p className="text-sm text-gray-700 dark:text-gray-300">{org.additional_focus}</p>
            </Section>
          )}

          {org.notable_lps && (
            <Section title="Notable known LPs">
              <p className="text-sm text-gray-700 dark:text-gray-300">{org.notable_lps}</p>
            </Section>
          )}

          {yearly.length > 0 && (
            <Section title="Raised by year">
              <div className="rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
                {yearly.map(([year, amount]) => (
                  <div key={year} className="flex items-center justify-between p-2.5 text-sm">
                    <span className="inline-flex items-center gap-1.5 text-gray-700 dark:text-gray-300">
                      <Calendar size={13} className="text-gray-400" /> {year}
                    </span>
                    <span className="font-medium text-gray-900 dark:text-gray-100">{amount}</span>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </>
      )}
    </SlideOver>
  );
}
