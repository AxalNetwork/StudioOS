import { perkListingCounts, perkListingRows } from '../../lib/perkListings.js';
import { statusLabel } from '../../pages/testing/programmeModel.js';
import { title } from './format.js';
import { OFFER_GROUPS } from '../shellConfig.js';
import { NOT_RECORDED } from '../../lib/absence.js';

/*
 * D4841 (#4841) — the `/offers` root as an Offer Readiness dashboard (Offers V2
 * canvas, OF-01 and OF-09a, #4872).
 *
 * PURE, AND READ OVER THE BOARD'S OWN SOURCES. Every function here takes the
 * per-source states `useBucketSources(partnerOffersBoard(...).sources)` returns
 * — the same reads the six zones make (`partnerOffers.js` says which), so a
 * figure at the root is the figure its zone prints, by construction rather than
 * by a second aggregate route. A source that is still loading reads as loading,
 * one that failed reads `Unreadable` (never zero), and a field the read did not
 * carry reads `Not recorded`. A zero is printed only when a read succeeded and
 * counted nothing, which is a measured zero.
 *
 * THREE RULES ARE MIRRORED, NOT IMPORTED, because each lives in a page module the
 * router loads lazily and a static import would pull that page into the root:
 *   · a service is Live when it has a price and is listed — `catalogState` in
 *     `pages/ServiceCatalogPage.jsx`;
 *   · a programme is live when it is approved, open or testing — the Testing
 *     zone's `VIEW_STATUSES.live` (`pages/partner/offers/TestingZone.jsx`);
 *   · client-approved proof is the worker's `published_count`, the figure the
 *     Proof zone's Published tile prints.
 * `offer_readiness_4841.test.mjs` imports the real page functions and holds each
 * mirror equal to them, so the two cannot drift silently.
 *
 * WHAT NEEDS ATTENTION is at most `ATTENTION_CAP` items, each produced by a
 * recorded state a reader can act on in one zone, with that zone as its target.
 * No state, no item — an empty list is said in words, never padded. The list is
 * held until every source it reads has settled, so items do not reorder (or
 * slip past the cap) as reads arrive one by one.
 */

export const ATTENTION_CAP = 3;
export { NOT_RECORDED };
export const UNREADABLE = 'Unreadable';

/** The canvas's grouping of the six zones by commercial purpose (the data lives in `shellConfig.js`). */
export { OFFER_GROUPS };

/** Zone slug → the board source it reads (`partnerOffers.js` `sources`). */
export const ZONE_SOURCE = {
  catalog: 'catalog',
  'perk-deals': 'perks',
  visibility: 'visibility',
  proof: 'proof',
  'audience-fit': 'fit',
  testing: 'testing',
};

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const listOf = (d) => (Array.isArray(d?.items) ? d.items : null);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Mirrors `catalogState` (ServiceCatalogPage.jsx): no price is a Draft; listed and priced is Live. */
export function serviceState(o) {
  if (o?.price_cents == null) return 'Draft';
  return o.is_active ? 'Live' : 'Unlisted';
}

/** The Catalog zone's strip counts, over the whole catalogue it reads. */
export function catalogCounts(items) {
  const rows = Array.isArray(items) ? items : [];
  const by = (s) => rows.filter((o) => serviceState(o) === s).length;
  return { total: rows.length, live: by('Live'), draft: by('Draft'), unlisted: by('Unlisted') };
}

/** Mirrors the Testing zone's `VIEW_STATUSES.live`. */
export const LIVE_PROGRAMME_STATUSES = ['approved', 'open', 'testing'];

/** The Testing zone's chip groups, counted over every programme it reads. */
export function programmeCounts(items) {
  const rows = Array.isArray(items) ? items : [];
  const is = (statuses) => rows.filter((p) => statuses.includes(p?.status)).length;
  return {
    total: rows.length,
    live: is(LIVE_PROGRAMME_STATUSES),
    waiting: is(['submitted']),
    drafts: is(['draft', 'rejected']),
    sentBack: is(['rejected']),
  };
}

/** One source's state, normalised: `loading` | `unreadable` | `ready`. */
function stateOf(src) {
  if (!src || src.state === 'loading') return 'loading';
  if (src.state === 'error') return 'unreadable';
  return 'ready';
}

/** A metric that cannot be drawn from its read yet, or ever. */
function pending(base, src) {
  const state = stateOf(src);
  if (state === 'loading') return { ...base, state, value: null, note: null };
  if (state === 'unreadable') return { ...base, state, value: UNREADABLE, note: null };
  return null;
}

/**
 * The five readiness figures, in the canvas's order. Each names the zone it
 * reconciles with (`slug`), so the tile is a link to the page that prints the
 * same number.
 */
