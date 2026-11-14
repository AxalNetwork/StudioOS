// Task #3 — guard the template-driven content schema against drift.
//
// The worker's LANDING_CONTENT_SCHEMA / SHARED_LANDING_FIELDS and the frontend's
// TEMPLATE_CONTENT_SCHEMA / SHARED_CONTENT_FIELDS are hand-mirrored so the step-3
// editor + AI auto-fill offer exactly the fields the renderers read (and use the
// same defaults). This asserts they stay identical and well-formed.
//
// Runs under the strip-types loader so it can import BOTH the worker TS source and
// the frontend JS catalog. MUST stay in the test:drift file list in the root
// package.json or the gate silently skips it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LANDING_CONTENT_SCHEMA,
  SHARED_LANDING_FIELDS,
  TEMPLATE_KEYS,
} from '../src/services/landingTemplates.ts';
import {
  TEMPLATE_CONTENT_SCHEMA,
  SHARED_CONTENT_FIELDS,
  VISUAL_TEMPLATE_KEYS,
} from '../../frontend/src/lib/brand/templates.js';

test('shared landing fields stay in lockstep across worker + frontend', () => {
  assert.deepEqual(SHARED_LANDING_FIELDS, SHARED_CONTENT_FIELDS);
});

test('content schema has an entry for every template key', () => {
  const workerKeys = Object.keys(LANDING_CONTENT_SCHEMA).sort();
  assert.deepEqual(workerKeys, [...TEMPLATE_KEYS].sort(), 'worker schema covers every TEMPLATE_KEYS entry');
  const frontendKeys = Object.keys(TEMPLATE_CONTENT_SCHEMA).sort();
  assert.deepEqual(frontendKeys, [...VISUAL_TEMPLATE_KEYS].sort(), 'frontend schema covers every visual template');
});

test('content schema stays in lockstep across worker + frontend', () => {
  // Deep-equal the whole schema (keys, labels, kinds, itemFields, max, defaults)
  // so an editor placeholder can never drift from a renderer default.
  assert.deepEqual(TEMPLATE_CONTENT_SCHEMA, LANDING_CONTENT_SCHEMA);
});

const KINDS = new Set(['text', 'textarea', 'groupList']);
const ITEM_KINDS = new Set(['text', 'textarea']);

test('every content field is well-formed', () => {
  for (const [tkey, fields] of Object.entries(LANDING_CONTENT_SCHEMA)) {
    assert.ok(Array.isArray(fields), `${tkey} maps to an array`);
    const seen = new Set<string>();
    for (const f of fields as any[]) {
      assert.ok(f.key && typeof f.key === 'string', `${tkey} field has a string key`);
      assert.ok(!seen.has(f.key), `${tkey}.${f.key} key is unique`);
      seen.add(f.key);
      assert.ok(f.label && typeof f.label === 'string', `${tkey}.${f.key} has a label`);
      assert.ok(KINDS.has(f.kind), `${tkey}.${f.key} has a valid kind`);
      if (f.kind === 'groupList') {
        assert.ok(Array.isArray(f.itemFields) && f.itemFields.length, `${tkey}.${f.key} groupList has itemFields`);
        assert.ok(Array.isArray(f.default), `${tkey}.${f.key} groupList default is an array`);
        assert.ok(typeof f.max === 'number' && f.max > 0, `${tkey}.${f.key} groupList has a positive max`);
        for (const itf of f.itemFields as any[]) {
          assert.ok(itf.key && typeof itf.key === 'string', `${tkey}.${f.key} item has a key`);
          assert.ok(itf.label && typeof itf.label === 'string', `${tkey}.${f.key}.${itf.key} has a label`);
          assert.ok(ITEM_KINDS.has(itf.kind), `${tkey}.${f.key}.${itf.key} has a valid item kind`);
        }
        for (const d of f.default as any[]) {
          assert.ok(d && typeof d === 'object' && !Array.isArray(d), `${tkey}.${f.key} default item is an object`);
        }
      } else {
        assert.ok(typeof f.default === 'string', `${tkey}.${f.key} text default is a string`);
      }
    }
  }
});
