/**
 * Task #3 (AS) — page-level banner that surfaces which fields on
 * the current page were auto-filled by the Personal Advisor, with
 * a "Review" CTA that opens the advisor pinned to this page.
 *
 * Hidden when the user has not used the advisor on this page (no
 * matching `field_sources` rows). Dismissible per page via
 * localStorage so the banner doesn't reappear on every navigation
 * once the founder has acknowledged the auto-fills.
 */
import React, { useEffect, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { api } from '../../lib/api';
import { safeReadJSON, safeWriteJSON } from '../../lib/storage';

const DISMISS_KEY = 'advisor:filled_banner_dismissed';

export default function AdvisorFilledBanner({ page, onOpenAdvisor }) {
  const [sources, setSources] = useState([]);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!page) return;
    const all = safeReadJSON(DISMISS_KEY, {}) || {};
    setDismissed(!!all[page]);
  }, [page]);

  useEffect(() => {
    let cancelled = false;
    if (!page) return undefined;
    const load = async () => {
      try {
        const r = await api.advisor.sources(page);
        if (!cancelled) setSources(Array.isArray(r?.sources) ? r.sources : []);
      } catch { /* advisor unavailable — silently hide */ }
    };
    load();
    // Task #1 (CD) — re-fetch on the same-tab `advisor:page-fill`
    // event dispatched by PersonalAdvisor when /answer succeeds, and
    // also un-dismiss the banner so the founder sees the new entry.
    const onFill = (e) => {
      const target = e?.detail?.page || null;
      if (target && target !== page) return;
      setDismissed(false);
      load();
    };
    window.addEventListener('advisor:page-fill', onFill);
    return () => {
      cancelled = true;
      window.removeEventListener('advisor:page-fill', onFill);
    };
  }, [page]);

  if (!page || dismissed || sources.length === 0) return null;

  const dismiss = () => {
    const all = safeReadJSON(DISMISS_KEY, {}) || {};
    all[page] = new Date().toISOString();
    safeWriteJSON(DISMISS_KEY, all);
    setDismissed(true);
  };

  const labels = sources
    .map((s) => s.label || s.question_id)
    .filter(Boolean)
    .slice(0, 4);
  const more = Math.max(0, sources.length - labels.length);

  return (
    <div
      data-card
      className="mb-4 flex items-start gap-3 rounded-lg border border-violet-200 bg-violet-50 px-4 py-3 text-sm dark:border-violet-700/40 dark:bg-violet-900/20"
    >
      <Sparkles className="mt-0.5 h-4 w-4 flex-shrink-0 text-violet-600 dark:text-violet-300" />
      <div className="flex-1 text-violet-900 dark:text-violet-100">
        <div className="font-medium">
          {sources.length === 1
            ? '1 field on this page was filled by your Personal Advisor'
            : `${sources.length} fields on this page were filled by your Personal Advisor`}
        </div>
        {labels.length > 0 && (
          <div className="mt-1 text-xs text-violet-800/80 dark:text-violet-200/80">
            {labels.join(' · ')}{more > 0 ? ` · +${more} more` : ''}
          </div>
        )}
        <div className="mt-2 flex gap-3 text-xs">
          {typeof onOpenAdvisor === 'function' && (
            <button
              type="button"
              onClick={() => onOpenAdvisor(page)}
              className="rounded bg-violet-600 px-2.5 py-1 font-medium text-white hover:bg-violet-700"
            >
              Review with advisor
            </button>
          )}
          <button
            type="button"
            onClick={dismiss}
            className="text-violet-700 hover:text-violet-900 dark:text-violet-200 dark:hover:text-white"
          >
            Got it
          </button>
        </div>
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={dismiss}
        className="text-violet-700/70 hover:text-violet-900 dark:text-violet-200/70 dark:hover:text-white"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

/**
 * Lightweight inline indicator (✨) for a single field that was
 * auto-filled by the advisor. Renders nothing when `filled` is
 * false so callers can scatter it next to inputs without
 * conditional wrapping in markup.
 */
export function FieldSourceSparkle({ filled, title = 'Filled by your Personal Advisor', className = '' }) {
  if (!filled) return null;
  return (
    <span
      title={title}
      className={`inline-flex h-3.5 w-3.5 items-center justify-center text-violet-600 dark:text-violet-300 ${className}`}
    >
      <Sparkles className="h-3.5 w-3.5" />
    </span>
  );
}
