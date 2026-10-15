import { useCallback, useContext, useEffect, useId, useReducer, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PanelRightClose, PanelRightOpen, Sparkles, X } from 'lucide-react';
import { UNSAFE_LocationContext } from 'react-router-dom';
import useAiBudget from '../hooks/useAiBudget';
import { allowanceMonth, microMoney } from './AiBudgetUsage';
import useAiSpend, { railCards } from '../hooks/useAiSpend';
import useAssistMode from '../hooks/useAssistMode';
import { safeReadJSON, safeWriteJSON } from '../lib/storage';
import { formatCost, formatRate, formatSpend, isRecordablePage, lastRunReceipt, spendMeter } from './assistCost';
import { useEscapeClose } from '../components/useEscapeClose';
import { ASSIST_SURFACES, observedRunCost } from './eadwynConfig';
import { MODEL_COPY, jobsFor } from './railModels';
import { readRailModel, writeRailModel } from './railModelChoice';
import { Unreadable } from './Honesty';
import { ACCENT } from '../workspaces/shellConfig';
import './workerRail.css';

/**
 * The Worker AI rail. One component, every licence.
 *
 * ONE RAIL, NOT THIRTY-NINE. Every founder page had built its own: a local
 * `WorkerRail` / `BuildRail` / `RaiseRail` / `ValidateRail` / `CadenceRail`
 * function at the bottom of the file — twenty-six of them under seventeen
 * distinct names, plus one written inline on the Research desk — each with its
 * own props and its own CSS class names. Then the investor shell turned out to
 * hold twelve more, under four different HEADINGS (one said "Deals AI", not
 * "Worker AI"), none of which read the spend endpoint at all: no meter, no cap,
 * every string a literal. They agreed on the shape by coincidence and drifted
 * in the details, and the pages that never grew one simply had no rail — which
 * is the report this component answers, filed twice, once per licence: "some
 * pages doesn't have it, it does show anything, it looks blank".
 *
 * IT WAS CALLED `FounderWorkerRail`. Nothing it RENDERS is founder-specific —
 * the title is `Worker AI · {workspace}` — so the name was the last thing
 * claiming the rail belonged to one licence. What IS per-licence is the
 * accent, and that comes from `role`.
 *
 * WHAT IT DRAWS IS THE AIRAIL CANVAS, `design/incoming/AIRail.dc.html`, and
 * nothing else (owner, 2026-10-10). Blocks had been added one decision at a
 * time — Coverage, a "Read this page back" run, "Unavailable here" notes, a
 * spend-by-page list, the guardrail footer, and on 2026-10-09 D652's "Ask
 * Eadwyn" chat — until the rail no longer looked like its canvas. They are
 * gone; the four canvas blocks remain, on real data:
 *
 *   1. MODE — the "Manual" card ("No tokens. Page works alone.") and, only
 *      where the host passes `fills`, the "AI fills the blanks" card with its
 *      switch and the desk's own sentence (`note`, D424). A page with nothing
 *      to fill draws Manual alone, as a statement: a switch there would change
 *      nothing (D17).
 *
 *   2. MODEL · THIS PAGE — one card per model the section's work runs on,
 *      from `railCards` over the section's jobs (`railModels.js`) and the
 *      router's own tables (`/api/ai/pricing`): the router's model, or the
 *      founder's pick where a job takes one, with DEFAULT when it is the
 *      router's (D400). The other models those jobs offer are compact rows.
 *      The ids and rates are the router's, never the canvas's; a model the
 *      router does not run or price draws nothing. Under each card, the
 *      founder's own average run (D16), measured and never modelled.
 *
 *   3. USAGE — the month's included allowance spent, of the allowance, with
 *      a bar (the allowance ledger, D629), then this page's month and this
 *      page's last run (D552 step 3, D401). Every failed read is Unreadable
 *      with a retry; an absent fact is not a zero fact.
 *
 *   4. SAFETY — the canvas's last row, in the desk's own words.
 *
 * COLLAPSIBLE — and the reason it was not is worth keeping, because it is what
 * the fix had to solve. This docblock used to read "NOT COLLAPSIBLE,
 * DELIBERATELY": every host is a grid item in a track fixed at 268-288px
 * (`grid-template-columns: minmax(0,1fr) 286px`), so narrowing the aside could
 * not narrow the track and a collapse would have left a 240px blank column
 * beside a spine — worse than no toggle. That was true and it was never a
 * reason to ship an icon that does nothing.
 *
 * The track is now the thing that moves. Twenty host declarations — nineteen
 * grid tracks and `.i4-rail`'s fixed width, one per stylesheet — changed from
 * a literal `286px` to `var(--fwr-track, 286px)`, each keeping its OWN width
 * as the fallback, so nothing shifts by a pixel while the rail is open. Widths
 * genuinely differ across the hosts (258 to 288px) and preserving that was the
 * point of the fallback rather than an accident of it. `workerRail.css` then
 * defines `--fwr-track: 44px` once, on
 * `:root[data-worker-rail="collapsed"]`. One global custom property drives
 * every host at the same moment, which is also what makes the preference
 * global: the canvas describes one rail, docked right, and a reader who closed
 * it on Build has closed it on Raise.
 *
 * DESKTOP ONLY, in CSS rather than in state. Below 1024px the hosts' own media
 * rules already stack the rail under the body, where a 44px spine would be a
 * bar across the page. Both the track override and the spine rendering sit
 * behind `@media (min-width: 1024px)`, so the stored preference survives a
 * narrow viewport without taking effect on one — the same arrangement
 * `sidebarCollapsed` reaches with an `isDesktop` flag, minus the state.
 *
 * THE ICON IS A BUTTON NOW. It was a bare `lucide-react` SVG with
 * `aria-hidden="true"` — correct for decoration, wrong for a control. It is a
 * real `<button>` with `aria-expanded`, `aria-controls` naming the body it
 * hides, a title that says what the click does, and a visible focus ring.
 *
 * STYLING. `className` takes the host page's own rail class — `a5-rail`,
 * `fr-pitch-rail`, `a7-rail` — so the page's grid column, border and background
 * still place it exactly where its layout expects. Everything inside is
 * `workerRail.css`, which is why the blocks look the same on every one of
 * them — every host on every licence, founder, investor, advisor, partner
 * and both admin tiers.
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
 * licences. One surface rather than one per bucket because the task is the
 * same everywhere — read back the lines the page is already showing — and
 * `/api/ai/me/spend` groups by task, so twenty surfaces over one task class
 * would report the same average twenty times and call it per-page data.
 */
