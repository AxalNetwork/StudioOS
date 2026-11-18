import React, { useEffect, useState } from 'react';
// FIVE ICONS WENT WITH THE CARD GRID. `Plus`, `Edit3`, `Trash2`, `ToggleLeft`
// and `ToggleRight` labelled the New offering button and the four per-card
// controls; the artboard's instrument carries those controls as text links
// inside the cell whose subject they act on, and its ops row supplies the fifth.
// `check-unused-imports` is CodeQL-backed and would have reported all five.
import {
  Search, Filter, Briefcase, ShieldCheck,
  AlertCircle, X, Check, ExternalLink, Package,
} from 'lucide-react';
import { api } from '../lib/api';
import Sheet from '../ui/Sheet.jsx';
import OfferPages from '../ui/OfferPages.jsx';
import ZoneToolbar from '../workspaces/ZoneToolbar';
import { FillFormBar, FillLabel, useScopedFill } from '../ui/useScopedFill.jsx';
import { SCOPED_FORMS } from '../lib/fillScoped.js';
import ZoneDraft from '../workspaces/ZoneDraft';
import { NotRecorded } from '../workspaces/canvasKit';
import { Pill, NotMeasured } from './partner/kit';
import { CATALOG_FOOT, LISTING_STATES, inListing, listingCounts, priceBasis, requestsLine } from './partner/offers/catalogModel.js';
import { useRailPage } from '../ui/railCrumbs';
import { railOptionFor } from '../lib/railOptions';

const CATEGORIES = ['legal', 'accounting', 'design', 'recruiting', 'fractional_cfo', 'gtm', 'engineering', 'marketing'];
const CAT_LABEL = {
  legal: 'Legal', accounting: 'Accounting', design: 'Design', recruiting: 'Recruiting',
  fractional_cfo: 'Fractional CFO', gtm: 'GTM', engineering: 'Engineering', marketing: 'Marketing',
};


/**
 * The Offers · Catalog zone body (`/offers/catalog`): `MineTab` alone, inside a
 * WorkspaceShell that has already drawn the crumb, the h1 and the zone pills.
 * PO1 in `design/canvases/integrated/Pages · Partner Offers.dc.html` declares
 * one control row and no tab row; its subject is "what the firm sells".
 *
 * #2338 — the standalone `/services` page that also lived here (Browse
 * catalogue, My offerings, Stripe Connect behind one tab row) is removed
 * (#2297 §7); `/services` forwards to this zone, or to the founder
 * marketplace for a founder. `FounderMarketplacePage.jsx` still imports
 * `BrowseTab`, `MineTab` and `StripeTab` from this file.
 *
 * `zoneActions` is a render prop, and it is deliberately not a role check.
 * The caller decides, this file only renders what it is handed — so the
 * partner's table stays in the partner's file and this shared module learns
 * nothing about licences. It is called with the rows the tab has loaded,
 * because an export of "this view" needs the view.
 */
export default function ServiceCatalogPage({ user, zoneActions, zoneFilters, role }) {
  return <MineTab user={user} zoneActions={zoneActions} zoneFilters={zoneFilters} role={role} />;
}