export function readinessMetrics(byKey = {}) {
  const out = [];

  const cat = byKey.catalog;
  const catBase = { key: 'services', slug: 'catalog', label: 'Services live' };
  const catItems = listOf(cat?.data);
  out.push(pending(catBase, cat) || (catItems
    ? (() => {
      const c = catalogCounts(catItems);
      return {
        ...catBase, state: 'ready', value: String(c.live),
        note: `of ${c.total} · ${c.draft} draft · ${c.unlisted} unlisted`,
      };
    })()
    : { ...catBase, state: 'ready', value: NOT_RECORDED, note: null }));

  const perks = byKey.perks;
  const perkBase = { key: 'perks', slug: 'perk-deals', label: 'Perks' };
  const perkItems = listOf(perks?.data);
  out.push(pending(perkBase, perks) || (perkItems
    ? (() => {
      const c = perkListingCounts(perkItems);
      return {
        ...perkBase, state: 'ready', value: `${c.live} live`,
        note: `${c.in_review} in review · ${plural(c.total, 'submitted', 'submitted')}`,
      };
    })()
    : { ...perkBase, state: 'ready', value: NOT_RECORDED, note: null }));

  const proof = byKey.proof;
  const proofBase = { key: 'proof', slug: 'proof', label: 'Client-approved proof' };
  const proofItems = listOf(proof?.data);
  out.push(pending(proofBase, proof) || (isNum(proof?.data?.published_count)
    ? {
      ...proofBase, state: 'ready', value: String(proof.data.published_count),
      note: proofItems ? `of ${plural(proofItems.length, 'item')}` : null,
    }
    : { ...proofBase, state: 'ready', value: NOT_RECORDED, note: null }));

  const fit = byKey.fit;
  const fitBase = { key: 'fit', slug: 'audience-fit', label: 'Audience fit' };
  const fitItems = listOf(fit?.data);
  out.push(pending(fitBase, fit) || (fitItems
    ? {
      ...fitBase, state: 'ready',
      value: plural(fitItems.filter((r) => r.is_active).length, 'rule'),
      note: isNum(fit.data.unstated_count)
        ? `in use · ${fit.data.unstated_count} missing a reply`
        : `in use · replies ${NOT_RECORDED.toLowerCase()}`,
    }
    : { ...fitBase, state: 'ready', value: NOT_RECORDED, note: null }));

  const testing = byKey.testing;
  const testBase = { key: 'testing', slug: 'testing', label: 'Testing programmes' };
  const testItems = listOf(testing?.data);
  out.push(pending(testBase, testing) || (testItems
    ? (() => {
      const c = programmeCounts(testItems);
      return {
        ...testBase, state: 'ready', value: `${c.live} live`,
        note: `${c.waiting} waiting for HQ · ${plural(c.drafts, 'draft')}`,
      };
    })()
    : { ...testBase, state: 'ready', value: NOT_RECORDED, note: null }));

  return out;
}

/** A brand-new firm: its catalogue was read and holds nothing. The canvas's OF-01 B. */
export function isNewFirm(byKey = {}) {
  const items = stateOf(byKey.catalog) === 'ready' ? listOf(byKey.catalog?.data) : null;
  return Array.isArray(items) && items.length === 0;
}

/** The sources the attention list reads. It waits for all of them to settle. */
const ATTENTION_SOURCES = ['catalog', 'perks', 'visibility', 'proof', 'fit', 'testing'];

/**
 * What needs attention, most valuable first, capped at `ATTENTION_CAP`.
 *
 * Every candidate is a recorded state (a count the read returned, or a row in a
 * named status) and names the one zone where it is acted on. A source that
 * failed contributes nothing: its tile already says Unreadable, and an item
 * built on a read that did not happen would be invented.
 *
 * @returns {{ state: 'loading' | 'ready', items: object[], candidates: number }}
 */
