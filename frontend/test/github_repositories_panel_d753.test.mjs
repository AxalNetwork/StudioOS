// D753 F4 (#1957), part 1 — GitHub's repositories move into
// GithubRepositoriesPanel, which draws no Sheet; GithubSyncSheet becomes its
// frame and renders exactly what it did. The panel's empty row keeps today's
// words and draws `emptySlot` after them (D751 T6, #1884, fills it).
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/github_repositories_panel_d753.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { connectorsApi } from '../src/lib/api/connectors.js';
import GithubRepositoriesPanel from '../src/pages/account/GithubRepositoriesPanel.jsx';
import GithubSyncSheet from '../src/pages/account/GithubSyncSheet.jsx';

const h = React.createElement;

async function mount(el) {
  const restore = installDocument();
  if (!document.documentElement?.classList) document.documentElement = { ...(document.documentElement || {}), classList: { contains: () => false } };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { root.render(el); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join(' ') : n.textContent || '');
  return {
    by, pr, text: (n = container) => txt(n).replace(/\s+/g, ' ').trim(),
    async click(id) { const n = by(id); if (!n) throw new Error(`Missing ${id}`); await act(async () => { await pr(n).onClick?.({ preventDefault() {} }); }); await settle(); },
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}

const REPOS = [{ full_name: 'acme/app', private: true, updated_at: '2026-10-03T08:00:00Z' }, { full_name: 'acme/site', private: false, updated_at: null }];
function fake(available = REPOS, over = {}) {
  const calls = [];
  return {
    calls,
    api: {
      repositories: async (uid, opts) => { calls.push(['repositories', uid, opts ?? null]); return { available, selected: available.length ? ['acme/app'] : [], project_id: null }; },
      setRepositories: async (...a) => { calls.push(['setRepositories', ...a]); return {}; },
      sync: async () => { calls.push(['sync']); return { counts: { issues: 2, pull_requests: 1, releases: 0 } }; },
      syncStatus: async () => ({ state: 'done' }),
      ...over,
    },
  };
}
const GH = { key: 'github', display_name: 'GitHub' };
const EMPTY_WORDS = 'No repository GitHub lists none this installation can read. Add repositories to the StudioOS app in GitHub, then come back.';
const FOOTER_LINE = 'Reads issues, pull requests and releases only.';

test('the panel alone renders the list, the picker and the footer, and no Sheet', async () => {
  const f = fake();
  const m = await mount(h(MemoryRouter, null, h(GithubRepositoriesPanel, { p: GH, conn: { uid: 'g1' }, onClose() {}, api: f.api, wait: async () => {},
    projectsApi: { listProjects: async () => [{ id: 3, name: 'Acme' }] } })));
  try {
    const t = m.text();
    assert.ok(t.includes('Repositories acme/app Private · updated 3 Oct Selected acme/site Public · last update not recorded Not selected'), t);
    assert.ok(t.includes(FOOTER_LINE));
    assert.ok(m.by('sync-project-select'), 'no project from the caller or GET: the picker');
    assert.ok(m.by('button-sync-selected'));
    assert.equal(m.by('connector-sheet-sync'), undefined, 'the panel draws no Sheet');
    assert.ok(!t.includes('Connect GitHub') && !t.includes('Choose what StudioOS reads'), 'no sheet title or sub');
    assert.ok(m.by('github-repositories-panel'), 'its own plain frame');
  } finally { await m.unmount(); }
});

test('no repositories: today\'s empty words, then emptySlot\'s content; without emptySlot, nothing more', async () => {
  const slot = h('a', { href: 'https://github.com/apps/x/installations/new', 'data-testid': 'install-link' }, 'Install the app');
  const a = await mount(h(MemoryRouter, null, h(GithubRepositoriesPanel, { p: GH, conn: { uid: 'g1' }, projectId: 7, onClose() {}, api: fake([]).api, emptySlot: slot })));
  try {
    const t = a.text();
    assert.ok(t.includes(`${EMPTY_WORDS} Install the app`), t);
    assert.ok(a.by('install-link'));
    assert.ok(a.by('github-repositories-empty-slot'));
  } finally { await a.unmount(); }
  const b = await mount(h(MemoryRouter, null, h(GithubRepositoriesPanel, { p: GH, conn: { uid: 'g1' }, projectId: 7, onClose() {}, api: fake([]).api })));
  try {
    assert.ok(b.text().includes(`${EMPTY_WORDS} 0 selected`), 'the row, then the count: nothing between');
    assert.equal(b.by('github-repositories-empty-slot'), undefined);
  } finally { await b.unmount(); }
  // With repositories listed, the slot is never drawn.
  const c = await mount(h(MemoryRouter, null, h(GithubRepositoriesPanel, { p: GH, conn: { uid: 'g1' }, projectId: 7, onClose() {}, api: fake().api, emptySlot: slot })));
  try { assert.equal(c.by('install-link'), undefined); } finally { await c.unmount(); }
});

test('GithubSyncSheet renders the same text as before the move: listed, empty and done', async () => {
  connectorsApi.fed = async () => ({ ok: true, modules: [] });
  const props = (api) => ({ p: GH, conn: { uid: 'g1' }, projectId: 7, eyebrow: 'Build', onClose() {}, back() {}, api, wait: async () => {} });
  // The strings main's GithubSyncSheet rendered at 075c82e51, captured from it.
  const a = await mount(h(MemoryRouter, null, h(GithubSyncSheet, props(fake().api))));
  try {
    assert.equal(a.text(), 'Build Connect GitHub Choose what StudioOS reads. You can change this later. Repositories acme/app Private · updated 3 Oct Selected acme/site Public · last update not recorded Not selected 1 selected Back Reads issues, pull requests and releases only. Sync selected');
    assert.ok(a.by('connector-sheet-sync'));
    await a.click('button-sync-selected');
    assert.ok(a.text().includes('Synced 2 issues and 1 pull request. Product roadmap and Prototype / MVP now show them. Now fed by GitHub'));
    assert.ok(a.by('connector-sheet-success') && a.by('button-connected-done'), 'the success Sheet and its Done');
  } finally { await a.unmount(); }
  const b = await mount(h(MemoryRouter, null, h(GithubSyncSheet, props(fake([]).api))));
  try {
    assert.equal(b.text(), `Build Connect GitHub Choose what StudioOS reads. You can change this later. Repositories ${EMPTY_WORDS} 0 selected Back ${FOOTER_LINE} Sync selected`);
  } finally { await b.unmount(); }
});

test('the move keeps the rules in the panel and the Sheets in the frame', () => {
  const panel = readFileSync('frontend/src/pages/account/GithubRepositoriesPanel.jsx', 'utf8');
  const sheet = readFileSync('frontend/src/pages/account/GithubSyncSheet.jsx', 'utf8');
  assert.doesNotMatch(panel, /<Sheet\b/, 'the panel draws no Sheet');
  assert.match(panel, /api\.repositories\(uid, opts\)/);
  assert.match(panel, /api\.setRepositories\(uid, \[\.\.\.chosen\], project, opts\)/);
  assert.match(sheet, /<GithubRepositoriesPanel/);
  assert.doesNotMatch(sheet, /api\.repositories|api\.sync\(/, 'the frame reads nothing itself');
  // D751's install words are #1884's: nothing here writes them.
  assert.doesNotMatch(panel + sheet, /[Ii]nstall the/);
});