const WORKSPACE_SURFACE = 'workspace';

/**
 * D405 — THE RAIL ON A PHONE: canvas M5, "persistent panel → FAB + bottom
 * sheet". Below 1024px there is no room for a 284pt column beside a 390pt
 * screen, so the panel becomes a floating button whose badge always states the
 * mode, and a tap opens the same blocks in a sheet with the page still visible
 * above it. Nothing in the rail changes its meaning on the smaller screen: the
 * usage meter keeps its three states (loading, Unreadable, the figure) because
 * it is the same JSX, not a phone copy of it.
 *
 * WHERE IT SITS. `calc(var(--mobile-tabbar-h, 0px) + 16px)` from the bottom:
 * the tab bar (D425) defines that height while it draws, and a page with no
 * bar falls back to 16px. Inline rather than in the stylesheet so the one
 * number that has to agree with the bar is visible where the button is.
 *
 * PORTALLED TO <body>, AFTER MOUNT. The rail's frame column is `display: none`
 * below 1024px (RailFrame, D556; before it, the shell's slot was `hidden
 * xl:block`), and a fixed button inside a `display: none` parent never draws. The portal
 * waits for the first effect, so a server render (and every render test of a
 * page that mounts a rail) draws no button and needs no document.
 *
 * HOW IT CLOSES — the More sheet's four ways, so a reader learns one sheet:
 * the backdrop, a swipe down past RAIL_SWIPE_DISMISS_PX, Escape, and its close
 * button. A route change and a widening past 1024px close it too, because the
 * sheet belongs to the page it was opened on and the panel takes over above
 * the breakpoint. Every one of those is an event on the reducer below, which
 * is what the tests drive: this repository renders without a DOM, so the
 * reducer is how a close can be proved rather than grepped for.
 */
