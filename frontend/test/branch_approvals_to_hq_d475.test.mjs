/**
 * D475 — the To-HQ list shows due_at beside the band, hq_uid, and kind chips
 * with counts. A regex over the source is not the test.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  ToHqRaisedList,
  DUE_UNRECORDED,
} from '../src/pages/branch/BranchApprovals.jsx';

const ROWS = [
  {
    id: 1,
    kind: 'moderation',
    subject: 'Job post',
    created_at: '2026-09-12T09:05:00Z',
    raised_by_name: 'C. Moreau',
    sla: 'due_soon',
    due_at: '2026-09-14T09:05:00Z',
    hq_uid: 'ESC-FR-0142',
    status: 'answered',
    detail: 'The post promises a return.',
    answer: 'Take it down.',
    answered_by_name: 'HQ',
    answered_at: '2026-09-13T10:00:00Z',
  },
  {
    id: 2,
    kind: 'seat_increase',
    subject: 'Founder seats +40',
    created_at: '2026-09-14T11:20:00Z',
    sla: 'ok',
    due_at: null,
    hq_uid: null,
    status: 'open',
    detail: '',
  },
  {
    id: 3,
    kind: 'content',
    subject: 'Onboarding guide',
    created_at: '2026-09-13T17:20:00Z',
    sla: 'past',
    due_at: '2026-09-18T17:20:00Z',
    hq_uid: 'ESC-FR-0144',
    status: 'open',
  },
];

const html = (props) => renderToStaticMarkup(createElement(ToHqRaisedList, props));

test('a row shows its due time beside the band and HQ\'s reference', () => {
  const out = html({ items: ROWS, kind: 'all' });
  assert.match(out, /due within 24h/);
  assert.match(out, /due 2026-09-14T09:05:00Z/);
  assert.match(out, /ESC-FR-0142/);
  assert.match(out, /past SLA/);
  assert.match(out, /due 2026-09-18T17:20:00Z/);
  assert.match(out, /Take it down/);
  assert.doesNotMatch(out, /reply/i);
});

test('a missing due time and a missing HQ reference are Not recorded, not a stand-in', () => {
  const out = html({ items: [ROWS[1]], kind: 'all' });
  assert.ok(out.includes(DUE_UNRECORDED));
  assert.match(out, /HQ has not given this raise a reference/);
  assert.match(out, /Founder seats \+40/);
  assert.doesNotMatch(out, /due 0/);
  assert.doesNotMatch(out, />2</);
});

test('kind chips carry counts and aria-pressed, and a kind shows only its rows', () => {
  const all = html({ items: ROWS, kind: 'all' });
  assert.match(all, /aria-pressed="true"[^>]*>All/);
  assert.match(all, /All <span class="font-mono">3<\/span>/);
  assert.match(all, /Moderation <span class="font-mono">1<\/span>/);
  assert.match(all, /Seat increase <span class="font-mono">1<\/span>/);
  assert.match(all, /Other <span class="font-mono">0<\/span>/);
  assert.match(all, /aria-pressed="false"[^>]*>Other/);
  assert.match(all, /Job post/);
  assert.match(all, /Founder seats/);
  assert.match(all, /Onboarding guide/);

  const only = html({ items: ROWS, kind: 'moderation' });
  assert.match(only, /aria-pressed="true"[^>]*>Moderation/);
  assert.match(only, /aria-pressed="false"[^>]*>All/);
  assert.match(only, /Job post/);
  assert.doesNotMatch(only, /Founder seats/);
  assert.doesNotMatch(only, /Onboarding guide/);
  assert.match(only, /ESC-FR-0142/);
});

test('a kind with no rows does not claim the lane is empty', () => {
  const out = html({ items: ROWS, kind: 'other' });
  assert.match(out, /None of this kind on this list/);
  assert.match(out, /aria-pressed="true"[^>]*>Other/);
  assert.doesNotMatch(out, /Nothing has been raised/);
  assert.doesNotMatch(out, /Job post/);
});
