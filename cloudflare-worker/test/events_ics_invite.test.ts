/**
 * Task #15 — Emailed event invitations must render as proper calendar meeting
 * invites (accept/decline), not plain "published" events.
 *
 * The historical bug: the invite email labelled its calendar MIME part
 * `text/calendar; method=REQUEST` while the generated `.ics` body said
 * `METHOD:PUBLISH` and carried no ORGANIZER/ATTENDEE — so Outlook (and others)
 * showed a dumb attachment instead of accept/decline buttons.
 *
 * These tests pin the two halves of the fix to the REAL production helpers:
 *   1. buildEventIcs (services/eventsCommon.ts) — REQUEST emits ORGANIZER +
 *      ATTENDEE + STATUS/SEQUENCE; PUBLISH (the add-to-calendar download path)
 *      stays exactly as before.
 *   2. buildRawMimeMessage (services/email/gmail.ts) — the MIME `method=` on
 *      every text/calendar part mirrors the ICS `METHOD:`, so the file and the
 *      part can never disagree again; the invite rides inline (accept/decline)
 *      AND as a downloadable .ics.
 *
 * Run via the strip-types loader (see package.json test:drift).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEventIcs } from '../src/services/eventsCommon.ts';
import { buildRawMimeMessage } from '../src/services/email/gmail.ts';

const EVENT = {
  id: 42,
  slug: 'spring-demo-day',
  title: 'Spring Demo Day',
  summary: 'Founders pitch their startups',
  starts_at: '2090-05-01T18:00:00Z',
  ends_at: '2090-05-01T20:00:00Z',
  timezone: 'UTC',
  location_kind: 'physical',
  location_text: 'SF HQ',
  location_url: 'https://maps.example/hq',
  created_at: '2090-01-01T00:00:00Z',
  updated_at: '2090-01-02T00:00:00Z',
};

test('buildEventIcs defaults to METHOD:PUBLISH with no ORGANIZER/ATTENDEE (add-to-calendar download path unchanged)', () => {
  const ics = buildEventIcs(EVENT, 'https://axal.vc');
  assert.match(ics, /METHOD:PUBLISH/);
  assert.doesNotMatch(ics, /METHOD:REQUEST/);
  assert.doesNotMatch(ics, /ORGANIZER/);
  assert.doesNotMatch(ics, /ATTENDEE/);
  assert.doesNotMatch(ics, /STATUS:/);
  assert.doesNotMatch(ics, /SEQUENCE:/);
  // Core VEVENT identity is still present.
  assert.match(ics, /BEGIN:VEVENT/);
  assert.match(ics, /UID:event-42@axal\.vc/);
  assert.match(ics, /SUMMARY:Spring Demo Day/);
});

test('buildEventIcs REQUEST emits a meeting invite with ORGANIZER + ATTENDEE + STATUS/SEQUENCE', () => {
  const ics = buildEventIcs(EVENT, 'https://axal.vc', {
    method: 'REQUEST',
    organizer: { email: 'noreply@axal.vc', name: 'Axal VC' },
    attendee: { email: 'guest@example.com', name: 'Guest One' },
  });
  assert.match(ics, /METHOD:REQUEST/);
  assert.doesNotMatch(ics, /METHOD:PUBLISH/);
  assert.match(ics, /ORGANIZER;CN="Axal VC":mailto:noreply@axal\.vc/);
  assert.match(
    ics,
    /ATTENDEE;CN="Guest One";ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:guest@example\.com/,
  );
  assert.match(ics, /STATUS:CONFIRMED/);
  assert.match(ics, /SEQUENCE:0/);
});

test('buildEventIcs REQUEST without an attendee name omits the CN parameter', () => {
  const ics = buildEventIcs(EVENT, 'https://axal.vc', {
    method: 'REQUEST',
    organizer: { email: 'noreply@axal.vc', name: 'Axal VC' },
    attendee: { email: 'guest@example.com' },
  });
  assert.match(ics, /ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:guest@example\.com/);
});

test('buildRawMimeMessage: the .ics METHOD and EVERY MIME text/calendar method= agree (no REQUEST/PUBLISH mismatch)', () => {
  const ics = buildEventIcs(EVENT, 'https://axal.vc', {
    method: 'REQUEST',
    organizer: { email: 'noreply@axal.vc', name: 'Axal VC' },
    attendee: { email: 'guest@example.com', name: 'Guest One' },
  });
  const mime = buildRawMimeMessage({
    to: 'guest@example.com',
    subject: "You're invited: Spring Demo Day",
    text: 'You are invited.',
    html: '<p>You are invited.</p>',
    from: 'Axal VC <noreply@axal.vc>',
    replyTo: 'support@axal.vc',
    calendarInvite: { method: 'REQUEST', content: ics, filename: 'spring-demo-day.ics' },
  });

  // The ICS body declares REQUEST...
  assert.match(ics, /METHOD:REQUEST/);
  // ...and every text/calendar MIME part declares the SAME method — this is the
  // exact mismatch Task #15 fixes.
  const calParts = mime.match(/text\/calendar; method=[A-Z]+/g) || [];
  assert.ok(calParts.length >= 1, 'expected at least one text/calendar MIME part');
  for (const part of calParts) {
    assert.equal(part, 'text/calendar; method=REQUEST', 'a text/calendar part disagreed with the .ics METHOD');
  }

  // The invite rides BOTH inline (accept/decline) and as a downloadable .ics.
  assert.match(mime, /Content-Type: multipart\/mixed/);
  assert.match(mime, /Content-Type: multipart\/alternative/);
  assert.match(mime, /Content-Disposition: attachment; filename="spring-demo-day\.ics"/);
  // Inline calendar part lives inside the alternative block (no Content-Disposition
  // before the attachment one) — at least two calendar parts total.
  assert.ok(calParts.length >= 2, 'expected an inline alternative AND an attachment calendar part');
});

test('buildRawMimeMessage: method= is uppercased/sanitised so it cannot inject extra MIME params', () => {
  const mime = buildRawMimeMessage({
    to: 'guest@example.com',
    subject: 'Hi',
    text: 'hi',
    html: '<p>hi</p>',
    from: 'Axal VC <noreply@axal.vc>',
    replyTo: 'support@axal.vc',
    calendarInvite: { method: 'request; charset=evil', content: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n' },
  });
  const calParts = mime.match(/text\/calendar; method=[A-Z]+/g) || [];
  assert.ok(calParts.length >= 1);
  for (const part of calParts) assert.equal(part, 'text/calendar; method=REQUESTCHARSETEVIL');
  // The injected `; charset=evil` did not survive as a separate parameter.
  assert.doesNotMatch(mime, /method=request; charset=evil/);
});

test('buildRawMimeMessage: a plain email (no calendar, no attachments) stays a legacy multipart/alternative', () => {
  const mime = buildRawMimeMessage({
    to: 'guest@example.com',
    subject: 'Hello',
    text: 'hi',
    html: '<p>hi</p>',
    from: 'Axal VC <noreply@axal.vc>',
    replyTo: 'support@axal.vc',
  });
  assert.match(mime, /Content-Type: multipart\/alternative/);
  assert.doesNotMatch(mime, /multipart\/mixed/);
  assert.doesNotMatch(mime, /text\/calendar/);
});
