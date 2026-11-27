/**
 * D782 (#2113) — Operating systems' Tools draws GitHub as the Code system
 * (`parts.tools.code`) and each sync as a line (`parts.tools.syncs`), from the
 * module read. The words are `codeSystem.js`'s; this holds them and the page.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import ToolsHistory from '../src/pages/cycles/ToolsHistory.jsx';
import { feedsOf, repositoriesText, syncLineView } from '../src/pages/cycles/codeSystem.js';

const h = React.createElement;
const draw = (tools) => renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/build/operating-systems?project_id=101'] }, h(ToolsHistory, { tools })));

const SYSTEM = {
  kind: 'code', system: 'Code', provider: 'GitHub', source: 'connection', source_label: 'From the GitHub connection',
  state: 'Connected', last_sync: '2026-10-18 09:00:00', failed_at: null, repositories: ['acme/app', 'acme/site'], repositories_total: 2,
  feeds: [
    { module: 'product_roadmap', label: 'Product roadmap', href: '/build/product-roadmap?project_id=101', count: 2 },
    { module: 'prototype_mvp', label: 'Prototype / MVP', href: '/build/prototype-mvp?project_id=101', count: 1 },
  ],
  owner: 'You', action: { text: 'Open', href: '/build/connect?tool=github&project_id=101' },
};
const SYNCS = { state: 'ok', reason: null, rows: [
  { id: 'sync-2', at: '2026-10-18 09:00:00', provider: 'GitHub', state: 'done', repositories: ['acme/app', 'acme/site'], repositories_more: 1,
    arrived: [], text: '12 issues → Product roadmap, 3 pull requests → Prototype / MVP, 2 releases counted', error: null },
  { id: 'sync-1', at: '2026-10-17 08:00:00', provider: 'GitHub', state: 'failed', repositories: null, repositories_more: null,
    arrived: [], text: null, error: '401 /repos/acme/app/issues [hidden]' },
] };
const TOOLS = { cols: [], rows: [], total: 0, state: 'ok', code: { state: 'ok', systems: [SYSTEM], reason: null }, syncs: SYNCS };

test('Tools draws GitHub as the Code system: repositories, last sync, what it fed, labelled as the connection', () => {
  // Mutation checked: drop <CodeSystem> → no tools-code block.
  const out = draw(TOOLS);
  assert.match(out, /data-testid="tools-code"/);
  assert.match(out, /Code · GitHub · Connected/);
  assert.match(out, /From the GitHub connection · You/);
  assert.match(out, /Repositories: acme\/app, acme\/site/);
  assert.match(out, /Last sync: 2026-10-18 09:00:00/);
  assert.match(out, /href="\/build\/product-roadmap\?project_id=101"[^>]*>Product roadmap · 2</);
  assert.match(out, /href="\/build\/prototype-mvp\?project_id=101"[^>]*>Prototype \/ MVP · 1</);
  assert.match(out, /href="\/build\/connect\?tool=github&amp;project_id=101"/);
});

test('each sync is a line, newest first; a failure shows its words', () => {
  // Mutation checked: show `line.text` for a failed line → "Not recorded" replaces the error words.
  const out = draw(TOOLS);
  const first = out.indexOf('data-testid="tools-sync-0"'), second = out.indexOf('data-testid="tools-sync-1"');
  assert.ok(first > 0 && second > first);
  assert.match(out, /2026-10-18 09:00:00 · GitHub · Synced/);
  assert.match(out, /12 issues → Product roadmap, 3 pull requests → Prototype \/ MVP, 2 releases counted/);
  assert.match(out, /acme\/app, acme\/site and 1 more/);
  assert.match(out, /2026-10-17 08:00:00 · GitHub · Failed/);
  assert.match(out, /401 \/repos\/acme\/app\/issues \[hidden\]/);
});

test('no connection, no sync, and a project with no company draw nothing invented', () => {
  // Mutation checked: draw CodeSystem for an empty list → "Code system" appears with no system.
  const empty = draw({ ...TOOLS, code: { state: 'empty', systems: [], reason: 'No GitHub connection is enabled for this company.' }, syncs: { state: 'empty', rows: [], reason: 'No GitHub sync yet.' } });
  assert.doesNotMatch(empty, /tools-code/);
  assert.match(empty, /data-testid="tools-syncs-none">No GitHub sync yet\.</);
  const none = draw({ cols: [], rows: [], state: 'not_recorded', reason: 'This project has no company scope for connectors.',
    code: { state: 'not_recorded', systems: [] }, syncs: { state: 'not_recorded', rows: [] } });
  assert.doesNotMatch(none, /tools-code|tools-syncs/);
  // A read from before D782 carries neither part.
  const before = draw({ cols: [], rows: [], total: 0, state: 'ok' });
  assert.doesNotMatch(before, /tools-code|tools-syncs/);
});

test('the words alone: hidden names give a count, feeds need a count, a line falls back honestly', () => {
  assert.equal(repositoriesText(SYSTEM), 'acme/app, acme/site');
  assert.equal(repositoriesText({ repositories: null, repositories_total: 2 }), '2 repositories', 'the names are not the viewer\'s to see');
  assert.equal(repositoriesText({ repositories: null, repositories_total: 1 }), '1 repository');
  assert.equal(repositoriesText({ repositories: [], repositories_total: 0 }), 'No repository chosen yet');
  assert.deepEqual(feedsOf({ feeds: [{ label: 'X', href: 'https://evil.example/', count: 3 }, { label: 'Y', href: '/y', count: 0 }] }), [{ label: 'X', href: null, text: 'X · 3' }],
    'only a local href, and only a module that received something');
  assert.deepEqual(syncLineView({ state: 'partial', text: '1 issue → Product roadmap', at: 't' }), { at: 't', state: 'Partly synced', failed: false, text: '1 issue → Product roadmap', repositories: null });
  assert.deepEqual(syncLineView({ state: 'failed' }).text, 'The sync did not complete.');
  assert.equal(syncLineView({}).state, 'Not recorded');
});
