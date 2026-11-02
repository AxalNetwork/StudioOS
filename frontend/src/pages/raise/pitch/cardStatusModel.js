/**
 * D1579 (#3826, deck v2 E6) — pure. A card's status (To do, In progress,
 * Done) and assignee as the Cards strip, the card menu, the home deck card and
 * the pre-share confirm read them.
 *
 * The rule is the Worker's (`services/decks/cardStatus.ts`), so the strip's
 * filter over the cards on screen (unsaved edits included) and
 * `GET /api/decks/:id/card-status` over the saved version agree:
 *   - a deck no card of which carries a status is not tracked: no card is
 *     "not Done" and no pill is drawn;
 *   - once any card has one, a card without one reads To do;
 *   - the filter returns exactly the cards matching both its status and its
 *     assignee (anyone, `none` for unassigned, or a person's id).
 *
 * Status and assignee are the card's own fields: Set status › and Assign ›
 * are edits held until a version is saved, like every other card edit.
 */

export const STATUSES = Object.freeze([
  { id: 'todo', label: 'To do' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'done', label: 'Done' },
]);
/** pd34's segment: All · To do · In progress · Done. */
export const STATUS_SEGMENTS = Object.freeze([{ id: 'all', label: 'All' }, ...STATUSES]);
export const ANYONE = 'anyone';
export const UNASSIGNED = 'none';
export const ALL_CARDS = Object.freeze({ status: 'all', assignee: ANYONE });

const IDS = STATUSES.map((s) => s.id);
export const statusLabel = (id) => STATUSES.find((s) => s.id === id)?.label ?? null;

/** pd34's pills: Done positive, In progress a violet outline, To do neutral. */
export const PILL_TONE = Object.freeze({
  done: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
  in_progress: 'border-axal-violet bg-white text-axal-violet dark:border-violet-400 dark:bg-gray-900 dark:text-violet-300',
  todo: 'border-axal-hairline bg-axal-ground text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300',
});

const assigneeOf = (v) => (Number.isSafeInteger(v) && v > 0 ? v : null);

/** Whether any card carries a status. */
export const isTracked = (cards) => (Array.isArray(cards) ? cards : []).some((c) => IDS.includes(c?.status));

/** A card's status on a deck: its own, To do on a tracked deck, else none. */
export const statusOf = (card, tracked) => (IDS.includes(card?.status) ? card.status : tracked ? 'todo' : null);

/** The cards matching both the status and the assignee, each with its place on the deck. */
export function filterCards(cards, filter = ALL_CARDS) {
  const list = Array.isArray(cards) ? cards : [];
  const tracked = isTracked(list);
  const status = filter?.status ?? 'all';
  const who = filter?.assignee ?? ANYONE;
  return list
    .map((card, index) => ({ card, index }))
    .filter(({ card }) => (status === 'all' || statusOf(card, tracked) === status)
      && (who === ANYONE || (who === UNASSIGNED ? assigneeOf(card?.assignee) === null : assigneeOf(card?.assignee) === Number(who))));
}

/** Whether the filter narrows anything. */
export const isFiltered = (filter) => (filter?.status ?? 'all') !== 'all' || (filter?.assignee ?? ANYONE) !== ANYONE;

/** "[3] of [12] cards". */
export const countLine = (shown, total) => `${shown} of ${total} card${total === 1 ? '' : 's'}`;

/** The home deck card's amber pill: "[n] cards not Done", or nothing at 0. */
export const notDonePill = (n) => (Number.isInteger(n) && n > 0 ? `${n} card${n === 1 ? '' : 's'} not Done` : null);

/** The pre-share line: "[n] cards are not Done. Share anyway?" */
export const notDoneLine = (n) => `${n} card${n === 1 ? ' is' : 's are'} not Done. Share anyway?`;
export const NOT_DONE_UNREAD = 'Which cards are not Done could not be read. You can still share.';

/** A card with its status set (an edit, held until Save). */
export function withStatus(card, status) {
  if (!card || !IDS.includes(status)) return card;
  return { ...card, status };
}

/** A card assigned to a person, or unassigned with null. */
export function withAssignee(card, userId) {
  if (!card) return card;
  const id = assigneeOf(Number(userId));
  if (userId == null || id === null) { const { assignee: _a, ...rest } = card; return rest; }
  return { ...card, assignee: id };
}

/** A person's name as the strip writes it, or "Not recorded". */
export const personName = (p) => (p?.name && String(p.name).trim()) || 'Not recorded';

/** Up to two initials for the avatar; "?" for a person with no name. */
export function initials(name) {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  return (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase();
}

/** Who a card is assigned to, from the people read: `{ id, name }`, or null when unassigned. */
export function assigneeOfCard(card, people) {
  const id = assigneeOf(card?.assignee);
  if (id === null) return null;
  const p = (Array.isArray(people) ? people : []).find((x) => Number(x?.id) === id);
  return { id, name: p?.name ?? null };
}

/** The lines a save's summary shows for a card's status or assignee change. */
export function statusChanges(was, card, name) {
  const out = [];
  if ((was?.status ?? null) !== (card?.status ?? null) && card?.status) out.push(`${name}: the status becomes ${statusLabel(card.status)}.`);
  const a = assigneeOf(was?.assignee);
  const b = assigneeOf(card?.assignee);
  if (a !== b) out.push(b === null ? `${name}: no longer assigned.` : `${name}: assigned to someone new, who is told when you save.`);
  return out;
}
