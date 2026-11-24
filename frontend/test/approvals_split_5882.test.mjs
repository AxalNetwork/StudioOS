/**
 * #5882 (D5882) — Admin Approvals audit 8/8 (a): `AdminApprovals.jsx` split into Inbox, Lanes,
 * Decided, assignment, doors and shared parts, with no behaviour change.
 *
 * The behaviour is held by the Approvals suites as they were (`admin_approvals_d1038`,
 * `admin_approvals_v2_4814*`, `admin_approvals_weekly_5301`, `approvals_gaps_clients_d1132`). This file
 * holds the split itself: no file in the folder runs past 500 lines, the boards still import what they
 * did from `AdminApprovals.jsx`, each moved file says what it is, and the README names each one.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/approvals_split_5882.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import * as page from '../src/pages/admin/approvals/AdminApprovals.jsx';
import * as ui from '../src/pages/admin/approvals/approvalsUi.jsx';
import * as doors from '../src/pages/admin/approvals/approvalDoors.jsx';
import * as assign from '../src/pages/admin/approvals/ApprovalsAssign.jsx';
import { APPROVALS_PAGE_FILES, approvalsPageSource } from './_approvalsPage.mjs';

const DIR = 'frontend/src/pages/admin/approvals';
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const MOVED = APPROVALS_PAGE_FILES.filter((f) => !f.endsWith('/AdminApprovals.jsx'));

/** The two pure-function models this task leaves as they are (D5882 says why). */
const LONG_MODELS = ['approvalsModel.js', 'inboxModel.js'];

test('no component file in the folder runs past 500 lines; the two long models are named', () => {
  for (const f of readdirSync(new URL(`../../${DIR}`, import.meta.url))) {
    if (!/\.jsx?$/.test(f) || LONG_MODELS.includes(f)) continue;
    const lines = read(`${DIR}/${f}`).split('\n').length;
    assert.ok(lines <= 500, `${f}: ${lines} lines`);
  }
  const d = read('documentation/architecture/decisions/D5882.md');
  for (const f of LONG_MODELS) assert.ok(d.includes(`\`${f}\``), `D5882 does not say why ${f} is long`);
  assert.ok(read(`${DIR}/AdminApprovals.jsx`).split('\n').length < 300, 'the page is the view picker, not the views');
});

test('the boards still import what they did from AdminApprovals.jsx, and it is the same component', () => {
  assert.equal(typeof page.default, 'function');
  assert.equal(typeof page.ApprovalsPage, 'function');
  assert.equal(page.BandPill, ui.BandPill);
  assert.equal(page.UrgencyPill, ui.UrgencyPill);
  assert.equal(page.LaneDoor, doors.LaneDoor);
  assert.equal(page.HqDoor, doors.HqDoor);
  assert.equal(page.AssignDialog, assign.AssignDialog);
  assert.equal(page.OwnerCell, assign.OwnerCell);
  for (const board of ['TesterBoard', 'PitchBoard', 'ExpertBoard', 'BestFitBoard']) {
    assert.match(read(`${DIR}/${board}.jsx`), /from '\.\/AdminApprovals';/, board);
  }
});

test('the page draws each view from its own file', () => {
  const src = read(`${DIR}/AdminApprovals.jsx`);
  for (const [name, file] of [['Inbox', 'ApprovalsInbox'], ['Lanes', 'ApprovalsLanes'], ['Decided', 'ApprovalsDecided'], ['AssignDialog, ItemDrawer', 'ApprovalsAssign'], ['useRead', 'approvalsUi']]) {
    assert.ok(src.includes(`import { ${name} } from './${file}';`), `${name} from ${file}`);
  }
  for (const fn of ['function Inbox(', 'function Lanes(', 'function Decided(', 'function ItemDrawer(', 'function LaneDoor(']) {
    assert.ok(!src.includes(fn), `${fn} stays in its own file`);
  }
  // The page keeps the comment that says why every door is literal; the doors file says it too.
  assert.match(src, /EVERY DOOR IS A LITERAL LINK/);
  assert.match(read(`${DIR}/approvalDoors.jsx`), /literal link/);
});

test('each moved file opens with what it is, and the README names it', () => {
  const readme = read(`${DIR}/README.md`);
  for (const f of MOVED) {
    assert.ok(existsSync(new URL(`../../${f}`, import.meta.url)), f);
    assert.match(read(f), /^\/\*\*\n \* D5882 \(#5882\): /, `${f} has no header`);
    const name = f.split('/').pop();
    assert.ok(readme.includes(`| \`${name}\` |`), `README does not name ${name}`);
  }
  // The page's source, read whole, still carries every door and the item link.
  const all = approvalsPageSource();
  assert.ok(all.includes('<Link to={`/admin/approvals/items/${r.lane}-${r.id}${loc.search}`}'));
  assert.match(all, /export function LaneDoor\(/);
});

test('the decision file names the files and how the move was checked', () => {
  const d = read('documentation/architecture/decisions/D5882.md');
  assert.match(d, /^## D5882 — .*\(#5882\)$/m);
  for (const f of MOVED) assert.ok(d.includes(f.split('/').pop()), f);
  assert.match(d, /moves only/i);
});
