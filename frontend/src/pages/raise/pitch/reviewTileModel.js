/**
 * D4271 (#4271, D4254 P3) — the Review tile's pure half: the comments across
 * the deck with their filters (ps6), the approvals D1570 stores, and the
 * figures with their sources and check (ps6b). No React and no fetch:
 * `ReviewTile.jsx` draws it; the AI review stays `PitchReview.jsx` (D900).
 *
 * Every list filters client-side over the one read it came from. A figure the
 * deck's check has not looked at is "Not checked", never Checked; a person is
 * named, never an email; a value nobody recorded is "Not recorded".
 */
import { NOT_RECORDED } from '../../../lib/absence';
import { EDIT_PATH } from './pitchStudioModel';

export { NOT_RECORDED };

// ─────────────────────────────────────────────────────────── comments (ps6)

export const FILTERS = Object.freeze([
  { id: 'open', label: 'Open' },
  { id: 'assigned', label: 'Assigned to you' },
  { id: 'mentions', label: 'Mentions you' },
  { id: 'resolved', label: 'Resolved' },
]);
export const COMMENTS_UNREAD = 'The comments could not be read.';
export const COMMENTS_ADMIN = 'Comments are between the venture’s founders and the advisors they invite. Your notes to the founders are under Notes.';
export const NO_THREADS = Object.freeze({
  open: 'No open comments on this deck.',
  assigned: 'Nothing is assigned to you.',
  mentions: 'No comment mentions you.',
  resolved: 'No comment has been resolved yet.',
});

/** "AL" from "Ada Lovelace"; "?" when the read has no name. */
export function initials(name) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts.at(-1)[0] : '')).toUpperCase();
}
export const personName = (p) => (p?.name && String(p.name).trim()) || NOT_RECORDED;

/**
 * Every thread across the deck, newest first: its first comment, its replies,
 * the card it is on (by uid when the card has one, else by place) and whether
 * it is open. `slides` names each card; a thread on a card the version no
 * longer has keeps its number.
 */
export function deckThreads(comments, slides = []) {
  const list = Array.isArray(comments) ? comments.filter(Boolean) : [];
  const cards = Array.isArray(slides) ? slides : [];
  return list.filter((c) => c.parent_uid == null).map((root) => {
    const at = root.card_uid ? cards.findIndex((s) => s?.uid === root.card_uid) : -1;
    const index = at >= 0 ? at : Number(root.card_index);
    const replies = list.filter((c) => c.parent_uid === root.uid);
    return {
      uid: root.uid, root, replies, open: root.resolved_at == null,
      card: Number.isInteger(index) && index >= 0 ? index + 1 : null,
      cardTitle: Number.isInteger(index) && cards[index]?.title ? String(cards[index].title) : null,
      mentioned: [root, ...replies].flatMap((c) => (Array.isArray(c.mentions) ? c.mentions.map((m) => Number(m?.id)) : [])),
    };
  }).sort((a, b) => String(b.root.created_at ?? '').localeCompare(String(a.root.created_at ?? '')));
}

/** The threads a filter shows, for the viewer (`viewer.user_id`). */
export function filterThreads(threads, filter, viewerId) {
  const me = Number(viewerId);
  const pick = {
    open: (t) => t.open,
    assigned: (t) => t.open && Number(t.root.assignee?.id) === me,
    mentions: (t) => t.open && t.mentioned.includes(me),
    resolved: (t) => !t.open,
  }[filter] ?? (() => false);
  return (threads || []).filter(pick);
}

/** How many threads each filter holds, for the filter pills. */
export function filterCounts(threads, viewerId) {
  return Object.fromEntries(FILTERS.map((f) => [f.id, filterThreads(threads, f.id, viewerId).length]));
}

/** "Card 4 · Traction", or the card alone, or "No card". */
export const cardLine = (t) => (t.card == null ? 'No card' : `Card ${t.card}${t.cardTitle ? ` · ${t.cardTitle}` : ''}`);
export const replyLine = (n) => `${n} ${n === 1 ? 'reply' : 'replies'}`;

/**
 * Where a thread opens: the editor on its card with the card's comments open
 * (`PitchEditor`'s `?card=&comments=1`). The venture rides along.
 */
export function threadHref(projectId, card) {
  const q = new URLSearchParams();
  if (projectId != null) q.set('project_id', String(projectId));
  if (card != null) { q.set('card', String(card)); q.set('comments', '1'); }
  return `${EDIT_PATH}?${q.toString()}`;
}

/** The 0-based card an editor link names (counted from 1), or the first card when it names none on this deck. */
export function editorCardOf(raw, count) {
  const n = /^[1-9][0-9]{0,3}$/.test(String(raw ?? '')) ? Number(raw) - 1 : 0;
  return n < Math.max(0, Number(count) || 0) ? n : 0;
}

// ─────────────────────────────────────────────────────────── approvals

