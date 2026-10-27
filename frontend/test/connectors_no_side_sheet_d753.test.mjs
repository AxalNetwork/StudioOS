/**
 * D753 (#1992, F8) — no side sheet is left on Connectors.
 *
 *  - Nothing under `pages/account` draws the 480px right-hand side sheet.
 *  - A `Sheet` with no frame (the Bank accounts console's Mercury entity
 *    sheet) opened a centred `Lightbox` around itself; since D1317 it opens
 *    the shared detail Sheet (`ui/Sheet.jsx`), its header in the Sheet's.
 *  - A connector's page mounts no `ConnectorPanel`: F1's interim panel is gone.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/connectors_no_side_sheet_d753.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Sheet } from '../src/pages/account/ConnectorSheet.jsx';
import * as pageModel from '../src/pages/account/connectorPageModel.js';

const h = React.createElement;
const ACCOUNT = resolve(process.cwd(), 'frontend/src/pages/account');
const filesUnder = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? filesUnder(p) : /\.(jsx?|css)$/.test(f) ? [p] : [];
});

test('nothing under pages/account draws the 480px side sheet', () => {
  const files = filesUnder(ACCOUNT);
  assert.ok(files.length > 20, 'the folder was read');
  for (const f of files) assert.doesNotMatch(readFileSync(f, 'utf8'), /sm:w-\[480px\]/, f);
});

test('a Sheet with no frame is the shared detail Sheet (D1317), its head in the Sheet’s fixed header', () => {
  const out = renderToStaticMarkup(h(Sheet, {
    eyebrow: 'Bank accounts', title: 'Mercury · Axal entities', sub: 'The four entities.', provider: 'mercury', providerName: 'Mercury', onClose: () => {},
    action: h('a', { href: '/x', 'data-testid': 'pane-action' }, 'Open page'), footer: h('span', { 'data-testid': 'pane-foot' }, 'Audit'), 'data-testid': 'mercury-entity-sheet',
  }, h('p', null, 'Rows')));
  assert.match(out, /role="dialog" aria-modal="true" aria-labelledby="[^"]+"[^>]*data-testid="sheet-dialog" data-width="520"/, 'the shared Sheet, 520px');
  assert.match(out, /class="axs-sheet absolute inset-y-0 right-0/, 'on the right, docked by sheet.css');
  assert.match(out, /data-testid="mercury-entity-sheet" data-layout="sheet"><p>Rows<\/p>/, 'the pane’s body inside the Sheet’s scrolling body');
  const head = out.slice(out.indexOf('data-testid="sheet-dialog-header"'), out.indexOf('data-testid="sheet-dialog-body"'));
  assert.match(head, /Bank accounts.*data-provider="mercury".*Mercury · Axal entities.*The four entities\..*data-testid="pane-action".*data-testid="sheet-dialog-close"/s, 'eyebrow, mark, title, sub, action, then the ×');
  assert.match(out.slice(out.indexOf('data-testid="sheet-dialog-footer"')), /data-testid="pane-foot"/, 'the footer in the fixed footer');
  assert.equal((out.match(/aria-label="Close"/g) || []).length, 1, 'one ×, the Sheet’s');
});

test('a connector\'s page mounts no ConnectorPanel: F1\'s interim panel is gone', () => {
  const page = readFileSync(join(ACCOUNT, 'ConnectorPage.jsx'), 'utf8');
  assert.doesNotMatch(page, /<ConnectorPanel\b|SheetFrame\.Provider|function InlinePanel/);
  assert.equal(pageModel.interimPanel, undefined);
  assert.equal(pageModel.interimMode, undefined);
});
