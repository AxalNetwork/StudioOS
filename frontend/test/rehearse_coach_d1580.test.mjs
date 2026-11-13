/**
 * D1580 part 2 (#3827) — Rehearse's coaching, and kept audio on the storage page.
 *
 *   1. The coaching's hold line, and its words.
 *   2. The report draws the coaching block between Figures and Likely questions (#3829's `LikelyQuestions`):
 *      the points when written, else the note, the hold and "Coach me", which
 *      calls the client; the rail option names that call.
 *   3. The client's coach paths are the Worker's; the storage page names the
 *      rehearsal area.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { COACHING, COACH_ME, coachHoldLine } from '../src/pages/raise/pitch/rehearseModel.js';
import { FOUNDER_OPTIONS } from '../src/lib/railOptions/founder.js';

const read = (p) => readFileSync(p, 'utf8');

test('1. the coaching hold line reads like the transcript\'s, and nothing before the quote', () => {
  assert.equal(COACHING, 'Coaching');
  assert.equal(COACH_ME, 'Coach me');
  assert.match(coachHoldLine({ hold_microusd: 4000 }), /^Coaching · Holds up to .+ · you pay what it uses$/);
  assert.equal(coachHoldLine(null), null);
});

test('2. the report draws the coaching block, and Coach me calls the client the rail option names', () => {
  // Mutation checked: the button not calling onCoach → the deckRehearsalsApi.coach( call site is gone from the panel.
  const src = read('frontend/src/pages/raise/pitch/RehearsePanel.jsx');
  const at = (s) => src.indexOf(s);
  assert.ok(at('data-testid="rehearse-figures"') < at('data-testid="rehearse-coaching"') && at('data-testid="rehearse-coaching"') < at('<LikelyQuestions'), 'between Figures and Likely questions (#3829)');
  assert.match(src, /deckRehearsalsApi\.coach\(deckId, report\.uid\)/);
  assert.match(src, /deckRehearsalsApi\.coachQuote\(deckId, report\.uid\)/);
  assert.match(src, /onClick=\{onCoach\}/);
  assert.match(src, /useRailOption\('rehearse:coach', COACH_ME\)/);
  const row = FOUNDER_OPTIONS.find((o) => o.key === 'rehearse:coach');
  assert.deepEqual(row.at, [['frontend/src/pages/raise/pitch/RehearsePanel.jsx', 'deckRehearsalsApi.coach(']]);
  assert.equal(row.kind, 'reason');
});

test('3. the client\'s coach paths are the Worker\'s; the storage page names kept rehearsal audio', () => {
  const client = read('frontend/src/lib/api/deckRehearsals.js');
  const worker = read('cloudflare-worker/src/routes/deck_rehearsals.ts');
  assert.ok(client.includes('/coach/quote`') && worker.includes("deckRehearsals.post('/:id{[0-9]+}/rehearsals/:uid/coach/quote'"));
  assert.ok(client.includes('/coach`') && worker.includes("deckRehearsals.post('/:id{[0-9]+}/rehearsals/:uid/coach'"));
  assert.match(read('frontend/src/pages/account/storagePageModel.js'), /deck_rehearsals: \['the rehearsal', '\/raise\/pitch\/present'\]/);
  assert.match(read('frontend/src/pages/account/usageModel.js'), /\['deck_rehearsals', 'Kept rehearsal audio'\]/);
});
