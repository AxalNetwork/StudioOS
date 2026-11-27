/**
 * D494 (#1023, the Deals PR): every IC vote records its reason.
 *
 * The worker refuses a blank rationale (pinned in
 * cloudflare-worker/test/ic_conditions_minutes.test.ts). These pin what the two
 * screens say about it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { rationaleNote } from '../src/pages/investor/deals/CommitZone.jsx';

test('the Rationales tile says the rule is enforced, and explains a shortfall as older votes', () => {
  assert.equal(rationaleNote({ enforced: true, recorded: 3, total: 3 }), 'required for every vote');
  assert.equal(rationaleNote({ enforced: true, recorded: 2, total: 3 }),
    'required for every new vote — the votes without one were cast before the rule');
});

test('a server that reports the old rule is still read as the old rule, and a missing read is unreadable', () => {
  assert.equal(rationaleNote({ enforced: false, recorded: 1, total: 3 }), 'the column is nullable — a reason is recorded, not required');
  assert.equal(rationaleNote(null), 'unreadable');
  assert.equal(rationaleNote({ recorded: 1, total: 1 }), 'unreadable', 'no rule reported is not read as either rule');
});
