import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Inbox, ArrowUpRight, Loader2, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api';
import { TEMPLATES } from '../lib/brand/templates';

// Task #5 — reusable "incoming leads" strip for a destination surface. Every
// captured landing-page lead is routed by audience (see routeFor in the worker's
// contacts route) to a real destination; this strip makes the leads for one
// destination visible where the founder acts on them.
//
// Filters by AUDIENCE (not routed_to) on purpose: audience is 1:1 with the
// destinations that use this strip (cofounder → Co-founder Match, partner →
// Marketplace, ...), and it stays correct for legacy rows whose routed_to
// predates the full routing map. Already-promoted contacts are hidden.
//
// Brand & Pages integration: each contact row now arrives with
// landing_template_kit / landing_page_name (LEFT JOIN in the worker's
// GET /contacts), so every lead shows WHICH landing-page template it signed up
// through. Rows without a landing_page_id (manual adds, invites) show
// "Added directly" instead.
//
// Two rendering modes:
//   - sectionLabel set (the "INBOUND LEADS · BRAND & PAGES" panels): the panel
//     is a permanent section of its destination page, with real loading /
//     empty / error states.
//   - sectionLabel unset (legacy): render nothing while loading or when there
//     are no leads, so pages that treat the strip as an opportunistic banner
//     stay clean.

const timeAgo = (iso) => {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

const templateLabel = (kit) => TEMPLATES.find((t) => t.id === kit)?.label || null;

export function leadSourceLabel(c) {
  return templateLabel(c.landing_template_kit)
    || c.landing_page_name
    || (c.landing_page_id ? 'Landing page' : 'Added directly');
}

export default function IncomingLeadsStrip({
  audience,
  title,
  blurb,
  manageTo = '/network?tab=contacts',
  max = 5,
  sectionLabel = null,
}) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.contactsList({ audience });
        if (cancelled) return;
        setItems((res.items || []).filter((c) => !c.promoted_ref_id));
        setError('');
      } catch (e) {
        if (cancelled) return;
        setItems([]);
        // A missing /contacts endpoint (older dev backend) is an expected
        // absence, not an error worth surfacing on the destination page.
        const msg = e?.message || '';
        setError(/404|not found/i.test(msg) ? '' : (msg || 'Could not load leads'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [audience]);

  // Legacy banner mode — no leads (or still loading, or dev 404) → nothing.
  if (!sectionLabel && (loading || items.length === 0)) return null;

  return (
    <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-4 dark:border-violet-900/50 dark:bg-violet-900/10" data-testid={`inbound-leads-${audience}`}>
      {sectionLabel && (
        <div className="text-[10.5px] font-bold uppercase tracking-wider text-violet-500 dark:text-violet-400 mb-1.5">
          {sectionLabel}
        </div>
      )}
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-2">
          <Inbox size={16} className="text-violet-600 dark:text-violet-300" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
          {!loading && items.length > 0 && (
            <span className="text-xs font-medium text-violet-700 bg-violet-100 rounded-full px-2 py-0.5 dark:bg-violet-900/40 dark:text-violet-300">
              {items.length}
            </span>
          )}
        </div>
        <Link
          to={manageTo}
          className="inline-flex items-center gap-1 text-xs font-medium text-violet-700 hover:text-violet-800 dark:text-violet-300 dark:hover:text-violet-200"
        >
          Manage in Contacts <ArrowUpRight size={13} />
        </Link>
      </div>
      {blurb && <p className="text-xs text-gray-600 dark:text-gray-400 mb-3">{blurb}</p>}

      {loading ? (
        <div className="flex items-center gap-2 py-3 text-xs text-gray-500 dark:text-gray-400">
          <Loader2 size={13} className="animate-spin" /> Loading leads…
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 py-3 text-xs text-red-600 dark:text-red-400">
          <AlertTriangle size={13} /> {error}
        </div>
      ) : items.length === 0 ? (
        <div className="py-3 text-xs text-gray-500 dark:text-gray-400 italic">
          No leads yet — signups from your published landing pages for this audience will appear here.
        </div>
      ) : (
        <>
          <ul className="space-y-2">
            {items.slice(0, max).map((c) => (
              <li
                key={c.uid || c.id}
                className="flex items-start justify-between gap-3 rounded-lg bg-white border border-gray-200 px-3 py-2 dark:bg-gray-900 dark:border-gray-800"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{c.name || c.email}</div>
                  {c.name && <div className="text-xs text-gray-500 truncate dark:text-gray-400">{c.email}</div>}
                  <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                    <span className="font-medium text-violet-700 dark:text-violet-300">{leadSourceLabel(c)}</span>
                    {c.created_at ? ` · ${timeAgo(c.created_at)}` : ''}
                  </div>
                  {c.message && <div className="text-xs text-gray-600 mt-0.5 line-clamp-2 dark:text-gray-400">{c.message}</div>}
                </div>
                <Link
                  to={manageTo}
                  className="shrink-0 text-xs font-medium px-2.5 py-1 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-200 dark:hover:bg-gray-800"
                >
                  Review
                </Link>
              </li>
            ))}
          </ul>
          {items.length > max && (
            <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              +{items.length - max} more in Contacts
            </div>
          )}
        </>
      )}
    </div>
  );
}
