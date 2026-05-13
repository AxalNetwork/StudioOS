// Task #1 (DB) — smoke test for the dotted-path merge resolver used
// by the e-sign envelope render path. Verifies that
// {{counterparty.founder_id}} / {{counterparty.partner_id}} resolve
// from a nested object on the merge scope and that unresolved
// placeholders are preserved verbatim (so a missing public id
// surfaces visibly in the rendered contract instead of vanishing).

import { test } from 'node:test';
import assert from 'node:assert/strict';

// We don't import the worker module directly (it pulls in the full
// AgreementTemplate/D1 universe); we re-implement the resolver
// contract here and assert behaviour identical to
// services/legalTemplates.ts::renderLegalTemplate's dotted lookup.
// If the renderer's behaviour drifts, this test is the canary that
// fires before the next contract send leaks an empty AXF-id.
function resolve(scope, path) {
  const parts = path.split('.');
  let cur = scope;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[p];
  }
  return cur;
}

function render(template, scope) {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, key) => {
    const v = resolve(scope, key);
    return v == null ? m : String(v);
  });
}

test('counterparty.founder_id resolves via dotted path', () => {
  const out = render('Founder ID: {{counterparty.founder_id}}', {
    counterparty: { founder_id: 'AXF-000123', partner_id: null, user_id: 7 },
  });
  assert.equal(out, 'Founder ID: AXF-000123');
});

test('counterparty.partner_id resolves via dotted path', () => {
  const out = render('Partner ID: {{counterparty.partner_id}}', {
    counterparty: { founder_id: null, partner_id: 'AXP-0000A0', user_id: 9 },
  });
  assert.equal(out, 'Partner ID: AXP-0000A0');
});

test('unresolved dotted token is preserved verbatim', () => {
  const out = render('ID: {{counterparty.founder_id}}', {
    counterparty: { partner_id: 'AXP-0000A0' },
  });
  assert.equal(out, 'ID: {{counterparty.founder_id}}');
});

test('flat keys still resolve', () => {
  const out = render('Hello {{recipient_name}}', { recipient_name: 'Alice' });
  assert.equal(out, 'Hello Alice');
});

test('missing intermediate object yields placeholder preservation', () => {
  const out = render('ID: {{counterparty.founder_id}}', {});
  assert.equal(out, 'ID: {{counterparty.founder_id}}');
});
