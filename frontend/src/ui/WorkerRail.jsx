import { useCallback, useEffect, useId, useState } from 'react';
import { PanelRightClose, PanelRightOpen, ShieldCheck } from 'lucide-react';
import useAiSpend, { modelsForTask, priceForTask } from '../hooks/useAiSpend';
import useAssistMode from '../hooks/useAssistMode';
import { api } from '../lib/api';
import { safeReadJSON, safeWriteJSON } from '../lib/storage';
import { formatCost, formatRate, formatSpend, spendMeter } from './assistCost';
import { ASSIST_SURFACES, EADWYN_GUARDRAIL, observedRunCost } from './eadwynConfig';
import { MODEL_COPY, RECOMMENDED_BY_TASK } from './railModels';
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
 *   1. MODE — `Manual`, and still fixed even now that a model CAN run here.
 *      The canvas's other mode is "AI fills the blanks", and nothing on these
 *      pages fills a blank: the one run below drafts a note the reader keeps or
 *      discards, on a click, and writes to nothing. Offering a toggle between
 *      Manual and an auto-fill that does not exist would be a setting the user
 *      thinks they have made — which is the reason this said Manual when
 *      nothing ran at all, and the reason it still does.
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
 *   3b. MODEL — and it took a route to earn it. There was deliberately no
 *      model block here for a long time, because `ASSIST_SURFACES` keys a
 *      surface to an aiRouter task class and that key decides the model and
 *      the price it reports — "getting it wrong misreports every figure on the
 *      rail" — and no workspace ran any of the router's task classes. Naming a
 *      model would have put one on a page that never called it.
 *
 *      `POST /api/ai/workspace/explain` is what changed, not this component:
 *      every workspace zone can now run `workspace_explain` over the Coverage
 *      lines beside it. The card is drawn from `priceForTask` against the
 *      router's own table, so the model and the per-million rate are the
 *      router's, never the canvas's. The card disappears if the price lookup
 *      misses, because an unpriced run is unknown rather than free.
 *
 *      AND IT IS A MENU NOW. `ROUTE[task].alternates` — the list `run()`
 *      validates a caller's pick against — reaches this component over
 *      `/api/ai/pricing`, so the rail offers exactly what the worker will
 *      accept and cannot drift from it in either direction. What is typed
 *      rather than derived is the name, the sentence and the recommendation,
 *      and those live in `railModels.js` so this file holds no editorial copy
 *      about a model at all.
 *
 *      DECISIONS D13 removed this menu, and named the condition for its
 *      return: "a caller must never be able to route a `safety` call away from
 *      the guard model". That is now structural — `safety` declares no
 *      alternates, so there is nothing to pick from — rather than a rule
 *      somebody has to remember.
 *
 *      The estimate stays the caller's OWN observed average for the task
 *      (D16), honestly absent until they have run it once, and sits BELOW the
 *      menu rather than inside a card: `/api/ai/me/spend` groups by task, not
 *      by model, so printing it under one entry would attribute an average
 *      across models to whichever is selected.
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
/**
 * The chosen model, per WORKSPACE rather than per zone.
 *
 * The Validate canvas settles this and says why in its own rail block:
 * "Inherited from Validate — Mode and model are chosen on the workspace, not
 * re-picked here." A founder picks once for Validate and every zone under it
 * follows; picking again on `/validate/hypotheses` would be four settings for
 * one decision.
 *
 * Per workspace and not global, because the trade differs: a page with four
 * summary lines does not need the model a page with forty does.
 */
const MODEL_KEY_PREFIX = 'worker_rail_model:';
const modelKeyFor = (workspace) => `${MODEL_KEY_PREFIX}${String(workspace || '').toLowerCase().trim()}`;
/** What the host stylesheets key their collapsed track off. */
const RAIL_COLLAPSED_ATTR = 'data-worker-rail';

/**
 * The one ASSIST_SURFACES key every workspace zone shares, on all four
 * licences. One surface rather than one per bucket because the task is the
 * same everywhere — read back the lines the page is already showing — and
 * `/api/ai/me/spend` groups by task, so twenty surfaces over one task class
 * would report the same average twenty times and call it per-page data.
 */
