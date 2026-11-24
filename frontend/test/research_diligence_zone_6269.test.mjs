/**
 * D6269 (#6269): the investor's room list drawn to the Investor Research v2
 * Rooms canvas (IRV-02): tiles, three counts per room, the NDA, the deal, the
 * expiry mark, a Requests block, chips that select real states, no `New
 * request`, and an export carrying every column. The page itself is rendered
 * in `research_diligence_zone_render_6269.test.mjs`; this file reads the pure
 * model, the toolbar tables and the export wiring.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/research_diligence_zone_6269.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  EXPIRING_SOON_DAYS, EXPORT_HEADER, chipCounts, dealStageText, exportCells, expiryMark, ndaWord,
  requestList, roomCounts, tiles, view,
} from '../src/pages/research/diligenceZoneRead.js';
import { INVESTOR_ZONE_FILTERS, investorZoneFilters } from '../src/workspaces/investorZoneFilters.js';
import { investorZoneActions } from '../src/workspaces/investorZoneActions.js';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const NOW = Date.parse('2026-11-14T12:00:00Z');
const stageWord = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Status not recorded');

const ROOM = (over = {}) => ({
  grant_uid: 'g1', project_name: 'Kelp', file_open: 6, file_total: 11, withheld_behind_nda: 5,
  nda: { status: 'none', valid_until: null }, deals: [{ id: 7, stage: 'diligence' }],
  created_at: '2026-11-02 09:00:00', last_opened_at: '2026-11-10 14:12:00', expires_at: '2026-11-26 00:00:00', ...over,
});
const DATA = {
  items: [ROOM(), ROOM({ grant_uid: 'g2', project_name: 'Harbor', file_open: 4, file_total: 4, withheld_behind_nda: 0 })],
  requests: [
    { uid: 'q1', project_name: 'Fjord', state: 'open', created_at: '2026-11-09 10:00:00', decided_at: null, decline_reason: null },
    { uid: 'q2', project_name: 'Aster', state: 'declined', created_at: '2026-11-01 10:00:00', decided_at: '2026-11-06 10:00:00', decline_reason: 'Lead investor only this round.' },
  ],
  requests_unreadable: false,
  granted_count: 2,
  partial_count: 1,
};

test('the tiles are rooms granted, partly staged and requests open; a failed request read is null, never 0', () => {
  assert.deepEqual(tiles(DATA), { granted: 2, partlyStaged: 1, requestsOpen: 1 });
  assert.equal(tiles({ ...DATA, requests: null, requests_unreadable: true }).requestsOpen, null);
  // An older Worker without the field is not read as "no requests".
  assert.equal(tiles({ items: [], granted_count: 0, partial_count: 0 }).requestsOpen, null);
  // A measured zero is a figure.
  assert.deepEqual(tiles({ items: [], requests: [], requests_unreadable: false, granted_count: 0, partial_count: 0 }), { granted: 0, partlyStaged: 0, requestsOpen: 0 });
});

test('a room keeps open, total and behind an NDA as three numbers', () => {
  assert.deepEqual(roomCounts(ROOM()), { open: 6, total: 11, behind: 5 });
  assert.deepEqual(roomCounts({ file_open: null, file_total: null }), { open: null, total: null, behind: null });
});

test('the NDA reads in the canvas’s words, and an unknown status is Not recorded', () => {
  assert.deepEqual(ndaWord({ status: 'on_file', valid_until: '2027-01-31' }), { kind: 'on_file', word: 'NDA signed', until: '31 Jan 2027' });
  assert.equal(ndaWord({ status: 'out_for_signature' }).word, 'NDA out for signature');
  assert.equal(ndaWord({ status: 'none' }).word, 'No NDA');
  assert.equal(ndaWord(undefined).word, 'Not recorded');
  assert.equal(ndaWord({ status: 'odd' }).kind, 'not_recorded');
});

test(`an expiry within ${EXPIRING_SOON_DAYS} days is marked; no end date says so`, () => {
  assert.deepEqual(expiryMark('2026-11-26 00:00:00', NOW), { kind: 'date', word: '26 Nov 2026', soon: 'in 12 days' });
  assert.equal(expiryMark('2026-11-15 00:00:00', NOW).soon, 'in 1 day');
  assert.equal(expiryMark('2026-11-14 18:00:00', NOW).soon, 'today');
  assert.equal(expiryMark('2026-11-28 23:00:00', NOW).soon, 'in 14 days');
  assert.equal(expiryMark('2026-11-29 00:00:00', NOW).soon, null, 'fifteen days is not soon');
  assert.equal(expiryMark('2026-12-20 00:00:00', NOW).soon, null);
  assert.deepEqual(expiryMark(null, NOW), { kind: 'none', word: 'No end date' });
});

test('each chip selects a real state: rooms for All and Partly staged, requests for Requested and Declined', () => {
  assert.deepEqual(view(DATA, 'all').rooms.map((r) => r.grant_uid), ['g1', 'g2']);
  assert.deepEqual(view(DATA, 'all').requests.map((q) => q.uid), ['q1', 'q2']);
  assert.deepEqual(view(DATA, 'partial').rooms.map((r) => r.grant_uid), ['g1']);
  assert.equal(view(DATA, 'partial').requests, undefined, 'Partly staged is about rooms');
  assert.equal(view(DATA, 'requested').rooms, null);
  assert.deepEqual(view(DATA, 'requested').requests.map((q) => q.uid), ['q1']);
  assert.deepEqual(view(DATA, 'declined').requests.map((q) => q.uid), ['q2']);
  assert.equal(view({ ...DATA, requests: null, requests_unreadable: true }, 'requested').requests, null, 'unreadable stays unreadable under a chip');
  assert.deepEqual(chipCounts(DATA), { partial: 1, requested: 1, declined: 1 });
  assert.equal(requestList({ requests: [{ uid: 'x', state: 'accepted' }], requests_unreadable: false }).length, 0);
});

test('the chip row is the canvas’s states, with counts, and none is a disabled stand-in', () => {
  const rows = INVESTOR_ZONE_FILTERS['research/diligence'];
  assert.deepEqual(rows.map((r) => r.canvas), ['All', 'Partly staged', 'Requested', 'Declined']);
  assert.ok(rows.every((r) => r.key && !r.unbuilt), 'every chip selects');
  assert.equal(rows.find((r) => r.canvas === 'Requested').key, 'requested', 'Requested means a request');
  const chips = investorZoneFilters('research/diligence', { value: 'all', onChange: () => {}, counts: chipCounts(DATA) });
  assert.deepEqual(chips.map((c) => c.label), ['All', 'Partly staged 1', 'Requested 1', 'Declined 1']);
  assert.ok(chips.every((c) => !c.disabled));
  let picked = null;
  investorZoneFilters('research/diligence', { value: 'all', onChange: (k) => { picked = k; } })[2].onSelect();
  assert.equal(picked, 'requested');
});

test('New request is gone, and no disabled control on the row cites an issue', () => {
  const ops = investorZoneActions('research/diligence');
  assert.equal(ops.find((a) => a.label === 'New request'), undefined);
  for (const a of ops.filter((o) => o.disabled)) assert.doesNotMatch(String(a.title || ''), /#\d+/, `${a.label} cites an issue`);
});

test('the export carries every column the row shows, with state words and never a made-up 0', () => {
  assert.deepEqual([...EXPORT_HEADER], ['Company', 'Open to you', 'In the room', 'Behind an NDA', 'NDA with founder', 'NDA valid until', 'Deal stage', 'Granted', 'You last opened', 'Access expires']);
  assert.deepEqual(exportCells(ROOM({ nda: { status: 'on_file', valid_until: '2027-01-31' } }), stageWord),
    ['Kelp', 6, 11, 5, 'NDA signed', '2027-01-31', 'Diligence', '2026-11-02 09:00:00', '2026-11-10 14:12:00', '2026-11-26 00:00:00']);
  const bare = exportCells({ grant_uid: 'x', project_name: 'X', deals: null, nda: null }, stageWord);
  assert.deepEqual(bare, ['X', 'Not recorded', 'Not recorded', 'Not recorded', 'Not recorded', '', 'Unavailable', 'Not recorded', 'Never opened', 'No end date']);
  assert.equal(dealStageText({ deals: [] }, stageWord), 'None');
  assert.equal(exportCells(ROOM(), stageWord).length, EXPORT_HEADER.length);
  const ws = read('frontend/src/workspaces/ResearchWorkspace.jsx');
  const block = ws.slice(ws.indexOf("if (slug === 'diligence')"), ws.indexOf('</Suspense>', ws.indexOf("if (slug === 'diligence')")));
  assert.match(block, /header: DILIGENCE_EXPORT_HEADER,/);
  assert.match(block, /cells: \(r\) => diligenceExportCells\(r, stageWord\),/);
});

test('the page stacks on a phone and uses #5129’s states, not its own', () => {
  const page = read('frontend/src/pages/research/DiligenceZone.jsx');
  // One column pair on a phone, the canvas's columns from lg up; the header row is desktop-only.
  assert.match(page, /className=\{`grid grid-cols-2 gap-x-3 gap-y-2 py-3 lg:items-center \$\{ROW_GRID\}`\}/);
  assert.match(page, /const ROW_GRID = 'lg:grid-cols-\[/);
  assert.match(page, /hidden gap-x-3 [^`]*lg:grid \$\{ROW_GRID\}/);
  assert.match(page, /min-h-\[44px\][^"]*\$\{LINK\}`\}>Open the room →/);
  assert.match(page, /from '\.\.\/\.\.\/ui\/Honesty\.jsx'/);
  assert.match(page, /state="unavailable" size="block" what="Your rooms list"/);
  assert.match(page, /state="unavailable" size="block" what="Your requests"/);
  assert.match(page, /state="refused" size="block"/);
  assert.match(page, /<DataState state="loading" size="block" \/>/);
  assert.doesNotMatch(page, /ZoneBody|NothingYet|Unrecorded|\bPill\b/, 'an older local state is back');
  assert.doesNotMatch(page, /New request/);
});
