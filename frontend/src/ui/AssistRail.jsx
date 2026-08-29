import React from 'react';
import SectionLabel from './SectionLabel';
import Pill from './Pill';
import { formatCost, formatSpend, runCost, batchCost, spendMeter } from './assistCost';

/**
 * AssistRail — the right-hand AI control rail, one component for eight canvases.
 *
 * The integration plan called this "RailNav" and grouped it with navigation.
 * It is not navigation: AIRail, InvRail, AdminRail, AdvRail, PartnerRail,
 * DetailRail, EmberRail and ForgeRail contain **zero route links** between
 * them. They are the AI control surface — mode, model, spend, guardrails — and
 * the left nav is a separate element (SidebarNav). See documentation/architecture/DECISIONS.md T3.
 *
 * What varies across the eight is entirely config; what is identical is this
 * skeleton: header row, the 10px/800 uppercase section labels, hairline cards,
 * the mode toggle, the model card, the assist block, the spend meter and the
 * trust footer.
 *
 *   <AssistRail
 *     config={eadwynConfig(tier)}
 *     page="deals"
 *     mode={mode} onModeChange={setMode}
 *     lastRun={spend?.last_run}
 *   />
 *
 * PRESENTATIONAL, but not for the reason first recorded here. This header used
 * to say "there is no `eadwyn` AI Gateway yet (Phase 4)". That was false, and
 * false in the way a name makes easy: nothing in the tree is called `eadwyn`,
 * so the gateway looked absent. `cloudflare-worker/src/services/aiRouter.ts` is
 * it — sixteen task classes across Workers AI models, a fallback chain, a
 * llama-guard safety pass, content-hash caching, per-user $/day and $/month KV
 * caps, an org kill switch, and a row in `ai_usage_logs` for every call.
 *
 * What is actually missing is narrower, and it is what keeps these props as
 * props:
 *   - `totalSpend` / `planCap` now HAVE a live source (`api.myAiSpend()`, over
 *     the caller's own `ai_usage_logs` rows). A caller that passes them by hand
 *     is quoting itself.
 *   - the mode TOGGLE is not rendered, and this is a decision rather than a
 *     gap. `eadwynConfig` declares every surface `kind: 'fixed'`, because no
 *     page branches on an assist mode: turning it "off" would change nothing
 *     it does. Shipping the switch with a `useAssistMode(pageKey)` behind it
 *     would persist a preference nothing reads — the same objection that
 *     removed the model menu (D13), one control over. The switch is still
 *     supported for a surface that ever grows real manual behaviour: declare
 *     `kind: 'choice'` and pass `mode`/`onModeChange`. See DECISIONS D17.
 *   - the model MENU is gone. aiRouter's ROUTE map picks the model from the
 *     TASK CLASS — llama-guard for safety, bge for embeddings, qwen-coder for
 *     tool calls — so a picker could only offer wrong answers or duplicate the
 *     right one. Removed rather than disabled: a control that cannot change
 *     anything reads as a setting the user has already made. The card now
 *     reports the model that actually RAN when a run is known, because the
 *     router may have degraded down its fallback chain. See documentation/architecture/DECISIONS.md D13.
 *
 * The `guardrail` slot is ForgeRail's alone: it carries the product's hard
 * boundary — Eadwyn never sends, signs or voids; every outbound action is a
 * human click. Passing it renders the red card. (D3 resolved the AI's name as
 * "Eadwyn"; ForgeRail is the source canvas's own filename and is unchanged.)
 */

const ACCENTS = {
  violet:  { fill: 'bg-axal-violet',      text: 'text-axal-violet',      tint: 'bg-axal-lavender' },
  indigo:  { fill: 'bg-indigo-600',       text: 'text-indigo-700',       tint: 'bg-indigo-50' },
  emerald: { fill: 'bg-emerald-600',      text: 'text-emerald-700',      tint: 'bg-emerald-50' },
  amber:   { fill: 'bg-amber-500',        text: 'text-axal-amber-deep',  tint: 'bg-amber-50' },
  slate:   { fill: 'bg-slate-600',        text: 'text-slate-700',        tint: 'bg-slate-50' },
  oxblood: { fill: 'bg-red-800',          text: 'text-red-800',          tint: 'bg-red-50' },
};

const Card = ({ children, className = '' }) => (
  <div className={`border border-axal-hairline dark:border-gray-700 rounded-axal-sm p-3 ${className}`}>
    {children}
  </div>
);

