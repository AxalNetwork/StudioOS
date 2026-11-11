/**
 * D496 (#1023, the Portfolio PR): the investor Portfolio family built up to the
 * owner's line. IP2 "Parse review" waits on an owner decision (question 6 on
 * #1023), and the chip, the strip and the stated limit all say so instead of
 * counting a review that cannot exist. IP1 "Add follow-on" stays admin-only.
 */
import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { renderedText } from './_renderedText.mjs';
import { investorZoneFilters } from '../src/workspaces/investorZoneFilters.js';
import { investorZoneActions } from '../src/workspaces/investorZoneActions.js';
import InvestorPortfolioUpdates from '../src/pages/investor/InvestorPortfolioUpdates.jsx';

test('IP2: internal parse-review working copy is not offered to investors', () => {
  const chips = investorZoneFilters('portfolio/updates', { value: 'all', onChange: () => {} });
  assert.equal(chips.some((chip) => /parse review/i.test(chip.label)), false);
});

test('IP2: the page explains source handling without exposing implementation decisions', () => {
  const t = renderedText(renderToStaticMarkup(createElement(MemoryRouter, null, createElement(InvestorPortfolioUpdates))));
  const src = readFileSync(new URL('../src/pages/investor/InvestorPortfolioUpdates.jsx', import.meta.url), 'utf8');
  assert.match(src, /<Stat label="Source handling" value="Source-preserved"/);
  assert.doesNotMatch(src, /asked on #\d+|<Stat label="Parse review"/);
  assert.doesNotMatch(t, /Parse review/i);
});

test('IP1: Add follow-on stays an admin write, unoffered on the investor’s book', () => {
  const a = investorZoneActions('portfolio/positions').find((x) => x.label === 'Add follow-on');
  assert.equal(a.disabled, true);
  assert.match(a.title, /admin write/);
});
