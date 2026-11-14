// #4715 — a founder's partner booking carries the meeting link only once the
// partner has confirmed. Before that the row says has_meeting_link, and the
// Office Hours list still tells the founder a link will come on confirmation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normBooking } from '../src/pages/SpinoutLabOfficeHoursPage.jsx';

test('normBooking: has_meeting_link from the Worker, else from a link the row carries', () => {
  const pending = normBooking({ id: 1, status: 'pending', has_meeting_link: true });
  assert.equal(pending.meeting_uri, null, 'no link is invented');
  assert.equal(pending.has_meeting_link, true);
  assert.equal(normBooking({ id: 2, status: 'pending', has_meeting_link: false }).has_meeting_link, false);
  const confirmed = normBooking({ id: 3, status: 'confirmed', meeting_url: 'https://meet.example.test/x' });
  assert.equal(confirmed.meeting_uri, 'https://meet.example.test/x');
  assert.equal(confirmed.has_meeting_link, true, 'an older row with the link still reads as having one');
});

test('the unconfirmed note reads has_meeting_link, and Join still needs a confirmed booking with its link', () => {
  const src = readFileSync(new URL('../src/pages/SpinoutLabOfficeHoursPage.jsx', import.meta.url), 'utf8');
  assert.match(src, /\{b\.has_meeting_link \? 'link on confirmation' : 'no link published'\}/);
  assert.match(src, /\{b\.status === 'confirmed' && b\.meeting_uri \? \(/);
});
