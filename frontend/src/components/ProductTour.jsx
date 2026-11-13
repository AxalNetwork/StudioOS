import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronRight, ChevronLeft } from 'lucide-react';
import { api } from '../lib/api';
import { inertOutside, tabbable, tabTarget } from '../ui/lightboxFocus.js';
import { usePhoneWidth } from '../ui/phone/usePhoneWidth.js';
import { useEscapeClose } from './useEscapeClose.js';
import { STUDIO_ROLES, placeTip, resolveSteps, stepFrom, tourKey } from './productTourModel.js';

/**
 * Task #6 (IF) — First-login product tour.
 *
 * A skippable coachmark over `data-tour="…"` anchors. Fires on mount if
 * `/api/onboarding/checklist` reports `meta.tour_seen_at` is null, and
 * persists completion server-side so it never re-fires. Re-runnable from the
 * Onboarding section of the account settings.
 *
 * D4623 (#4623): the steps and their rules are `productTourModel.js`, per
 * licence (`role`) and viewport. A step whose anchor is not drawn is skipped,
 * or, if it is page-level, explains its concept from the middle of the
 * screen. The list is read again on every move, so a lazy home that mounts
 * late still gets its steps. The coachmark keeps the modal contract of
 * `ui/Lightbox.jsx` through the same helpers (`ui/lightboxFocus.js`): focus
 * moves in on open and on each step, Tab stays inside, the rest of the page is
 * inert, Escape closes it through the shared stack (`useEscapeClose`), and
 * focus goes back to what held it. The arrow keys move between steps. It is
 * placed again on every scroll and resize, and stays inside a phone's width.
 *
 * D323 dropped the "search" and "notifications" steps; D4623 dropped the
 * onboarding-checklist step with the panel it pointed at.
 */
const OPEN_DELAY_MS = 600;
// The role homes load lazily (#4622): a Studio licence waits a little for its modules to draw before opening.
const OPEN_POLL_MS = 250;
const OPEN_TRIES = 12;

const viewport = () => ({ width: window.innerWidth || 0, height: window.innerHeight || 0 });
const findAnchor = (anchor) => (typeof document.querySelector === 'function' ? document.querySelector(`[data-tour="${anchor}"]`) : null);
const rectOf = (el) => { const r = el.getBoundingClientRect(); return { top: r.top, left: r.left, width: r.width, height: r.height }; };

