/**
 * D696 (#1658) PR 2, the part S1 cleared on 2026-10-17: the record addresses
 * and their redirects, Grow's record ids, and the module tab's Back label.
 *
 *   8. routes and redirects: `/validate/customer-research/:id` renders the
 *      interview review, the old `/validate/interviews/:id` and the canvas's
 *      two module slugs redirect through `ParamRedirect` with the query, the
 *      hash and an encoded id, and `isCyclePath` covers record paths;
 *   9. Grow's and Validate's rows (decision 7): `recordId` is the Worker's id
 *      or null, never a fallback made from an index or a label; the
 *      interviewee cell points at `/validate/customer-research/<id>` and is
 *      text inside a linked row (decision 6), and no adapter links
 *      `/validate/interviews`;
 *   `cycleTabs`' `{ back }` relabels the active module tab.
 *
 * The four `/:slug/:id` routes, the client methods and record mode are the
 * rest of PR 2 and are not here.
 *
 * Run with:  node --import ./frontend/test/_deck-loader.mjs --test frontend/test/record_routes_d696.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { codeOnly } from './_codeOnly.mjs';
import { routeBlock } from './_routes.mjs';
import { mountContracts } from './_contracts_dom.mjs';
import { ParamRedirect } from '../src/pages/cycles/ParamRedirect.jsx';
import { isCyclePath } from '../src/pages/cycles/cyclePaths.js';
import { cycleTabs } from '../src/pages/cycles/cycleModel.js';
import { RECORDS as GROW } from '../src/pages/cycles/adapters/grow.js';
import { RECORDS as VALIDATE } from '../src/pages/cycles/adapters/validate.js';
import CycleModulePage from '../src/pages/cycles/CycleModulePage.jsx';
import { recordId, rowLinks } from '../src/pages/cycles/recordModel.js';

const h = React.createElement;
const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const APP = codeOnly(read('frontend/src/App.jsx'));

// --- 8. Routes and redirects ---------------------------------------------------

test('8. the interview review is Customer research\'s record; the old address and the canvas slugs redirect', () => {
  const guard = "guard\\(labRoles\\(\\['admin', 'founder'\\]\\), ";
  assert.match(routeBlock(APP, '/validate/customer-research/:id'), new RegExp(`element=\\{${guard}<InterviewReviewPage />\\)\\}`));
  assert.match(routeBlock(APP, '/validate/interviews/:id'), new RegExp(`element=\\{${guard}<ParamRedirect to="/validate/customer-research/:id" />\\)\\}`));
  assert.doesNotMatch(routeBlock(APP, '/validate/interviews/:id'), /<InterviewReviewPage/, 'the old address renders the page no more');
  for (const [from, to] of [
    ['/validate/experiments-and-evidence', '/validate/experiments'],
    ['/validate/experiments-and-evidence/:id', '/validate/experiments/:id'],
    ['/validate/demand-and-urgency-signals', '/validate/demand-signals'],
    ['/validate/demand-and-urgency-signals/:id', '/validate/demand-signals/:id'],
  ]) {
    assert.match(routeBlock(APP, from), new RegExp(`element=\\{<ParamRedirect to="${to}" />\\}`), from);
  }
  // Exported beside HistoryRedirect.
  const at = APP.indexOf('export function HistoryRedirect(');
  assert.ok(at > 0 && APP.indexOf('export { ParamRedirect };', at) > at && APP.indexOf('export { ParamRedirect };', at) < at + 500);
  // It never interpolates a raw param, as TicketsRedirect does.
  assert.match(read('frontend/src/pages/cycles/ParamRedirect.jsx'), /encodeURIComponent\(params\[name\] \?\? ''\)/);
});

/** Mounts `path` under one route and returns where the redirect landed. */
async function landing(routePath, to, entry) {
  const out = {};
  const Where = () => { const l = useLocation(); out.at = `${l.pathname}${l.search}${l.hash}`; return null; };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const view = await mountContracts(h(Routes, null,
    h(Route, { path: routePath, element: h(ParamRedirect, { to }) }),
    h(Route, { path: '*', element: h(Where) })), entry);
  try { await view.flush(); return out.at; } finally { await view.unmount(); }
}

test('8. ParamRedirect keeps the query and the hash, and encodes the id', async () => {
  assert.equal(await landing('/validate/interviews/:id', '/validate/customer-research/:id', '/validate/interviews/5?session=9#t'),
    '/validate/customer-research/5?session=9#t');
  assert.equal(await landing('/validate/experiments-and-evidence/:id', '/validate/experiments/:id', '/validate/experiments-and-evidence/3?project_id=2'),
    '/validate/experiments/3?project_id=2');
  assert.equal(await landing('/validate/demand-and-urgency-signals', '/validate/demand-signals', '/validate/demand-and-urgency-signals'),
    '/validate/demand-signals');
  assert.equal(await landing('/validate/interviews/:id', '/validate/customer-research/:id', '/validate/interviews/a%20b'),
    '/validate/customer-research/a%20b');
  assert.equal(await landing('/validate/interviews/:id', '/validate/customer-research/:id', '/validate/interviews/x%2F..%2Fadmin'),
    '/validate/customer-research/x%2F..%2Fadmin', 'an id cannot add a path segment');
});

