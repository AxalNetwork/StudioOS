/**
 * D775 (#2101) PR 5 — the Super Admin's Contracts section (H3–H9) on the rail.
 *
 * The section is one page, the Contracts desk, whose tabs D768's page map
 * tells apart by `?tab=`. Its rail is the desk's, in the viewer's tier (PR 1).
 * This PR adds the records: the agreement open in the side panel (H4, also
 * opened from the NDA and partner-deal lists) and the stored template open in
 * the editor (H7) are the rail's last crumb and the run's record, through
 * `useRecordCrumb` (whose contract `rail_content_super_admin_d775.test.mjs`
 * renders). A new template has no record until it is saved. Document types
 * (H9) draws cards and a form for a new type, so it names no record. Contracts
 * offers no option that runs a model.
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
  const [path, search = ''] = route.split('?');
  return pageKeyFor(path, 'super_admin', { search: search ? `?${search}` : '' });
};

test('the Contracts section is H3–H9, and each board\'s route answers its own key', () => {
  const boards = SUPER_ADMIN_BOARDS.filter((b) => b.section === 'Contracts');
  assert.deepEqual(boards.map((b) => b.id), ['H3', 'H4', 'H5', 'H6', 'H7', 'H8', 'H9']);
  for (const b of boards) assert.equal(keyOf(b.route), boardPage(b), `${b.id} ${b.route}`);
  assert.deepEqual(SUPER_ADMIN_RAIL_OPTIONS.filter((o) => o.page.startsWith('Super Admin · Contracts')), []);
});

test('the open agreement is the rail\'s record once it is read', () => {
  const code = read('pages/admin/contracts/AgreementDetail.jsx');
  const view = code.slice(code.indexOf('export default function AgreementDetail('));
  assert.match(view, /const row = detail\.data;\s*useRecordCrumb\(row\?\.title \|\| null, 'agreement', uid\);/,
    'AgreementDetail no longer names the agreement it read');
});

test('a stored template is the rail\'s record; a new one is not, until it is saved', () => {
  const code = read('pages/admin/contracts/TemplateEditor.jsx');
  const editor = code.slice(code.indexOf('export default function TemplateEditor('));
  assert.match(editor, /useRecordCrumb\(saved \? \(saved\.title \|\| slug\) : null, 'template', saved \? slug : null\);/,
    'TemplateEditor no longer names the template it loaded');
  // Called before the editor's only return, so the hook order never changes.
  const at = editor.indexOf('useRecordCrumb(');
  assert.ok(at > 0 && at < editor.indexOf('\n  return ('), 'the record crumb is called after the return');
});
