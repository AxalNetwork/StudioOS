import { Fragment, useCallback, useContext, useEffect, useId, useReducer, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PanelRightClose, PanelRightOpen, X } from 'lucide-react';
import { UNSAFE_LocationContext } from 'react-router-dom';
import useAiBudget from '../hooks/useAiBudget';
import { ADD_TOKENS_PATH, TOPUP_UNAVAILABLE, aiTokenState, microMoney, usageMoney } from '../lib/aiTokens';
import useAiSpend from '../hooks/useAiSpend';
import useAssistMode from '../hooks/useAssistMode';
import { safeReadJSON, safeWriteJSON } from '../lib/storage';
import { formatSpend, spendMeter } from './assistCost';
import { useEscapeClose } from '../components/useEscapeClose';
import { ASSIST_SURFACES } from './eadwynConfig';
import { DEFAULT_JOBS, jobsFor, railSuggestions } from './railModels';
import { readRailModel, syncRailPrefs, writeRailModel } from './railModelChoice';
import { useRailCrumbs } from './railCrumbs.js';
import { openEadwynPanel, useEadwynPanel, useEadwynRailServes, eadwynPanelEvent } from './eadwynPanel.js';
import { EadwynPanel } from './EadwynPanel.jsx';
import { Unreadable } from './Honesty';
import { ACCENT } from '../workspaces/shellConfig';
import { PHONE_QUERY } from '../workspaces/lens.jsx';
import { useViewMode } from '../contexts/ViewModeContext';
import { budgetReadable } from '../pages/account/usageModel';
import './workerRail.css';
import { clearRailPage, setRailPage } from '../lib/railPage.js';

/**
 * The Eadwyn AI rail. One component, every licence.
 *
 * ONE RAIL, NOT THIRTY-NINE. Every founder page had built its own: a local
 * `WorkerRail` / `BuildRail` / `RaiseRail` / `ValidateRail` / `CadenceRail`
 * function at the bottom of the file — twenty-six of them under seventeen
 * distinct names, plus one written inline on the Research desk — each with its
 * own props and its own CSS class names. Then the investor shell turned out to
 * hold twelve more, under four different headings, none of which read the
 * spend endpoint at all. They agreed on the shape by coincidence and drifted
 * in the details, and the pages that never grew one simply had no rail.
 *
 * WHAT IT DRAWS IS THE AIRAIL CANVAS, `design/canvases/integrated/AIRail.dc.html`
 * (D698, #1660), block by block, on real data:
 *
 *   1. HEADER — the Eadwyn mark and "Eadwyn AI".
 *   2. WHO AND WHERE — a pill naming the viewer's licence, in the app's own
 *      colours (`ACCENT`), and the crumbs "section › module › record" from
 *      `RailCrumbsProvider` (`ui/railCrumbs.js`), or the `workspace` alone.
 *   3. MODE — the "Eadwyn | Manual" switch, which is the assist mode
 *      (`useAssistMode(workspace)`), only where the host passes `fills` (D17).
 *      Manual is the default, because a run spends the founder's own budget.
 *   4. SUGGESTED FOR THIS PAGE — the canvas's models for the page's kind of
 *      work that the router carries and the page's jobs run
 *      (`railSuggestions`), a radio only where the pick reaches a run, then
 *      "All models", the router's catalogue in the canvas's groups.
 *   5. SAFETY — "Eadwyn drafts; you send." The canvas's first sentence, that
 *      the guard checks every run, is not true and is not drawn (D698.md).
 *   6. USAGE — today, this month, what runs in progress hold, the top-up
 *      balance and Add tokens, from `/api/ai-budget/me` and `/top-up`.
 *
 * No model id, rate, estimate, average or receipt (D698 decision 10): those
 * are `/account/usage`'s. The accent is the `role` prop's, because some hosts
 * are violet for every viewer on purpose; the pill is the viewer's.
 *
 * COLLAPSIBLE (D406). Every host's rail track is `var(--fwr-track, <width>)`,
 * each keeping its own width as the fallback, and `workerRail.css` defines
 * `--fwr-track: 44px` once on `:root[data-worker-rail="collapsed"]`, so one
 * stored preference moves every host at once. Desktop only, in CSS: below
 * 1024px the rail is the phone form below.
 *
 * STYLING. `className` takes the host page's own rail class — `a5-rail`,
 * `fr-pitch-rail`, `a7-rail` — so the page's grid column, border and background
 * still place it. Everything inside is `workerRail.css`.
 */
