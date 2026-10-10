import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { isRecordablePage } from '../ui/assistCost';

/**
 * The caller's own AI spend, and the router's real price list.
 *
 * `AssistRail` used to take `totalSpend` and `planCap` as props, which meant
 * every caller quoted itself. This hook is the live source: `/api/ai/me/spend`
 * over the caller's own `ai_usage_logs` rows, and `/api/ai/pricing` for the
 * per-1M-token figures the estimate is computed from.
 *
 * THE HONESTY CONTRACT, which callers must not flatten:
 *
 *   spend.recorded === false   the usage table could not be read. `spend_usd`
 *                              is null, and the meter must SAY so rather than
 *                              drawing an empty bar — an absent fact is not a
 *                              zero fact, and a 0% meter asserts one.
 *   spend.recorded === true    the figures are real, and 0 means zero.
 *
 * `enforced_usd` is reported separately from `spend_usd` on purpose: the first
 * is the KV counter that will refuse the next call, the second is the durable
 * log sum. They can disagree (KV has no atomic increment and its keys expire),
 * and merging them would show one as the other.
 *
 * `page` (D552 step 3) adds a third read: `/api/ai/me/spend?surface=<page>`,
 * that page's month and last run from the caller's own rows. It is made only
 * for a path the router records (`isRecordablePage`); for any other, and
 * without `page`, `pageSpend` stays null and no request is sent. Its failure
 * is `pageSpendError`, kept apart from the account read's for the same reason
 * the two above are.
 *
 * Fetched once per mount, not polled. Spend moves when the user runs something,
 * and a rail that re-fetches on a timer would spend more D1 reads describing
 * the cost than the runs it describes.
 */
export default function useAiSpend({ enabled = true, page = null } = {}) {
  const [spend, setSpend] = useState(null);
  const [pricing, setPricing] = useState(null);
  const [spendError, setSpendError] = useState(null);
  const [pricingError, setPricingError] = useState(null);
  const [pageSpend, setPageSpend] = useState(null);
  const [pageSpendError, setPageSpendError] = useState(null);
  const pageKey = isRecordablePage(page) ? page : null;
  const [loading, setLoading] = useState(!!enabled);
  // Bumped by `reload`, which is what an Unreadable's Retry calls. A counter
  // rather than a callback that re-runs the fetch inline, so the one effect
  // below stays the only place the two reads happen.
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) { setLoading(false); return undefined; }
    let live = true;
    setLoading(true);
    Promise.all([
      api.myAiSpend().catch((e) => ({ __err: e })),
      api.aiPricing().catch((e) => ({ __err: e })),
      pageKey ? api.myAiSpend(pageKey).catch((e) => ({ __err: e })) : null,
    ]).then(([s, p, ps]) => {
      if (!live) return;
      // A failed fetch is NOT "recorded: true, spend 0". Leaving `spend` null
      // keeps the two indistinguishable states apart at the component
      // boundary, which is the whole point of the contract above.
      //
      // EACH READ KEEPS ITS OWN ERROR. There used to be one `error`, set only
      // by the spend read, and a failed PRICING read was dropped on the floor:
      // `pricing` stayed null, the rail's model card vanished, and a page that
      // could not read the price list looked exactly like a page with no model
      // to offer. D400 splits them so a caller can say which read failed.
      if (s && !s.__err) { setSpend(s); setSpendError(null); } else { setSpend(null); setSpendError(s?.__err ?? new Error('spend read failed')); }
      if (p && !p.__err) { setPricing(p); setPricingError(null); } else { setPricing(null); setPricingError(p?.__err ?? new Error('pricing read failed')); }
      if (!pageKey) { setPageSpend(null); setPageSpendError(null); }
      else if (ps && !ps.__err) { setPageSpend(ps); setPageSpendError(null); }
      else { setPageSpend(null); setPageSpendError(ps?.__err ?? new Error('page spend read failed')); }
      setLoading(false);
    });
    return () => { live = false; };
  }, [enabled, attempt, pageKey]);

  // `error` stays for the callers that read it: the spend read's failure, as
  // it always was.
  return { spend, pricing, pageSpend, error: spendError, spendError, pricingError, pageSpendError, loading, reload };
}

/**
 * Per-1M-token prices for the model a task class routes to, from the router's
 * own table. Returns null when either lookup misses, so a caller cannot
 * silently quote $0 for a model whose price is not listed — an unpriced run is
 * unknown, not free.
 */
export function priceForTask(pricing, task) {
  const model = pricing?.routes?.[task]?.model;
  if (!model) return null;
  const p = pricing?.prices?.[model];
  if (!p || typeof p.in !== 'number' || typeof p.out !== 'number') return null;
  return { model, pin: p.in, pout: p.out };
}

