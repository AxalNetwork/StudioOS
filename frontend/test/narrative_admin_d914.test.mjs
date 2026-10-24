/**
 * D914 (#2698), part 8 of #2454 — the Investor narrative for an admin (NAR13)
 * and for everyone it is not for (NAR14a, NAR14b), against stubbed reads.
 *
 * What this file holds the pages to:
 *   · an admin sees nothing of the narrative before giving a reason; the
 *     reason is checked as the Worker checks it; once given, NAR13's banner
 *     ("Read only. Notes are visible to the founder.") heads the page, with
 *     the reason the founder sees;
 *   · an admin is offered no write: no New version, no edit link, no Add, no
 *     row edit, no fill and no draft band;
 *   · the notes thread opens a dialog that says what posting changes; the
 *     founder sees who read the narrative and why;
 *   · Investors, Advisors, Operating Partners and Explorers read NAR14a's
 *     boundary; a founder refused another venture's narrative reads NAR14b.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { NarrativeAdminGate } from '../src/pages/raise/narrative/NarrativeAdmin.jsx';
import { NarrativeTabPage } from '../src/pages/raise/narrative/NarrativeTool.jsx';
import {
  BOUNDARY, BOUNDARY_ROLES, NOT_RECORDED, OTHER_VENTURE, READ_ONLY, isNarrativeAdmin, kindLabel, noteRow, notePosts, openedLine, readRow, reasonProblem,
} from '../src/pages/raise/narrative/narrativeModel.js';

const h = React.createElement;
const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

// The Worker's shapes; invented words.
const REASON = { id: 1, reason: 'Quarterly portfolio review', by: { name: 'Ada Admin', kind: 'admin' }, created_at: '2026-10-24 17:00:00', expires_at: '2026-10-25 01:00:00' };
const NOTE = { id: 3, version: 4, body: 'Lead Traction with retention before revenue.', author: { name: 'Ada Admin', kind: 'admin' }, created_at: '2026-10-24 17:05:00' };
const OPTIONS = { versions: [{ value: '4', label: 'v4 · seed fund' }] };
const VERSION = { title: 'v4 · seed fund', main: [{ key: 'narrative', title: 'The narrative', rows: [{ a: 'One-liner', b: 'Close the month in a day.' }] }], side: [], actions: [], activity: [] };

async function mounted(element, handle) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u, options = {}) => { requests.push([options.method || 'GET', String(u), options.body || null]); return handle(String(u), options); };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const node = create(tag); node.querySelector = () => null; node.querySelectorAll = () => []; node.focus = () => {}; node.children = []; return node; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: ['/raise/investor-narrative/story?project_id=1'] }, element)));
  const flush = () => act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  return {
    requests, flush, text: () => text(container), props, byId,
    testIds: () => nodes().map((n) => props(n)['data-testid']).filter(Boolean),
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

test('the model: who is an admin here, the reason as the Worker checks it, and the lines the founder reads', () => {
  // Mutation checked: reasonProblem's length floor removed → 'ok' passes; openedLine naming no HQ → the HQ line fails.
  assert.equal(isNarrativeAdmin({ role: 'admin' }), true);
  assert.equal(isNarrativeAdmin({ role: 'founder' }), false);
  assert.equal(isNarrativeAdmin(null), false);
  assert.match(reasonProblem('ok'), /at least 3 characters/);
  assert.match(reasonProblem('x'.repeat(201)), /at most 200 characters/);
  assert.equal(reasonProblem('  Quarterly   review  '), null);
  assert.equal(READ_ONLY, 'Read only. Notes are visible to the founder.');
  assert.equal(openedLine(REASON, 'admin'), 'Opened by an admin for “Quarterly portfolio review”. The founder sees this reason.');
  assert.equal(openedLine(REASON, 'super_admin'), 'Opened by HQ for “Quarterly portfolio review”. The founder sees this reason.');
  assert.equal(openedLine(null, 'admin'), null);
  assert.deepEqual(readRow(REASON), { id: 1, who: 'Ada Admin · Studio admin', reason: 'Quarterly portfolio review', when: '24 Oct' });
  assert.equal(readRow({ id: 2, reason: 'x', by: { kind: 'super_admin' } }).who, `${NOT_RECORDED} · HQ`, 'a missing name is never invented');
  assert.equal(noteRow(NOTE).eye, 'Ada Admin · Studio admin · 24 Oct · on v4');
  assert.equal(noteRow({ ...NOTE, version: null }).eye.endsWith('on the narrative'), true);
  assert.equal(kindLabel('founder'), 'Founder');
  assert.equal(notePosts(4), 'This posts your note on v4. The founder and the venture’s admins see it. It changes nothing in the narrative.');
  assert.deepEqual([...BOUNDARY_ROLES].sort(), ['advisor', 'exploring', 'investor', 'partner']);
  assert.equal(BOUNDARY.title, 'The Investor narrative is for the venture’s founders.');
  assert.equal(OTHER_VENTURE.title, 'This narrative belongs to another venture.');
});

test('an admin sees nothing of the narrative before a reason; the reason opens it under the read-only banner', async () => {
  // Mutation checked: the gate drawing children before `mine` → the child's testid appears in the form state.
  let mine = null;
  const page = await mounted(
    h(NarrativeAdminGate, { projectId: 1 }, h('div', { 'data-testid': 'the-narrative' }, 'The narrative')),
    (url, options) => {
      if (url.includes('/narrative/reads') && options.method === 'POST') { mine = { ...REASON, reason: JSON.parse(options.body).reason }; return response({ read: mine }, 201); }
      if (url.includes('/narrative/reads')) return response({ reads: mine ? [mine] : [], mine, viewer: 'admin' });
      return response({});
    },
  );
  try {
    assert.ok(page.testIds().includes('narrative-reason'));
    assert.ok(!page.testIds().includes('the-narrative'), 'nothing of the narrative is drawn yet');
    assert.match(page.text(), /The founder sees this reason, who gave it and when/);
    const input = page.byId('narrative-reason-input');
    const form = page.byId('narrative-reason');
    await act(async () => page.props(input).onChange({ target: { value: 'ok' } }));
    await act(async () => page.props(form).onSubmit({ preventDefault() {} }));
    assert.ok(page.testIds().includes('narrative-reason-failed'), 'a short reason is refused before it is sent');
    assert.ok(!page.requests.some(([m]) => m === 'POST'));
    await act(async () => page.props(page.byId('narrative-reason-input')).onChange({ target: { value: 'Quarterly portfolio review' } }));
    await act(async () => page.props(page.byId('narrative-reason')).onSubmit({ preventDefault() {} }));
    await page.flush();
    assert.deepEqual(page.requests.filter(([m]) => m === 'POST').map(([, u, b]) => [u.replace(/^.*\/api/, ''), JSON.parse(b)]),
      [['/cycles/raise/narrative/reads?project=1', { reason: 'Quarterly portfolio review' }]]);
    assert.ok(page.testIds().includes('the-narrative'));
    assert.ok(page.testIds().includes('narrative-read-only'));
    assert.match(page.text(), /Read only\. Notes are visible to the founder\./);
    assert.match(page.text(), /Opened by an admin for “Quarterly portfolio review”\. The founder sees this reason\./);
  } finally { await page.close(); }
});

const narrativeHandler = (url) => {
  if (/\/narrative\/4\?/.test(url)) return response({ version: 4, meta: { state: 'ok', investor_type: 'seed_fund' }, sections: { state: 'ok', items: [{ key: 'problem', body: 'Close the month in a day.' }] }, bindings: { state: 'ok', items: [] } });
  if (url.includes('/decks/sources')) return response({ items: [] });
  if (url.includes('/form-options')) return response(OPTIONS);
  if (/\/records\/4\?/.test(url)) return response(VERSION);
  if (url.includes('/narrative/notes')) return response({ notes: [NOTE], viewer: 'founder' });
  if (url.includes('/narrative/reads')) return response({ reads: [REASON], mine: null, viewer: 'founder' });
  return response({});
};

test('Story for an admin: the notes thread, no edit link, no reads list; for the founder: the notes and who read it', async () => {
  // Mutation checked: StoryTab drawing NarrativeReads for an admin → the admin case fails; the admin edit wording kept → "to edit it" appears.
  const admin = await mounted(h(NarrativeTabPage, { tab: 'story', projectId: 1, search: '?project_id=1', admin: true, cards: [] }), narrativeHandler);
  try {
    assert.ok(admin.testIds().includes('narrative-notes'));
    assert.ok(!admin.testIds().includes('narrative-reads'));
    assert.match(admin.text(), /Open v4/);
    assert.ok(!/to edit it/.test(admin.text()), 'an admin is offered no edit');
    for (const id of ['story-words', 'story-note', 'story-save-open', 'story-insert-open']) assert.ok(!admin.testIds().includes(id), `admin must not see ${id}`);
    assert.ok(admin.testIds().includes('story-read-only'));
    assert.ok(!admin.requests.some(([method]) => method === 'PUT'), 'admin reads never save a section');
    assert.match(admin.text(), /Lead Traction with retention before revenue\./);
    assert.match(admin.text(), /Add note/);
  } finally { await admin.close(); }

  const founder = await mounted(h(NarrativeTabPage, { tab: 'story', projectId: 1, search: '?project_id=1', cards: [] }), narrativeHandler);
  try {
    assert.ok(founder.testIds().includes('narrative-notes'));
    assert.ok(founder.testIds().includes('narrative-reads'));
    assert.match(founder.text(), /Ada Admin · Studio admin · 24 Oct/);
    assert.match(founder.text(), /Quarterly portfolio review/);
    assert.match(founder.text(), /One-liner, investor type and what it checks against: open v4/);
    assert.ok(founder.testIds().includes('story-words'), 'founder retains the Story editor');
  } finally { await founder.close(); }
});

test('a note opens a dialog that says what it changes before it is posted', async () => {
  // Mutation checked: the Add button posting directly → a POST is made before the dialog.
  const page = await mounted(h(NarrativeTabPage, { tab: 'story', projectId: 1, search: '?project_id=1', admin: true, cards: [] }), (url, options) => {
    if (url.includes('/narrative/notes') && options.method === 'POST') return response({ note: { ...NOTE, id: 9 } }, 201);
    return narrativeHandler(url);
  });
  try {
    await act(async () => page.props(page.byId('narrative-note-input')).onChange({ target: { value: 'Move the ask up.' } }));
    await act(async () => page.props(page.byId('narrative-note-add')).onClick());
    assert.ok(!page.requests.some(([m]) => m === 'POST'), 'nothing is posted before the dialog');
    assert.match(page.text(), /This posts your note on v4\. The founder and the venture’s admins see it\. It changes nothing in the narrative\./);
    await act(async () => page.props(page.byId('narrative-note-confirm')).onClick());
    await page.flush();
    assert.deepEqual(page.requests.filter(([m]) => m === 'POST').map(([, , b]) => JSON.parse(b)), [{ body: 'Move the ask up.', version: '4' }]);
  } finally { await page.close(); }
});

test('NAR14b: a founder refused another venture\'s narrative reads that it belongs to another venture', async () => {
  const page = await mounted(h(NarrativeTabPage, { tab: 'story', projectId: 2, search: '?project_id=2', cards: [] }), (url) => (url.includes('/form-options') ? response({ detail: 'Forbidden' }, 403) : response({})));
  try {
    assert.ok(page.testIds().includes('narrative-other-venture'));
    assert.match(page.text(), /This narrative belongs to another venture\./);
    assert.match(page.text(), /Open your own narrative/);
  } finally { await page.close(); }
});

test('the routes and CycleRoute: NAR14a for the other profiles, and no write of any kind for an admin', () => {
  // Mutation checked: `add={narrativeAdmin ? undefined :` removed → the Add check fails.
  const app = read('frontend/src/App.jsx');
  // No route is added (D906) and no guard changes: RoleGuard draws the boundary where it would have redirected.
  assert.doesNotMatch(app, /path="\/raise\/investor-narrative/);
  assert.match(app, /<Route path="\/raise\/:slug" element=\{guard\(labRoles\(\['admin', 'founder'\]\), <CycleRoute cycle="raise" \/>\)\} \/>/);
  assert.match(app, /\{ under: \/\^\\\/raise\\\/investor-narrative\(\\\/\|\$\)\/, roles: NARRATIVE_BOUNDARY_ROLES, Panel: NarrativeBoundary \}/);
  const guard = app.slice(app.indexOf('function RoleGuard('), app.indexOf('function AuthScreen('));
  assert.ok(guard.indexOf('if (boundary) return <boundary.Panel />;') > 0 && guard.indexOf('if (boundary) return <boundary.Panel />;') < guard.indexOf('<Navigate to={defaultPath} replace />'),
    'the boundary is drawn instead of the redirect, only for a refused role');
  const route = read('frontend/src/pages/cycles/CycleRoute.jsx');
  assert.match(route, /const narrativeAdmin = cycle === 'raise' && slug === NARRATIVE && isNarrativeAdmin\(user\);/);
  assert.match(route, /const drafts = !record && slug && !narrativeAdmin && /);
  assert.match(route, /const fillKind = !record && slug && !narrativeAdmin && /);
  assert.match(route, /add=\{narrativeAdmin \? undefined : forms\.length/);
  assert.match(route, /rowAction=\{!narrativeAdmin && edit/);
  assert.match(route, /if \(narrativeAdmin && projectStatus !== 'none' && !actionPage\) \{\n\s+body = <NarrativeAdminGate projectId=\{projectId\} onOpened=/);
  assert.match(route, /admin=\{narrativeAdmin\} \/>/);
  const api = read('frontend/src/lib/api.js');
  const exports = api.slice(api.indexOf('// api-modules:begin'), api.indexOf('// api-modules:end')).split('\n').filter(line => line.startsWith('export * from'));
  assert.equal(exports.filter(line => line === "export * from './api/narrative.js';").length, 1);
  assert.deepEqual(exports, [...exports].sort(), 'API modules stay alphabetical as new domains land');
});


test('merged Positioning stays read only for admins while keeping core and version wording visible',async()=>{
 const core=[{kind:'one_liner',position:0,text:'Core words',source:null},{kind:'category',position:0,text:'Core category',source:null}];
 const override=[{kind:'category',position:0,text:'Version wording',source:null}];
 const page=await mounted(h(NarrativeTabPage,{tab:'positioning',projectId:1,search:'?project_id=1',admin:true,cards:[]}), (url)=>{
  if(url.includes('/narrative/positioning'))return response({core,overrides:override,effective:core});
  return narrativeHandler(url);
 });
 try{
  assert.ok(page.testIds().includes('narrative-positioning'));
  assert.match(page.text(),/Core words/);
  assert.match(page.text(),/Version wording/);
  assert.ok(!page.testIds().some(id=>String(id).startsWith('positioning-edit-')||String(id).startsWith('positioning-adjust-')));
  assert.ok(!page.byId('positioning-ask'));
  assert.ok(!page.byId('positioning-review'));
  assert.ok(!page.requests.some(r=>r[0]!=='GET'));
  assert.ok(!page.requests.some(r=>r[1].includes('/positioning/draft')));
 }finally{await page.close();}
});


test('merged Versions keeps reads visible to admins and creation controls for founders only', async () => {
  const saved = [{ value: '4', label: 'v4 · seed fund' }, { value: '3', label: 'v3 · angel' }];
  const versionRows = saved.map(v => ({ version: Number(v.value), audience: v.label, based_on: 'Blank', saved: '2026-10-24', by: 'Fay Founder', read_by: null }));
  const handle = (url) => {
    if (url.includes('/form-options')) return response({ versions: saved });
    if (url.includes('/narrative/compare')) return response({ pairs: [{ key: 'problem', label: 'Problem', a: { body: 'Before' }, b: { body: 'After' }, state: 'changed' }] });
    if (url.includes('/modules/investor-narrative')) return response({ parts: { narrative: { state: 'ok', versions: versionRows } } });
    return narrativeHandler(url);
  };
  for (const admin of [true, false]) {
    const page = await mounted(h(NarrativeTabPage, { tab: 'versions', projectId: 1, search: '?project_id=1', admin, cards: [] }), handle);
    try {
      assert.ok(page.testIds().includes('narrative-read-by'));
      assert.match(page.text(), /from Blank/);
      assert.match(page.text(), /Before/);
      assert.equal(page.testIds().includes('narrative-duplicate'), !admin);
      assert.equal(page.testIds().includes('narrative-start-from'), !admin);
      assert.ok(page.requests.every(([method]) => method === 'GET'));
    } finally { await page.close(); }
  }
});
