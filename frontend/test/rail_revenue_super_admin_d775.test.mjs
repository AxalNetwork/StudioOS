/**
 * D775 (#2101) PR 4 — the Super Admin's Revenue section (H12–H17) on the rail.
 *
 * D768's page map tells Revenue's modules apart by anchor on `/admin/revenue`
 * (H13 Overview is H12's page, D720 §11), and a dispute's own page
 * (`/admin/revenue/disputes/:id`) is a Disputes record. That page drew no
 * rail; it now draws HQ's, and the dispute it read is the rail's record
 * (`useRecordCrumb`, whose contract `rail_content_super_admin_d775.test.mjs`
 * renders). Revenue offers no option.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import { pageKeyFor } from '../src/lib/railPages.js';
import { SUPER_ADMIN_BOARDS, SUPER_ADMIN_RAIL_OPTIONS, boardPage } from '../src/lib/railOptions/superAdmin.js';

const read = (p) => codeOnly(readFileSync(resolve(process.cwd(), 'frontend/src', p), 'utf8'));
const keyOf = (route) => {
  const [path, hash = ''] = route.split('#');
  return pageKeyFor(path, 'super_admin', { hash: hash ? `#${hash}` : '' });
};

test('the Revenue section is H12–H17, and each board\'s route answers its own key', () => {
  const boards = SUPER_ADMIN_BOARDS.filter((b) => b.section === 'Revenue');
  assert.deepEqual(boards.map((b) => b.id), ['H12', 'H13', 'H14', 'H15', 'H16', 'H17']);
  for (const b of boards) {
    // H13 Overview has no page of its own: it is H12's (D720 §11).
    const want = b.id === 'H13' ? boardPage(boards[0]) : boardPage(b);
    assert.equal(keyOf(b.route), want, `${b.id} ${b.route}`);
  }
  assert.equal(pageKeyFor('/admin/revenue/disputes/dp_41', 'super_admin'), 'Super Admin · Revenue · Disputes');
  assert.deepEqual(SUPER_ADMIN_RAIL_OPTIONS.filter((o) => o.page.startsWith('Super Admin · Revenue')), []);
});

test('a dispute\'s own page draws HQ\'s rail in RailFrame, and names the dispute it read', () => {
  const code = read('pages/hq/DisputePage.jsx');
  const page = code.slice(code.indexOf('export default function DisputePage('), code.indexOf('function Fact('));
  assert.match(page, /<WorkerRail workspace="Disputes" role="super_admin"[^>]*data-testid="hq-dispute-rail" \/>/, 'the dispute page draws no HQ rail');
  assert.match(page, /<RailFrame rail=\{rail\}[^>]*><DisputeView /, 'the dispute page is not in RailFrame');
  assert.match(page, /useRecordCrumb\(state\.dispute \? `Dispute \$\{disputeId\}` : null, 'dispute', disputeId\);/,
    'the dispute page no longer names the dispute it read');
  // DisputeView, which the D634 tests render directly, stays rail-free.
  const view = code.slice(code.indexOf('export function DisputeView('));
  assert.doesNotMatch(view, /<WorkerRail|useRecordCrumb\(/, 'the view drew the rail itself');
});
