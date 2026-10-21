/**
 * D715 (#1780) PR 3 — a founder's or partner's own Mercury: the sheet's
 * groups (decision 8) and the row's words in Yours and in Build (decision 9).
 * PR 3b: the uses group reads `GET /api/mercury/personal/status` (#1778's PR B).
 * D752 (#1886): an investor on HQ reads the investor's words in every group.
 *
 * Every token here is invented and assembled at run time.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/mercury_personal_sheet_d715.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';

import {
  attentionReason, buildCatalogue, disconnectNote, doesLabel, isPersonalMercury, lastSyncLabel, toolBanner, toolRow, yoursFeedsLabel,
} from '../src/pages/account/connectorsModel.js';
import { connectorsApi } from '../src/lib/api/connectors.js';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import { ConnectorPanel } from '../src/pages/account/ConnectorSheet.jsx';
import { ConnectorsView } from '../src/pages/account/AccountConnectors.jsx';
import { ConnectToolView } from '../src/pages/account/ConnectToolSheet.jsx';
import { MercuryLandsGroup, MercuryUsesGroups } from '../src/pages/account/MercurySheet.jsx';
import { MEMBER_REPLACE, READS_ROW, USE_DOORS, USE_REASONS, USE_WORDS, landsWords, memberDisconnectNote, neverRows, usesRows } from '../src/pages/account/mercuryModel.js';
import { mercuryPersonalApi } from '../src/lib/api/mercuryPersonal.js';

const h = React.createElement;
const flat = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const TOKEN = ['fixture', 'not', 'a', 'token', '2'].join('-');

const P = (key, display_name, extra = {}) => ({
  key, display_name, integration_type: 'data_feed', status: 'live', tier: 'free', auth_type: 'api_key',
  description: `${display_name} description.`, capabilities: [], docs_url: `https://example.test/${key}`,
  has_implementation: true, locked_for_user: false, connection_source: 'integrations', pulls: [], sends: [], feeds: [], ...extra,
});
const MERCURY = P('mercury', 'Mercury', { category: 'Accounting and banking', permissions: ['Read your Mercury transactions.'] });
const STRIPE = P('stripe', 'Stripe', { auth_type: 'oauth2', category: 'Accounting and banking', pulls: [{ what: 'Charges', module: 'revenue' }], feeds: ['revenue'] });
const CRUNCHBASE = P('crunchbase', 'Crunchbase', { pulls: [{ what: 'Companies', module: 'market' }], feeds: ['market'] });
const conn = (provider_key, extra = {}) => ({ uid: `u-${provider_key}`, provider_key, status: 'active', last_synced_at: null, last_error: null, config: {}, company_ids: [], ...extra });

const catalogue = (mercuryConn = conn('mercury'), mercury = MERCURY) => buildCatalogue({
  providers: [mercury, STRIPE, CRUNCHBASE],
  items: [mercuryConn, conn('stripe', { last_synced_at: '2026-10-18 08:00:00' }), conn('crunchbase', { status: 'error', last_error: 'connect_failed: bad key' })].filter(Boolean),
  companies: [{ id: 10, company_name: 'Lantern' }],
  firstParty: {},
});
const row = (key, cat) => cat.find((p) => p.key === key);

/** Mount with a signed-in user, so the sheet reads the viewer's role from the session. */
async function mount(el, { user = null, url = '/account/connectors' } = {}) {
  const restore = installDocument();
  if (!document.documentElement?.classList) document.documentElement = { ...(document.documentElement || {}), classList: { contains: () => false } };
  globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.dispatchEvent = () => true;
  if (user) localStorage.setItem('user', JSON.stringify(user));
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('no network in this test'); };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [url] }, h(AuthProvider, null, el))); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const nodes = () => walk(container);
  const by = (id) => nodes().find((n) => pr(n)['data-testid'] === id);
  const byId = (id) => nodes().find((n) => pr(n).id === id);
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join(' ') : n.textContent || '');
  const need = (n, what) => { if (!n) throw new Error(`Missing ${what}`); return n; };
  return {
    by, byId, pr, nodes, settle, text: (n = container) => txt(n).replace(/\s+/g, ' ').trim(),
    async click(id) { await act(async () => { await pr(need(by(id), id)).onClick?.({ preventDefault() {}, stopPropagation() {} }); }); await settle(); },
    async change(node, target) { await act(async () => { pr(node).onChange({ target }); }); },
    async submit(id) { await act(async () => { await pr(need(byId(id), id)).onSubmit({ preventDefault() {} }); }); await settle(); },
    async unmount() { await act(async () => root.unmount()); restore(); globalThis.fetch = origFetch; },
  };
}
const FOUNDER = { id: 41, role: 'founder', name: 'Ana Wren' };
const PARTNER = { id: 42, role: 'partner', name: 'Cai Moreno' };
const INVESTOR = { id: 43, role: 'investor', name: 'Ines Okafor' };
const panel = (p, view, extra = {}) => h(ConnectorPanel, { p, view, setView() {}, onClose() {}, ...extra });