/**
 * Where the choice lives. `sidebar_collapsed` is the existing precedent for a
 * persisted desktop layout preference, and this follows its shape exactly —
 * a bare snake_case key holding a JSON boolean.
 */
const RAIL_COLLAPSED_KEY = 'worker_rail_collapsed';
/** What the host stylesheets key their collapsed track off. */
const RAIL_COLLAPSED_ATTR = 'data-worker-rail';

/**
 * The current pathname, without requiring a router (D402).
 *
 * `useLocation()` throws outside a router, and a rail is not worth a blank
 * page: several tests render pages that mount it with no router around them.
 * The location context reads as null there instead, and the rail falls back
 * to the window's own path, which is the same value inside the app.
 */
function useRailPathname() {
  const ctx = useContext(UNSAFE_LocationContext);
  if (ctx?.location?.pathname != null) return ctx.location.pathname;
  return typeof window !== 'undefined' ? window.location?.pathname || '' : '';
}

/**
 * The one ASSIST_SURFACES key every workspace zone shares, on all four
 * licences: its desk sentences are what the switch says it turns on.
 */
const WORKSPACE_SURFACE = 'workspace';

/**
 * D405 — THE RAIL ON A PHONE, for everyone the Eadwyn panel does not serve.
 * Below 1024px there is no room for a column beside a 390pt screen, so the
 * rail becomes a floating button whose badge always states the mode, and a tap
 * opens the same body in a bottom sheet.
 *
 * A FOUNDER ON A FOUNDER PAGE GETS THE PANEL INSTEAD (D698, D-h): the page's
 * own Eadwyn button, or while it has none this same floating button, opens
 * the right panel (`ui/EadwynPanel.jsx`), never the sheet. Who that is, is
 * `ui/eadwynPanel.js`'s rule: a mounted `role="founder"` rail and a viewer
 * whose shell role is `'founder'`.
 *
 * WHERE IT SITS. `calc(var(--mobile-tabbar-h, 0px) + 16px)` from the bottom:
 * the tab bar (D425) defines that height while it draws.
 *
 * PORTALLED TO <body>, AFTER MOUNT. The rail's frame column is `display: none`
 * below 1024px (RailFrame, D556), and a fixed button inside a `display: none`
 * parent never draws. The portal waits for the first effect, so a server
 * render draws no button and needs no document.
 *
 * HOW THE SHEET CLOSES — the More sheet's four ways: the backdrop, a swipe
 * down past RAIL_SWIPE_DISMISS_PX, Escape, and its close button. A route
 * change and a widening past 1024px close it too. Every one is an event on the
 * reducer below, which is what the tests drive.
 */
export const RAIL_SWIPE_DISMISS_PX = 60;
/** The FAB's offset from the bottom: above the tab bar when one draws. */
export const RAIL_FAB_BOTTOM = 'calc(var(--mobile-tabbar-h, 0px) + 16px)';

const SHEET_CLOSERS = new Set(['backdrop', 'escape', 'close', 'route', 'desktop']);

export function railSheetReducer(state, event) {
  if (event?.type === 'open') return state.open ? state : { open: true };
  if (!state.open) return state;
  if (SHEET_CLOSERS.has(event?.type)) return { open: false };
  if (event?.type === 'swipe') {
    const dy = Number(event.dy);
    return Number.isFinite(dy) && dy > RAIL_SWIPE_DISMISS_PX ? { open: false } : state;
  }
  return state;
}

/**
 * The floating button. The badge is the mode — filled when Eadwyn is on,
 * hollow for Manual — and the label says the same in words, because a
 * coloured dot alone tells a screen reader nothing.
 */
export function RailFab({ workspace, aiOn, onOpen, buttonRef, controls, style }) {
  const mode = aiOn ? 'Eadwyn' : 'Manual';
  return (
    <button
      type="button"
      ref={buttonRef}
      className="fwr-fab"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-controls={controls}
      aria-label={`Open Eadwyn AI · ${workspace} · ${mode}`}
      data-mode={aiOn ? 'ai' : 'manual'}
      data-testid="button-worker-rail-fab"
      style={{ ...style, bottom: RAIL_FAB_BOTTOM }}
    >
      <img src="/eadwyn-ai.png" alt="" width="26" height="26" className="fwr-fab-mark" />
      <i className="fwr-fab-badge" data-mode={aiOn ? 'ai' : 'manual'} aria-hidden="true" />
    </button>
  );
}

