/**
 * D450 — HQ honesty sweep: failed reads, false sentences, escalation relation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeOnly } from './_codeOnly.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');

test('HQ Support names an escalation subject relation or says why it is missing', () => {
  const page = codeOnly(read('frontend/src/pages/hq/HqSupportPage.jsx'));
  const at = page.indexOf('item.subject_ref');
  assert.ok(at > 0);
  const block = page.slice(at, at + 600);
  assert.match(block, /item\.relation/, 'relation from hq_escalations must reach the panel');
});

test('admin licences list reason no longer claims no account carries a licence', () => {
  const route = read('cloudflare-worker/src/routes/admin_licences.ts');
  assert.doesNotMatch(route, /No account carries one/);
  assert.match(route, /U1/);
});

test('ROUTE_MAP no longer claims ticket_sync_events is absent', () => {
  const map = read('documentation/architecture/ROUTE_MAP.md');
  assert.doesNotMatch(map, /there is no `ticket_sync_events` table/);
  assert.match(map, /readTicketSync/);
});
