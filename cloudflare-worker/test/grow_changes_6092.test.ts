import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { growChanges } from '../src/services/growChanges.ts';
import { d1Over } from './_d1_sqlite.mjs';

test('Grow changes scopes records, suppresses private descriptions, and merges recorded deltas', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE activity_logs(id INTEGER, project_id INTEGER, entity_type TEXT, details TEXT, created_at TEXT);
      CREATE TABLE portfolio_updates(id INTEGER, project_id INTEGER, sent_at TEXT);
      INSERT INTO activity_logs VALUES
        (1, 7, 'grow.product-improvement', 'Feedback from Private Person', '2026-11-11 08:00:00'),
        (2, 8, 'grow.distribution', 'Other project', '2026-11-12'),
        (3, 7, 'grow.distribution', 'Too old', '2026-10-01'),
        (4, 7, 'grow.distribution', 'Future', '2026-11-30');
      INSERT INTO portfolio_updates VALUES (1, 7, '2026-11-11T09:00:00Z'), (2, 7, NULL);`);
    const x = { env: { DB: d1Over(db) }, projectId: 7, now: Date.parse('2026-11-12'), href: (slug: string) => '/grow/' + slug } as Parameters<typeof growChanges>[0];
    const figures: Parameters<typeof growChanges>[1] = [{
      key: 'customers', label: 'Customers', value: 11, unit: 'count', state: 'ok', delta_30d: 1,
      source: 'manual', as_of: '2026-11-12', spark: [],
    }];
    const reader = await growChanges(x, figures, false);
    assert.equal(reader.state, 'ready');
    if (reader.state !== 'ready') return;
    assert.deepEqual(reader.items.map((i) => i.label), ['Customers', 'Update sent', 'Product improvement record changed']);
    const writer = await growChanges(x, figures, true);
    assert.equal(writer.state === 'ready' && writer.items.at(-1)?.label, 'Feedback from Private Person');
    assert.deepEqual(await growChanges({ ...x, projectId: 9 }, [], true), { state: 'ready', items: [] });
    db.exec('DROP TABLE activity_logs');
    assert.deepEqual(await growChanges(x, [], false), { state: 'unreadable' });
  } finally { db.close(); }
});