// ---------------------------------------------------------------------------
// Browse — public listings (founders, investors, admins, other partners)
// ---------------------------------------------------------------------------
export function BrowseTab({ user, isFounder }) {
  const [filters, setFilters] = useState({ category: '', q: '' });
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [result, setResult] = useState(null);
  const applied = React.useRef({});
  const request = React.useRef(0);

  async function load(page = 1, query = applied.current) {
    const generation = ++request.current;
    setLoading(true); setError(null);
    try {
      const r = await api.listServiceOfferings({ ...query, page });
      // `.items`, not `.offerings`. GET /services/offerings answers
      // `c.json({ items })` (services.ts) and always has; reading `.offerings`
      // resolved to undefined, fell through the `|| []`, and rendered the
      // browse catalogue as "no offerings published yet" however many were.
      if (generation !== request.current) return;
      setRows(r.items || []);
      setResult(r);
      applied.current = query;
    } catch (e) {
      if (generation !== request.current) return;
      // 404 = catalogue route missing on this deployment (stale worker).
      // The empty-state card already covers "no offerings published yet" —
      // don't double up with a raw red banner above it.
      const msg = (e?.message || '').toLowerCase();
      if (e?.status === 404 || msg === 'not found') setRows([]);
      else setError(e.message);
    }
    finally { if (generation === request.current) setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-line */ }, []);

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-wrap items-center gap-2 dark:bg-gray-900 dark:border-gray-800">
        <Filter size={14} className="text-gray-500" />
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-2.5 text-gray-400" />
          <input value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} placeholder="Search title or description"
            className="pl-8 border border-gray-300 rounded-md px-3 py-1.5 text-sm dark:border-gray-700" />
        </div>
        <select value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })} className="border border-gray-300 rounded-md px-3 py-1.5 text-sm bg-white dark:border-gray-700 dark:bg-gray-900">
          <option value="">All categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}
        </select>
        <button onClick={() => load(1, filters)} className="ml-auto bg-violet-600 hover:bg-violet-700 text-white rounded-md px-4 py-1.5 text-sm font-medium">Apply</button>
      </div>

      {error && <ErrorBox message={error} />}
      {loading && <div className="text-sm text-gray-500">Loading…</div>}
      {!loading && rows.length === 0 && <Empty icon={Briefcase} text="No offerings published yet." />}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {rows.map((o) => <OfferingCard key={o.id} o={o} onClick={() => setSelected(o)} />)}
      </div>
      <OfferPages label="Catalogue" result={result} busy={loading} onPage={load} />

      {selected && (
        <OfferingDetailModal
          offering={selected}
          user={user}
          isFounder={isFounder}
          onClose={() => { setSelected(null); load(); }}
        />
      )}
    </div>
  );
}

/**
 * The offering's price, or null — never a throw, and never a fabricated zero.
 *
 * WHY THIS EXISTS AT ALL. Every price site in this file read `o.price` and
 * called `.toLocaleString()` on it unguarded. `GET /services/offerings`
 * serializes `price_usd` and has never sent a `price`, so each of those four
 * sites threw `Cannot read properties of undefined` on the FIRST row it drew.
 * The page has looked fine only because `service_offerings` holds no rows in
 * production: the empty state renders, the card that crashes never does.
 *
 * `price_usd` is also nullable in the schema and in the PUT that writes it, so
 * a row can legitimately carry no price. That is not zero — an offering priced
 * on enquiry is not an offering that costs nothing — so it renders as a dash.
 */
function priceLabel(o) {
  const usd = o?.price_usd;
  return typeof usd === 'number' && Number.isFinite(usd) ? `$${usd.toLocaleString()}` : '—';
}

function OfferingCard({ o, onClick }) {
  return (
    <button onClick={onClick} className="text-left bg-white border border-gray-200 hover:border-violet-300 hover:shadow-sm transition rounded-xl p-4 flex flex-col gap-2 dark:bg-gray-900 dark:border-gray-800">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{o.title}</div>
          <div className="text-xs text-gray-500 mt-0.5">{o.partner_name || 'Unknown partner'} · {CAT_LABEL[o.category] || o.category}</div>
        </div>
        <span className="text-xs px-2 py-0.5 rounded-full border bg-violet-50 text-violet-700 border-violet-200 whitespace-nowrap">
          {priceLabel(o)}
        </span>
      </div>
      <p className="text-sm text-gray-700 line-clamp-3 dark:text-gray-300">{o.summary}</p>
      <div className="flex items-center gap-3 text-xs text-gray-500 mt-1">
        {o.partner_kyb_status === 'verified' && <span className="flex items-center gap-1 text-emerald-700"><ShieldCheck size={12} /> Verified</span>}
        {!o.is_active && <span className="flex items-center gap-1 text-amber-700">Unlisted</span>}
      </div>
    </button>
  );
}

