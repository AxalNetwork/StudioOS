/**
 * D1579 (#3826, deck v2 E6) — a card's status and assignee, read from the
 * version's card document (`slideModel.ts` keeps `status` and `assignee` on
 * each card; there is no table of their own).
 *
 * TRACKED. A deck whose cards carry no status has never been tracked, and
 * none of its cards is counted "not Done": a deck saved before E6 is not
 * warned about before every share. Once any card has a status, the deck is
 * tracked and a card without one reads To do.
 *
 * The filter (`filterCards`) is the strip's: by status (all, todo,
 * in_progress, done) and by assignee (anyone, a person's id, or `none` for
 * unassigned), and it returns exactly the cards that match both.
 *
 * `newAssignments` names the cards a save assigns to someone they were not
 * assigned to before, by card uid: the save notifies each such card's person
 * once (`notifyAssignments`, the same `notify()` D1570's mentions use).
 *
 * Pure but for `notifyAssignments`; nothing here reads or calls a model.
 */
import type { Env } from '../../types';
import { assignCardUids } from './cardUids';
import { CARD_STATUSES, type CardStatus } from './slideModel';
import { notify } from '../notify';

export const STATUS_LABELS: Record<CardStatus, string> = { todo: 'To do', in_progress: 'In progress', done: 'Done' };
/** The filter's status segment: All · To do · In progress · Done. */
export const STATUS_FILTERS = ['all', ...CARD_STATUSES] as const;
export type StatusFilter = typeof STATUS_FILTERS[number];
/** The filter's assignee: anyone, one person, or nobody. */
export type AssigneeFilter = 'anyone' | 'none' | number;

export type CardState = { index: number; uid: string; title: string; status: CardStatus | null; assignee: number | null };

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** A card's title as the strip draws it (`editorModel.cardTitle`): its title, its heading block, or "Card n". */
export function cardTitleOf(card: any, index: number): string {
  const heading = Array.isArray(card?.blocks) ? card.blocks.find((b: any) => b?.kind === 'text' && b.style === 'heading' && str(b.text)) : null;
  return (str(card?.title) || str(heading?.text) || `Card ${index + 1}`).slice(0, 120);
}

const statusOf = (v: unknown): CardStatus | null => ((CARD_STATUSES as readonly string[]).includes(v as string) ? v as CardStatus : null);
const assigneeOf = (v: unknown): number | null => (Number.isSafeInteger(v) && (v as number) > 0 ? v as number : null);

/** Whether any card of the version carries a status. */
export const isTracked = (slides: unknown): boolean => Array.isArray(slides) && slides.some((s: any) => statusOf(s?.status) !== null);

/** Every card's working state, in deck order. On a tracked deck a card with no status reads To do. */
export function cardStates(slides: unknown): CardState[] {
  const list = Array.isArray(slides) ? assignCardUids(slides.filter((s) => s && typeof s === 'object')) : [];
  const tracked = isTracked(list);
  return list.map((s: any, index) => ({
    index, uid: s.uid, title: cardTitleOf(s, index),
    status: statusOf(s.status) ?? (tracked ? 'todo' : null),
    assignee: assigneeOf(s.assignee),
  }));
}

/** Exactly the cards matching both the status and the assignee asked for. */
export function filterCards(cards: CardState[], status: StatusFilter = 'all', assignee: AssigneeFilter = 'anyone'): CardState[] {
  return cards.filter((c) => (status === 'all' || c.status === status)
    && (assignee === 'anyone' || (assignee === 'none' ? c.assignee === null : c.assignee === assignee)));
}

/** The cards that hold a share's warning and the home deck card's pill: a status that is not Done. */
export const notDone = (cards: CardState[]): CardState[] => cards.filter((c) => c.status !== null && c.status !== 'done');

/**
 * The query's filter, or the sentence that refuses it. `status` is all (or
 * absent), todo, in_progress or done; `assignee` is anyone (or absent), none,
 * or a person's id.
 */
export function filterOf(q: { status?: string | null; assignee?: string | null }): { status: StatusFilter; assignee: AssigneeFilter } | { error: string } {
  const s = q.status == null || q.status === '' ? 'all' : q.status;
  if (!(STATUS_FILTERS as readonly string[]).includes(s)) return { error: 'status is all, todo, in_progress or done.' };
  const a = q.assignee == null || q.assignee === '' ? 'anyone' : q.assignee;
  if (a === 'anyone' || a === 'none') return { status: s as StatusFilter, assignee: a };
  if (!/^[1-9][0-9]{0,15}$/.test(a) || !Number.isSafeInteger(Number(a))) return { error: 'assignee is anyone, none or a person\'s id.' };
  return { status: s as StatusFilter, assignee: Number(a) };
}

/**
 * The cards a save assigns to someone new, by uid: an assignee that is set
 * and differs from the same card's on the version the save replaces. A card
 * added by the save counts; an assignee kept as it was does not, so saving
 * again never repeats a notice.
 */
export function newAssignments(before: unknown, after: unknown): Array<{ uid: string; index: number; user_id: number }> {
  const was = new Map(cardStates(before).map((c) => [c.uid, c.assignee]));
  return cardStates(after)
    .filter((c) => c.assignee !== null && was.get(c.uid) !== c.assignee)
    .map((c) => ({ uid: c.uid, index: c.index, user_id: c.assignee as number }));
}

/**
 * One notice per assignment, never to the person who made it: "[name]
 * assigned you card [n]." Like D1570's mention notice it carries no words of
 * the deck, only the card's place and uid.
 * A failed notice never fails the save. Only the save whose version insert
 * won (`insertVersion`'s conditional batch) reaches here, so one assignment
 * is told once.
 */
export async function notifyAssignments(env: Env, args: {
  projectId: number; deckId: number; by: { id: number; name: string | null }; assigned: ReturnType<typeof newAssignments>;
}): Promise<number> {
  const who = String(args.by.name || '').trim() || 'Someone on the venture';
  let sent = 0;
  for (const a of args.assigned) {
    if (a.user_id === Number(args.by.id)) continue;
    const id = await notify(env, {
      userId: a.user_id, type: 'deck_card_assigned', category: 'mentions',
      title: `${who} assigned you card ${a.index + 1}.`,
      body: 'Open the deck to work on the card.',
      link: `/raise/pitch/edit?project_id=${args.projectId}&card=${encodeURIComponent(a.uid)}`,
      payload: { deck_id: args.deckId, card_uid: a.uid, card_index: a.index },
    }).catch(() => null);
    if (id != null) sent += 1;
  }
  return sent;
}
