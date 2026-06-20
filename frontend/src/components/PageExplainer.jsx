/**
 * Page header explainer — renders a compact InfoStrip directly under a
 * page's <h1> driven by the EXPLAINERS registry in lib/explainers.js.
 *
 * Features:
 *   - Title + body explaining the feature + "Learn more →" docs deep-link.
 *   - X close button that dismisses for this user across reloads + devices
 *     (POSTs to /api/settings/explainer-dismissed; localStorage is a cache).
 *   - Mobile: collapses to title + tap-to-expand to save vertical space.
 *
 * Pages whose pageKey isn't in EXPLAINERS render nothing (no crash).
 */
import React, { useEffect, useState } from 'react';
import { HelpCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { EXPLAINERS, readDismissed, writeDismissed } from '../lib/explainers';
import { api } from '../lib/api';
import InfoStrip from './InfoStrip';

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

  const learnMoreLink = (
    <a
      href={`/docs#${entry.docPath}`}
      onClick={openDocs}
      className="ml-1 text-blue-600 dark:text-blue-400 hover:underline font-medium"
    >
      Learn more →
    </a>
  );

  return (
    <div data-explainer={pageKey} className="mt-3 mb-4">
      {/* Mobile: title only with tap-to-expand */}
      <div className="sm:hidden">
        <InfoStrip variant="info" onDismiss={close} inline>
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            aria-expanded={expanded}
            aria-label={expanded ? 'Collapse explanation' : 'Expand explanation'}
            className="font-semibold text-gray-900 dark:text-gray-100 mr-1 focus:outline-none focus:underline"
          >
            {entry.title}
          </button>
          <HelpCircle
            size={13}
            className="inline text-gray-400 dark:text-gray-500 cursor-pointer"
            aria-hidden="true"
            onClick={() => setExpanded(v => !v)}
          />
          {expanded && (
            <p className="mt-1 text-gray-700 dark:text-gray-300">
              {entry.body}{learnMoreLink}
            </p>
          )}
        </InfoStrip>
      </div>

      {/* Desktop: full strip */}
      <div className="hidden sm:block">
        <InfoStrip title={entry.title} variant="info" onDismiss={close} inline>
          {entry.body}{learnMoreLink}
        </InfoStrip>
      </div>
    </div>
  );
}
