/**
 * `/circles` — Communities & Circles, built to the owner's canvas (D679, #1553;
 * `design/canvases/integrated/Axal VC Website.dc.html`, COMMUNITIES & CIRCLES).
 *
 * The cards are the published circles from `GET /api/public/circles`, which an
 * admin authors at /admin/circles. The canvas also draws a cadence line and a
 * seats chip on each card; a circle row stores neither, so neither is drawn.
 * The access chip, the type and region line, the tagline and the member count
 * are the row's own fields. Joining and requesting access go where they went
 * before this rebuild.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Search, Users, MapPin, Sparkles, Rocket, TrendingUp, Handshake, GraduationCap,
} from 'lucide-react';
import SitePage from '../components/site/SitePage';
import NetworkSubNav from '../components/site/NetworkSubNav';
import { EmptyNote, FilterPills } from '../components/site/SiteBlocks';
import {
  CIRCLE_TYPES, CIRCLE_TYPE_LABEL, ACCESS_TYPES,
} from '../data/network';
import { circlesPublic } from '../lib/api';
import { reportError } from '../lib/log';
import { CIRCLES_COPY } from '../lib/siteNetwork2';
import './site/network2.css';

// lucide icons referenced by name in the circle-type config.
const TYPE_ICONS = {
  Rocket, TrendingUp, Handshake, GraduationCap, MapPin, Sparkles,
};

const TYPE_FILTERS = [{ value: '', label: 'All' }, ...CIRCLE_TYPES.map((t) => ({ value: t.id, label: t.short }))];
const ACCESS_FILTERS = [{ id: '', label: 'All access' }, ...ACCESS_TYPES];

/** Where a circle's Join / Request access goes: the existing hand-off into registration. */
export function circleJoinHref(c) {
  return `/register?intent=circle&circle=${encodeURIComponent(c.slug || c.id)}`;
}

/** One circle, as the canvas's card, drawn from the row's own fields only. */
export function CircleCard({ c }) {
  const type = CIRCLE_TYPES.find((t) => t.id === c.type);
  const Icon = TYPE_ICONS[type?.icon] || Users;
  const isPrivate = c.access === 'private';
  const sub = [CIRCLE_TYPE_LABEL[c.type] || c.type, c.region].filter(Boolean).join(' · ');
  const members = Number(c.members);
  return (
    <article className="ax-card ax-n2-circle">
      <div className="ax-n2-circle-top">
        <span className={`ax-n2-icon${isPrivate ? ' is-private' : ''}`} aria-hidden="true"><Icon size={19} /></span>
        <div className="ax-n2-main">
          <h2 className="ax-n2-circle-t">{c.name}</h2>
          {sub && <div className="ax-n2-circle-sub">{sub}</div>}
        </div>
        <span className={`ax-chip ${isPrivate ? 'ax-chip-quiet' : 'ax-n2-chip-green'}`}>{isPrivate ? 'Invite-only' : 'Public'}</span>
      </div>
      {c.tagline && <p className="ax-n2-circle-d">{c.tagline}</p>}
      <div className="ax-n2-circle-foot">
        {Number.isFinite(members) && members > 0 && (
          <span className="ax-mono ax-n2-count">{members.toLocaleString('en-US')} {members === 1 ? 'member' : 'members'}</span>
        )}
        <Link to={circleJoinHref(c)} className={`ax-btn ax-btn-sm ${isPrivate ? 'ax-btn-quiet' : 'ax-btn-primary'}`}>
          {isPrivate ? 'Request access' : 'Join'}
        </Link>
      </div>
    </article>
  );
}

export default function CirclesPage() {
  const [circles, setCircles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [access, setAccess] = useState('');
  const [region, setRegion] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await circlesPublic.list();
        if (alive) setCircles(Array.isArray(res?.circles) ? res.circles : []);
      } catch (e) {
        // Worker-only route: 404s in local dev (FastAPI doesn't implement it).
        // Public marketing surface — degrade to the empty state, never a crash.
        reportError('CirclesPage:load', e);
        if (alive) setCircles([]);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const regions = useMemo(() => {
    const set = new Set(circles.map((c) => c.region).filter(Boolean));
    return Array.from(set).sort();
  }, [circles]);

  // The Worker already orders the feed featured first, then by the admin's
  // sort order, so the grid keeps that order rather than re-sorting it.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return circles.filter((c) => {
      if (type && c.type !== type) return false;
      if (access && c.access !== access) return false;
      if (region && c.region !== region) return false;
      if (q) {
        const hay = `${c.name} ${c.tagline || ''} ${c.theme || ''} ${(c.tags || []).join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [circles, search, type, access, region]);

  const hasFilters = search || type || access || region;

  return (
    <SitePage title={CIRCLES_COPY.title}>
      <NetworkSubNav />
      <div className="ax-wrap ax-n2-page">
        <header>
          <div className="ax-lbl-q">{CIRCLES_COPY.eyebrow}</div>
          <h1 className="ax-n2-h1">{CIRCLES_COPY.title}</h1>
          <p className="ax-n2-lede">{CIRCLES_COPY.lede}</p>
          <div className="ax-row-btns" style={{ marginTop: 24 }}>
            <Link to="/register?intent=circle" className="ax-btn ax-btn-md ax-btn-primary">Join the network →</Link>
            <Link to="/contact?topic=circle" className="ax-btn ax-btn-md ax-btn-quiet">Create a circle</Link>
          </div>
        </header>

        {loading ? (
          <div style={{ marginTop: 34 }}><EmptyNote>Loading circles…</EmptyNote></div>
        ) : circles.length === 0 ? (
          <div style={{ marginTop: 34 }}>
            <EmptyNote>No circles are published yet. They will appear here as soon as they launch.</EmptyNote>
          </div>
        ) : (
          <section aria-label="Circles" style={{ marginTop: 34 }}>
            <FilterPills label="Circle type" options={TYPE_FILTERS} value={type} onChange={setType} />
            <div className="ax-n2-tools">
              <label className="ax-n2-search" style={{ position: 'relative', display: 'flex' }}>
                <span className="sr-only">Search circles</span>
                <Search size={15} aria-hidden="true" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--ax-faint)' }} />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search circles by name, theme, or tag"
                  className="ax-n2-input"
                  style={{ width: '100%', paddingLeft: 34 }}
                />
              </label>
              <select
                value={access}
                onChange={(e) => setAccess(e.target.value)}
                className="ax-n2-select"
                aria-label="Filter by access"
              >
                {ACCESS_FILTERS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
              <select
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                className="ax-n2-select"
                aria-label="Filter by region"
              >
                <option value="">All regions</option>
                {regions.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              {hasFilters && (
                <button
                  type="button"
                  onClick={() => { setSearch(''); setType(''); setAccess(''); setRegion(''); }}
                  className="ax-n2-textlink"
                >
                  Clear filters
                </button>
              )}
            </div>

            {filtered.length === 0 ? (
              <EmptyNote>No circles match your filters yet.</EmptyNote>
            ) : (
              <div className="ax-grid-2 ax-n2-circles" style={{ marginTop: 8 }}>
                {filtered.map((c) => <CircleCard key={c.id} c={c} />)}
              </div>
            )}
          </section>
        )}
      </div>
    </SitePage>
  );
}
