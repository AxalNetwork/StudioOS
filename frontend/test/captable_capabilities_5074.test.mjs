/**
 * D5074 slice 2 (#5074) — the cap table draws its record controls from the record read's capability map, never
 * from the account's role, its plan or the grants read. The mounted suites (D1022, D1025, D1028) serve the map the
 * Worker sends each viewer (`_cap_table_capabilities.mjs`, pinned to the Worker by cap_table_capabilities_5074);
 * this file pins the rule and that no local inference is left.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/captable_capabilities_5074.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { recordStanding, tabSearch } from '../src/pages/raise/captable/capTableModel.js';
import { capTableCapabilities } from './_cap_table_capabilities.mjs';

const read = (p) => readFileSync(new URL(`../src/pages/raise/captable/${p}`, import.meta.url), 'utf8');
const ready = (capabilities) => ({ status: 'ready', data: { capabilities } });

test('each role reads as its map says', () => {
  const owner = recordStanding(ready(capTableCapabilities({ writable: true, owner: true })));
  assert.deepEqual([owner.role, owner.plan, owner.admin, owner.writes], ['owner', true, false, true]);
  const cofounder = recordStanding(ready(capTableCapabilities({ writable: true })));
  assert.deepEqual([cofounder.role, cofounder.writes, cofounder.can('record')], ['cofounder', true, false]);
  const advisor = recordStanding(ready(capTableCapabilities({ writable: false })));
  assert.deepEqual([advisor.role, advisor.writes, advisor.can('export')], ['reader', false, true]);
  const admin = recordStanding(ready(capTableCapabilities({ admin: true })));
  assert.deepEqual([admin.role, admin.admin, admin.writes, admin.can('correct')], ['reader', true, true, true]);
  const superAdmin = recordStanding(ready(capTableCapabilities({ admin: true, superAdmin: true })));
  assert.deepEqual([superAdmin.role, superAdmin.admin, superAdmin.writes], ['reader', false, false]);
});

test('without the plan a write is never drawn, but the role is still known, so the plan gate can say so', () => {
  const s = recordStanding(ready(capTableCapabilities({ writable: true, owner: true, plan: false })));
  assert.deepEqual([s.role, s.plan, s.writes], ['owner', false, false]);
});

test('no map, a refused read, or a non-true value allows nothing', () => {
  for (const r of [{ status: 'loading' }, { status: 'refused' }, { status: 'ready', data: {} }, { status: 'ready', data: { capabilities: null } }, null]) {
    const s = recordStanding(r);
    assert.deepEqual([s.known, s.role, s.writes, s.admin, s.plan], [false, 'reader', false, false, false], JSON.stringify(r));
  }
  const s = recordStanding(ready({ record: 'yes', propose: 1, plan: 'true' }));
  assert.deepEqual([s.role, s.writes], ['reader', false]);
});

test('no record control is decided from the account, the plan helper or the grants read', () => {
  const overview = read('CapTableOverview.jsx');
  const tool = read('CapTableTool.jsx');
  assert.ok(!overview.includes('grants.data?.can_change'), 'Overview no longer reads its role from the grants read');
  assert.ok(!overview.includes('hasTier('), 'nor its plan from the account');
  assert.ok(!tool.includes('grants.data?.can_change') && !tool.includes("user?.role"), 'History reads neither');
  assert.match(overview, /const standing = recordStanding\(record\);/);
  assert.match(tool, /const standing = recordStanding\(record\);/);
  // The one account read left is the refused read's support door, which only opens the Worker-gated support read.
  assert.equal((overview.match(/user\?\.role/g) || []).length, 2, 'the Explorer gate and the support door, nothing else');
});

test('a tab link carries the venture in the one form, whatever alias came in', () => {
  assert.equal(tabSearch('?project=3&tab=x'), '?project_id=3');
  assert.equal(tabSearch('?project_id=4'), '?project_id=4');
  assert.equal(tabSearch('?project=p-uid-1'), '', 'a UID is the route helper\'s to resolve, never a tab\'s');
  assert.equal(tabSearch(''), '');
});
