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
 * EADWYN'S PROPOSALS (DR14) are not read here yet: they wait for AUTOFILL's
 * provenance (#2431), so the block says so and offers nothing to accept.
 * THE READINESS FIGURE the canvas draws ("Data room [7] of 10") has no read
 * that carries it to this page, so it says so and links Fundraising readiness.
 */

import { NOT_RECORDED } from '../../../lib/absence.js';

export const PROPOSALS_WAIT = 'Not read here yet. Eadwyn proposes three kinds of change only: a checklist match, a folder for a top-level file, and a reading of gaps. Each waits until Ask can record where a proposal came from. Nothing here changes a file, a match or who can open it.';
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