/**
 * The sheet. A real dialog — `aria-modal`, labelled by its title, focus on
 * its close button while open — over a backdrop that is itself a button, as
 * the More sheet's is. `onEvent` takes the reducer's events.
 */
export function RailSheet({ id, workspace, onEvent, closeRef, style, children }) {
  const titleId = `${id}-title`;
  const drag = useRef(null);
  const onTouchStart = (e) => { drag.current = e.touches?.[0]?.clientY ?? null; };
  const onTouchEnd = (e) => {
    const start = drag.current;
    drag.current = null;
    const end = e.changedTouches?.[0]?.clientY;
    if (start != null && end != null) onEvent({ type: 'swipe', dy: end - start });
  };
  return (
    <div className="fwr-sheet-layer" data-testid="worker-rail-sheet">
      <button
        type="button"
        tabIndex={-1}
        aria-label={`Close Eadwyn AI · ${workspace}`}
        className="fwr-sheet-backdrop"
        onClick={() => onEvent({ type: 'backdrop' })}
        data-testid="button-worker-rail-sheet-backdrop"
      />
      <div
        id={id}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="fwr fwr-sheet"
        style={style}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <div className="fwr-sheet-grab" aria-hidden="true" />
        <div className="fwr-sheet-head">
          <h2 id={titleId} className="fwr-title-text">Eadwyn AI</h2>
          <button
            type="button"
            ref={closeRef}
            className="fwr-toggle fwr-sheet-close"
            onClick={() => onEvent({ type: 'close' })}
            data-testid="button-worker-rail-sheet-close"
          >
            <X size={18} aria-hidden="true" />
            <span className="fwr-sr">Close Eadwyn AI</span>
          </button>
        </div>
        <div className="fwr-sheet-scroll">{children}</div>
      </div>
    </div>
  );
}

/**
 * D406 — THE COLLAPSED SPINE'S TWO FACTS: the status dot and the vertical
 * spend (Founder Workspaces canvas, "Collapsed spine"). Manual turns the dot
 * grey and hides the meter.
 *
 * THE DOT is the rail's real mode, the same value the switch and the phone
 * button's badge read: green when Eadwyn is on, grey for Manual. Its label
 * says which in words.
 *
 * THE SPEND is the account's month-to-date figure from `/api/ai/me/spend`, in
 * four states that never look alike: loading (an ellipsis), Unreadable (the
 * request failed, or the usage log could not be read), Not recorded (the log
 * was read and holds no month figure), and the figure itself. None of the
 * first three is ever drawn as $0.00.
 */
export function spineSpend({ spend, loading, spendError }) {
  if (loading) return { state: 'loading', text: '…', label: 'Usage this month: loading' };
  if (spendError || spend?.recorded === false) {
    return { state: 'unreadable', text: 'Unreadable', label: 'Usage this month could not be read' };
  }
  if (!spend || typeof spend?.month?.spend_usd !== 'number') {
    return { state: 'not_recorded', text: 'Not recorded', label: 'Usage this month: not recorded' };
  }
  const text = formatSpend(spend.month.spend_usd);
  return { state: 'figure', text, label: `Usage this month: ${text}` };
}

export function RailSpine({ aiOn, spendState }) {
  return (
    <div className="fwr-spine" data-testid="worker-rail-spine">
      <i
        className="fwr-spine-dot"
        data-state={aiOn ? 'on' : 'off'}
        role="img"
        aria-label={aiOn ? 'Eadwyn on' : 'Manual'}
        title={aiOn ? 'Eadwyn on' : 'Manual'}
        data-testid="worker-rail-spine-dot"
      />
      {aiOn && spendState && (
        <span
          className="fwr-spine-spend"
          data-state={spendState.state}
          aria-label={spendState.label}
          title={spendState.label}
          data-testid="worker-rail-spine-spend"
        >
          {spendState.text}
        </span>
      )}
    </div>
  );
}