/**
 * The menu for a task: every model the ROUTER says a caller may pick, joined
 * to the copy in `ui/railModels.js` and to the price the router bills at.
 *
 * THE MENU IS THE ROUTER'S, NOT THE RAIL'S. `alternates` comes from
 * `GET /api/ai/pricing`, which reads `ROUTE[task].alternates` — the same list
 * `run()` validates against. So the rail cannot offer a model the worker would
 * refuse, and it cannot quietly stop offering one the worker still accepts.
 * A task with no alternates returns an empty array and the rail draws no menu,
 * which is the correct rendering for `safety` and `embed`: they offer no choice
 * because letting anyone choose is the thing DECISIONS D13 forbade.
 *
 * A model with no price row is DROPPED, not rendered at zero. `priceForTask`
 * states the same rule for the single-model case — "an unpriced run is unknown,
 * not free" — and it applies with more force here, where the number sits beside
 * two other models a founder is comparing it against.
 *
 * A model with no copy still renders, on its id's last segment and with no
 * sentence. That direction is ugly rather than wrong: the model is real, the
 * router offers it, and the only thing missing is a description someone has yet
 * to write.
 */
/**
 * A model's price from the router's tables: per million tokens, or per audio
 * minute for a model billed by the minute. Null when neither table has it.
 */
export function priceOfModel(pricing, id) {
  const t = pricing?.prices?.[id];
  if (t && typeof t.in === 'number' && typeof t.out === 'number') return { kind: 'tokens', pin: t.in, pout: t.out };
  const a = pricing?.audio_prices?.[id];
  if (typeof a === 'number' && Number.isFinite(a)) return { kind: 'audio', perMinute: a };
  return null;
}

/**
 * The AIRail canvas's "Model · this page" block, from a section's jobs
 * (`ui/railModels.js`, `SECTION_JOBS`) and the router's own tables.
 *
 * ONE CARD PER MODEL IN USE. Each job runs one model: the founder's stored
 * pick when the job takes one and the router still offers it, else the
 * router's own default. Jobs on the same model share a card, so Validate's
 * tagging and drafting read as one 70B card unless the founder moves one.
 *
 * THE ALTERNATES are the models some pickable job offers and no job is
 * using, each with the tasks that would take it. A job that does not take a
 * pick (`pick: false`) offers none: its model is named, not chosen.
 *
 * A job whose router model has no price draws no card, and an alternate with
 * no price is dropped: an unpriced run is unknown, not free.
 */
export function railCards(pricing, jobs, { copy = {}, chosen = () => null } = {}) {
  const live = [];
  for (const job of jobs || []) {
    const route = pricing?.routes?.[job.task];
    if (!route?.model || !priceOfModel(pricing, route.model)) continue;
    const offered = job.pick
      ? (Array.isArray(route.alternates) ? route.alternates : []).filter((id) => priceOfModel(pricing, id))
      : [];
    const stored = job.pick ? chosen(job.task) : null;
    const model = stored && offered.includes(stored) ? stored : route.model;
    live.push({ ...job, model, routerDefault: route.model, offered });
  }
  const named = (id) => copy[id]?.name || id.split('/').pop();
  const cards = [];
  for (const j of live) {
    let card = cards.find((c) => c.id === j.model);
    if (!card) {
      card = { id: j.model, name: named(j.model), price: priceOfModel(pricing, j.model), jobs: [], isDefault: true };
      cards.push(card);
    }
    card.jobs.push(j);
    // DEFAULT is a fact about the router (D400): every job on the card runs
    // the router's own model for its task.
    if (j.model !== j.routerDefault) card.isDefault = false;
  }
  // A card is also a choice: picking it moves every job that offers its model
  // onto it, which is how a job moved to the 3B comes back to the 70B.
  for (const card of cards) {
    card.tasks = live.filter((x) => x.offered.includes(card.id) && x.model !== card.id).map((x) => x.task);
  }
  const inUse = new Set(cards.map((c) => c.id));
  const alternates = [];
  for (const j of live) {
    for (const id of j.offered) {
      if (inUse.has(id) || alternates.some((a) => a.id === id)) continue;
      alternates.push({
        id,
        name: named(id),
        why: copy[id]?.why || '',
        price: priceOfModel(pricing, id),
        tasks: live.filter((x) => x.offered.includes(id)).map((x) => x.task),
      });
    }
  }
  return { cards, alternates, pickable: live.some((j) => j.offered.length > 1) };
}

export function modelsForTask(pricing, task, { copy = {} } = {}) {
  const route = pricing?.routes?.[task];
  if (!route || !Array.isArray(route.alternates)) return [];
  return route.alternates
    .map((id) => {
      const p = pricing?.prices?.[id];
      if (!p || typeof p.in !== 'number' || typeof p.out !== 'number') return null;
      const c = copy[id] || {};
      return {
        id,
        name: c.name || id.split('/').pop(),
        why: c.why || '',
        tags: Array.isArray(c.tags) ? c.tags : [],
        pin: p.in,
        pout: p.out,
        // The model the router runs when nobody picks one: `ROUTE[task].model`,
        // read from the same response as the menu. DERIVED, not typed (D400) —
        // the badge this drives says "Default", which is a fact about the
        // router, and a fact typed into the copy table would be one nobody
        // re-checks when the router's primary changes.
        isDefault: id === route.model,
      };
    })
    .filter(Boolean);
}
