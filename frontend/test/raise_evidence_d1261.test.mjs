// D1261 (#2430) — Raise evidence (VR1–VR19): the founder's Evidence view at
// /raise/evidence with its item and claim drawers as addresses, Evidence lit in
// Raise's tab rail after Overview, the five Source labels with SCORING's one
// grade mapping, strength kept apart, Typed-only never Backed, and the
// investor's block on the deal page — every block "Not read here yet".
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/raise_evidence_d1261.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { EvidenceBody, EvidenceSummary } from '../src/pages/cycles/evidence/RaiseEvidence.jsx';
import {
  AREAS, BASE, CLAIM_STATE, SHARING, SOURCES, WAITS, claimHref, claimWord, gradeOf, itemHref, strengthWord, viewOf,
} from '../src/pages/cycles/evidence/evidenceModel.js';
import { cycleTabs } from '../src/pages/cycles/cycleModel.js';
import { MODULES } from '../src/pages/cycles/modules.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('the address names the page or one drawer; an odd id is no drawer', () => {
  assert.deepEqual(viewOf('/raise/evidence'), { drawer: null, id: null });
  assert.deepEqual(viewOf('/raise/evidence/item/ev_12'), { drawer: 'item', id: 'ev_12' });
  assert.deepEqual(viewOf('/raise/evidence/claim/c9'), { drawer: 'claim', id: 'c9' });
  assert.deepEqual(viewOf('/raise/evidence/item/a.b'), { drawer: null, id: null });
  assert.equal(itemHref('ev_12', '?project=3'), '/raise/evidence/item/ev_12?project=3');
  assert.equal(claimHref('../x'), BASE);
});

test('five Source labels with SCORING’s one grade mapping; strength apart; Typed-only is never Backed', () => {
  assert.deepEqual(SOURCES.map((s) => s.label), ['Connector', 'Document', 'Recorded', 'Signed', 'Typed']);
  assert.deepEqual(SOURCES.map((s) => gradeOf(s.key)), ['measured', 'sourced', 'measured', 'measured', 'stated']);
  assert.equal(strengthWord('measured'), 'Strength: measured');
  assert.equal(strengthWord('Measured'), null);
  assert.deepEqual(Object.values(CLAIM_STATE), ['Backed', 'Founder’s figure', 'Mismatch', 'Not backed']);
  assert.equal(claimWord(undefined), 'Not checked yet');
  assert.deepEqual(Object.values(SHARING), ['Private', 'Summary', 'After NDA']);
  for (const [k, w] of Object.entries(WAITS)) assert.ok(!/\b0\b|\bnone\b/i.test(w), k);
});

test('Raise’s rail: Overview, then Evidence, then Calls, then the modules; Evidence keeps the venture', () => {
  const tabs = cycleTabs('raise', MODULES.raise, 'evidence', '?project_id=7');
  assert.deepEqual(tabs.slice(0, 3).map((t) => [t.name, t.href, t.active]), [['Overview', '/raise?project_id=7', false], ['Evidence', '/raise/evidence?project_id=7', true], ['Calls', '/raise/capital-relationships/calls?project_id=7', false]]);
  assert.ok(!cycleTabs('build', MODULES.build).some((t) => t.key === 'evidence'), 'only Raise has Evidence');
});

/* ------------------------------------------------------------------ *
 * Rendered
 * ------------------------------------------------------------------ */

test('the view: every area unread, each block waits, and a drawer from the address', () => {
  const out = html(h(EvidenceBody));
  for (const a of AREAS) assert.ok(out.includes(a), a);
  for (const id of ['claims', 'proposals', 'coverage', 'opens']) assert.ok(out.includes(`data-testid="evidence-wait-${id}"`), id);
  assert.ok(!out.includes('evidence-drawer-'));
  const item = html(h(EvidenceBody, { drawer: 'item', search: '?project=3' }));
  assert.ok(item.includes('data-testid="evidence-drawer-item"') && item.includes('href="/raise/evidence?project=3"'));
  assert.match(item, /role="dialog" aria-modal="true" aria-labelledby="[^"]+" tabindex="-1" data-testid="evidence-drawer-item" data-width="480"/, 'D1317: the drawer is the shared Sheet at the canvas’s 480');
  assert.ok(item.indexOf('data-testid="evidence-areas"') < item.indexOf('data-testid="evidence-drawer-item-layer"'), 'over the full-width view, not in its flow');
  assert.ok(html(h(EvidenceBody, { drawer: 'claim' })).includes('data-testid="evidence-wait-claim"'));
});

test('the investor block is live (D1268): RaiseEvidence re-exports it, and it no longer waits', () => {
  assert.equal(typeof EvidenceSummary, 'function');
  assert.ok(!read('frontend/src/pages/cycles/evidence/InvestorEvidence.jsx').includes('evidence-wait-investor'));
});

test('D1317: a drawer’s address opens the Sheet over the view, and closing returns to /raise/evidence with the query', async () => {
  const restore = installDocument();
  const make = document.createElement.bind(document);
  document.createElement = (tag) => { const n = make(tag); n.querySelector = () => null; n.focus = () => {}; return n; };
  document.querySelectorAll = () => [];
  document.body.style = { overflow: 'auto', paddingRight: '' };
  let at = null;
  function Probe() {
    const loc = useLocation();
    at = `${loc.pathname}${loc.search}`;
    return h(EvidenceBody, { drawer: viewOf(loc.pathname).drawer, search: loc.search });
  }
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: ['/raise/evidence/claim/c9?project=3'] }, h(Routes, null, h(Route, { path: '*', element: h(Probe) })))); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byTestId = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  try {
    assert.equal(props(byTestId('evidence-drawer-claim')).role, 'dialog');
    assert.ok(byTestId('evidence-areas'), 'over its view');
    await act(async () => { props(byTestId('evidence-drawer-claim-close')).onClick(); });
    assert.equal(at, '/raise/evidence?project=3', 'closing went back to the view, keeping the query');
    assert.equal(byTestId('evidence-drawer-claim'), undefined);
  } finally { await act(async () => root.unmount()); restore(); }
});


/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */

test('the wiring: three routes before /raise/:slug, the deal page’s Evidence tab, the canvas and the docs', () => {
  const app = read('frontend/src/App.jsx');
  for (const p of ['/raise/evidence', '/raise/evidence/item/:id', '/raise/evidence/claim/:id']) {
    assert.ok(app.includes(`<Route path="${p}" element={guard(labRoles(['admin', 'founder']), <RaiseEvidence />)} />`), p);
    assert.ok(app.indexOf(`path="${p}"`) < app.indexOf('path="/raise/:slug"'), `${p} before the module route`);
  }
  const deal = read('frontend/src/pages/DealRoomPage.jsx');
  assert.ok(deal.includes("{tab === 'evidence' && <EvidenceSummary dealId={deal.id} company={deal.project_name || null} />}"));
  assert.ok(!deal.includes("['evidence', 'team'"), 'Evidence is no longer a wait card');
  for (const f of ['Raise Evidence Page.dc.html', 'Raise evidence · Boards.dc.html']) assert.ok(existsSync(`design/incoming/${f}`), f);
  assert.ok(read('design/incoming/Raise evidence · Boards.dc.html').includes('name="Raise Evidence Page"'));
  assert.ok(existsSync('documentation/architecture/decisions/D1261.md'));
  assert.ok(existsSync('documentation/audits/RAISE_EVIDENCE_MAP_2026-10-26.md'));
});
