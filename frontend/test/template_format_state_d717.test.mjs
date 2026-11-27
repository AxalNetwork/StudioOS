import test from 'node:test';
import assert from 'node:assert/strict';
import { editorStoredFormat } from '../src/lib/templateFormatState.js';

const options = {
  derived: { kind: 'policy', party: 'none' },
  partyless_kinds: ['unilateral', 'corporate', 'policy'],
};

test('a stale party on a partyless kind returns to the slug without mutating the row', () => {
  const row = { doc_kind: 'policy', axal_party: 'management', kind: 'policy', format_options: options };
  assert.deepEqual(editorStoredFormat(row), { kind: 'policy', party: null });
  assert.deepEqual([row.doc_kind, row.axal_party], ['policy', 'management']);
});

test('a stale none party on a party-bearing kind returns to the slug', () => {
  const row = {
    doc_kind: 'agreement', axal_party: 'none', kind: 'agreement',
    format_options: { ...options, derived: { kind: 'agreement', party: 'management' } },
  };
  assert.deepEqual(editorStoredFormat(row), { kind: 'agreement', party: null });
});

test('valid explicit pairs and rows without options stay unchanged', () => {
  assert.deepEqual(editorStoredFormat({ doc_kind: 'policy', axal_party: 'none', format_options: options }),
    { kind: 'policy', party: 'none' });
  assert.deepEqual(editorStoredFormat({ doc_kind: 'agreement', axal_party: 'gp' }),
    { kind: 'agreement', party: 'gp' });
});
