import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Inbox, ArrowUpRight } from 'lucide-react';
import { api } from '../lib/api';

// Task #5 — reusable "incoming leads" strip for a destination surface. Every
// captured landing-page lead is routed by audience (see routeFor in the worker's
// contacts route) to a real destination; this strip makes the leads for one
// destination visible where the founder acts on them.
//
// Filters by AUDIENCE (not routed_to) on purpose: audience is 1:1 with the
// destinations that use this strip (cofounder → Team, partner → Marketplace),
// and it stays correct for legacy rows whose routed_to predates the full routing
// map. Already-promoted contacts are hidden. Co-founder / partner leads have no
// downstream promote action, so the strip is visibility + a "Manage in Contacts"
// link rather than an inline promote.
//
// The dev Python backend has no /contacts endpoint, so contactsList 404s there;
// like the Advisory strip we swallow the error and render nothing, so the strip
// only appears (in prod) when leads actually exist.
export default function IncomingLeadsStrip({
  audience,
  title,
  blurb,
  manageTo = '/network?tab=contacts',
  max = 5,
}) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.contactsList({ audience }).catch(() => ({ items: [] }));
        if (cancelled) return;
        setItems((res.items || []).filter((c) => !c.promoted_ref_id));
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [audience]);

  // Keep the destination page clean: no leads (or still loading, or dev 404) →
  // render nothing at all.
  if (loading || items.length === 0) return null;

  return (
    <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-4 dark:border-violet-900/50 dark:bg-violet-900/10">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-2">
          <Inbox size={16} className="text-violet-600 dark:text-violet-300" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
          <span className="text-xs font-medium text-violet-700 bg-violet-100 rounded-full px-2 py-0.5 dark:bg-violet-900/40 dark:text-violet-300">
            {items.length}
          </span>
        </div>
        <Link
          to={manageTo}
          className="inline-flex items-center gap-1 text-xs font-medium text-violet-700 hover:text-violet-800 dark:text-violet-300 dark:hover:text-violet-200"
        >
          Manage in Contacts <ArrowUpRight size={13} />
        </Link>
      </div>
      {blurb && <p className="text-xs text-gray-600 dark:text-gray-400 mb-3">{blurb}</p>}
      <ul className="space-y-2">
        {items.slice(0, max).map((c) => (
          <li
            key={c.uid || c.id}
            className="flex items-start justify-between gap-3 rounded-lg bg-white border border-gray-200 px-3 py-2 dark:bg-gray-900 dark:border-gray-800"
          >
            <div className="min-w-0">
              <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{c.name || c.email}</div>
              {c.name && <div className="text-xs text-gray-500 truncate dark:text-gray-400">{c.email}</div>}
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
    </div>
  );
}
