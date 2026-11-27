/**
 * D1581 (#3828, deck v2 F2) — Present's per-card budgets and its phone remote.
 * Pure.
 *
 * The budget is Rehearse's (`cardBudgetsMs`, `spentByCard`, `budgetLine` in
 * `rehearseModel.js`, D1580): the pitch length split across the cards in whole
 * seconds. Present reads that one split and never makes a second.
 *
 * A remote step is one of Present's own keys (`next`, `prev`, `first`, `last`)
 * or `{ card: n }`, 1-based; `remoteMove` applies it as the keys would.
 */
import { PITCH_CHOICES, budgetLine, cardBudgetsMs, spentByCard } from './rehearseModel.js';
import { moveTo } from './presentExportModel.js';

export { PITCH_CHOICES };
export const PITCH_LENGTH = 'Pitch length';
export const DEFAULT_PITCH_SECONDS = 180;
export const REMOTE_PAIRED = 'Phone remote paired';

/** This card's time against its share: "0:42 of 0:30", and whether it is over. Null before a card has a mark. */
export function presentBudget(marks, nowMs, cardCount, index, pitchSeconds) {
  const n = Math.max(0, Math.floor(Number(cardCount) || 0));
  if (!n || !Array.isArray(marks) || !marks.length || index < 0 || index >= n) return null;
  const budget = cardBudgetsMs(pitchSeconds, n)[index];
  const spent = spentByCard(marks, nowMs, n)[index];
  return { spent, budget, line: budgetLine(spent, budget), over: spent > budget };
}

/** The card Present shows after a remote step; an unknown step changes nothing. */
export function remoteMove(i, step, n) {
  if (!n) return 0;
  if (step && typeof step === 'object') {
    const card = Number(step.card);
    return Number.isInteger(card) && card >= 1 && card <= n ? card - 1 : Math.max(0, Math.min(n - 1, Number(i) || 0));
  }
  return moveTo(i, step, n);
}

/** Present's remote socket path for a version. */
export const remoteSocketPath = (deckId) => `/api/decks/${encodeURIComponent(deckId)}/remote/ws`;
