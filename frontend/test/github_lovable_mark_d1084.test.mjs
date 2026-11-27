// D1084 (#2949, Lovable part 5 of #2398) — "Synced with Lovable": the
// founder marks a picked GitHub repository in its Repositories list, asked
// first in place; Build's Solution design and Prototype / MVP show the mark;
// the list says how a Lovable project comes in.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/github_lovable_mark_d1084.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import GithubRepositoriesPanel from '../src/pages/account/GithubRepositoriesPanel.jsx';
import SolutionDesignFromCode from '../src/pages/cycles/SolutionDesignFromCode.jsx';
import { releaseCheckView } from '../src/pages/cycles/mvpGithub.js';
import { LOVABLE_HINT, LOVABLE_MARK, isLovable } from '../src/lib/lovableMark.js';

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
    by, text: (n = container) => txt(n).replace(/\s+/g, ' ').trim(),
    async click(id) { const n = by(id); if (!n) throw new Error(`Missing ${id}`); await act(async () => { await pr(n).onClick?.({ preventDefault() {} }); }); await settle(); },
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}

const REPOS = [{ full_name: 'acme/app', private: true, updated_at: '2026-10-03T08:00:00Z' }, { full_name: 'acme/site', private: false, updated_at: null }];
function fake({ marks, patch } = {}) {
  const calls = [];
  return {
    calls,
    api: {
      repositories: async () => ({ available: REPOS, selected: ['acme/app'], project_id: 7, ...(marks ? { synced_with: marks } : {}) }),
      setRepositories: async () => ({}),
      sync: async () => ({ counts: {} }),
      syncStatus: async () => ({ state: 'done' }),
      patchConfig: async (uid, body) => { calls.push([uid, body]); if (patch) return patch(body); const v = body.synced_with['acme/app']; return { ok: true, config: { synced_with: v ? { 'acme/app': v } : {} } }; },
    },
  };
}
const panel = (api) => h(MemoryRouter, null, h(GithubRepositoriesPanel, { p: { key: 'github', display_name: 'GitHub' }, conn: { uid: 'g1' }, projectId: 7, api, wait: async () => {} }));

test('the mark\'s words, and the one value the Worker stores', () => {
  assert.equal(LOVABLE_MARK, 'Synced with Lovable');
  assert.equal(LOVABLE_HINT, 'Built in Lovable? Sync it to GitHub in Lovable, then pick the repository here.');
  assert.equal(isLovable('lovable'), true);
  for (const v of [null, undefined, 'Lovable', true, 'bolt']) assert.equal(isLovable(v), false, String(v));
});

test('Repositories: a saved repository is marked after asking first; an unsaved one has no control; the hint closes the list', async () => {
  // Mutation checked: the patch sent without asking; the control on an unsaved repository; the hint dropped.
  const f = fake();
  const m = await mount(panel(f.api));
  try {
    assert.ok(m.by('repo-lovable-acme/app'), 'acme/app is saved as chosen');
    assert.ok(!m.by('repo-lovable-acme/site'), 'acme/site is not saved, so it carries no mark control');
    assert.equal(m.text(m.by('github-lovable-hint')), LOVABLE_HINT);
    await m.click('repo-lovable-acme/app');
    assert.match(m.text(m.by('repo-lovable-confirm')), /Mark acme\/app as synced with Lovable\?.*Only you can clear it; a sync never changes it\./);
    assert.equal(f.calls.length, 0, 'nothing is saved before Mark it');
    await m.click('repo-lovable-confirm-button');
    assert.deepEqual(f.calls, [['g1', { synced_with: { 'acme/app': 'lovable' } }]]);
    assert.ok(!m.by('repo-lovable-confirm'));
    assert.match(m.text(), /acme\/app Private · updated 3 Oct · Synced with Lovable Clear Lovable mark/);
  } finally { await m.unmount(); }
});

test('Repositories: a marked repository clears after asking; a refused change stays in place with its words', async () => {
  // Mutation checked: a clear sent as "lovable"; the refusal not shown.
  const f = fake({ marks: { 'acme/app': 'lovable' } });
  const m = await mount(panel(f.api));
  try {
    assert.match(m.text(), /acme\/app Private · updated 3 Oct · Synced with Lovable/);
    await m.click('repo-lovable-acme/app');
    assert.match(m.text(m.by('repo-lovable-confirm')), /Clear the Lovable mark on acme\/app\?/);
    await m.click('repo-lovable-confirm-button');
    assert.deepEqual(f.calls, [['g1', { synced_with: { 'acme/app': null } }]]);
    assert.ok(!/Synced with Lovable/.test(m.text(m.by('repo-acme/app')?.parentNode)), 'the mark is gone from the row');
  } finally { await m.unmount(); }
  const refused = fake({ patch: () => { throw Object.assign(new Error('That repository is not one you chose.'), { status: 400 }); } });
  const r = await mount(panel(refused.api));
  try {
    await r.click('repo-lovable-acme/app');
    await r.click('repo-lovable-confirm-button');
    assert.ok(r.by('repo-lovable-error'), 'the refusal is said in place');
    assert.ok(r.by('repo-lovable-confirm'), 'and the question stays open');
  } finally { await r.unmount(); }
});

test('Build: Solution design\'s Built with and a Prototype / MVP release show the mark only where the founder set it', async () => {
  // Mutation checked: every repository marked; the release mark dropped.
  const m = await mount(h(MemoryRouter, null, h(SolutionDesignFromCode, {
    part: { state: 'ok', built_with: [{ repository: 'acme/app', languages: [], topics: [], synced_with: 'lovable' }, { repository: 'acme/site', languages: [], topics: [] }], proposals: [], notes: [] },
    projectId: 7, onChanged() {},
  })));
  try {
    assert.match(m.text(m.by('built-with-acme/app')), /acme\/app · From GitHub · Synced with Lovable/);
    assert.ok(!/Lovable/.test(m.text(m.by('built-with-acme/site'))), 'an unmarked repository says nothing about Lovable');
  } finally { await m.unmount(); }
  assert.equal(releaseCheckView({ tag: 'v1', repository: 'acme/app', synced_with: 'lovable' }).mark, 'acme/app · Synced with Lovable');
  assert.equal(releaseCheckView({ tag: 'v1', repository: 'acme/app' }).mark, null);
  assert.equal(releaseCheckView({ tag: 'v1', repository: 'acme/app', synced_with: 'other' }).mark, null);
});
