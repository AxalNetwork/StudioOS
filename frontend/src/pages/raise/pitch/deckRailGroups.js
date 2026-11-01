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
 *                     `deckV2Model.ELEMENT_GROUPS`). D1503 (#3754): on a deck,
 *                     each element group (`elements: true`) reads its routes
 *                     from the Worker's per-element reply (`GET
 *                     /api/decks/:id/element-models`, through
 *                     `deckV2Adapter.elementModels`): the group's lead
 *                     element's suggestions (at most three) and its stored
 *                     pick, which is what the next run of the group uses. A
 *                     pick is stored as the deck's group pick (`PUT …/element-
 *                     models`, key `group:<group>`); HQ's lock refuses it and
 *                     the block says so. A group whose elements run no model
 *                     reads the Worker's "No model · free". On a page with no
 *                     deck yet (New deck, Templates) there is no reply, so a
 *                     group keeps the rail options on main it read before
 *                     (`lib/railOptions/founder.js`, `PUT /api/ai/rail/pick`),
 *                     and one with none reads "Not set up yet".
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
import { deckElementModelsApi } from '../../../lib/api/deckElementModels.js';
import { deckUsage, elementModels, presets as presetsRead } from './deckV2Adapter.js';
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
/** Why a group with no option on main has nothing to pick on a page with no deck: models are picked per deck. */
const NO_DECK = Object.freeze({ reason: 'Models are picked per deck: open a deck to pick them.', issue: null });

/**
 * The groups, in aird1's order. `elements` marks a group the Worker's
 * per-element reply answers on a deck; `options` are the rail option keys on
 * main a page with no deck still reads, lead first; `safety` is the guard,
 * always on and never picked.
 */
export const DECK_RAIL_GROUPS = Object.freeze([
  G('text', 'Text', ['deck:rewrite', 'deck:build', 'deck:outline', 'deck:shorten', 'deck:expand'], ['text'], { elements: true }),
  G('images', 'Images', ['deck:image'], ['images'], { elements: true }),
  G('graphics', 'Graphics', [], ['graphics'], { elements: true }),
  G('data', 'Data', ['deck:chart', 'deck:table', 'deck:timeline'], ['data'], { elements: true }),
  G('diagrams', 'Diagrams', [], ['diagrams'], { elements: true }),
  G('venture', 'Venture records', [], ['venture'], { elements: true }),
  G('vision', 'Vision and checks', ['review:deck-file'], [], { usedBy: 'Deck review' }),
  G('safety', 'Safety', [], [], { safety: true, usedBy: null }),
]);

/**
 * One group's block as `RailGroups` reads it, from the per-element reply: its
 * lead element's suggestions and `more` (#3741's shape), the pick the next
 * run uses, and the Worker's "No model · free" for a group that runs none. A
 * reply that is off or unreadable is thrown, so the block says so.
 */
export function groupAnswer(answer, groupId) {
  if (!answer?.available) throw Object.assign(new Error(answer?.reason || 'could not be read'), { status: answer?.unreadable ? 500 : 404 });
  const g = (answer.value?.groups || []).find((x) => x?.group === groupId);
  if (!g) throw Object.assign(new Error('This group is not in the answer.'), { status: 404 });
  if (g.free) return { ok: true, models: [], more: [], pick: null, free: g.free, billing: answer.value.billing };
  return {
    ok: true, models: g.suggested || [], more: g.more || [], pick: g.pick ?? null, billing: answer.value.billing,
    locked: Boolean(g.resolved?.locked), notice: g.resolved?.notice ?? null,
  };
}

/** The groups for a page: on a deck, each element group reads and picks through the per-element routes. */
export function railItems(deckId) {
  if (deckId == null) {
    return DECK_RAIL_GROUPS.map((g) => (g.elements && !g.options.length ? Object.freeze({ ...g, unavailable: NO_DECK }) : g));
  }
  return DECK_RAIL_GROUPS.map((g) => (!g.elements ? g : Object.freeze({
    ...g,
    read: () => elementModels(deckId).then((a) => groupAnswer(a, g.id)),
    pick: (model) => deckElementModelsApi.pick(deckId, { scope: 'deck', key: `group:${g.id}`, model }),
  })));
}

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
/**
 * D1524 (#3776): the balance in plain units, "About 40 text areas or 12
 * images", from the top-up balance and the deck's per-run prices. Dollars
 * elsewhere, never credits. Null when either price or the balance is unknown.
 */
export function plainUnits(balanceMicro, units) {
  if (balanceMicro == null || balanceMicro === '') return null;
  const b = Number(balanceMicro);
  const t = Number(units?.text_area_microusd);
  const i = Number(units?.image_microusd);
  if (!Number.isFinite(b) || b < 0 || !(t > 0) || !(i > 0)) return null;
  return `About ${Math.floor(b / t)} text areas or ${Math.floor(b / i)} images`;
}

/** A row of the deck's usage: the formatted figure, or "Could not be read" when the Worker could not read it. */
const usageRow = (a, key) => (a?.available ? (a.value?.[key] ? { available: true, value: a.value[key] } : { available: false, unreadable: true }) : a);

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
    items: railItems(deckId),
    presets: PRESETS,
    usage: [
      {
        id: 'held', label: 'Held now',
        read: () => aiBudgetApi.holds().then((r) => {
          const v = heldNow(r);
          return v == null ? { available: false, unreadable: true } : { available: true, value: v };
        }),
      },
      { id: 'estimated', label: 'Estimated for this deck', hideUnavailable: true, read: () => deckUsage(deckId).then((a) => usageRow(a, 'estimated')) },
      { id: 'spent', label: 'Spent on this deck', hideUnavailable: true, read: () => deckUsage(deckId).then((a) => usageRow(a, 'spent')) },
      {
        id: 'units', label: 'Your balance in plain units', hideUnavailable: true,
        read: async () => {
          const a = await deckUsage(deckId);
          if (!a?.available) return a;
          try {
            const line = plainUnits((await aiBudgetApi.mine())?.balance_microusd, a.value?.units);
            return line ? { available: true, value: line } : { available: false, unreadable: true };
          } catch { return { available: false, unreadable: true }; }
        },
      },
    ],
  };
}