export const RAIL_SWIPE_DISMISS_PX = 60;
/** The FAB's offset from the bottom: above the tab bar when one draws. */
export const RAIL_FAB_BOTTOM = 'calc(var(--mobile-tabbar-h, 0px) + 16px)';
const RAIL_DESKTOP_QUERY = '(min-width: 1024px)';

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
 * The floating button. The badge is the canvas's mode signal — filled when a
 * fill mode is on, hollow for Manual — and the label says the same in words,
 * because a coloured dot alone tells a screen reader nothing.
 */
export function RailFab({ workspace, aiOn, onOpen, buttonRef, controls, style }) {
  const mode = aiOn ? 'AI on' : 'Manual';
  return (
    <button
      type="button"
      ref={buttonRef}
      className="fwr-fab"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-controls={controls}
      aria-label={`Open Worker AI · ${workspace} · ${mode}`}
      data-mode={aiOn ? 'ai' : 'manual'}
      data-testid="button-worker-rail-fab"
      style={{ ...style, bottom: RAIL_FAB_BOTTOM }}
    >
      <Sparkles size={22} aria-hidden="true" />
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
        aria-label={`Close Worker AI · ${workspace}`}
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
          <h2 id={titleId} className="fwr-title-text">Worker AI · {workspace}</h2>
          <button
            type="button"
            ref={closeRef}
            className="fwr-toggle fwr-sheet-close"
            onClick={() => onEvent({ type: 'close' })}
            data-testid="button-worker-rail-sheet-close"
          >
            <X size={18} aria-hidden="true" />
            <span className="fwr-sr">Close Worker AI</span>
          </button>
        </div>
        <div className="fwr-sheet-scroll">{children}</div>
      </div>
    </div>
  );
}

/**
 * D406 — THE COLLAPSED SPINE'S TWO FACTS: the status dot and the vertical
 * spend (Founder Workspaces canvas, "Collapsed spine"). The canvas: "Keeps
 * three facts alive: the advisor is on (green dot), which page-model is loaded
 * (hover), and spend to date … Manual mode turns the dot grey and hides the
 * meter — a founder who never wants AI sees a quiet strip, not a nag."
 *
 * TWO OF THE THREE. The page-model on hover is not drawn: the spine names no
 * model and no price (#994), because the model belongs to the expanded rail,
 * where its rate is shown beside it.
 *
 * THE DOT is the rail's real mode, the same value the expanded Mode block and
 * the phone button's badge read: green when a fill mode is on, grey for
 * Manual. Its label says which in words.
 *
 * THE SPEND is the account's month-to-date figure from `/api/ai/me/spend`, in
 * four states that never look alike: loading (an ellipsis), Unreadable (the
 * request failed, or the usage log could not be read), Not recorded (the log
 * was read and holds no month figure), and the figure itself. None of the
 * first three is ever drawn as $0.00. In Manual it is not drawn at all, as the
 * canvas says, and the label on the spine still names the rail.
 */
/** The Manual card's line (AIRail canvas): what OFF means, in five words. */
export const MANUAL_NOTE = 'No tokens. Page works alone.';

/** A card's full rate line: per million tokens, or per audio minute. */
export function rateLine(price) {
  if (!price) return null;
  return price.kind === 'audio'
    ? `${formatRate(price.perMinute)} per audio minute`
    : `${formatRate(price.pin)} / M in · ${formatRate(price.pout)} / M out`;
}

/** A compact row's rate, in the corner the canvas puts it. */
export function inlineRate(price) {
  if (!price) return null;
  return price.kind === 'audio'
    ? `${formatRate(price.perMinute)} / min`
    : `${formatRate(price.pin)} / ${formatRate(price.pout)}`;
}

/**
 * One model in use (AIRail canvas, a DEFAULT card): its name, the badge when
 * every job on it runs the router's own model, its id, what it does here,
 * the jobs' tags, the rate, and for each job the founder's own average run
 * (D16), measured and never modelled. `onPick` is set when picking the card
 * would move a job onto it; the card is then a button.
 */
