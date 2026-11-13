import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { api } from '../lib/api';
import SitePage from '../components/site/SitePage';
import NetworkSubNav from '../components/site/NetworkSubNav';
import { FilterPills } from '../components/site/SiteBlocks';
import {
  useSiteStats, dirFigures, directoryTypeOf, directoryTypeLabel, directoryTypeOptions,
  directoryRole, initials, tintFor,
} from '../lib/siteResources';
import './site/network.css';

/**
 * The public Directory (D679, #1553), drawn to the canvas's DIRECTORY view:
 * the Network sub-nav, the "Global Venture Partner Network / Directory"
 * header, the four directory figures, the filter pills and the member rows.
 *
 * Every row is a listing `GET /api/public/partners` returns: admin-listed,
 * active operating partners, with the fields that read already exposes to a
 * logged-out visitor. Nobody is typed into this page. The canvas's members
 * are examples, and some of them name real people.
 *
 * The figures are the stats endpoint's D675 counts, each drawn only when it
 * comes back as a positive number. The pills are the entity types the loaded
 * rows carry; the canvas's Partners, LPs and Founders filters have no live
 * type and are not drawn. Search, the detailed filters, the verified-only
 * switch, the Verified and Featured marks and the profile links are the
 * page's own behaviour, kept.
 */

const CATEGORIES = ['legal', 'accounting', 'design', 'recruiting', 'fractional_cfo', 'gtm', 'engineering', 'marketing'];
const CAPACITY = ['available', 'limited', 'unavailable'];
const PRICING = ['$', '$$', '$$$'];
const BLANK = { q: '', category: '', capacity: '', pricing: '', verified_only: false, rate_max: '' };

/** The four figures, as boxed cards; nothing at all when none came back. */
export function DirectoryFigures({ stats }) {
  const figures = dirFigures(stats);
  if (figures.length === 0) return null;
  return (
    <ul className="ax-dir-figs" aria-label="The directory in figures">
      {figures.map((f) => (
        <li key={f.key} className="ax-dir-fig">
          <div className="ax-mono ax-dir-fig-v">{f.value.toLocaleString('en-US')}</div>
          <div className="ax-lbl-q ax-dir-fig-k">{f.label}</div>
        </li>
      ))}
    </ul>
  );
}

/** One member row: initials, name, type, the read's own line, and the profile link. */
export function PartnerCard({ p }) {
  const role = directoryRole(p);
  return (
    <li className="ax-nw-row ax-dir-row">
      <span className="ax-nw-av" style={{ background: tintFor(p.slug) }} aria-hidden="true">{initials(p.name)}</span>
      <div className="ax-nw-row-main">
        <div className="ax-dir-namerow">
          <div className="ax-dir-name">{p.name}</div>
          <span className="ax-chip ax-chip-quiet">{directoryTypeLabel(directoryTypeOf(p))}</span>
          {p.kyb_verified && <span className="ax-chip ax-chip-green" title="KYB verified">Verified</span>}
          {p.featured && <span className="ax-chip ax-chip-amber">Featured</span>}
        </div>
        {role && <div className="ax-dir-role">{role}</div>}
      </div>
      <Link to={`/partners/${p.slug}`} className="ax-dir-cta" aria-label={`View profile: ${p.name}`}>View profile</Link>
    </li>
  );
}

