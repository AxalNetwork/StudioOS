// D1096 (#2961) — Vercel's Choose projects on its connector page: the
// installation's projects, the venture they feed, Save and sync behind an
// in-page dialog, and a read that fails or comes back empty saying why. No
// test reaches the network: the API is injected.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/vercel_projects_d1096.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';
import VercelProjectsSection from '../src/pages/account/VercelProjectsSection.jsx';
import { MAX_PROJECTS, emptyProjects, projectsRead, saveSentence, vercelRefusal, ventureOptions } from '../src/pages/account/vercelProjectsModel.js';

const h = React.createElement;
const READ = { ok: true, action: 'projects', result: {
  selection: 'selected',
  available: [{ id: 'prj_web', name: 'acme-web', framework: 'nextjs', chosen: true }, { id: 'prj_docs', name: 'acme-docs', framework: null, chosen: false }],
  selected: ['prj_web'], project_id: 100, max: 50,
} };
const VENTURES = [{ id: 100, name: 'Acme Health' }, { id: 101, name: 'Side bet' }];

function fakeApi({ read = async () => READ, patch = async () => ({ ok: true }), sync = async () => ({ ok: true, summary: 'Synced 2 projects from Vercel.' }) } = {}) {
  const calls = [];
  return {
    calls,
    action: async (uid, name) => { calls.push(['action', uid, name]); return read(); },
    patchConfig: async (uid, body) => { calls.push(['patch', uid, body]); return patch(body); },
    sync: async (uid) => { calls.push(['sync', uid]); return sync(); },
  };
}

async function mounted({ api = fakeApi(), ventures = async () => VENTURES, p = { key: 'vercel', connection: { uid: 'u-vercel' } } } = {}) {
  const restore = installDocument();
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const node = create(tag); node.querySelector = () => null; node.querySelectorAll = () => []; node.focus = () => {}; node.children = []; return node; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  document.getElementById = () => null;
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  let changed = 0;
  await act(async () => root.render(h(VercelProjectsSection, { p, api, projectsApi: { listProjects: ventures }, onChanged: () => { changed += 1; } })));
  const flush = () => act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(document.body); };
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const all = (id) => nodes().filter((n) => pr(n)['data-testid'] === id);
  const by = (id) => all(id)[0];
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  return {
    api, by, all, pr, text: () => text(document.body), changed: () => changed,
    async click(n) { const x = typeof n === 'string' ? by(n) : n; assert.ok(x, `no ${n}`); await act(async () => pr(x).onClick?.({ preventDefault() {} })); await flush(); },
    async change(n, value) { const x = typeof n === 'string' ? by(n) : n; await act(async () => pr(x).onChange?.({ target: { value } })); await flush(); },
    async close() { await act(async () => root.unmount()); restore(); },
  };
}

test('the model: what the read becomes, why a list is empty, what Save says, and each refusal\'s sentence', () => {
  const r = projectsRead(READ);
  assert.deepEqual(r, { selection: 'selected', available: [{ id: 'prj_web', name: 'acme-web', framework: 'nextjs' }, { id: 'prj_docs', name: 'acme-docs', framework: null }], selected: ['prj_web'], projectId: 100 });
  assert.deepEqual(projectsRead({ result: { available: [{ id: 3 }], selected: ['ghost'], project_id: 'x' } }), { selection: 'all', available: [], selected: [], projectId: null }, 'malformed rows and unknown picks are dropped');
  assert.match(emptyProjects('selected'), /reaches no project/);
  assert.match(emptyProjects('all'), /no project yet/);
  for (const s of [emptyProjects('selected'), emptyProjects('all')]) assert.doesNotMatch(s, /\b0\b/, 'never a zero');
  assert.equal(saveSentence(1, 'Acme Health'), 'Axal VC will read 1 project for Acme Health and sync them now. Nothing changes on Vercel.');
  assert.equal(saveSentence(2, null), 'Axal VC will read 2 projects and sync them now. Nothing changes on Vercel.');
  assert.match(vercelRefusal({ code: 'invalid_config', message: 'project_not_accessible', data: { error: 'invalid_config', message: 'project_not_accessible' } }), /no longer in the Vercel integration/);
  assert.match(vercelRefusal({ code: 'action_failed', message: 'That action did not complete.', data: { upstream: 'vercel_rate_limited' } }), /slow down/);
  assert.match(vercelRefusal({ code: 'company_not_enabled' }), /not enabled for your company/);
  assert.equal(vercelRefusal({ code: 'x', message: 'The Worker said this.' }), 'The Worker said this.');
  assert.equal(vercelRefusal(null), 'Vercel could not be read. Try again.');
  assert.deepEqual(ventureOptions({ items: [{ id: 5, name: '' }, { id: 0 }] }), [{ id: 5, name: 'Venture 5' }]);
  assert.equal(MAX_PROJECTS, 50);
});

