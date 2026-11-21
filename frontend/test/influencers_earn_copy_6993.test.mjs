/**
 * D6993 (#6993) — /influencers stops promising "every invoice". The hero and
 * the page description say "a share of their subscription for a set period";
 * the rate and duration sit beside Apply and come only from the tiers read; a
 * failed read shows no number; a strategic tier adds one line under the table.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/influencers_earn_copy_6993.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { installAppDom } from './_appDom.mjs';
import InfluencersPage from '../src/pages/influencer/InfluencersPage.jsx';
import { programFor } from '../src/pages/programs/registry.jsx';
import {
  HERO_LINE, RATES_UNAVAILABLE, REGISTER_TO_APPLY, STRATEGIC_NOTE, hasStrategicTier, rateLine,
} from '../src/pages/influencer/influencerPublicModel.js';

const h = React.createElement;
const PAGE = readFileSync(new URL('../src/pages/influencer/InfluencersPage.jsx', import.meta.url), 'utf8');
const response = (body, status = 200) => ({ ok: status < 400, status, statusText: '', headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const never = () => new Promise(() => {});

const AFFILIATE = { tier: 'affiliate_creator', label: 'Affiliate Creator', percentage_bps: 2000, duration_invoices: 12 };
const VERIFIED = { tier: 'verified_influencer', label: 'Verified Influencer', percentage_bps: 2500, duration_invoices: 12 };
const STRATEGIC = { tier: 'strategic_partner', label: 'Strategic Partner', percentage_bps: null, duration_invoices: null };

async function page(tiers) {
  const { restore, timers } = installAppDom({
    fetch: async (u) => {
      const [path] = String(u).split('?');
      if (path === '/api/influencer/tiers') return typeof tiers === 'function' ? tiers() : response(tiers);
      return never();
    },
  });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: ['/influencers'] },
    h(Routes, null, h(Route, { path: '/influencers', element: h(InfluencersPage) })))));
  await act(async () => { for (let i = 0; i < 14; i += 1) await new Promise((r) => setImmediate(r)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => walk(document.body).find((n) => props(n)['data-testid'] === id);
  const hero = () => walk(document.body).find((n) => n.tagName === 'SECTION' && String(n.className || '').includes('pgs-hero'));
  return {
    text: () => text(document.body), textOf: (id) => text(byId(id)), has: (id) => Boolean(byId(id)), props: (id) => props(byId(id)),
    heroText: () => text(hero()), byId, propsOf: props,
    async close() { await act(async () => root.unmount()); timers.clear(); restore(); },
  };
}

test('the page source never says "every invoice", nor types a rate or a duration', () => {
  assert.ok(!/every invoice/i.test(PAGE), '"every invoice" is gone from InfluencersPage.jsx');
  // A style's width: '100%' is not a rate; a typed rate reads "20% of…" or "20–30%".
  assert.ok(!/\d+(–\d+)?%\s+(of|each|commission)|–\d+%|\d+\s+invoices?\b|\d+\s+months?\b/i.test(PAGE.replace(/^\s*\/\/.*$/gm, '')), 'no rate or duration typed in the page');
  // D6975: the page is the programme's presentation; its purpose line and description are the map entry's.
  const p = programFor('influencer');
  assert.equal(p.purpose, HERO_LINE, 'the hero line is the shared sentence');
  assert.equal(p.og.description, HERO_LINE, 'the description says the same');
  assert.ok(!/Earn recurring revenue/.test(PAGE), 'the old headline, silent on the period, is retired');
  assert.equal(HERO_LINE, 'Share your own handle. When someone subscribes through it, you earn a share of their subscription for a set period.');
});

test('rateLine: nothing while loading, the read numbers when ready, no number when the read failed', () => {
  assert.equal(rateLine({ status: 'loading' }), null);
  assert.equal(rateLine({ status: 'ready', data: { tiers: [AFFILIATE, VERIFIED] } }), '20–25% of each subscription, for 12 invoices per member.');
  assert.equal(rateLine({ status: 'ready', data: { tiers: [{ ...AFFILIATE, duration_invoices: 6 }] } }), '20% of each subscription, for 6 invoices per member.');
  assert.equal(rateLine({ status: 'error' }), RATES_UNAVAILABLE);
  assert.equal(RATES_UNAVAILABLE, 'Rates unavailable. See the tiers below.');
  assert.ok(!/\d/.test(RATES_UNAVAILABLE));
  assert.equal(hasStrategicTier([AFFILIATE, STRATEGIC]), true);
  assert.equal(hasStrategicTier([AFFILIATE, VERIFIED]), false);
  assert.equal(hasStrategicTier(null), false);
});

test('ready: the hero says a set period, the read rate sits beside Apply, the table agrees on duration', async () => {
  const view = await page({ tiers: [AFFILIATE, VERIFIED] });
  try {
    const hero = view.heroText();
    assert.match(hero, /a share of their subscription for a set period/);
    assert.ok(!/every invoice/i.test(view.text()));
    assert.equal(view.textOf('influencers-apply'), 'Apply', 'the Apply label is unchanged');
    assert.equal(view.props('influencers-apply').href, REGISTER_TO_APPLY, 'and so is its sign-up link');
    assert.equal(view.textOf('influencers-rate-line'), '20–25% of each subscription, for 12 invoices per member.');
    // D6975: beside Apply means in the same availability panel.
    let panel = view.byId('influencers-apply');
    while (panel && view.propsOf(panel)['data-testid'] !== 'program-panel') panel = panel.parentNode;
    assert.ok(panel, 'Apply is in the availability panel');
    const inside = (n, t) => n === t || (n.childNodes || []).some((c) => inside(c, t));
    assert.ok(inside(panel, view.byId('influencers-rate-line')), 'the rate line sits beside Apply');
    assert.match(view.text(), /Affiliate Creator20% · 12 invoices · /, 'the table says the same duration');
    assert.ok(!view.text().includes(STRATEGIC_NOTE), 'no strategic tier, no strategic line');
  } finally { await view.close(); }
});

test('a strategic tier in the read adds one line under the table', async () => {
  const view = await page({ tiers: [AFFILIATE, STRATEGIC] });
  try {
    assert.match(view.text(), /Signed terms keep their own until they are replaced\. A strategic agreement can differ; its terms are in the agreement\./, 'one line under the table');
    assert.equal(STRATEGIC_NOTE, 'A strategic agreement can differ; its terms are in the agreement.');
  } finally { await view.close(); }
});

test('a failed tier read shows no rate and no duration anywhere on the page', async () => {
  const view = await page(() => response({ error: 'tiers_unreadable' }, 503));
  try {
    assert.equal(view.textOf('influencers-rate-line'), RATES_UNAVAILABLE);
    assert.ok(!/\d+(–\d+)?\s*%|\d+\s+invoices?/.test(view.text()), 'no rate or duration number on the page');
    assert.ok(!view.text().includes(STRATEGIC_NOTE));
  } finally { await view.close(); }
});