export default function ProductTour({ enabled, onDone, role = 'founder' }) {
  const phone = usePhoneWidth();
  const [stepId, setStepId] = useState(null);
  const [view, setView] = useState(null);
  const root = useRef(null);
  const box = useRef(null);
  const primary = useRef(null);
  const opener = useRef(null);
  const ids = useId();
  const open = stepId != null;

  const read = useCallback(() => resolveSteps(role, { phone, find: findAnchor, viewportWidth: viewport().width }), [role, phone]);

  useEffect(() => {
    if (!enabled) return undefined;
    let tries = 0;
    let timer;
    const tick = () => {
      const list = read();
      const studioPending = STUDIO_ROLES.includes(role) && !list.some((s) => s.id === 'studio');
      if (studioPending && tries < OPEN_TRIES) { tries += 1; timer = setTimeout(tick, OPEN_POLL_MS); return; }
      if (!list.length) return;
      opener.current = typeof document !== 'undefined' ? document.activeElement : null;
      setStepId(list[0].id);
    };
    timer = setTimeout(tick, OPEN_DELAY_MS);
    return () => clearTimeout(timer);
  }, [enabled, read, role]);

  // Lay the current step out: its anchor's box and the card beside it.
  const layout = useCallback((scroll) => {
    if (stepId == null) return;
    const list = read();
    const at = list.findIndex((s) => s.id === stepId);
    if (at < 0) {
      const next = stepFrom(list, stepId, 1) || stepFrom(list, stepId, -1);
      if (next) setStepId(next.id); else setView(null);
      return;
    }
    const step = list[at];
    if (scroll && step.el) { try { step.el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch { /* an old browser */ } }
    const rect = step.el ? rectOf(step.el) : null;
    const height = box.current?.offsetHeight || 200;
    setView({ step, index: at, count: list.length, rect, tip: placeTip(rect, viewport(), height) });
  }, [read, stepId]);

  useLayoutEffect(() => { layout(true); }, [layout]);

  useEffect(() => {
    if (!open) return undefined;
    const again = () => layout(false);
    window.addEventListener('resize', again);
    window.addEventListener('scroll', again, true);
    return () => { window.removeEventListener('resize', again); window.removeEventListener('scroll', again, true); };
  }, [open, layout]);

  // Everything else is inert while the tour is open. Focus goes back to what
  // held it once the page is live again (an inert control cannot take focus).
  const drawn = view != null;
  useEffect(() => {
    if (!drawn || !root.current || typeof document === 'undefined') return undefined;
    const restore = inertOutside(root.current, document.body);
    return () => {
      restore();
      const back = opener.current;
      opener.current = null;
      if (back && back.isConnected !== false) back.focus?.();
    };
  }, [drawn]);

  // Focus moves to the step's main action on open and on every step.
  const shownId = view?.step?.id;
  useEffect(() => { if (shownId) primary.current?.focus?.(); }, [shownId]);

  const finish = useCallback(async (skipped = false) => {
    setStepId(null);
    setView(null);
    try { await api.patchOnboardingMeta({ tour_seen: true }); } catch { /* the tour may fire again; nothing is lost */ }
    if (onDone) onDone(skipped);
  }, [onDone]);

  const move = useCallback((dir) => {
    const next = stepFrom(read(), stepId, dir);
    if (next) setStepId(next.id);
    else if (dir > 0) finish(false);
  }, [read, stepId, finish]);

  useEscapeClose(() => finish(true), { active: open });

  const onKeyDown = (e) => {
    if (e.key === 'Tab') {
      const list = tabbable(box.current, document.activeElement);
      const to = tabTarget(list, document.activeElement, e.shiftKey);
      if (to == null) return;
      e.preventDefault();
      (to === -1 ? box.current : list[to])?.focus?.();
      return;
    }
    const action = tourKey(e.key);
    if (!action) return;
    e.preventDefault();
    move(action === 'next' ? 1 : -1);
  };

  if (!enabled || !open || !view || typeof document === 'undefined') return null;

  const { step, index, count, rect, tip } = view;
  const last = index === count - 1;
  const titleId = `${ids}-title`;
  const bodyId = `${ids}-body`;

  return createPortal(
    <div ref={root} data-testid="product-tour">
      <div className="fixed inset-0 bg-black/30 z-[240]" onClick={() => finish(true)} role="presentation" />
      {rect && (
        <div
          aria-hidden="true"
          data-testid="product-tour-ring"
          style={{
            position: 'fixed',
            top: rect.top - 6,
            left: rect.left - 6,
            width: rect.width + 12,
            height: rect.height + 12,
            border: '3px solid #8b5cf6',
            borderRadius: 12,
            boxShadow: '0 0 0 4px rgba(139, 92, 246, 0.25)',
            pointerEvents: 'none',
            zIndex: 245,
            transition: 'all 200ms ease',
          }}
        />
      )}
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        data-testid="product-tour-dialog"
        data-step={step.id}
        data-placement={tip.placement}
        style={{ position: 'fixed', top: tip.top, left: tip.left, width: tip.width, maxHeight: tip.maxHeight, overflowY: 'auto', zIndex: 250 }}
        className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 p-4"
      >
        <div className="flex items-start justify-between gap-2 mb-2">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-violet-600 dark:text-violet-300 font-semibold" data-testid="product-tour-count">
              Step {index + 1} of {count}
            </div>
            <h3 id={titleId} className="mt-0.5 text-sm font-semibold text-gray-900 dark:text-gray-100">{step.title}</h3>
          </div>
          <button
            type="button"
            onClick={() => finish(true)}
            aria-label="Close the tour"
            className="text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-200"
          >
            <X size={14} />
          </button>
        </div>
        <p id={bodyId} className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">{step.body}</p>
        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            onClick={() => finish(true)}
            className="text-[11px] text-gray-500 dark:text-gray-400 hover:underline"
          >Skip tour</button>
          <div className="flex items-center gap-2">
            {index > 0 && (
              <button
                type="button"
                onClick={() => move(-1)}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
              ><ChevronLeft size={12} /> Back</button>
            )}
            <button
              ref={primary}
              type="button"
              onClick={() => (last ? finish(false) : move(1))}
              className="flex items-center gap-1 text-xs px-3 py-1 rounded bg-violet-600 hover:bg-violet-700 text-white"
            >
              {last ? 'Done' : 'Next'} {!last && <ChevronRight size={12} />}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