/** What a syncing connector draws, and none of which a member's Mercury may draw. */
const SYNC_WORDS = /What it pulls in|What it sends out|It will read|It will write|It will serve|Sync now|How often|only sends out|only pulls in/;
const NEVER = neverRows('founder').join(' ');
const FOUNDER_NOTE = memberDisconnectNote('founder');

/** The status route's answer (`routes/mercury_personal.ts`), for a founder, a partner on HQ and a partner on a branch. */
const use = (key, available, reason = null) => ({ key, available, reason });
const STATUS = {
  founder: { connected: true, connection: null, uses: [use('venture_revenue', true), use('venture_spend', true), use('practice_income', false, 'purpose_not_allowed'), use('partner_deals', false, 'purpose_not_allowed'), use('capital_attestation', false, 'purpose_not_allowed')] },
  partnerHq: { connected: true, connection: null, uses: [use('venture_revenue', false, 'purpose_not_allowed'), use('practice_income', true), use('partner_deals', true), use('capital_attestation', false, 'purpose_not_allowed')] },
  partnerBranch: { connected: true, connection: null, uses: [use('venture_revenue', false, 'purpose_not_allowed'), use('practice_income', true), use('partner_deals', false, 'hq_only'), use('capital_attestation', false, 'purpose_not_allowed')] },
  investorHq: { connected: true, connection: null, uses: [use('venture_revenue', false, 'purpose_not_allowed'), use('practice_income', false, 'purpose_not_allowed'), use('partner_deals', false, 'purpose_not_allowed'), use('capital_attestation', true)] },
};
/** Stub the one status read, counting calls; `answer` is a value, or an Error to fail it. */
function stubStatus(answer) {
  const saved = mercuryPersonalApi.status; const calls = { n: 0 };
  mercuryPersonalApi.status = async () => { calls.n += 1; if (answer instanceof Error) throw answer; return answer; };
  return { calls, restore() { mercuryPersonalApi.status = saved; } };
}

// ------------------------------------------------------------------ decision 9's words

