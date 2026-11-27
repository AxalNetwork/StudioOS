// D1086 (#2951, #2405 part 2) — Notion's Sources section on its connector
// page, the two-step Add a source dialog, and the shared From Notion part
// (`pages/cycles/FromNotion.jsx`), mounted against a fake `notionApi`. No test
// reaches Notion or the Worker.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/notion_sources_d1086.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import NotionSourcesSection, { mapFrom } from '../src/pages/account/NotionSourcesSection.jsx';
import FromNotion from '../src/pages/cycles/FromNotion.jsx';
import {
  NOTION_MODULES, kindFor, lastRead, previewWarning, rowList, skippedSentence, sourcesCount, syncSummary,
} from '../src/pages/account/notionModel.js';

const h = React.createElement;

async function mount(el) {
  const restore = installDocument();
  if (!document.documentElement?.classList) document.documentElement = { ...(document.documentElement || {}), classList: { contains: () => false } };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { root.render(h(MemoryRouter, null, el)); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join('') : n.textContent || '');
  return {
    by, pr, settle, text: (n = container) => txt(n).replace(/\s+/g, ' ').trim(),
    async click(id) { const n = by(id); if (!n) throw new Error(`Missing ${id}`); assert.ok(!pr(n).disabled, `${id} is disabled`); await act(async () => { await pr(n).onClick?.({ preventDefault() {} }); }); await settle(); },
    async change(id, value) { const n = by(id); if (!n) throw new Error(`Missing ${id}`); await act(async () => { pr(n).onChange({ target: { value } }); }); await settle(); },
    async submit(id) { const n = by(id); await act(async () => { await pr(n).onSubmit({ preventDefault() {} }); }); await settle(); },
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}

const NOTION = { key: 'notion', display_name: 'Notion', connection: { uid: 'conn-1' } };
const SOURCE = {
  uid: 'a'.repeat(32), project_id: 701, project_name: 'Acme Field', module: 'product_roadmap', module_label: 'Product roadmap', section: 'build',
  kind: 'database', notion_id: 'x', title: 'Roadmap 2027', url: 'https://www.notion.so/roadmap', field_map: null, status: 'active',
  last_synced_at: '2026-10-21T09:00:00Z', last_result: 'ok', last_counts: null,
};
const FIELDS = [
  { key: 'objective', label: 'Objective', type: 'text', required: true, values: null },
  { key: 'status', label: 'Status', type: 'choice', required: false, values: ['now', 'next', 'later', 'done'] },
  { key: 'progress', label: 'Progress', type: 'number', required: false, values: null },
];

function fakeApi(over = {}) {
  const calls = [];
  const rec = (name, out) => async (...a) => { calls.push([name, ...a]); return typeof out === 'function' ? out(...a) : out; };
  return {
    calls,
    api: {
      sources: rec('sources', { connected: true, items: [SOURCE] }),
      stopSource: rec('stopSource', { stopped: true }),
      search: rec('search', { items: [{ id: 'db1', kind: 'data_source', title: 'Roadmap 2027' }, { id: 'pg1', kind: 'page', title: 'A page' }] }),
      addSource: rec('addSource', (b) => ({ source: { ...SOURCE, uid: 'b'.repeat(32), kind: b.kind } })),
      schema: rec('schema', { properties: [{ name: 'Objective', type: 'title' }, { name: 'Stage', type: 'select' }, { name: 'Pct', type: 'number' }], fields: FIELDS, default_sources: null }),
      preview: rec('preview', { rows: [{ n: 1, values: { objective: 'Ship v2', status: 'now' }, skipped: null }, { n: 2, values: null, skipped: { reason: 'empty_required', field: 'objective' } }],
        skipped: [{ reason: 'empty_required', field: 'objective', rows: [2, 4] }], read: 6, more: false, stored: false }),
      mapSource: rec('mapSource', { source: SOURCE }),
      fromNotion: rec('fromNotion', null),
      sync: rec('sync', { ok: true, section: 'build', partial: false, more: false, sources: [] }),
      accept: rec('accept', { ok: true }),
      dismiss: rec('dismiss', { ok: true }),
      deleteFact: rec('deleteFact', { ok: true }),
      ...Object.fromEntries(Object.entries(over).map(([k, fn]) => [k, rec(k, fn)])),
    },
  };
}
const projectsApi = { listProjects: async () => [{ id: 701, name: 'Acme Field' }] };

// ---------------------------------------------------------------- the model

test('the model: the module list mirrors the Worker’s, kinds a module takes, row lists and sentences, never a zero', () => {
  const worker = readFileSync('cloudflare-worker/src/services/notion/modules.ts', 'utf8');
  for (const m of NOTION_MODULES) {
    const line = worker.split('\n').find((l) => l.includes(`${m.key}: { key: '${m.key}'`));
    assert.ok(line, m.key);
    assert.ok(line.includes(`section: '${m.section}'`) && line.includes(`label: '${m.label}'`), m.key);
    assert.ok(line.includes(`kinds: [${m.kinds.map((k) => `'${k}'`).join(', ')}]`), m.key);
  }
  assert.equal(NOTION_MODULES.length, (worker.match(/^ {2}[a-z_]+: \{ key: '/gm) || []).length);
  assert.equal(kindFor('product_roadmap', { kind: 'data_source' }), 'database');
  assert.equal(kindFor('product_roadmap', { kind: 'page' }), null);
  assert.equal(kindFor('market_intelligence', { kind: 'page' }), 'page_tree');
  assert.equal(kindFor('solution_design', { kind: 'page' }), 'page');
  assert.equal(kindFor('solution_design', { kind: 'data_source' }), null);
  assert.equal(rowList([4, 9, 13]), 'Rows 4, 9 and 13');
  assert.equal(rowList([4]), 'Row 4');
  assert.equal(skippedSentence({ reason: 'empty_required', field: 'objective', rows: [9, 12] }, FIELDS, 'Roadmap 2027'),
    'Rows 9 and 12 in “Roadmap 2027” have an empty Objective cell, so they were not read.');
  assert.equal(skippedSentence({ reason: 'empty_required', field: 'objective', rows: 2 }, FIELDS, 'Roadmap 2027'),
    '2 rows in “Roadmap 2027” have an empty Objective cell, so they were not read.');
  assert.equal(previewWarning({ reason: 'bad_value', field: 'progress', rows: [4, 9, 13] }, FIELDS, { fields: { progress: { property: 'Pct' } } }),
    'The Pct property has 3 rows that are not numbers. They will be skipped.');
  assert.deepEqual(lastRead({ last_synced_at: null }), { text: 'Not read yet', tone: 'muted' });
  assert.deepEqual(lastRead({ last_synced_at: '2026-10-21T09:00:00Z', last_result: 'partial' }), { text: '2026-10-21 · Partly read', tone: 'warn' });
  assert.equal(sourcesCount([{ project_id: 1 }, { project_id: 1 }]), '2 pages · 1 venture');
  assert.equal(syncSummary({ sources: [{ result: 'ok', counts: { written: 2, updated: 1 } }, { result: 'unreadable', counts: {} }] }), '2 rows added, 1 row updated. 1 source could not be read.');
  assert.equal(syncSummary({ sources: [{ result: 'ok', counts: { written: 0 } }] }), 'Nothing new in Notion.');
  assert.deepEqual(mapFrom({ objective: 'Objective', status: 'Stage', progress: '' }, { status: { now: ' In progress ', next: '' } }, ''),
    { fields: { objective: { property: 'Objective' }, status: { property: 'Stage', values: { 'In progress': 'now' } } } });
});

// ---------------------------------------------------------------- the connector page

test('Sources: the list with its counts, Stop using asked first in an in-page dialog, a phone stacked; nothing without a connection', async () => {
  const f = fakeApi();
  const m = await mount(h(NotionSourcesSection, { p: NOTION, api: f.api, projectsApi }));
  assert.match(m.text(m.by('notion-sources')), /Pages you shared · 1 page · 1 venture/);
  const row = m.text(m.by(`notion-source-${SOURCE.uid}`));
  for (const s of ['Roadmap 2027', 'Database', 'Acme Field', 'Product roadmap', '2026-10-21']) assert.ok(row.includes(s), s);
  await m.click(`notion-source-stop-${SOURCE.uid}`);
  const dialog = m.text(m.by('notion-stop-dialog'));
  assert.match(dialog, /Stop using “Roadmap 2027”\?/);
  assert.match(dialog, /Product roadmap keeps the rows already read, marked “No longer synced”\./);
  assert.match(dialog, /Axal VC can no longer open this page\. The page in Notion is not changed\./);
  assert.equal(f.calls.filter((c) => c[0] === 'stopSource').length, 0, 'nothing is stopped before the dialog is confirmed');
  await m.click('notion-stop-confirm');
  assert.deepEqual(f.calls.find((c) => c[0] === 'stopSource'), ['stopSource', SOURCE.uid]);
  assert.equal(f.calls.filter((c) => c[0] === 'sources').length, 2, 'the list is read again');
  assert.equal(m.by('notion-stop-dialog'), undefined);
  await m.unmount();

  const phone = await mount(h(NotionSourcesSection, { p: NOTION, api: fakeApi().api, projectsApi, phone: true }));
  assert.ok(phone.by('notion-sources-stack'));
  assert.equal(phone.by('notion-sources-table'), undefined);
  assert.match(phone.text(phone.by(`notion-source-${SOURCE.uid}`)), /Last read 2026-10-21/);
  await phone.unmount();

  const none = await mount(h(NotionSourcesSection, { p: { ...NOTION, connection: {} }, api: fakeApi().api, projectsApi }));
  assert.equal(none.by('notion-sources'), undefined);
  await none.unmount();
});

test('Sources: empty says Share pages with Axal VC; a failed read says so with Try again, never an empty list', async () => {
  const empty = await mount(h(NotionSourcesSection, { p: NOTION, api: fakeApi({ sources: async () => ({ connected: true, items: [] }) }).api, projectsApi }));
  assert.match(empty.text(empty.by('notion-sources-empty')), /Share pages with Axal VC/);
  assert.ok(empty.by('notion-sources-share'));
  await empty.unmount();

  let fail = true;
  const f = fakeApi({ sources: async () => { if (fail) throw new Error('boom'); return { connected: true, items: [SOURCE] }; } });
  const m = await mount(h(NotionSourcesSection, { p: NOTION, api: f.api, projectsApi }));
  assert.match(m.text(m.by('notion-sources-unreadable')), /could not be read\. Try again/);
  assert.equal(m.by('notion-sources-empty'), undefined);
  fail = false;
  await m.click('notion-sources-retry');
  assert.ok(m.by(`notion-source-${SOURCE.uid}`));
  await m.unmount();
});

test('Add a source: a venture, a module and a search; a result the module cannot take is not offered; a database goes on to Map properties with a preview that names skipped rows', async () => {
  const f = fakeApi({ sources: async () => ({ connected: true, items: [] }) });
  const m = await mount(h(NotionSourcesSection, { p: NOTION, api: f.api, projectsApi }));
  await m.click('notion-sources-share');
  assert.ok(m.by('notion-add-dialog'));
  assert.ok(m.pr(m.by('notion-add-search')).disabled, 'search waits for a venture and a module');
  await m.change('notion-add-project', '701');
  await m.change('notion-add-module', 'product_roadmap');
  await m.change('notion-add-q', 'road');
  await m.submit('notion-add-choose');
  assert.deepEqual(f.calls.find((c) => c[0] === 'search'), ['search', '701', 'road']);
  assert.ok(m.by('notion-add-pick-db1'));
  assert.equal(m.by('notion-add-pick-pg1'), undefined, 'Product roadmap takes a database only');
  await m.click('notion-add-pick-db1');
  assert.deepEqual(f.calls.find((c) => c[0] === 'addSource')[1], { project: 701, module: 'product_roadmap', kind: 'database', notion_id: 'db1' });

  // Step 2: Objective is preselected by its name; nothing else is guessed.
  assert.match(m.text(m.by('notion-map-dialog')), /Map “Roadmap 2027” to Product roadmap/);
  assert.match(m.text(m.by('notion-map-dialog')), /Axal VC reads this database\. It never changes it\./);
  assert.equal(m.pr(m.by('notion-map-objective')).value, 'Objective');
  assert.equal(m.pr(m.by('notion-map-status')).value, '');
  await m.change('notion-map-status', 'Stage');
  await m.change('notion-map-value-status-now', 'In progress');
  await m.click('notion-map-preview');
  const asked = f.calls.find((c) => c[0] === 'preview');
  assert.deepEqual(asked[2], { fields: { objective: { property: 'Objective' }, status: { property: 'Stage', values: { 'In progress': 'now' } } } });
  const preview = m.text(m.by('notion-map-preview-rows'));
  assert.match(preview, /Preview · first 2 rows/);
  assert.match(m.text(m.by('notion-map-skipped-objective')), /The Objective property is empty in 2 rows\. They will be skipped\.\s?Rows 2 and 4 of the first 6 read\./);
  assert.match(m.text(m.by('notion-map-preview-2')), /Skipped: Objective is empty/);
  assert.equal(f.calls.filter((c) => c[0] === 'mapSource').length, 0, 'a preview stores nothing');
  await m.click('notion-map-use');
  assert.equal(f.calls.find((c) => c[0] === 'mapSource')[1], 'b'.repeat(32));
  assert.equal(m.by('notion-map-dialog'), undefined);
  await m.unmount();
});

test('Add a source: a required field left as Don’t use holds Preview and Use; a refused search says the Worker’s sentence; a page is saved at once', async () => {
  const refused = Object.assign(new Error('Your Notion is not switched on for this venture’s company.'), { status: 409, data: { detail: 'Your Notion is not switched on for this venture’s company. Switch it on on the Notion page.' } });
  const f = fakeApi({ sources: async () => ({ connected: true, items: [] }), search: async () => { throw refused; } });
  const m = await mount(h(NotionSourcesSection, { p: NOTION, api: f.api, projectsApi }));
  await m.click('notion-sources-share');
  await m.change('notion-add-project', '701');
  await m.change('notion-add-module', 'solution_design');
  await m.submit('notion-add-choose');
  assert.match(m.text(m.by('notion-add-error')), /not switched on for this venture’s company/);
  await m.unmount();

  const g = fakeApi({ sources: async () => ({ connected: true, items: [] }) });
  const n = await mount(h(NotionSourcesSection, { p: NOTION, api: g.api, projectsApi }));
  await n.click('notion-sources-share');
  await n.change('notion-add-project', '701');
  await n.change('notion-add-module', 'solution_design');
  await n.submit('notion-add-choose');
  assert.equal(n.by('notion-add-pick-db1'), undefined, 'Solution design takes no database');
  await n.click('notion-add-pick-pg1');
  assert.equal(g.calls.find((c) => c[0] === 'addSource')[1].kind, 'page');
  assert.equal(n.by('notion-map-dialog'), undefined, 'a page is never mapped');
  assert.equal(n.by('notion-add-dialog'), undefined);
  await n.unmount();

  const h2 = fakeApi({ sources: async () => ({ connected: true, items: [] }), schema: async () => ({ properties: [{ name: 'Goal' }], fields: FIELDS, default_sources: null }) });
  const k = await mount(h(NotionSourcesSection, { p: NOTION, api: h2.api, projectsApi }));
  await k.click('notion-sources-share');
  await k.change('notion-add-project', '701');
  await k.change('notion-add-module', 'product_roadmap');
  await k.submit('notion-add-choose');
  await k.click('notion-add-pick-db1');
  assert.ok(k.pr(k.by('notion-map-use')).disabled);
  assert.ok(k.pr(k.by('notion-map-preview')).disabled);
  assert.match(k.text(k.by('notion-map-missing')), /Choose a property for Objective/);
  await k.change('notion-map-objective', 'Goal');
  assert.ok(!k.pr(k.by('notion-map-use')).disabled);
  await k.unmount();
});

// ---------------------------------------------------------------- From Notion

const READ = {
  module: 'product_roadmap', label: 'Product roadmap', lands: 'fact', connected: true, can_sync: true,
  fields: [{ key: 'objective', label: 'Objective' }, { key: 'status', label: 'Status' }, { key: 'progress', label: 'Progress' }],
  sources: [{ ...SOURCE, mine: true }],
  facts: [
    { ledger_id: 31, mine: true, as_of: '2026-10-21T09:00:00Z', values: { objective: 'Ship v2', status: 'now', progress: 40 } },
    { ledger_id: 32, mine: true, as_of: '2026-10-21T09:00:00Z', values: { objective: 'Hire a designer', status: 'next', progress: null } },
  ],
  kept_deleted: 2, proposals: [], writer_ready: true,
};
const props = (api, extra = {}) => ({ section: 'build', projectId: 701, module: 'product_roadmap', api, ...extra });

test('From Notion: the source line with as-of, Open in Notion and Sync; rows with “—” for an empty cell and the footer; Delete asked first', async () => {
  const f = fakeApi({ fromNotion: async () => READ, sync: async () => ({ ok: true, partial: false, sources: [{ uid: SOURCE.uid, result: 'ok', reason: null, counts: { written: 0, updated: 2, skipped: [] } }] }) });
  const m = await mount(h(FromNotion, props(f.api)));
  assert.match(m.text(m.by('from-notion-title') || m.by('cycle-part-notion')), /“Roadmap 2027” · From Notion, as of 2026-10-21/);
  assert.equal(m.pr(m.by('notion-open')).href, SOURCE.url);
  assert.match(m.text(m.by('notion-fact-31')), /Ship v2/);
  assert.match(m.text(m.by('notion-fact-32')), /—/);
  assert.doesNotMatch(m.text(m.by('notion-fact-32')), /\b0\b/, 'an empty cell is never a zero');
  assert.equal(m.text(m.by('notion-facts-footer')), '2 rows you deleted stay deleted. The “—” under Progress means the Progress value is empty in the database, so nothing was recorded.');

  await m.click('notion-sync');
  assert.ok(f.calls.some((c) => c[0] === 'sync' && c[1] === 'build' && c[2] === 701));
  assert.equal(m.text(m.by('notion-note')), '2 rows updated.');

  await m.click('notion-fact-delete-32');
  const dialog = m.text(m.by('notion-delete-dialog'));
  assert.match(dialog, /Delete this row\?/);
  assert.match(dialog, /“Hire a designer” leaves Product roadmap\. It stays deleted when you sync again\./);
  assert.match(dialog, /“Roadmap 2027” in Notion is not changed\./);
  assert.equal(f.calls.filter((c) => c[0] === 'deleteFact').length, 0);
  await m.click('notion-delete-confirm');
  assert.deepEqual(f.calls.find((c) => c[0] === 'deleteFact'), ['deleteFact', 'build', 701, 32]);
  assert.equal(m.by('notion-delete-dialog'), undefined);
  await m.unmount();
});

test('From Notion: partly synced names the rows not read and offers Sync again; unreadable keeps the rows; a budget spent says there is more', async () => {
  const partial = { ...READ, sources: [{ ...SOURCE, mine: true, last_result: 'partial', last_counts: { read: 6, skipped: [{ reason: 'empty_required', field: 'objective', rows: 2 }] } }] };
  const m = await mount(h(FromNotion, props(fakeApi({ fromNotion: async () => partial }).api)));
  const box = m.text(m.by(`notion-partial-${SOURCE.uid}`));
  assert.match(box, /Partly synced: 4 of 6 rows read\./);
  assert.match(box, /2 rows in “Roadmap 2027” have an empty Objective cell, so they were not read\./);
  assert.match(box, /The 4 rows below are current\. Sync again/);
  await m.unmount();

  const gone = { ...READ, sources: [{ ...SOURCE, mine: true, last_result: 'unreadable' }] };
  const u = await mount(h(FromNotion, props(fakeApi({ fromNotion: async () => gone }).api)));
  const bad = u.text(u.by(`notion-unreadable-${SOURCE.uid}`));
  assert.match(bad, /We could not read “Roadmap 2027”\./);
  assert.match(bad, /Notion says the page was moved, or it is no longer shared with Axal VC\. The rows already read by 2026-10-21 are kept below\./);
  assert.ok(u.by(`notion-choose-again-${SOURCE.uid}`));
  assert.ok(u.by('notion-fact-31'), 'the rows already read are kept');
  await u.unmount();

  const skippedOnly = await mount(h(FromNotion, props(fakeApi({ fromNotion: async () => READ, sync: async () => ({ ok: true, partial: true, more: false, sources: [] }) }).api)));
  await skippedOnly.click('notion-sync');
  assert.equal(skippedOnly.by('notion-more'), undefined, 'skipped rows are not more to read');
  await skippedOnly.unmount();

  const more = await mount(h(FromNotion, props(fakeApi({ fromNotion: async () => READ, sync: async () => ({ ok: true, partial: true, more: true, sources: [] }) }).api)));
  await more.click('notion-sync');
  assert.match(more.text(more.by('notion-more')), /Notion has more to read than one sync takes\..*Sync again/);
  await more.unmount();
});

test('From Notion: proposals with Accept, Dismiss and Changed in Notion; only the owner acts; empty, not connected and a failed read', async () => {
  const read = { ...READ, module: 'solution_design', label: 'Solution design', lands: 'proposal', fields: [], facts: [], kept_deleted: 0,
    sources: [{ ...SOURCE, module: 'solution_design', kind: 'page_tree', mine: true }],
    proposals: [
      { id: 7, mine: true, kind: 'design_note', title: 'Auth flow', extract: 'Login with passkeys', url: 'https://www.notion.so/auth', status: 'pending', changed: true },
      { id: 8, mine: true, kind: 'design_note', title: 'Old note', extract: null, url: null, status: 'dismissed', changed: false },
    ] };
  const f = fakeApi({ fromNotion: async () => read });
  const m = await mount(h(FromNotion, { ...props(f.api), module: 'solution_design' }));
  assert.ok(m.by('notion-proposal-changed-7'));
  assert.match(m.text(m.by('notion-proposal-7')), /Auth flow.*Changed in Notion.*Login with passkeys/);
  assert.match(m.text(m.by('notion-dismissed')), /1 dismissed item stays dismissed until it changes in Notion\./);
  await m.click('notion-accept-7');
  assert.deepEqual(f.calls.find((c) => c[0] === 'accept'), ['accept', 'build', 701, 7]);
  await m.click('notion-dismiss-7');
  assert.deepEqual(f.calls.find((c) => c[0] === 'dismiss'), ['dismiss', 'build', 701, 7]);
  await m.unmount();

  const viewer = await mount(h(FromNotion, { ...props(fakeApi({ fromNotion: async () => ({ ...read, can_sync: false, proposals: read.proposals.map((p) => ({ ...p, mine: false })) }) }).api), module: 'solution_design' }));
  assert.equal(viewer.by('notion-accept-7'), undefined);
  assert.equal(viewer.by('notion-sync'), undefined);
  await viewer.unmount();

  const support = await mount(h(FromNotion, { ...props(fakeApi({ fromNotion: async () => ({ ...read, can_sync: false }) }).api), module: 'solution_design' }));
  assert.equal(support.by('notion-accept-7'), undefined, 'a support session sees the owner’s items, and never acts');
  assert.equal(support.by('notion-dismiss-7'), undefined);
  await support.unmount();

  const ro = await mount(h(FromNotion, props(fakeApi({ fromNotion: async () => ({ ...READ, can_sync: false }) }).api)));
  assert.equal(ro.by('notion-fact-delete-31'), undefined, 'someone else reads, never deletes');
  await ro.unmount();

  const empty = await mount(h(FromNotion, props(fakeApi({ fromNotion: async () => ({ ...READ, sources: [], facts: [], kept_deleted: 0 }) }).api)));
  assert.match(empty.text(empty.by('notion-empty')), /No Notion pages chosen for this module yet\.\s?Axal VC opens only the pages you share\.\s?Choose from Notion/);
  await empty.unmount();

  const off = await mount(h(FromNotion, props(fakeApi({ fromNotion: async () => ({ ...READ, connected: false, can_sync: false, sources: [], facts: [], kept_deleted: 0 }) }).api)));
  assert.match(off.text(off.by('notion-not-connected')), /Notion is not connected yet.*Open the Notion page ›/);
  await off.unmount();

  let fail = true;
  const g = fakeApi({ fromNotion: async () => { if (fail) throw new Error('boom'); return READ; } });
  const bad = await mount(h(FromNotion, props(g.api)));
  assert.match(bad.text(bad.by('notion-read-unreadable')), /From Notion could not be read\. Try again/);
  assert.equal(bad.by('notion-empty'), undefined, 'a failed read is never drawn as empty');
  fail = false;
  await bad.click('notion-read-retry');
  assert.ok(bad.by('notion-fact-31'));
  await bad.unmount();
});

test('From Notion: a phone starts collapsed to one line and opens', async () => {
  const m = await mount(h(FromNotion, props(fakeApi({ fromNotion: async () => READ }).api, { phone: true })));
  assert.equal(m.text(m.by('notion-collapsed')), 'Roadmap 2027 · 2 rows · as of 2026-10-21');
  assert.equal(m.by('notion-facts'), undefined);
  await m.click('notion-collapsed');
  assert.ok(m.by('notion-facts'));
  assert.match(m.text(m.by('notion-fact-31')), /Last read 2026-10-21/);
  await m.unmount();
});

test('the source: mounted on Notion’s page, no browser pop-up, every light hover paired, page text drawn as text', () => {
  const page = readFileSync('frontend/src/pages/account/ConnectorPage.jsx', 'utf8');
  assert.match(page, /\{p\.key === 'notion' && <NotionSourcesSection p=\{p\} phone=\{phone\} \/>\}/);
  for (const file of ['frontend/src/pages/account/NotionSourcesSection.jsx', 'frontend/src/pages/cycles/FromNotion.jsx', 'frontend/src/pages/account/notionModel.js']) {
    const src = readFileSync(file, 'utf8');
    assert.doesNotMatch(src, /\b(alert|confirm|prompt)\(/, file);
    assert.doesNotMatch(src, /dangerouslySetInnerHTML/, file);
    assert.doesNotMatch(src, /console\./, file);
  }
});
