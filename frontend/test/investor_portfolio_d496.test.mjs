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

test('IP2: the Parse review chip cannot be selected and says the decision is open', () => {
  const chip = investorZoneFilters('portfolio/updates', { value: 'all', onChange: () => {} }).find((c) => c.label.startsWith('Parse review'));
  assert.equal(chip.disabled, true, 'Parse review can be selected');
  assert.equal(chip.onSelect, undefined);
  assert.match(chip.title, /not decided yet/);
});

test('IP2: the page says parsing is not decided, and never counts a review', () => {
  // The first render is the page before its reads land: the rail is drawn, the
  // strip is not, and a figure for Parse review must not appear in either.
  const t = renderedText(renderToStaticMarkup(createElement(MemoryRouter, null, createElement(InvestorPortfolioUpdates))));
  // The page's own strip says it once the reads land. The rail said it too,
  // in an "Unavailable here" note, until that block left with the AIRail
  // canvas (owner, 2026-10-10).
  const src = readFileSync(new URL('../src/pages/investor/InvestorPortfolioUpdates.jsx', import.meta.url), 'utf8');
  assert.match(src, /<Stat label="Parse review" value="Not decided" note="Whether updates are parsed is the owner’s decision/);
  assert.doesNotMatch(t, /Parse review\s*\d/, 'parse review was counted');
});

test('IP1: Add follow-on stays an admin write, unoffered on the investor’s book', () => {
  const a = investorZoneActions('portfolio/positions').find((x) => x.label === 'Add follow-on');
  assert.equal(a.disabled, true);
  assert.match(a.title, /admin write/);
});