test('the personal row\'s words in Yours and Build; every other row keeps today\'s', () => {
  const cat = catalogue();
  const m = row('mercury', cat);
  assert.equal(isPersonalMercury(m), true);
  assert.equal(isPersonalMercury({ ...m, connection_source: 'mercury_entity_connections' }), false, 'the entity row is not the member\'s');
  assert.equal(doesLabel(m), 'Reads on request');
  assert.equal(lastSyncLabel(m.connection), 'Read on request');
  assert.equal(yoursFeedsLabel(m), 'Your own payments', 'a partner\'s Mercury names no feeds');
  assert.equal(yoursFeedsLabel({ ...m, feeds: ['revenue'] }), 'Revenue', 'the Worker\'s feeds when it names them');
  assert.equal(disconnectNote(m), FOUNDER_NOTE);
  assert.equal(disconnectNote(m, 'investor'), memberDisconnectNote('investor'));
  assert.equal(yoursFeedsLabel(m, 'investor'), 'Statements you share');
  assert.equal(yoursFeedsLabel(m, 'partner'), 'Your own payments');
  const err = (last_error) => attentionReason(conn('mercury', { status: 'error', last_error }));
  assert.equal(err('mercury_entity_account: org is an Axal entity'), 'An Axal entity\'s Mercury');
  assert.equal(err('write_scope_refused'), 'Token can write');
  assert.equal(err('unauthorized'), 'Token refused');
  assert.equal(err('401 from Mercury'), 'Token refused');
  assert.equal(err('timeout'), 'Last read failed');
  assert.equal(attentionReason(conn('mercury')), '', 'a healthy connection needs nothing');
  // Build: a failing Mercury offers Reconnect, never Try again, and its banner names the token.
  const failing = catalogue(conn('mercury', { status: 'error', last_error: 'write_scope_refused' }));
  const r = toolRow(row('mercury', failing));
  assert.deepEqual([r.action, r.actionLabel, r.detail], ['reconnect', 'Reconnect', 'Token can write']);
  assert.equal(toolBanner([row('mercury', failing)]).text, 'Mercury needs attention: Token can write. Replace its token from its page.');
  assert.match(toolRow(m).detail, /read on request$/);
  // Unchanged: Stripe and Crunchbase.
  const s = row('stripe', cat), c = row('crunchbase', cat);
  assert.equal(doesLabel(s), 'Pulls in');
  assert.notEqual(lastSyncLabel(s.connection), 'Read on request');
  assert.equal(disconnectNote(s), 'Data already in StudioOS stays. The stored credentials are deleted.');
  assert.equal(attentionReason(c.connection), 'Last sync failed');
  assert.deepEqual([toolRow(c).action, toolRow(c).actionLabel], ['retry', 'Try again']);
  assert.equal(yoursFeedsLabel(row('stripe', buildCatalogue({ providers: [{ ...STRIPE, feeds: [] }], items: [], firstParty: {} }))), null);
});

