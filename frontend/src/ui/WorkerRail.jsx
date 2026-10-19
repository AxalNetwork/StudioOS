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
import { railView } from './railModels';
import { PRICE_NOTE, SAFETY_SENTENCE, guardSentence, priceGroups, railModelPrice, railRates } from './railPrices';
import { aiBudgetApi } from '../lib/api/aiBudget';
import { railPrefsApi } from '../lib/api/railPrefs.js';
import { syncRailPrefs } from './railModelChoice';
import { useRailCrumbs, useRailPage } from './railCrumbs.js';
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
 * (D698, #1660; the "AIRail · every page" export since D769, #2088), block by
 * block, on real data:
 *
 *   1. HEADER — the Eadwyn mark and "Eadwyn AI".
 *   2. WHO AND WHERE — a pill naming the viewer's licence, in the app's own
 *      colours (`ACCENT`), and the crumbs "section › module › record" from
 *      `RailCrumbsProvider` (`ui/railCrumbs.js`), or the `workspace` alone.
 *   3. THE SWITCH — "Turn off AI assistance on this page", on every page
 *      (D769, #2088; D720 §6). It is the assist mode (`useAssistMode`), on by
 *      default everywhere since D769 PR 2: the Worker refuses a run on a page
 *      switched off (D765) and a recording's Stop asks first (D770). With AI
 *      off the rail says so and draws no suggestions.
 *   4. SUGGESTED FOR THIS PAGE — the page's models from the Worker's matrix
 *      (`GET /api/ai/rail?page=<key>`, D764), or the open option's while
 *      `useRailOption` names one, default first, each with its role, line and
 *      price, a radio where the row offers a choice; the member's pick is
 *      stored per page (`PUT /api/ai/rail/pick`). Then "On this page", the
 *      page's options, and "All models", the router's models in the canvas's
 *      ten groups, each row with its short price and the New badge. A page
 *      with no page key, or no row, says "Not recorded" and why.
 *   5. SAFETY — "Llama Guard 3 8B checks every run (… in · … out per 1M
 *      tokens). Eadwyn drafts; you send." while the Worker reports the guard
 *      on (D763 part 2 made it true); else "Eadwyn drafts; you send."
 *   6. USAGE — today, this month, what runs in progress hold, the top-up
 *      balance and Add tokens, always drawn, from `/api/ai-budget/me` and
 *      `/top-up`.
 *
 * PRICES ARE THE WORKER'S (D720 §1, reversing D698 decision 10): a card's from
 * `GET /api/ai/rail`, a row's and the guard's from `GET /api/ai/rates`, at the
 * price a run is settled at (`billing`), printed in the canvas's units
 * (`ui/railPrices.js`), never multiplied here. No model id,
 * estimate, average or receipt: those are `/account/usage`'s. The accent is the
 * `role` prop's, because some hosts are violet for every viewer on purpose;
 * the pill is the viewer's.
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

/** The switch's label, on every page (D720 §6). */
export const AI_SWITCH_LABEL = 'Turn off AI assistance on this page';
/**
 * What the rail says with AI off: the canvas's sentence, its apostrophe
 * included (D720 §6). It was D698's Manual sentence; the name stays.
 */
export const MANUAL_LINE = 'Eadwyn won\u2019t suggest or draft on this page. Your work saves as usual.';
/**
 * The safety line alone, drawn while the Worker does not report the guard on
 * every run. While it does (D763 part 2), the rail draws `guardSentence`, which
 * ends with this.
 */
export const SAFETY_LINE = SAFETY_SENTENCE;

/**
 * The Worker's rates (`GET /api/ai/rates`), read once per mount: the prices on
 * the cards and rows, and the guard's. `reload` reads again.
 */
function useRailRates() {
  const [reading, setReading] = useState({ loading: true, data: null, error: false });
  const load = useCallback(() => {
    let live = true;
    setReading((r) => ({ ...r, loading: true }));
    Promise.resolve()
      .then(() => aiBudgetApi.rates())
      .then((data) => { if (live) setReading({ loading: false, data, error: false }); },
        () => { if (live) setReading({ loading: false, data: null, error: true }); });
    return () => { live = false; };
  }, []);
  useEffect(() => load(), [load]);
  return { ...reading, reload: load };
}

/**
 * D769 PR 2: the page's row from the Worker's matrix, or the open option's
 * (`GET /api/ai/rail`). Nothing is read without a page key. A 404 is the
 * matrix having no row for the page, which the rail says, not a failure.
 */
function useRailRow(page, option) {
  const [reading, setReading] = useState({ loading: !!page, data: null, error: false, status: null });
  const load = useCallback(() => {
    if (!page) {
      setReading({ loading: false, data: null, error: false, status: null });
      return undefined;
    }
    let live = true;
    setReading((r) => ({ ...r, loading: true }));
    Promise.resolve()
      .then(() => railPrefsApi.page(page, option))
      .then((data) => { if (live) setReading({ loading: false, data, error: false, status: 200 }); },
        (e) => { if (live) setReading({ loading: false, data: null, error: true, status: e?.status ?? null }); });
    return () => { live = false; };
  }, [page, option]);
  useEffect(() => load(), [load]);
  return { ...reading, reload: load };
}

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
      {/* ADD TOKENS IS ALWAYS DRAWN (D769, D720 §11): a link while a pack is
          on sale, else a disabled button with the reason under it. */}
      {topUp === 'ready' ? (
        <a href={ADD_TOKENS_PATH} className="fwr-add-tokens" data-testid="link-worker-rail-add-tokens">Add tokens</a>
      ) : (
        <button type="button" className="fwr-add-tokens" disabled aria-disabled="true" data-testid="button-worker-rail-add-tokens">Add tokens</button>
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
export const RETIRED_RAIL_PROPS = ['stance', 'coverage', 'coverageNote', 'scope', 'scopeBranch', 'unavailable', 'action', 'footer', 'fills'];

export default function WorkerRail({
  workspace,
  role = 'founder',
  className = '',
  /**
   * The desk's own sentence for what AI does here (D424), printed under the
   * switch while AI is on.
   */
  note,
  'data-testid': testId = 'worker-rail',
}) {
  const pathname = useRailPathname();
  // `/api/ai/me/spend` (the spine). This page's month and last run left the
  // rail (D698).
  const { spend, spendError, loading } = useAiSpend();
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

  // WHERE: the provider's section and module, or this rail's workspace.
  const section = crumbs?.section || workspace;
  const module = crumbs?.section ? crumbs.module : null;
  const trail = [section, module, crumbs?.section ? crumbs.record : null].filter(Boolean);

  // THE PAGE'S MODELS (D769 PR 2): the shell's page key (D768) and the open
  // option, read from the Worker's matrix. A pick made here shows at once and
  // is stored per page, or per option while one is open; the re-read after it
  // is the Worker's answer.
  const railPage = useRailPage();
  const pageKey = railPage?.offCanvas ? null : railPage?.page ?? null;
  const optionKey = railPage?.option?.key ?? null;
  const row = useRailRow(pageKey, optionKey);
  const [picked, setPicked] = useState(null);
  useEffect(() => { setPicked(null); }, [pageKey, optionKey]);
  const billing = row.data?.billing;
  const rail = railView({
    reading: row, page: pageKey, option: optionKey, pick: picked, price: (m) => railModelPrice(m, billing, true),
  });
  // D769: each All models row's price, from the Worker's rate card.
  const rates = railRates(useRailRates());
  const groups = priceGroups(rail.groups, rates);
  const pick = useCallback((id) => {
    if (!pageKey) return;
    setPicked(id);
    Promise.resolve()
      .then(() => railPrefsApi.setPagePick(pageKey, id, optionKey))
      .then(() => row.reload(), () => { setPicked(null); row.reload(); });
  }, [pageKey, optionKey, row.reload]);
  // The Worker's copy of each page's switch, read once per page load (D698).
  useEffect(() => { syncRailPrefs(); }, []);
  const [allPref, setAllPref] = useState(null);
  const showAll = allPref ?? false;

  // D765: the page every request names as the rail's, the key its switch is
  // stored and checked under (lib/railPage.js).
  useEffect(() => {
    const token = setRailPage(workspace);
    return () => clearRailPage(token);
  }, [workspace]);

  // Shared with the page, which decides whether to offer proposals, through a
  // module store rather than a provider — see hooks/useAssistMode.js. On by
  // default on every page (D720 §6).
  const [aiOn, setAiOn] = useAssistMode(workspace);
  const live = aiOn;

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

      {/* THE SWITCH (D720 §6), on every page: on means AI is OFF, as the
          canvas's label says. With AI off the rail says so, and draws no
          suggestions and no pick. */}
      <button
        type="button"
        role="switch"
        aria-checked={!aiOn}
        className="fwr-ai-switch"
        onClick={() => setAiOn(!aiOn)}
        data-testid="switch-worker-rail-ai-off"
      >
        <span className="fwr-ai-switch-label">{AI_SWITCH_LABEL}</span>
        <span className="fwr-ai-switch-track" data-on={aiOn ? 'false' : 'true'} aria-hidden="true"><span className="fwr-ai-switch-knob" /></span>
      </button>
      {!aiOn && <p className="fwr-mode-line" data-testid="text-worker-rail-mode">{MANUAL_LINE}</p>}
      {aiOn && note && <p className="fwr-mode-line" data-testid="text-worker-rail-mode">{note}</p>}

      {/* SUGGESTED FOR THIS PAGE (AIR:23-28). */}
      <section className="fwr-sug" data-ai={aiOn ? 'on' : 'off'} data-testid="worker-rail-suggestions">
        {aiOn && (
        <>
        <span className="fwr-eyebrow">Suggested for this page</span>
        {rail.state === 'loading' && <p className="fwr-absent">Loading…</p>}
        {rail.state === 'none' && (
          <p className="fwr-absent" data-testid="text-worker-rail-model-none">{`Not recorded. ${rail.reason}`}</p>
        )}
        {rail.state === 'unreadable' && (
          <div data-testid="worker-rail-model-unreadable">
            <Unreadable
              what="This page's models"
              claim="Which model runs here is unknown, not none."
              onRetry={row.reload}
            />
          </div>
        )}
        {rail.state === 'ready' && (
          <div
            className="fwr-cards"
            {...(rail.pickable ? { role: 'radiogroup', 'aria-label': `Model for ${trail[trail.length - 1] || workspace}` } : {})}
          >
            {rail.cards.map((card) => {
              const radio = rail.pickable;
              const Tag = radio && live ? 'button' : 'div';
              return (
                <Tag
                  key={card.id}
                  {...(Tag === 'button' ? { type: 'button', onClick: () => pick(card.id) } : {})}
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
                    {card.line && <span className="fwr-card-line">{card.line}</span>}
                    <span className="fwr-card-price" data-testid={`text-worker-rail-price-${card.id.split('/').pop()}`}>{card.price}</span>
                  </span>
                </Tag>
              );
            })}
          </div>
        )}
        {rail.state === 'ready' && (
          <p className="fwr-models-note" data-testid="text-worker-rail-model-note">
            {rail.pickable
              ? `Remembered for ${optionKey ? 'this option' : 'this page'}. Switching changes nothing already accepted.`
              : 'The model for this work. It is not chosen here.'}
          </p>
        )}
        {rail.options.length > 0 && (
          <div className="fwr-options" data-testid="worker-rail-options">
            <span className="fwr-eyebrow">On this page</span>
            <ul className="fwr-option-list">
              {rail.options.map((o) => (
                <li key={o.key} className="fwr-option" data-open={o.open ? 'true' : 'false'} data-testid={`row-worker-rail-option-${o.key}`}>
                  <span className="fwr-option-label">{o.label}</span>
                  {o.model && <span className="fwr-option-model">{o.model}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {rail.state === 'ready' && groups.length > 0 && (
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
                <p className="fwr-price-note" data-testid="text-worker-rail-price-note">{PRICE_NOTE}</p>
                {groups.map((g) => (
                  <div key={g.title} className="fwr-group">
                    <div className="fwr-group-title">{g.title}</div>
                    <div className="fwr-rows">
                      {g.chips.map((c) => {
                        const inner = (
                          <>
                            <span className="fwr-row-name">
                              {c.name}
                              {c.isNew && <i className="fwr-new" data-testid={`badge-worker-rail-new-${c.id.split('/').pop()}`}>New</i>}
                            </span>
                            <span className="fwr-row-price" data-testid={`text-worker-rail-row-price-${c.id.split('/').pop()}`}>{c.price}</span>
                          </>
                        );
                        return c.pickable && live ? (
                          <button
                            key={c.id}
                            type="button"
                            className="fwr-chip"
                            aria-pressed={c.selected}
                            data-selected={c.selected ? 'true' : 'false'}
                            onClick={() => pick(c.id)}
                            data-testid={`chip-worker-rail-model-${c.id.split('/').pop()}`}
                          >
                            {inner}
                          </button>
                        ) : (
                          <span
                            key={c.id}
                            className="fwr-chip"
                            data-selected={c.selected ? 'true' : 'false'}
                            data-testid={`chip-worker-rail-model-${c.id.split('/').pop()}`}
                          >
                            {inner}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        </>
        )}
        <p className="fwr-safety" data-testid="text-worker-rail-safety">{rates.guardOn ? guardSentence(rates) : SAFETY_LINE}</p>
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
