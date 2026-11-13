import React from 'react';
import { Sparkles } from 'lucide-react';

/**
 * D1497 (#3727) — the one way the Team screens draw who someone is.
 *
 * THE OWNER RULE: an agent is never drawn as a person. A person is a circle
 * with initials (`PersonAvatar`). An agent is a rounded square on lavender
 * with the violet spark (`AgentTile`), and wherever an agent is named it also
 * carries the "AI agent" pill (`AgentPill`). `AgentIdentity` is the pair with
 * the name and role, and every list that names an agent uses it, so no list
 * can drop the pill (the canvas drops it on TM4a "Held by", TM3c's summary and
 * TM7a's Ask cards; this build does not). A role card shows the tile alone:
 * a role is not an agent.
 */

const TILE = 'inline-flex shrink-0 items-center justify-center border border-axal-lavender-edge bg-axal-lavender text-axal-violet-deep dark:border-violet-700/60 dark:bg-violet-900/30 dark:text-violet-300';

/** An agent's mark: a rounded square, never a circle. Radius is 28% of the size, as the canvas draws it. */
export function AgentTile({ size = 32, label }) {
  return (
    <span className={TILE} style={{ width: size, height: size, borderRadius: Math.max(6, Math.round(size * 0.28)) }}
      role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} data-testid="agent-tile" data-shape="square">
      <Sparkles size={Math.round(size * 0.5)} aria-hidden="true" />
    </span>
  );
}

/** The "AI agent" pill with its spark. */
export function AgentPill() {
  return (
    <span className="inline-flex items-center gap-1 rounded-axal-pill border border-axal-lavender-edge bg-axal-lavender px-2 py-0.5 text-[11px] font-semibold text-axal-violet-deep dark:border-violet-700/60 dark:bg-violet-900/30 dark:text-violet-300" data-testid="agent-pill">
      <Sparkles size={11} aria-hidden="true" />AI agent
    </span>
  );
}

/** A person's mark: a circle with initials. */
export function PersonAvatar({ initials, size = 32, muted = false }) {
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-full font-mono text-[11.5px] font-bold ${muted ? 'bg-axal-ground text-axal-muted dark:bg-gray-800 dark:text-gray-400' : 'bg-axal-lavender text-axal-violet-deep dark:bg-violet-900/30 dark:text-violet-300'}`}
      style={{ width: size, height: size }} aria-hidden="true" data-testid="person-avatar" data-shape="circle">
      {initials}
    </span>
  );
}

/** An agent named in a row: tile, name, pill, and the role under it. */
export function AgentIdentity({ name, role, size = 32, roleClassName = '' }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5" data-testid="agent-identity">
      <AgentTile size={size} />
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-1.5">
          <b className="truncate text-[13.5px] font-extrabold text-axal-ink dark:text-gray-100">{name}</b>
          <AgentPill />
        </span>
        {role ? <span className={`${roleClassName || 'block'} truncate text-[12px] text-axal-muted dark:text-gray-400`}>{role}</span> : null}
      </span>
    </span>
  );
}

export default AgentIdentity;
