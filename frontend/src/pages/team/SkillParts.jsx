import React from 'react';
import { Check, Lock } from 'lucide-react';
import { Unrecorded } from '../../ui';
import SkillRadar from '../../components/play/SkillRadar.jsx';
import { BTN_SECONDARY, MONO, MUTED } from './teamUi.jsx';
import { authorLine, outputWords, radarLines, tagChip, usedBy } from './skillsModel.js';

/**
 * D1612 (#3952, SK1, SK4, SK5) — the pieces every skill screen shares: the
 * taxonomy and tool chips, the directory card, a skill row with its pinned
 * version, and the agent's radar with "Not recorded" when it has no skills.
 */

const CHIP = 'inline-flex min-h-[22px] items-center gap-1 whitespace-nowrap rounded-axal-pill border px-2 text-[11.5px] font-semibold';

export function TaxChips({ tags }) {
  const chips = (Array.isArray(tags) ? tags : []).map(tagChip).filter(Boolean);
  if (!chips.length) return null;
  return (
    <span className="flex flex-wrap gap-1.5" data-testid="skill-tax">
      {chips.map((c) => <span key={c.text} title={c.title} className={`${CHIP} border-axal-lavender-edge bg-axal-lavender text-axal-violet-deep dark:border-violet-800 dark:bg-violet-900/30 dark:text-violet-300`}>{c.text}</span>)}
    </span>
  );
}

/** A read tool as a chip: "Mercury · read", ticked when approved, locked when its sponsor hasn't approved it. */
export function ToolChip({ tool, state }) {
  const label = tool?.label || tool?.key || 'Tool';
  const blocked = state === 'no';
  return (
    <span className={`${CHIP} ${blocked ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200' : 'border-axal-hairline bg-white text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200'}`}
      data-testid="skill-tool" data-state={state || undefined}>
      {state === 'ok' ? <Check size={12} aria-hidden="true" className="text-axal-positive dark:text-emerald-300" /> : null}
      {blocked ? <Lock size={11} aria-hidden="true" /> : null}
      {label} · read
    </span>
  );
}

export function ToolChips({ tools, stateOf }) {
  const list = Array.isArray(tools) ? tools : [];
  if (!list.length) return null;
  return <span className="flex flex-wrap gap-1.5">{list.map((t) => <ToolChip key={t.key || t.label} tool={t} state={stateOf ? stateOf(t) : null} />)}</span>;
}

/** "Used by N agents", or "Not recorded" when the read made no count. */
export function UsedBy({ n }) {
  const words = usedBy(n);
  return <span className={MUTED} data-testid="skill-used-by">Used by {words ? <b className="text-axal-ink dark:text-gray-100">{words}</b> : <Unrecorded />}</span>;
}

/** SK1: a directory card. */
export function SkillCard({ s, onOpen, onAssign, canAssign }) {
  return (
    <article className="flex min-w-0 flex-col gap-2 rounded-axal-lg border border-axal-hairline bg-white p-4 dark:border-gray-700 dark:bg-gray-900" data-testid={`skill-card-${s.uid}`}>
      <div className="flex items-start gap-2">
        <button type="button" onClick={() => onOpen(s)} className="min-w-0 flex-1 text-left text-[14.5px] font-extrabold text-axal-ink hover:underline dark:text-gray-100" data-testid={`skill-open-${s.uid}`}>{s.name}</button>
        {s.status === 'retired' ? <span className={`${CHIP} border-axal-hairline text-axal-muted dark:border-gray-700 dark:text-gray-400`}>Retired</span> : null}
        {s.status === 'draft' ? <span className={`${CHIP} border-dashed border-axal-hairline text-axal-muted dark:border-gray-600 dark:text-gray-400`}>Draft</span> : null}
        {Number.isFinite(s.version) && s.version > 0 ? <span className={MONO}>v{s.version}</span> : null}
      </div>
      {s.description ? <p className="m-0 text-[12.5px] leading-[1.45] text-axal-ink/90 dark:text-gray-300">{s.description}</p> : null}
      <span className={MUTED}>{authorLine(s)}</span>
      <TaxChips tags={s.taxonomy} />
      <ToolChips tools={s.tools} />
      {outputWords(s) ? <span className="text-[12.5px] text-axal-ink dark:text-gray-200"><b>Proposes:</b> {outputWords(s)}</span> : null}
      <div className="mt-auto flex items-center gap-2 border-t border-axal-hairline pt-2.5 dark:border-gray-800">
        <span className="min-w-0 flex-1"><UsedBy n={s.used_by} /></span>
        {canAssign && s.status === 'published'
          ? <button type="button" className={`${BTN_SECONDARY} h-8 px-3 text-[12.5px]`} onClick={() => onAssign(s)} data-testid={`skill-assign-${s.uid}`}>Assign</button>
          : <button type="button" className="text-[12.5px] font-semibold text-axal-violet-deep hover:underline dark:text-violet-300" onClick={() => onOpen(s)}>Open</button>}
      </div>
    </article>
  );
}

/** SK4, SK5: a skill in a list, with its pinned version and whatever the screen puts on the right. */
export function SkillRow({ s, version, retired, why, toolState, check, children }) {
  return (
    <div className="flex items-start gap-2.5 border-t border-axal-hairline py-2.5 dark:border-gray-800" data-testid={`skill-row-${s.uid}`}>
      {check || null}
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2">
          <b className="text-[13.5px] text-axal-ink dark:text-gray-100">{s.name}</b>
          {version != null ? <span className={`${CHIP} border-axal-hairline text-axal-ink dark:border-gray-700 dark:text-gray-200`}>v{version}</span> : null}
          {retired ? <span className={`${CHIP} border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200`}>Retired · still pinned</span> : null}
        </span>
        <ToolChips tools={s.tools} stateOf={toolState} />
        {why ? <span className="text-[12px] text-amber-800 dark:text-amber-200" data-testid="skill-why">{why}</span> : null}
      </span>
      {children}
    </div>
  );
}

/**
 * SK4, SK9b: the agent's radar, computed from its skills by the Worker (A2).
 * `vector` null draws the empty ring and "Not recorded", never zeros.
 */
export function AgentRadar({ vector, radar, height = 200, label = 'Computed from its skills.' }) {
  const lines = radarLines(radar);
  return (
    <div className="flex flex-wrap items-center gap-4" data-testid="agent-radar">
      <div className="relative w-[220px] max-w-full">
        {vector ? <SkillRadar skillVector={vector} height={height} animate={false} />
          : (
            <div className="flex items-center justify-center rounded-full border border-dashed border-axal-hairline text-[13px] text-axal-muted dark:border-gray-600 dark:text-gray-400" style={{ height }} data-testid="agent-radar-none">
              Not recorded
            </div>
          )}
      </div>
      <div className="flex flex-col gap-1.5 text-[12.5px] text-axal-ink dark:text-gray-200">
        <span>{label}</span>
        {vector ? lines.map((l) => <span key={l.label}><b>{l.label}</b> · {l.text}</span>)
          : <span className={MUTED}>This agent has no skills yet.</span>}
      </div>
    </div>
  );
}
