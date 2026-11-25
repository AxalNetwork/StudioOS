// D7812 (#7812): rendered attribution walks the canonical publisher reference, never a second publisher list.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import React from 'react';
import { mountContracts } from './_contracts_dom.mjs';
import { researchCompanyPublishersApi } from '../src/lib/api/researchCompanyPublishers.js';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { CompanyHeader } from '../src/pages/research/CompanyProfile.jsx';
import { DirectoryTable, DirectoryCards } from '../src/pages/research/CompanyDirectoryZone.jsx';
import { SubjectCard } from '../src/pages/research/AnalysisSubject.jsx';
import { CompanyPublisherProvider, PublisherBoundary } from '../src/pages/research/CompanySource.jsx';
import { renderedText } from './_renderedText.mjs';
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE research_company_directory(source_name TEXT)');
db.exec(read('../../cloudflare-worker/sql/migrations/202611200052_7810_research_company_publishers.sql'));
const publishers = db.prepare('SELECT * FROM research_company_publishers ORDER BY source_name').all();
db.close();
const inventory = { publishers, label: `company records from ${publishers.length} publishers: ${publishers.map(p => p.source_name).join(', ')}` };
const render = (C, props, value = inventory) => renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(CompanyPublisherProvider, { inventory: value }, React.createElement(C, props))));
const surfaces = row => [
  [DirectoryTable, { items: [row], coverage: {}, links: {} }],
  [DirectoryCards, { items: [row], links: {} }],
  [CompanyHeader, { item: row, tracked: {}, sources: { status: 'ok', rows: [{ source_name: row.source_name, field_name: 'country' }, { source_name: 'Different publisher', field_name: 'foreign field' }] } }],
  [SubjectCard, { read: { data: { item: row } } }],
];
test('every reference publisher appears with its terms, source link, date and required attribution on every surface', () => {
  for (const publisher of publishers) {
    const row = { uid: 'sample', name: 'Synthetic company', source_name: publisher.source_name, source_url: 'https://example.test/record', as_of: '2026-11-20' };
    for (const [C, props] of surfaces(row)) {
      const html = render(C, props); const text = renderedText(html);
      assert.ok(text.includes(publisher.source_name));
      assert.ok(text.includes(publisher.licence_name));
      assert.ok(text.includes('as of 2026-11-20'));
      assert.ok(text.includes(`View the ${publisher.source_name} record`));
      assert.match(html, /href="https:\/\/example.test\/record"/);
      if (publisher.required_attribution) assert.ok(text.includes(publisher.required_attribution));
      for (const other of publishers.filter(p => p.source_name !== publisher.source_name)) assert.ok(!text.includes(other.source_name));
    }
    const header = renderedText(render(CompanyHeader, surfaces(row)[2][1]));
    assert.match(header, /Fields from this source: country/);
    assert.doesNotMatch(header, /foreign field/);
  }
  const boundary = renderedText(render(PublisherBoundary, { attribution: true }));
  assert.ok(boundary.includes(inventory.label));
  for (const p of publishers.filter(p => p.required_attribution)) assert.equal(boundary.split(p.required_attribution).length - 1, 1);
});
test('unknown and absent provenance never borrows a publisher or licence; failed field reads stay unreadable', () => {
  for (const row of [{ uid: 'unknown', source_name: 'Sample unreviewed register', source_license: 'Stored terms', source_url: 'javascript:alert(1)' }, { uid: 'missing' }]) {
    for (const [C, props] of surfaces(row)) {
      const html = render(C, props); const text = renderedText(html);
      assert.ok(text.includes(row.source_name || 'Source not recorded'));
      assert.ok(text.includes(row.source_license || 'Licence not recorded'));
      assert.ok(text.includes('licence terms not reviewed'));
      assert.ok(text.includes('Date not recorded'));
      assert.doesNotMatch(html, /href="javascript:/);
      for (const p of publishers) assert.ok(!text.includes(p.source_name));
    }
  }
  assert.match(renderedText(render(CompanyHeader, { item: {}, sources: { status: 'unreadable' } })), /Fields from this source: Unreadable/);
  assert.doesNotMatch(renderedText(render(CompanyHeader, { item: {}, sources: { status: 'ok', rows: [] } })), /Fields from this source/);
});
test('pages contain no publisher/licence fallback', () => {
  for (const name of ['CompanyProfile', 'AnalysisSubject', 'CompanyDirectoryZone']) {
    const source = read(`../src/pages/research/${name}.jsx`);
    assert.doesNotMatch(source, /recordSource|sourceWords/);
    for (const p of publishers) assert.ok(!source.includes(`'${p.source_name}'`));
    assert.match(source, /CompanyPublisherProvider/);
  }
});

test('inventory failure remains distinct from absent terms, retries, and shares one read between child cards', async () => {
  const original = researchCompanyPublishersApi.list;
  let calls = 0;
  researchCompanyPublishersApi.list = async () => { calls++; if (calls === 1) throw new Error('synthetic failed read'); return inventory; };
  const row = { source_name: publishers[0].source_name };
  let view;
  try {
    view = await mountContracts(React.createElement(CompanyPublisherProvider, null, React.createElement(React.Fragment, null, React.createElement(PublisherBoundary), React.createElement(SubjectCard, { read: { data: { item: row } } }))));
    assert.match(view.text(), /Publisher reference: Unavailable/);
    assert.match(view.text(), /licence terms not reviewed/);
    assert.equal(calls, 1);
    await view.click('Try again');
    assert.equal(calls, 2);
    assert.ok(view.text().includes(publishers[0].licence_name));
    assert.doesNotMatch(view.text(), /Publisher reference: Unavailable/);
  } finally { if (view) await view.unmount(); researchCompanyPublishersApi.list = original; }
});
