/**
 * D685 (#1587) §5.4 — the routes and entry points of Record a session: the
 * deep-linkable `/validate/record`, the plain-click-in-place / new-tab-follows
 * link, the retired `?new=record`, Validate's direct module tabs (D694),
 * and the Interviews list's Channel filter, words and title.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/record_routes_d685.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { renderedText } from './_renderedText.mjs';
import { CycleHeader } from '../src/pages/cycles/CycleOverview.jsx';
import { RecordsTable } from '../src/pages/cycles/CycleModulePage.jsx';
import { cellView, cycleTabs, isPlainClick } from '../src/pages/cycles/cycleModel.js';
import { adaptModule, adaptRecords } from '../src/pages/cycles/adapters/index.js';
import { CHANNEL, RECORDS, TITLES } from '../src/pages/cycles/adapters/validate.js';
import { underModule, underSlug } from '../src/pages/cycles/CycleRoute.jsx';
import { MODULES } from '../src/pages/cycles/modules.js';
import { DOORS } from '../src/lib/siteDoors.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const CARDS = [{ slug: 'problem-discovery', name: 'Problem discovery' }, { slug: 'customer-research', name: 'Customer research' }];

test('Validate tabs lead directly to modules and keep the chosen venture', () => {
  const tabs = cycleTabs('validate', CARDS, null, '?project_id=7');
  assert.deepEqual(tabs.map((t) => t.name), ['Overview', 'Problem discovery', 'Customer research']);
  assert.equal(tabs[1].href, '/validate/problem-discovery?project_id=7');
  assert.equal(tabs[1].active, false);
  assert.equal(cycleTabs('validate', CARDS, 'customer-research')[1].active, false);
  assert.equal(cycleTabs('validate', CARDS)[1].href, '/validate/problem-discovery', 'a bad or empty search adds nothing');
  for (const other of ['grow', 'build', 'raise']) {
    assert.equal(cycleTabs(other, CARDS).some((t) => t.name === 'Interviews'), false, `${other} has no Interviews tab`);
  }
});

const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));

test('the header and phone select list Validate modules directly', () => {
  const out = html(h(CycleHeader, { cycle: 'validate', cards: CARDS, search: '?project_id=7', action: { label: 'Record a session', href: '/validate/record?project_id=7' } }));
  const nav = /data-testid="cycle-tabs"[\s\S]*?<\/nav>/.exec(out)[0];
  assert.deepEqual([...nav.matchAll(/>([^<>]+)<\/a>/g)].map((m) => m[1]), ['Overview', 'Problem discovery', 'Customer research']);
  assert.doesNotMatch(out, /<option value="interviews">/);
});

test('a left click with no modifier opens in place; a modified click or a middle click follows the href', () => {
  const plain = { button: 0, defaultPrevented: false };
  assert.equal(isPlainClick(plain), true);
  assert.equal(isPlainClick({ ...plain, button: undefined }), true, 'a synthetic click with no button');
  for (const mod of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey']) assert.equal(isPlainClick({ ...plain, [mod]: true }), false, mod);
  assert.equal(isPlainClick({ ...plain, button: 1 }), false, 'middle click');
  assert.equal(isPlainClick({ ...plain, button: 2 }), false);
  assert.equal(isPlainClick({ ...plain, defaultPrevented: true }), false, 'something already handled it');
  assert.equal(isPlainClick(null), false);
});

async function mount(element) {
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(MemoryRouter, null, element)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  return {
    by: (id) => walk(container).find((n) => pr(n)['data-testid'] === id), pr,
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}
const click = (m, id, extra = {}) => {
  let prevented = false;
  const e = { button: 0, defaultPrevented: false, preventDefault() { prevented = true; this.defaultPrevented = true; }, ...extra };
  m.pr(m.by(id)).onClick(e);
  return prevented;
};

test('the header button and the table\'s add draw one link: a plain click opens the lightbox, a new tab goes to /validate/record', async () => {
  let opened = 0;
  const action = { label: 'Record a session', href: '/validate/record?project_id=7', onOpen: () => { opened += 1; } };
  const header = await mount(h(CycleHeader, { cycle: 'validate', cards: CARDS, action }));
  try {
    assert.equal(header.pr(header.by('cycle-action')).href, '/validate/record?project_id=7', 'a real link, so a new tab and a deep link work');
    assert.equal(click(header, 'cycle-action'), true);
    assert.equal(opened, 1);
    assert.equal(click(header, 'cycle-action', { ctrlKey: true }), false, 'a new tab is not intercepted');
    assert.equal(click(header, 'cycle-action', { metaKey: true }), false);
    assert.equal(click(header, 'cycle-action', { button: 1 }), false);
    assert.equal(opened, 1);
  } finally { await header.unmount(); }
  let added = 0;
  const table = await mount(h(RecordsTable, { title: 'Interviews', records: { cols: [{ key: 'a', label: 'A' }], rows: [], total: 0, page: 1, page_size: 25 }, add: { text: 'Record a session', href: '/validate/record?project_id=7', onOpen: () => { added += 1; } } }));
  try {
    assert.equal(click(table, 'records-add'), true);
    assert.equal(added, 1);
    assert.equal(click(table, 'records-add', { shiftKey: true }), false);
    assert.equal(added, 1);
  } finally { await table.unmount(); }
  const plain = html(h(CycleHeader, { cycle: 'validate', cards: CARDS, action: { label: 'Record a session', href: '/validate/record' } }));
  const a = /<a [^>]*data-testid="cycle-action"[^>]*>/.exec(plain)?.[0] ?? '';
  assert.match(a, /href="\/validate\/record"/, 'with no opener it is just a link');
  assert.doesNotMatch(plain, /<button[^>]*data-testid="cycle-action"/, 'a button or a link, never both');
});

test('which page is under the lightbox: the module the founder was on, else the overview', () => {
  assert.equal(underSlug('/validate/customer-research?project_id=7'), 'customer-research');
  assert.equal(underSlug('/validate/problem-discovery'), 'problem-discovery');
  assert.equal(underSlug('/validate?project_id=7'), null);
  assert.equal(underSlug('/validate'), null);
  assert.equal(underSlug('/validate/record'), null, 'the lightbox is not a page under itself');
  assert.equal(underSlug('/build/roadmap'), null);
  assert.equal(underSlug('//evil.test/validate/x'), null);
  assert.equal(underSlug(undefined), null);
});

test('under the lightbox is one of the cycle\'s modules or the overview, never an unknown slug that would redirect away', () => {
  const mods = MODULES.validate;
  assert.equal(underModule(mods, '/validate/customer-research?project_id=7'), 'customer-research');
  assert.equal(underModule(mods, '/validate/interviews'), null, 'the interview log is a page of its own, not a module');
  assert.equal(underModule(mods, '/validate/pain-map'), null);
  assert.equal(underModule(mods, '/validate/not-a-module'), null);
  assert.equal(underModule(mods, '/validate'), null);
  assert.equal(underModule(undefined, '/validate/customer-research'), null);
});

test('App.jsx serves /validate/record behind the founder guard, as the page and not as a redirect, ahead of /validate/:slug', () => {
  const app = read('frontend/src/App.jsx');
  const rec = app.indexOf('<Route path="/validate/record"');
  const slug = app.indexOf('<Route path="/validate/:slug"');
  assert.ok(rec > 0 && slug > rec, '/validate/record is declared before the slug route');
  const line = app.slice(rec, app.indexOf('\n', rec));
  assert.match(line, /guard\(labRoles\(\['admin', 'founder'\]\), <CycleRoute cycle="validate" lightbox \/>\)/);
  assert.doesNotMatch(line, /<Navigate/);
  const route = read('frontend/src/pages/cycles/CycleRoute.jsx');
  // D695 (#1656): `adding` is the module's `/new` address; `lightbox` is unchanged.
  assert.match(route, /export default function CycleRoute\(\{ cycle, lightbox = false, adding = false, record = false, slug: suppliedSlug \}\)/);
});

test('closing goes back to the page underneath, makes no server call, and a plain click records where it came from', () => {
  const route = read('frontend/src/pages/cycles/CycleRoute.jsx');
  // D686 §5.1: one mechanism for every cycle's lightbox.
  assert.match(route, /if \(location\.state\?\.under\) navigate\(-1\);\s*else navigate\(`\/\$\{cycle\}\$\{q\}`, \{ replace: true \}\);/);
  assert.match(route, /navigate\(`\/\$\{cycle\}\/\$\{def\.path\}\$\{q\}`, \{ state: \{ under: `\$\{location\.pathname\}\$\{location\.search\}` \} \}\)/);
  assert.match(route, /<RecordMount projectId=\{projectId\} interviewId=\{searchParams\.get\('interview'\)\}/);
  assert.match(route, /\{lightbox && Mount && projectId && \(/);
  // D694: `finishPath` names the page, and every finish replaces /record, so Back does not reopen the setup.
  assert.match(route, /const to = finishPath\(session, where, projectId\);\s*navigate\(to, to\.startsWith\('\/validate\/session\/'\) \? \{ state: \{ interview \}, replace: true \} : \{ replace: true \}\);/, 'every finish replaces /record, so Back does not reopen the setup');
  const m = /const closeAction = \(\) => \{[\s\S]*?\n {2}\};/.exec(route)[0];
  assert.doesNotMatch(m, /api\.|fetch|sessions\./);
});

test('both entry points name /validate/record; the old ?new=record is gone from the cycle page and redirects from the log', () => {
  const route = read('frontend/src/pages/cycles/CycleRoute.jsx');
  assert.match(route, /action: \(q, open\) => \(\{ label: 'Record a session', href: `\/validate\/record\$\{q\}`, onOpen: open \}\)/);
  assert.match(route, /'customer-research': \(q, open\) => \(\{ text: 'Record a session', href: `\/validate\/record\$\{q\}`, onOpen: open \}\)/);
  assert.doesNotMatch(route, /new=record/);
  const ws = read('frontend/src/workspaces/founder/FounderValidateWorkspace.jsx');
  assert.match(ws, /if \(newParam === 'record'\) \{[\s\S]*navigate\(`\/validate\/record\$\{rest \? `\?\$\{rest\}` : ''\}`, \{ replace: true \}\);/);
  assert.match(ws, /\['notes', 'upload'\]\.includes\(newParam\)/, 'notes and upload still open the log form');
  assert.doesNotMatch(ws, /RecordSessionSheet/, 'the side sheet is no longer mounted');
  assert.match(ws, /navigate\(`\/validate\/record\?interview=\$\{encodeURIComponent\(r\.id\)\}&project_id=\$\{encodeURIComponent\(projectId\)\}`/, 'a row\'s button opens the same lightbox with Who pre-filled');
  assert.match(DOORS.founders.live.map((i) => i.route).join(' '), /\/validate\/record\b/, 'the door points at the lightbox');
  assert.equal(DOORS.founders.live.some((i) => i.route === '/validate/session/:id'), false);
});

const ROW = { id: 4, interviewee: 'Dana Ruiz', company: 'Acme', date: '2026-10-02', icp_fit: 'strong', consent: 'agreed', stage: 'done' };
const labelsOf = (cols) => cols.map((c) => c.label);

test('the Interviews list: titled Interviews, with a Channel filter, and the channel in words', () => {
  // D697: the three bottom sections' tables carry the canvas's titles (CO:611, :612, :616).
  assert.deepEqual(TITLES, { 'customer-research': 'Interviews', 'problem-discovery': 'Pain themes', experiments: 'Hypotheses' });
  const mod = adaptModule('validate', 'customer-research', { module: { name: 'Customer research' }, records: { cols: ['Interviewee', 'Company', 'Date', 'ICP fit', 'Consent', 'State'], rows: [], total: 0, page: 1, page_size: 25 } });
  assert.equal(mod.module.records_title, 'Interviews');
  assert.equal(mod.module.name, 'Customer research', 'the module keeps its name');
  assert.equal(adaptModule('validate', 'customer-research', { records: { cols: [], rows: [] } }).module.records_title, 'Interviews', 'even when the read carried no module');
  assert.equal(adaptModule('validate', 'customer-research', { module: { records_title: 'The Worker\'s own' } }).module.records_title, 'The Worker\'s own', 'a title the Worker sends wins');
  assert.equal(adaptModule('validate', 'problem-discovery', { module: { name: 'Problem discovery' } }).module.records_title, 'Pain themes');
  assert.equal(adaptModule('validate', 'experiments', { module: { name: 'Experiments and evidence' } }).module.records_title, 'Hypotheses');
  assert.equal('records_title' in adaptModule('validate', 'ideal-customer-profile', { module: { name: 'Ideal customer profile' } }).module, false, 'only the three bottom sections are retitled');
  assert.equal('records_title' in adaptModule('grow', 'customer-research', { module: {} }).module, false);
  const recs = adaptRecords('validate', 'customer-research', { cols: ['Interviewee', 'Company', 'Date', 'ICP fit', 'Consent', 'State'], rows: [{ ...ROW, channel: 'phone' }], total: 1, page: 1, page_size: 25 });
  const f = recs.filters.find((x) => x.key === 'channel');
  assert.equal(f.label, 'Channel');
  assert.deepEqual(f.options, [{ value: 'in_person', label: 'In person' }, { value: 'video', label: 'Video call' }, { value: 'phone', label: 'Audio call' }, { value: 'text', label: 'Text chat' }]);
  assert.deepEqual(recs.filters.map((x) => x.key), ['icp', 'consent', 'channel'], 'D697 decision 4: State replaced Stage; the Worker keeps stage:pipeline for the picker');
  assert.deepEqual(labelsOf(recs.cols).slice(5), ['State'], 'D690: State ends the list; Channel is a filter');
  assert.equal(cellView(recs.rows[0].cells.channel).text, 'Audio call');
});

test('channels are words: all four, the old manual rows, an unknown one as written, and none as Not recorded', () => {
  const cell = (channel) => cellView(RECORDS['customer-research'].row({ ...ROW, channel }).cells.channel);
  assert.equal(cell('in_person').text, 'In person');
  assert.equal(cell('video').text, 'Video call');
  assert.equal(cell('phone').text, 'Audio call');
  assert.equal(cell('text').text, 'Text chat');
  assert.equal(cell('manual').text, 'Entered by hand');
  assert.equal(cell('telegram').text, 'telegram', 'a value this table does not know is shown, not dropped');
  assert.deepEqual(cell(null), { text: 'Not recorded', nr: true });
  assert.deepEqual(cell(undefined), { text: 'Not recorded', nr: true });
  assert.deepEqual(Object.keys(CHANNEL), ['in_person', 'video', 'phone', 'text', 'manual']);
});

test('the Worker already filters the interview log on channel (bound), so the filter needs no new route', () => {
  const svc = read('cloudflare-worker/src/services/cycleValidate.ts');
  assert.match(svc, /AND \(\? = '' OR channel = \?\)/);
  assert.match(svc, /const channel = \['in_person', 'video', 'phone', 'text', 'manual'\]\.includes\(f\.channel\) \? f\.channel : '';/);
  assert.ok(renderedText(html(h(RecordsTable, { title: 'Interviews', records: { cols: [{ key: 'a', label: 'A' }], rows: [], total: 0, page: 1, page_size: 25, filters: [{ key: 'channel', label: 'Channel', options: [{ value: 'video', label: 'Video call' }] }] } }))).includes('Channel: all'));
});
