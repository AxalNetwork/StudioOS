/**
 * Task #15 — Page header explainer.
 *
 * Renders a small banner directly under a page's <h1> with:
 *   - title + body explaining what the feature does and why it matters
 *   - "Learn more →" deep-linking to /docs#<docPath>
 *   - X close button that dismisses for this user across reloads + devices
 *     (POSTs to /api/settings/explainer-dismissed; localStorage is a cache).
 *
 * Below sm: collapses to a single-line title + "?" expand button.
 *
 * Pages whose pageKey isn't in EXPLAINERS render nothing (no crash).
 */
import React, { useEffect, useState } from 'react';
import { Info, X, HelpCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { EXPLAINERS, readDismissed, writeDismissed } from '../lib/explainers';
import { api } from '../lib/api';

export default function PageExplainer({ pageKey }) {
  const entry = pageKey ? EXPLAINERS[pageKey] : null;
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(() => readDismissed().includes(pageKey));
  const [expanded, setExpanded] = useState(false);

  // Re-check on mount in case server hydration ran AFTER initial render.
  useEffect(() => {
    if (!pageKey) return;
    const onSync = () => setDismissed(readDismissed().includes(pageKey));
    window.addEventListener('storage', onSync);
    window.addEventListener('axal:explainers_synced', onSync);
    onSync();
    return () => {
      window.removeEventListener('storage', onSync);
      window.removeEventListener('axal:explainers_synced', onSync);
    };
  }, [pageKey]);

  if (!entry || dismissed) return null;

  const close = async () => {
    setDismissed(true);
    const next = Array.from(new Set([...readDismissed(), pageKey]));
    writeDismissed(next);
    try { await api.dismissExplainer(pageKey); }
    catch { /* best-effort — local cache + server sync on next load */ }
  };

  const openDocs = (e) => {
    e.preventDefault();
    navigate(`/docs#${entry.docPath}`);
  };

  return (
    <div data-explainer={pageKey}
      className="mt-3 mb-4 rounded-lg border border-violet-200 dark:border-violet-800 bg-violet-50/60 dark:bg-violet-900/20 text-violet-900 dark:text-violet-100">
      {/* Mobile collapsed view */}
      <div className="flex items-center gap-2 px-3 py-2 sm:hidden">
        <Info size={16} className="flex-shrink-0 text-violet-600 dark:text-violet-300" />
        <span className="text-sm font-medium flex-1 truncate">{entry.title}</span>
        <button onClick={() => setExpanded(v => !v)} aria-label="Show explanation"
          className="p-1 rounded hover:bg-violet-100 dark:hover:bg-violet-800/40">
          <HelpCircle size={16} />
        </button>
        <button onClick={close} aria-label="Dismiss" className="p-1 rounded hover:bg-violet-100 dark:hover:bg-violet-800/40">
          <X size={16} />
        </button>
      </div>
      {expanded && (
        <div className="px-3 pb-3 -mt-1 text-sm sm:hidden">
          <p className="mb-2">{entry.body}</p>
          <a href={`/docs#${entry.docPath}`} onClick={openDocs}
            className="text-violet-700 dark:text-violet-200 font-medium hover:underline">
            Learn more →
          </a>
        </div>
      )}

      {/* Desktop full view */}
      <div className="hidden sm:flex items-start gap-3 px-4 py-3">
        <Info size={18} className="flex-shrink-0 mt-0.5 text-violet-600 dark:text-violet-300" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold leading-snug">{entry.title}</div>
          <p className="text-sm mt-0.5 text-violet-800 dark:text-violet-200/90 leading-snug">
            {entry.body}
          </p>
          <a href={`/docs#${entry.docPath}`} onClick={openDocs}
            className="inline-block mt-1.5 text-xs font-medium text-violet-700 dark:text-violet-200 hover:underline">
            Learn more →
          </a>
        </div>
        <button onClick={close} aria-label="Dismiss"
          className="flex-shrink-0 p-1 rounded hover:bg-violet-100 dark:hover:bg-violet-800/40 text-violet-700 dark:text-violet-300">
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
