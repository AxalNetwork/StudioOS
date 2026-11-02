/**
 * D1570 (#3817, deck builder v2 D9, pd33) — the comments sheet's pure half:
 * which threads sit on a card, how many are open, the @-mention people
 * listbox, and the pre-share gate's approval line (pd33 inset), which
 * `ShareDialog.jsx` shows before a link is made.
 *
 * Comments are only between people: nothing here, or in the sheet, runs a
 * model or drafts a reply. No network, no React.
 */

/** The sheet's title, "Comments · card 4" (cards counted from 1). */
export const commentsTitle = (index) => `Comments · card ${Number(index) + 1}`;
export const openLine = (n) => `${n} open`;
export const COMMENT_MAX = 2000;
export const MENTION_MAX = 20;
export const AREA_ID = /^[A-Za-z0-9_.:-]{1,64}$/;
export const NO_THREADS = 'No comments on this card yet.';
export const THREAD_PLACEHOLDER = 'Comment on this card. Type @ to mention someone.';
export const REPLY_PLACEHOLDER = 'Reply. Type @ to mention someone.';
/** Owner decision Q = B (2026-11-01), the line pd33 carries. */
export const Q_NOTE = 'Advisors and operating partners comment only when the founder grants it.';
/** What an Admin reads instead: the route does not admit them, and their thread is Notes (D905). */
export const ADMIN_LINE = 'Comments are between the venture’s founders and the advisors they invite. Your notes to the founders are under Notes from your admins.';
export const UNASSIGNED = 'Unassigned';

const KIND = { founder: 'Founder', advisor: 'Advisor', operating_partner: 'Operating Partner' };
export const kindLabel = (kind) => KIND[kind] || 'Founder';
export const nameOf = (p) => (p?.name && String(p.name).trim()) || 'Not recorded';

/** Whether a comment is on this card: by the card's uid when both carry one (D1500), else by its place. */
export function onCard(comment, card, index) {
  if (card?.uid && comment?.card_uid) return comment.card_uid === card.uid;
  return Number(comment?.card_index) === Number(index);
}

/**
 * The card's threads, oldest first and numbered from 1 (the pins), each with
 * its replies oldest first. A reply rides its thread wherever the thread is.
 */
export function threadsOn(comments, card, index) {
  const list = Array.isArray(comments) ? comments : [];
  const roots = list.filter((c) => c && c.parent_uid == null && onCard(c, card, index));
  return roots.map((root, i) => ({
    n: i + 1,
    root,
    replies: list.filter((c) => c && c.parent_uid === root.uid),
    open: root.resolved_at == null,
  }));
}

/** Threads still open on the card ("2 open"). */
export const openCount = (comments, card, index) => threadsOn(comments, card, index).filter((t) => t.open).length;

/**
 * The @ being typed before the caret, or null: "@Sa" → { query: 'Sa', start }.
 * An @ inside a word (an email address) is not a mention.
 */
export function mentionQuery(text, caret) {
  const before = String(text ?? '').slice(0, Math.max(0, Number(caret) || 0));
  const m = /(^|\s)@([^\s@]{0,30})$/u.exec(before);
  if (!m) return null;
  return { query: m[2], start: before.length - m[2].length - 1 };
}

/** The people listbox: anyone whose name has a word starting with the query, never the writer; at most six. */
export function mentionMatches(people, query, me) {
  const q = String(query ?? '').toLowerCase();
  return (Array.isArray(people) ? people : [])
    .filter((p) => p && Number(p.id) !== Number(me))
    .filter((p) => !q || nameOf(p).toLowerCase().split(/\s+/).some((w) => w.startsWith(q)) || nameOf(p).toLowerCase().startsWith(q))
    .slice(0, 6);
}

/** The text with "@Name " in place of the typed "@Sa", and the caret after it. */
export function insertMention(text, at, caret, person) {
  const s = String(text ?? '');
  const tag = `@${nameOf(person)} `;
  const next = s.slice(0, at) + tag + s.slice(Math.max(at, Number(caret) || at));
  return { text: next, caret: at + tag.length };
}

/** The people picked from the listbox whose "@Name" is still in the text: deleting the words drops the mention. */
export function mentionsIn(text, picked) {
  const s = String(text ?? '');
  const ids = [];
  for (const p of Array.isArray(picked) ? picked : []) {
    if (p && s.includes(`@${nameOf(p)}`) && !ids.includes(Number(p.id))) ids.push(Number(p.id));
  }
  return ids.slice(0, MENTION_MAX);
}

/** Who may assign or resolve a thread: a founder, its author, or (to resolve) its assignee. */
export function mayAct(viewer, thread, what) {
  if (!viewer || !thread) return false;
  if (viewer.can_manage) return true;
  const me = Number(viewer.user_id);
  if (Number(thread.author?.id) === me) return true;
  return what === 'resolve' && Number(thread.assignee?.id) === me;
}

/**
 * The pre-share gate (pd34's confirm, which pd33's inset joins): the lines it
 * shows before a link is made, and whether Share is held. An approver who has
 * not signed off this version holds it: the Worker refuses the link until they
 * do, so the confirm offers no "Share anyway". `approval` is
 * `GET /api/decks/:id/approval`'s reply. Unread, the gate opens nothing: the
 * Worker still refuses a held link, and the dialog prints its sentence.
 * #3826 adds its "[N] cards are not Done. Share anyway?" line here.
 */
export function preShareGate(approval) {
  const pending = Array.isArray(approval?.pending) ? approval.pending : [];
  if (!pending.length) return { show: false, held: false, lines: [] };
  return { show: true, held: true, lines: [{ tone: 'amber', key: 'approval', text: approval.message || approvalLine(pending) }] };
}

/** "Approval needed before sharing · Sam has not approved yet." — the Worker's own sentence, for when it sent none. */
export function approvalLine(pending) {
  const names = pending.map((p) => (p?.name && String(p.name).trim()) || 'An approver');
  const who = names.length === 1 ? `${names[0]} has` : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} have`;
  return `Approval needed before sharing · ${who} not approved yet.`;
}