test('8. isCyclePath is true for a record path', () => {
  for (const p of ['/build/solution-design/7', '/raise/data-room/12', '/validate/customer-research/5']) assert.equal(isCyclePath(p), true, p);
  assert.equal(isCyclePath('/validate/customer-research/5/extra'), false);
});

// --- 9. Grow's rows (decision 7) -------------------------------------------------

const ROWS = {
  'product-improvement': [{ uid: 'fb-1', body: 'Slow export' }, { body: 'No uid' }],
  distribution: [{ uid: 'ch-2', name: 'Newsletter' }, { name: 'No uid' }],
  'revenue-and-traction': [{ id: 'mrr', kpi: 'MRR' }, { kpi: 'Churn' }],
  'team-expansion': [{ id: 12, title: 'Engineer' }, { title: 'Unsaved role' }],
  'partner-network': [{ uid: 'pt-3', name: 'Example Partner' }, { name: 'No uid' }],
  'market-expansion': [{ uid: 'mk-4', name: 'Sampleland' }, { name: 'No uid' }],
  'durable-company-building': [{ id: 7, title: 'Annual filing' }, { title: 'No id' }],
};
const WORKER_ID = {
  'product-improvement': 'fb-1', distribution: 'ch-2', 'revenue-and-traction': 'mrr', 'team-expansion': '12',
  'partner-network': 'pt-3', 'market-expansion': 'mk-4', 'durable-company-building': '7',
};

test('9. each Grow row\'s recordId is the Worker\'s own id as a string, or null; its key keeps its fallback', () => {
  for (const [slug, [withId, without]] of Object.entries(ROWS)) {
    const a = GROW[slug].row(withId, 0);
    const b = GROW[slug].row(without, 1);
    assert.equal(a.recordId, WORKER_ID[slug], slug);
    assert.equal(b.recordId, null, `${slug}: a fallback is never a record`);
    assert.ok(b.id != null, `${slug}: the row keeps a key`);
    assert.equal(recordId(b), null);
    assert.equal(rowLinks({ linkable: true }, b), false, `${slug}: a null recordId is never linked, even with linkable`);
    assert.equal(rowLinks({ linkable: true }, a), true, slug);
    assert.equal(rowLinks({ linkable: false }, a), false, `${slug}: without linkable the row is plain`);
  }
  // Every Grow module with a row-id line is covered.
  assert.deepEqual(Object.keys(GROW).filter((k) => typeof GROW[k].row === 'function').sort(), Object.keys(ROWS).sort());
  // Team expansion's role cell keeps its own job link.
  assert.deepEqual(GROW['team-expansion'].row({ id: 12, title: 'Engineer' }, 0).cells.role, { text: 'Engineer', href: '/jobs/12/manage' });
});

