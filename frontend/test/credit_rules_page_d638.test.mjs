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
 *
 * Since #1412 this is the only credit rules page: `/hq/credits` (#1399's copy)
 * redirects here, and what #1399's page showed that this one did not is
 * carried over and pinned below: what each kind of rule does, the value and
 * the before/after line in an edit, a deduction and a take-back's reason in
 * plain sight, the grant's note, a notice after each write, and a sentence
 * for a refusal that arrives as a bare code.
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
  CREDITS_MAX, REASON_MIN, editHint, editSummary, filterGrants, filterRules, grantState, grantStateText, kindNotesFor, pageOf,
  reasonReady, refusalSentence, revokeNotice, ruleAmount, ruleChanges, ruleNotice, ruleUpdated, submitRevoke,
  submitRule, valueLine,
} from '../src/lib/creditRulesRegistry.js';
import { GrantsTable, Notice, RuleForm, RulesTable, ReasonCard } from '../src/pages/hq/CreditRulesRegistryPage.jsx';

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
  assert.deepEqual(filterGrants(GRANTS, { state: 'standing' }).map((g) => g.id), [9, 8]);
  assert.deepEqual(filterGrants(GRANTS, { state: 'deducted' }).map((g) => g.id), [7], 'a deduction is its own state');
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
  assert.deepEqual(await submitRevoke(GRANTS[0], ' Paid on a duplicate ', async (...a) => { calls.push(a); }), { ok: true, result: null });
  assert.deepEqual(calls, [[9, 'Paid on a duplicate']]);
  assert.deepEqual(await submitRevoke(GRANTS[0], 'Paid on a duplicate', async () => ({ status: 'revoked', notified: true })),
    { ok: true, result: { status: 'revoked', notified: true } }, 'the Worker\'s answer is kept for the notice');
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
  assert.match(g, /data-testid="grant-state-6">Taken back 2026-10-04: “Duplicate report”</, 'the reason is in plain sight, not a hover');
  assert.match(g, /data-testid="grant-state-7">Deduction</);
  assert.match(g, /data-testid="grant-state-9">Standing</);
  assert.match(text(h(GrantsTable, { read: ready({ grants: GRANTS }), onRetry: noop, onChanged: noop })), /bug_high A bug Standing/, 'the grant\'s note is shown');
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
  // #1412 — Platform's Perk credits zone is the other door, and the page lights the Platform row.
  assert.match(codeOnly(read('frontend/src/pages/hq/PlatformPage.jsx')), /<Link to="\/admin\/credit-rules" className=\{CONSOLE_LINK\} data-testid="hq-credits-link">/);
  assert.match(codeOnly(read('frontend/src/sidebarConfig.js')), /label: 'Platform', match: \['\/admin\/platform', '\/admin\/credit-rules'\] \}/);
  assert.match(app, /<Route path="\/hq\/credits" element=\{<HqCreditsRedirect \/>\} \/>/);
  assert.doesNotMatch(app, /pages\/hq\/CreditRulesPage'/, 'one page: #1399\'s copy is gone');
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
    await creditRulesApi.updateRule('bug_low', { active: false }, 'Switched off for now');
    await creditRulesApi.grants();
    await creditRulesApi.revokeGrant(9, 'Paid on a duplicate');
    assert.deepEqual(calls, [
      ['GET', '/admin/credit-rules', null],
      ['PUT', '/admin/credit-rules/cap%3Abounty_monthly', { credits: 600, reason: 'Raising the cap' }],
      ['PUT', '/admin/credit-rules/bug_low', { active: false, reason: 'Switched off for now' }],
      ['GET', '/admin/credit-rules/grants', null],
      ['POST', '/admin/credit-rules/grants/9/revoke', { reason: 'Paid on a duplicate' }],
    ]);
  } finally { globalThis.fetch = original; }
});

// ---------------------------------------------------------------------------
// #1412 — what #1399's page showed, carried over
// ---------------------------------------------------------------------------

const WORKER = read('cloudflare-worker/src/routes/admin_credit_rules.ts');

test('#1412: the reason floor and the credits bound are the Worker\'s', () => {
  assert.ok(WORKER.includes(`export const CREDIT_REASON_MIN = ${REASON_MIN};`));
  assert.ok(WORKER.includes(`const CREDITS_MAX = ${CREDITS_MAX.toLocaleString('en-US').replace(/,/g, '_')};`));
});

