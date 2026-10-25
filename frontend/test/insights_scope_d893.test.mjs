/**
 * D893 S08 (#2662) — the Super Admin's Scope select on Admin › Insights.
 *
 * The select lists HQ-held and each deployed subsidiary the scopes read
 * answered; a pick sets `?scope=<code>`, the read carries it, and the chip
 * reads "[Branch North] · counts read from its own database" (INS2). Until the
 * list answers no read is made, so HQ's figures never sit under a
 * subsidiary's name. What the Worker answers is tested in
 * cloudflare-worker/test/insights_scope_d893.test.ts.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/insights_scope_d893.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement as h, Children, isValidElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ScopeList } from '../src/pages/admin/insights/AdminInsights.jsx';
import {
  SCOPE_LABEL, SCOPE_NOTE, SCOPE_READING, SCOPE_SOURCE, scopeChip, scopeLines, scopeParam, scopeState,
} from '../src/pages/admin/insights/insightsModel.js';
import { renderedText } from './_renderedText.mjs';

const SCOPES = [
  { code: 'hq', label: 'HQ-held accounts', kind: 'hq', bound: true },
  { code: 'de', label: 'Axal VC DACH', kind: 'branch', bound: true },
  { code: 'north', label: 'Branch North', kind: 'branch', bound: true },
];

/** Every element in a tree, so a test can find an option and press it. */
function elements(node, out = []) {
  if (!isValidElement(node)) return out;
  out.push(node);
  Children.forEach(node.props.children, (c) => {
    if (typeof c === 'function') return;
    elements(c, out);
  });
  return out;
}
const options = (tree) => elements(tree).filter((e) => e.props?.role === 'option');

test('the select lists HQ-held and each subsidiary, and drops the "only HQ" note once one is listed', () => {
  const t = renderedText(renderToStaticMarkup(h(ScopeList, { scopes: SCOPES, current: scopeState('', true, SCOPES), onPick() {} })));
  for (const l of ['HQ-held accounts', 'Axal VC DACH', 'Branch North']) assert.ok(t.includes(l), l);
  assert.ok(!t.includes(SCOPE_NOTE), 'the note says no subsidiary exists');
  const none = renderedText(renderToStaticMarkup(h(ScopeList, { scopes: null, current: scopeState('', true, null), onPick() {} })));
  assert.ok(none.includes('HQ-held accounts'));
  assert.ok(none.includes(SCOPE_NOTE), 'HQ-held alone keeps the canvas note');
  assert.deepEqual(scopeLines([{ code: 'x', label: 'X', kind: 'other' }]).map((l) => l.code), ['hq'], 'only hq and branch lines are drawn');
});

test('a pick sets ?scope=<code>; HQ-held removes it', () => {
  const picked = [];
  const tree = ScopeList({ scopes: SCOPES, current: scopeState('', true, SCOPES), onPick: (c) => picked.push(c) });
  const opts = options(tree);
  assert.deepEqual(opts.map((o) => o.props['data-testid']), ['insights-scope-option-hq', 'insights-scope-option-de', 'insights-scope-option-north']);
  assert.deepEqual(opts.map((o) => o.props['aria-selected']), [true, false, false]);
  opts[2].props.onClick();
  opts[0].props.onClick();
  assert.deepEqual(picked, ['north', 'hq']);
  const page = readFileSync(resolve(process.cwd(), 'frontend/src/pages/admin/insights/AdminInsights.jsx'), 'utf8');
  assert.match(page, /setParam\('scope', code === 'hq' \? null : code\)/, 'HQ-held is the default, never sat in the URL');
});

test('a pick changes the chip, the selected line and the read\'s scope', () => {
  const s = scopeState('?scope=North', true, SCOPES);
  assert.deepEqual(s, { kind: 'branch', asked: 'North', code: 'north', label: 'Branch North' });
  assert.equal(scopeChip(s), `Branch North · ${SCOPE_SOURCE}`);
  assert.equal(scopeChip(s), 'Branch North · counts read from its own database');
  assert.equal(scopeParam(s), 'north');
  const opts = options(ScopeList({ scopes: SCOPES, current: s, onPick() {} }));
  assert.deepEqual(opts.map((o) => o.props['aria-selected']), [false, false, true]);
  const own = scopeState('', true, SCOPES);
  assert.equal(scopeChip(own), SCOPE_LABEL);
  assert.equal(scopeParam(own), undefined, 'HQ-held reads this deployment\'s own, with no scope');
});

test('until the list answers the scope is pending and unread; an unlisted code falls back to HQ-held; a plain Admin is INS10', () => {
  const pending = scopeState('?scope=north', true, null);
  assert.equal(pending.kind, 'pending');
  assert.equal(scopeChip(pending), SCOPE_READING);
  assert.equal(scopeParam(pending), undefined);
  const unknown = scopeState('?scope=south', true, SCOPES);
  assert.equal(unknown.kind, 'unknown');
  assert.equal(scopeChip(unknown), SCOPE_LABEL);
  assert.equal(scopeParam(unknown), undefined);
  assert.equal(scopeState('?scope=hq', true, SCOPES).kind, 'own', 'hq is a scope code, not a branch');
  assert.equal(scopeState('?scope=north', false, SCOPES).kind, 'noperm', 'a listed code is still HQ\'s');
  const page = readFileSync(resolve(process.cwd(), 'frontend/src/pages/admin/insights/AdminInsights.jsx'), 'utf8');
  assert.match(page, /useInsightsReads\(filters, groupKey, !noperm && scope\.kind !== 'pending', scopeParam\(scope\)\)/, 'a pending scope makes no read');
  assert.match(page, /JSON\.stringify\(\{ \.\.\.readParams\(filters\), scope \}\)/, 'the read and the group read carry the scope');
  assert.match(page, /if \(!superAdmin\) return undefined;/, 'only a Super Admin reads the scopes');
});