export default function PublicDirectoryPage() {
  const stats = useSiteStats();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState(BLANK);
  const [applied, setApplied] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [type, setType] = useState('');

  const load = (params) => {
    setLoading(true); setError(null);
    api.publicListPartners(params)
      .then(setData)
      .catch((e) => setError(e.message || 'Failed to load directory'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load({}); }, []);

  const apply = () => {
    const p = { ...filters };
    if (!p.verified_only) delete p.verified_only;
    if (!p.rate_max) delete p.rate_max;
    setApplied(Object.values(p).some(Boolean));
    load(p);
  };

  const reset = () => {
    setFilters(BLANK);
    setApplied(false);
    load({});
  };

  const partners = useMemo(() => data?.partners || [], [data]);
  const typeOptions = useMemo(() => directoryTypeOptions(partners), [partners]);
  const shown = useMemo(
    () => (type ? partners.filter((p) => directoryTypeOf(p) === type) : partners),
    [partners, type],
  );
  // A type that the latest read no longer carries falls back to All.
  useEffect(() => {
    if (type && !typeOptions.some((o) => o.value === type)) setType('');
  }, [type, typeOptions]);
  const dirty = filters.q || filters.category || filters.capacity || filters.pricing || filters.verified_only || filters.rate_max;
  const set = (k) => (e) => setFilters({ ...filters, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  return (
    <SitePage title="Directory">
      <NetworkSubNav />
      <div className="ax-wrap ax-nw">
        <div className="ax-lbl-q ax-nw-eyebrow">Global Venture Partner Network</div>
        <h1 className="ax-nw-h1">Directory</h1>
        <p className="ax-nw-lede">
          Directory access is verified — members see full profiles and can request warm introductions.
        </p>
        <DirectoryFigures stats={stats} />

        <div className="ax-dir-pills">
          <FilterPills options={typeOptions} value={type} onChange={setType} label="Member type" />
        </div>

        <div className="ax-nw-tools">
          <div className="ax-nw-search">
            <Search size={15} aria-hidden="true" />
            <input
              type="text"
              placeholder="Search by name, company, or specialization"
              aria-label="Search the directory"
              value={filters.q}
              onChange={set('q')}
              onKeyDown={(e) => { if (e.key === 'Enter') apply(); }}
              className="ax-nw-input"
            />
          </div>
          <button type="button" onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters} className="ax-btn ax-btn-sm ax-btn-quiet">
            <SlidersHorizontal size={14} aria-hidden="true" /> Filters
          </button>
          <button type="button" onClick={apply} className="ax-btn ax-btn-sm ax-btn-primary">Search</button>
          {dirty && (
            <button type="button" onClick={reset} className="ax-btn ax-btn-sm ax-btn-quiet">
              <X size={14} aria-hidden="true" /> Clear
            </button>
          )}
          {!loading && !error && <span className="ax-nw-count">{data?.total || 0} listed</span>}
        </div>

        {showFilters && (
          <div className="ax-dir-filters">
            <div>
              <label htmlFor="ax-dir-category">Category</label>
              <select id="ax-dir-category" value={filters.category} onChange={set('category')} className="ax-nw-select">
                <option value="">All categories</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="ax-dir-capacity">Capacity</label>
              <select id="ax-dir-capacity" value={filters.capacity} onChange={set('capacity')} className="ax-nw-select">
                <option value="">Any</option>
                {CAPACITY.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="ax-dir-pricing">Pricing tier</label>
              <select id="ax-dir-pricing" value={filters.pricing} onChange={set('pricing')} className="ax-nw-select">
                <option value="">Any</option>
                {PRICING.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="ax-dir-rate">Max hourly rate (USD)</label>
              <input id="ax-dir-rate" type="number" min="0" value={filters.rate_max} onChange={set('rate_max')} className="ax-nw-input" />
            </div>
            <label className="ax-dir-check">
              <input type="checkbox" checked={filters.verified_only} onChange={set('verified_only')} />
              KYB-verified partners only
            </label>
          </div>
        )}

        <div className="ax-nw-panel ax-dir-list">
          {loading && <p className="ax-nw-empty">Loading directory…</p>}
          {!loading && error && <p className="ax-nw-empty ax-dir-error" role="alert">{error}</p>}
          {!loading && !error && shown.length === 0 && (
            <p className="ax-nw-empty">
              {applied ? 'No partners match your filters yet.' : 'No one is listed in the directory yet.'}
            </p>
          )}
          {!loading && !error && shown.length > 0 && (
            <ul className="ax-nw-list">
              {shown.map((p) => <PartnerCard key={p.slug} p={p} />)}
            </ul>
          )}
        </div>

        <p className="ax-dir-foot">
          Verified members only. <Link to="/contact">Request directory access →</Link>
        </p>
      </div>
    </SitePage>
  );
}

