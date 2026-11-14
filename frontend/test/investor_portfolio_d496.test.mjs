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
  // D4817 part 4 (#5311, PF-04): the strip is the Portfolio frame's SummaryTile.
  assert.match(src, /<SummaryTile label="Source handling" value="Source-preserved"/);
  assert.doesNotMatch(src, /asked on #\d+|<(?:Stat|SummaryTile) label="Parse review"/);
  assert.doesNotMatch(t, /Parse review/i);
});

test('IP1: Add follow-on stays an admin write, and the investor’s book no longer draws a button that can never be enabled (D6205)', () => {
  // With the page's own handler and view, as InvestorPortfolioPositions hands them.
  const ops = investorZoneActions('portfolio/positions', { handlers: { markHistory: () => {} }, view: { header: ['Company'], rows: [{ name: 'A' }], cells: (r) => [r.name] } });
  // Export greys out only while the book has no rows, a state that passes; nothing else may be disabled.
  assert.equal(ops.find((x) => x.label === 'Add follow-on'), undefined);
  assert.equal(ops.some((x) => x.disabled), false, 'no permanently disabled op on Positions');
});
