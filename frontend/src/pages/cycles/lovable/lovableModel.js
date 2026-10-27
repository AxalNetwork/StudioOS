/**
 * D1082 (#2947) — Build in Lovable's words and small rules, with no React,
 * so `node --test` loads them alone. The dialog is `BuildInLovable.jsx`.
 */

export const OPENS_LINE = 'Lovable opens in a new tab with this prompt. Nothing is sent until you press send there. Building uses your own Lovable credits.';
export const LEFT_OUT = 'Interview names, quotes and contacts are never included.';
export const MAX = 4000;

/** "2026-10-22" from the Worker's timestamp, or null. */
export function openedDay(at) {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(at ?? ''));
  return m ? m[1] : null;
}

/** The count under the prompt, "1,234 / 4,000". */
export const countText = (n) => `${Number(n || 0).toLocaleString('en-US')} / ${MAX.toLocaleString('en-US')}`;

/** Whether an entry draws anything: the button for a writer, or LV4's line once opened. */
export const showsEntry = (lovable) => !!(lovable && lovable.record && (lovable.can_launch || openedDay(lovable.opened_at)));

/**
 * LV7: Prototype / MVP's entry, from the Build module read's `parts.lovable`;
 * null for any other module, or when it would draw nothing.
 */
export function prototypeLovable(cycle, slug, module) {
  const part = cycle === 'build' && slug === 'prototype-mvp' ? module?.parts?.lovable : null;
  if (!part) return null;
  const lovable = { cycle: 'build', project_id: part.project_id, record: part.record, can_launch: !!part.can_launch, opened_at: part.opened_at ?? null };
  return showsEntry(lovable) ? lovable : null;
}
