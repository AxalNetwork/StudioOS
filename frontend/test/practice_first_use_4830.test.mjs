/**
 * #4830 (D4830) — Practice first-use (board PX-01) and the Opportunities inbox (PX-02, PX-02b).
 *
 *   · each setup step is a recorded fact; a failed read is neither done nor counted;
 *   · the primary action advances the next missing step;
 *   · the setup state takes the board's place only while a step is KNOWN to be missing;
 *   · a request card says how long it has waited, in words, and its session length;
 *   · an empty log reads "No requests yet" with Create booking link and, when the uid is known, Preview profile.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/practice_first_use_4830.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { h, mountForm, mutationCheck } from './_form_d695.mjs';
import { SETUP_STEPS, UNREADABLE, setupProgress, stepState } from '../src/pages/advisor/practice/practiceSetup.js';
import { PracticeSetupCard } from '../src/pages/advisor/practice/PracticeSetup.jsx';
import { requestMinutes, waitingFor } from '../src/pages/advisor/practice/opportunityCard.js';

const NOW = Date.parse('2026-11-14T12:00:00Z');
const later = (h) => new Date(NOW + h * 3_600_000).toISOString();
const routed = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const READY = {
  profile: { display_name: 'Synthetic Advisor', uid: 'adv-1' },
  session_type: { items: [{ id: 1, is_active: true }] },
  availability: { items: [{ starts_at: later(24), available: 1, blocked_reason: null }] },
  booking_link: { items: [{ id: 1, is_active: true }] },
  payout: { started: true, payouts_enabled: true },
};

// Mutation checked: a blocked or full slot counted as availability (fails); a past slot counted (fails); a paused
// booking link counted (fails); a started-but-not-enabled payout account counted as done (fails).
test('#4830 each setup step is a recorded fact, never a guess', () => {
  assert.deepEqual(SETUP_STEPS.map((s) => s.label), ['Practice profile', 'Create a service or session type', 'Set availability', 'Create a booking link', 'Set payout details']);
  for (const [k, v] of Object.entries(READY)) assert.equal(stepState(k, v, NOW), 'done', k);
  assert.equal(stepState('profile', null, NOW), 'todo', 'no profile (404) is a step to do');
  assert.equal(stepState('availability', { items: [{ starts_at: later(24), available: 1, blocked_reason: 'Holiday' }] }, NOW), 'todo');
  assert.equal(stepState('availability', { items: [{ starts_at: later(24), available: 0, blocked_reason: null }] }, NOW), 'todo');
  assert.equal(stepState('availability', { items: [{ starts_at: later(-2), available: 1, blocked_reason: null }] }, NOW), 'todo');
  assert.equal(stepState('booking_link', { items: [{ id: 1, is_active: false }] }, NOW), 'todo');
  assert.equal(stepState('payout', { started: true, payouts_enabled: false }, NOW), 'todo');
  for (const k of Object.keys(READY)) assert.equal(stepState(k, UNREADABLE, NOW), 'unreadable', k);
});

// Mutation checked: an unreadable step counted as done (the count fails); `takeOver` true with nothing known missing
// (fails); the next step skipping the first missing one (fails).
test('#4830 the progress counts what is done, advances the first missing step, and takes over only when one is known missing', () => {
  const p = setupProgress({ ...READY, availability: { items: [] }, booking_link: { items: [] }, payout: { payouts_enabled: false } }, NOW);
  assert.deepEqual([p.done, p.total, p.next.key, p.takeOver], [2, 5, 'availability', true]);
  const mixed = setupProgress({ ...READY, session_type: UNREADABLE, booking_link: { items: [] } }, NOW);
  assert.deepEqual([mixed.done, mixed.next.key, mixed.unreadable], [3, 'booking_link', ['session_type']]);
  assert.equal(setupProgress(READY, NOW).takeOver, false, 'a finished setup shows the board');
  const failed = setupProgress(Object.fromEntries(Object.keys(READY).map((k) => [k, UNREADABLE])), NOW);
  assert.deepEqual([failed.done, failed.takeOver], [0, false], 'reads that all failed keep the board, which says what failed');
});

test('#4830 the setup card: n of 5, the next step as the one primary action, and an unreadable step said as such', () => {
  const p = setupProgress({ ...READY, session_type: UNREADABLE, availability: { items: [] }, payout: { payouts_enabled: false } }, NOW);
  const html = routed(h(PracticeSetupCard, { progress: p, onRetry() {} }));
  const t = text(html);
  assert.match(t, /Set up your practice Get ready to accept your first client\. 2 of 5 complete/);
  assert.match(t, /Create a service or session type Could not be read · Try again/);
  assert.match(t, /Set availability Set availability/, 'the next missing step is the primary action');
  assert.match(t, /Set payout details Next/);
  assert.match(t, /What happens next 1 Share your profile or booking link\. 2 A client requests a session\./);
  assert.equal((html.match(/data-testid="practice-setup-next"/g) || []).length, 1, 'one primary action');
  assert.ok(html.includes('href="/practice/sessions#publish-availability"'));
});

// The board renders the lead with its sections as the fallback.
test('#4830 the Practice board leads with the setup state; BucketBoard hands the lead its sections', () => {
  const board = readFileSync(new URL('../src/workspaces/boards/advisorPractice.js', import.meta.url), 'utf8');
  assert.match(board, /lead: PracticeSetup,/);
  const bb = readFileSync(new URL('../src/workspaces/BucketBoard.jsx', import.meta.url), 'utf8');
  assert.match(bb, /\{Lead \? <Lead fallback=\{grid\} \/> : grid\}/);
});

// ── The lead, mounted: takes over, or shows the board ───────────────────

const LEAD = 'pages/advisor/practice/PracticeSetup.jsx';
const leadSrc = readFileSync(new URL(`../src/${LEAD}`, import.meta.url), 'utf8');
const leadStub = leadSrc.replace(/^import \{ api \} from '..\/..\/..\/lib\/api';\n/m,
  'export const control = { reads: {} };\n'
  + 'const answer = (k) => (control.reads[k] instanceof Error ? Promise.reject(control.reads[k]) : Promise.resolve(control.reads[k]));\n'
  + 'const api = { getMyAdvisor: () => answer("profile"), listMyAdvisorSessionTypes: () => answer("session_type"), listMyAdvisorSlots: () => answer("availability"), listMyAdvisorBookingLinks: () => answer("booking_link"), getMyAdvisorPayoutAccount: () => answer("payout") };\n');
assert.notEqual(leadStub, leadSrc);

async function takeover(module) {
  const fallback = h('p', null, 'THE BOARD');
  const notFound = Object.assign(new Error('no profile'), { status: 404 });
  // Only the profile is missing (a 404), so the takeover rests on reading that 404 as "not done".
  module.control.reads = { ...READY, profile: notFound, availability: { items: [{ starts_at: '2099-01-01T00:00:00Z', available: 1 }] } };
  let f = await mountForm(h(module.default, { fallback }));
  try { await f.flush(); assert.ok(f.text().includes('Set up your practice'), 'a missing step takes over'); assert.ok(!f.text().includes('THE BOARD')); } finally { await f.unmount(); }
  module.control.reads = { ...READY, availability: { items: [{ starts_at: '2099-01-01T00:00:00Z', available: 1 }] } };
  f = await mountForm(h(module.default, { fallback }));
  try { await f.flush(); assert.ok(f.text().includes('THE BOARD'), 'a finished setup shows the board'); assert.ok(!f.text().includes('Set up your practice')); } finally { await f.unmount(); }
}

test('#4830 the setup state takes the board’s place only while a step is known missing', async () => {
  await mutationCheck(leadStub, LEAD, takeover, [
    ['return progress.takeOver ? <PracticeSetupCard progress={progress} onRetry={retry} /> : fallback;', 'return fallback;'],
    ["(k === 'profile' && e?.status === 404 ? null : UNREADABLE)", '(UNREADABLE)'],
  ]);
});

// ── Opportunities (PX-02, PX-02b) ───────────────────────────────────────

test('#4830 a request card says how long it has waited, in words, and its session length', () => {
  assert.equal(waitingFor('2026-11-14 08:00:00', NOW), '4 h');
  assert.equal(waitingFor('2026-11-12T09:00:00Z', NOW), '2 days', '51 hours');
  assert.equal(waitingFor('2026-11-13T11:00:00Z', NOW), '1 day');
  assert.equal(waitingFor('2026-11-14T11:40:00Z', NOW), 'under an hour');
  assert.equal(waitingFor(null, NOW), null);
  assert.equal(waitingFor('2026-11-15T00:00:00Z', NOW), null, 'a time in the future is not a wait');
  assert.equal(requestMinutes({ startsAt: '2026-11-16T14:00:00Z', endsAt: '2026-11-16T15:00:00Z' }), 60);
  assert.equal(requestMinutes({ startsAt: '2026-11-16T14:00:00Z', endsAt: null }), null);
});

const ZONE = 'pages/advisor/practice/OpportunitiesZone.jsx';
const zoneSrc = readFileSync(new URL(`../src/${ZONE}`, import.meta.url), 'utf8');
const zoneStub = zoneSrc.replace(/^import \{ api \} from '..\/..\/..\/lib\/api';\n/m,
  'export const control = { me: null, bookings: [] };\n'
  + 'const api = { async listMyAdvisorBookings() { return { items: control.bookings, page: { total: control.bookings.length, next_offset: null } }; }, async listMyAdvisorServices() { return { items: [] }; }, async getMyAdvisor() { if (!control.me) throw new Error("x"); return control.me; } };\n');
assert.notEqual(zoneStub, zoneSrc);

async function emptyLog(module) {
  module.control.bookings = []; module.control.me = { uid: 'adv-1' };
  let f = await mountForm(h(module.default));
  try {
    await f.flush();
    const t = f.text();
    assert.ok(t.includes('No requests yet'), t.slice(0, 200));
    assert.ok(t.includes('Publish a booking link or share your advisor profile to receive requests.'));
    assert.ok(t.includes('Create booking link') && t.includes('Preview profile'));
  } finally { await f.unmount(); }
  module.control.me = null;
  f = await mountForm(h(module.default));
  try { await f.flush(); assert.ok(!f.text().includes('Preview profile'), 'no uid, no preview link'); } finally { await f.unmount(); }
}

test('#4830 an empty log reads "No requests yet", with Create booking link and Preview profile when the uid is known', async () => {
  await mutationCheck(zoneStub, ZONE, emptyLog, [
    ['title="No requests yet"', 'title="No request has ever arrived"'],
    ['{state.uid ? <Link', '{true ? <Link'],
  ]);
});
