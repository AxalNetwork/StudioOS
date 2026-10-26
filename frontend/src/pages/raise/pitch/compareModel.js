/**
 * D898 group D (#2676) — PD15's pure rules: two versions side by side, which
 * cards changed, and what Restore says before it writes. No React here.
 *
 * WHAT CHANGED is read card by card, by position: a card is changed when its
 * whole stored shape differs between the two versions (its fields, blocks,
 * bindings, notes, layout or background), or when only one version has a card
 * at that position. The count is of positions.
 *
 * WHAT RESTORE DOES (`POST /api/decks/:id/restore`) is save a NEW version
 * that copies the older one's cards, title, audience, round and theme; it
 * becomes the working deck. Nothing is deleted: the version it replaces stays
 * in Versions, and its shared links stay frozen to it (D902).
 */
import { cardTitle } from './editorModel';
import { NOT_RECORDED } from '../../../lib/absence.js';

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const slidesOf = (deck) => (Array.isArray(deck?.slides) ? deck.slides : []);
export const vLabel = (deck) => (Number.isFinite(Number(deck?.version)) ? `v${Number(deck.version)}` : `Version ${NOT_RECORDED.toLowerCase()}`);

/**
 * Both columns of PD15: each card's number and title, and whether it changed.
 * `older` is drawn on the left, `newer` on the right.
 */
export function compareCards(older, newer) {
  const a = slidesOf(older);
  const b = slidesOf(newer);
  const n = Math.max(a.length, b.length);
  const changedAt = new Set();
  for (let i = 0; i < n; i += 1) if (i >= a.length || i >= b.length || !same(a[i], b[i])) changedAt.add(i);
  const col = (cards) => cards.map((c, i) => ({ n: String(i + 1).padStart(2, '0'), title: cardTitle(c, i), changed: changedAt.has(i) }));
  return { left: col(a), right: col(b), changed: changedAt.size };
}

export const changedPill = (n) => (n === 0 ? 'No card changed' : `${n} changed`);

/** The Restore dialog's title and what it says changes and what stays. */
export function restoreDialog(older, current, versions = []) {
  const top = Math.max(0, ...versions.map((v) => Number(v?.version) || 0), Number(current?.version) || 0);
  const next = top ? `v${top + 1}` : 'a new version';
  return {
    title: `Restore ${vLabel(older)}?`,
    lines: [
      `${next} is saved with ${vLabel(older)}'s cards, notes, theme, audience and round, and becomes the working deck.`,
      `${vLabel(current)} stays in Versions. Its shared links keep showing ${vLabel(current)}, as it was when they were made.`,
      'Nothing is deleted.',
    ],
    confirm: `Restore ${vLabel(older)}`,
  };
}

/** The pair to compare: the chosen version against the current one; the current one against the one before it. */
export function comparePair(versions, chosenId) {
  const sorted = [...(Array.isArray(versions) ? versions : [])].sort((x, y) => Number(x.version ?? -1) - Number(y.version ?? -1));
  const current = sorted.find((v) => v.is_current || v.current) || sorted[sorted.length - 1] || null;
  const chosen = sorted.find((v) => String(v.id) === String(chosenId)) || null;
  if (!current) return null;
  if (chosen && String(chosen.id) !== String(current.id)) return { older: chosen, newer: current };
  const i = sorted.indexOf(current);
  return i > 0 ? { older: sorted[i - 1], newer: current } : null;
}
