/**
 * D753 (#1992, F8) — no side sheet is left on Connectors.
 *
 *  - Nothing under `pages/account` draws the 480px right-hand side sheet.
 *  - A `Sheet` with no frame (the Bank accounts console's Mercury entity
 *    sheet) opens a centred `Lightbox` around itself.
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

test('a Sheet with no frame is a centred dialog, not a side sheet', () => {
  const out = renderToStaticMarkup(h(Sheet, { title: 'Mercury · Axal entities', onClose: () => {}, 'data-testid': 'mercury-entity-sheet' }, h('p', null, 'Rows')));
  assert.match(out, /role="dialog"/);
  assert.match(out, /aria-modal="true"/);
  assert.match(out, /data-testid="sheet-dialog"/, 'the Lightbox frame');
  assert.match(out, /data-testid="mercury-entity-sheet" data-layout="lightbox"/, 'the sheet inside it, in the lightbox layout');
  assert.match(out, /aria-label="Close"/, 'its × closes the dialog');
  assert.doesNotMatch(out, /right-0|inset-y-0/, 'nothing pinned to the right edge');
});

test('a connector\'s page mounts no ConnectorPanel: F1\'s interim panel is gone', () => {
  const page = readFileSync(join(ACCOUNT, 'ConnectorPage.jsx'), 'utf8');
  assert.doesNotMatch(page, /<ConnectorPanel\b|SheetFrame\.Provider|function InlinePanel/);
  assert.equal(pageModel.interimPanel, undefined);
  assert.equal(pageModel.interimMode, undefined);
});
