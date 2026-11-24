/**
 * D6269 (#6269): `/research/diligence` rendered in each of its states. The
 * model is tested in `research_diligence_zone_6269.test.mjs`; this renders the
 * page body (`DiligenceBody`) so the words on screen are checked, not assumed.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/research_diligence_zone_render_6269.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { DiligenceBody, NO_REQUESTS, NO_ROOMS } from '../src/pages/research/DiligenceZone.jsx';

const h = React.createElement;
const NOW = Date.parse('2026-11-14T12:00:00Z');
const html = (props) => renderToStaticMarkup(h(MemoryRouter, null, h(DiligenceBody, { now: NOW, filter: 'all', onRetry: () => {}, ...props })));
const text = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, ' ');
const slice = (s, testid) => {
  const at = s.indexOf(`data-testid="${testid}"`);
  assert.ok(at >= 0, `${testid} is not drawn`);
  return s.slice(at, at + 3000);
};

const DATA = {
  items: [
    {
      grant_uid: 'g1', project_name: 'Kelp', file_open: 6, file_total: 11, withheld_behind_nda: 5,
      nda: { status: 'out_for_signature', valid_until: null }, deals: [{ id: 7, stage: 'diligence' }],
      created_at: '2026-11-02 09:00:00', last_opened_at: '2026-11-10 14:12:00', expires_at: '2026-11-26 00:00:00',
    },
    {
      grant_uid: 'g2', project_name: 'Harbor', file_open: 4, file_total: 4, withheld_behind_nda: 0,
      nda: { status: 'on_file', valid_until: '2027-01-31' }, deals: null,
      created_at: '2026-10-02 09:00:00', last_opened_at: null, expires_at: null,
    },
  ],
  requests: [
    { uid: 'q1', project_name: 'Fjord', state: 'open', created_at: '2026-11-09 10:00:00', decided_at: null, decline_reason: null },
    { uid: 'q2', project_name: 'Aster', state: 'declined', created_at: '2026-11-01 10:00:00', decided_at: '2026-11-06 10:00:00', decline_reason: 'Lead investor only this round.' },
    { uid: 'q3', project_name: null, state: 'declined', created_at: '2026-10-01 10:00:00', decided_at: null, decline_reason: null },
  ],
  requests_unreadable: false,
  granted_count: 2,
  partial_count: 1,
};

test('the tiles show rooms granted, partly staged and requests open', () => {
  const out = html({ data: DATA });
  assert.match(text(slice(out, 'tile-granted')), /Rooms granted 2 rooms, live grants as of now/);
  assert.match(text(slice(out, 'tile-partial')), /Partly staged 1 rooms with files behind an NDA/);
  assert.match(text(slice(out, 'tile-requests')), /Requests open 1 waiting on a founder/);
});

test('each room row shows its three numbers, NDA, deal, last opened and expiry', () => {
  const out = html({ data: DATA });
  const rows = out.split('data-testid="room-row"').slice(1);
  assert.equal(rows.length, 2);
  const [kelp, harbor] = rows.map(text);
  assert.match(kelp, /Kelp/);
  assert.match(kelp, /Files open to you 6 open of 11/);
  assert.match(kelp, /Behind an NDA 5/);
  assert.match(kelp, /NDA out for signature/);
  assert.match(kelp, /Deal stage: Diligence Open the deal/);
  assert.match(kelp, /You last opened 10 Nov 2026/);
  assert.match(kelp, /Access expires 26 Nov 2026 ◷ Expires in 12 days/);
  assert.match(rows[0], /href="\/deals\/7"/);
  assert.match(rows[0], /href="\/research\/diligence\/g1"/);
  // A measured 0 is a figure; a room never opened says so; no end date says so.
  assert.match(harbor, /Behind an NDA 0/);
  assert.match(harbor, /NDA signed until 31 Jan 2027/);
  assert.match(harbor, /Never opened/);
  assert.match(harbor, /No end date/);
  assert.doesNotMatch(rows[1], /room-expiring-soon/);
  // A failed deal join is Unavailable in #5129's word, not "no deal".
  assert.match(harbor, /Unavailable The deals on this company could not be read\. That is not a claim that there are none\./);
});

test('the Requests block lists open and declined requests, with the founder’s reason and date', () => {
  const out = html({ data: DATA });
  const reqs = out.split('data-testid="request-row"').slice(1).map(text);
  assert.equal(reqs.length, 3);
  assert.match(reqs[0], /Company Fjord State ◷ Open · waiting Sent 9 Nov 2026 Decided Not decided/);
  assert.match(reqs[1], /Company Aster State ⊘ Declined Sent 1 Nov 2026 Decided 6 Nov 2026 Founder’s reason Lead investor only this round\./);
  // No reason and no decision time: Not recorded, never blank; a name you could not see is not shown.
  assert.match(reqs[2], /Company not named here/);
  assert.match(reqs[2], /Decided Not recorded/);
  assert.match(reqs[2], /Not recorded · The founder gave no reason\./);
});

test('a failed request read is Unavailable in its tile and block, and the rooms still show', () => {
  const out = html({ data: { ...DATA, requests: null, requests_unreadable: true } });
  assert.match(text(slice(out, 'tile-requests')), /Unavailable Your requests could not be read\. This is not a claim that none exist\./);
  assert.match(text(slice(out, 'requests-unavailable')), /Your requests could not be read\./);
  assert.match(out, /Retry/);
  assert.equal(out.split('data-testid="room-row"').length - 1, 2);
});

test('the chips narrow the page: Requested shows requests only, Partly staged rooms only', () => {
  const requested = html({ data: DATA, filter: 'requested' });
  assert.doesNotMatch(requested, /data-testid="rooms-block"/);
  assert.equal(requested.split('data-testid="request-row"').length - 1, 1);
  const declined = html({ data: DATA, filter: 'declined' });
  assert.equal(declined.split('data-testid="request-row"').length - 1, 2);
  const partial = html({ data: DATA, filter: 'partial' });
  assert.equal(partial.split('data-testid="room-row"').length - 1, 1);
  assert.doesNotMatch(partial, /data-testid="requests-block"/);
  const noneDeclined = html({ data: { ...DATA, requests: [DATA.requests[0]] }, filter: 'declined' });
  assert.match(text(noneDeclined), new RegExp(NO_REQUESTS.declined));
  const nonePartial = html({ data: { ...DATA, items: [DATA.items[1]], partial_count: 0 }, filter: 'partial' });
  assert.match(text(nonePartial), new RegExp(NO_ROOMS.partial));
});

test('loading, empty, refused and unavailable use #5129’s words', () => {
  const loading = html({ loading: true, data: null });
  assert.match(loading, /aria-busy="true"/);
  assert.match(loading, /data-platform-state="loading"/);
  assert.doesNotMatch(text(loading), /\b0\b/);

  const empty = html({ data: { items: [], requests: [], requests_unreadable: false, granted_count: 0, partial_count: 0 } });
  assert.match(text(slice(empty, 'rooms-none')), new RegExp(NO_ROOMS.all));
  assert.match(empty, /data-platform-state="none"/);
  assert.match(text(slice(empty, 'requests-none')), /You have no open or declined request for a room\. Ask from a deal’s Documents tab\./);
  assert.match(text(slice(empty, 'tile-granted')), /Rooms granted 0/, 'a measured zero is a figure');

  const refused = html({ data: null, error: Object.assign(new Error('Forbidden'), { status: 403 }) });
  assert.match(text(refused), /Refused\. Nothing of your rooms is shown here, because the read was refused\./);
  assert.match(refused, /href="\/deals"/);
  assert.doesNotMatch(refused, /Retry/);

  const failed = html({ data: null, error: Object.assign(new Error('Boom'), { status: 500 }) });
  assert.match(text(failed), /Unavailable Your rooms list could not be read\. This is not a claim that none exist\./);
  assert.match(failed, /Retry/);
  assert.doesNotMatch(text(failed), /No founder has opened/);
});
