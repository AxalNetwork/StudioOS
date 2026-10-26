/**
 * D1027 (#2864, part 12 of #2432) — the investor's read-only Cap table panel
 * (CT15, CT15o, CT15n) as pure rules. The panel draws exactly what D1019's
 * level returns (`GET /api/captable/access/:projectId`, through `sharedView`)
 * and never more: a block the level does not carry says so, with its reason.
 *
 * THE GROUP BAR comes from what the level sent: the group split for Own
 * position and Summary (`view.summary`), and the positions' own percentages
 * for Investor and Full. A group whose share is not recorded leaves the bar
 * unfilled for it, never drawn as zero.
 */
import { NOT_RECORDED } from '../../../lib/absence.js';
import { levelLabel, sharedView } from './capTableAccess.js';

export const GROUP_ORDER = ['Founders', 'Investors', 'Option pool', 'Other'];
const GROUP_OF_TYPE = { founder: 'Founders', preferred: 'Investors', safe: 'Investors', option_pool: 'Option pool', common: 'Other' };

/** The sentences of CT15n and the blocks no level carries yet. */
export const NO_ACCESS = 'The founder has not shared the cap table with you.';
export const askLine = (venture) => `Ask ${venture || 'the founder'} for access. The founder answers on their Access tab.`;
export const ASK_DIALOG = {
  title: 'Ask for access?',
  sub: 'The founder is told that you asked. Nothing is shared until they choose a level on their Access tab. You can ask once a day.',
};
export const ROUNDS_NOT_RECORDED = 'Rounds and pricing are not recorded on the cap table yet.';
export const PAYOUT_NOT_SHARED = 'Your payout at the founder’s exit values is not shown: exit values live in the founder’s saved scenarios, and a shared cap table leaves scenarios out.';
export const READ_ONLY = 'Read only. The founder changes the cap table; you never open it in Raise.';

/** "As of 26 Oct 2026 · shared at Investor level by the founder". */
export function headerLine(read, asOf) {
  const day = asOf instanceof Date && !Number.isNaN(asOf.valueOf())
    ? asOf.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : null;
  const level = levelLabel(read?.level);
  const by = read?.via === 'grant' ? 'by the founder' : read?.via === 'member' ? 'to the venture’s advisors' : '';
  return [day ? `As of ${day}` : null, `shared at ${level} level${by ? ` ${by}` : ''}`].filter(Boolean).join(' · ');
}

/** The group bar: `[{ group, pct }]` in the canvas's order, or `{ reason }` when no share is recorded. */
export function groupBar(read) {
  const v = read?.view || {};
  const sums = new Map();
  if (Array.isArray(v.summary) && (v.level === 'own_position' || v.audience === 'summary')) {
    for (const g of v.summary) if (typeof g?.pct === 'number') sums.set(g.group, (sums.get(g.group) || 0) + g.pct);
  } else if (Array.isArray(v.founding)) {
    for (const h of v.founding) if (typeof h?.pct === 'number') {
      const g = GROUP_OF_TYPE[h.type] || 'Other';
      sums.set(g, (sums.get(g) || 0) + h.pct);
    }
  }
  if (!sums.size) return { parts: [], reason: v.split_reason || 'Fully diluted ownership is not recorded.' };
  const parts = GROUP_ORDER.filter((g) => sums.has(g)).map((g) => ({ group: g, pct: Math.round(sums.get(g) * 100) / 100 }));
  const total = parts.reduce((s, p) => s + p.pct, 0);
  return { parts, reason: total < 99.5 ? 'Part of the company’s ownership is not recorded, so the bar does not reach 100%.' : null };
}

/** "Your position: 1,219,512 shares (Investor) · 9.37% fully diluted", one line per row; `[]` when the record names none. */
export function ownLines(view) {
  return (view?.rows || []).map((r) => `Your position: ${r.shares} shares (${r.group}) · ${r.pct === NOT_RECORDED ? 'fully diluted share not recorded' : `${r.pct} fully diluted`}`);
}

/** The panel's whole shape from the read, or the refusal. */
export function panelOf(state) {
  if (!state || state.status === 'loading') return { kind: 'loading' };
  if (state.status === 'refused') return { kind: 'no_access' };
  if (state.status === 'error') return { kind: 'unreadable' };
  const v = sharedView(state.data);
  return { kind: v.kind, view: v, bar: groupBar(state.data), level: state.data?.level || null };
}

/** How an ask's answer is drawn. */
export function askOutcome(err) {
  const code = err?.data?.code || err?.data?.error || null;
  if (!err) return { asked: true, line: 'Asked. The founder answers on their Access tab.' };
  if (code === 'already_asked') return { asked: true, line: 'You asked in the last day. The founder answers on their Access tab.' };
  if (code === 'already_shared') return { asked: false, line: 'The founder already shares it with you. Reload to see it.', reload: true };
  return { asked: false, line: err?.message || 'Your ask could not be sent. Try again.' };
}
