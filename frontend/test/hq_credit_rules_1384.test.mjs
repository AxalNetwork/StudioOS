/**
 * #1384 — HQ · Credits (/hq/credits): the Super Admin's page for the credit
 * reward rules and grants that `routes/admin_credit_rules.ts` (D540, D608)
 * already served and no screen called.
 *
 * What is pinned, and why:
 *   - the reason floor and the credits bound are the Worker's, read off its
 *     source, so the form cannot drift from what the route refuses;
 *   - the dollar value is shown and follows the credits (1 credit = US$1); no
 *     edit ever sends one, because the Worker refuses a value of its own;
 *   - the monthly bounty cap is listed with the rules;
 *   - a refusal reads as a sentence: the Worker's own, or a written one for a
 *     code, never the code;
 *   - a list that cannot be read says Unreadable with Retry, never an empty
 *     table; a revoked grant keeps its reason and loses its Revoke;
 *   - the page is a Super Admin route, lit under Platform, with a literal door
 *     from Platform's page.
 *
 * Run:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/hq_credit_rules_1384.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import {
  CREDIT_REASON_MIN, CREDITS_MAX, editSummary, grantState, groupRules, parseCredits, reasonHint, refusalSentence,
  ruleEdit, ruleLine, usdOfCredits,
} from '../src/lib/creditRules.js';
import { RulesSection, GrantsSection, RuleEditor, RevokePanel } from '../src/pages/hq/CreditRulesPage.jsx';
import { creditRulesApi } from '../src/lib/api/creditRules.js';
import { codeOnly } from './_codeOnly.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const text = (markup) => markup.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();
const WORKER = read('cloudflare-worker/src/routes/admin_credit_rules.ts');

const rule = (key, kind, credits, active = true) => ({
  key, kind, credits, usd_value_cents: credits * 100, active, updated_by: 1, updated_at: '2026-10-01T09:00:00Z',
});
const RULES = [
  rule('task_approved', 'reward', 10),
  rule('bug_high', 'bounty', 150),
  rule('feature_shipped_low', 'bounty', 20, false),
  rule('cap:bounty_monthly', 'cap', 500),
  rule('lab:graduation', 'lab', 250),
];
const ready = (data) => ({ status: 'ready', data });
const noop = () => {};

// ---------------------------------------------------------------------------
// What is the Worker's
// ---------------------------------------------------------------------------

test('the reason floor and the credits bound are the Worker\'s', () => {
  assert.match(WORKER, new RegExp(`export const CREDIT_REASON_MIN = ${CREDIT_REASON_MIN};`));
  assert.match(WORKER, new RegExp(`const CREDITS_MAX = ${String(CREDITS_MAX).replace(/\B(?=(\d{3})+$)/g, '_')};`));
  assert.equal(reasonHint('too short'), `At least ${CREDIT_REASON_MIN} characters (9 so far). It is recorded beside the change.`);
  assert.equal(reasonHint('Clear reason given'), null);
});

test('the value follows the credits at US$1 each, and an edit never sends a value', () => {
  assert.equal(usdOfCredits(150), 'US$150');
  assert.equal(usdOfCredits(100000), 'US$100,000');
  const edit = ruleEdit(RULES[1], { credits: '80', active: true, reason: 'Bugs are rarer now' });
  assert.deepEqual(edit, { ready: true, body: { credits: 80, active: true, reason: 'Bugs are rarer now' } });
  assert.ok(!('usd_value_cents' in edit.body));
  assert.equal(editSummary(RULES[1], edit.body), 'Was 150 credits, on. Now 80 credits, on, worth US$80.');
  // The client sends exactly what it is given: credits, active, reason.
  const src = codeOnly(read('frontend/src/lib/api/creditRules.js'));
  assert.match(src, /body: JSON\.stringify\(\{ credits, active, reason \}\)/);
  assert.doesNotMatch(src, /usd_value_cents/);
});

test('an edit that the Worker would refuse, or that changes nothing, is not sent', () => {
  const r = RULES[1];
  for (const credits of ['', '1.5', '-3', 'ten', String(CREDITS_MAX + 1)]) {
    assert.equal(ruleEdit(r, { credits, active: true, reason: 'A long enough reason' }).ready, false, credits);
  }
  assert.equal(parseCredits(String(CREDITS_MAX)), CREDITS_MAX);
  assert.equal(parseCredits('0'), 0);
  assert.deepEqual(ruleEdit(r, { credits: '150', active: true, reason: 'A long enough reason' }), { ready: false, why: 'Nothing has changed.' });
  assert.equal(ruleEdit(r, { credits: '150', active: false, reason: 'A long enough reason' }).ready, true, 'switching off alone is a change');
  assert.equal(ruleEdit(r, { credits: '90', active: true, reason: 'short' }).ready, false);
});

// ---------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------

test('the rules are grouped by kind, the cap among them, and an off rule says so', () => {
  const groups = groupRules(RULES);
  assert.deepEqual(groups.map((g) => g.kind), ['reward', 'bounty', 'cap', 'lab']);
  assert.deepEqual(groups.find((g) => g.kind === 'bounty').rules.map((x) => x.key), ['bug_high', 'feature_shipped_low']);
  assert.equal(ruleLine(RULES[0]), '10 credits · US$10');
  assert.equal(ruleLine(RULES[2]), 'Off: pays nothing (set to 20 credits)');
  assert.equal(ruleLine(RULES[3]), '500 credits a month (US$500)');
  assert.equal(ruleLine({ ...RULES[3], active: false }), 'Off: no monthly cap is applied');

  const out = text(html(h(RulesSection, { read: ready({ rules: RULES }), editing: null, onEdit: noop, onCancel: noop, onSave: noop, onRetry: noop })));
  assert.match(out, /Monthly bounty cap .*cap:bounty_monthly 500 credits a month \(US\$500\)/);
  assert.match(out, /bug_high 150 credits · US\$150/);
  assert.match(out, /lab:graduation 250 credits · US\$250/);
  assert.equal((out.match(/\bEdit\b/g) || []).length, RULES.length, 'every rule, the cap included, can be edited');
});

test('an unreadable rules list says Unreadable with Retry, never an empty table', () => {
  const markup = html(h(RulesSection, { read: { status: 'unreadable' }, onRetry: noop }));
  assert.match(markup, /data-testid="credit-rules-unreadable"/);
  assert.match(text(markup), /^Unreadable The credit rules could not be read\. This is not an empty list\. Retry$/);
  assert.doesNotMatch(markup, /data-testid="credit-rules"/);
  const loading = text(html(h(RulesSection, { read: { status: 'loading' } })));
  assert.equal(loading, 'Reading the rules…');
});

test('the editor shows the value it would save and the refusal it got', () => {
  const markup = html(h(RuleEditor, { rule: RULES[1], busy: false, error: 'Credits must be a whole number from 0 to 100000.', onCancel: noop, onSave: noop }));
  const out = text(markup);
  assert.match(out, /Worth US\$150\. 1 credit is US\$1; the value follows the credits\./);
  assert.match(out, /Nothing has changed\./);
  assert.match(markup, /data-testid="credit-rule-refusal"[^>]*>Credits must be a whole number from 0 to 100000\.</);
  assert.doesNotMatch(markup, /usd_value/i, 'the value is never an input');
});

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

test('a refusal reads as a sentence: the Worker\'s own, else a written one, never a code', () => {
  const worker = 'The account holds 5 credits, fewer than the 150 credits this grant paid: they have been spent, so the grant cannot be taken back without a negative balance.';
  assert.equal(refusalSentence({ message: worker, code: 'would_overdraw', status: 409 }), worker);
  assert.match(refusalSentence({ message: 'would_overdraw', code: 'would_overdraw' }), /already spent these credits/);
  assert.match(refusalSentence({ message: '', code: 'usd_value_fixed' }), /1 credit is US\$1/);
  assert.match(refusalSentence({ message: 'reason_too_short', code: 'reason_too_short' }), /at least 10 characters/);
  assert.equal(refusalSentence({ message: 'reason_too_short' }), 'The change was not saved. Nothing was changed; try again.', 'a bare code is never shown');
  assert.match(refusalSentence({ status: 403 }), /Only the Super Admin/);
  assert.equal(refusalSentence({}), 'The change was not saved. Nothing was changed; try again.');
  // Every code the route and the revoke service can refuse with has a sentence.
  const codes = new Set([...WORKER.matchAll(/code: '([a-z_]+)'/g)].map((m) => m[1]));
  for (const c of ['not_found', 'would_overdraw']) codes.add(c);
  for (const c of codes) assert.doesNotMatch(refusalSentence({ code: c }), /^The change was not saved/, c);
});

// ---------------------------------------------------------------------------
// The grants
// ---------------------------------------------------------------------------

const GRANTS = [
  { id: 9, user_id: 4, email: 'a@example.com', credits: 150, rule_key: 'bug_high', manual: false, note: 'Bug bounty', created_at: '2026-10-05T10:00:00Z', revoked: false, revoke_reason: null, revoked_at: null },
  { id: 8, user_id: 5, email: null, credits: 20, rule_key: 'manual', manual: true, note: null, created_at: '2026-10-04T10:00:00Z', revoked: true, revoke_reason: 'Granted to the wrong account', revoked_at: '2026-10-04T12:00:00Z' },
  { id: 7, user_id: 6, email: 'c@example.com', credits: -30, rule_key: 'manual', manual: true, note: 'Correction', created_at: '2026-10-03T10:00:00Z', revoked: false, revoke_reason: null, revoked_at: null },
];

test('each grant shows its revoke state; only a standing grant can be revoked', () => {
  assert.deepEqual(GRANTS.map(grantState), ['standing', 'revoked', 'deducted']);
  const markup = html(h(GrantsSection, { read: ready({ grants: GRANTS }), revoking: null, onRevoke: noop, onCancel: noop, onConfirm: noop, onRetry: noop }));
  const items = markup.split('data-testid="credit-grant"').slice(1).map((s) => text(s.slice(s.indexOf('>') + 1, s.indexOf('</li>'))));
  assert.equal(items.length, 3);
  assert.match(items[0], /a@example\.com · \+150 credits bug_high · 2026-10-05 · Bug bounty Paid Revoke/);
  assert.match(items[1], /Account #5 · \+20 credits Manual · 2026-10-04 Revoked 2026-10-04: “Granted to the wrong account” Revoked$/);
  assert.match(items[2], /c@example\.com · -30 credits Manual · 2026-10-03 · Correction Deduction$/);
  assert.equal((markup.match(/>Revoke</g) || []).length, 1);
});

test('an unreadable grants list says Unreadable with Retry, never an empty table', () => {
  const markup = html(h(GrantsSection, { read: { status: 'unreadable' }, onRetry: noop }));
  assert.match(text(markup), /^Unreadable The grants could not be read\. This is not an empty list\. Retry$/);
  assert.doesNotMatch(markup, /credit-grants-none|data-testid="credit-grants"/);
  assert.equal(text(html(h(GrantsSection, { read: ready({ grants: [] }) }))), 'No credits have been granted yet.');
});

test('the revoke panel asks for a reason, says what a spent grant does, and shows the refusal', () => {
  const markup = html(h(RevokePanel, { grant: GRANTS[0], busy: false, error: 'They have been spent.', onCancel: noop, onConfirm: noop }));
  const out = text(markup);
  assert.match(out, /Take back 150 credits from a@example\.com\. They are told, with the reason\. If they have already spent the credits, it is refused rather than leaving a negative balance\./);
  assert.match(out, /At least 10 characters \(0 so far\)/);
  assert.match(markup, /<button type="button" class="[^"]*" disabled="">Revoke<\/button>/, 'Revoke is disabled until the reason is long enough');
  assert.match(markup, /data-testid="credit-revoke-refusal"[^>]*>They have been spent\.</);
});

// ---------------------------------------------------------------------------
// Where it is wired
// ---------------------------------------------------------------------------

test('/hq/credits is the Super Admin\'s, lit under Platform, with a literal door from Platform', () => {
  const app = read('frontend/src/App.jsx');
  assert.match(app, /<Route path="\/hq\/credits" element=\{guard\(\['admin'\], hqOnly\(<HqCreditRulesPage \/>\)\)\} \/>/);
  assert.match(app, /const HqCreditRulesPage = lazy\(\(\) => import\('\.\/pages\/hq\/CreditRulesPage'\)\);/);
  const sidebar = read('frontend/src/sidebarConfig.js');
  assert.match(sidebar, /\{ to: '\/admin\/platform', icon: SlidersHorizontal, label: 'Platform', match: \['\/admin\/platform', '\/hq\/credits'\] \}/);
  assert.match(read('frontend/src/pages/hq/PlatformPage.jsx'), /<Link to="\/hq\/credits" className=\{CONSOLE_LINK\} data-testid="hq-credits-link">/);
});

test('the client calls the routes the Worker mounts, and is re-exported once', () => {
  assert.match(read('cloudflare-worker/src/index.ts'), /['"]\/api\/admin\/credit-rules['"]/);
  for (const [method, path] of [['get', "'/'"], ['put', "'/:key'"], ['get', "'/grants'"], ['post', "'/grants/:id/revoke'"]]) {
    assert.ok(WORKER.includes(`r.${method}(${path}`), `${method} ${path}`);
  }
  for (const m of ['rules', 'updateRule', 'grants', 'revokeGrant']) assert.equal(typeof creditRulesApi[m], 'function', m);
  assert.match(read('frontend/src/lib/api.js'), /export \* from '\.\/api\/creditRules\.js';/);
});
