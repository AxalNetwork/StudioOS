/**
 * D1108 (#2988) — Checklist's derivations (DR12), kept pure, from D1105's read
 * `GET /api/data-room/:projectUid/checklist` (`dataRoomApi.checklist`).
 *
 * The twelve items in their six areas, in the read's order. Each item's state
 * is the Worker's, decided by the investor read's own rule (tier, end date,
 * folders, NDA), so the page never promises an open the room refuses:
 *   - `open`: at least one investor with access can open a file that answers it;
 *   - `no_one_can_open`: files answer it, but no grant can open any of them,
 *     with the Worker's reason;
 *   - `no_file`: nothing answers it yet.
 *
 * EADWYN'S PROPOSALS (DR14, D4170 #4170) are the member's own, from
 * `GET /api/data-room/:p/proposals`: a checklist match, a folder for a
 * top-level file, or a gap. Each reads with its reason, Accept and Dismiss;
 * an accepted match or move offers Undo. Asking costs a quoted run, shown
 * before it runs. An empty list is "No proposals"; a failed read says so and
 * is never an empty list.
 * THE READINESS FIGURE the canvas draws ("Data room [7] of 10") has no read
 * that carries it to this page, so it says so and links Fundraising readiness.
 */

import { NOT_RECORDED } from '../../../lib/absence.js';
import { aiTokens } from '../pitch/newDeckModel.js';

export const PROPOSALS_NOTE = 'Eadwyn reads file and folder names only, never a file. Each proposal changes one thing when you accept it: a checklist match or a folder. A gap is a note. Nothing here deletes a file or changes who can open it.';
export const PROPOSALS_EMPTY = 'No proposals';
export const PROPOSALS_UNREADABLE = 'Proposals could not be read';
export const READINESS_WAIT = 'Not read here yet. Fundraising readiness scores the data room; its figure is not carried to this page.';
export const READINESS_PATH = '/raise/fundraising-readiness';
export const MATCH_NOTE = 'Matching changes nothing about who can open a file.';

const STATE = {
  open: { label: 'Answered · investors can open it', tone: 'pos', mark: '✓' },
  no_one_can_open: { label: 'Answered · no investor can open it', tone: 'warn', mark: '⊘' },
  no_file: { label: 'Missing', tone: 'missing', mark: '' },
};

const GATE = { nda: 'NDA', open: 'Open' };
const TIER = { invited: 'Everyone invited', committed: 'Committed only', nobody: 'Private to you' };
const SOURCE = { connector: { mercury: 'From Mercury' }, document: { cap_table: 'From the cap table' }, signed: {} };

/** A file's chips: its gate, its tier, and where it came from when the platform filed it. */
export function fileChips(f) {
  const chips = [GATE[f?.visibility] || NOT_RECORDED, TIER[f?.access_tier] || TIER.invited];
  const src = SOURCE[f?.source?.kind]?.[f?.source?.ref];
  if (src) chips.push(src);
  else if (f?.source?.kind === 'signed') chips.push('Signed copy');
  return chips;
}

/** How many investors with access can open a file, in words. */
export function opensLine(f) {
  const g = Number(f?.grants_that_open);
  if (!Number.isFinite(g)) return NOT_RECORDED;
  return g ? `${g} investor${g === 1 ? '' : 's'} can open it` : 'No investor can open it';
}

/** One item: its label, state pill, the line under it, its files and what the founder can do next. */
export function itemView(item) {
  const st = STATE[item?.state] || { label: NOT_RECORDED, tone: 'missing', mark: '' };
  const files = Array.isArray(item?.files) ? item.files : [];
  return {
    key: item?.key,
    label: item?.label || NOT_RECORDED,
    state: item?.state,
    pill: st,
    sub: item?.state === 'no_file' ? 'No file answers this yet.' : item?.state === 'open' ? null : (item?.reason || NOT_RECORDED),
    files: files.map((f) => ({ uid: f.uid, name: f.name, chips: fileChips(f), opens: opensLine(f) })),
    next: item?.state === 'no_file' ? ['match', 'upload'] : item?.state === 'no_one_can_open' ? ['gate'] : [],
  };
}

/** The six areas in the read's order, each with its items and "[answered] of [total]". */
export function areasOf(read) {
  const out = [];
  for (const item of Array.isArray(read?.items) ? read.items : []) {
    let a = out.find((x) => x.area === item.area);
    if (!a) { a = { area: item.area || NOT_RECORDED, items: [] }; out.push(a); }
    a.items.push(itemView(item));
  }
  return out.map((a) => ({ ...a, meta: `${a.items.filter((i) => i.state !== 'no_file').length} of ${a.items.length}` }));
}

/** The summary line over the areas. */
export function summaryLine(read) {
  const t = read?.totals;
  if (!t) return NOT_RECORDED;
  const g = Number(read?.grants_in_force);
  const who = Number.isFinite(g) ? ` · ${g} investor${g === 1 ? '' : 's'} with access` : '';
  return `${Number(t.answered) || 0} of ${Number(t.items) || 0} items answered · ${Number(t.openable) || 0} an investor can open${who}`;
}

/** One proposal as the group draws it: what it changes, why, and what can be pressed. */
export function proposalView(p) {
  const file = p?.file?.name || NOT_RECORDED;
  const item = p?.item?.label || NOT_RECORDED;
  let title;
  if (p?.type === 'match') title = `Match ${file} to ${item}`;
  else if (p?.type === 'folder') title = `Move ${file} into ${p?.folder?.name || NOT_RECORDED}`;
  else if (p?.type === 'gap') title = `${item} has no file. ${p?.would_satisfy || ''}`.trim();
  else return null;
  const open = p?.status === 'proposed';
  return {
    uid: p.uid,
    type: p.type,
    title,
    reason: p?.reason || NOT_RECORDED,
    accepted: p?.status === 'accepted',
    actions: open ? ['accept', 'dismiss'] : p?.undoable ? ['undo'] : [],
    done: open ? null : p.type === 'gap' ? 'Noted' : 'Accepted',
  };
}

/** The read's proposals as views, or null when the read is not a list (drawn as unreadable, never as empty). */
export function proposalsOf(read) {
  if (!read || !Array.isArray(read.proposals)) return null;
  return read.proposals.map(proposalView).filter(Boolean);
}

/** "Holds up to $0.0500 · you pay what it uses", or null before the quote is read. */
export function proposalsHoldLine(quote) {
  const hold = aiTokens(quote?.hold_microusd);
  return hold ? `Holds up to ${hold} · you pay what it uses` : null;
}