export function RailModelCard({ card, spend, onPick }) {
  const tags = [...new Set(card.jobs.flatMap((j) => j.tags || []))];
  const Tag = onPick ? 'button' : 'div';
  return (
    <Tag
      {...(onPick ? { type: 'button', onClick: onPick } : {})}
      className="fwr-model"
      data-selected="true"
      data-testid={`card-worker-rail-model-${card.id.split('/').pop()}`}
    >
      <span className="fwr-model-head">
        <b>{card.name}</b>
        {card.isDefault && <i className="fwr-badge">DEFAULT</i>}
      </span>
      <span className="fwr-model-id">{card.id}</span>
      <span className="fwr-model-why">{card.jobs.map((j) => j.why).join(' ')}</span>
      {tags.length > 0 && (
        <span className="fwr-tags">{tags.map((t) => <i key={t}>{t}</i>)}</span>
      )}
      <span className="fwr-model-rate">{rateLine(card.price)}</span>
      {card.jobs.map((j) => {
        // The average is drawn from `by_task`; when that read failed the
        // Worker says so (`by_task_recorded: false`, D401), and "no runs yet"
        // would be a claim the page cannot support.
        const label = card.jobs.length > 1 ? `${String(j.tags?.[0] || j.task).replace(/^Best for: /, '')} · ` : '';
        if (spend?.by_task_recorded === false) {
          return <span key={j.task} className="fwr-estimate fwr-absent">{`${label}Your average could not be read.`}</span>;
        }
        const observed = observedRunCost(spend, j.task);
        return (
          <span key={j.task} className="fwr-estimate" data-observed={observed ? 'true' : 'false'}>
            {observed
              ? `${label}≈ ${formatCost(observed.cost)} a run, your average over ${observed.calls}`
              : `${label}No runs yet, so no average to show.`}
          </span>
        );
      })}
    </Tag>
  );
}

/**
 * The Usage card's head (AIRail canvas, "$14.20 of $40.00" and its bar): the
 * month's included allowance spent, of the allowance, from the allowance
 * ledger (D629). A failed read is Unreadable with a retry, never a $0.00 bar.
 */
export function RailAllowance({ reading }) {
  if (reading.loading) return <p className="fwr-absent">Loading…</p>;
  const month = allowanceMonth(reading.budget, reading.budgetError);
  if (!month) {
    return (
      <div data-testid="text-worker-rail-spend">
        <Unreadable
          what="Your AI allowance"
          claim="That is not a claim that nothing was spent."
          onRetry={reading.reload}
        />
      </div>
    );
  }
  const meter = month.cap > 0 ? spendMeter(month.spent, month.cap) : null;
  return (
    <>
      <div className="fwr-usage-head">
        <strong data-testid="text-worker-rail-spend">{microMoney(month.spent)}</strong>
        {month.cap > 0 && <em>{`of ${microMoney(month.cap)}`}</em>}
      </div>
      {meter && (
        <div className="fwr-meter" role="presentation">
          <i className={meter.over ? 'fwr-over' : undefined} style={{ width: `${meter.fraction * 100}%` }} />
        </div>
      )}
    </>
  );
}

/**
 * The Usage card's per-page half (D552 step 3): this page's month and this
 * page's last run. Its own component so each honest state can be rendered and
 * tested without the rail around it.
 *
 * `spend` is `/api/ai/me/spend` (the account read, known to be `recorded`);
 * `pageSpend` / `pageSpendError` are `useAiSpend`'s page read, null without
 * one. `pagePath` is the page as the router records it.
 */
