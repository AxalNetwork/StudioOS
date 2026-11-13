import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { d1Over } from './_d1_sqlite.mjs';
import { ledgerOwnerOf, canLink } from '../src/integrations/fedOwnership.ts';

test('one owner shared across providers; hand-entered and unlinked rows have no ledger owner', async () => {
  const db = new DatabaseSync(':memory:'); db.exec(readFileSync(new URL('../sql/migrations/445_connector_fed_items.sql', import.meta.url), 'utf8'));
  const env = { DB: d1Over(db) } as any;
  try {
    assert.equal(await ledgerOwnerOf(env, 'roadmap_okrs', 1), null);
    assert.equal(await canLink(env, 1, 'roadmap_okrs', 1), true);
    db.prepare('INSERT INTO connector_fed_items(integration_id,module,kind,external_id,local_table,local_id) VALUES (?,?,?,?,?,?)').run(7,'product_roadmap','issue','issue-1','roadmap_okrs',1);
    assert.equal(await ledgerOwnerOf(env, 'roadmap_okrs', 1), 7);
    assert.equal(await canLink(env, 7, 'roadmap_okrs', 1), true);
    assert.equal(await canLink(env, 8, 'roadmap_okrs', 1), false);
    assert.equal(await ledgerOwnerOf(env, 'mvp_features', 1), null);
    db.prepare('UPDATE connector_fed_items SET local_id = NULL').run();
    assert.equal(await ledgerOwnerOf(env, 'roadmap_okrs', 1), null);
    assert.equal(await canLink(env, 8, 'roadmap_okrs', 1), true);
    assert.equal(await canLink(env, 0, 'roadmap_okrs', 1), false);
    await assert.rejects(() => ledgerOwnerOf(env, 'users' as any, 1), /invalid_fed_target/);
    await assert.rejects(() => ledgerOwnerOf(env, 'roadmap_okrs', -1), /invalid_fed_target/);
    db.prepare('INSERT INTO connector_fed_items(integration_id,module,kind,external_id,local_table,local_id) VALUES (?,?,?,?,?,?)').run(7,'product_roadmap','issue','x','roadmap_okrs',2);
    db.prepare('INSERT INTO connector_fed_items(integration_id,module,kind,external_id,local_table,local_id) VALUES (?,?,?,?,?,?)').run(8,'product_roadmap','issue','y','roadmap_okrs',2);
    await assert.rejects(() => canLink(env, 7, 'roadmap_okrs', 2), /fed_ownership_conflict/);
  } finally { db.close(); }
});
