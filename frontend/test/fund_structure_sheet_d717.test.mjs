/**
 * D717 (#1782) decision 11, #1855: the "Structure of the Fund" sheet on the
 * Contracts desk. It reads `fundStructureApi.read` only once open, draws the
 * Worker's map and rows as given, shows the Super Admin the masked accounts and
 * a plain Admin the withheld sentence, says when a read fails, and is absent
 * on a branch. The fixtures are built here; every number is synthetic.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/fund_structure_sheet_d717.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { readFileSync } from 'node:fs';
import { useLocation } from 'react-router-dom';
import { api, contractsApi } from '../src/lib/api.js';
import { fundStructureApi } from '../src/lib/api/fundStructure.js';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import Desk from '../src/pages/admin/contracts/ContractsDesk.jsx';
import { mountContracts } from './_contracts_dom.mjs';

const ARROWS = /[←-⇿]/;
const WITHHELD = 'Only the Super Admin can see or change payment instructions.';
const SUPER = { id: 2, role: 'admin', name: 'Super', is_super_admin: 1 };
const ADMIN = { id: 1, role: 'admin', name: 'Admin', is_super_admin: 0 };
const BRANCH = { ...SUPER, branch: { code: 'acme' } };

const ROUTE_IDS = ['A', 'B', '1', '2', '3', '4', '5', '6', '7', '8'];
const ENTITIES = [
  ['holdings', 'Axal VC Holdings LLC', ['Platform licence fee'], null],
  ['management', 'Axal VC Management LLC', [], null],
  ['gp', 'Axal VC GP LLC', ['Management fee'], null],
  ['fund', 'Axal VC Spin-Out Lab Fund I LP', ['Capital contributions', 'GP commitment'], 'By: Axal VC GP LLC, its general partner'],
];

/** A model in the Worker's shape. `endings` puts masked accounts on the GP. */
function model(audience, { accounts } = {}) {
  const m = {
    audience,
    entities: ENTITIES.map(([key, name, receives, through]) => ({
      key, name, role: `${name} role sentence.`, signs: `${name} signs sentence.`,
      signatory: 'Joseph Gabriel Guillaume Lauzier', title: key === 'gp' || key === 'fund' ? 'General Partner' : 'Managing Partner', through, receives,
    })),
    rows: [1, 2, 3, 4, 5, 6, 7, 8].map((no) => ({
      no, label: `Row ${no} flow`, rail: no === 1 ? 'stripe' : 'mercury', kinds: [],
      receiving_text: audience === 'super_admin' && no === 6 ? 'Axal VC GP LLC, Column N.A., ending 4417' : audience === 'admin' && no !== 1 && no !== 5 && no !== 8 ? WITHHELD : 'Paid to the LP',
    })),
    map: {
      view_box: [504, 478],
      boxes: ENTITIES.map(([id, name], i) => ({ id, outside: false, d: `M${i * 10} 0h10v10h-10Z`, title: { x: i * 10 + 5, y: 5, text: name }, sub: null })),
      routes: ROUTE_IDS.map((id, i) => ({ id, style: id === '1' ? 'stripe' : id < 'C' && isNaN(+id) ? 'licence' : 'mercury', d: `M${i} 0L${i} 9`, head: `M${i} 9L${i - 1} 8L${i + 1} 8Z`, marker: `M${i - 2} 5a2 2 0 1 0 4 0a2 2 0 1 0 -4 0Z`, num: { x: i, y: 6 } })),
      labels: [{ x: 1, y: 1, size: 7, tone: 'ink', text: 'Fund expenses' }],
      guides: [{ d: 'M0 0L0 10' }],
      caption: { x: 1, y: 2, size: 6.5, text: 'Grey lines: who manages whom.' },
    },
    rails: [
      { rail: 'stripe', name: 'Stripe', text: 'Axal VC Management LLC only: plans and subscriptions, investor tiers, partner services, marketplace and perks. Receipts name Management as merchant.' },
      { rail: 'mercury', name: 'Mercury', text: 'every fund and intercompany flow, by wire or ACH. Fund money never touches Stripe.' },
    ],
    signing: { address: '16192 Coastal Highway, Lewes, Delaware 19958', email: 'legal@axal.vc', routing: 'Routing: the platform and every partner agreement, Management.' },
  };
  if (audience === 'super_admin') {
    m.accounts = accounts !== undefined ? accounts : ENTITIES.map(([key, name]) => ({
      key, name, accounts: key === 'gp'
        ? [{ label: 'GP operating', account_kind: 'checking', account_masked: '••••4417', account_last4: '4417' }]
        : key === 'fund' ? [{ label: 'Fund reserve', account_kind: 'savings', account_masked: '••••8806', account_last4: '8806' }] : [],
    }));
  }
  return m;
}

