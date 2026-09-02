import { PanelRight, ShieldCheck } from 'lucide-react';
import useAiSpend from '../hooks/useAiSpend';
import { formatSpend, spendMeter } from './assistCost';
import { EADWYN_GUARDRAIL } from './eadwynConfig';
import './founderWorkerRail.css';

/**
 * The Worker AI rail the six founder workspaces share.
 *
 * ONE RAIL, NOT TWENTY-SEVEN. Every founder page had built its own: a local
 * `WorkerRail` / `BuildRail` / `RaiseRail` / `ValidateRail` / `CadenceRail`
 * function at the bottom of the file — twenty-six of them under seventeen
 * distinct names, plus one written inline on the Research desk — each with its
 * own props and its own CSS class names. They
 * agreed on the shape by coincidence and drifted in the details, and the pages
 * that never grew one simply had no rail — which is the report this component
 * answers: "some pages doesn't have it, it does show anything, it looks blank".
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
 * NOT COLLAPSIBLE, DELIBERATELY. The canvas specifies a rail that collapses to
 * a 44px spine, and every host here is a grid item in a track fixed at 270 or
 * 286px (`grid-template-columns: minmax(0,1fr) 286px`). Narrowing the aside
 * cannot narrow the track, so a collapse would leave a 240px blank column
 * beside a spine — worse than no toggle. It needs the host grids to size that
 * track from their content, which is a layout change for the pass that also
 * brings the mode switch and the model card.
 *
 * STYLING. `className` takes the host page's own rail class — `a5-rail`,
 * `fr-pitch-rail`, `a7-rail` — so the page's grid column, border and background
 * still place it exactly where its layout expects. Everything inside is
 * `founderWorkerRail.css`, which is why the blocks look the same on all six.
 */
export default function FounderWorkerRail({
  workspace,
  className = '',
  stance,
  note,
  coverage = [],
  coverageNote,
  unavailable = [],
  action = null,
  footer = 'Read-only summary · no automated actions',
  'data-testid': testId = 'founder-worker-rail',
}) {
  const { spend, loading } = useAiSpend();

  // `recorded` false, or no report at all, are the same thing to a reader: the
  // platform cannot say what has been spent. Neither draws a bar.
  const known = !!spend?.recorded && typeof spend?.month?.spend_usd === 'number';
  const cap = spend?.month?.cap_usd ?? 0;
  const meter = spendMeter(known ? spend.month.spend_usd : 0, cap);

  return (
    <aside
      className={`fwr ${className}`.trim()}
      aria-label={`Worker AI controls · ${workspace}`}
      data-testid={testId}
    >
      <div className="fwr-title">
        <span>Worker AI · {workspace}</span>
        <PanelRight size={14} aria-hidden="true" />
      </div>

      <div className="fwr-body">
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
