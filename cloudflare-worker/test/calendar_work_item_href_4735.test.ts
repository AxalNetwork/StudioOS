/**
 * #4735 — a Work item on the Calendar opens the item itself: the project's Work board with WorkPage's
 * `?item=` deep link. Without a project there is no address, and without a uid it is the board.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { hrefOf } from '../src/services/calendar/items.ts';

const base: any = { id: 'work_item:1', kind: 'work_item', source_id: 1, source_uid: 'item-a', title: 't', start_at: '2026-11-10T09:00:00Z', end_at: '2026-11-10T10:00:00Z', status: 'scheduled', location_kind: null, location_uri: null, organizer_email: null, attendees: [], notes: null };

test('#4735: a work_item links to its own deep link, the board without a uid, nothing without a project', () => {
  assert.equal(hrefOf({ ...base, project_id: 7 }), '/projects/7/work?item=item-a');
  assert.equal(hrefOf({ ...base, project_id: 7, source_uid: 'a b/c' }), '/projects/7/work?item=a%20b%2Fc', 'the uid is encoded');
  assert.equal(hrefOf({ ...base, project_id: 7, source_uid: '' }), '/projects/7/work');
  assert.equal(hrefOf({ ...base, project_id: null }), null);
});
