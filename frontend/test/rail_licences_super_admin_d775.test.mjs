/**
 * D775 (#2101) PR 3 — the Super Admin's Licences section (H1) on the rail.
 *
 * H1 is one board with no modules and no option. D768's shell provider gives
 * its rail the page key from the route; this PR adds the record: the licence
 * open in the detail pane is the rail's last crumb and the run's record, by
 * `useRecordCrumb` (whose contract `rail_content_super_admin_d775.test.mjs`
 * renders). A licence ledger that could not be read opens no record.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import { pageKeyFor } from '../src/lib/railPages.js';
import { SUPER_ADMIN_BOARDS, SUPER_ADMIN_RAIL_OPTIONS, boardPage } from '../src/lib/railOptions/superAdmin.js';

const read = (p) => codeOnly(readFileSync(resolve(process.cwd(), 'frontend/src', p), 'utf8'));

test('H1 Licences is one board on its own route, with no option', () => {
  const boards = SUPER_ADMIN_BOARDS.filter((b) => b.section === 'Licences');
  assert.deepEqual(boards.map((b) => b.id), ['H1']);
  assert.equal(pageKeyFor(boards[0].route, 'super_admin'), boardPage(boards[0]));
  assert.equal(pageKeyFor('/admin/licences', 'admin'), null, 'Licences is the Super Admin\'s');
  assert.deepEqual(SUPER_ADMIN_RAIL_OPTIONS.filter((o) => o.page.startsWith('Super Admin · Licences')), []);
});

test('the licence open in the detail pane is the rail\'s record, by brand name or reference', () => {
  const code = read('pages/admin/AdminLicences.jsx');
  assert.match(code, /const open = Array\.isArray\(data\?\.items\) \? data\.items\.find\(\(l\) => l\.uid === sel\) : null;/,
    'the record is no longer the licence the pane has open');
  assert.match(code, /useRecordCrumb\(open \? \(open\.brand_name \|\| open\.licence_ref\) : null, 'licence', open\?\.uid\);/,
    'AdminLicences no longer names its open licence');
  // Called before the loading and unreadable returns, so the hook order never changes.
  const body = code.slice(code.indexOf('export default function AdminLicences('));
  const at = body.indexOf('useRecordCrumb(');
  assert.ok(at > 0 && at < body.indexOf('if (!data) return'), 'the record crumb is called after an early return');
});
