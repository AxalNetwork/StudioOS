/**
 * D782 (#2114) — Solution design's "From GitHub" part: Built with (each
 * repository's languages and topics), the proposals GitHub made with Accept
 * and Dismiss, and the accepted architecture notes, from the module read's
 * `parts.from_code`. The words are `designFromCode.js`'s; this holds them,
 * the page and the two calls.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/github_solution_design_d782.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { installDocument } from './_contracts_dom.mjs';
import SolutionDesignFromCode from '../src/pages/cycles/SolutionDesignFromCode.jsx';
import { fromCodeView, githubHref, languagesText } from '../src/pages/cycles/designFromCode.js';
import { cyclesWrite } from '../src/lib/api/cycles.js';
import { makeCycleWrites } from '../src/lib/api/cycleWrites.js';

const h = React.createElement;
const draw = (part) => renderToStaticMarkup(h(SolutionDesignFromCode, { part, projectId: 101, reload() {} }));

const PART = {
  state: 'ok',
  built_with: [{ repository: 'acme/app', languages: [{ name: 'TypeScript', bytes: 9000, pct: 90 }, { name: 'CSS', bytes: 1000, pct: 10 }], topics: ['saas', 'workers'], source_label: 'From GitHub' }],
  proposals: [
    { id: 7, repository: 'acme/app', path: 'docs/adr/0001-ledger.md', title: '1. Use D1 for the ledger', extract: 'We keep one ledger table.', url: 'https://github.com/acme/app/blob/main/docs/adr/0001-ledger.md' },
    { id: 8, repository: 'acme/app', path: 'README.md', title: '<img src=x onerror=alert(1)>', extract: '<script>x</script>', url: 'javascript:alert(1)' },
  ],
  notes: [{ id: 3, title: 'Queues over cron', body: 'For anything that retries.', source_url: 'https://github.com/acme/app/blob/main/docs/notes.md#decisions', source_path: 'acme/app/docs/notes.md' }],
};

test('the words: languages with their share, GitHub links only, and nothing at all when GitHub brought nothing', () => {
  assert.equal(languagesText(PART.built_with[0]), 'TypeScript 90% · CSS 10%');
  assert.equal(languagesText({ languages: [] }), 'No languages reported');
  assert.equal(githubHref('https://github.com/acme/app'), 'https://github.com/acme/app');
  for (const bad of ['javascript:alert(1)', 'http://github.com/x', 'https://github.com.evil.example/x', 'https://u:p@github.com/x', 7]) assert.equal(githubHref(bad), null, String(bad));
  assert.equal(fromCodeView(null).empty, true);
  assert.equal(fromCodeView({ state: 'ok', built_with: [], proposals: [], notes: [] }).empty, true);
  assert.equal(fromCodeView({ state: 'unreadable' }).empty, false, 'an unreadable part still says so');
  assert.equal(draw({ state: 'ok', built_with: [], proposals: [], notes: [] }), '', 'the page claims only what is built');
});

test('the part draws Built with, each proposal with Accept and Dismiss, and the notes; repository text stays text', () => {
  // Mutation checked: drop <BuiltWith> → no built-with block; render the extract as HTML → a live <script>.
  const out = draw(PART);
  assert.match(out, /id="from-github"/);
  assert.match(out, /data-testid="from-code-built-with"/);
  assert.match(out, /acme\/app · From GitHub/);
  assert.match(out, /TypeScript 90% · CSS 10%/);
  assert.match(out, />saas</);
  assert.match(out, /data-testid="design-accept-7"/);
  assert.match(out, /data-testid="design-dismiss-7"/);
  assert.match(out, /acme\/app\/docs\/adr\/0001-ledger\.md · Proposed by GitHub/);
  assert.match(out, /href="https:\/\/github\.com\/acme\/app\/blob\/main\/docs\/adr\/0001-ledger\.md"/);
  assert.doesNotMatch(out, /javascript:/, 'a link that is not GitHub\'s is not drawn');
  assert.doesNotMatch(out, /<script\b|<img\b/i, 'repository text is drawn as text');
  assert.match(out, /&lt;script&gt;x&lt;\/script&gt;/);
  assert.match(out, /data-testid="design-note-3"/);
  assert.match(out, /Queues over cron/);
  assert.match(out, /acme\/app\/docs\/notes\.md ↗/);
  assert.match(draw({ state: 'unreadable', reason: 'What GitHub proposed could not be read.' }), /data-testid="from-code-unreadable"[^>]*>What GitHub proposed could not be read\./);
  assert.match(draw({ ...PART, proposals: [] }), /data-testid="from-code-proposals-none"/);
});

async function mount(part, reload) {
  const restore = installDocument();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(SolutionDesignFromCode, { part, projectId: 101, reload })); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  const click = (id) => act(async () => { props(by(id)).onClick(); await new Promise((r) => setTimeout(r, 0)); });
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '');
  return { by, click, text, async unmount() { await act(async () => root.unmount()); restore(); } };
}

test('Accept and Dismiss each call their route once for that proposal, then reload; a refusal is said', async () => {
  // Mutation checked: Dismiss calls accept → the dismiss call never comes; drop reload → the page keeps the proposal.
  const saved = { ...cyclesWrite.build };
  const calls = [];
  let reloads = 0;
  cyclesWrite.build.acceptDesignProposal = async (project, id) => { calls.push(['accept', project, id]); return { ok: true }; };
  cyclesWrite.build.dismissDesignProposal = async (project, id) => { calls.push(['dismiss', project, id]); throw new Error('That proposal was already accepted or dismissed.'); };
  const m = await mount(PART, () => { reloads += 1; });
  try {
    await m.click('design-accept-7');
    assert.deepEqual(calls, [['accept', 101, 7]]);
    assert.equal(reloads, 1);
    await m.click('design-dismiss-8');
    assert.deepEqual(calls[1], ['dismiss', 101, 8]);
    assert.equal(reloads, 1, 'a refused Dismiss does not reload');
    assert.equal(m.text(m.by('from-code-error')), 'That proposal was already accepted or dismissed.');
  } finally { await m.unmount(); Object.assign(cyclesWrite.build, saved); }
});

test('the two calls go to the Worker\'s routes, and Solution design mounts the part', async () => {
  const sent = [];
  const w = makeCycleWrites(async (path, init) => { sent.push([path, init?.method]); return {}; });
  await w.build.acceptDesignProposal(101, 7);
  await w.build.dismissDesignProposal(101, 8);
  assert.deepEqual(sent, [
    ['/cycles/build/solution-design/proposals/7/accept?project=101', 'POST'],
    ['/cycles/build/solution-design/proposals/8/dismiss?project=101', 'POST'],
  ]);
  const route = readFileSync(new URL('../src/pages/cycles/CycleRoute.jsx', import.meta.url), 'utf8');
  assert.match(route, /'solution-design': \(data, ctx\) => <SolutionDesignFromCode part=\{data\?\.parts\?\.from_code\} projectId=\{ctx\.projectId\} reload=\{ctx\.reload\} \/>/);
  const worker = readFileSync(new URL('../../cloudflare-worker/src/routes/cycle_build.ts', import.meta.url), 'utf8');
  for (const how of ['accept', 'dismiss']) assert.ok(worker.includes(`app.post('/solution-design/proposals/:id/${how}'`), how);
});
