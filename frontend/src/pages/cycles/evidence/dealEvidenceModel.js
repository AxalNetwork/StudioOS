/**
 * D6164 (#6164) — the deal page's Evidence tab, drawn to the Deals v2 Evidence
 * addendum (D6163; boards DE19 before the NDA, DE20 after it, DE21 one item,
 * DE22 its states, DE30a on a phone and DE31a in dark). Pure, so
 * `frontend/test/deal_evidence_6164.test.mjs` holds each rule.
 *
 * It reads the same `GET /api/deals/:id/evidence` projection as the round call
 * and the diligence room (`investorView`, D1268) and adds only what the deal
 * page draws on top of it: the claims line, the filters and sort, the area
 * groups, the coverage table's totals and the item sheet's facts. Every count
 * here is of what the read returned; nothing counts what it held back.
 */
import { AREAS, kindWord, recordDay, sourceWord } from './evidenceModel.js';
import { claimTitle, claimWhere } from './evidenceView.js';

/** A claim's state on the deal page (DE20), each with its own glyph so no state relies on colour. */
export const DEAL_CLAIM = Object.freeze({
  backed: { glyph: '✓', word: 'Backed' },
  founders_figure: { glyph: '✎', word: 'The founder’s own figure' },
  mismatch: { glyph: '≠', word: 'Does not match' },
  not_backed: { glyph: '○', word: 'Not backed' },
});
const CLAIM_ORDER = ['backed', 'founders_figure', 'mismatch', 'not_backed'];
const UNCHECKED = { glyph: '?', word: 'Not checked yet' };
export const dealClaim = (state) => DEAL_CLAIM[state] || UNCHECKED;

/** Strength as dots and a word (DE20); null when the read carried none. */
export const STRENGTH = Object.freeze({
  measured: { dots: '●●●', word: 'Measured' },
  pattern: { dots: '●●○', word: 'Pattern' },
  anecdote: { dots: '●○○', word: 'Anecdote' },
});
export const strengthOf = (s) => STRENGTH[s] || null;

/** How the founder shared an item. A private item never reaches this read. */
export const sharedWord = (sharing) => (sharing === 'summary' ? 'Summary only' : 'After the NDA');

/** The sorts DE20 offers. "Checked" is when a claim the item backs was last checked against its record. */
export const SORTS = Object.freeze([
  { key: 'checked', label: 'Checked, newest' },
  { key: 'observed', label: 'Observed, newest' },
]);

/** How many items a closed area shows before "Show N more in this area" (DE20). */
export const AREA_PAGE = 3;

/**
 * The shared claims, as the deal sees them: each distinct claim that backs an
 * item this reader received. A claim behind only a private item is not here.
 * Null when either block failed: an unreadable read is never "0 of 0 backed".
 */
export function sharedClaims(items, claims) {
  if (!items?.ok || !claims?.ok) return null;
  const seen = new Map();
  for (const item of items.rows) {
    for (const c of item.claims || []) {
      if (seen.has(c.uid)) continue;
      seen.set(c.uid, {
        uid: c.uid, state: c.state, title: claimTitle(c), where: claimWhere(c),
        checked: recordDay(c.checked_at), checkedAt: c.checked_at || null,
      });
    }
  }
  return [...seen.values()];
}

/** The claims line (DE20): "5 of 8 shared claims are backed" and a count per state, in the canvas's order. */
export function claimSummary(rows) {
  if (!rows) return null;
  const total = rows.length;
  const count = (state) => rows.filter((r) => r.state === state).length;
  const counts = CLAIM_ORDER.map((state) => [state, count(state)]);
  const unchecked = rows.filter((r) => !DEAL_CLAIM[r.state]).length;
  if (unchecked) counts.push(['unchecked', unchecked]);
  const backed = count('backed');
  const line = total === 0
    ? 'None of the shared items backs a claim yet.'
    : `${backed} of ${total} shared ${total === 1 ? 'claim is' : 'claims are'} backed`;
  return { total, backed, counts, line };
}

/** When a claim this item backs was last checked, as a sortable stamp; null when it backs none. */
const lastChecked = (item) => (item.claims || []).map((c) => String(c.checked_at || '')).filter(Boolean).sort().pop() || null;
const newestFirst = (a, b) => {
  if (a === b) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a < b ? 1 : -1;
};

/** Items in the chosen order. Items with no date sort last, never as if dated today. */
export function sortItems(rows, key = 'checked') {
  const by = key === 'observed' ? (i) => i.observed_on || null : lastChecked;
  return [...rows].sort((a, b) => newestFirst(by(a), by(b)) || newestFirst(a.observed_on || null, b.observed_on || null) || (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0));
}

/**
 * Items by area, in the canvas's order. An area this file does not know is
 * kept, after the known ones: an item the read returned is never dropped.
 */
export function areaGroups(rows) {
  const known = AREAS.map((area) => [area, rows.filter((r) => r.area === area)]);
  const other = [...new Set(rows.map((r) => r.area).filter((a) => !AREAS.includes(a)))].map((area) => [area || 'Other', rows.filter((r) => r.area === area)]);
  return [...known, ...other].filter(([, rs]) => rs.length);
}

/** The coverage table's footer (DE19): its groups and items. Items only when every count was read. */
export function coverageTotals(groups) {
  const counts = groups.map((g) => g.count);
  const known = counts.every((n) => Number.isSafeInteger(n));
  return { groups: groups.length, items: known ? counts.reduce((a, n) => a + n, 0) : null };
}

/** DE22 C: the partial banner's second line, counting only what was shown. */
export function partialLine(shown) {
  return Number.isSafeInteger(shown)
    ? `${shown} ${shown === 1 ? 'item' : 'items'} shown. This is a partial read, not the full count.`
    : 'This is a partial read, not the full count.';
}

/** The "Filters · N" button's count on a phone: how many filters are set. */
export const filterCount = (selected) => Object.values(selected || {}).filter(Boolean).length;

/** DE21: the sheet's facts, in the canvas's order. A fact the read did not carry says why. */
export function itemFacts(item) {
  const day = recordDay(item.observed_on);
  return [
    ['Area', item.area || null, 'No area recorded'],
    ['Kind', kindWord(item.kind), null],
    ['Source', sourceWord(item.source_label), null],
    ['Provider', item.provider ? providerWord(item.provider) : null, 'No provider recorded for this item'],
    ['Strength', strengthOf(item.strength)?.word || null, 'No strength recorded'],
    ['Observed', day ? `${day} · ${item.stale ? 'stale' : 'current'}` : null, 'No date recorded for this item'],
    ['Shared', sharedWord(item.sharing), null],
    ['Summary', item.summary || null, 'No summary recorded'],
  ];
}

const PROVIDERS = { mercury: 'The company’s bank', stripe: 'Stripe', github: 'GitHub', hubspot: 'HubSpot', google: 'Google' };
export const providerWord = (p) => PROVIDERS[p] || String(p).charAt(0).toUpperCase() + String(p).slice(1);

/** The note DE21's "Add a note" prefills; the investor edits and saves it. */
export const noteDraft = (item) => `Re: ${kindWord(item.kind)} · ${item.area}\n\n`;

/** Where this item sits in its area, after the filters: "item 1 of 7". */
export function positionIn(groups, uid) {
  for (const [area, rows] of groups) {
    const i = rows.findIndex((r) => r.uid === uid);
    if (i >= 0) return { area, index: i + 1, of: rows.length };
  }
  return null;
}
