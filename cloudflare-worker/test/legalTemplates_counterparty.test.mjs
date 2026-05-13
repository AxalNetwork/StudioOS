// Task #1 (DB) — smoke test for the e-sign envelope merge-field
// resolver. Exercises the *production* `applyMergeFields` exported
// from cloudflare-worker/src/services/legalTemplates.ts so any
// regression in the dotted-path lookup, missing-token preservation,
// or the regex itself surfaces here before the next contract send
// leaks an empty AXF-id.
//
// We can't import `renderLegalTemplate` directly because it depends
// on Wrangler's `?raw` import suffix to load the markdown template
// bundle (node has no equivalent loader). So we drive a representative
// template fragment through `applyMergeFields`, which is the same
// function `renderLegalTemplate` calls internally — coverage of the
// merge layer is identical.

import { test } from 'node:test';
import assert from 'node:assert/strict';
// Import the pure resolver module directly (no template `?raw` deps)
// so the test runs under `node --test` without a Wrangler bundler.
import { applyMergeFields } from '../src/services/mergeFields.ts';

const TEMPLATE = `
COUNTERPARTY DESIGNATION

This Agreement is entered into between Axal Studio Inc. and the
counterparty identified below.

Counterparty Name: {{recipient_name}}
Counterparty Email: {{recipient_email}}
Founder ID:        {{counterparty.founder_id}}
Partner ID:        {{counterparty.partner_id}}
Effective Date:    {{effective_date}}
`.trim();

test('applyMergeFields resolves counterparty.founder_id (envelope path)', () => {
  const out = applyMergeFields(TEMPLATE, {
    recipient_name: 'Alice Founder',
    recipient_email: 'alice@example.com',
    effective_date: '2026-05-13',
    counterparty: { founder_id: 'AXF-000123', partner_id: null, user_id: 7 },
  });
  assert.match(out, /Founder ID:\s+AXF-000123/);
  assert.match(out, /Counterparty Name:\s+Alice Founder/);
  // Unset partner id is preserved verbatim, not silently emptied.
  assert.match(out, /Partner ID:\s+\{\{counterparty\.partner_id\}\}/);
});

test('applyMergeFields resolves counterparty.partner_id (envelope path)', () => {
  const out = applyMergeFields(TEMPLATE, {
    recipient_name: 'Bob Partner',
    recipient_email: 'bob@example.com',
    effective_date: '2026-05-13',
    counterparty: { founder_id: null, partner_id: 'AXP-0000A0', user_id: 9 },
  });
  assert.match(out, /Partner ID:\s+AXP-0000A0/);
  assert.match(out, /Founder ID:\s+\{\{counterparty\.founder_id\}\}/);
});

test('applyMergeFields preserves unresolved tokens as literal placeholders', () => {
  const out = applyMergeFields(TEMPLATE, {
    recipient_name: 'X',
    recipient_email: 'x@y.com',
    effective_date: '2026-05-13',
    // counterparty omitted entirely
  });
  assert.match(out, /Founder ID:\s+\{\{counterparty\.founder_id\}\}/);
  assert.match(out, /Partner ID:\s+\{\{counterparty\.partner_id\}\}/);
});

test('applyMergeFields supports flat top-level keys', () => {
  const out = applyMergeFields('Hello {{name}}!', { name: 'Alice' });
  assert.equal(out, 'Hello Alice!');
});

test('applyMergeFields handles whitespace inside the placeholder', () => {
  const out = applyMergeFields('ID={{  counterparty.founder_id  }}', {
    counterparty: { founder_id: 'AXF-000123' },
  });
  assert.equal(out, 'ID=AXF-000123');
});
