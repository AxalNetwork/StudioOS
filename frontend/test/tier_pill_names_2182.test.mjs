/**
 * D700 follow-up (#2182): the connector pills, the upgrade label and the Perks
 * pill name a founder tier by its plan (D683, `TIER_PLANS`), "Validate + Build"
 * and "Raise + Grow", never as "Growth" or "Studio". The ids stay `growth` and
 * `studio`, and the Worker sends ids.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/tier_pill_names_2182.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { TIER_PLANS } from '../src/components/PaywallModal.jsx';
import { TIER_LABEL, UPGRADE_TIER, cardPill, toolRow } from '../src/pages/account/connectorsModel.js';
import { PerkCard } from '../src/pages/PerksPage.jsx';

const locked = (tier) => ({ key: tier, display_name: tier, locked: true, available: true, tier });
const perk = (required_tier, reason) => ({
  id: 1, title: 'Credits pack', partner_name: 'Partner', kind: 'tier', required_tier, reason, claimable: !reason,
});
const card = (p) => renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(PerkCard, { p, onOpen: () => {} })));

test('the connector maps are TIER_PLANS\' names, and no tier is drawn as "Pro"', () => {
  assert.deepEqual({ ...TIER_LABEL }, { growth: TIER_PLANS.growth.label, studio: TIER_PLANS.studio.label });
  assert.equal(UPGRADE_TIER, TIER_LABEL);
  assert.equal(TIER_PLANS.growth.label, 'Validate + Build');
  assert.equal(TIER_PLANS.studio.label, 'Raise + Grow');
});

test('a locked growth tool reads Validate + Build, a studio tool Raise + Grow; an unknown tier keeps the fallback', () => {
  const g = toolRow(locked('growth'));
  const s = toolRow(locked('studio'));
  assert.deepEqual([g.pill[0], g.actionLabel], ['Validate + Build', 'Upgrade to Validate + Build']);
  assert.deepEqual([s.pill[0], s.actionLabel], ['Raise + Grow', 'Upgrade to Raise + Grow']);
  assert.equal(cardPill(locked('studio')).label, 'Raise + Grow');
  const pro = toolRow(locked('pro'));
  assert.deepEqual([pro.pill[0], pro.actionLabel], ['Paid plan', 'See plans']);
  assert.equal(cardPill(locked('pro')).label, 'Paid plan');
});

test('a studio perk reads "Included in Raise + Grow"; an unknown id reads "Included in your plan"', () => {
  const studio = card(perk('studio'));
  assert.match(studio, /Included in Raise \+ Grow/);
  assert.doesNotMatch(studio, /Studio/);
  const unknown = card(perk('platinum'));
  assert.match(unknown, /Included in your plan/);
  assert.doesNotMatch(unknown, /Platinum/);
  const needs = card(perk('growth', 'tier_required'));
  assert.match(needs, /needs Validate \+ Build/);
  assert.match(needs, /Available on Validate \+ Build and above/);
  assert.doesNotMatch(needs, /Growth/);
});