/**
 * THE PILL: the viewer's licence, in the app's colours (D698 decision 2). The
 * canvas has four profiles and swaps two of their colours (AIR:77); these are
 * `ACCENT`'s, light and dark. "Advisor" names a human licence, not the model,
 * and is on record in `scripts/regulated-wording-baseline.json`. "HQ" and
 * "Admin" are not on the canvas. Any other role draws no pill.
 */
export const PROFILE_PILL = {
  founder: 'Founder',
  investor: 'Investor',
  advisor: 'Advisor',
  partner: 'Operating Partner',
  super_admin: 'HQ',
  admin: 'Admin',
  branch_admin: 'Admin',
};

/** The Manual sentence (AIR:21). True where the switch is drawn: D698.md. */
export const MANUAL_LINE = 'Eadwyn stays quiet on this page. Your work saves as usual.';
/** What a page with no fill band says in place of a switch (D17). */
export const NO_SWITCH_LINE = 'No switch here. Nothing on this page fills a blank for you.';
/**
 * The safety line (AIR:28's second sentence). The first, "Llama Guard 3 8B
 * checks every run.", is not true: the guard runs on four routes only and
 * fails open, and none of the runs this rail describes passes through it.
 * D698.md records the call sites and what would let it return.
 */
export const SAFETY_LINE = 'Eadwyn drafts; you send.';

/** The top-up read as Add tokens draws it: `lib/aiTokens.js`'s one model (D755, #1916). */
export const topUpState = (product, productError) => aiTokenState({ error: productError, data: product });

/**
 * THE USAGE BOX (AIR:30-36), from `GET /api/ai-budget/me` and `/top-up`
 * (D698 decision 9). Every failed read is Unreadable with a retry, never
 * $0.00 (D400), and so is a read with no `held_for_review` list, as on
 * `/account/usage`. While a hold waits on HQ every new run is refused
 * (`services/aiBudget.ts`), so the box says Runs paused, as an alert.
 */
export function RailUsage({ reading }) {
  if (reading.loading) return <p className="fwr-absent">Loading…</p>;
  const b = reading.budget;
  if (reading.budgetError || !budgetReadable(b)) {
    return (
      <div data-testid="text-worker-rail-usage-unreadable">
        <Unreadable
          what="Your AI allowance"
          claim="That is not a claim that nothing was spent."
          onRetry={reading.reload}
        />
      </div>
    );
  }
  const rows = [
    { t: 'Today', spent: b.day_spend_microusd, cap: b.daily_microusd, reset: 'Resets at 00:00 UTC', id: 'today' },
    { t: 'This month', spent: b.month_spend_microusd, cap: b.monthly_microusd, reset: 'Resets on the 1st', id: 'month' },
  ];
  const topUp = topUpState(reading.product, reading.productError);
  return (
    <>
      {b.held_for_review.length > 0 && (
        <div className="fwr-paused" role="alert" data-testid="text-worker-rail-paused">
          <b>Runs paused</b>
          <span>A run cost more than it held. New runs wait while HQ checks the charge.</span>
        </div>
      )}
      {rows.map((r) => {
        const meter = r.cap > 0 ? spendMeter(r.spent, r.cap) : null;
        return (
          <div key={r.id} className="fwr-usage-row" data-testid={`text-worker-rail-usage-${r.id}`}>
            <div className="fwr-usage-line"><span>{r.t}</span><b title={`${microMoney(r.spent)} of ${microMoney(r.cap)}`}>{`${usageMoney(r.spent)} of ${microMoney(r.cap)}`}</b></div>
            {meter && (
              <div className="fwr-meter" role="presentation">
                <i className={meter.over ? 'fwr-over' : undefined} style={{ width: `${meter.fraction * 100}%` }} />
              </div>
            )}
            <div className="fwr-usage-reset">{r.reset}</div>
          </div>
        );
      })}
      <div className="fwr-usage-line" data-testid="text-worker-rail-usage-held">
        <span>Held by runs in progress</span><b title={microMoney(b.month_reserved_microusd + b.topup_reserved_microusd)}>{usageMoney(b.month_reserved_microusd + b.topup_reserved_microusd)}</b>
      </div>
      <div className="fwr-usage-line" data-testid="text-worker-rail-usage-balance">
        <span>Top-up balance</span><b>{microMoney(b.balance_microusd)}</b>
      </div>
      <p className="fwr-usage-note">Runs use your plan's allowance first, then your top-up balance.</p>
      {topUp === 'ready' && (
        <a href={ADD_TOKENS_PATH} className="fwr-add-tokens" data-testid="link-worker-rail-add-tokens">Add tokens</a>
      )}
      {topUp === 'not_ready' && <p className="fwr-usage-note" data-testid="text-worker-rail-topup">{TOPUP_UNAVAILABLE}</p>}
      {topUp === 'unreadable' && (
        <div data-testid="text-worker-rail-topup">
          <Unreadable what="The AI top-up" claim="Retry to read the purchase option." onRetry={reading.reload} />
        </div>
      )}
    </>
  );
}

