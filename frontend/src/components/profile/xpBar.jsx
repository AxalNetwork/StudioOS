/**
 * The Level / XP bar on the full archetype page (D325), read from
 * GET /api/assessment/xp/me. The Worker derives the level from the running
 * total with the engine's curve and sends the band around it (level_floor to
 * next_level_xp); the bar is the share of that band already earned.
 *
 * Canvas 69dc42f3 draws the bar inside the /studio archetype card; canvas
 * ec6c3ada, the card's own design, stops that card at the teaser. The card's
 * own design wins, so the bar lives on /studio/archetype.
 */
import React from 'react';
import { Unreadable } from '../../ui';

const n = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** What the bar draws, or null when the payload is not an XP standing. */
export function xpBarView(payload) {
  const xp = n(payload?.xp);
  const level = n(payload?.level);
  const floor = n(payload?.level_floor);
  const next = n(payload?.next_level_xp);
  if (xp == null || level == null || floor == null || next == null || next <= floor) return null;
  const pct = Math.max(0, Math.min(100, Math.round(((xp - floor) / (next - floor)) * 100)));
  return { level, xp, next, pct, recorded: payload.recorded === true };
}

/** `xp` is { state: 'loading' | 'unreadable' | 'ready', data }. */
export function XpBar({ xp, onRetry }) {
  const view = xp?.state === 'ready' ? xpBarView(xp.data) : null;
  if (xp?.state === 'loading') {
    return <div className="text-[12px] text-[#a1a1aa] dark:text-gray-400" data-testid="xp-bar">Loading your level…</div>;
  }
  if (xp?.state === 'unreadable' || (xp?.state === 'ready' && !view)) {
    return <Unreadable what="Your level and XP" claim="This is not a claim that you have none." onRetry={onRetry} />;
  }
  if (!view) return null;
  return (
    <div data-testid="xp-bar">
      <div className="flex items-baseline justify-between">
        <span className="acp-lbl text-[#7c3aed] dark:text-violet-300">Level {view.level}</span>
        <span className="acp-mono text-[11px] text-[#71717a] dark:text-gray-400">{view.xp} / {view.next} XP</span>
      </div>
      <div
        className="mt-1.5 h-[6px] overflow-hidden rounded-full bg-[#f1f1f5] dark:bg-gray-800"
        role="progressbar"
        aria-label={`Level ${view.level}: ${view.xp} of ${view.next} XP`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={view.pct}
      >
        <div className="h-full rounded-full bg-[#7c3aed] dark:bg-violet-400" style={{ width: `${view.pct}%` }} />
      </div>
      {!view.recorded && (
        <p className="mt-1.5 text-[11.5px] text-[#a1a1aa] dark:text-gray-400">No XP awarded yet. XP comes from completing assessments and attending events.</p>
      )}
    </div>
  );
}
