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
 * the left nav is a separate element (SidebarNav). See DECISIONS.md T3.
 *
 * What varies across the eight is entirely config; what is identical is this
 * skeleton: header row, the 10px/800 uppercase section labels, hairline cards,
 * the mode toggle, the model card, the assist block, the spend meter and the
 * trust footer.
 *
 *   <AssistRail
 *     config={forgeConfig(tier)}
 *     page="deals"
 *     mode={mode} onModeChange={setMode}
 *     modelId={modelId} onSelectModel={setModelId}
 *   />
 *
 * DELIBERATELY PRESENTATIONAL. The canvases draw the toggle permanently ON and
 * wire nothing; there is no `forge` AI Gateway yet (Phase 4), so mode and model
 * are controlled props. The "Remembered per page" promise needs a real
 * `useAssistMode(pageKey)` hook with persistence — that lands with the gateway,
 * not before, so this component does not pretend to remember anything.
 *
 * The `guardrail` slot is ForgeRail's alone: it carries the product's hard
 * boundary — Forge never sends, signs or voids; every outbound action is a
 * human click. Passing it renders the red card.
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
  modelId,
  onSelectModel,
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

  const models = pc.models ?? (pc.model ? [pc.model] : []);
  const selected = models.find((m) => m.id === modelId) ?? models[0];
  const showModelMenu = config.mode.model === 'menu' && !isInherited && models.length > 1;

  // One arithmetic for the estimate and the receipt — see assistCost.js.
  const estimate = pc.assists?.length ? batchCost(pc.run, pc.assists) : runCost(pc.run);

  // Account-wide spend: explicit total, else the sum of every page's spend.
  const spent = config.totalSpend
    ?? Object.values(config.pages ?? {}).reduce((s, p) => s + (p.spend ?? 0), 0);
  const meter = spendMeter(spent, config.planCap);

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

      {selected && (
        <Card>
          <SectionLabel tone="faint">{isInherited ? 'Model · inherited' : 'Model'}</SectionLabel>
          <div className="text-sm font-semibold mt-1">{selected.name}</div>
          <div className="font-mono tabular-nums text-[11px] text-axal-faint dark:text-gray-500 mt-0.5 break-all">
            {selected.id}
          </div>
          {showModelMenu && (
            <select
              aria-label="Model"
              value={selected.id}
              onChange={(e) => onSelectModel?.(e.target.value)}
              className="mt-2 w-full text-xs border border-axal-hairline dark:border-gray-700 rounded-axal-xs px-2 py-1 bg-transparent"
            >
              {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          )}
        </Card>
      )}

      <Card>
        <SectionLabel tone="faint">{pc.assistLabel || 'Estimated cost'}</SectionLabel>
        <div className="flex items-baseline justify-between mt-1">
          <span className="text-xs text-axal-muted dark:text-gray-400">{pc.run.unit}</span>
          <span className="font-mono tabular-nums text-sm font-extrabold">{formatCost(estimate)}</span>
        </div>
        {lastRun != null && (
          <div className="flex items-baseline justify-between mt-1 pt-1 border-t border-axal-hairline dark:border-gray-700">
            <span className="text-xs text-axal-muted dark:text-gray-400">Last run · {pc.run.label}</span>
            <span className="font-mono tabular-nums text-xs">{formatCost(lastRun)}</span>
          </div>
        )}
      </Card>

      <Card>
        <div className="flex items-baseline justify-between">
          <SectionLabel tone="faint">This month</SectionLabel>
          <span className="font-mono tabular-nums text-xs">
            {formatSpend(spent)} <span className="text-axal-faint">/ {formatSpend(config.planCap)}</span>
          </span>
        </div>
        <div className="h-[5px] rounded-axal-pill bg-axal-hairline dark:bg-gray-700 mt-2 overflow-hidden">
          <div
            className={`h-full ${meter.over ? 'bg-red-500' : accent.fill}`}
            style={{ width: `${meter.fraction * 100}%` }}
          />
        </div>
        {meter.over && <div className="text-[11px] text-red-700 dark:text-red-400 mt-1">Over plan cap</div>}
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
