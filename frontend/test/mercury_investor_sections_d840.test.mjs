/**
 * D840 part 4 (#2349) — "From Mercury" in the investor's sections.
 *
 * Each section mounts the part with its own section; Portfolio says Mercury
 * feeds nothing; a proposal is written only through Accept; a refusal reads
 * "Not recorded" and a failed read "Unreadable", never a zero; and the
 * capacity is read on Deals · Commit and nowhere else in the SPA.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';
import FromMercury, { money, proposalText } from '../src/pages/investor/FromMercury.jsx';
import { mercuryInvestorApi } from '../src/lib/api/mercuryInvestor.js';

const h = React.createElement;
const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

async function mount(props) {
  const restore = installDocument();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(FromMercury, props)); await new Promise((r) => setTimeout(r, 0)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const propsOf = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => propsOf(n)['data-testid'] === id);
  const click = (id) => act(async () => { propsOf(by(id)).onClick(); await new Promise((r) => setTimeout(r, 0)); });
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '');
  return { by, click, text, all: () => text(container), async unmount() { await act(async () => root.unmount()); restore(); } };
}

function stub(over) {
  const saved = { ...mercuryInvestorApi };
  Object.assign(mercuryInvestorApi, over);
  return () => Object.assign(mercuryInvestorApi, saved);
}

const PROPOSAL = { uid: 'a'.repeat(32), kind: 'closing', target_id: 21, amount_cents: 2500000, posted_on: '2026-09-05', account_last_four: '4242', counterparty: 'Fixture Venture Inc', state: 'proposed' };

test('the words: a closing proposal asks the issue\'s question; money is never a zero for a missing figure', () => {
  assert.equal(proposalText('closing', PROPOSAL), 'This $25,000.00 wire to Fixture Venture Inc on 2026-09-05 funded your commitment?');
  assert.equal(money(null), 'Not recorded');
  assert.equal(money(610000), '$6,100.00');
});

test('Commit shows the capacity with the date and the accounts by last four, said to be the investor\'s alone', async () => {
  const restore = stub({ capacity: async () => ({ capacity: { available_cents: 610000, account_last_fours: ['1357', '4242'], as_of: '2026-10-15' } }) });
  const m = await mount({ section: 'commit' });
  try {
    const t = m.text(m.by('from-mercury-capacity'));
    assert.match(t, /Capacity: \$6,100\.00 available as of 2026-10-15/);
    assert.match(t, /••1357, ••4242 · only you see this/);
  } finally { await m.unmount(); restore(); }
});

test('a proposal is written only by Accept or Dismiss, each once, for that proposal; Read Mercury syncs the section', async () => {
  // Mutation checked: Dismiss wired to accept → the dismiss call never comes; sync without its section → the section is missing.
  const calls = [];
  const restore = stub({
    proposals: async (kind, fund) => { calls.push(['list', kind, fund]); return { proposals: [PROPOSAL] }; },
    accept: async (uid, body) => { calls.push(['accept', uid, body]); return { ok: true }; },
    dismiss: async (uid) => { calls.push(['dismiss', uid]); return { ok: true }; },
    sync: async (b) => { calls.push(['sync', b.section]); return { proposed: 0 }; },
  });
  const m = await mount({ section: 'closing' });
  try {
    assert.deepEqual(calls, [['list', 'closing', null]], 'mounting reads; it writes nothing');
    await m.click(`mercury-accept-${PROPOSAL.uid}`);
    assert.deepEqual(calls[1], ['accept', PROPOSAL.uid, {}]);
    await m.click(`mercury-dismiss-${PROPOSAL.uid}`);
    assert.deepEqual(calls.filter((c) => c[0] === 'dismiss'), [['dismiss', PROPOSAL.uid]]);
    await m.click('from-mercury-sync-closing');
    assert.deepEqual(calls.filter((c) => c[0] === 'sync'), [['sync', 'closing']]);
  } finally { await m.unmount(); restore(); }
});

test('a refusal reads Not recorded with its reason; a failed read reads Unreadable', async () => {
  const refusal = Object.assign(new Error('Sign in with Mercury on your Connectors page first.'), { status: 409 });
  let restore = stub({ capacity: async () => { throw refusal; } });
  let m = await mount({ section: 'commit' });
  try { assert.equal(m.text(m.by('from-mercury-reason')), 'Not recorded: Sign in with Mercury on your Connectors page first.'); } finally { await m.unmount(); restore(); }
  restore = stub({ proposals: async () => { throw Object.assign(new Error('Your Mercury account could not be read. Nothing changed; try again.'), { status: 502 }); } });
  m = await mount({ section: 'calls', fundId: 11 });
  try { assert.match(m.text(m.by('from-mercury-reason')), /^Unreadable: /); } finally { await m.unmount(); restore(); }
});

test('Portfolio gets nothing, and the part says so with the Worker\'s own sentence', async () => {
  const m = await mount({ section: 'portfolio' });
  try {
    const worker = readFileSync(new URL('../../cloudflare-worker/src/integrations/mercuryFeeds.ts', import.meta.url), 'utf8');
    const note = /PORTFOLIO_NOTE = '([^']+)'/.exec(worker)[1];
    assert.equal(m.text(m.by('from-mercury-portfolio-none')), note);
  } finally { await m.unmount(); }
});

test('each section mounts the part with its own section, and Portfolio\'s book says Mercury feeds nothing', () => {
  // Mutation checked: swap two sections' names → the pair fails.
  const mounts = {
    'pages/investor/deals/CommitZone.jsx': '<FromMercury section="commit" />',
    'pages/investor/deals/ClosingZone.jsx': '<FromMercury section="closing" />',
    'pages/investor/InvestorFundCalls.jsx': '<FromMercury section="calls" fundId={fund?.id ?? null} />',
    'pages/investor/InvestorFundAccounting.jsx': '<FromMercury section="ledger" fundId={fund?.id ?? null} />',
    'pages/investor/InvestorFundReporting.jsx': '<FromMercury section="reporting" fundId={managed.fund?.id ?? null} />',
    'pages/investor/InvestorPortfolioPositions.jsx': '<FromMercury section="portfolio" />',
  };
  for (const [file, tag] of Object.entries(mounts)) assert.ok(src(file).includes(tag), `${file} mounts ${tag}`);
});

test('the capacity is read on Deals · Commit only: no other SPA file calls it', () => {
  const root = new URL('../src/', import.meta.url).pathname;
  const files = [];
  const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(jsx?|tsx?)$/.test(f)) files.push(p); } };
  walk(root);
  const readers = files.filter((f) => /mercuryInvestorApi\.(capacity|setCapacity)\b|\/mercury\/investor\/commit/.test(readFileSync(f, 'utf8'))).map((f) => f.slice(root.length)).sort();
  assert.deepEqual(readers, ['lib/api/mercuryInvestor.js', 'pages/investor/FromMercury.jsx']);
  assert.ok(!src('pages/investor/FromMercury.jsx').replace(/section === 'commit' && <Capacity/, '').includes('<Capacity'), 'Capacity is drawn only for the commit section');
});