export function attentionItems(byKey = {}) {
  if (ATTENTION_SOURCES.some((k) => stateOf(byKey[k]) === 'loading')) {
    return { state: 'loading', items: [], candidates: 0 };
  }
  const ready = (k) => (stateOf(byKey[k]) === 'ready' ? byKey[k].data : null);
  const newFirm = isNewFirm(byKey);
  const found = [];

  // PROVE — trust first: the canvas ranks proof above everything else.
  const proof = ready('proof');
  const proofItems = listOf(proof);
  if (proofItems && !newFirm) {
    const total = proofItems.length;
    const selfStated = isNum(proof.self_stated_count) ? proof.self_stated_count : null;
    if (total === 0) {
      found.push({
        key: 'proof-none', slug: 'proof', title: 'Add client-approved proof',
        body: 'No proof is recorded yet. A result a client approves is the strongest thing a founder sees.',
        cta: 'Add proof',
      });
    } else if (selfStated) {
      found.push({
        key: 'proof-unapproved', slug: 'proof', title: 'Strengthen your storefront',
        body: `${selfStated} of ${plural(total, 'proof item')} ${selfStated === 1 ? 'has' : 'have'} no client approval yet.`,
        cta: 'Request approval',
      });
    }
  }

  // TARGET — a rule in use with no reply is a pass that lands as silence.
  const fit = ready('fit');
  const fitItems = listOf(fit);
  if (fitItems && !newFirm) {
    const active = fitItems.filter((r) => r.is_active).length;
    if (active === 0) {
      found.push({
        key: 'fit-none', slug: 'audience-fit', title: 'Define your ideal client',
        body: 'No fit rule is in use, so Pipeline has nothing to rank your leads against.',
        cta: 'Add a fit rule',
      });
    } else if (isNum(fit.unstated_count) && fit.unstated_count > 0) {
      const n = fit.unstated_count;
      found.push({
        key: 'fit-unstated', slug: 'audience-fit', title: 'Finish your audience-fit rules',
        body: `${plural(n, 'rule')} in use ${n === 1 ? 'has' : 'have'} no reply for the leads ${n === 1 ? 'it turns' : 'they turn'} away.`,
        cta: 'Review audience fit',
      });
    }
  }

  // TEST — a programme only the firm can move: sent back by HQ, or a draft.
  const testItems = listOf(ready('testing'));
  if (testItems) {
    const sentBack = testItems.find((p) => p?.status === 'rejected');
    const draft = testItems.find((p) => p?.status === 'draft' && p?.owner_kind !== 'hq');
    if (sentBack) {
      found.push({
        key: 'testing-sent-back', slug: 'testing', title: 'A testing programme was sent back',
        body: `HQ sent ${sentBack.product_name || 'a programme'} back. Revise it and submit it again.`,
        cta: 'Review programme',
      });
    } else if (draft) {
      found.push({
        key: 'testing-draft', slug: 'testing', title: 'A testing programme is waiting for you',
        body: `${draft.product_name || 'A programme'} is a draft. Submit it to HQ when it is ready.`,
        cta: 'Review programme',
      });
    }
  }

  // SELL — a service with no price is not live, whatever its listing says.
  const catItems = listOf(ready('catalog'));
  if (catItems && !newFirm) {
    const { draft } = catalogCounts(catItems);
    if (draft > 0) {
      found.push({
        key: 'catalog-drafts', slug: 'catalog', title: `Price ${draft === 1 ? 'a draft service' : 'your draft services'}`,
        body: `${plural(draft, 'service')} ${draft === 1 ? 'has' : 'have'} no price, so ${draft === 1 ? 'it is' : 'they are'} not live.`,
        cta: 'Open catalog',
      });
    }
  }
  const perkItems = listOf(ready('perks'));
  if (perkItems) {
    const rejected = perkListingRows(perkItems).filter((r) => r.review === 'rejected');
    if (rejected.length) {
      found.push({
        key: 'perks-rejected', slug: 'perk-deals', title: rejected.length === 1 ? 'A perk was not approved' : 'Perks were not approved',
        body: `${plural(rejected.length, 'perk')} came back from review. Edit and resubmit.`,
        cta: 'Review perk deals',
      });
    }
  }

  // PROVE — engagements that name no surface are counted against none.
  const vis = ready('visibility');
  if (vis && isNum(vis.unattributed_count) && vis.unattributed_count > 0) {
    const n = vis.unattributed_count;
    found.push({
      key: 'visibility-unattributed', slug: 'visibility', title: `${plural(n, 'engagement')} with no source`,
      body: `${n === 1 ? 'It is' : 'They are'} counted against no surface, so Visibility cannot say where ${n === 1 ? 'it' : 'they'} came from.`,
      cta: 'Review attribution',
    });
  }

  return { state: 'ready', items: found.slice(0, ATTENTION_CAP), candidates: found.length };
}

/**
 * Up to `limit` compact rows for one zone's preview inside its group, from the
 * zone's own read: `[{ key, label, status }]`. A field the row does not carry
 * is null, which the view renders as `Not recorded`.
 */
export function zonePreview(slug, data, limit = ATTENTION_CAP) {
  const items = listOf(data);
  if (!items) return [];
  const take = (rows) => rows.slice(0, limit);
  if (slug === 'catalog') {
    return take(items.map((o, i) => ({ key: o.id ?? i, label: o.title || null, status: serviceState(o) })));
  }
  if (slug === 'perk-deals') {
    return take(perkListingRows(items).map((r, i) => ({ key: r.key ?? i, label: r.name, status: r.reviewLabel || null })));
  }
  if (slug === 'proof') {
    return take(items.map((p, i) => ({
      key: p.id ?? i, label: p.title || null,
      status: p.is_published ? 'Client approved' : 'Not client-approved',
    })));
  }
  if (slug === 'visibility') {
    return take(items.map((s, i) => ({
      key: s.id ?? i, label: s.name || null,
      status: isNum(s.engagement_count) ? plural(s.engagement_count, 'engagement') : null,
    })));
  }
  if (slug === 'audience-fit') {
    return take(items.filter((r) => r.is_active).map((r, i) => ({
      key: r.id ?? i, label: r.statement || r.value || null,
      status: title(r.kind) || null,
    })));
  }
  if (slug === 'testing') {
    return take(items.map((p, i) => ({ key: p.uid ?? i, label: p.product_name || null, status: statusLabel(p.status) })));
  }
  return [];
}
