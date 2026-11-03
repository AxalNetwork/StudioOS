import React from 'react';
import { Sparkles } from 'lucide-react';
import { AgentPill } from './AgentMark.jsx';
import { AREA_LABEL, NOT_RECORDED, RISK_WORDS, avatarAlt, initialsOf, pronouns, topValueChips } from './personaModel.js';

/**
 * D4119 (#4119, AG1) — the agent card, in three sizes, used everywhere an
 * agent appears (Team, pickers, timelines, the Calendar and Work):
 *
 *   full     the gallery and the profile header: portrait, name, the AI agent
 *            pill, tagline, the top 3 values as chips, the risk scale and the
 *            natural fit; "On your team" when the persona already works here.
 *   compact  a row in a list: portrait, name, pill, tagline, the top 3 chips.
 *   chip     inline: a small portrait and the name, with the spark.
 *
 * THE PORTRAIT (R2, #4118). The 16 pixel-art portraits are not attached yet,
 * so the card draws the agent mark (a rounded square, never a circle: an
 * agent is never drawn as a person, D1497) with the persona's initials, and
 * its alt text says the portrait is not added yet ("[Name], [tagline]").
 *
 * No job title, philosophy or Schwartz value is drawn (D4117).
 */

const SQ = 'relative inline-flex shrink-0 items-center justify-center border border-axal-lavender-edge bg-axal-lavender font-mono font-bold text-axal-violet-deep dark:border-violet-700/60 dark:bg-violet-900/30 dark:text-violet-300';

/** The persona's portrait; until R2, the agent mark with initials. */
export function AgentAvatar({ persona, size = 40 }) {
  const r = Math.max(6, Math.round(size * 0.28));
  return (
    <span className={SQ} style={{ width: size, height: size, borderRadius: r, fontSize: Math.max(9, Math.round(size * 0.32)) }}
      role="img" aria-label={avatarAlt(persona)} data-testid="agent-avatar" data-shape="square">
      <span aria-hidden="true">{initialsOf(persona?.name)}</span>
      {size >= 28 ? (
        <span aria-hidden="true" className="absolute -bottom-1 -right-1 inline-flex items-center justify-center rounded-full border border-white bg-axal-violet text-white dark:border-gray-900"
          style={{ width: Math.round(size * 0.38), height: Math.round(size * 0.38) }}>
          <Sparkles size={Math.max(8, Math.round(size * 0.22))} />
        </span>
      ) : null}
    </span>
  );
}

/** The risk scale on one line: Cautious ··· Bold, the persona's point marked. */
export function RiskScale({ risk }) {
  const r = Number(risk);
  const known = RISK_WORDS[r] != null;
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-axal-muted dark:text-gray-400" data-testid="agent-risk"
      role="img" aria-label={known ? `Risk: ${RISK_WORDS[r]}, ${r} of 5` : `Risk: ${NOT_RECORDED}`}>
      <span aria-hidden="true">Cautious</span>
      <span aria-hidden="true" className="inline-flex items-center gap-[3px]">
        {[1, 2, 3, 4, 5].map((i) => (
          <span key={i} className={`inline-block rounded-full ${known && i === r ? 'h-2 w-2 bg-axal-violet dark:bg-violet-400' : 'h-1 w-1 bg-axal-hairline dark:bg-gray-600'}`} />
        ))}
      </span>
      <span aria-hidden="true">Bold</span>
      {!known ? <span>· {NOT_RECORDED}</span> : null}
    </span>
  );
}

export function ValueChips({ persona, legend }) {
  const chips = topValueChips(persona, legend);
  if (!chips.length) return <span className="text-[11.5px] text-axal-muted dark:text-gray-400">{NOT_RECORDED}</span>;
  return (
    <span className="flex flex-wrap gap-1" data-testid="agent-values-chips">
      {chips.map((c) => (
        <span key={c.key} className="rounded-axal-pill border border-axal-lavender-edge bg-axal-lavender px-2 py-0.5 text-[11px] font-semibold text-axal-violet-deep dark:border-violet-700/60 dark:bg-violet-900/30 dark:text-violet-300">{c.label}</span>
      ))}
    </span>
  );
}