function OfferingDetailModal({ offering, user, isFounder, onClose }) {
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  useEffect(() => {
    if (!isFounder) return;
    api.listProjects().then((r) => {
      const list = Array.isArray(r) ? r : (r.projects || []);
      setProjects(list);
      if (list.length) setProjectId(String(list[0].id));
    }).catch(() => {});
  }, [isFounder]);

  async function engage() {
    setBusy(true); setError(null);
    try {
      const r = await api.engageServiceOffering(offering.id, { project_id: Number(projectId), notes });
      setDone(r);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return (
    <Sheet label={offering.title || 'Offering'} title={offering.title}
      sub={`${offering.partner_name} · ${CAT_LABEL[offering.category] || offering.category}`}
      onClose={onClose} width={640} testId="service-offering-detail">
      <div className="space-y-4 p-5 text-sm">
        <div className="flex items-center gap-3">
          <span className="text-lg font-semibold text-gray-900 dark:text-gray-100">{priceLabel(offering)}</span>
        </div>
        <Field label="Description"><p className="text-gray-800 whitespace-pre-line dark:text-gray-200">{offering.summary}</p></Field>
        {/* NO `Deliverables` FIELD: there is no such column, so this rendered an
            empty paragraph under a confident heading on every offering. */}

        {isFounder && !done && (
          <div className="border-t pt-4 space-y-3">
            <Field label="Charge to project">
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full bg-white dark:border-gray-700 dark:bg-gray-900">
                {projects.length === 0 && <option value="">No startups</option>}
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Notes for the partner (optional)">
              <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full dark:border-gray-700" />
            </Field>
            {error && <ErrorBox message={error} />}
            <button disabled={busy || !projectId} onClick={engage} className="bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 text-white rounded-md px-4 py-2 text-sm font-medium flex items-center gap-2">
              <Check size={14} /> {busy ? 'Booking…' : `Book this offering — ${priceLabel(offering)}`}
            </button>
          </div>
        )}
        {done && (
          <div className="border-t pt-4">
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg px-4 py-3 text-sm flex items-start gap-2">
              <Check size={16} className="mt-0.5" />
              <div>
                <div className="font-semibold">Engagement created (#{done.engagement_id})</div>
                <div className="text-xs mt-1">Status: <strong>{done.status}</strong>. Track it on the Needs Board → Engagements tab.</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Mine — partner manages their own offerings
// ---------------------------------------------------------------------------
/**
 * How each service is charged — migration 227's `engagement_model`.
 *
 * THE `po1` ARTBOARD'S `Model` COLUMN, AND ITS FOUR CHIPS. `All`, `Fixed`,
 * `Retainer` and `Seat` narrow on this and on nothing else; before the column
 * existed, three of the four selected every row and the tab reported "the one
 * view it has" — which was honest and is no longer necessary.
 */
const MODELS = [['fixed', 'Fixed'], ['retainer', 'Retainer'], ['seat', 'Seat']];
const MODEL_LABEL = Object.fromEntries(MODELS);

/** The chips, as predicates. `all` is absent and falls through to every row. */
const NARROW = {
  fixed: (o) => o.engagement_model === 'fixed',
  retainer: (o) => o.engagement_model === 'retainer',
  seat: (o) => o.engagement_model === 'seat',
};

/*
 * Cents become a dollar figure ONCE, in `priceBasis` (`partner/offers/catalogModel.js`,
 * #4843 part 3). `priceLabel` above still reads `price_usd` for the marketplace cards.
 */

/**
 * A service with no price is a DRAFT, and that is derived rather than stored.
 *
 * The artboard's sixth row is the unpriced retainer, and its whole argument is
 * that the absence must show: "an invented number here would propagate straight
 * into lead scoring and into every proposal generated from the catalog." A
 * service that cannot be quoted is not live, whatever its listing flag says —
 * so the state follows the price, and `is_active` keeps meaning what it always
 * meant, which is whether the marketplace shows it.
 */
export function catalogState(o) {
  if (o.price_cents == null) return 'Draft';
  return o.is_active ? 'Live' : 'Unlisted';
}

export function MineTab({ user, zoneActions, zoneFilters, role }) {
  // D779: the band's key on this profile's board (D772's lookup), where the inventory names one.
  const railPage = useRailPage()?.page ?? null;
  const [rows, setRows] = useState([]);
  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [listing, setListing] = useState('All');
  const [menuFor, setMenuFor] = useState(null);
  const [filter, setFilter] = useState('all');
  const [result, setResult] = useState(null);
  const request = React.useRef(0);

  async function load(page = result?.page ?? 1) {
    const generation = ++request.current;
    setLoading(true); setError(null);
    try {
      // `?mine=1` scopes on owner_user_id and includes inactive drafts — the
      // arm services.ts added for exactly this view. The previous call went to
      // /services/partners/:id/offerings, a route the worker has never served:
      // it 404'd, the catch below swallowed the 404 as an empty list, and the
      // tab reported "0 offerings" to a partner with a full catalogue. It also
      // returned early on a missing `partner_id`, which is not the key this
      // store uses — an offering belongs to a user, not to a partner org row.
      let r = await api.listServiceOfferings({ mine: 1, page });
      if (!r.items?.length && page > 1) {
        r = await api.listServiceOfferings({ mine: 1, page: Math.max(1, Math.ceil(r.total / r.page_size)) });
      }
      if (generation !== request.current) return;
      setRows(r.items || []);
      setResult(r);
    } catch (e) {
      if (generation !== request.current) return;
      const msg = (e?.message || '').toLowerCase();
      if (e?.status === 404 || msg === 'not found') setRows([]);
      else setError(e.message);
    }
    finally { if (generation === request.current) setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-line */ }, []);

  async function toggleListed(o) {
    try {
      await api.updateServiceOffering(o.id, { is_active: !o.is_active });
      load();
    } catch (e) { setError(e.message); }
  }
  async function remove(o) {
    if (!window.confirm(`Remove "${o.title}"? If it has service requests or market readings, it will be unlisted and those records will be kept. Otherwise it will be deleted.`)) return;
    try { await api.deleteServiceOffering(o.id); load(); } catch (e) { setError(e.message); }
  }

  // Gated on ROLE, not on `partner_id`. The tab is only offered to a partner or
  // an admin (see `tabs` above), and `?mine=1` returns nothing but the caller's
  // own rows — so a `partner_id` test could only ever hide a partner's own
  // catalogue from them, which is what it was doing.
  if (user?.role !== 'partner' && user?.role !== 'admin') {
    return <Empty icon={Briefcase} text="Only partner accounts can publish offerings." />;
  }

  // #4843 part 3 (D4843-p3, OF-02): the model chips (the toolbar's) and the listing switch
  // (the page's) narrow together; the switch's counts are over the whole page of rows.
  const byModel = NARROW[filter] ? rows.filter(NARROW[filter]) : rows;
  const visible = byModel.filter(inListing(listing, catalogState));
  const choose = (key) => setFilter((current) => (current === key ? 'all' : key));
  const counts = listingCounts(rows, catalogState);
  const edit = (o) => { setMenuFor(null); setEditing(o); setShowForm(true); };

  const handlers = {
    newService: {
      onClick: () => { setEditing(null); setShowForm(true); },
      title: 'add a service to the catalog',
    },
  };

  const priceCell = (o) => {
    const line = priceBasis(o);
    return line ?? <span className="text-axal-muted" data-testid={`catalog-noprice-${o.id}`}>No price yet</span>;
  };
  const requestsCell = (o) => {
    const line = requestsLine(o);
    return line ?? <NotMeasured label="Not recorded" why="This row predates request counts, so none is stated." testId={`catalog-requests-${o.id}`} />;
  };
  const statePill = (o) => {
    const state = catalogState(o);
    return <Pill tone={state === 'Live' ? 'ok' : state === 'Draft' ? 'warn' : 'neutral'}>{state}</Pill>;
  };
  const rowMenu = (o) => (
    <span className="relative inline-block">
      <button type="button" aria-label={`More actions for ${o.title}`} aria-expanded={menuFor === o.id}
        onClick={() => setMenuFor((m) => (m === o.id ? null : o.id))} data-testid={`catalog-more-${o.id}`}
        className="ml-1 inline-flex h-8 w-8 items-center justify-center rounded-md border border-axal-hairline text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800 max-sm:h-11 max-sm:w-11">⋯</button>
      {menuFor === o.id && (
        <span role="menu" className="absolute right-0 z-10 mt-1 flex w-36 flex-col rounded-md border border-axal-hairline bg-white p-1 text-left shadow-md dark:border-gray-700 dark:bg-gray-900"
          data-testid={`catalog-menu-${o.id}`}>
          <button type="button" role="menuitem" onClick={() => { setMenuFor(null); toggleListed(o); }}
            className="rounded px-2 py-1.5 text-left text-[12.5px] hover:bg-gray-50 dark:hover:bg-gray-800">{o.is_active ? 'Unlist' : 'List'}</button>
          <button type="button" role="menuitem" onClick={() => { setMenuFor(null); remove(o); }}
            className="mt-1 rounded border-t border-axal-hairline px-2 py-1.5 text-left text-[12.5px] text-rose-700 hover:bg-rose-50 dark:border-gray-800 dark:text-rose-300 dark:hover:bg-rose-950/30">Delete</button>
        </span>
      )}
    </span>
  );
  const editButton = (o) => (
    <button type="button" onClick={() => edit(o)} data-testid={`catalog-edit-${o.id}`}
      className="rounded-md px-2 py-1 text-[12.5px] font-semibold text-axal-ink hover:bg-gray-50 dark:text-gray-100 dark:hover:bg-gray-800 max-sm:min-h-[44px]">Edit</button>
  );
  const modelOf = (o) => (o.engagement_model ? MODEL_LABEL[o.engagement_model] : null);

  return (
    <div className="space-y-4">
      {/* `role` IS THE SHELL'S LICENCE, NOT THE VIEWER'S: this page is mounted at
          `/offers/catalog` inside the partner shell, so the caller says which shell it
          is and this page learns nothing about roles. The model chips are the toolbar's;
          migration 227 made them real. */}
      {(zoneActions || zoneFilters) && (
        <ZoneToolbar
          role={role}
          filters={zoneFilters ? zoneFilters({ value: filter, onChange: choose }) : []}
          actions={zoneActions ? zoneActions(visible, handlers) : []}
        />
      )}

      <div>
        <h2 className="text-lg font-extrabold tracking-tight text-axal-ink dark:text-gray-100">Catalog</h2>
        <p className="mt-1 text-[12.5px] text-gray-600 dark:text-gray-400">The services your firm sells through Axal.</p>
      </div>

      {error && <ErrorBox message={error} />}
      {loading && <div className="text-sm text-gray-500">Loading…</div>}

      {!loading && rows.length === 0 ? (
        <Empty icon={Package} text="No services yet. Add your first service to appear in the catalogue." />
      ) : (
        <>
          <div role="radiogroup" aria-label="Listing state" className="inline-flex flex-wrap gap-1 rounded-lg border border-axal-hairline p-1 dark:border-gray-800"
            data-testid="catalog-listing">
            {['All', ...LISTING_STATES].map((k) => (
              <button key={k} type="button" role="radio" aria-checked={listing === k} onClick={() => setListing(k)}
                data-testid={`catalog-listing-${k}`}
                className={`rounded-md px-2.5 py-1 text-[12.5px] font-semibold max-sm:min-h-[44px] ${listing === k ? 'bg-axal-ink text-white dark:bg-gray-100 dark:text-gray-900' : 'text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800'}`}>
                {k} {counts[k]}
              </button>
            ))}
          </div>
          {result?.total > result?.page_size && <p className="text-[12px] text-gray-600 dark:text-gray-400">Counts and filters apply to this page.</p>}

          <section className="overflow-hidden rounded-xl border border-axal-hairline dark:border-gray-800" data-testid="service-catalog">
            <table className="hidden w-full text-left text-[13px] sm:table">
              <thead className="bg-gray-50 text-[11px] uppercase tracking-[.06em] text-axal-faint dark:bg-gray-900/40">
                <tr>
                  <th scope="col" className="px-3 py-2">Service</th>
                  <th scope="col" className="px-3 py-2">Engagement model</th>
                  <th scope="col" className="px-3 py-2 text-right">Price</th>
                  <th scope="col" className="px-3 py-2">Listing</th>
                  <th scope="col" className="px-3 py-2">Requests</th>
                  <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((o) => (
                  <tr key={o.id} className="border-t border-axal-hairline dark:border-gray-800" data-testid={`catalog-row-${o.id}`}>
                    <td className="px-3 py-2.5">
                      <b className="block text-[14px]">{o.title}</b>
                      <small className="text-[12px] text-axal-muted">{CAT_LABEL[o.category] || o.category}</small>
                    </td>
                    <td className="px-3 py-2.5">{modelOf(o) ?? <NotRecorded />}</td>
                    <td className="px-3 py-2.5 text-right font-mono">{priceCell(o)}</td>
                    <td className="px-3 py-2.5">{statePill(o)}</td>
                    <td className="px-3 py-2.5">{requestsCell(o)}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right">{editButton(o)}{rowMenu(o)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="divide-y divide-axal-hairline sm:hidden dark:divide-gray-800" data-testid="catalog-cards">
              {visible.map((o) => (
                <li key={o.id} className="space-y-1 p-3" data-testid={`catalog-card-${o.id}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div><b className="block text-[14px]">{o.title}</b><small className="text-[12px] text-axal-muted">{CAT_LABEL[o.category] || o.category}</small></div>
                    {statePill(o)}
                  </div>
                  <p className="text-[12.5px]">{modelOf(o) ?? 'Model not recorded'} · {priceCell(o)}</p>
                  <p className="text-[12.5px]">{requestsCell(o)}</p>
                  <div className="flex items-center justify-end">{editButton(o)}{rowMenu(o)}</div>
                </li>
              ))}
            </ul>
          </section>
          {!visible.length && (
            <p className="text-[12px] text-gray-600 dark:text-gray-300" data-testid="catalog-view-empty">No service is in this view.</p>
          )}
          <p className="text-[12px] text-gray-600 dark:text-gray-400" data-testid="catalog-foot">{CATALOG_FOOT}</p>
        </>
      )}

      <OfferPages label="Catalogue" result={result} busy={loading} onPage={load} />

      <ZoneDraft
        surface="offers/catalog"
        railOption={railOptionFor(railPage, { file: 'pages/ServiceCatalogPage.jsx', control: 'offers/catalog' })?.key}
        label="Draft · catalog read"
        accept="Accept draft"
        run="Read the catalog"
        foot="Figures read from catalog rows."
        empty="Where requests concentrate across the catalog, and which entries nobody has requested or booked. Points to any unpriced draft as the gap: demand shaped like it appears in the lead feed with nothing priced to match against."
        nothingToDraft="The catalog is empty, so there is nothing to read across."
      />

      {showForm && (
        <OfferingFormModal
          offering={editing}
          user={user}
          fillOn={role === 'partner'}
          onClose={() => { setShowForm(false); setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

/**
 * The five fields `service_offerings` actually has, and the three it does not.
 *
 * THIS FORM USED TO COLLECT EIGHT AND SAVE TWO. It posted `description`,
 * `deliverables`, `price`, `currency`, `sla_days` and `listed`; `POST
 * /services/offerings` reads `title`, `category`, `summary`, `price_usd` and
 * `is_active`, and `PUT` reads the same five. So a partner filled in a price,
 * a currency, an SLA and a description, pressed save, and got a row carrying a
 * title and a category — every other keystroke dropped in the request body
 * with no error, because a field the handler does not name is simply not read.
 *
 * `deliverables`, `currency` and `sla_days` have no column at all, in the table
 * or in either handler. Their inputs are gone rather than left collecting text
 * that goes nowhere — an input is a promise as much as a button is. Adding
 * them back is a migration, and a migration is a decision.
 *
 * `description` is the same field as the store's `summary`; only the name
 * differed, so it is renamed rather than removed. `listed` is `is_active`.
 */
function OfferingFormModal({ offering, onClose, user = null, fillOn = false }) {
  const [form, setForm] = useState({
    title: offering?.title || '',
    summary: offering?.summary || '',
    category: offering?.category || 'legal',
    // The form's price field stays in dollars because that is what a person
    // types; the worker turns it into the integer the row stores. An existing
    // row is read back from `price_cents` rather than from the REAL, so editing
    // and saving cannot round a price a fraction away from itself.
    price_usd: offering?.price_cents != null ? String(offering.price_cents / 100) : '',
    engagement_model: offering?.engagement_model || '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // D1595 (#3868) / D1424 (#3700): Ask on the summary only, in the partner's
  // own shell. An Add form hangs under the caller (`owner:<id>`); an Edit
  // form reads its own record. Price, title and category are never filled.
  const ownerId = Number(user?.id) || null;
  const fill = useScopedFill({
    scope: SCOPED_FORMS.offering,
    record: offering?.id ?? null,
    parent: offering ? null : ownerId,
    enabled: fillOn && (offering ? Number.isSafeInteger(Number(offering.id)) : !!ownerId),
    values: { summary: form.summary },
    onValues: (v) => setForm((f) => ({ ...f, ...v })),
  });

  async function save() {
    setBusy(true); setError(null);
    try {
      // An empty price is null, not zero: an offering priced on enquiry does
      // not cost nothing, and the column is nullable for exactly that.
      const payload = {
        ...form,
        price_usd: form.price_usd === '' ? null : Number(form.price_usd),
        // Empty means unset, and unset is what the Model column draws as `Not
        // recorded`. Sending '' would be refused by the column's CHECK; sending
        // a default would be this form deciding how a firm charges.
        engagement_model: form.engagement_model || null,
      };
      const saved = offering ? await api.updateServiceOffering(offering.id, payload) : await api.createServiceOffering(payload);
      await fill.afterSave(saved?.id ?? offering?.id);
      onClose();
    } catch (e) { setError(e.message); setBusy(false); }
  }

  return (
    <Modal title={offering ? 'Edit service' : 'New service'} onClose={onClose} wide>
      <div className="space-y-3 text-sm">
        <Field label="Service name">
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full dark:border-gray-700" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full bg-white dark:border-gray-700 dark:bg-gray-900">
              {CATEGORIES.map((c) => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}
            </select>
          </Field>
          <Field label="Price (USD)">
            <input type="number" value={form.price_usd} onChange={(e) => setForm({ ...form, price_usd: e.target.value })} placeholder="Leave blank for “on enquiry”" className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full dark:border-gray-700" />
          </Field>
        </div>
        {/* MIGRATION 227's COLUMN, AND THE ARTBOARD'S `Model`. Blank is a real
            choice: a firm that has not decided how a service is charged should
            not have this form decide for it, and the catalog draws the absence
            rather than guessing "Fixed". */}
        <Field label="How is it sold?">
          <select value={form.engagement_model} onChange={(e) => setForm({ ...form, engagement_model: e.target.value })} className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full bg-white dark:border-gray-700 dark:bg-gray-900">
            <option value="">Not recorded</option>
            {MODELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <FillFormBar fill={fill} />
        <div>
          <FillLabel fill={fill} name="summary" label="What do you deliver?" value={form.summary}>
            <label htmlFor="offering-summary" className="mb-1 block text-[11px] uppercase tracking-wide text-gray-500">What do you deliver?</label>
          </FillLabel>
          <textarea id="offering-summary" rows={3} value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full dark:border-gray-700" />
        </div>
        {/* NO `Deliverables` FIELD. `service_offerings` has no column for it and
            neither handler reads one, so five rows of typing went into the
            request body and nowhere else. Listing it back is a migration.

            NO `Listed` CHECKBOX EITHER, and that one is not a gap. Listing is
            `is_active`, POST sets it to 1, and the manage list below already
            toggles it per row with a control that says which way it is going —
            a second copy in this modal was a duplicate that wrote a field name
            the handler ignores, so the toggle here silently did nothing. */}
        {error && <ErrorBox message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700">Cancel</button>
          <button disabled={busy} onClick={save} className="px-4 py-1.5 text-sm rounded-md bg-violet-600 hover:bg-violet-700 text-white">
            {busy ? 'Saving…' : (offering ? 'Save changes' : 'Publish offering')}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Stripe Connect onboarding tab
// ---------------------------------------------------------------------------
export function StripeTab() {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function load() {
    setError(null);
    try { setStatus(await api.getMyStripeStatus()); } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function onboard() {
    setBusy(true); setError(null);
    try {
      const r = await api.startStripeOnboarding();
      if (r.url) {
        if (r.simulated) {
          alert('Stripe is in simulated mode (no STRIPE_SECRET_KEY configured). Pretend onboarding completed — click "Refresh status" next.');
        } else {
          window.location.href = r.url;
          return;
        }
      }
      load();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function refresh() {
    setBusy(true); setError(null);
    try { setStatus(await api.refreshStripeStatus()); } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  if (!status) return <div className="text-sm text-gray-500">Loading…</div>;

  return (
    <div className="space-y-4 max-w-2xl">
      {error && <ErrorBox message={error} />}
      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3 dark:bg-gray-900 dark:border-gray-800">
        <div className="flex items-center gap-2">
          <ShieldCheck className={status.charges_enabled ? 'text-emerald-600' : 'text-gray-400'} size={20} />
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Stripe Connect</h2>
          <span className={`ml-auto text-xs px-2 py-0.5 rounded-full border ${status.live_mode ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
            {status.live_mode ? 'Live mode' : 'Simulated'}
          </span>
        </div>
        <p className="text-sm text-gray-600">
          Connect a Stripe account to bill founders directly when an engagement reaches the
          <strong> delivered</strong> stage. Without this, the invoice button surfaces a
          simulated invoice URL for testing.
        </p>
        <dl className="grid grid-cols-2 gap-y-2 text-sm">
          <dt className="text-gray-500">Connected account</dt>
          <dd className="font-mono text-xs text-gray-800 dark:text-gray-200">{status.stripe_account_id || '—'}</dd>
          <dt className="text-gray-500">Charges enabled</dt>
          <dd className="text-gray-800 dark:text-gray-200">{status.charges_enabled ? 'Yes' : 'No'}</dd>
          <dt className="text-gray-500">Payouts enabled</dt>
          <dd className="text-gray-800 dark:text-gray-200">{status.payouts_enabled ? 'Yes' : 'No'}</dd>
          <dt className="text-gray-500">Onboarded at</dt>
          <dd className="text-gray-800 dark:text-gray-200">{status.onboarded_at ? new Date(status.onboarded_at).toLocaleString() : '—'}</dd>
        </dl>
        <div className="flex items-center gap-2 pt-2">
          <button disabled={busy} onClick={onboard} className="bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 text-white rounded-md px-4 py-1.5 text-sm font-medium flex items-center gap-2">
            <ExternalLink size={14} /> {status.connected ? 'Re-open Stripe onboarding' : 'Connect Stripe'}
          </button>
          <button disabled={busy} onClick={refresh} className="border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-md px-4 py-1.5 text-sm dark:border-gray-700 dark:text-gray-300">Refresh status</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared bits (small clones of NeedsBoardPage helpers — kept local for clarity)
// ---------------------------------------------------------------------------
function Modal({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`bg-white rounded-2xl shadow-xl ${wide ? 'max-w-2xl' : 'max-w-md'} w-full max-h-[90vh] overflow-y-auto`} onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white dark:border-gray-800 dark:bg-gray-900">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
function Field({ label, children }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">{label}</div>
      {children}
    </div>
  );
}
function ErrorBox({ message }) {
  return <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg px-3 py-2 text-sm"><AlertCircle size={14} className="mt-0.5" />{message}</div>;
}
function Empty({ icon: Icon, text }) {
  return (
    <div className="bg-white border border-dashed border-gray-300 rounded-xl p-10 text-center text-gray-500 text-sm dark:bg-gray-900 dark:border-gray-700">
      <Icon size={28} className="mx-auto text-gray-300 mb-2" /> {text}
    </div>
  );
}
