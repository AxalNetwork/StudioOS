// D655 follow-up (#1884), the frontend half — GitHub's page draws the StudioOS
// App's install link from the repositories read's `install_url`, labelled by
// `needs_install`, and a Refresh that reads the list again. The link is drawn
// only when the URL is the exact shape the Worker builds; the "No repository"
// row says when the App is not installed; Build's lightbox keeps its own UI.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/github_install_link_d655.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import GithubRepositoriesSection from '../src/pages/account/GithubRepositoriesSection.jsx';
import GithubSyncSheet from '../src/pages/account/GithubSyncSheet.jsx';
import { EMPTY_REPOS, emptyRepoSentence, githubLink, installHref } from '../src/pages/account/githubSync.js';

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
    by, pr, settle, text: (n = container) => txt(n).replace(/\s+/g, ' ').trim(),
    async click(id) { const n = by(id); if (!n) throw new Error(`Missing ${id}`); await act(async () => { pr(n).onClick?.({ preventDefault() {} }); }); await settle(); },
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}

const URL_OK = 'https://github.com/apps/axal-vc-studioos/installations/new';
const REPOS = [{ full_name: 'acme/app', private: true, updated_at: null }, { full_name: 'acme/site', private: false, updated_at: null }];
function fake(reads) {
  const calls = [];
  let n = 0;
  return {
    calls,
    api: {
      repositories: async () => { calls.push('repositories'); const r = reads[Math.min(n, reads.length - 1)]; n += 1; return r; },
      setRepositories: (...a) => { calls.push(['setRepositories', ...a]); return new Promise(() => {}); },
      sync: async () => ({ counts: {} }),
      syncStatus: async () => ({ state: 'done' }),
    },
  };
}
const GH = { key: 'github', display_name: 'GitHub', connection: { uid: 'g1' } };
const page = (api) => h(MemoryRouter, null, h(GithubRepositoriesSection, { p: GH, api, wait: async () => {}, projectsApi: { listProjects: async () => [] } }));
const NOT_INSTALLED = 'No repository The StudioOS app isn’t installed on your GitHub account or organization yet. Install it on GitHub and choose its repositories there, then press Refresh.';

test('the words: only the Worker\'s exact install URL, two labels, three empty sentences', () => {
  // Mutation checked: drop the `$` anchor → the `/installations/new/../x` case is drawn.
  assert.equal(installHref(URL_OK), URL_OK);
  for (const bad of [null, 7, '', 'javascript:alert(1)', 'http://github.com/apps/a/installations/new', 'https://github.com.evil.example/apps/a/installations/new',
    'https://github.com/apps/a/installations/new?x=1', 'https://github.com/apps/a/installations/new/../x', 'https://github.com/apps/-a/installations/new', 'https://github.com/apps/A/installations/new']) {
    assert.equal(installHref(bad), null, String(bad));
  }
  assert.deepEqual(githubLink({ installUrl: URL_OK, needsInstall: true }), { href: URL_OK, label: 'Install the StudioOS app on GitHub' });
  assert.deepEqual(githubLink({ installUrl: URL_OK, needsInstall: false }), { href: URL_OK, label: 'Add or remove repositories on GitHub' });
  assert.equal(githubLink({ installUrl: null, needsInstall: true }), null);
  assert.equal(emptyRepoSentence({}), EMPTY_REPOS, 'an older Worker sends neither field: today\'s sentence');
  assert.equal(emptyRepoSentence({ needsInstall: false, installUrl: URL_OK }), EMPTY_REPOS);
  assert.match(emptyRepoSentence({ needsInstall: true, installUrl: URL_OK }), /isn’t installed .* then press Refresh\.$/);
  assert.match(emptyRepoSentence({ needsInstall: true, installUrl: null }), /its install link isn’t set up on Axal yet\.$/);
});

