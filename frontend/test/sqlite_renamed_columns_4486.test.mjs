// D4486 (#4486) — the schema guard recognizes literal column renames without allowing dynamic names or invented columns.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renamedColumns, knownColumns } from '../../scripts/check-sqlite-columns.mjs';

test('literal and quoted column renames are harvested, not table renames, comments or dynamic SQL', () => {
  for (const sql of ['ALTER TABLE growth_channels RENAME COLUMN kind TO legacy_kind;',
    'ALTER TABLE "growth_channels" RENAME COLUMN "kind" TO "legacy_kind";',
    'ALTER TABLE [growth_channels] RENAME COLUMN [kind] TO [legacy_kind];']) {
    assert.deepEqual(renamedColumns(sql), [{ table: 'growth_channels', from: 'kind', to: 'legacy_kind' }]);
  }
  for (const sql of ['ALTER TABLE old RENAME TO new;', '-- ALTER TABLE t RENAME COLUMN a TO fake;',
    'ALTER TABLE ${table} RENAME COLUMN kind TO legacy_kind;', 'ALTER TABLE t RENAME COLUMN kind TO ${name};']) {
    assert.deepEqual(renamedColumns(sql), []);
  }
});

test('the migration records both channel kind columns and no credential or invented column', () => {
  const source = readFileSync(new URL('../../cloudflare-worker/sql/migrations/202611041912_growth_channel_details.sql', import.meta.url), 'utf8');
  assert.deepEqual(renamedColumns(source), [{ table: 'growth_channels', from: 'kind', to: 'legacy_kind' }]);
  const columns = knownColumns().get('growth_channels');
  for (const column of ['kind', 'legacy_kind', 'purpose', 'owner_user_id']) assert.ok(columns.has(column), column);
  for (const column of ['credentials', 'invented_4486']) assert.equal(columns.has(column), false, column);
});
