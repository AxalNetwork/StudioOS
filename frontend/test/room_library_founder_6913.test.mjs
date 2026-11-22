// D6913 part 2 (#6913, canvas RS-17) — the founder's side of a data-room file in an investor's Library: Activity in
// the page's own words for library_add and library_remove, with the event filter, and the per-room switch on Access
// (off by default; turning it off goes Scope → Review → Result). Sample data only.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/room_library_founder_6913.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ACTIONS, eventWords } from '../src/pages/raise/dataroom/activityModel.js';
import { LibrarySwitchCard } from '../src/pages/raise/dataroom/LibrarySwitch.jsx';
import {
  ON_RESULT, OWNER_ONLY, SWITCH_EXPLAINS, offResult, offReview, switchError, switchState,
} from '../src/pages/raise/dataroom/librarySwitchModel.js';

const h = React.createElement;
const html = (el) => renderToStaticMarkup(el);
const read = (p) => readFileSync(p, 'utf8');

test('Activity: Added … to their Library and Removed … from their Library, and the filter offers both', () => {
  assert.equal(eventWords({ action: 'library_add', file: { name: 'Cohort retention Q3.xlsx' } }), 'Added Cohort retention Q3.xlsx to their Library');
  assert.equal(eventWords({ action: 'library_remove', file: { name: 'Pricing model.pdf' } }), 'Removed Pricing model.pdf from their Library');
  // A removed reference whose file left the room reads as the log's own unnamed file.
  assert.equal(eventWords({ action: 'library_remove', file: null }), 'Removed a file no longer in the room from their Library');
  // Mutation checked: drop the two filter rows → the founder cannot filter on them.
  assert.deepEqual(ACTIONS.map((a) => a.id), ['', 'open_room', 'download', 'blocked', 'library_add', 'library_remove']);
  assert.equal(ACTIONS.find((a) => a.id === 'library_add').label, 'Added to their Library');
  assert.equal(eventWords({ action: 'open_room' }), 'Opened the room');
});

test('the switch: off by default, what it allows, and only the owner changes it', () => {
  assert.equal(switchState({ state: 'ready', allow: false }), 'Off · the default for every room');
  assert.equal(switchState({ state: 'ready', allow: true }), 'On');
  const off = html(h(LibrarySwitchCard, { read: { state: 'ready', allow: false, live: 0, canChange: true }, onTurn() {} }));
  assert.match(off, /Investors’ own Ask/); assert.match(off, /Off · the default for every room/);
  assert.match(off, />Turn on</); assert.ok(off.includes(SWITCH_EXPLAINS.slice(0, 40)));
  assert.match(html(h(LibrarySwitchCard, { read: { state: 'ready', allow: true, live: 4, canChange: true }, onTurn() {} })), />Turn off</);
  // Mutation checked: ignore can_change → a co-founder is offered Turn off.
  const cofounder = html(h(LibrarySwitchCard, { read: { state: 'ready', allow: true, live: 4, canChange: false }, onTurn() {} }));
  assert.doesNotMatch(cofounder, /Turn (on|off)</); assert.match(cofounder, new RegExp(OWNER_ONLY));
  assert.match(html(h(LibrarySwitchCard, { read: { state: 'unreadable' }, onTurn() {}, onRetry() {} })), /not a claim that it is off/);
});

test('turning it off: Review names what changes with the live count; Result names what lost its reach', () => {
  const review = offReview(4);
  assert.equal(review[0], '4 files in investors’ Libraries lose their reach now');
  assert.match(review[1], /citations read No longer available/);
  assert.match(review[2], /room access do not change/);
  assert.equal(offReview(1)[0], '1 file in investors’ Libraries loses its reach now');
  // Mutation checked: Number.isInteger → truthy → 0 reads as unknown.
  assert.match(offReview(0)[0], /^No investor has a file/);
  assert.match(offReview(null)[0], /^Every file/);
  assert.equal(offResult({ lapsed: 3 }), 'Turned off. 3 files in investors’ Libraries lost their reach.');
  assert.equal(offResult({ lapsed: 0 }), 'Turned off. No file had to lose its reach.');
  assert.match(ON_RESULT, /^Turned on\./);
  assert.equal(switchError({ code: 'owner_only' }), OWNER_ONLY);
  assert.equal(switchError({}), 'Nothing changed. Try again.');
});

test('wiring: Access draws the switch; the review sends PUT through the client and only then says the result', () => {
  assert.match(read('frontend/src/pages/raise/dataroom/DataRoomAccess.jsx'), /\{projectUid \? <LibrarySwitch projectUid=\{projectUid\} \/> : null\}/);
  const sw = read('frontend/src/pages/raise/dataroom/LibrarySwitch.jsx');
  assert.match(sw, /const r = await roomLibraryApi\.setAllowed\(projectUid, to\); onDone\(to \? ON_RESULT : offResult\(r\)\)/);
  assert.match(sw, /roomLibraryApi\.settings\(projectUid\)/);
});