test('Yours draws Reads on request, Read on request, You and the feeds; the attention words on a failing row', () => {
  const cat = catalogue(conn('mercury', { status: 'error', last_error: 'mercury_entity_account' }));
  const out = flat(renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/account/connectors'] }, h(ConnectorsView, { data: { status: 'ready', catalogue: cat, items: [], itemsFailed: false, suggestions: [], reload() {} } }))));
  const line = out.slice(out.indexOf('Mercury'), out.indexOf('Stripe', out.indexOf('Mercury')));
  // Does, Feeds, Companies and Last sync, in the table's order.
  assert.match(line, /Reads on request Your own payments You Read on request/);
  assert.ok(line.includes('An Axal entity\'s Mercury'));
  assert.doesNotMatch(line, /Not recorded|never ran|Last sync failed/);
});

// ------------------------------------------------------------------ decision 8's sheet

test('a founder\'s pre and detail views: the uses, the never rows, where it lands, how it reads; nothing a sync draws', async () => {
  const saved = connectorsApi.fed; let fed = 0;
  connectorsApi.fed = async () => { fed += 1; return { modules: [] }; };
  const status = stubStatus(STATUS.founder);
  const pre = await mount(panel({ ...row('mercury', catalogue()), connection: null }, 'pre'), { user: FOUNDER });
  try {
    const t = pre.text();
    assert.ok(t.includes(`What StudioOS uses it for ${USE_WORDS.venture_revenue}`), 'the founder\'s one use, from the status read');
    assert.ok(t.includes(NEVER), 'the three never rows');
    assert.match(t, /Where it lands Only the venture you import into/);
    assert.ok(t.includes(`How it reads ${READS_ROW}`));
    assert.doesNotMatch(t, SYNC_WORDS);
  } finally { await pre.unmount(); }
  const detail = await mount(panel(row('mercury', catalogue()), 'detail'), { user: FOUNDER });
  try {
    const t = detail.text();
    assert.ok(t.includes(NEVER));
    assert.match(t, /Where it lands Only the venture you import into/);
    assert.ok(t.includes(READS_ROW));
    assert.match(t, /Permissions Read your Mercury transactions\./);
    assert.doesNotMatch(t, SYNC_WORDS);
    assert.equal(detail.by('button-sync-now'), undefined);
    assert.ok(!detail.nodes().some((n) => /^connector-company-/.test(detail.pr(n)['data-testid'] || '')), 'no company tick');
    assert.equal(fed, 1, 'Now fed by is a founder\'s');
    assert.ok(t.includes(`On disconnect: ${FOUNDER_NOTE}`));
  } finally { await detail.unmount(); connectorsApi.fed = saved; status.restore(); }
});

test('a partner\'s sheet: their own landing words, and no Now fed by', async () => {
  const saved = connectorsApi.fed; let fed = 0;
  connectorsApi.fed = async () => { fed += 1; return { modules: [] }; };
  const m = await mount(panel(row('mercury', catalogue()), 'detail'), { user: PARTNER });
  try {
    assert.match(m.text(), /Where it lands Only your own invoices, payouts and settlements/);
    assert.equal(fed, 0);
    assert.doesNotMatch(m.text(), SYNC_WORDS);
  } finally { await m.unmount(); connectorsApi.fed = saved; }
  // D752: an investor reads the investor's words; a role with no Mercury of its own reads Not recorded, never a founder's words.
  const investor = flat(renderToStaticMarkup(h(MercuryLandsGroup, { role: 'investor' })));
  assert.ok(investor.includes(`Where it lands ${landsWords('investor')}`));
  const other = flat(renderToStaticMarkup(h(MercuryLandsGroup, { role: 'advisor' })));
  assert.match(other, /Where it lands Not recorded/);
});

test('a founder on Free sees the plan view with the Mercury groups', async () => {
  const m = await mount(panel({ ...row('mercury', catalogue()), connection: null, locked: true, tier: 'growth' }, 'pro'), { user: FOUNDER });
  try {
    assert.ok(m.text().includes(NEVER));
    assert.doesNotMatch(m.text(), SYNC_WORDS);
  } finally { await m.unmount(); }
});

test('needs attention: the attention words and the fix, never "sync" and never the raw error', async () => {
  const saved = connectorsApi.fed; connectorsApi.fed = async () => ({ modules: [] });
  const p = row('mercury', catalogue(conn('mercury', { status: 'error', last_error: 'write_scope_refused: token has write scope ending 9z' })));
  const m = await mount(panel(p, 'detail'), { user: FOUNDER });
  try {
    const banner = m.text(m.by('connector-attention'));
    assert.equal(banner, `Token can write. ${MEMBER_REPLACE}`);
    assert.doesNotMatch(banner, /sync/i);
    assert.doesNotMatch(m.text(), /ending 9z|Mercury said/);
  } finally { await m.unmount(); connectorsApi.fed = saved; }
});

// ------------------------------------------------------------------ the key step

test('the key view: no Advanced, an exact body, a stored config never sent, refusals in the Worker\'s words', async () => {
  const calls = [];
  const saved = connectorsApi.connect;
  let answer = null;
  connectorsApi.connect = async (b) => { calls.push(b); if (answer) throw answer; return {}; };
  const base = row('mercury', catalogue());
  const replacing = { ...base, connection: { ...base.connection, config: { confirm_read_only: false, extra: 'stored' } } };
  const m = await mount(panel(replacing, 'key'), { user: FOUNDER });
  try {
    assert.doesNotMatch(m.text(), /Advanced/);
    assert.equal(m.byId('connector-config'), undefined);
    assert.equal(m.byId('connector-webhook'), undefined);
    const box = () => m.nodes().find((n) => m.pr(n).type === 'checkbox');
    await m.change(m.byId('connector-key'), { value: TOKEN });
    await m.change(box(), { checked: true });
    answer = Object.assign(new Error('That token belongs to an Axal entity\'s Mercury organization. Use your own.'), { status: 409, code: 'mercury_entity_account' });
    await m.submit('connector-key-form');
    assert.deepEqual(calls[0], { provider_key: 'mercury', display_name: 'Mercury', api_key: TOKEN, webhook_secret: undefined, config: { confirm_read_only: true } });
    assert.match(m.text(), /That token belongs to an Axal entity's Mercury organization\. Use your own\./);
    assert.doesNotMatch(m.text(), /refused access|Ask your Mercury admin|not valid/);
    assert.equal(m.pr(m.byId('connector-key')).value, '', 'the token is cleared after a refusal');
    answer = Object.assign(new Error('A support session cannot connect on a member\'s behalf.'), { status: 403 });
    await m.change(m.byId('connector-key'), { value: TOKEN });
    await m.submit('connector-key-form');
    assert.match(m.text(), /A support session cannot connect on a member's behalf\./);
  } finally { await m.unmount(); connectorsApi.connect = saved; }
});

// ------------------------------------------------------------------ Build

test('Build: the failing Mercury row reconnects and syncs nothing; its lightbox draws the Mercury groups', async () => {
  const saved = { sync: connectorsApi.sync, teammate: connectorsApi.teammate };
  const calls = [];
  connectorsApi.sync = async (uid) => { calls.push(uid); return { ok: true }; };
  connectorsApi.teammate = async () => ({ teammate: null });
  const cat = catalogue(conn('mercury', { status: 'error', last_error: 'unauthorized' }));
  const m = await mount(h(ConnectToolView, { data: { status: 'ready', catalogue: cat, reload() {} }, onClose() {} }), { user: FOUNDER, url: '/build/connect' });
  try {
    assert.match(m.text(), /Mercury needs attention: Token refused\. Replace its token from its page\./);
    assert.equal(m.text(m.by('tool-action-mercury')), 'Reconnect');
    await m.click('tool-action-mercury');
    assert.deepEqual(calls, [], 'no sync is called');
    assert.ok(m.text().includes(NEVER), 'Reconnect opens the Mercury sheet');
    assert.doesNotMatch(m.text(), SYNC_WORDS);
  } finally { await m.unmount(); Object.assign(connectorsApi, saved); }
});

// ------------------------------------------------------------------ PR 3b: the uses, from the status route

test('PR 3b: a founder draws venture revenue only; a partner on HQ draws practice income and partner deals, in that order', async () => {
  for (const [who, status, want, absent] of [
    [FOUNDER, STATUS.founder, ['venture_revenue', 'venture_spend'], ['practice_income', 'partner_deals']],
    [PARTNER, STATUS.partnerHq, ['practice_income', 'partner_deals'], ['venture_revenue']],
  ]) {
    const stub = stubStatus(status);
    const m = await mount(h(MercuryUsesGroups), { user: who });
    try {
      const t = m.text();
      // #1780 canvas PR: each use row ends with its door, where it has one.
      const rows = want.map((k) => (Object.hasOwn(USE_DOORS, k) ? `${USE_WORDS[k]} ${USE_DOORS[k].text}` : USE_WORDS[k]));
      assert.ok(t.includes(`What StudioOS uses it for ${rows.join(' ')}`), `${who.role}: ${want}`);
      for (const k of absent) assert.ok(!t.includes(USE_WORDS[k]), `${who.role} has no ${k}`);
      assert.ok(t.includes(NEVER), 'the never rows draw beside the uses');
      assert.equal(stub.calls.n, 1, 'one status read per mount');
    } finally { await m.unmount(); stub.restore(); }
  }
});

test('PR 3b: a branch partner\'s partner deals are HQ only, so only practice income draws; with nothing left the reason says HQ', async () => {
  const stub = stubStatus(STATUS.partnerBranch);
  const m = await mount(h(MercuryUsesGroups), { user: PARTNER });
  try {
    const t = m.text();
    assert.ok(t.includes(USE_WORDS.practice_income));
    assert.ok(!t.includes(USE_WORDS.partner_deals), 'hq_only is not available off HQ');
  } finally { await m.unmount(); stub.restore(); }
  const none = usesRows({ uses: [use('practice_income', false, 'purpose_not_allowed'), use('partner_deals', false, 'hq_only')] });
  assert.deepEqual(none, { rows: [], reason: USE_REASONS.hq_only });
  assert.equal(USE_REASONS.hq_only, 'Your deals with Axal VC Management LLC are matched on HQ only.');
});

test('PR 3b: a key the model has no words for is never drawn; with none left the group reads Not recorded with its reason', async () => {
  const stub = stubStatus({ connected: false, connection: null, uses: [use('crypto_custody', true), use('constructor', true)] });
  const m = await mount(h(MercuryUsesGroups), { user: FOUNDER });
  try {
    const t = m.text();
    assert.match(t, /What StudioOS uses it for Not recorded/);
    assert.ok(m.nodes().some((n) => m.pr(n).title === USE_REASONS.purpose_not_allowed), 'the reason is on the Not recorded');
    assert.doesNotMatch(t, /crypto_custody|constructor/);
    assert.ok(t.includes(NEVER));
  } finally { await m.unmount(); stub.restore(); }
  assert.deepEqual(usesRows(null), { rows: [], reason: USE_REASONS.purpose_not_allowed });
  assert.deepEqual(usesRows({ uses: [use('venture_revenue', 'yes')] }).rows, [], 'only available === true draws');
});

test('PR 3b: a failed status read makes the uses Unreadable, never "none", and the never rows still draw', async () => {
  const stub = stubStatus(Object.assign(new Error('no network'), { status: 503 }));
  const m = await mount(h(MercuryUsesGroups), { user: PARTNER });
  try {
    assert.ok(m.by('mercury-uses-unreadable'), 'Unreadable');
    const t = m.text();
    assert.doesNotMatch(t, /What StudioOS uses it for Not recorded/);
    for (const k of Object.keys(USE_WORDS)) assert.ok(!t.includes(USE_WORDS[k]));
    assert.ok(t.includes(NEVER), 'the next group still draws');
  } finally { await m.unmount(); stub.restore(); }
});

// ------------------------------------------------------------------ D752: an investor on HQ

test('D752: an investor\'s sheet draws the proof-of-funds use, the investor\'s never rows, landing and disconnect words, and no Now fed by', async () => {
  const saved = connectorsApi.fed; let fed = 0;
  connectorsApi.fed = async () => { fed += 1; return { modules: [] }; };
  const status = stubStatus(STATUS.investorHq);
  const m = await mount(panel(row('mercury', catalogue()), 'detail'), { user: INVESTOR });
  try {
    const t = m.text();
    assert.ok(t.includes(`What StudioOS uses it for ${USE_WORDS.capital_attestation}`), 'the investor\'s one use');
    assert.ok(t.includes(neverRows('investor').join(' ')), 'the investor\'s never rows');
    assert.ok(!t.includes(NEVER), 'never the founder\'s rows');
    assert.ok(t.includes(`Where it lands ${landsWords('investor')}`));
    assert.ok(t.includes(`On disconnect: ${memberDisconnectNote('investor')}`));
    assert.equal(fed, 0, 'no Now fed by');
    assert.doesNotMatch(t, SYNC_WORDS);
  } finally { await m.unmount(); connectorsApi.fed = saved; status.restore(); }
});

test('D752: an investor\'s Yours row reads "Statements you share"; a partner\'s still reads "Your own payments"', () => {
  const cat = catalogue();
  const draw = (role) => {
    const out = flat(renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/account/connectors'] },
      h(ConnectorsView, { role, data: { status: 'ready', catalogue: cat, items: [], itemsFailed: false, suggestions: [], reload() {} } }))));
    return out.slice(out.indexOf('Mercury'), out.indexOf('Stripe', out.indexOf('Mercury')));
  };
  assert.match(draw('investor'), /Reads on request Statements you share You Read on request/);
  assert.match(draw('partner'), /Reads on request Your own payments You Read on request/);
});

test('#1780: each use row links the screen where it happens; a use with no screen links nothing', async () => {
  for (const [who, status, doors] of [
    [FOUNDER, STATUS.founder, { venture_revenue: '/spinout-lab/revenue' }],
    // #2338: practice_income's door was `/partner/needs`, whose Engagements tab
    // matched invoices. The owner removed that page, so the use links nothing.
    [PARTNER, STATUS.partnerHq, { partner_deals: '/partner/earnings' }],
  ]) {
    const stub = stubStatus(status);
    const m = await mount(h(MercuryUsesGroups), { user: who });
    try {
      for (const [key, href] of Object.entries(doors)) {
        const door = m.by(`mercury-door-${key}`);
        assert.ok(door, `${who.role}: ${key} has its door`);
        assert.equal(m.pr(door).href, href);
      }
      assert.equal(m.by('mercury-door-venture_spend'), undefined, 'venture_spend has no screen to link yet');
      assert.equal(m.by('mercury-door-practice_income'), undefined, 'practice_income lost its screen with #2338');
    } finally { await m.unmount(); stub.restore(); }
  }
});