test('it lists what the installation reaches, with the saved picks and venture, and says the choice was made on Vercel', async () => {
  const v = await mounted();
  try {
    assert.deepEqual(v.api.calls[0], ['action', 'u-vercel', 'projects']);
    const boxes = v.all('vercel-project-choice');
    assert.deepEqual(boxes.map((b) => v.pr(b).checked), [true, false]);
    assert.equal(v.pr(v.by('vercel-projects-venture')).value, 100);
    assert.match(v.text(), /Projects chosen on Vercel/);
    assert.match(v.text(), /acme-docs\s?Framework not recorded/);
  } finally { await v.close(); }
});

test('Save opens a dialog that says what changes; confirming saves the venture and the picks, then syncs once', async () => {
  const v = await mounted();
  try {
    await v.change(v.all('vercel-project-choice')[1], 'on');
    await v.click('vercel-projects-save');
    assert.equal(v.api.calls.filter((c) => c[0] !== 'action').length, 0, 'opening the dialog writes nothing');
    assert.match(v.text(), /Axal VC will read 2 projects for Acme Health and sync them now\. Nothing changes on Vercel\./);
    await v.click('vercel-projects-confirm-go');
    assert.deepEqual(v.api.calls.slice(1), [['patch', 'u-vercel', { project_id: 100, projects: ['prj_web', 'prj_docs'] }], ['sync', 'u-vercel']]);
    assert.equal(v.text().includes('Synced 2 projects from Vercel.'), true);
    assert.ok(!v.by('vercel-projects-confirm'), 'the dialog closes');
    assert.equal(v.changed(), 1);
  } finally { await v.close(); }
});

test('a refused save keeps the dialog open with the reason; no venture or no pick cannot be saved', async () => {
  const refuse = Object.assign(new Error('project_not_accessible'), { code: 'invalid_config', data: { error: 'invalid_config', message: 'project_not_accessible' } });
  const v = await mounted({ api: fakeApi({ patch: async () => { throw refuse; } }) });
  try {
    await v.click('vercel-projects-save');
    await v.click('vercel-projects-confirm-go');
    assert.match(v.by('vercel-projects-error') ? v.text() : '', /no longer in the Vercel integration/);
    assert.ok(v.by('vercel-projects-confirm'), 'still open');
    assert.ok(!v.api.calls.some((c) => c[0] === 'sync'), 'nothing synced after a refused save');
    await v.change('vercel-projects-venture', '');
    assert.equal(v.pr(v.by('vercel-projects-save')).disabled, true, 'no venture');
  } finally { await v.close(); }
  const none = await mounted({ api: fakeApi({ read: async () => ({ result: { ...READ.result, selected: [] } }) }) });
  try { assert.equal(none.pr(none.by('vercel-projects-save')).disabled, true, 'no pick'); } finally { await none.close(); }
});

test('an empty list says why, a failed read says so with Try again, and no connection draws nothing', async () => {
  const empty = await mounted({ api: fakeApi({ read: async () => ({ result: { selection: 'selected', available: [], selected: [] } }) }) });
  try {
    assert.ok(empty.by('vercel-projects-empty'));
    assert.match(empty.text(), /reaches no project/);
    assert.doesNotMatch(empty.text(), /\b0 projects?\b/);
  } finally { await empty.close(); }
  const failed = await mounted({ api: fakeApi({ read: async () => { throw Object.assign(new Error('That action did not complete on the connected account.'), { code: 'action_failed', data: { upstream: 'vercel_rate_limited' } }); } }) });
  try {
    assert.match(failed.text(), /Vercel asked Axal VC to slow down/);
    assert.ok(!failed.by('vercel-projects-list'));
  } finally { await failed.close(); }
  const nothing = await mounted({ p: { key: 'vercel', connection: null } });
  try { assert.ok(!nothing.by('connector-page-vercel-projects')); } finally { await nothing.close(); }
});

test('the source: no browser pop-up, every colour has its dark pair, and the page mounts it for Vercel only', () => {
  const src = readFileSync('frontend/src/pages/account/VercelProjectsSection.jsx', 'utf8');
  assert.doesNotMatch(src, /window\.(confirm|alert|prompt)\(|\bconfirm\(|\balert\(/);
  for (const m of src.matchAll(/className="([^"]*)"/g)) {
    if (/\b(bg|text|border)-(white|gray|red|emerald|axal)/.test(m[1])) assert.match(m[1], /dark:/, m[1]);
  }
  assert.match(readFileSync('frontend/src/pages/account/ConnectorPage.jsx', 'utf8'), /\{p\.key === 'vercel' && <VercelProjectsSection p=\{p\} onChanged=\{onChanged\} \/>\}/);
});