const originals = { ...api }, contractOriginals = { ...contractsApi }, structureOriginal = fundStructureApi.read;
const never = () => new Promise(() => {});
let reads = 0;
function setup(answer) {
  reads = 0;
  for (const key of Object.keys(originals)) if (typeof originals[key] === 'function') api[key] = never;
  for (const key of Object.keys(contractOriginals)) contractsApi[key] = never;
  fundStructureApi.read = () => { reads += 1; return answer(); };
}
function restore() { Object.assign(api, originals); Object.assign(contractsApi, contractOriginals); fundStructureApi.read = structureOriginal; }

const at = { search: '' };
function Where() { const l = useLocation(); at.search = l.search; return null; }
const element = () => React.createElement(AuthProvider, null, React.createElement(Desk), React.createElement(Where));

async function open(user, answer, url = '/admin/contracts?sheet=structure') {
  setup(answer);
  const view = await mountContracts(element(), url, user);
  await view.flush(); await view.flush();
  return view;
}
const sheet = (view) => view.nodes().find((n) => view.props(n)?.['data-testid'] === 'fund-structure-sheet');
const textIn = (view, node) => {
  const walk = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(walk).join(' ') : n.textContent || '');
  return walk(node).replace(/\s+/g, ' ');
};
const links = (view, label) => view.nodes().filter((n) => n.tagName === 'A' && textIn(view, n).trim() === label);

test('#1855 the sheet reads nothing until it opens; the door opens it and Close removes `sheet`', async () => {
  let view = await open(SUPER, () => Promise.resolve(model('super_admin')), '/admin/contracts');
  try {
    assert.equal(reads, 0, 'the desk alone makes no read');
    assert.equal(sheet(view), undefined);
    await view.click('Structure of the Fund');
    await view.flush(); await view.flush();
    assert.match(at.search, /sheet=structure/);
    assert.equal(reads, 1);
    assert.ok(sheet(view));
    await view.click('Close');
    await view.flush();
    assert.doesNotMatch(at.search, /sheet=/);
    assert.equal(sheet(view), undefined);
  } finally { await view.unmount(); restore(); }
  view = await open(SUPER, () => Promise.resolve(model('super_admin')), '/admin/contracts?tab=templates&sheet=structure');
  try {
    assert.equal(reads, 1, 'one read on a deep link');
    assert.ok(sheet(view));
    await view.click('Close'); await view.flush();
    assert.match(at.search, /tab=templates/, 'Close keeps the other params');
  } finally { await view.unmount(); restore(); }
});

test('#1855 the Super Admin sees the masked endings, "Not opened yet", "No notice purpose" and "Bank accounts" in the header and the sheet', async () => {
  const view = await open(SUPER, () => Promise.resolve(model('super_admin')));
  try {
    const t = textIn(view, sheet(view));
    assert.match(t, /••••4417/);
    assert.match(t, /GP operating/);
    assert.match(t, /ending 4417/, 'the flows table');
    assert.match(t, /••••8806/, 'the Fund\'s reserve');
    assert.ok((t.match(/Not opened yet/g) || []).length >= 5, 'every empty Operating or Reserve cell');
    assert.match(t, /No notice purpose/, 'Management receives nothing');
    assert.match(t, /Capital contributions; GP commitment/);
    const bank = links(view, 'Bank accounts');
    assert.equal(bank.length, 2, 'one in the desk header, one in the sheet');
    for (const a of bank) assert.equal(view.props(a).href ?? view.props(a).to, '/admin/platform/bank-accounts');
    assert.ok(!t.includes(WITHHELD));
  } finally { await view.unmount(); restore(); }
});

test('#1855 a plain Admin sees the sentence in every account cell, no ending and no "Bank accounts" link', async () => {
  const view = await open(ADMIN, () => Promise.resolve(model('admin')));
  try {
    const t = textIn(view, sheet(view));
    const accounts = view.nodes().find((n) => view.props(n)?.role === 'table' && view.props(n)['aria-label'] === 'The accounts');
    const rows = accounts.childNodes.filter((n) => view.props(n)?.role === 'row').slice(1);
    assert.equal(rows.length, 4);
    for (const r of rows) {
      assert.equal(textIn(view, r.childNodes[1]).trim(), WITHHELD, 'Operating');
      assert.equal(textIn(view, r.childNodes[2]).trim(), WITHHELD, 'Reserve');
    }
    assert.doesNotMatch(t, /Not opened yet/);
    for (const n of ['4417', '8806']) assert.ok(!view.text().includes(n), n);
    assert.equal(links(view, 'Bank accounts').length, 0);
  } finally { await view.unmount(); restore(); }
});