export default function AssistRail({
  config,
  page,
  mode,
  onModeChange,
  lastRun,
  className = '',
  'data-testid': testId,
}) {
  if (!config) return null;
  const pageKey = page && config.pages?.[page] ? page : config.defaultPage;
  const pc = config.pages?.[pageKey];
  if (!pc) return null;

  const accent = typeof config.accent === 'string'
    ? (ACCENTS[config.accent] ?? ACCENTS.violet)
    : { ...ACCENTS.violet, ...config.accent };

  // Honour what the config DECLARES rather than inferring from array length —
  // the two can disagree, and the config is the spec.
  //   kind 'choice'    → the user toggles the mode; the switch renders.
  //   kind 'fixed'     → the mode is the surface's, not the user's; no switch.
  //   kind 'inherited' → the parent workspace decides; no switch, and no model
  //                      menu either, because choosing here would be a lie
  //                      ("Change the model there and this page follows").
  const isInherited = config.mode.kind === 'inherited';
  const showToggle = config.mode.kind === 'choice';
  const modeOn = showToggle ? (mode ?? true) : true;

  // NO MENU. `aiRouter` selects the model from the TASK CLASS — llama-guard for
  // safety, bge for embeddings, qwen-coder for tool calls — so a picker here
  // could only offer wrong answers or duplicate the right one. It was removed
  // rather than disabled: a control that cannot change anything is worse than
  // no control, because it reads as a setting the user has already made.
  //
  // What the card shows instead is what ACTUALLY RAN, when that is known.
  // `config` states the model the router routes this page's task to; a real run
  // may have degraded down the fallback chain, and `run.fallback_used` says so.
  // Showing the configured name over a run that used a smaller sibling would
  // misreport the thing the card exists to report.
  const run = typeof lastRun === 'object' && lastRun !== null ? lastRun : null;
  const runCostUsd = run ? run.cost_usd : (typeof lastRun === 'number' ? lastRun : null);
  const routed = pc.model ?? null;
  const shown = run?.model
    ? { id: run.model, name: run.model, fromRun: true, fallback: !!run.fallback_used }
    : (routed ? { ...routed, fromRun: false, fallback: false } : null);

  // What a run costs, in order of how much it is worth believing:
  //   1. `pc.observed` — the caller's own average for this task class, from
  //      ai_usage_logs. A real number about real runs.
  //   2. a modelled figure from token counts, for a caller that supplies them.
  //   3. NOTHING. Not zero.
  //
  // The third case is why this is not a plain `runCost(pc.run)`. eadwynConfig
  // deliberately sets tin/tout to 0 because nothing knows how many tokens a
  // deck review takes before it takes them, and runCost() of zero tokens is
  // 0 — which would render "$0.0000" as though the run were free. An
  // unmeasured cost is unknown, and the rail says so.
  const modelled = pc.assists?.length ? batchCost(pc.run, pc.assists) : runCost(pc.run);
  const estimate = pc.observed?.cost ?? (modelled > 0 ? modelled : null);

  // Account-wide spend: explicit total, else the sum of every page's spend.
  // `null` here means the usage table could not be read — NOT that nothing was
  // spent. Drawing an empty bar from it would assert a fact the platform does
  // not have, so the meter is replaced by a line saying so.
  const spent = config.totalSpend
    ?? Object.values(config.pages ?? {}).reduce((s, p) => s + (p.spend ?? 0), 0);
  const spendKnown = typeof spent === 'number' && Number.isFinite(spent);
  const meter = spendMeter(spendKnown ? spent : 0, config.planCap);

  return (
    <aside
      data-testid={testId || 'assist-rail'}
      aria-label={`${config.product} controls`}
      className={`w-[280px] flex-none flex flex-col gap-3 text-axal-ink dark:text-gray-100 ${className}`}
    >
      <div className="flex items-center justify-between">
        <SectionLabel tone="violet">{config.product}</SectionLabel>
        {config.mode.badge && <Pill tone="info">{config.mode.badge}</Pill>}
      </div>

      {config.inheritedFrom && (
        <div className="border border-dashed border-axal-hairline dark:border-gray-700 rounded-axal-sm p-3 text-xs text-axal-muted dark:text-gray-400">
          Inherited from <span className="font-semibold text-axal-ink dark:text-gray-100">{config.inheritedFrom}</span>.
          Change the model there and this page follows.
        </div>
      )}

      <Card>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">{config.mode.label}</div>
            <div className="text-xs text-axal-muted dark:text-gray-400 mt-0.5">{pc.modeNote}</div>
          </div>
          {showToggle && (
            <button
              type="button"
              role="switch"
              aria-checked={modeOn}
              aria-label={`${config.mode.label} — ${modeOn ? 'on' : 'off'}`}
              onClick={() => onModeChange?.(!modeOn)}
              className={`w-6 h-3.5 rounded-axal-pill flex-none transition-colors ${modeOn ? accent.fill : 'bg-axal-hairline dark:bg-gray-700'}`}
            >
              <span className={`block w-2.5 h-2.5 m-0.5 rounded-full bg-white transition-transform ${modeOn ? 'translate-x-2.5' : ''}`} />
            </button>
          )}
        </div>
        {!modeOn && pc.manualNote && (
          <div className="text-xs text-axal-muted dark:text-gray-400 mt-2">{pc.manualNote}</div>
        )}
      </Card>

      {config.guardrail && (
        <div className="border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 rounded-axal-sm p-3">
          <div className="text-xs font-extrabold text-red-800 dark:text-red-300">{config.guardrail.title}</div>
          <div className="text-xs text-red-800/80 dark:text-red-300/80 mt-1">{config.guardrail.body}</div>
        </div>
      )}

      {shown && (
        <Card>
          <SectionLabel tone="faint">
            {shown.fromRun ? 'Model · last run' : (isInherited ? 'Model · inherited' : 'Model · routed by task')}
          </SectionLabel>
          <div className="text-sm font-semibold mt-1">{shown.name}</div>
          {shown.id !== shown.name && (
            <div className="font-mono tabular-nums text-[11px] text-axal-faint dark:text-gray-500 mt-0.5 break-all">
              {shown.id}
            </div>
          )}
          {shown.fallback && (
            <div className="text-[11px] text-axal-amber-deep dark:text-amber-400 mt-1">
              Fell back to a smaller model on this run.
            </div>
          )}
        </Card>
      )}

      <Card>
        <SectionLabel tone="faint">{pc.assistLabel || 'Estimated cost'}</SectionLabel>
        <div className="flex items-baseline justify-between mt-1">
          <span className="text-xs text-axal-muted dark:text-gray-400">{pc.run.unit}</span>
          {estimate == null
            ? <span className="text-xs text-axal-faint dark:text-gray-500">Not recorded</span>
            : <span className="font-mono tabular-nums text-sm font-extrabold">{formatCost(estimate)}</span>}
        </div>
        {runCostUsd != null && (
          <div className="flex items-baseline justify-between mt-1 pt-1 border-t border-axal-hairline dark:border-gray-700">
            <span className="text-xs text-axal-muted dark:text-gray-400">
              Last run · {run?.task || pc.run.label}{run?.cached ? ' · cached' : ''}
            </span>
            <span className="font-mono tabular-nums text-xs">{formatCost(runCostUsd)}</span>
          </div>
        )}
      </Card>

      <Card>
        <div className="flex items-baseline justify-between">
          <SectionLabel tone="faint">This month</SectionLabel>
          <span className="font-mono tabular-nums text-xs">
            {spendKnown
              ? <>{formatSpend(spent)} <span className="text-axal-faint">/ {formatSpend(config.planCap)}</span></>
              : <span className="text-axal-faint">Not recorded</span>}
          </span>
        </div>
        {spendKnown && (
          <div className="h-[5px] rounded-axal-pill bg-axal-hairline dark:bg-gray-700 mt-2 overflow-hidden">
            <div
              className={`h-full ${meter.over ? 'bg-red-500' : accent.fill}`}
              style={{ width: `${meter.fraction * 100}%` }}
            />
          </div>
        )}
        {spendKnown && meter.over && <div className="text-[11px] text-red-700 dark:text-red-400 mt-1">Over plan cap</div>}
        {config.margin && (
          <div className="flex items-baseline justify-between mt-2 text-[11px] text-axal-muted dark:text-gray-400">
            <span>Axal VC margin</span>
            <span className="font-mono tabular-nums">{config.margin.pct}%</span>
          </div>
        )}
      </Card>

      <div className="flex items-center gap-2 pt-1 border-t border-axal-hairline dark:border-gray-700 text-[11px] text-axal-muted dark:text-gray-400">
        {pc.footer?.kind === 'screened'
          ? <><Pill tone="ok" dot>Screened</Pill><span className="truncate">{pc.footer.note}</span></>
          : <><Pill tone="neutral">{pc.footer?.chip}</Pill><span className="truncate">{pc.footer?.note}</span></>}
      </div>

      {config.showRememberedNote && (
        <div className="text-[11px] text-axal-faint dark:text-gray-500">
          Remembered per page. Switching changes nothing already accepted.
        </div>
      )}
    </aside>
  );
}
