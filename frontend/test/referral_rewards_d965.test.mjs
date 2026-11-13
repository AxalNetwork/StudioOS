/**
 * D965 (#2798) — Programs part 12: referral rewards paid in perk credits,
 * on the admin pages and the member page.
 *
 *   · the Rewards card's rows from the rules read: credits and when, "Off"
 *     with its reason for a rule HQ switched off, "Not recorded" for a rule
 *     with no row, and strategic case by case;
 *   · the Rewards issued tile's two figures: the exact count, and the
 *     credits paid for a Super Admin, "Not read here yet" for an Admin;
 *   · the Queue's save line for what a move paid;
 *   · the member page promises no credits while a rule is off, or unread.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/referral_rewards_d965.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import {
  CARD_FOOT, CASE_BY_CASE, PAID_HQ_ONLY, RULE_MISSING, RULE_OFF, SETTLED_OFF_PLATFORM,
  memberRewardMatrix, paidFigure, rewardRows, rewardSaveLine,
} from '../src/lib/referralRewards.js';
import { RewardsCard, RewardsIssuedTile } from '../src/pages/admin/programs/ReferRewards.jsx';
import { ReferralDialog } from '../src/pages/admin/ReferralReview.jsx';
import { REFUSALS } from '../src/pages/admin/programs/programPagesModel.js';
import { PROGRAMS } from '../src/pages/admin/programs/programsModel.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const h = React.createElement;
const ready = (data) => ({ status: 'ready', data, error: null, at: Date.now() });
const failed = () => ({ status: 'error', data: null, error: { status: 503 }, at: null });
const loading = { status: 'loading', data: null, error: null, at: null };

// GET /api/refer-earn/admin/rewards, in the Worker's shape.
const RULES = [
  { key: 'referral:startup_accepted', category: 'startup', pays_at: 'converted', when: 'on acceptance', credits: 100, active: true },
  { key: 'referral:startup_formed', category: 'startup', pays_at: 'reward_issued', when: 'on formation', credits: 400, active: true },
  { key: 'referral:customer_onboarded', category: 'customer', pays_at: 'reward_issued', when: 'once onboarded', credits: 50, active: true },
];
const PAID = { grants: 6, credits: 1200, by_rule: {} };

async function mount(tree, handle = null) {
  const restore = installDocument();
  const prev = globalThis.fetch;
  const requests = [];
  if (handle) globalThis.fetch = async (u, o = {}) => { requests.push({ url: String(u), method: String(o.method || 'GET'), body: o.body }); return handle(String(u), o); };
  const container = document.createElement('div'); document.body.appendChild(container);
  const rootNode = createRoot(container);
  await act(async () => rootNode.render(h(MemoryRouter, null, tree)));
  const flush = () => act(async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  return {
    requests, flush,
    text: () => text(container),
    textOf: (id) => text(byId(id)),
    has: (id) => Boolean(byId(id)),
    props: (id) => props(byId(id)),
    hrefs: () => walk(container).filter((n) => String(n.tagName).toUpperCase() === 'A').map((n) => props(n).href),
    async change(id, value) { await act(async () => { props(byId(id)).onChange({ target: { value } }); }); await flush(); },
    async click(id) { await act(async () => { await props(byId(id)).onClick({ preventDefault() {} }); }); await flush(); },
    async close() { await act(async () => rootNode.unmount()); globalThis.fetch = prev; restore(); },
  };
}
const response = (body, status = 200) => ({ ok: status < 400, status, statusText: '', headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

test('the Rewards card’s rows: credits and when, Off with its reason, Not recorded, strategic case by case', () => {
  const rows = rewardRows(RULES);
  assert.deepEqual(rows.map((r) => [r.key, r.lines.map((l) => l.text)]), [
    ['startup', ['100 credits on acceptance', '400 credits on formation']],
    ['customer', ['50 credits once onboarded']],
    ['strategic', [CASE_BY_CASE]],
  ]);
  const off = rewardRows([{ ...RULES[0], active: false }, { ...RULES[1], credits: null, active: false }]);
  assert.deepEqual(off[0].lines.map((l) => [l.text, l.reason]), [['Off on acceptance', RULE_OFF], ['Not recorded on formation', RULE_MISSING]]);
  assert.ok(off[0].lines.every((l) => !/\d/.test(l.text)), 'a rule that is off shows no amount');
});

test('the tile’s second figure: credits paid for a Super Admin, Not read here yet for an Admin, never 0', () => {
  assert.deepEqual(paidFigure(ready({ rules: RULES, paid: PAID })), { state: 'ready', text: '1,200 credits paid' });
  assert.deepEqual(paidFigure(ready({ rules: RULES, paid: null })), { state: 'hq', word: 'Not read here yet', reason: PAID_HQ_ONLY });
  assert.equal(paidFigure(failed()).state, 'unreadable');
  assert.equal(paidFigure(loading).state, 'loading');
});

test('the Queue’s save line names what the move paid', () => {
  assert.equal(rewardSaveLine(null), null);
  assert.equal(rewardSaveLine({ rule_key: 'referral:startup_accepted', paid: true, credits: 100, ledger_id: 3 }), '100 credits paid to the referrer.');
  assert.equal(rewardSaveLine({ rule_key: 'x', paid: false, code: 'rule_inactive' }), 'No credits paid: HQ has switched this reward off.');
  assert.equal(rewardSaveLine({ rule_key: 'x', paid: false, code: 'not_eligible' }), 'No credits paid: partner and admin accounts do not earn perk credits.');
  assert.match(REFUSALS.reward_not_paid, /did not move\. Nothing was saved\./);
});

test('the member matrix promises credits only from a rule that is on, and nothing when unread', () => {
  const on = memberRewardMatrix([
    { key: 'startup', reward: '100 perk credits on acceptance, and 400 perk credits on formation.', rewards: [{ rule_key: 'a' }, { rule_key: 'b' }] },
    { key: 'customer', reward: 'No perk credits are paid for this kind of referral now.', rewards: [] },
    { key: 'strategic', reward: 'Invite-only economics, negotiated case by case.', rewards: [] },
  ]);
  assert.deepEqual(on.map((r) => [r.cat, r.model]), [['Startup / founder', 'Perk credits'], ['Platform user', 'No perk credits now'], ['Strategic & capital', 'Invite-only / custom']]);
  assert.equal(on[0].note, '100 perk credits on acceptance, and 400 perk credits on formation.');
  const unread = memberRewardMatrix(null);
  assert.ok(unread.slice(0, 2).every((r) => r.model === 'Not read' && !/credits? (on|once)/.test(r.note)));
  const page = read('frontend/src/pages/ReferralsPage.jsx');
  assert.ok(!/REWARD_MATRIX|Milestone-based|'Platform credit'/.test(page), 'the hard-coded matrix is gone');
  assert.match(page, /memberRewardMatrix\(overview\?\.categories\)/);
});

test('mounted: the tile counts exactly and shows the credits paid to a Super Admin; an Admin reads Not read here yet', async () => {
  const sup = await mount(h(RewardsIssuedTile, { issued: ready({ items: [], total: 6 }), rewards: ready({ rules: RULES, paid: PAID }), onRetry() {} }));
  try {
    assert.equal(sup.textOf('programs-tile-rewards-issued-value'), '6');
    assert.match(sup.textOf('programs-tile-rewards-issued'), /1,200 credits paid/);
    assert.match(sup.textOf('programs-tile-rewards-issued'), new RegExp(SETTLED_OFF_PLATFORM.slice(0, 40)));
  } finally { await sup.close(); }
  const adm = await mount(h(RewardsIssuedTile, { issued: ready({ items: [], total: 6 }), rewards: ready({ rules: RULES, paid: null }), onRetry() {} }));
  try {
    assert.match(adm.textOf('programs-tile-rewards-issued'), /Credits paid: Not read here yet\. HQ reads these figures\./);
    assert.doesNotMatch(adm.textOf('programs-tile-rewards-issued'), /\b0 credits/);
  } finally { await adm.close(); }
  const bad = await mount(h(RewardsIssuedTile, { issued: failed(), rewards: ready({ rules: RULES, paid: PAID }), onRetry() {} }));
  try {
    assert.match(bad.textOf('programs-tile-rewards-issued'), /Could not be read/);
    assert.ok(!bad.has('programs-tile-rewards-issued-value'));
  } finally { await bad.close(); }
});

test('mounted: the Rewards card — an Admin’s lock and foot, a Super Admin’s Edit in Credit rules, Open Perks, a rule that is off, a failed read', async () => {
  const adm = await mount(h(RewardsCard, { rewards: ready({ rules: [{ ...RULES[0], active: false }, RULES[1], RULES[2]], paid: null }), superAdmin: false, onRetry() {} }));
  try {
    assert.match(adm.textOf('programs-refer-reward-referral:startup_accepted'), new RegExp(`Off on acceptance${RULE_OFF.replace('.', '\\.')}`));
    assert.equal(adm.textOf('programs-refer-reward-referral:startup_formed'), '400 credits on formation');
    assert.equal(adm.textOf('programs-refer-reward-strategic'), `Strategic & capital${CASE_BY_CASE}`);
    assert.equal(adm.textOf('programs-refer-rewards-foot'), CARD_FOOT);
    assert.match(adm.textOf('programs-refer-rewards'), /Set by HQ/);
    assert.deepEqual(adm.hrefs(), ['/admin/programs/perks']);
  } finally { await adm.close(); }
  const sup = await mount(h(RewardsCard, { rewards: ready({ rules: RULES, paid: PAID }), superAdmin: true, onRetry() {} }));
  try {
    assert.deepEqual(sup.hrefs(), ['/admin/programs/perks', '/admin/credit-rules']);
    assert.ok(!sup.has('programs-refer-rewards-foot'));
  } finally { await sup.close(); }
  let retried = 0;
  const bad = await mount(h(RewardsCard, { rewards: failed(), superAdmin: false, onRetry() { retried += 1; } }));
  try {
    assert.ok(bad.has('programs-refer-rewards-unreadable'));
    assert.doesNotMatch(bad.text(), /credits (on|once)/);
  } finally { await bad.close(); }
  assert.equal(retried, 0);
});

test('mounted: a save that paid shows its line under the result; one HQ switched off says so', async () => {
  const row = { uid: 'r1', category: 'startup', status: 'in_conversation', referred_name: 'Ada', referrer_name: 'Fay', referrer_role: 'founder', history: [] };
  let reward = { rule_key: 'referral:startup_accepted', paid: true, credits: 100, ledger_id: 9 };
  const view = await mount(h(ReferralDialog, { uid: 'r1', onClose() {}, onSaved() {} }), (url, o) => {
    if (o.method === 'PATCH') return response({ ...row, status: 'converted', reward });
    return response(row);
  });
  try {
    await view.change('referral-dialog-status', 'converted');
    await view.click('referral-dialog-save');
    assert.equal(view.textOf('referral-dialog-reward-paid'), '100 credits paid to the referrer.');
    reward = { rule_key: 'referral:startup_formed', paid: false, code: 'rule_inactive' };
    await view.change('referral-dialog-note', 'Formed');
    assert.ok(!view.has('referral-dialog-reward-paid'), 'an edit clears the last result');
    await view.click('referral-dialog-save');
    assert.equal(view.textOf('referral-dialog-reward-paid'), 'No credits paid: HQ has switched this reward off.');
  } finally { await view.close(); }
});

test('the page’s credit sentences: How it runs and the catalogue purpose say what pays, with no amount; 566 writes the same words', () => {
  const model = read('frontend/src/pages/admin/programs/programsModel.js');
  const m566 = read('cloudflare-worker/sql/migrations/566_referral_reward_rules.sql');
  assert.ok(!/No referral pays perk credits/.test(model));
  const card = PROGRAMS.find((p) => p.key === 'refer-and-earn');
  assert.match(card.purpose, /earn perk credits/);
  assert.match(card.purpose, /introduction credit\.$/, 'the introduction credit keeps its own name');
  // The model's lines and 566's seed replacement are the same words (’ in JS, '' in SQL).
  const rewards = model.match(/'(A startup referral pays its referrer perk credits[^']*)'/)[1];
  assert.ok(m566.replace(/''/g, '’').includes(rewards), '566 writes the model’s Rewards text');
  assert.ok(m566.replace(/''/g, '’').includes(card.purpose), '566 writes the model’s purpose');
  assert.doesNotMatch(rewards, /\d/, 'no amount is written into the copy');
  // The Overview mounts both blocks.
  const page = read('frontend/src/pages/admin/programs/ReferAndEarn.jsx');
  assert.match(page, /<RewardsIssuedTile issued=\{rw\.issued\}/);
  assert.match(page, /<RewardsCard rewards=\{rw\.rewards\} superAdmin=\{superAdmin\}/);
});