/**
 * Props hosts still pass that fed blocks the AIRail canvas does not draw
 * (owner, 2026-10-10): Coverage, the read-back, "Unavailable here", the scope
 * chip and the guardrail footer. The rail reads none of them, and
 * `branch_rail_mount.test.mjs` holds both halves: a mount may pass one of
 * these, and nothing in the rail reads one. Taking them off the mounts is
 * cleanup, not behaviour.
 */
export const RETIRED_RAIL_PROPS = ['stance', 'coverage', 'coverageNote', 'scope', 'scopeBranch', 'unavailable', 'action', 'footer'];

export default function WorkerRail({
  workspace,
  role = 'founder',
  className = '',
  /**
   * The desk's own sentence for what the switch turns on here (D424),
   * printed under the switch while Eadwyn is chosen.
   */
  note,
  // Does THIS workspace have fill-the-blanks work? The surface declares the
  // capability and its copy; the host declares whether this page has any.
  // Passing it is what draws the "Eadwyn | Manual" switch, so the switch
  // exists exactly where flipping it changes something — which is DECISIONS
  // D17's rule, and the reason a globally-rendered toggle would reintroduce
  // the dead control D17 refused.
  fills = false,
  'data-testid': testId = 'worker-rail',
}) {
  const pathname = useRailPathname();
  // `/api/ai/me/spend` (the spine) and `/api/ai/pricing` (the suggestions).
  // No page read: this page's month and last run left the rail (D698).
  const { spend, pricing, spendError, pricingError, loading, reload } = useAiSpend();
  const budgetReading = useAiBudget();
  const bodyId = `${useId()}-worker-rail-body`;
  const view = useViewMode();
  const viewer = view?.shellRole ?? role;
  const crumbs = useRailCrumbs();

  // One preference for the whole product, not one per page.
  const [collapsed, setCollapsed] = useState(() => safeReadJSON(RAIL_COLLAPSED_KEY, false) === true);

  // The HOSTS need to know, not just this element: the width that has to
  // change is a grid track on an ancestor this component does not own.
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const root = document.documentElement;
    if (collapsed) root.setAttribute(RAIL_COLLAPSED_ATTR, 'collapsed');
    else root.removeAttribute(RAIL_COLLAPSED_ATTR);
    // Leaving the attribute set after the last rail unmounts would shrink a
    // track on a page that has no rail to put in it.
    return () => root.removeAttribute(RAIL_COLLAPSED_ATTR);
  }, [collapsed]);

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      safeWriteJSON(RAIL_COLLAPSED_KEY, next);
      return next;
    });
  }, []);

  const surface = ASSIST_SURFACES[WORKSPACE_SURFACE];

  // WHERE: the provider's section and module, or this rail's workspace.
  const section = crumbs?.section || workspace;
  const module = crumbs?.section ? crumbs.module : null;
  const trail = [section, module, crumbs?.section ? crumbs.record : null].filter(Boolean);

  // THE SUGGESTIONS, over the page's jobs and the stored picks. A pick is
  // read from `readRailModel(workspace, task)`, the store `FillProposals.jsx`
  // sends, so the card and the run agree. Re-read on every render, so a pick
  // made here shows at once and one cleared by a refusal shows next render.
  const [, setPicks] = useState(0);
  const picks = {};
  for (const job of [...jobsFor(section, module), ...DEFAULT_JOBS]) picks[job.task] = readRailModel(workspace, job.task);
  const sug = railSuggestions({ section, module, pricing, picks });
  const pick = useCallback((id, tasks) => {
    for (const task of tasks) writeRailModel(workspace, task, id);
    setPicks((n) => n + 1);
  }, [workspace]);
  // The Worker's copy of the pick and the mode, read once per page load
  // (D698). The mode seeds its own store; a pick needs this re-render.
  useEffect(() => {
    let live = true;
    syncRailPrefs().then(() => { if (live) setPicks((n) => n + 1); });
    return () => { live = false; };
  }, []);
  const [allPref, setAllPref] = useState(null);
  const showAll = allPref ?? !!sug.offList;

  // Shared with the page, which decides whether to offer proposals, through a
  // module store rather than a provider — see hooks/useAssistMode.js.
  const [fillsOn, setFillsOn] = useAssistMode(workspace);
  // D765: the page every request names as the rail's, until D768's page map.
  useEffect(() => {
    const token = setRailPage(workspace);
    return () => clearRailPage(token);
  }, [workspace]);
  const modeChoice = surface.mode?.kind === 'choice' && fills ? surface.mode : null;
  const aiOn = !!modeChoice && fillsOn;
  const dim = !!modeChoice && !fillsOn;
  const live = !dim;
  const noneLine = surface.desks?.[workspace]?.none || NO_SWITCH_LINE;

  // The accent is the HOST's `role`, from `ACCENT`, the same table ZoneNav
  // reads. Four variables, not two: an inline `--fwr-accent` would beat
  // `.dark .fwr` and pin the light accent onto the dark ground.
  const accent = ACCENT[role] || ACCENT.founder;
  const accentStyle = {
    '--fwr-accent-light': accent.deep,
    '--fwr-accent-soft-light': accent.tint,
    '--fwr-accent-dark': accent.deepDark,
    '--fwr-accent-soft-dark': accent.tintDark,
  };
  // The pill is the VIEWER's licence, in that licence's colours.
  const pillWord = PROFILE_PILL[viewer] || null;
  const pillAccent = ACCENT[viewer];
  const pillStyle = pillAccent ? {
    '--fwr-pill-ink-light': pillAccent.deep,
    '--fwr-pill-bg-light': pillAccent.tint,
    '--fwr-pill-line-light': pillAccent.border,
    '--fwr-pill-ink-dark': pillAccent.deepDark,
    '--fwr-pill-bg-dark': pillAccent.tintDark,
    '--fwr-pill-line-dark': pillAccent.deepDark,
  } : undefined;

  // D405 and D698 — the phone forms. See the notes above `railSheetReducer`
  // and in `ui/eadwynPanel.js`.
  const serves = role === 'founder' && viewer === 'founder';
  useEadwynRailServes(serves);
  const panel = useEadwynPanel();
  const [sheet, dispatchSheet] = useReducer(railSheetReducer, { open: false });
  const sheetId = `${useId()}-worker-rail-sheet`;
  const fabRef = useRef(null);
  const sheetCloseRef = useRef(null);
  const [portalReady, setPortalReady] = useState(false);
  useEffect(() => { setPortalReady(typeof document !== 'undefined'); }, []);
  // The sheet and the panel belong to the page they were opened on.
  const lastPath = useRef(pathname);
  useEffect(() => {
    dispatchSheet({ type: 'route' });
    if (lastPath.current !== pathname) eadwynPanelEvent({ type: 'route' });
    lastPath.current = pathname;
  }, [pathname]);
  // At 1024px and up the column takes over, so an open sheet or panel closes.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia(PHONE_QUERY);
    const onChange = () => {
      if (mq.matches) return;
      dispatchSheet({ type: 'desktop' });
      eadwynPanelEvent({ type: 'desktop' });
    };
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  // Escape closes the sheet, on the one dialog stack (D686); focus moves into
  // the sheet on open and back to the button on close.
  useEscapeClose(() => dispatchSheet({ type: 'escape' }), { active: sheet.open });
  const wasOpen = useRef(false);
  useEffect(() => {
    if (sheet.open) {
      sheetCloseRef.current?.focus?.();
      wasOpen.current = true;
      return undefined;
    }
    if (wasOpen.current) {
      wasOpen.current = false;
      fabRef.current?.focus?.();
    }
    return undefined;
  }, [sheet.open]);
  // The floating button's label for the panel: "<section> · <module>", or
  // "<section> · Overview" on a cycle root (the provider's page without a
  // module), or the section alone.
  const panelLabel = module ? `${section} · ${module}` : crumbs?.section ? `${section} · Overview` : section;

  const body = (
    <div className="fwr-body" id={bodyId}>
      <div className="fwr-who">
        {pillWord && (
          <span className="fwr-pill" style={pillStyle} data-role={viewer} data-testid="text-worker-rail-profile">{pillWord}</span>
        )}
        <div className="fwr-crumbs" data-testid="text-worker-rail-crumbs">
          {trail.map((t, i) => (
            <Fragment key={`${i}-${t}`}>
              <span className="fwr-crumb" data-last={i === trail.length - 1 ? 'true' : 'false'}>{t}</span>
              {i < trail.length - 1 && <span className="fwr-crumb-sep" aria-hidden="true">›</span>}
            </Fragment>
          ))}
        </div>
      </div>

      {/* THE SWITCH (AIR:20), only where the host passes `fills`: the assist
          mode, Manual until the founder chooses Eadwyn. Manual says the
          canvas's sentence and dims the list; Eadwyn says what the switch
          turns on at this desk (`note`, D424). Without `fills` there is no
          switch, and one line says why (D17). */}
      {modeChoice ? (
        <>
          <div className="fwr-switch-row" role="radiogroup" aria-label={`Eadwyn on ${workspace}`}>
            <button
              type="button"
              role="radio"
              aria-checked={fillsOn}
              className="fwr-switch-opt"
              data-selected={fillsOn ? 'true' : 'false'}
              onClick={() => setFillsOn(true)}
              data-testid="button-worker-rail-mode-eadwyn"
            >
              Eadwyn
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={!fillsOn}
              className="fwr-switch-opt"
              data-selected={!fillsOn ? 'true' : 'false'}
              onClick={() => setFillsOn(false)}
              data-testid="button-worker-rail-mode-manual"
            >
              Manual
            </button>
          </div>
          <p className="fwr-mode-line" data-testid="text-worker-rail-mode">
            {fillsOn ? (note || modeChoice.note) : MANUAL_LINE}
          </p>
        </>
      ) : (
        <p className="fwr-mode-line" data-testid="text-worker-rail-mode">{noneLine}</p>
      )}

      {/* SUGGESTED FOR THIS PAGE (AIR:23-28). */}
      <section className="fwr-sug" data-dimmed={dim ? 'true' : 'false'} data-testid="worker-rail-suggestions">
        <span className="fwr-eyebrow">Suggested for this page</span>
        {sug.unreadable ? (
          pricingError ? (
            <div data-testid="worker-rail-model-unreadable">
              <Unreadable
                what="The router's model list"
                claim="Which model runs here is unknown, not none."
                onRetry={reload}
              />
            </div>
          ) : <p className="fwr-absent">Loading…</p>
        ) : (
          <div
            className="fwr-cards"
            {...(sug.cards.some((c) => c.pickable) ? { role: 'radiogroup', 'aria-label': `Model for ${workspace}` } : {})}
          >
            {sug.cards.map((card) => {
              const radio = card.pickable;
              const Tag = radio && live ? 'button' : 'div';
              return (
                <Tag
                  key={card.id}
                  {...(Tag === 'button' ? { type: 'button', onClick: () => pick(card.id, card.tasks) } : {})}
                  {...(radio ? { role: 'radio', 'aria-checked': card.checked, ...(live ? {} : { 'aria-disabled': 'true' }) } : {})}
                  className="fwr-card"
                  data-radio={radio ? 'true' : 'false'}
                  data-selected={radio && card.checked ? 'true' : 'false'}
                  data-testid={`card-worker-rail-model-${card.id.split('/').pop()}`}
                >
                  {radio && <span className="fwr-dot" aria-hidden="true"><span /></span>}
                  <span className="fwr-card-text">
                    <span className="fwr-card-head">
                      <b>{card.name}</b>
                      {card.role && <i className="fwr-role" data-default={card.role === 'Default' ? 'true' : 'false'}>{card.role}</i>}
                    </span>
                    <span className="fwr-card-line">{card.line}</span>
                  </span>
                </Tag>
              );
            })}
          </div>
        )}
        {!sug.unreadable && (
          <p className="fwr-models-note" data-testid="text-worker-rail-model-note">
            {sug.pickable
              ? `Remembered for ${workspace}. Switching changes nothing already accepted.`
              : 'The router\'s model for this work. It is not chosen here.'}
          </p>
        )}
        {sug.offList && (
          <p className="fwr-using" data-testid="text-worker-rail-using">{`Using ${sug.offList.name} on this page.`}</p>
        )}
        {!sug.unreadable && sug.groups.length > 0 && (
          <>
            <button
              type="button"
              className="fwr-all-toggle"
              aria-expanded={showAll}
              disabled={!live}
              onClick={() => setAllPref(!showAll)}
              data-testid="button-worker-rail-all-models"
            >
              {showAll ? 'Hide all models' : 'All models ›'}
            </button>
            {showAll && (
              <div className="fwr-groups" data-testid="worker-rail-all-models">
                {sug.groups.map((g) => (
                  <div key={g.title} className="fwr-group">
                    <div className="fwr-group-title">{g.title}</div>
                    <div className="fwr-chips">
                      {g.chips.map((c) => (c.pickable && live ? (
                        <button
                          key={c.id}
                          type="button"
                          className="fwr-chip"
                          aria-pressed={c.selected}
                          data-selected={c.selected ? 'true' : 'false'}
                          onClick={() => pick(c.id, c.tasks)}
                          data-testid={`chip-worker-rail-model-${c.id.split('/').pop()}`}
                        >
                          {c.name}
                        </button>
                      ) : (
                        <span
                          key={c.id}
                          className="fwr-chip"
                          data-selected={c.selected ? 'true' : 'false'}
                          data-testid={`chip-worker-rail-model-${c.id.split('/').pop()}`}
                        >
                          {c.name}
                        </span>
                      )))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        <p className="fwr-safety" data-testid="text-worker-rail-safety">{SAFETY_LINE}</p>
      </section>

      {/* USAGE (AIR:30-36): the allowance ledger, D629. */}
      <section className="fwr-usage" data-testid="worker-rail-usage">
        <span className="fwr-eyebrow">Usage</span>
        <RailUsage reading={budgetReading} />
      </section>
    </div>
  );

  return (
    <>
    <aside
      className={`fwr ${className}`.trim()}
      aria-label={`Eadwyn AI · ${workspace}`}
      data-collapsed={collapsed ? 'true' : 'false'}
      data-testid={testId}
      style={accentStyle}
    >
      <div className="fwr-title">
        <img src="/eadwyn-ai.png" alt="" width="26" height="26" className="fwr-mark" />
        <span className="fwr-title-text">Eadwyn AI</span>
        {/* D406 — between the label and the toggle, because the collapsed
            title is a reversed column: the toggle draws on top, then the dot
            and the spend, then the turned label, the canvas's order. */}
        {collapsed && (
          <RailSpine aiOn={aiOn} spendState={spineSpend({ spend, loading, spendError })} />
        )}
        <button
          type="button"
          className="fwr-toggle"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          title={collapsed ? `Show the Eadwyn AI rail for ${workspace}` : `Collapse the Eadwyn AI rail for ${workspace}`}
          data-testid="button-worker-rail-toggle"
        >
          {collapsed
            ? <PanelRightOpen size={14} aria-hidden="true" />
            : <PanelRightClose size={14} aria-hidden="true" />}
          <span className="fwr-sr">
            {collapsed ? 'Show the Eadwyn AI rail' : 'Collapse the Eadwyn AI rail'}
          </span>
        </button>
      </div>

      {!sheet.open && !(serves && panel.open) && body}
    </aside>
    {portalReady && createPortal(
      serves ? (
        <>
          {!panel.triggered && (
            <RailFab
              workspace={workspace}
              aiOn={aiOn}
              onOpen={() => openEadwynPanel(panelLabel)}
              buttonRef={fabRef}
              style={accentStyle}
            />
          )}
          {panel.open && (
            <EadwynPanel label={panel.label} style={accentStyle}>
              {body}
            </EadwynPanel>
          )}
        </>
      ) : (
        <>
          <RailFab
            workspace={workspace}
            aiOn={aiOn}
            onOpen={() => dispatchSheet({ type: 'open' })}
            buttonRef={fabRef}
            controls={sheetId}
            style={accentStyle}
          />
          {sheet.open && (
            <RailSheet id={sheetId} workspace={workspace} onEvent={dispatchSheet} closeRef={sheetCloseRef} style={accentStyle}>
              {body}
            </RailSheet>
          )}
        </>
      ),
      document.body,
    )}
    </>
  );
}