test('9. no Grow recordId is built from an index or a label', () => {
  const src = codeOnly(read('frontend/src/pages/cycles/adapters/grow.js'));
  const ids = [...src.matchAll(/recordId: ([^,}]+)/g)].map((m) => m[1].trim());
  assert.equal(ids.length, 7);
  for (const expr of ids) {
    assert.match(expr, /^workerId\(r\.(uid|id)\)$/, expr);
  }
  assert.doesNotMatch(src, /recordId:[^,}]*`/, 'no template-built recordId');
});

// --- 9. Validate's rows (decision 7, PR 2 step 7) -----------------------------

const V_ROWS = {
  'problem-discovery': [{ id: 3, theme: 'Slow onboarding', mentions: 4 }, { theme: 'No group yet', mentions: 1 }],
  'customer-research': [{ id: 41, interviewee: 'Dana Ruiz', company: 'Example Co' }, { interviewee: 'Unsaved' }],
  'ideal-customer-profile': [{ id: 5, segment: 'Ops leads' }, { segment: 'No id' }],
  'market-intelligence': [{ id: 12, company: 'Example Rival' }, { company: 'No id' }],
  'demand-signals': [{ id: 'signal-9', signal: 'preorder' }, { signal: 'waitlist' }],
  experiments: [{ id: 8, hypothesis: 'H1 · Teams pay' }, { hypothesis: 'No id' }],
  // D693 (#1704): a Decisions row opens its decision's record.
  verdict: [{ id: 14, decision: 'proceed', state: 'given' }, { decision: 'stop', state: 'withheld' }],
};
const V_WORKER_ID = {
  'problem-discovery': '3', 'customer-research': '41', 'ideal-customer-profile': '5',
  'market-intelligence': '12', 'demand-signals': 'signal-9', experiments: '8', verdict: '14',
};

test('9. each Validate row\'s recordId is the Worker\'s own id as a string, or null; its key keeps its fallback', () => {
  for (const [slug, [withId, without]] of Object.entries(V_ROWS)) {
    const a = VALIDATE[slug].row(withId, 0);
    const b = VALIDATE[slug].row(without, 1);
    assert.equal(a.recordId, V_WORKER_ID[slug], slug);
    assert.equal(b.recordId, null, `${slug}: a fallback is never a record`);
    assert.equal(recordId(b), null, slug);
    assert.equal(rowLinks({ linkable: true }, b), false, `${slug}: a null recordId is never linked, even with linkable`);
    assert.equal(rowLinks({ linkable: true }, a), true, slug);
    assert.equal(rowLinks({ linkable: false }, a), false, `${slug}: without linkable the row is plain`);
  }
  // The row keys are unchanged: Problem discovery's stays its theme fallback, so cycle_adapters_d661 holds.
  assert.equal(VALIDATE['problem-discovery'].row(V_ROWS['problem-discovery'][0], 0).id, 'theme-0-Slow onboarding');
  assert.equal(VALIDATE['ideal-customer-profile'].row(V_ROWS['ideal-customer-profile'][1], 2).id, 'segment-2');
  // Every Validate module with a row-id line is covered.
  assert.deepEqual(Object.keys(VALIDATE).filter((k) => typeof VALIDATE[k].row === 'function').sort(), Object.keys(V_ROWS).sort());
});

test('9. no Validate recordId is built from an index or a label', () => {
  const src = codeOnly(read('frontend/src/pages/cycles/adapters/validate.js'));
  const ids = [...src.matchAll(/recordId: ([^,}]+)/g)].map((m) => m[1].trim());
  assert.equal(ids.length, 7);
  for (const expr of ids) assert.equal(expr, 'workerId(r.id)', expr);
  assert.doesNotMatch(src, /recordId:[^,}]*`/, 'no template-built recordId');
});

test('9. the interviewee cell points at Customer research\'s record, and is text inside a linked row', () => {
  const cols = [{ key: 'interviewee', label: 'Interviewee' }, { key: 'company', label: 'Company' }];
  const row = VALIDATE['customer-research'].row({ id: 41, interviewee: 'Dana Ruiz', company: 'Example Co' });
  assert.deepEqual(row.cells.interviewee, { text: 'Dana Ruiz', href: '/validate/customer-research/41' });
  const markup = (linkable) => renderToStaticMarkup(h(MemoryRouter, null, h(CycleModulePage, {
    cycle: 'validate', slug: 'customer-research', search: '?project_id=3',
    data: { card: { name: 'Customer research' }, records: { linkable, cols, rows: [row] } },
  })));
  const hrefs = (html) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]).filter((x) => x.includes('/customer-research/'));
  // Linked: the row opens the record once, and the cell inside it is plain text.
  assert.deepEqual(hrefs(markup(true)), ['/validate/customer-research/41?project_id=3']);
  // Not linked (the read sent no `linkable`): the cell is the one way to the review.
  assert.deepEqual(hrefs(markup(false)), ['/validate/customer-research/41']);
});

test('9. no adapter output links /validate/interviews', () => {
  const dir = 'frontend/src/pages/cycles/adapters';
  for (const name of readdirSync(resolve(process.cwd(), dir)).filter((n) => n.endsWith('.js'))) {
    assert.doesNotMatch(codeOnly(read(`${dir}/${name}`)), /\/validate\/interviews\//, name);
  }
  for (const [slug, [withId]] of Object.entries(V_ROWS)) {
    assert.doesNotMatch(JSON.stringify(VALIDATE[slug].row(withId, 0)), /\/validate\/interviews/, slug);
  }
});

// --- cycleTabs' back -------------------------------------------------------------

test('cycleTabs relabels the active module tab with { back }, and leaves the others', () => {
  const cards = [{ slug: 'solution-design', name: 'Solution design' }, { slug: 'prototype-mvp', name: 'Prototype / MVP' }];
  const plain = cycleTabs('build', cards, 'solution-design', '?project_id=3');
  assert.equal(plain.find((t) => t.key === 'solution-design').name, 'Solution design');
  assert.equal(plain.some((t) => t.back), false);
  const tabs = cycleTabs('build', cards, 'solution-design', '?project_id=3', { back: '‹ Back to Solution design' });
  const active = tabs.find((t) => t.key === 'solution-design');
  assert.deepEqual(active, { key: 'solution-design', name: '‹ Back to Solution design', href: '/build/solution-design?project_id=3', active: true, back: true });
  assert.equal(tabs.find((t) => t.key === 'prototype-mvp').name, 'Prototype / MVP');
  assert.equal(tabs.find((t) => t.key === 'prototype-mvp').back, undefined);
  assert.equal(tabs[0].name, 'Overview');
});
