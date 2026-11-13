/**
 * D470 — the gap map's leftovers, up to the owner's line.
 *
 * The lane board is the second view, chosen by age. Assignment is a side
 * record. A reply thread, a help desk and a security-alert placement stay
 * named decisions. None of those three is drawn.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { hurtingLanes } from '../src/lib/approvalBoard.js';
import { LaneColumns } from '../src/pages/branch/BranchApprovals.jsx';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const PAGE = read('frontend/src/pages/branch/BranchApprovals.jsx');
const HOME = read('frontend/src/pages/branch/BranchHome.jsx');
const ACCOUNTS = read('frontend/src/pages/branch/BranchAccounts.jsx');
const HOME_ROUTE = read('cloudflare-worker/src/routes/branch_home.ts');
const BOARD_ROUTE = read('cloudflare-worker/src/routes/branch_approvals.ts');
const ASSIGN_ROUTE = read('cloudflare-worker/src/routes/branch_approval_assignments.ts');
const SERVICE = read('cloudflare-worker/src/services/approvalAssignments.ts');

test('five columns follow the oldest age, not the count, and skip an unreadable lane', () => {
  const lanes = [
    { key: 'a', label: 'A', count: 10 },
    { key: 'b', label: 'B', count: 1 },
    { key: 'c', label: 'C', count: 0 },
    { key: 'd', label: 'D', count: 2 },
    { key: 'e', label: 'E', count: null },
    { key: 'f', label: 'F', count: 1 },
  ];
  const items = [
    ...Array.from({ length: 10 }, (_, i) => ({ lane: 'a', id: i, age_hours: 1 })),
    { lane: 'b', id: 1, age_hours: 100 },
    { lane: 'd', id: 1, age_hours: null },
    { lane: 'd', id: 2, age_hours: null },
    { lane: 'f', id: 1, age_hours: 0 },
    { lane: 'e', id: 9, age_hours: 999 },
  ];
  const cols = hurtingLanes(items, lanes);
  assert.deepEqual(cols.map((c) => c.key), ['b', 'a', 'f', 'd', 'c']);
  assert.equal(cols.some((c) => c.key === 'e'), false);
});

test('an unknown age sorts after a measured zero, and never as zero hours', () => {
  const cols = hurtingLanes(
    [
      { lane: 'jobs', id: 1, age_hours: 2 },
      { lane: 'jobs', id: 2, age_hours: null },
      { lane: 'jobs', id: 3, age_hours: 9 },
    ],
    [{ key: 'jobs', label: 'Jobs', count: 3 }],
  );
  assert.deepEqual(cols[0].items.map((it) => it.id), [3, 1, 2]);
  const ranked = hurtingLanes(
    [
      { lane: 'known', id: 1, age_hours: 0 },
      { lane: 'blank', id: 1, age_hours: null },
    ],
    [
      { key: 'blank', label: 'Blank', count: 1 },
      { key: 'known', label: 'Known', count: 1 },
    ],
  );
  assert.deepEqual(ranked.map((c) => c.key), ['known', 'blank']);
});

test('a column says age unknown, and an empty column says Clear', () => {
  const html = renderToStaticMarkup(createElement(LaneColumns, {
    columns: [
      {
        key: 'jobs',
        label: 'Jobs',
        items: [
          { lane: 'jobs', id: 1, who: 'Ada', what: 'Job · A', age_hours: null, sla: 'past' },
          { lane: 'jobs', id: 2, who: 'Bea', what: 'Job · B', age_hours: 3.2, sla: 'ok' },
        ],
      },
      { key: 'events', label: 'Events', items: [] },
    ],
  }));
  assert.match(html, /data-testid="branch-lane-board"/);
  assert.match(html, /data-testid="branch-lane-column-jobs"/);
  assert.match(html, /age unknown/);
  assert.match(html, /3h/);
  assert.match(html, /Clear/);
  assert.equal(html.includes('0h'), false);
});

test('the page builds the second view and names the decisions it does not take', () => {
  assert.match(PAGE, /hurtingLanes\(/);
  assert.match(PAGE, /has not signed off/);
  assert.match(PAGE, /Assignment and history/);
  assert.doesNotMatch(PAGE, /need a store that does not exist/);
  assert.match(PAGE, /branch-board-outbound-note/);
  assert.doesNotMatch(BOARD_ROUTE, /r\.(post|patch|put|delete)\(/);
  assert.match(ASSIGN_ROUTE, /r\.post\('\/approvals\/assignments'/);
  assert.match(ASSIGN_ROUTE, /await requireBranchNotSuspended\(c\)/);
  assert.doesNotMatch(SERVICE, /CREATE TABLE/i);
  assert.match(HOME_ROUTE, /A help desk/);
  assert.match(HOME_ROUTE, /Security alerts/);
  assert.match(HOME_ROUTE, /has not decided whether this territory has a help desk/);
  assert.match(ACCOUNTS, /Security alerts on a row/);
  assert.match(HOME, /home\.unavailable \|\| \[\]/);
  assert.doesNotMatch(HOME, /New ticket/);
});
