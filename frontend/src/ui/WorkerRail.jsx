import { useCallback, useEffect, useId, useState } from 'react';
import { PanelRightClose, PanelRightOpen, ShieldCheck } from 'lucide-react';
import useAiSpend from '../hooks/useAiSpend';
import { safeReadJSON, safeWriteJSON } from '../lib/storage';
import { formatSpend, spendMeter } from './assistCost';
import { EADWYN_GUARDRAIL } from './eadwynConfig';
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
 * IT WAS CALLED `FounderWorkerRail`. Nothing it RENDERS was ever founder-
 * specific — the title is `Worker AI · {workspace}`, the blocks are Mode,
 * Coverage, Unavailable here and Usage this month, the footer is the shared
 * `EADWYN_GUARDRAIL` — so the rename cost nothing and the name was the last
 * thing claiming the rail belonged to one licence. What IS per-licence is the
 * accent, and that now comes from `role`.
 *
 * WHAT THE FOUR BLOCKS SAY, and why they are these four. The canvas (artboard
 * A1, `Founder_Workspaces_Canvas.dc.html`) specifies a rail identical on all six
 * workspaces, docked right, collapsible to a spine, carrying mode, model, meter
 * and safety.
 *
 *   1. MODE — `Manual`, and fixed. The canvas's other mode ("Advisor fills the
 *      blanks") is not offered because nothing on these pages runs a model. A
 *      switch that changes nothing is a setting the user thinks they have made.
 *
 *   2. COVERAGE — the honest half of what the twenty-seven copies displayed:
 *      counts of rows the page has already fetched. It is the only per-page
 *      block, passed in as `coverage`, and it is where a workspace says what it
 *      is looking at. `unavailable` carries the same pages' "Unavailable here"
 *      notes, which name what is NOT connected rather than implying it is.
 *
 *   3. USAGE — real, and the one figure the old rails never had. The caller's
 *      own month-to-date spend and the cap the router enforces, from
 *      `/api/ai/me/spend`. Account-level, so it is correct on a page that runs
 *      nothing. `recorded: false` means the usage table could not be read, and
 *      the block SAYS so — an absent fact is not a zero fact, and an empty
 *      meter asserts one. (Same contract as `hooks/useAiSpend.js` states.)
 *
 *      There is deliberately NO model block. `ASSIST_SURFACES` keys a surface
 *      to an aiRouter task class, and that key decides the model and the price
 *      it reports — "getting it wrong misreports every figure on the rail". No
 *      founder workspace runs any of the router's task classes, so naming a
 *      model here would put a model on a page that never calls one.
 *
 *   4. SAFETY — `EADWYN_GUARDRAIL`, the product-wide boundary, imported rather
 *      than restated so this rail and `AssistRail` cannot say different things.
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
 * them — six founder desks and twenty-four investor surfaces.
 */
/**
 * Where the choice lives. `sidebar_collapsed` is the existing precedent for a
 * persisted desktop layout preference, and this follows its shape exactly —
 * a bare snake_case key holding a JSON boolean.
 */
const RAIL_COLLAPSED_KEY = 'worker_rail_collapsed';
/** What the host stylesheets key their collapsed track off. */
const RAIL_COLLAPSED_ATTR = 'data-worker-rail';

export default function WorkerRail({
  workspace,
  role = 'founder',
  className = '',
  stance,
  note,
  coverage = [],
  coverageNote,
  unavailable = [],
  action = null,
  footer = 'Read-only summary · no automated actions',
  'data-testid': testId = 'worker-rail',
}) {
  const { spend, loading } = useAiSpend();
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

  // `recorded` false, or no report at all, are the same thing to a reader: the
  // platform cannot say what has been spent. Neither draws a bar.
  const known = !!spend?.recorded && typeof spend?.month?.spend_usd === 'number';
  const cap = spend?.month?.cap_usd ?? 0;
  const meter = spendMeter(known ? spend.month.spend_usd : 0, cap);

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

  return (
    <aside
      className={`fwr ${className}`.trim()}
      aria-label={`Worker AI controls · ${workspace}`}
      data-collapsed={collapsed ? 'true' : 'false'}
      data-testid={testId}
      style={{
        '--fwr-accent-light': accent.deep,
        '--fwr-accent-soft-light': accent.tint,
        '--fwr-accent-dark': accent.deepDark,
        '--fwr-accent-soft-dark': accent.tintDark,
      }}
    >
      <div className="fwr-title">
        <span className="fwr-title-text">Worker AI · {workspace}</span>
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

      <div className="fwr-body" id={bodyId}>
        <section className="fwr-block">
          <span>Mode</span>
          {/* `stance` is each page's own one-line description of the manual
              mode — "Read-only source coverage", "Manual operating view" —
              kept from the rail it replaced. Every rail still opens with the
              same word, which is the parity that matters. */}
          <strong data-testid="text-worker-rail-mode">Manual{stance ? ` · ${stance}` : ''}</strong>
          {note && <p>{note}</p>}
        </section>

        <section className="fwr-block">
          <span>Coverage</span>
          {coverage.length
            ? coverage.map((line) => <strong key={line}>{line}</strong>)
            : <strong className="fwr-absent">Not recorded</strong>}
          {coverageNote && <p>{coverageNote}</p>}
          {action && <div className="fwr-action">{action}</div>}
        </section>

        {unavailable.length > 0 && (
          <section className="fwr-block fwr-muted">
            <span>Unavailable here</span>
            {unavailable.map(([title, detail]) => (
              <div key={title}><strong>{title}</strong><p>{detail}</p></div>
            ))}
          </section>
        )}

        <section className="fwr-block">
          <span>Usage this month</span>
          {loading
            ? <strong className="fwr-absent">Loading…</strong>
            : known
              ? (
                <>
                  <strong data-testid="text-worker-rail-spend">
                    {formatSpend(spend.month.spend_usd)}
                    {cap > 0 && <em> of {formatSpend(cap)}</em>}
                  </strong>
                  {cap > 0 && (
                    <div className="fwr-meter" role="presentation">
                      <i className={meter.over ? 'fwr-over' : ''} style={{ width: `${meter.fraction * 100}%` }} />
                    </div>
                  )}
                  <p>
                    {spend.month.calls
                      ? `${spend.month.calls} run${spend.month.calls === 1 ? '' : 's'} across the platform this month. Nothing on this page spends.`
                      : 'No runs recorded this month.'}
                  </p>
                </>
              )
              : (
                <>
                  <strong className="fwr-absent" data-testid="text-worker-rail-spend">Not recorded</strong>
                  <p>The usage log could not be read. That is not the same as nothing spent.</p>
                </>
              )}
        </section>

        <footer className="fwr-foot">
          <ShieldCheck size={13} />
          <div>
            <strong>{EADWYN_GUARDRAIL.title}</strong>
            <p>{EADWYN_GUARDRAIL.body}</p>
            <p className="fwr-foot-note">{footer}</p>
          </div>
        </footer>
      </div>
    </aside>
  );
}
