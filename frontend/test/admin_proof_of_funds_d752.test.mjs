/**
 * D752 (#1890) — the proof of funds an admin reads: one statement, the LP
 * application's row (one read per selection), the queue chip, and where the
 * read is wired. Names, holders and amounts are invented.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/admin_proof_of_funds_d752.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { installDocument } from './_contracts_dom.mjs';
import { codeOnly } from './_codeOnly.mjs';
import { ProofChip, ProofOfFundsRow, ProofStatement } from '../src/components/ProofOfFunds.jsx';
import { NONE_SHARED, NOT_ACCREDITATION, PROOF_CHIP, coverText, otherActiveText } from '../src/lib/proofOfFunds.js';

const h = React.createElement;
const html = (el) => renderToStaticMarkup(el);
const text = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

const ACTIVE = {
  uid: 'pf-1', purpose: 'lp_application', target_id: 201, deal_id: null, fund_id: 7, investor_user_id: 30, investor_name: 'Investor', target_label: 'Fund I application',
  state: 'active', label: 'Active', expired: false, amount_floor_cents: 10000000, as_of: '2026-10-18', expires_on: '2026-11-17', holder_name: 'Own Practice LLC',
  accounts_counted: 2, shared_on: '2026-10-18',
  statement: 'At least $100,000 available at Mercury on 2026-10-18, held by Own Practice LLC, across 2 accounts. Shared by the investor on 2026-10-18.',
  other_active: [], other_active_count: 0,
};
const REVOKED = {
  uid: 'pf-2', purpose: 'lp_application', target_id: 201, deal_id: null, fund_id: 7, investor_user_id: 30, investor_name: 'Investor', target_label: 'Fund I application',
  state: 'revoked', label: 'Revoked', revoked_on: '2026-10-20', statement: 'Revoked by the investor on 2026-10-20.',
};

test('ProofStatement, active: the Mercury tile then "Mercury", the statement, Active, the cover and the accreditation line; markup is text', () => {
  const out = html(h(ProofStatement, { item: ACTIVE, figureDollars: 250000 }));
  assert.match(out, /data-provider="mercury"[\s\S]*Mercury/);
  const t = text(out);
  assert.ok(t.includes(ACTIVE.statement));
  assert.ok(t.includes('Active'));
  assert.ok(t.includes('Covers $100,000 of $250,000'));
  assert.ok(t.includes(NOT_ACCREDITATION));
  assert.ok(text(html(h(ProofStatement, { item: ACTIVE, figureDollars: 100000 }))).includes('Covers the full amount'));
  const marked = html(h(ProofStatement, { item: { ...ACTIVE, statement: 'At least <b>$1</b>' } }));
  assert.ok(marked.includes('&lt;b&gt;') && !marked.includes('<b>'), 'drawn as text, never as HTML');
});

test('ProofStatement, expired keeps its amount; revoked says when, with no amount and no Mercury mark', () => {
  const exp = text(html(h(ProofStatement, { item: { ...ACTIVE, label: 'Expired', expired: true } })));
  assert.ok(exp.includes('Expired') && exp.includes('$100,000'));
  const rev = html(h(ProofStatement, { item: REVOKED }));
  assert.ok(text(rev).includes('Revoked by the investor on 2026-10-20.'));
  assert.ok(!rev.includes('$'));
  assert.ok(!rev.includes('data-provider'));
});

test('the words: the cover, the other active statements, the chips', () => {
  assert.equal(coverText(10000000, null), null);
  assert.equal(coverText(10000000, 250000.5), 'Covers $100,000 of $250,000');
  assert.equal(coverText(25000000, 250000), 'Covers the full amount');
  assert.equal(otherActiveText(ACTIVE), null);
  assert.equal(otherActiveText({ ...ACTIVE, other_active_count: 1, other_active: [{ target_label: 'Commitment on deal #12', amount_floor_cents: 25000000, as_of: '2026-10-17', expired: false }] }),
    'Also shared: Commitment on deal #12, at least $250,000 on 2026-10-17. One balance can back more than one statement.');
  for (const [state, [label]] of Object.entries(PROOF_CHIP)) assert.ok(text(html(h(ProofChip, { state }))).includes(label), state);
  assert.equal(html(h(ProofChip, { state: 'none' })), '');
  assert.equal(html(h(ProofChip, { state: null })), '');
});

async function mount() {
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const textOf = (n) => (!n ? '' : n.nodeType === 3 ? n.nodeValue ?? n.textContent ?? '' : n.childNodes?.length ? n.childNodes.map(textOf).join(' ') : n.textContent || '');
  const t = () => textOf(container).replace(/\s+/g, ' ');
  const settle = () => act(async () => { for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  return {
    async render(el) { await act(async () => { root.render(el); }); await settle(); },
    text: t,
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}

test('ProofOfFundsRow: none reads nothing; null draws nothing; one read per key across re-renders; a failed read and a refusal', async () => {
  const m = await mount();
  try {
    let calls = 0;
    const load = async () => { calls += 1; return { items: [ACTIVE] }; };
    await m.render(h(ProofOfFundsRow, { key: 'a', state: 'none', load }));
    assert.ok(m.text().includes(NONE_SHARED));
    assert.equal(calls, 0);
    await m.render(h(ProofOfFundsRow, { key: 'b', state: null, load }));
    assert.equal(m.text().trim(), '');
    for (let i = 0; i < 3; i += 1) await m.render(h(ProofOfFundsRow, { key: 'c', state: 'active', load, figureDollars: 250000 + i }));
    assert.equal(calls, 1, 'three re-renders, one read');
    assert.ok(m.text().includes('At least $100,000'));
    await m.render(h(ProofOfFundsRow, { key: 'd', state: 'active', load }));
    assert.equal(calls, 2, 'a new key reads again');
    await m.render(h(ProofOfFundsRow, { key: 'e', state: 'active', load: async () => { throw new TypeError('network'); } }));
    assert.ok(m.text().includes('The proof of funds could not be read. This is not a claim that none was shared.'));
    const refused = Object.assign(new Error('This read could not be recorded, so it was not made. Try again in a moment.'), { status: 503 });
    await m.render(h(ProofOfFundsRow, { key: 'f', state: 'active', load: async () => { throw refused; } }));
    assert.ok(m.text().includes('This read could not be recorded, so it was not made.'));
  } finally { await m.unmount(); }
});

const read = (rel) => readFileSync(resolve('frontend/src', rel), 'utf8');

test('the LP application: the row is keyed by the selection and sits after Accreditation; the chip sits beside the status', () => {
  const page = codeOnly(read('pages/admin/AdminLpApplications.jsx'));
  assert.match(page, /\['Accreditation', 'Self-certified at submission \(Rule 501\)'\],\s*\.\.\.\(sel\.proof_of_funds != null \? \[\['Proof of funds', <ProofOfFundsRow key=\{sel\.id\}/);
  assert.equal(page.split("forTarget('lp_application', sel.id)").length - 1, 1);
  assert.match(page, /<ProofChip state=\{a\.proof_of_funds\} \/>\s*<StatusChip status=\{a\.status\}/);
});

test('the deal: the proof read is an admin on HQ\'s only, and the commitments read is unchanged', () => {
  const page = codeOnly(read('pages/DealRoomPage.jsx'));
  assert.match(page, /<CommitmentsTab [^>]*\bproof=\{isAdmin && !branchOfUser\(user\)\}/);
  assert.match(page, /if \(!proof \|\| !loaded\) return undefined;[\s\S]{0,80}adminCapitalAttestationsApi\.forDeal\(dealId\)/);
  assert.equal(page.split('adminCapitalAttestationsApi.forDeal(').length - 1, 1);
  assert.match(page, /api\.dealCommitments\(dealId\)\.then\(setItems\)/);
});

const walk = (p) => readdirSync(p, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(p, e.name)) : [join(p, e.name)]));

test('who can reach it: four files name the admin read, api.js names only its module, and the shared LP page names no proof', () => {
  const root = resolve('frontend/src');
  const naming = walk(root).filter((f) => /\.(jsx?|mjs)$/.test(f) && readFileSync(f, 'utf8').includes('adminCapitalAttestationsApi')).map((f) => f.slice(root.length + 1)).sort();
  assert.deepEqual(naming, ['lib/api/adminCapitalAttestations.js', 'pages/DealRoomPage.jsx', 'pages/admin/AdminLpApplications.jsx', 'pages/admin/fundAdmin/FundAdminConsole.jsx']);
  assert.match(read('lib/api.js'), /export \* from '\.\/api\/adminCapitalAttestations\.js';/);
  const lps = read('pages/investor/InvestorFundLPs.jsx');
  assert.doesNotMatch(lps, /ProofOfFunds|proof_of_funds/);
});
