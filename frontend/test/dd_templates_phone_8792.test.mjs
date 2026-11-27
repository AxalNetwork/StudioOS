/**
 * D8792 (#8792) — the Diligence Templates table keeps everything it draws
 * inside its own horizontal scroller.
 *
 * The browser retest (documentation/architecture/decisions/D8792.md) found
 * the document wider than the phone for a Super Admin only: 325 px at 320,
 * and 448 px at 390 and 320 with long section names. The cause was each
 * blocking switch's `sr-only` name: `position: absolute` with no positioned
 * ancestor inside the table's `overflow-x-auto`, so it escaped the scroller,
 * sat at the switch's unscrolled x and widened the page. A restricted reader
 * (no switches) fitted at every width. The switch is now named by
 * `aria-label`. Hit areas and the phone layout wait on the canvas.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/dd_templates_phone_8792.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { mountContracts } from './_contracts_dom.mjs';
import { ddDeskApi } from '../src/lib/api.js';
import { DdListPage } from '../src/pages/AdminDueDiligencePage.jsx';

const ADMIN = { id: 2, role: 'admin', name: 'Test Admin' };
const LONG = 'Founders, team composition and the history of every co-founder departure';
const SECTIONS = [
  { key: 'team', title: LONG, weight: 3, blocking: true, items: 4, by_depth: { lite: 1, standard: 2, deep: 1 } },
  { key: 'market', title: 'Market', weight: 2, blocking: false, items: 4, by_depth: { lite: 1, standard: 2, deep: 1 } },
];
const TEMPLATES = (canEdit) => ({
  can_edit: canEdit,
  templates: ['lite', 'standard', 'deep'].map((depth) => ({
    depth,
    current: { depth, version: 0, built_in: true, sections: SECTIONS, item_count: 8, body: { sections: SECTIONS.map((s) => ({ key: s.key, weight: s.weight, blocking: s.blocking, items: [] })) } },
    versions: [{ version: 0, built_in: true }],
  })),
});

const ORIG = { ...ddDeskApi };
const settle = async (v) => { for (let i = 0; i < 5; i += 1) await act(async () => { await Promise.resolve(); }); await v.flush(); };
async function mount(canEdit) {
  ddDeskApi.templates = async () => TEMPLATES(canEdit);
  const v = await mountContracts(React.createElement(DdListPage, { me: ADMIN }), '/due-diligence/templates');
  await settle(v);
  await settle(v);
  return v;
}
const inTable = (v) => {
  const table = v.nodes().find((n) => v.props(n)?.['data-testid'] === 'dd-template-table');
  assert.ok(table, 'the template table is drawn');
  const out = [];
  const walk = (n) => { out.push(n); (n.childNodes || []).forEach(walk); };
  walk(table);
  return out;
};
const cls = (v, n) => String(v.props(n)?.className || '');

test('a Super Admin’s blocking switches are named by aria-label, with no sr-only element in the table', async () => {
  const v = await mount(true);
  try {
    const nodes = inTable(v);
    const switches = nodes.filter((n) => n.tagName === 'INPUT' && v.props(n)?.type === 'checkbox');
    assert.equal(switches.length, SECTIONS.length, 'one switch per section');
    for (const [i, sw] of switches.entries()) {
      assert.equal(v.props(sw).role, 'switch');
      assert.equal(v.props(sw)['aria-label'], `${SECTIONS[i].title} blocks`, 'the long name is kept whole');
    }
    // Mutation-checked: restoring `<span className="sr-only">… blocks</span>` fails here.
    assert.deepEqual(nodes.filter((n) => /\bsr-only\b/.test(cls(v, n))).map((n) => n.textContent), [],
      'an absolutely positioned name inside the scroller escapes it and widens the page');
  } finally { await v.unmount(); Object.assign(ddDeskApi, ORIG); }
});

test('a restricted reader gets the same table with no control, as before', async () => {
  const v = await mount(false);
  try {
    const nodes = inTable(v);
    assert.equal(nodes.filter((n) => n.tagName === 'INPUT').length, 0);
    assert.ok(nodes.some((n) => (n.textContent || '').includes(LONG)));
  } finally { await v.unmount(); Object.assign(ddDeskApi, ORIG); }
});

test('the table still scrolls inside its own region at phone widths', () => {
  const src = readFileSync(resolve(process.cwd(), 'frontend/src/pages/duediligence/DdTemplates.jsx'), 'utf8');
  assert.match(src, /<div className="overflow-x-auto">\s*<table className="w-full min-w-\[720px\]/, 'the local scroller the retest measured (324 of 720 px at 390)');
  const table = src.slice(src.indexOf('data-testid="dd-template-table"'), src.indexOf('</table>'));
  assert.doesNotMatch(table, /className="[^"]*\bsr-only\b/, 'no sr-only element inside the scroller');
});