export const APPROVAL_UNREAD = 'The approvals could not be read.';
export const NO_APPROVERS = 'No one is named to approve this version. Name approvers when you share it.';
export const APPROVED = 'Approved';
export const WAITING = 'Waiting';

/** The approval read as rows: each approver by name, approved this version or waiting; and the line. */
export function approvalView(read) {
  const approvers = Array.isArray(read?.approvers) ? read.approvers : [];
  return {
    rows: approvers.map((a) => ({
      id: a.user_id, name: personName(a), initials: initials(a.name), approved: !!a.approved,
      state: a.approved ? APPROVED : WAITING, at: a.approved && a.approved_at ? String(a.approved_at).slice(0, 10) : null,
    })),
    line: approvers.length ? (read?.message || `${approvers.filter((a) => a.approved).length} of ${approvers.length} approved this version.`) : NO_APPROVERS,
  };
}

// ─────────────────────────────────────────────────────────── figures (ps6b)

export const FIGURES_UNREAD = 'The figures could not be read.';
export const NO_FIGURES = 'This version states no figures.';
export const CHECKED = 'Checked';
export const NOT_CHECKED = 'Not checked';
export const FIGURE_COLUMNS = Object.freeze(['Figure', 'Card', 'Source', 'Check']);

/** What a claim's display state reads as in the Check column (D900's states). */
const CHECK_STATE = Object.freeze({
  backed: CHECKED,
  founders_figure: 'Your figure, with a note',
  mismatch: 'Does not match the record',
  not_backed: 'No record backs it',
  stale: 'The record has moved',
});

/** The figure's source line: "Linked · Revenue · as of 2026-10-01", "Stated · typed on the card", "No source", or Not recorded. */
export function sourceLine(f) {
  if (f?.state === 'linked') {
    const s = f.source || {};
    return ['Linked', s.label || s.module || null, s.as_of ? `as of ${s.as_of}` : null].filter(Boolean).join(' · ');
  }
  if (f?.state === 'stated') return 'Stated · typed on the card';
  if (f?.state === 'uncited') return 'No source';
  return NOT_RECORDED;
}

/** What the row names: the label, else the words on the card, else the numbers an uncited text names. */
export function figureName(f) {
  const label = typeof f?.label === 'string' && f.label.trim() ? f.label.trim() : null;
  const value = typeof f?.value === 'string' && f.value.trim() ? f.value.trim() : null;
  if (label && value) return `${label} · ${value}`;
  return label || value || (Array.isArray(f?.figures) && f.figures.length ? f.figures.join(', ') : 'A figure');
}

/**
 * The claim the deck's check holds for a figure: one on the same card (the
 * claim's `slide` counts from 1) whose label is the figure's, else the card's
 * only claim. None when the version was never checked.
 */
export function claimFor(f, claims) {
  const card = Number(f?.card) + 1;
  const on = (Array.isArray(claims) ? claims : []).filter((c) => Number(c?.slide) === card);
  const label = String(f?.label ?? '').trim().toLowerCase();
  return (label && on.find((c) => String(c.label ?? '').trim().toLowerCase() === label)) || (on.length === 1 ? on[0] : null);
}

/**
 * The figures table: every figure on the version with its card, its source
 * and its check, Uncited first (they need a source), then Stated, Not
 * recorded and Linked. A row opens its claim on Evidence when the check holds
 * one, else its card in the editor.
 */
export function figureRows(figures, check, slides = [], projectId = null) {
  const claims = check?.claims ?? [];
  const rank = { uncited: 0, stated: 1, not_recorded: 2, linked: 3 };
  return (Array.isArray(figures) ? figures : []).filter((f) => f && Number.isInteger(f.card)).map((f, i) => {
    const claim = claimFor(f, claims);
    const card = f.card + 1;
    const title = slides?.[f.card]?.title ? String(slides[f.card].title) : null;
    return {
      key: `${f.card}-${f.block_id ?? 'x'}-${f.at ?? ''}-${i}`,
      name: figureName(f), state: f.state,
      card: `Card ${card}${title ? ` · ${title}` : ''}`,
      source: sourceLine(f),
      check: claim ? (CHECK_STATE[claim.display_state] ?? NOT_CHECKED) : NOT_CHECKED,
      checked: !!claim && claim.display_state === 'backed',
      href: claim?.uid
        ? `/raise/evidence/claim/${encodeURIComponent(claim.uid)}?project=${encodeURIComponent(projectId ?? '')}`
        : threadHref(projectId, card).replace('&comments=1', ''),
    };
  }).sort((a, b) => (rank[a.state] ?? 9) - (rank[b.state] ?? 9) || a.key.localeCompare(b.key, 'en', { numeric: true }));
}

/** "4 figures · 3 checked". */
export function figuresLine(rows) {
  const n = rows.length;
  return `${n} ${n === 1 ? 'figure' : 'figures'} · ${rows.filter((r) => r.checked).length} checked`;
}