test('#1412: the rules say what each kind does, for the kinds listed', () => {
  assert.deepEqual(kindNotesFor(RULES).map((k) => k.label), ['Bounty', 'Monthly cap', 'Lab milestone']);
  assert.deepEqual(kindNotesFor([{ kind: 'mystery' }]).map((k) => k.kind), ['reward'], 'an unknown kind reads as a reward');
  const out = text(h(RulesTable, { read: ready({ rules: RULES }), onRetry: () => {}, onSaved: () => {} }));
  assert.match(out, /Monthly cap The most bounty credits one member can earn in a calendar month\. A bounty that would cross it is refused whole\./);
  assert.doesNotMatch(out, /Reward Paid once when the event happens/, 'a kind with no rule is not explained');
  assert.doesNotMatch(text(h(RulesTable, { read: ready({ rules: [] }), onRetry: () => {}, onSaved: () => {} })), /Paid once/);
});

test('#1412: an edit shows what the credits are worth and the change it would save', () => {
  assert.equal(valueLine('175'), 'Worth US$175. 1 credit is US$1; the value follows the credits.');
  assert.equal(valueLine('1.5'), 'A whole number from 0 to 100,000.');
  assert.equal(valueLine(''), 'A whole number from 0 to 100,000.', 'an empty field is not worth US$0');
  assert.equal(editSummary(RULES[0], { credits: 1750 }), 'Was 150 credits, on. Now 1,750 credits, on, worth US$1,750.');
  assert.equal(editSummary(RULES[2], { active: true }), 'Was 250 credits, off. Now 250 credits, on, worth US$250.');
  assert.equal(editSummary({ ...RULES[0], credits: 1 }, { active: false }), 'Was 1 credit, on. Now 1 credit, off, worth US$1.');
  assert.equal(editHint(RULES[0], { credits: '175', active: true }), 'Was 150 credits, on. Now 175 credits, on, worth US$175.');
  assert.match(editHint(RULES[0], { credits: '150', active: true }), /^Nothing changed\./);
  assert.match(editHint(RULES[0], { credits: '-1', active: true }), /^Credits must be a whole number/);
  const form = text(h(RuleForm, { rule: RULES[0], onSaved: () => {}, onCancel: () => {} }));
  assert.match(form, /Worth US\$150\. 1 credit is US\$1; the value follows the credits\./);
  assert.match(form, /Nothing changed\./, 'an unchanged form says so instead of a summary');
  // The form opens unchanged, so a static render cannot reach the before/after
  // line; the form draws editHint, whose both halves are pinned above.
  assert.match(codeOnly(read('frontend/src/pages/hq/CreditRulesRegistryPage.jsx')), /data-testid="rule-form-hint">\{editHint\(rule, \{ credits, active \}\)\}<\/p>/);
});

test('#1412: each write is confirmed in a sentence', () => {
  assert.equal(ruleNotice(RULES[0], { credits: 175 }), 'bug_high saved. Was 150 credits, on. Now 175 credits, on, worth US$175.');
  assert.equal(revokeNotice(GRANTS[0], { status: 'revoked', notified: true }), '150 credits taken back from ada@example.test.');
  assert.equal(revokeNotice(GRANTS[1], { status: 'revoked', notified: false }), '50 credits taken back from account #5. The inbox notice could not be sent.');
  assert.equal(revokeNotice(GRANTS[0], { status: 'already_revoked' }), 'That grant was already taken back. Nothing more was taken from ada@example.test.');
  assert.match(html(h(Notice, { text: 'bug_high saved.' })), /role="status"[^>]*>bug_high saved\.</);
  assert.equal(html(h(Notice, { text: null })), '');
  assert.deepEqual([grantState(GRANTS[3]), grantStateText({ revoked: true })], ['revoked', 'Taken back']);
});

test('#1412: a refusal that arrives as a bare code reads as a sentence, never the code', () => {
  assert.equal(refusalSentence({ code: 'usd_value_fixed', message: 'usd_value_fixed' }, 'F.'), '1 credit is US$1, so the value follows the credits. Change the credits instead.');
  assert.equal(refusalSentence({ message: 'reason_too_short' }, 'F.'), 'F.', 'a code with no code field is not shown');
  assert.equal(refusalSentence({ code: 'forbidden' }), 'Only the Super Admin can change credit rules. Nothing was changed.');
  assert.equal(refusalSentence({ code: 'rule_unknown', message: 'No reward rule is named x.' }), 'No reward rule is named x.', 'the Worker\'s own sentence wins');
  // Every code the route and the revoke service refuse with has a sentence.
  const codes = new Set([...WORKER.matchAll(/code: '([a-z_]+)'/g)].map((m) => m[1]));
  for (const c of ['not_found', 'would_overdraw', 'forbidden']) codes.add(c);
  assert.ok(codes.size >= 6, [...codes].join());
  for (const c of codes) assert.notEqual(refusalSentence({ code: c }, 'FALLBACK'), 'FALLBACK', c);
});