export function RailPageUsage({ spend, pagePath, pageSpend, pageSpendError, onRetry }) {
  const pageRecordable = isRecordablePage(pagePath);
  // The page read, only when it answered. A report left from an earlier read
  // is not shown beside a failed one: both lines below go to Unreadable.
  const page = pageRecordable && !pageSpendError && pageSpend?.recorded === true ? pageSpend : null;
  const calls = Number(page?.month?.calls) || 0;
  return (
    <>
      {/*
        THIS PAGE (D552 step 3) — the canvas's "This page this month", from
        `/api/ai/me/spend?surface=<pagePath>`: the caller's own rows recorded
        against this page. Its honest states:
          · the read failed            → Unreadable, with a retry;
          · runs this month            → their spend;
          · none, and none ever        → "No run on this page yet";
          · none this month            → "No run on this page this month",
            never "yet", which would be a claim.
        A path the router does not record (`isRecordablePage`) is not read
        at all, and the line says so rather than showing a refused read as a
        failure.
      */}
      {!pageRecordable
        ? (
          <p className="fwr-page-spend" data-testid="text-worker-rail-page-spend">
            Runs from this page are not recorded against it.
          </p>
        )
        : !page
          ? (
            <div data-testid="text-worker-rail-page-spend">
              <Unreadable
                what="This page's spend"
                claim="That is not a claim that this page has cost nothing."
                onRetry={onRetry}
              />
            </div>
          )
          : (
            <p className="fwr-page-spend" data-testid="text-worker-rail-page-spend">
              {calls > 0
                ? <>This page this month · <b>{Number(page.month.spend_usd) >= 0.01 ? formatSpend(page.month.spend_usd) : formatCost(page.month.spend_usd)}</b></>
                : `${page.last_run_recorded === true && !page.last_run
                  ? 'No run on this page yet.'
                  : 'No run on this page this month.'}${Number(page.unattributed?.calls) > 0
                  // D404: runs with no page may include this page's.
                  ? ' Some of this month\'s runs carry no page.'
                  : ''}`}
            </p>
          )}
      {/*
        THE LASTING RECEIPT (D401), this page's: the canvas's "Last run ·
        in/out · cost", from the page read's `last_run`, in any month. A
        failed read of it is Unreadable, not "no runs"; the Worker reports
        the two apart with `last_run_recorded`. On a page whose path the
        router does not record, the account's is shown, labelled as the
        account's.
      */}
      {pageRecordable
        ? (page && (page.last_run_recorded === false
          ? (
            <div data-testid="text-worker-rail-last-run">
              <Unreadable
                what="This page's last run"
                claim="That is not a claim that it has none."
                onRetry={onRetry}
              />
            </div>
          )
          : page.last_run && (
            <p className="fwr-last-run" data-testid="text-worker-rail-last-run">
              {`Last run · ${lastRunReceipt(page.last_run, MODEL_COPY[page.last_run.model]?.name)}`}
            </p>
          )))
        : (spend.last_run_recorded === false
          ? (
            <div data-testid="text-worker-rail-last-run">
              <Unreadable
                what="Your last run"
                claim="That is not a claim that you have none."
                onRetry={onRetry}
              />
            </div>
          )
          : spend.last_run && (
            <p className="fwr-last-run" data-testid="text-worker-rail-last-run">
              {`Last run · your account, any page · ${lastRunReceipt(spend.last_run, MODEL_COPY[spend.last_run.model]?.name)}`}
            </p>
          ))}
    </>
  );
}

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
        aria-label={aiOn ? 'AI on' : 'Manual'}
        title={aiOn ? 'AI on' : 'Manual'}
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
   * The desk's own sentence for what "AI fills the blanks" does here (D424),
   * printed inside the AI card the way the canvas prints its mode note.
   */
  note,
  // Does THIS workspace have fill-the-blanks work? The surface declares the
  // capability and its copy; the host declares whether this page has any.
  // Passing it is what draws the second mode card and its switch, so the
  // switch exists exactly where flipping it changes something — which is
  // DECISIONS D17's rule, and the reason a globally-rendered toggle would
  // reintroduce the dead control D17 refused.
  fills = false,
  'data-testid': testId = 'worker-rail',
}) {
  const pathname = useRailPathname();
  // The page as the router records it: no trailing slash, the same shape
  // `normaliseSurface` stores, so the lookup below matches the rows (D404).
  const pagePath = String(pathname || '').replace(/\/+$/, '') || (pathname === '/' ? '/' : '');
  // D552 step 3 — this page's own month and last run come from a third read,
  // `?surface=<pagePath>`, made only for a path the router records.
  const { spend, pricing, pageSpend, spendError, pricingError, pageSpendError, loading, reload } = useAiSpend({ page: pagePath });
  const budgetReading = useAiBudget();
  const bodyId = `${useId()}-worker-rail-body`;

  // One preference for the whole product, not one per page. The stored value
  // is read once for the initial render so the rail does not flash open before
  // an effect closes it, and `safeReadJSON` is the repo's existing helper —
  // localStorage throws outright in some embedded contexts, and a rail is not
  // worth a blank page.
  const [collapsed, setCollapsed] = useState(() => safeReadJSON(RAIL_COLLAPSED_KEY, false) === true);

  // The HOSTS need to know, not just this element: the width that has to
  // change is a grid track on an ancestor this component does not own. A data
  // attribute on <html> is what every host stylesheet keys its
  // `--fwr-track: 44px` off, so one write moves all twenty of them.
  //
  // In an effect rather than in the toggle so that a rail mounting into an
  // already-collapsed session sets the attribute too — otherwise a reload
  // would render the spine inside a 286px track.
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

  // THE MODEL CARDS (AIRail canvas, "Model · this page"): the section's jobs
  // from `railModels.js`, each on the router's model or the founder's stored
  // pick, built by `railCards` from `/api/ai/pricing`. A pick is written per
  // section and per task, and the bands that run the task read it
  // (`ui/railModelChoice.js`). Re-read on every render, so a pick made here
  // shows at once and a pick cleared by a refusal elsewhere shows next render.
  const [, setPicks] = useState(0);
  const view = railCards(pricing, jobsFor(workspace), {
    copy: MODEL_COPY,
    chosen: (task) => readRailModel(workspace, task),
  });
  const pick = useCallback((id, tasks) => {
    for (const task of tasks) writeRailModel(workspace, task, id);
    setPicks((n) => n + 1);
  }, [workspace]);

  // D402's inherited card is gone (D698): a card and its alternates are
  // offered on every page, and the note below says how far a pick reaches —
  // a pick on a zone is the workspace's pick for that job, under the same key.

  // Shared with the page, which decides whether to offer proposals, through a
  // module store rather than a provider — see hooks/useAssistMode.js.
  const [fillsOn, setFillsOn] = useAssistMode(workspace);
  const modeChoice = surface.mode?.kind === 'choice' && fills ? surface.mode : null;
  const safetyNote = surface.desks?.[workspace]?.safety || surface.safety;

  // `recorded` false, or no report at all, are the same thing to a reader: the
  // platform cannot say what has been spent. Neither draws a bar.
  const known = !!spend?.recorded && typeof spend?.month?.spend_usd === 'number';
  // A cap the response did not carry is not a $0 cap. Null draws no "of $…"
  // and no bar, which is what an absent cap should look like — `?? 0` used to
  // stand in for it, and the meter code below only hid that by accident.
  // D629: raw usage includes paid runs. The separate allowance ledger owns its meter.

  // The accent is the LICENCE's, not the page's, and it comes from the one
  // table that already holds all four — `ACCENT` in the shell config, the same
  // source ZoneNav reads. Canvas I1 is explicit that this is not decoration:
  // "Indigo, not violet: side by side with the founder product these read as
  // two licenses, not two personas." Writing the hexes into workerRail.css
  // would be a fourth copy of them, free to drift from the pills beside it.
  //
  // Four variables, not two: an inline `--fwr-accent` would beat `.dark .fwr`
  // and pin the light accent onto the dark ground. The stylesheet picks between
  // the light and dark pair, so the cascade still decides the theme and this
  // only supplies the values.
  const accent = ACCENT[role] || ACCENT.founder;
  const accentStyle = {
    '--fwr-accent-light': accent.deep,
    '--fwr-accent-soft-light': accent.tint,
    '--fwr-accent-dark': accent.deepDark,
    '--fwr-accent-soft-dark': accent.tintDark,
  };

  // D405 — the phone form (canvas M5). See the note above `railSheetReducer`.
  const [sheet, dispatchSheet] = useReducer(railSheetReducer, { open: false });
  const sheetId = `${useId()}-worker-rail-sheet`;
  const fabRef = useRef(null);
  const sheetCloseRef = useRef(null);
  const [portalReady, setPortalReady] = useState(false);
  useEffect(() => { setPortalReady(typeof document !== 'undefined'); }, []);
  // The sheet belongs to the page it was opened on.
  useEffect(() => { dispatchSheet({ type: 'route' }); }, [pathname]);
  // Above the breakpoint the panel takes over, so an open sheet closes.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia(RAIL_DESKTOP_QUERY);
    const onChange = () => { if (mq.matches) dispatchSheet({ type: 'desktop' }); };
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  // Escape closes, on the one dialog stack (D686), so it never also closes a
  // lightbox under or over the sheet; focus moves into the sheet on open and
  // back to the button on close, as the More sheet does.
  useEscapeClose(() => dispatchSheet({ type: 'escape' }), { active: sheet.open });
  const wasOpen = useRef(false);
  useEffect(() => {
    if (sheet.open) {
      sheetCloseRef.current?.focus();
      wasOpen.current = true;
      return undefined;
    }
    if (wasOpen.current) {
      wasOpen.current = false;
      fabRef.current?.focus();
    }
    return undefined;
  }, [sheet.open]);

  const body = (
      <div className="fwr-body" id={bodyId}>
        <section className="fwr-block">
          {/* THE CANVAS'S TWO CARDS, with no heading above them: "Manual" and
              "AI fills the blanks", the second carrying its switch and the
              desk's own sentence for what the switch does here (`note`, D424).

              Where there is nothing to fill in, the Manual card is drawn alone
              and is not a control (D17): a second card there would be a
              switch that changes nothing. */}
          {!modeChoice ? (
            <div className="fwr-modes">
              <div className="fwr-mode" data-selected="false" data-testid="card-worker-rail-mode-manual">
                <b data-testid="text-worker-rail-mode">Manual</b>
                <span>{MANUAL_NOTE}</span>
              </div>
            </div>
          ) : (
            <div className="fwr-modes" role="radiogroup" aria-label={`Mode for ${workspace}`}>
              <button
                type="button"
                role="radio"
                aria-checked={!fillsOn}
                className="fwr-mode"
                data-selected={!fillsOn ? 'true' : 'false'}
                onClick={() => setFillsOn(false)}
                data-testid="button-worker-rail-mode-manual"
              >
                <b data-testid="text-worker-rail-mode">Manual</b>
                <span>{MANUAL_NOTE}</span>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={fillsOn}
                className="fwr-mode"
                data-selected={fillsOn ? 'true' : 'false'}
                onClick={() => setFillsOn(true)}
                data-testid="button-worker-rail-mode-fills"
              >
                <span className="fwr-mode-head">
                  <b>{modeChoice.label}</b>
                  <i className="fwr-switch" data-on={fillsOn ? 'true' : 'false'} aria-hidden="true" />
                </span>
                <span>{note || modeChoice.note}</span>
              </button>
            </div>
          )}
        </section>

        {/* MODEL · THIS PAGE (AIRail canvas). One card per model the
            section's work runs on, the router's model unless the founder
            moved a job that takes a pick, and the other models those jobs
            offer as compact rows. Every id and rate is the router's, over
            `/api/ai/pricing`; the sentences are `railModels.js`. A failed
            price read says so with a retry rather than vanishing (D400). */}
        {!view.cards.length && pricingError && (
          <section className="fwr-block" data-testid="worker-rail-model-unreadable">
            <span>Model · this page</span>
            <Unreadable
              what="The model price list"
              claim="Which model runs here, and at what rate, is unknown, not free."
              onRetry={reload}
            />
          </section>
        )}

        {view.cards.length > 0 && (
          <section className="fwr-block" data-testid="worker-rail-models">
            <span>Model · this page</span>
            <div className="fwr-models">
              {view.cards.map((card) => (
                <RailModelCard
                  key={card.id}
                  card={card}
                  spend={spend}
                  onPick={card.tasks.length ? () => pick(card.id, card.tasks) : null}
                />
              ))}
              {view.alternates.map((alt) => (
                <button
                  key={alt.id}
                  type="button"
                  className="fwr-model fwr-model-alt"
                  data-selected="false"
                  onClick={() => pick(alt.id, alt.tasks)}
                  data-testid={`option-worker-rail-model-${alt.id.split('/').pop()}`}
                >
                  <span className="fwr-model-head">
                    <b>{alt.name}</b>
                    <i className="fwr-model-inline">{inlineRate(alt.price)}</i>
                  </span>
                  {alt.why && <span className="fwr-model-why">{alt.why}</span>}
                </button>
              ))}
            </div>
            <p className="fwr-models-note" data-testid="text-worker-rail-model-note">
              {view.pickable
                ? `Remembered for ${workspace}. Switching changes nothing already accepted.`
                : 'The router\'s model for this work. It is not chosen here.'}
            </p>
          </section>
        )}

        {/* NO CHAT IN THIS RAIL (owner, 2026-10-10). The rail is the AIRail
            canvas (`design/incoming/AIRail.dc.html`): mode, the page's models,
            usage and the screening line, and nothing else. D652's "Ask
            Eadwyn" composer (`EadwynComposer.jsx`, from the Connectors
            canvas's `rail` screen) was mounted here on 2026-10-09 and is taken
            out again; it stays unmounted, with its Worker routes, until a
            canvas gives the chat a place of its own. The Coverage block, the
            "Read this page back" run, the "Unavailable here" notes, the
            spend-by-page list and the guardrail footer went the same day, for
            the same reason: none of them is on the canvas. */}

        {/* USAGE (AIRail canvas): the month's allowance spent, of the
            allowance, a bar, then this page's month and its last run. */}
        <section className="fwr-block" data-testid="worker-rail-usage">
          <span>Usage</span>
          <div className="fwr-usage">
            <RailAllowance reading={budgetReading} />
            {loading
              ? <p className="fwr-absent">Loading…</p>
              : known
                ? (
                  <RailPageUsage
                    spend={spend}
                    pagePath={pagePath}
                    pageSpend={pageSpend}
                    pageSpendError={pageSpendError}
                    onRetry={reload}
                  />
                )
                : (
                  // EITHER READ FAILED: the request itself (`spendError`), or
                  // the Worker answered `recorded: false` because it could not
                  // read `ai_usage_logs`. Both are Unreadable with a retry,
                  // never "Not recorded" (D400; ui/Honesty.jsx).
                  <div data-testid="text-worker-rail-page-spend">
                    <Unreadable
                      what={spendError ? 'Your AI usage' : 'The usage log'}
                      claim="That is not a claim that nothing was spent."
                      onRetry={reload}
                    />
                  </div>
                )}
          </div>
        </section>

        {/* THE SAFETY LINE the canvas puts last, in the desk's own words
            (`ASSIST_SURFACES.workspace.desks`). The chip says "Drafts only",
            not the canvas's "Screened": the runs this rail describes are not
            passed through the guard model, and a chip saying they were would
            be a claim the Worker does not make true. */}
        <div className="fwr-screened" data-testid="text-worker-rail-screened">
          <i>Drafts only</i>
          <p>{safetyNote}</p>
        </div>
      </div>
  );

  return (
    <>
    <aside
      className={`fwr ${className}`.trim()}
      aria-label={`Worker AI controls · ${workspace}`}
      data-collapsed={collapsed ? 'true' : 'false'}
      data-testid={testId}
      style={accentStyle}
    >
      <div className="fwr-title">
        <span className="fwr-title-text">Worker AI · {workspace}</span>
        {/* D406 — between the label and the toggle, because the collapsed
            title is a reversed column: the toggle draws on top, then the dot
            and the spend, then the turned label, the canvas's order. */}
        {collapsed && (
          <RailSpine aiOn={!!modeChoice && fillsOn} spendState={spineSpend({ spend, loading, spendError })} />
        )}
        <button
          type="button"
          className="fwr-toggle"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          title={collapsed ? `Show the Worker AI rail for ${workspace}` : `Collapse the Worker AI rail for ${workspace}`}
          data-testid="button-worker-rail-toggle"
        >
          {collapsed
            ? <PanelRightOpen size={14} aria-hidden="true" />
            : <PanelRightClose size={14} aria-hidden="true" />}
          <span className="fwr-sr">
            {collapsed ? 'Show the Worker AI rail' : 'Collapse the Worker AI rail'}
          </span>
        </button>
      </div>

      {!sheet.open && body}
    </aside>
    {portalReady && createPortal(
      <>
        <RailFab
          workspace={workspace}
          aiOn={!!modeChoice && fillsOn}
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
      </>,
      document.body,
    )}
    </>
  );
}