test('#1855 a failed read says so with Try again; Try again reads once more; null accounts keep the map and the table', async () => {
  let view = await open(SUPER, () => Promise.reject(new Error('controlled read failure')));
  try {
    const t = textIn(view, sheet(view));
    assert.match(t, /Unreadable\. Structure of the Fund could not be read\./);
    assert.doesNotMatch(t, /\b0\b/, 'no figure');
    await view.click('Try again'); await view.flush();
    assert.equal(reads, 2);
  } finally { await view.unmount(); restore(); }
  view = await open(SUPER, () => Promise.resolve(model('super_admin', { accounts: null })));
  try {
    const t = textIn(view, sheet(view));
    assert.match(t, /Unreadable\. The accounts could not be read\./);
    assert.ok(view.nodes().some((n) => view.props(n)?.['data-testid'] === 'fund-structure-map'), 'the map still draws');
    assert.match(t, /Row 8 flow/, 'the flows table still draws');
    assert.match(t, /Who signs, and where/);
  } finally { await view.unmount(); restore(); }
});

test('#1855 the map draws one marker per route with its id, one table row per row, and paths only', async () => {
  const view = await open(SUPER, () => Promise.resolve(model('super_admin')));
  try {
    const markers = view.nodes().filter((n) => view.props(n)?.['data-testid'] === 'fund-structure-marker');
    assert.equal(markers.length, ROUTE_IDS.length);
    const ids = view.nodes().filter((n) => n.tagName === 'G' && view.props(n)?.['data-route']).map((n) => view.props(n)['data-route']);
    assert.deepEqual(ids, ROUTE_IDS);
    const flows = view.nodes().find((n) => view.props(n)?.role === 'table' && view.props(n)['aria-label'] === 'The flows');
    const rows = flows.childNodes.filter((n) => view.props(n)?.role === 'row').slice(1);
    assert.deepEqual(rows.map((r) => textIn(view, r.childNodes[0]).trim()), ['1', '2', '3', '4', '5', '6', '7', '8']);
    // The map's own nodes: an icon elsewhere on the desk may draw a <line>.
    const map = view.nodes().find((n) => view.props(n)?.['data-testid'] === 'fund-structure-map');
    const inMap = (n) => [n, ...(n.childNodes || []).flatMap(inMap)];
    const tags = new Set(inMap(map).map((n) => n.tagName).filter(Boolean));
    assert.ok(tags.has('PATH') && tags.has('TEXT'));
    for (const t of ['LINE', 'POLYLINE', 'POLYGON', 'CIRCLE', 'RECT']) assert.ok(!tags.has(t), t);
  } finally { await view.unmount(); restore(); }
});

test('#1855 the copy is the canvas\'s, verbatim, and no arrow character appears in either view or the two sources', async () => {
  for (const [user, audience] of [[SUPER, 'super_admin'], [ADMIN, 'admin']]) {
    const view = await open(user, () => Promise.resolve(model(audience)));
    try {
      const t = textIn(view, sheet(view));
      assert.doesNotMatch(view.text(), ARROWS, audience);
      for (const copy of [
        'Structure of the Fund', 'Who signs, and where', 'The accounts',
        'A and B: the two platform licences. The Investment Management Agreement is a stub for counsel to confirm and receives no fee here.',
        'Masked to the last four. Reserve accounts never appear in payment instructions.',
        'All four at 16192 Coastal Highway, Lewes, Delaware 19958 · legal notices to legal@axal.vc. Routing: the platform and every partner agreement, Management.',
        'By: Axal VC GP LLC, its general partner · Joseph Gabriel Guillaume Lauzier · General Partner',
        'Stripe · Axal VC Management LLC only',
        'Mercury · every fund and intercompany flow',
      ]) assert.ok(t.includes(copy), `${audience}: ${copy}`);
      for (const h of ['No.', 'Flow', 'Rail', 'Receiving account', 'Entity', 'Role', 'Signs', 'Signatory', 'Operating', 'Reserve', 'Receives on paper']) {
        assert.ok(t.includes(h), h);
      }
    } finally { await view.unmount(); restore(); }
  }
  for (const f of ['FundStructureSheet.jsx', 'FundStructureMap.jsx']) {
    assert.doesNotMatch(readFileSync(new URL(`../src/pages/admin/contracts/${f}`, import.meta.url), 'utf8'), ARROWS, f);
  }
});

test('#1855 a branch sees no door and no link, and nothing is read', async () => {
  const view = await open(BRANCH, () => Promise.resolve(model('super_admin')));
  try {
    assert.equal(reads, 0);
    assert.equal(sheet(view), undefined);
    assert.ok(!view.nodes().some((n) => n.tagName === 'BUTTON' && textIn(view, n).trim() === 'Structure of the Fund'));
    assert.equal(links(view, 'Bank accounts').length, 0);
  } finally { await view.unmount(); restore(); }
});
