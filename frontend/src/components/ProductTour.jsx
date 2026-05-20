import React, { useEffect, useState, useCallback } from 'react';
import { X, ChevronRight, ChevronLeft } from 'lucide-react';
import { api } from '../lib/api';

/**
 * Task #6 (IF) — First-login 5-step product tour.
 *
 * Renders a small skippable overlay coachmark anchored to specific
 * `data-tour="…"` selectors. Fires on mount if `/api/onboarding/checklist`
 * reports `meta.tour_seen_at` is null. Persists completion server-side
 * so it never re-fires. Re-runnable from Settings → Onboarding.
 *
 * Anchors used in the SPA:
 *   - data-tour="onboarding-checklist" — the dashboard panel
 *   - data-tour="sidebar-nav"          — primary sidebar
 *   - data-tour="search"               — semantic search input
 *   - data-tour="notifications"        — bell in header (best-effort)
 *   - data-tour="settings"             — settings link
 *
 * The anchor lookup falls back to a centred box when an anchor is missing
 * so missing markup never blocks the tour.
 */
const STEPS = [
  {
    anchor: 'onboarding-checklist',
    title: 'Your onboarding checklist',
    body: 'This panel guides you through the actions that unlock the most value for your role. Items mark themselves complete as you go.',
  },
  {
    anchor: 'sidebar-nav',
    title: 'Navigate StudioOS',
    body: 'Everything you need lives in the sidebar — projects, capital, integrations, compliance. Use the search at the top to jump anywhere.',
  },
  {
    anchor: 'search',
    title: 'Search anything',
    body: "Type to find founders, deals, documents, mentors, or partners. Cmd+K from anywhere works too.",
  },
  {
    anchor: 'notifications',
    title: 'Stay in the loop',
    body: 'Activity, scoring updates, and intros flow through the notification bell. You can tune which channels they hit in Settings → Notifications.',
  },
  {
    anchor: 'settings',
    title: "You're ready",
    body: 'Settings lets you re-run this tour, reset your checklist, connect integrations, and configure notifications. Have fun.',
  },
];

export default function ProductTour({ enabled, onDone }) {
  const [step, setStep] = useState(0);
  const [anchorRect, setAnchorRect] = useState(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const t = setTimeout(() => setVisible(true), 600);
    return () => clearTimeout(t);
  }, [enabled]);

  useEffect(() => {
    if (!visible) return;
    const cur = STEPS[step];
    const el = document.querySelector(`[data-tour="${cur.anchor}"]`);
    if (el) {
      const r = el.getBoundingClientRect();
      setAnchorRect({ top: r.top, left: r.left, width: r.width, height: r.height });
      try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch {}
    } else {
      setAnchorRect(null);
    }
  }, [step, visible]);

  const finish = useCallback(async (skipped = false) => {
    setVisible(false);
    try { await api.patchOnboardingMeta({ tour_seen: true }); } catch {}
    if (onDone) onDone(skipped);
  }, [onDone]);

  if (!enabled || !visible) return null;

  const cur = STEPS[step];
  const last = step === STEPS.length - 1;

  // Tooltip position — adjacent to anchor on the right by default; falls
  // back to centred when no anchor.
  const tipStyle = anchorRect
    ? {
        position: 'fixed',
        top: Math.min(window.innerHeight - 220, Math.max(20, anchorRect.top + anchorRect.height / 2 - 100)),
        left: Math.min(window.innerWidth - 340, Math.max(20, anchorRect.left + anchorRect.width + 16)),
        width: 320,
        zIndex: 250,
      }
    : {
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: 320,
        zIndex: 250,
      };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/30 z-[240]"
        onClick={() => finish(true)}
        role="presentation"
      />
      {/* Highlight ring around anchor */}
      {anchorRect && (
        <div
          aria-hidden="true"
          style={{
            position: 'fixed',
            top: anchorRect.top - 6,
            left: anchorRect.left - 6,
            width: anchorRect.width + 12,
            height: anchorRect.height + 12,
            border: '3px solid #8b5cf6',
            borderRadius: 12,
            boxShadow: '0 0 0 4px rgba(139, 92, 246, 0.25)',
            pointerEvents: 'none',
            zIndex: 245,
            transition: 'all 200ms ease',
          }}
        />
      )}
      {/* Tooltip */}
      <div
        role="dialog"
        aria-label={cur.title}
        style={tipStyle}
        className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 p-4"
      >
        <div className="flex items-start justify-between gap-2 mb-2">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-violet-600 dark:text-violet-300 font-semibold">
              Step {step + 1} of {STEPS.length}
            </div>
            <h3 className="mt-0.5 text-sm font-semibold text-gray-900 dark:text-gray-100">{cur.title}</h3>
          </div>
          <button
            type="button"
            onClick={() => finish(true)}
            aria-label="Skip tour"
            className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          >
            <X size={14} />
          </button>
        </div>
        <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">{cur.body}</p>
        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            onClick={() => finish(true)}
            className="text-[11px] text-gray-500 hover:underline"
          >Skip tour</button>
          <div className="flex items-center gap-2">
            {step > 0 && (
              <button
                type="button"
                onClick={() => setStep((s) => s - 1)}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
              ><ChevronLeft size={12} /> Back</button>
            )}
            <button
              type="button"
              onClick={() => (last ? finish(false) : setStep((s) => s + 1))}
              className="flex items-center gap-1 text-xs px-3 py-1 rounded bg-violet-600 hover:bg-violet-700 text-white"
            >
              {last ? 'Done' : 'Next'} {!last && <ChevronRight size={12} />}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