const WORKSPACE_SURFACE = 'workspace';

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
  // Does THIS workspace have fill-the-blanks work? The surface declares the
  // capability and its copy; the host declares whether this page has any.
  // Passing it is what draws the second mode card and its switch, so the
  // switch exists exactly where flipping it changes something — which is
  // DECISIONS D17's rule, and the reason a globally-rendered toggle would
  // reintroduce the dead control D17 refused.
  fills = false,
  footer = 'Read-only summary · no automated actions',
  'data-testid': testId = 'worker-rail',
}) {
  const { spend, pricing, loading } = useAiSpend();
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

  // The model card, from the router's table rather than from anything typed
  // here. `priceForTask` returns null when either lookup misses, and the card
  // is then absent — an unpriced run is unknown, not free.
  const surface = ASSIST_SURFACES[WORKSPACE_SURFACE];
  const priced = priceForTask(pricing, surface.task);
  const observed = observedRunCost(spend, surface.task);
  // The menu, built from the ROUTER's `alternates` and joined to the copy in
  // `railModels.js`. Empty until `/api/ai/pricing` answers, and empty forever
  // for a task that offers no choice — in which case the block below falls
  // back to the single `priced` card it has always drawn.
  const models = modelsForTask(pricing, surface.task, {
    copy: MODEL_COPY,
    recommended: RECOMMENDED_BY_TASK[surface.task] || [],
  });

  // The founder's choice, read once for the first render so the menu does not
  // flash the default before an effect corrects it. `safeReadJSON` because
  // localStorage throws outright in some embedded contexts and a rail is not
  // worth a blank page.
  const [chosen, setChosen] = useState(() => safeReadJSON(modelKeyFor(workspace), null));
  const chooseModel = useCallback((id) => {
    setChosen(id);
    safeWriteJSON(modelKeyFor(workspace), id);
  }, [workspace]);
  // A stored id the router no longer offers is not a selection. Falling back to
  // the primary — `models[0]`, which `alternates` puts first — means the menu
  // renders something selected rather than nothing, and the run that follows
  // is one the worker will accept.
  const activeModel = models.some((m) => m.id === chosen) ? chosen : (models[0]?.id ?? null);

  // Shared with the page, which decides whether to offer proposals, through a
  // module store rather than a provider — see hooks/useAssistMode.js.
  const [fillsOn, setFillsOn] = useAssistMode(workspace);
  const modeChoice = surface.mode?.kind === 'choice' && fills ? surface.mode : null;

  const [run, setRun] = useState({ state: 'idle', text: '', note: '', usage: null });
  const canRun = coverage.length > 0;
  const readBack = useCallback(async () => {
    setRun({ state: 'running', text: '', note: '', usage: null });
    try {
      const r = await api.aiWorkspaceExplain({
        workspace, zone: stance || '', coverage, model: activeModel || undefined,
      });
      setRun({ state: 'done', text: r?.text || '', note: '', usage: r?.usage || null });
    } catch (e) {
      // A refusal is not a crash and must not read as one: the router returns
      // a reason and a message for a spent budget or an unreachable model, and
      // the rail shows that sentence rather than "something went wrong".
      //
      // `model_not_offered` is the one refusal the rail can act on rather than
      // only report: the saved choice is the problem, so it goes. Leaving it
      // would have every subsequent click fail the same way with no way out
      // short of clearing site data.
      if (e?.body?.refusal === 'model_not_offered') {
        setChosen(null);
        safeWriteJSON(modelKeyFor(workspace), null);
      }
      setRun({
        state: 'failed',
        text: '',
        note: e?.body?.message || e?.message || 'The model could not be reached. Nothing was run.',
        usage: null,
      });
    }
  }, [workspace, stance, coverage, activeModel]);

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
              same word, which is the parity that matters.

              Where there is nothing to fill in, this stays exactly what it
              has always been: one line, no card, no switch. */}
          {!modeChoice ? (
            <>
              <strong data-testid="text-worker-rail-mode">Manual{stance ? ` · ${stance}` : ''}</strong>
              {note && <p>{note}</p>}
            </>
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
                <b data-testid="text-worker-rail-mode">Manual{stance ? ` · ${stance}` : ''}</b>
                <span>{modeChoice.manualNote}</span>
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
                <b>{modeChoice.label}</b>
                <span>{modeChoice.note}</span>
              </button>
            </div>
          )}
          {note && modeChoice && <p>{note}</p>}
        </section>

        <section className="fwr-block">
          <span>Coverage</span>
          {coverage.length
            ? coverage.map((line) => <strong key={line}>{line}</strong>)
            : <strong className="fwr-absent">Not recorded</strong>}
          {coverageNote && <p>{coverageNote}</p>}
          {action && <div className="fwr-action">{action}</div>}
        </section>

        {/*
          The model block. Absent when the price lookup misses — an unpriced
          run is unknown, not free — so this block cannot render a model
          without a rate beside it.

          WHERE THE PARTS COME FROM, because they come from three places and
          mixing them up is how the old card came to quote a wrong rate for
          months. The MENU and every id and price in it are the router's, over
          `/api/ai/pricing`. The name, the sentence and the tags are editorial
          and live in `railModels.js`. The ESTIMATE is neither: it is this
          caller's own measured average, and it is deliberately NOT inside a
          model's card — `/api/ai/me/spend` groups by task, not by model, so
          printing it under one entry would attribute an average across models
          to whichever one happens to be selected. It sits under the menu,
          labelled for what it is.
        */}
        {priced && (
          <section className="fwr-block">
            <span>Model · this page</span>
            {surface.modeNote && <p className="fwr-mode-note">{surface.modeNote}</p>}

            {models.length > 1 ? (
              <>
                {/* Real radios, visually hidden behind the cards. A group of
                    buttons would need arrow-key handling and an aria-checked
                    dance to reach what a fieldset of radios gives for free. */}
                <fieldset className="fwr-models">
                  <legend className="fwr-sr">{`Model for ${workspace}`}</legend>
                  {models.map((m) => (
                    <label
                      key={m.id}
                      className="fwr-model"
                      data-selected={m.id === activeModel ? 'true' : 'false'}
                      data-testid={`option-worker-rail-model-${m.id.split('/').pop()}`}
                    >
                      <input
                        type="radio"
                        className="fwr-sr"
                        name={`fwr-model-${bodyId}`}
                        value={m.id}
                        checked={m.id === activeModel}
                        onChange={() => chooseModel(m.id)}
                      />
                      <span className="fwr-model-head">
                        <b>{m.name}</b>
                        {m.recommended && <i className="fwr-badge">RECOMMENDED</i>}
                        {!m.recommended && (
                          <i className="fwr-model-inline">
                            {`${formatRate(m.pin)} / ${formatRate(m.pout)}`}
                          </i>
                        )}
                      </span>
                      {/* Id, tags and the full rate line only for a
                          recommended entry — the canvas gates all three on the
                          same `recommended` flag, so the fuller treatment is
                          what marks it out rather than the badge alone. */}
                      {m.recommended && <span className="fwr-model-id">{m.id}</span>}
                      {m.why && <span className="fwr-model-why">{m.why}</span>}
                      {m.recommended && m.tags.length > 0 && (
                        <span className="fwr-tags">
                          {m.tags.map((t) => <i key={t}>{t}</i>)}
                        </span>
                      )}
                      {m.recommended && (
                        <span className="fwr-model-rate">
                          {`${formatRate(m.pin)} / M in · ${formatRate(m.pout)} / M out`}
                        </span>
                      )}
                    </label>
                  ))}
                </fieldset>
                <p data-testid="text-worker-rail-model-note">
                  {`Remembered for ${workspace}. Every zone here uses it.`}
                </p>
              </>
            ) : (
              <>
                <strong data-testid="text-worker-rail-model">{priced.model.split('/').pop()}</strong>
                <p className="fwr-model-id">{priced.model}</p>
                <p>{`${formatRate(priced.pin)} / M in · ${formatRate(priced.pout)} / M out`}</p>
              </>
            )}

            {/* Measured, never modelled (DECISIONS D16). Absent until they
                have run it once, because a number nobody measured is worth
                less than saying so. */}
            <p className="fwr-estimate">
              {observed
                ? `Your runs of this have averaged ${formatCost(observed.cost)}, over ${observed.calls}.`
                : 'No runs of this yet, so there is no average to show.'}
            </p>
            <div className="fwr-action">
              <button
                type="button"
                className="fwr-run"
                onClick={readBack}
                disabled={!canRun || run.state === 'running'}
                data-testid="button-worker-rail-run"
              >
                {run.state === 'running' ? 'Reading…' : 'Read this page back'}
              </button>
            </div>
            {!canRun && (
              <p className="fwr-absent">
                Nothing to read back yet — this page has not loaded a summary.
              </p>
            )}
            {run.state === 'done' && (run.text
              ? (
                <div className="fwr-draft" data-testid="text-worker-rail-draft">
                  <p>{run.text}</p>
                  {/*
                    The receipt, and it is a receipt for THIS run rather than a
                    stored "last run". The canvas draws a persistent one —
                    model, tokens in and out, and a cost, for the most recent
                    run — and nothing serves it: `/api/ai/me/spend` groups by
                    task and returns totals, not the latest row. So this says
                    what the click just did and disappears with the page, which
                    is true, rather than claiming a history it does not have.

                    `formatCost` and not `formatSpend`: a read-back costs
                    fractions of a cent, and two decimal places round that to
                    zero, which reads as free.
                  */}
                  {run.usage && (
                    <p className="fwr-foot-note" data-testid="text-worker-rail-receipt">
                      {MODEL_COPY[run.usage.model]?.name || run.usage.model.split('/').pop()}
                      {typeof run.usage.prompt_tokens === 'number'
                        && typeof run.usage.completion_tokens === 'number'
                        ? ` · ${run.usage.prompt_tokens.toLocaleString()} in / ${run.usage.completion_tokens.toLocaleString()} out`
                        : ''}
                      {' · '}{formatCost(run.usage.est_cost_usd)}
                      {run.usage.cached ? ' · cached' : ''}
                      {/* Named, because it means the answer above is not from
                          the model the founder picked. */}
                      {run.usage.fallback_used ? ' · the model was busy, a smaller one answered' : ''}
                    </p>
                  )}
                </div>
              )
              : <p className="fwr-absent">The model returned nothing. Nothing was kept.</p>
            )}
            {run.state === 'failed' && <p className="fwr-absent">{run.note}</p>}
          </section>
        )}

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

        {/*
          The safety row the canvas puts last. It is not the guardrail below it
          and must not be folded into it: the guardrail is the product-wide
          boundary on what Eadwyn will ever do, this is what happens to THIS
          page's text. `ASSIST_SURFACES.workspace.footer` has carried the
          sentence since the surface was registered and nothing on this rail
          read it.
        */}
        {surface.footer?.kind === 'screened' && (
          <div className="fwr-screened" data-testid="text-worker-rail-screened">
            <i>Screened</i>
            <p>{surface.footer.note}</p>
          </div>
        )}

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
