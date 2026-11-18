/**
 * D6266 (#6266): a diligence room shows its deal (stage, Open the deal), or says in plain words that
 * none is open to you; it never says Not recorded for a reason that is false.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/research_room_deals_6266.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import RoomDeals, { NO_ROOM_DEAL, stageWord } from '../src/pages/research/RoomDeals.jsx';

const h = React.createElement;
const html = (props) => renderToStaticMarkup(h(MemoryRouter, null, h(RoomDeals, props)));
const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');

test('a deal you may open shows its stage in the deal page’s word and links to the deal', () => {
  const out = html({ deals: [{ id: 51, stage: 'active', name: 'Roomco' }, { id: 52, stage: 'funded', name: 'Roomco' }] });
  assert.match(out, /Deal stage: <b[^>]*>Active<\/b>/);
  assert.match(out, /Deal stage: <b[^>]*>Funded<\/b>/);
  assert.match(out, /href="\/deals\/51"[^>]*>Open the deal</);
  assert.match(out, /href="\/deals\/52"/);
  assert.doesNotMatch(out, /Not recorded|No deal you are invited/);
});

test('no deal says so in plain words; a failed read carries the Worker’s Unreadable sentence', () => {
  for (const props of [{ deals: [], note: NO_ROOM_DEAL }, { deals: [] }, {}]) {
    const out = html(props);
    assert.match(out, /No deal you are invited to is recorded for this company\./);
    assert.doesNotMatch(out, /Not recorded|href="\/deals/);
  }
  const unreadable = 'Unreadable: the deals on this company could not be read. That is not a claim that there are none.';
  assert.match(html({ deals: null, note: unreadable }), /Unreadable: the deals on this company could not be read\./);
});

test('stage words match the deal page header (its stored status, capitalised; none is said)', () => {
  assert.equal(stageWord('active'), 'Active');
  assert.equal(stageWord('funded'), 'Funded');
  assert.equal(stageWord(null), 'Status not recorded');
  // The deal page draws `deal.status` capitalised and 'Status not recorded' when absent.
  const page = read('frontend/src/pages/DealRoomPage.jsx');
  assert.match(page, /capitalize`\} data-testid="deal-status">\{deal\.status \|\| 'Status not recorded'\}/);
});

test('both diligence pages draw the room’s deals; the "no key" sentence is gone', () => {
  const zone = read('frontend/src/pages/research/DiligenceZone.jsx');
  const room = read('frontend/src/pages/research/DiligenceRoom.jsx');
  assert.match(zone, /<RoomDeals deals=\{r\.deals\} note=\{r\.deal_stage_note\} \/>/);
  assert.match(room, /<RoomDeals deals=\{room\.deals\} note=\{room\.deal_stage_note\} \/>/);
  for (const src of [zone, room, read('cloudflare-worker/src/routes/research.ts')]) assert.doesNotMatch(src, /no key between them/);
});
