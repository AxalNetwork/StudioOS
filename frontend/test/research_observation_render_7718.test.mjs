// Geography observation readings and Worker CSV parity (D7718).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EXPORT_COLUMNS, provenanceOf } from '../../cloudflare-worker/src/services/researchObservations.ts';
import ObservationInspector from '../src/pages/research/observations/ObservationInspector.jsx';
import { countryFigures, externalLink, fieldGroups, reading } from '../src/pages/research/observations/observationRead.js';

test('the inspector displays every field exported by the Worker', () => {
  assert.deepEqual(Object.values(fieldGroups).flatMap(Object.keys).sort(), [...EXPORT_COLUMNS].sort());
  const row = Object.fromEntries(EXPORT_COLUMNS.map(key => [key, 'sample_' + key]));
  row.observation_status = 'unspecified';
  const html = renderToStaticMarkup(createElement(ObservationInspector, { observation: provenanceOf(row) }));
  for (const key of EXPORT_COLUMNS) assert.ok(html.includes(reading(key, row[key])), key);
});

test('readings distinguish missing, zero, source status and usable external links', () => {
  assert.equal(reading('value', null), null);
  assert.equal(reading('value', 0), '0');
  assert.equal(reading('published_at', null), null);
  assert.equal(reading('observation_status', 'unspecified'), 'Unspecified');
  assert.match(reading('observation_status', 'axal_derived'), /computed by Axal/);
  for (const unsafe of ['javascript:void(0)', '/relative', 'data:text/html,test']) assert.equal(externalLink(unsafe), null);
  assert.equal(externalLink('https://example.org/source'), 'https://example.org/source');
});

test('two-letter query keeps newest period per series and passes through coverage', async () => {
  const metric = {metric_key: 'population', source_id: 'world_bank', definition: 'Resident population'};
  const row = {source_id: metric.source_id, period: '2023', value: 0};
  for (const state of ['stale', 'source_failing', 'no_observation', 'not_covered']) {
    const hasValue = state === 'stale' || state === 'source_failing';
    const rows = await countryFigures({
      metrics: async () => ({items: [metric]}),
      list: async ({geography, metric: key, offset}) => {
        assert.equal(geography, 'DE');
        assert.equal(key, 'population');
        return {coverage: {state, latest: hasValue ? row : null}, total: hasValue ? 2 : 0,
          items: hasValue ? [{...row, period: offset ? '2024' : '2023'}] : []};
      },
    }, 'DE');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].state, state);
    assert.equal(rows[0].observation?.period, hasValue ? '2024' : undefined);
  }
  await assert.rejects(countryFigures({ metrics: async () => { throw new Error('offline'); } }, 'DE'), /offline/);
});