export const ON_TEAM = 'On your team';
export const CHOSEN = 'Chosen';
const EYE = 'font-mono text-[10px] font-semibold uppercase tracking-[.11em] text-axal-muted dark:text-gray-400';

export default function AgentCard({ persona, legend, size = 'full', onTeam = false, selected = false, footer = null, actions = null, testId, sub }) {
  const name = String(persona?.name || '').trim() || 'Unnamed agent';
  const tagline = String(persona?.tagline || '').trim();
  if (size === 'chip') {
    return (
      <span className="inline-flex min-w-0 items-center gap-1.5 align-middle" data-testid={testId || 'agent-card-chip'}>
        <AgentAvatar persona={persona} size={20} />
        <b className="truncate text-[12.5px] font-bold text-axal-ink dark:text-gray-100">{name}</b>
        <Sparkles size={11} aria-hidden="true" className="shrink-0 text-axal-violet dark:text-violet-300" />
        <span className="sr-only">AI agent</span>
      </span>
    );
  }
  if (size === 'compact') {
    return (
      <span className="flex min-w-0 items-center gap-2.5" data-testid={testId || 'agent-card-compact'}>
        <AgentAvatar persona={persona} size={36} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5"><b className="truncate text-[13.5px] font-extrabold text-axal-ink dark:text-gray-100">{name}</b><AgentPill /></span>
          {sub || tagline ? <span className="block truncate text-[12px] text-axal-muted dark:text-gray-400">{sub || tagline}</span> : null}
        </span>
        {onTeam ? <span className="shrink-0 rounded-axal-pill bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">{`\u2713 ${ON_TEAM}`}</span> : null}
      </span>
    );
  }
  const fit = Array.isArray(persona?.natural_fit) ? persona.natural_fit.filter((a) => AREA_LABEL[a]) : [];
  return (
    <article aria-label={`${name}, AI agent${selected ? ', chosen' : ''}`}
      className={`flex flex-col gap-2.5 rounded-axal-md border p-3.5 ${selected ? 'border-2 border-axal-violet bg-axal-lavender/50 dark:border-violet-500 dark:bg-violet-900/20' : 'border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900'}`}
      data-testid={testId || 'agent-card'} data-on-team={onTeam ? 'true' : undefined} data-selected={selected ? 'true' : undefined}>
      <div className="flex items-start gap-3">
        <AgentAvatar persona={persona} size={56} />
        <div className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5"><b className="text-[15.5px] font-extrabold text-axal-ink dark:text-gray-100">{name}</b><AgentPill /></span>
          {pronouns(persona) ? <span className="block text-[11.5px] text-axal-muted dark:text-gray-400">{pronouns(persona)}</span> : null}
          <span className="block text-[12.5px] italic text-axal-ink dark:text-gray-200">{tagline ? `\u201c${tagline}\u201d` : NOT_RECORDED}</span>
          <span className="mt-1 flex flex-wrap gap-1">
            {onTeam ? <span className="rounded-axal-pill bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300" data-testid="agent-on-team">{`\u2713 ${ON_TEAM}`}</span> : null}
            {selected ? <span className="rounded-axal-pill bg-axal-violet px-2 py-0.5 text-[11px] font-semibold text-white" data-testid="agent-chosen">{CHOSEN}</span> : null}
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-1"><span className={EYE}>Core values</span><ValueChips persona={persona} legend={legend} /></div>
      <div className="flex flex-col gap-1"><span className={EYE}>Risk</span><RiskScale risk={persona?.risk} /></div>
      <div className="flex flex-col gap-1">
        <span className={EYE}>Natural fit</span>
        {fit.length ? (
          <span className="flex flex-wrap gap-1" data-testid="agent-fit">
            {fit.map((a) => <span key={a} className="rounded-axal-pill bg-axal-ground px-2 py-0.5 text-[11px] text-axal-ink dark:bg-gray-800 dark:text-gray-200">{AREA_LABEL[a]}</span>)}
          </span>
        ) : <span className="text-[11.5px] text-axal-muted dark:text-gray-400">{NOT_RECORDED}</span>}
      </div>
      {footer ? <div className="flex flex-wrap items-center gap-2 border-t border-axal-hairline pt-2 dark:border-gray-800">{footer}</div> : null}
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </article>
  );
}