test('not installed: the page says so and links to the install page in a new tab', async () => {
  // Mutation checked: drop target="_blank" → the new-tab assertion fails; label by `installUrl` alone → the label is wrong.
  const f = fake([{ available: [], selected: [], project_id: null, needs_install: true, install_url: URL_OK }]);
  const m = await mount(page(f.api));
  try {
    assert.ok(m.text().includes(NOT_INSTALLED), m.text());
    const a = m.by('github-install-link');
    assert.ok(a, 'the link is drawn');
    assert.equal(m.pr(a).href, URL_OK);
    assert.equal(m.pr(a).target, '_blank');
    assert.match(m.pr(a).rel, /\bnoreferrer\b/);
    assert.equal(m.text(a), 'Install the StudioOS app on GitHub');
    assert.ok(m.by('button-repos-refresh'));
  } finally { await m.unmount(); }
});

test('installed: the link reads "Add or remove repositories"; no install URL, or a foreign one, draws no link but keeps Refresh', async () => {
  const a = await mount(page(fake([{ available: REPOS, selected: ['acme/app'], project_id: 3, needs_install: false, install_url: URL_OK }]).api));
  try { assert.equal(a.text(a.by('github-install-link')), 'Add or remove repositories on GitHub'); } finally { await a.unmount(); }
  for (const install_url of [null, 'https://evil.example/apps/a/installations/new']) {
    const m = await mount(page(fake([{ available: [], selected: [], project_id: null, needs_install: true, install_url }]).api));
    try {
      assert.equal(m.by('github-install-link'), undefined, String(install_url));
      assert.ok(m.text().includes('its install link isn’t set up on Axal yet.'));
      assert.ok(m.by('button-repos-refresh'));
    } finally { await m.unmount(); }
  }
});

test('Refresh reads again, keeps the unsaved choices still listed and drops the rest; it waits while saving', async () => {
  // Mutation checked: Refresh resets `chosen` from `selected` → acme/site is lost; drop `disabled={busy}` → it is pressable while saving.
  const f = fake([
    { available: [], selected: [], project_id: 3, needs_install: true, install_url: URL_OK },
    { available: REPOS, selected: ['acme/app'], project_id: 3, needs_install: false, install_url: URL_OK },
    { available: [REPOS[1]], selected: [], project_id: 3, needs_install: false, install_url: URL_OK },
  ]);
  const m = await mount(page(f.api));
  try {
    assert.ok(m.text().includes(NOT_INSTALLED));
    await m.click('button-repos-refresh');
    assert.deepEqual(f.calls, ['repositories', 'repositories']);
    assert.ok(m.text().includes('0 selected'), 'a re-read keeps the member\'s choices, not `selected`');
    assert.equal(m.text(m.by('github-install-link')), 'Add or remove repositories on GitHub');
    await m.click('repo-acme/app');
    await m.click('repo-acme/site');
    assert.ok(m.text().includes('2 selected'));
    await m.click('button-repos-refresh');
    assert.equal(f.calls.length, 3);
    assert.ok(m.text().includes('1 selected'), 'acme/app is no longer listed: dropped; acme/site kept');
    assert.equal(m.pr(m.by('repo-acme/site'))['aria-pressed'], true);
    await m.click('button-sync-selected');
    assert.equal(f.calls[3][0], 'setRepositories');
    assert.equal(m.pr(m.by('button-repos-refresh')).disabled, true, 'no re-read while saving');
  } finally { await m.unmount(); }
});

test('Build\'s lightbox keeps its own UI: no install link and no Refresh', async () => {
  const f = fake([{ available: [], selected: [], project_id: 3, needs_install: true, install_url: URL_OK }]);
  const m = await mount(h(MemoryRouter, null, h(GithubSyncSheet, { p: GH, conn: GH.connection, projectId: 3, eyebrow: 'Build', onClose() {}, api: f.api, wait: async () => {} })));
  try {
    assert.equal(m.by('github-install-link'), undefined);
    assert.equal(m.by('button-repos-refresh'), undefined);
    assert.ok(m.text().includes(NOT_INSTALLED), 'the empty row still says why');
  } finally { await m.unmount(); }
});
