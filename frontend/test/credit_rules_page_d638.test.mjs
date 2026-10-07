/**
 * D638 (#1384) — HQ · Credit rules: the Super Admin's reward rules and grants.
 *
 * What this pins:
 *   - the registries: search, filters, the count line and pages of 25;
 *   - the four states of each list: loading, empty, "Not recorded" with its
 *     reason, and "Unreadable" with Try again, never an empty table;
 *   - a rule edit sends only what changed, never the dollar value, and every
 *     write carries a reason of at least ten characters;
 *   - the Worker's refusals read as sentences, the spent-credits revoke among
 *     them;
 *   - the route is the Super Admin's, the review queue is its door, and the
 *     client calls the Worker's routes.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/credit_rules_page_d638.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { codeOnly } from './_codeOnly.mjs';
import {
  REASON_MIN, filterGrants, filterRules, pageOf, reasonReady, refusalSentence, ruleAmount, ruleChanges,
  ruleUpdated, submitRevoke, submitRule,
} from '../src/lib/creditRules.js';
import { GrantsTable, RulesTable, ReasonCard } from '../src/pages/hq/CreditRulesPage.jsx';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const text = (el) => html(el).replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');

const RULES = [
  { key: 'bug_high', kind: 'bounty', credits: 150, usd_value_cents: 15000, active: true, updated_by: 30, updated_at: '2026-10-05T10:00:00Z' },
  { key: 'cap:bounty_monthly', kind: 'cap', credits: 500, usd_value_cents: 50000, active: true, updated_by: null, updated_at: '2026-10-01 00:00:00' },
  { key: 'lab:graduation', kind: 'lab', credits: 250, usd_value_cents: 25000, active: false, updated_by: null, updated_at: '2026-10-01 00:00:00' },
];
const GRANTS = [
  { id: 9, user_id: 4, email: 'ada@example.test', credits: 150, rule_key: 'bug_high', manual: false, source_ref: 'ticket:7', note: 'A bug', created_at: '2026-10-06T09:00:00Z', revoked: false },
  { id: 8, user_id: 5, email: null, credits: 50, rule_key: 'manual', manual: true, source_ref: 'admin:30:x', note: 'Goodwill', created_at: '2026-10-05T09:00:00Z', revoked: false },
  { id: 7, user_id: 4, email: 'ada@example.test', credits: -20, rule_key: 'manual', manual: true, source_ref: 'support:1', note: 'Fix', created_at: '2026-10-04T09:00:00Z', revoked: false },
  { id: 6, user_id: 6, email: 'bo@example.test', credits: 20, rule_key: 'bug_low', manual: false, source_ref: 'ticket:2', note: '', created_at: '2026-10-03T09:00:00Z', revoked: true, revoke_reason: 'Duplicate report', revoked_at: '2026-10-04T10:00:00Z' },
];
const ready = (data) => ({ status: 'ready', data });

test('the registries filter by kind, source, state and search, and page by 25 with the count line', () => {
  assert.deepEqual(filterRules(RULES, { kind: 'cap' }).map((r) => r.key), ['cap:bounty_monthly']);
  assert.deepEqual(filterRules(RULES, { q: 'LAB' }).map((r) => r.key), ['lab:graduation']);
  assert.deepEqual(filterGrants(GRANTS, { source: 'manual' }).map((g) => g.id), [8, 7]);
  assert.deepEqual(filterGrants(GRANTS, { source: 'rule' }).map((g) => g.id), [9, 6]);
  assert.deepEqual(filterGrants(GRANTS, { state: 'revoked' }).map((g) => g.id), [6]);
  assert.deepEqual(filterGrants(GRANTS, { state: 'standing' }).map((g) => g.id), [9, 8, 7]);
  assert.deepEqual(filterGrants(GRANTS, { q: 'ada' }).map((g) => g.id), [9, 7]);
  assert.deepEqual(filterGrants(GRANTS, { q: '5' }).map((g) => g.id), [8], 'an account id matches exactly');
  assert.deepEqual(filterGrants([{ id: 1, user_id: 15 }], { q: '5' }), [], 'not as part of a longer id');
  const sixty = Array.from({ length: 60 }, (_, i) => i);
  assert.deepEqual([pageOf(sixty, 1).count, pageOf(sixty, 3).count, pageOf(sixty, 3).rows.length], ['1–25 of 60', '51–60 of 60', 10]);
  assert.equal(pageOf(sixty, 9).page, 3, 'a page past the end is the last page');
  assert.deepEqual([pageOf([], 1).count, pageOf([], 1).pages], ['0 of 0', 1]);
});

test('a rule edit sends only what changed and never the dollar value; the reason has a floor', () => {
  const rule = RULES[0];
  assert.deepEqual(ruleChanges(rule, { credits: '175', active: true }), { changes: { credits: 175 } });
  assert.deepEqual(ruleChanges(rule, { credits: '150', active: false }), { changes: { active: false } });
  assert.match(ruleChanges(rule, { credits: '150', active: true }).error, /Nothing changed/);
  for (const bad of ['', '1.5', '-1', '100001', 'abc']) assert.match(ruleChanges(rule, { credits: bad, active: true }).error, /whole number from 0 to 100,000/, bad);
  assert.deepEqual(ruleChanges(rule, { credits: '100000', active: true }), { changes: { credits: 100000 } });
  assert.equal(REASON_MIN, 10);
  assert.equal(reasonReady('  123456789 '), false);
  assert.equal(reasonReady('1234567890'), true);
});

test('saving a rule calls the Worker with the changes and the trimmed reason, and says the refusal', async () => {
  const calls = [];
  const save = async (...a) => { calls.push(a); return { rule: { ...RULES[0], credits: 175 } }; };
  assert.deepEqual(await submitRule(RULES[0], { credits: '175', active: true }, '  Raised for Q4 bugs  ', save), { ok: true, rule: { ...RULES[0], credits: 175 } });
  assert.deepEqual(calls, [['bug_high', { credits: 175 }, 'Raised for Q4 bugs']]);
  assert.match((await submitRule(RULES[0], { credits: '175', active: true }, 'short', save)).error, /at least 10 characters/);
  assert.match((await submitRule(RULES[0], { credits: '150', active: true }, 'Nothing to change', save)).error, /Nothing changed/);
  assert.equal(calls.length, 1, 'nothing is sent that the page can refuse');
  const refused = await submitRule(RULES[0], { credits: '175', active: true }, 'Raised for Q4 bugs', async () => {
    throw Object.assign(new Error('No reward rule is named bug_high.'), { status: 404, code: 'rule_unknown' });
  });
  assert.deepEqual([refused.ok, refused.error], [false, 'No reward rule is named bug_high.']);
});

test('taking a grant back: the reason goes with it, and spent credits are refused in a sentence', async () => {
  const calls = [];
  assert.deepEqual(await submitRevoke(GRANTS[0], ' Paid on a duplicate ', async (...a) => { calls.push(a); }), { ok: true });
  assert.deepEqual(calls, [[9, 'Paid on a duplicate']]);
  assert.match((await submitRevoke(GRANTS[0], 'too short', async () => {})).error, /at least 10 characters/);
  const spent = Object.assign(new Error('The account holds 40 credits, fewer than the 150 credits this grant paid: they have been spent, so the grant cannot be taken back without a negative balance.'),
    { status: 409, code: 'would_overdraw', data: { error: 'would_overdraw', balance: 40 } });
  const out = await submitRevoke(GRANTS[0], 'Paid on a duplicate', async () => { throw spent; });
  assert.equal(out.error, `${spent.message} Nothing was taken back.`);
  const bare = Object.assign(new Error('would_overdraw'), { code: 'would_overdraw', data: { balance: 12 } });
  assert.equal(refusalSentence(bare), 'The credits have already been spent. The account holds 12 credits now. Nothing was taken back.');
  assert.match(refusalSentence({ status: 403, message: 'forbidden' }), /Only the Super Admin can change credit rules/);
  assert.equal(refusalSentence({}, 'Fallback.'), 'Fallback.');
});

test('a rule names its amount in dollars, and a rule nobody changed says so', () => {
  assert.equal(ruleAmount(RULES[0]), '150 credits (US$150)');
  assert.equal(ruleAmount(RULES[1]), '500 credits a month (US$500)');
  assert.deepEqual(ruleUpdated(RULES[0]), { nr: false, text: '2026-10-05 · admin #30' });
  assert.match(ruleUpdated(RULES[1]).reason, /migration that created the rule/);
});

test('each list in its four states: loading, Unreadable with Try again, empty, and rows', () => {
  const noop = () => {};
  assert.match(text(h(RulesTable, { read: { status: 'loading', data: null }, onRetry: noop, onSaved: noop })), /Loading the rules/);
  const bad = html(h(RulesTable, { read: { status: 'unreadable', data: null }, onRetry: noop, onSaved: noop }));
  assert.match(bad, /Unreadable\./);
  assert.match(bad, /Try again/);
  assert.doesNotMatch(bad, /<table/, 'an unreadable list is never drawn as a table');
  assert.match(text(h(RulesTable, { read: ready({ rules: [] }), onRetry: noop, onSaved: noop })), /No reward rule exists yet/);
  const rows = html(h(RulesTable, { read: ready({ rules: RULES }), onRetry: noop, onSaved: noop }));
  assert.match(rows, /data-testid="rule-row-cap:bounty_monthly"/, 'the cap is listed with the rules');
  assert.match(rows, /500 credits a month \(US\$500\)/);
  assert.match(rows, /title="Set by the migration that created the rule[^"]*">Not recorded</);
  assert.match(text(h(RulesTable, { read: ready({ rules: RULES }), onRetry: noop, onSaved: noop })), /1–3 of 3/);
  assert.doesNotMatch(rows, /usd_value|Dollar value/, 'the value is never an input');

  const gbad = html(h(GrantsTable, { read: { status: 'unreadable', data: null }, onRetry: noop, onChanged: noop }));
  assert.match(gbad, /Try again/);
  assert.doesNotMatch(gbad, /<table/);
  assert.match(text(h(GrantsTable, { read: ready({ grants: [] }), onRetry: noop, onChanged: noop })), /No credit has been granted yet/);
  const g = html(h(GrantsTable, { read: ready({ grants: GRANTS }), onRetry: noop, onChanged: noop }));
  assert.match(g, /title="No email is on record for account #5\.">Not recorded</);
  assert.match(text(h(GrantsTable, { read: ready({ grants: GRANTS }), onRetry: noop, onChanged: noop })), /−20 Manual adjustment/);
  assert.match(g, /title="Duplicate report">Taken back 2026-10-04/);
  // Take back is offered on a standing grant of credits only.
  const rowOf = (id) => { const at = g.indexOf(`data-testid="grant-row-${id}"`); return g.slice(at, g.indexOf('</tr>', at)); };
  const takeBack = (id) => rowOf(id).includes('>Take back</button>');
  assert.deepEqual([9, 8, 7, 6].map(takeBack), [true, true, false, false]);
});

test('the reason card states its floor and keeps submit disabled until it is met', () => {
  const card = html(h(ReasonCard, { title: 'T', submitLabel: 'Save', onSubmit: () => {}, onCancel: () => {} }));
  assert.match(card, /At least 10 characters \(0 so far\)/);
  assert.match(card, /<button type="submit"[^>]*disabled=""/);
});

test('the page is the Super Admin\'s at /admin/credit-rules, the review queue links to it, and the client calls the Worker', async () => {
  const app = codeOnly(read('frontend/src/App.jsx'));
  assert.match(app, /<Route path="\/admin\/credit-rules" element=\{guard\(\['admin'\], hqOnly\(<CreditRulesPage \/>\)\)\} \/>/);
  assert.match(codeOnly(read('frontend/src/pages/hq/ReviewQueuePage.jsx')), /<Link to="\/admin\/credit-rules"/);
  globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  globalThis.document ??= { cookie: '' };
  const original = globalThis.fetch; const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push([init.method || 'GET', String(url).replace(/^.*\/api/, ''), init.body ? JSON.parse(init.body) : null]);
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const { creditRulesApi } = await import('../src/lib/api/creditRules.js');
    await creditRulesApi.rules();
    await creditRulesApi.updateRule('cap:bounty_monthly', { credits: 600 }, 'Raising the cap');
    await creditRulesApi.grants();
    await creditRulesApi.revokeGrant(9, 'Paid on a duplicate');
    assert.deepEqual(calls, [
      ['GET', '/admin/credit-rules', null],
      ['PUT', '/admin/credit-rules/cap%3Abounty_monthly', { credits: 600, reason: 'Raising the cap' }],
      ['GET', '/admin/credit-rules/grants', null],
      ['POST', '/admin/credit-rules/grants/9/revoke', { reason: 'Paid on a duplicate' }],
    ]);
  } finally { globalThis.fetch = original; }
});
