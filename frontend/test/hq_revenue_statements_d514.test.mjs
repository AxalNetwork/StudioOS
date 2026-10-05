/**
 * D514 (#1016) — HQ Revenue statements: the draw is held, a floor is never
 * issued, the void advice is true, and the row draws what the payload carries.
 *
 * Rendered with react-dom/server and read as text: these assertions are about
 * what an operator sees, not about how the source is spelled.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderedText } from './_renderedText.mjs';
import { codeOnly } from './_codeOnly.mjs';
import {
  StatementActions, StatementFacts, StatementDrawHeld, STATEMENT_DRAW_HELD,
  statementAllowsIssue, statementDisputePayload, floorsInCurrency,
} from '../src/pages/hq/RevenuePage.jsx';

const render = (el) => renderedText(renderToStaticMarkup(el));
const actions = (statement) => renderToStaticMarkup(React.createElement(StatementActions, { statement, onUpdate: async () => ({}) }));
const COMPLETE = { complete: true, unreported_streams: 0, estimated_streams: 0 };
const FLOOR = { complete: false, unreported_streams: 3, estimated_streams: 0 };
const row = (extra) => ({ uid: 'st_1', licence_uid: 'lic_fr', brand_name: 'Axal France', period: '2026-Q3', owed_cents: 3500, currency: 'EUR', paid_cents: 0, disputed_cents: 0, ...extra });

test('a floor draft offers no "Mark as issued"; a complete draft does', () => {
  const floor = actions(row({ status: 'draft', ...FLOOR }));
  assert.doesNotMatch(renderedText(floor), /Mark as issued(?! is unavailable)/);
  assert.match(floor, /data-testid="hq-statement-no-issue"/);
  assert.match(renderedText(floor), /unavailable while the owed figure is a floor/);
  const full = renderedText(actions(row({ status: 'draft', ...COMPLETE })));
  assert.match(full, /Mark as issued/);
  assert.equal(statementAllowsIssue(row({ status: 'draft', ...FLOOR })), false);
  assert.equal(statementAllowsIssue(row({ status: 'draft', ...COMPLETE, estimated_streams: 1 })), false, 'an estimate is a floor too');
  assert.equal(statementAllowsIssue(row({ status: 'issued', ...COMPLETE })), false, 'only a draft is issued');
  assert.doesNotMatch(full, /Issue to subsidiary/, 'the button promised a delivery it does not make');
});

test('a void row offers nothing further and says a void period cannot be drawn again', () => {
  const h = actions(row({ status: 'void', ...COMPLETE }));
  const t = renderedText(h);
  assert.match(t, /Nothing further can be entered/);
  assert.match(t, /cannot be drawn again/);
  assert.doesNotMatch(h, /<form|<button|<input/, 'a void row still offers an action');
});

test('no rendered sentence promises a re-draw after a void', () => {
  for (const s of [row({ status: 'draft', ...COMPLETE }), row({ status: 'issued', ...FLOOR }), row({ status: 'void' })]) {
    assert.doesNotMatch(renderedText(actions(s)), /draw (it )?again(?!, voided)|void it before drawing|void and (re-?)?draw/i);
  }
});

test('payment is labelled as setting the total paid, not adding a receipt', () => {
  const t = renderedText(actions(row({ status: 'issued', ...COMPLETE })));
  assert.match(t, /Set total paid/);
  assert.match(t, /Replaces the total received so far; it does not add a receipt/);
  assert.doesNotMatch(t, /Record payment/);
});

test('a dispute can be cleared with 0, and a positive one still needs a reason', () => {
  assert.deepEqual(statementDisputePayload({ amountText: '0', note: '' }).body, { disputed_cents: 0 });
  assert.ok(statementDisputePayload({ amountText: '5', note: '' }).error);
  assert.ok(statementDisputePayload({ amountText: '-1', note: 'x' }).error);
  assert.match(renderedText(actions(row({ status: 'issued', ...COMPLETE }))), /0 clears the dispute/);
});

test('the draw editor is replaced by the hold, which offers no form', () => {
  const h = renderToStaticMarkup(React.createElement(StatementDrawHeld));
  assert.ok(renderedText(h).includes(STATEMENT_DRAW_HELD));
  assert.doesNotMatch(h, /<form|<select|<button/);
});

test('the row draws outstanding, when the paid total was entered, and how fresh the reports were', () => {
  const t = render(React.createElement(StatementFacts, { statement: row({ status: 'issued', outstanding_cents: 1500, paid_at: '2026-10-01T09:00:00Z', reports_as_of: '2026-09-30T00:00:00Z', disputed_cents: 500 }) }));
  assert.match(t, /outstanding/);
  assert.match(t, /15/);
  assert.match(t, /paid total entered 2026-10-01/);
  assert.match(t, /reports as of 2026-09-30/);
  assert.match(t, /who entered the dispute, and when, is not recorded/);
  const bare = render(React.createElement(StatementFacts, { statement: row({ status: 'draft', outstanding_cents: 3500, paid_at: null, reports_as_of: null }) }));
  assert.match(bare, /no payment entered/);
  assert.match(bare, /reports as of: Not recorded/);
  assert.doesNotMatch(bare, /dispute/);
});

test('a per-currency line summing floors says it is a floor', () => {
  const items = [row({ uid: 'a', status: 'draft', ...FLOOR }), row({ uid: 'b', status: 'issued', ...COMPLETE }),
    row({ uid: 'c', status: 'void', ...FLOOR }), row({ uid: 'd', currency: 'GBP', status: 'draft', ...FLOOR })];
  assert.equal(floorsInCurrency(items, 'EUR'), 1, 'a void floor is not counted, a complete one is not a floor');
  assert.equal(floorsInCurrency(items, 'GBP'), 1);
  assert.equal(floorsInCurrency(items, 'USD'), 0);
});

test('the rail no longer says the page enters no payment', () => {
  const page = codeOnly(readFileSync(resolve(process.cwd(), 'frontend/src/pages/hq/RevenuePage.jsx'), 'utf8'));
  assert.doesNotMatch(page, /enters no payment/);
  assert.match(page, /the paid and disputed totals on a branch statement are figures an HQ operator types in/);
});
