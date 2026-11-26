// D6913 part 3 (#6913, canvas RS-15) — an Ask answer citing a data-room file: the source says which room it came from
// and when it was added; the source sheet adds how long access lasts and whether Ask reaches it, with Open in room. A
// source the room no longer reaches says why and withholds its passage; a lapsed NDA file is nameless. Sample data only.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/room_library_citation_6913.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { CitationRoomFacts, OpenInRoom } from '../src/pages/research/RoomLibrary.jsx';
import { LAPSE_REASONS, NAMELESS, accessWords, citationRoom, withheldPassage } from '../src/pages/research/roomLibraryModel.js';

const h = React.createElement;
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const read = (p) => readFileSync(p, 'utf8');

const live = {
  uid: 'd-1', title: 'Cohort retention Q3.xlsx', source: 'own', read_only: true, in_ask: true, index_state: 'indexed',
  room: { project_uid: 'p-1', project_name: '[Sample room]', added_at: '2026-10-02T09:00:00Z', lost_at: null, lost_reason: null, access: { until: '2027-01-12T00:00:00Z' } },
};
const lapsed = (reason) => ({
  ...live, uid: `d-${reason}`, in_ask: false, index_state: 'source_lost',
  room: { ...live.room, lost_at: '2026-11-20T00:00:00Z', lost_reason: reason, access: null },
});
const ours = { uid: 'd-o', title: 'Seed SaaS benchmarks 2026.pdf', source: 'own', in_ask: true, index_state: 'indexed', room: null };
const cite = (uid, title = 'Cohort retention Q3.xlsx') => ({ n: 1, title, document_uid: uid, passage: 'Jan–Jun 2026 cohorts, month-6 logo retention 71%', cited: true });

test('RS-15: a source is a room file only when its Library row came from a room', () => {
  const items = [live, ours];
  const r = citationRoom(cite('d-1'), items);
  assert.equal(r.chip, 'From [Sample room] data room');
  assert.equal(r.added, '2 Oct 2026');
  assert.equal(r.access, 'Available until 12 Jan 2027');
  assert.equal(r.inAsk, 'Yes');
  assert.equal(citationRoom(cite('d-o', 'Seed SaaS benchmarks 2026.pdf'), items), null, 'our own file carries no room');
  // A source no longer in the Library: its room is not known, so it is not claimed to be one.
  assert.equal(citationRoom(cite('d-gone'), items), null);
  assert.equal(citationRoom({ title: 'No uid' }, items), null);
});

test('RS-15: access reads the grant’s end, "No expiry set" for none, and nothing when there is no live grant', () => {
  assert.equal(accessWords(live), 'Available until 12 Jan 2027');
  // Mutation checked: read `until` as missing access → "No expiry set" disappears for a grant with no end.
  assert.equal(accessWords({ room: { ...live.room, access: { until: null } } }), 'No expiry set');
  assert.equal(accessWords(lapsed('revoked')), null);
  assert.equal(accessWords(ours), null);
});

test('RS-15: a lapsed source says why in its own words and withholds its passage; an NDA lapse is nameless', () => {
  for (const reason of Object.keys(LAPSE_REASONS)) {
    const r = citationRoom(cite(`d-${reason}`), [lapsed(reason)]);
    assert.equal(r.lost, true, reason);
    assert.equal(r.reasonWords, LAPSE_REASONS[reason], reason);
    assert.equal(r.inAsk, 'Not answerable', reason);
    const out = html(h(CitationRoomFacts, { room: r, answeredAt: '2026-11-14T10:51:00Z' }));
    assert.match(out, /No longer available\./, reason);
    assert.ok(out.replace(/&#x27;/g, "'").includes(LAPSE_REASONS[reason]), `${reason}: its own words`);
    assert.match(out, /The passage is no longer shown\. The answer keeps its text as it was given on 14 Nov 2026\./, reason);
    assert.doesNotMatch(out, /month-6 logo retention/, `${reason}: the passage is not drawn`);
    assert.equal(html(h(OpenInRoom, { room: r })), '', `${reason}: no Open in room`);
  }
  // Mutation checked: `nameless` dropped from citationRoom's title → the lapsed NDA source keeps the file's name.
  assert.equal(citationRoom(cite('d-nda_lapsed'), [lapsed('nda_lapsed')]).title, NAMELESS);
  assert.equal(citationRoom(cite('d-revoked'), [lapsed('revoked')]).title, 'Cohort retention Q3.xlsx');
  assert.equal(withheldPassage(null), 'The passage is no longer shown. The answer keeps its text as it was given.');
});

test('RS-15: a live source sheet shows the room, Added, Access, In Ask and Open in room', () => {
  const r = citationRoom(cite('d-1'), [live]);
  const out = html(h(CitationRoomFacts, { room: r, answeredAt: '2026-11-14T10:51:00Z' }));
  assert.match(out, /From \[Sample room\] data room/);
  assert.match(out, /Added<\/dt><dd[^>]*>2 Oct 2026/);
  assert.match(out, /Access<\/dt><dd[^>]*data-testid="ask-source-sheet-room-access">Available until 12 Jan 2027/);
  assert.match(out, /In Ask<\/dt><dd[^>]*>Yes/);
  assert.doesNotMatch(out, /no longer shown/);
  assert.match(html(h(OpenInRoom, { room: r })), /href="\/research\/diligence"[^>]*>Open in room/);
  const notYet = citationRoom(cite('d-1'), [{ ...live, in_ask: false, index_state: 'queued' }]);
  assert.equal(notYet.inAsk, 'No');
});

test('wiring: Ask draws the room mark on each source and the sheet’s room facts, and withholds a lapsed passage', () => {
  const ask = read('frontend/src/pages/research/AskZone.jsx');
  assert.match(ask, /citationRoom\(ct, items\)/, 'each source is matched to its Library row');
  assert.match(ask, /data-testid=\{`ask-source-room-\$\{t\.uid\}-\$\{i\}`\}/, 'the source carries its room mark');
  assert.match(ask, /room\?\.lost \? \(\s*<p[^>]*ask-passage-withheld/, 'a lapsed source withholds its passage in the list');
  assert.match(ask, /\{room\?\.lost \? null : ct\.passage \?/, 'and in the sheet');
  assert.match(ask, /<CitationRoomFacts room=\{room\} answeredAt=\{openCite\.t\.created_at\} \/>/);
  assert.match(ask, /<OpenInRoom room=\{room\} \/>/);
});
