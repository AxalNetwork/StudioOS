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
  const col = (cards) => cards.map((c, i) => ({ n: String(i + 1).padStart(2, '0'), title: cardTitle(c, i), changed: changedAt.has(i), uid: typeof c?.uid === 'string' ? c.uid : null }));
  return { left: col(a), right: col(b), changed: changedAt.size };
}

export const changedPill = (n) => (n === 0 ? 'No card changed' : `${n} changed`);

/**
 * D4254 P5 (#4273, ps3): what changed from `older` to `newer`, by card title.
 * A card is matched by its uid; a card with no uid (a deck saved before uids)
 * by its place. Added is in `newer` only, removed in `older` only, changed is
 * in both with a different stored shape.
 */
export function compareSummary(older, newer) {
  const a = slidesOf(older);
  const b = slidesOf(newer);
  const key = (c, i) => (typeof c?.uid === 'string' && c.uid ? `u:${c.uid}` : `p:${i}`);
  const olds = new Map(a.map((c, i) => [key(c, i), { c, i }]));
  const news = new Map(b.map((c, i) => [key(c, i), { c, i }]));
  const added = []; const changed = []; const removed = [];
  for (const [k, { c, i }] of news) {
    const o = olds.get(k);
    if (!o) added.push(cardTitle(c, i));
    else if (!same(o.c, c)) changed.push(cardTitle(c, i));
  }
  for (const [k, { c, i }] of olds) if (!news.has(k)) removed.push(cardTitle(c, i));
  return { added, removed, changed };
}

/** "v6 → v7 · Added: Use of funds · Changed: Traction, Team, The ask" (ps3). */
export function compareLine(older, newer) {
  const s = compareSummary(older, newer);
  const parts = [`${vLabel(older)} → ${vLabel(newer)}`];
  if (s.added.length) parts.push(`Added: ${s.added.join(', ')}`);
  if (s.removed.length) parts.push(`Removed: ${s.removed.join(', ')}`);
  if (s.changed.length) parts.push(`Changed: ${s.changed.join(', ')}`);
  if (parts.length === 1) parts.push('No card changed');
  return parts.join(' · ');
}

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

/**
 * D1577 (#3824): the Restore-one-card dialog. One card of the older version goes back into the
 * current one as a new version (`POST /api/decks/:id/restore-card`); every other card stays.
 */
export function restoreCardDialog(older, current, versions = [], card) {
  const top = Math.max(0, ...versions.map((v) => Number(v?.version) || 0), Number(current?.version) || 0);
  const next = top ? `v${top + 1}` : 'a new version';
  const name = `card ${card.n}${card.title ? `, “${card.title}”` : ''}`;
  return {
    title: `Restore ${name} from ${vLabel(older)}?`,
    lines: [
      `${next} is saved with ${name} as it was in ${vLabel(older)}, and becomes the working deck.`,
      `Every other card stays as it is in ${vLabel(current)}, in the same order.`,
      'Nothing is deleted.',
    ],
    confirm: 'Restore this card',
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
