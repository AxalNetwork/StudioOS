/**
 * D1604 (#3716, aird1, aird3, aird5, pd9k) — the AIRail on the pitch pages:
 * which models each element group runs, and what the deck has used. Pure
 * data and helpers; `ui/WorkerRail.jsx` draws them through its `groups` prop
 * (`ui/RailGroups.jsx`).
 *
 * THE RAIL IS MODELS AND CONSUMPTION ONLY (owner rule). Nothing here runs a
 * model, takes typed words or offers an action: a group is a model choice,
 * usage is a read. The switch stays D765's "Turn off AI assistance on this
 * page" (owner answer D(a)).
 *
 *   DECK_RAIL_GROUPS  the element groups of the area lightbox's picker (pd4,
 *                     `deckV2Model.ELEMENT_GROUPS`), each mapped to the rail
 *                     options on main (`lib/railOptions/founder.js`) whose
 *                     model it picks. The lead option's suggestions are what
 *                     the group shows (at most three, `railView`); a pick is
 *                     stored for every option of the group that offers that
 *                     model (`PUT /api/ai/rail/pick`). A group with no option
 *                     on main reads "Not set up yet" from the adapter (#3754,
 *                     per-element routing, which replaces the option lists).
 *   PRESETS           Fast · Balanced · Best · Custom, greyed "Coming later"
 *                     until #3796 (and the HQ lock with #3786)
 *   deckRail(deckId)  the `groups` prop: the groups, the presets and the
 *                     usage rows. "Held now" is on main (`GET
 *                     /api/ai-budget/holds`); "Estimated for this deck" and
 *                     "Spent on this deck" read `deckV2Adapter.deckUsage`
 *                     (#3776) and are drawn only when it answers, never as
 *                     $0.00.
 */

import { aiBudgetApi } from '../../../lib/api/aiBudget.js';
import { availability, deckUsage, presets as presetsRead } from './deckV2Adapter.js';
import { ELEMENT_GROUPS, LATER } from './deckV2Model.js';

/** The page key the pitch pages' rail reads (`lib/railOptions/founder.js`). */
export const DECK_RAIL_PAGE = 'Founder · Raise · Pitch deck';

/** Shown on a group whose models are not routed yet. */
export const NOT_SET_UP = 'Not set up yet';

/** "Title, Body, Bullets, Call-out…": the first element names a group runs for. */
export function usedBy(groupIds, max = 4) {
  const names = ELEMENT_GROUPS.filter((g) => groupIds.includes(g.id)).flatMap((g) => g.items.map((i) => i.label));
  if (!names.length) return null;
  return names.length > max ? `${names.slice(0, max).join(', ')}…` : names.join(', ');
}

const G = (id, label, options, elements, extra = {}) => Object.freeze({
  id, label, options: Object.freeze(options), usedBy: extra.usedBy ?? usedBy(elements), ...extra,
});
const off = (name) => {
  const a = availability(name);
  return Object.freeze({ reason: a?.reason || null, issue: a?.issue ?? null });
};

/**
 * The groups, in aird1's order. `options` are rail option keys on main, lead
 * first; `unavailable` marks a group whose models wait on the adapter;
 * `safety` is the guard, always on and never picked.
 */
export const DECK_RAIL_GROUPS = Object.freeze([
  G('text', 'Text', ['deck:rewrite', 'deck:build', 'deck:outline', 'deck:shorten', 'deck:expand'], ['text']),
  G('images', 'Images', ['deck:image'], ['images']),
  G('graphics', 'Graphics', [], ['graphics'], { unavailable: off('elementModels') }),
  G('data', 'Data', ['deck:chart', 'deck:table', 'deck:timeline'], ['data']),
  G('diagrams', 'Diagrams', [], ['diagrams'], { unavailable: off('elementModels') }),
  G('venture', 'Venture records', [], ['venture'], { unavailable: off('elementModels') }),
  G('vision', 'Vision and checks', ['review:deck-file'], [], { usedBy: 'Deck review' }),
  G('safety', 'Safety', [], [], { safety: true, usedBy: null }),
]);

/** The four presets (aird1), drawn greyed until #3796. */
export const PRESETS = Object.freeze({
  options: Object.freeze(['Fast', 'Balanced', 'Best', 'Custom']),
  later: LATER,
  read: presetsRead,
});

const money = (micro) => `$${(Math.max(0, Number(micro) || 0) / 1e6).toFixed(2)}`;

/**
 * "Held now" from `GET /api/ai-budget/holds`: the sum the runs in progress
 * hold and how many they are, or null when the reply is not a list (the row
 * then says it could not be read, never $0.00).
 */
export function heldNow(reply) {
  const list = Array.isArray(reply?.holds) ? reply.holds : null;
  if (!list) return null;
  const micro = list.reduce((s, h) => s + (Number(h?.included_microusd) || 0) + (Number(h?.topup_microusd) || 0), 0);
  const n = list.length;
  return n ? `${money(micro)} · ${n} run${n === 1 ? '' : 's'} in progress` : 'Nothing held · no run in progress';
}

/**
 * The `groups` prop for a pitch page. `usage` rows answer the adapter's
 * shape: `{ available: true, value }` is drawn, anything else is not drawn
 * at all (`hideUnavailable`) or, for a read on main, "Could not be read".
 */
export function deckRail(deckId = null) {
  return {
    page: DECK_RAIL_PAGE,
    items: DECK_RAIL_GROUPS,
    presets: PRESETS,
    usage: [
      {
        id: 'held', label: 'Held now',
        read: () => aiBudgetApi.holds().then((r) => {
          const v = heldNow(r);
          return v == null ? { available: false, unreadable: true } : { available: true, value: v };
        }),
      },
      { id: 'estimated', label: 'Estimated for this deck', hideUnavailable: true, read: () => deckUsage(deckId).then((a) => (a?.available ? { available: true, value: a.value?.estimated } : a)) },
      { id: 'spent', label: 'Spent on this deck', hideUnavailable: true, read: () => deckUsage(deckId).then((a) => (a?.available ? { available: true, value: a.value?.spent } : a)) },
    ],
  };
}
