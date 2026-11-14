/**
 * D5810 (#5810) — Account › Connectors › Microsoft Teams, on the member's one
 * Microsoft connection: the catalogue row, search, the deep link, the shared
 * sign-in, return and disconnect, the three capability rows, and the page
 * drawn at desktop and phone widths.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/teams_connector_d5810.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import {
  SHARED_DISCONNECT, buildCatalogue, connectionKeyOf, connectorsRedirect, disconnectNote, matchesQuery,
} from '../src/pages/account/connectorsModel.js';
import { pageAction, pageEntry, pageReturn } from '../src/pages/account/connectorPageModel.js';
import { markSignInFrom, takeSignInFrom, teamsCapabilityRows } from '../src/pages/account/teamsConnector.js';
import { startFirstParty } from '../src/pages/account/useConnectFlow.js';
import TeamsSection from '../src/pages/account/TeamsSection.jsx';
import ConnectorMark from '../src/pages/account/ConnectorMark.jsx';
import { saveRecordDraft } from '../src/pages/founder/recordDraft.js';

const h = React.createElement;
const TEAMS_CARD = { key: 'teams', display_name: 'Microsoft Teams', category: 'Calendar and workspace', status: 'live', tier: 'free', first_party: true,
  connection_source: 'microsoft_oauth_tokens', shares_connection: 'microsoft', tagline: 'Create Microsoft Teams meetings for your interviews, on your Microsoft connection.', made_by: { name: 'Axal VC' }, page_key: 'teams' };
const MS_ROW = { key: 'microsoft_365', display_name: 'Microsoft 365', category: 'Calendar and workspace', description: 'Calendar events.' };
const MS_ON = { configured: true, connected: true, microsoft_email: 'founder@example.test', sync_error: null };
const cat = (microsoft, cards = [TEAMS_CARD]) => buildCatalogue({ providers: [MS_ROW], firstParty: { microsoft }, firstPartyCards: cards });
const by = (list, key) => list.find((p) => p.key === key);

function memoryStore() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}

test('an existing Microsoft grant fills both the Teams and the Microsoft 365 rows at once', () => {
  const list = cat(MS_ON);
  const teams = by(list, 'teams');
  const ms = by(list, 'microsoft');
  assert.ok(teams && ms, 'both rows are listed');
  assert.deepEqual(teams.connection, ms.connection, 'one connection, the same on both');
  assert.equal(teams.connection.external_account_name, 'founder@example.test');
  assert.equal(teams.shares, 'microsoft');
  assert.equal(connectionKeyOf('teams'), 'microsoft');
  assert.equal(connectionKeyOf('microsoft'), 'microsoft');
  assert.equal(pageAction(teams).kind, 'status');
  // Mutation checked: reading firstParty.teams instead of the shared key leaves Teams disconnected.
  assert.equal(by(cat({ configured: true, connected: false }), 'teams').connection, null);
});

test('a failed status read is unreadable, never disconnected; a refused grant asks to reconnect', () => {
  const unread = by(cat(null), 'teams');
  assert.equal(unread.unreadable, true);
  assert.equal(unread.connection, null);
  assert.equal(pageAction(unread).label, 'Status unreadable');
  assert.equal(teamsCapabilityRows(unread, undefined)[0].value, 'Unreadable');
  const refused = by(cat({ ...MS_ON, sync_error: 'connection_refused' }), 'teams');
  assert.equal(pageAction(refused).kind, 'reconnect', 'Microsoft refusing the grant is a sign-in to renew');
  assert.equal(teamsCapabilityRows(refused, undefined)[0].value, 'Reconnect required');
  assert.equal(by(cat({ ...MS_ON, sync_error: 'copy_refused' }), 'teams').connection.last_error, null, 'a refused copy is not a refused grant');
  assert.equal(teamsCapabilityRows(by(cat({ configured: false, connected: false }), 'teams'), undefined)[0].value, 'Not set up here');
});

test('Teams is listed only when the Worker describes it, and search finds it as Teams or Microsoft Teams', () => {
  assert.equal(by(cat(MS_ON, []), 'teams'), undefined, 'no card, no row');
  const teams = by(cat(MS_ON), 'teams');
  for (const q of ['teams', 'Teams', 'microsoft teams', 'MICROSOFT TEAMS']) assert.ok(matchesQuery(teams, q), q);
  assert.equal(teams.category, 'Calendar and workspace');
  assert.equal(teams.description, TEAMS_CARD.tagline);
});

test('the deep link: /account/connectors/teams draws its own row; microsoft stays its own page', () => {
  const data = { status: 'ready', catalogue: cat(MS_ON) };
  assert.equal(pageEntry({ data, key: 'teams' }).state, 'ready');
  assert.equal(pageEntry({ data, key: 'teams' }).p.display_name, 'Microsoft Teams');
  assert.equal(pageEntry({ data, key: 'microsoft' }).p.display_name, 'Microsoft 365');
  assert.equal(pageEntry({ data, key: 'microsoft_365' }).state, 'alias');
});

test('a sign-in from the Teams page is Microsoft’s, and its return lands back on the Teams page', async () => {
  const store = memoryStore();
  const seen = [];
  const client = { async microsoftCalConnect(body) { seen.push(body); return { auth_url: 'https://login.microsoftonline.com/x' }; } };
  const prev = globalThis.sessionStorage;
  globalThis.sessionStorage = store;
  try {
    assert.equal(await startFirstParty('teams', 'integrations', client), 'https://login.microsoftonline.com/x');
    assert.deepEqual(seen, [{ return_to: 'integrations' }]);
    assert.equal(takeSignInFrom(), 'teams');
    assert.equal(takeSignInFrom(), null, 'read once');
    await startFirstParty('microsoft', 'integrations', client);
    assert.equal(takeSignInFrom(), null, 'Microsoft 365’s own sign-in leaves no marker');
  } finally { globalThis.sessionStorage = prev; }
  const loc = { search: '?microsoft=connected', hash: '' };
  assert.equal(connectorsRedirect(loc, { from: 'teams' }).pathname, '/account/connectors/teams');
  assert.equal(connectorsRedirect(loc).pathname, '/account/connectors/microsoft');
  assert.equal(connectorsRedirect({ search: '?google=connected' }, { from: 'teams' }).pathname, '/account/connectors/google', 'only Microsoft’s return');
  assert.equal(pageReturn('?microsoft=connected', 'teams').ret.view, 'connected');
  assert.equal(pageReturn('?microsoft=error&reason=access_denied', 'teams').ret.view, 'cancelled');
  assert.equal(pageReturn('?google=connected', 'teams').ret, null);
});

test('the sign-in marker expires, names only Teams, and survives no garbage', () => {
  const store = memoryStore();
  markSignInFrom('teams', 1000, store);
  assert.equal(takeSignInFrom(1000 + 16 * 60_000, store), null, 'stale after fifteen minutes');
  markSignInFrom('linkedin', 1000, store);
  assert.equal(takeSignInFrom(1001, store), null);
  store.setItem('axal.connectors.signInFrom', '{not json');
  assert.equal(takeSignInFrom(1001, store), null);
  store.setItem('axal.connectors.signInFrom', JSON.stringify({ key: '__proto__', at: 1000 }));
  assert.equal(takeSignInFrom(1001, store), null);
});

test('disconnect says, before the click, that it ends the shared Microsoft connection', () => {
  const teams = by(cat(MS_ON), 'teams');
  assert.equal(disconnectNote(teams), SHARED_DISCONNECT);
  assert.equal(disconnectNote(by(cat(MS_ON), 'microsoft')), SHARED_DISCONNECT);
  assert.match(SHARED_DISCONNECT, /Microsoft Teams and Microsoft 365 share/);
});

test('the three rows: connection, creating a meeting and Eadwyn AI are separate, and never guessed', () => {
  const teams = by(cat(MS_ON), 'teams');
  const caps = (row) => ({ providers: { teams: { create_available: true, connected: true, can_create_meeting: true, can_join_as_bot: false, ...row } } });
  const values = (c, p = teams) => teamsCapabilityRows(p, c).map((r) => r.value);
  assert.deepEqual(values(undefined), ['Connected', 'Checking…', 'Checking…']);
  assert.deepEqual(values(null), ['Connected', 'Unreadable', 'Unreadable']);
  assert.deepEqual(values({}), ['Connected', 'Unreadable', 'Unreadable']);
  assert.deepEqual(values(caps({})), ['Connected', 'Available', 'Not available here']);
  assert.deepEqual(values(caps({ can_join_as_bot: true })), ['Connected', 'Available', 'Available']);
  assert.deepEqual(values(caps({ create_available: false, can_create_meeting: false })), ['Connected', 'Not available here', 'Not available here']);
  assert.deepEqual(values(caps({ connected: null, can_create_meeting: false })), ['Connected', 'Unreadable', 'Not available here']);
  assert.deepEqual(values(caps({ connected: false, can_create_meeting: false }), by(cat({ configured: true, connected: false }), 'teams')),
    ['Not connected', 'Connect first', 'Not available here']);
  assert.match(teamsCapabilityRows(teams, caps({}))[1].note, /work or school/);
});

const page = (props) => renderToStaticMarkup(h(MemoryRouter, null, h(TeamsSection, { p: by(cat(MS_ON), 'teams'), source: {}, ...props })));

test('the Teams section: shared-connection link, its rows, and Back to Record a session only for this member’s kept setup', () => {
  const caps = { providers: { teams: { create_available: true, connected: true, can_create_meeting: true, can_join_as_bot: true } } };
  const store = memoryStore();
  const prev = globalThis.sessionStorage;
  globalThis.sessionStorage = store;
  try {
    const plain = page({ initialCaps: caps, memberId: 7 });
    assert.match(plain, /href="\/account\/connectors\/microsoft"/);
    assert.match(plain, /data-testid="teams-row-create" data-value="Available"/);
    assert.match(plain, /data-testid="teams-row-bot" data-value="Available"/);
    assert.doesNotMatch(plain, /teams-record-return/);
    saveRecordDraft(7, { projectId: 10, interviewId: 4, name: 'A person', mode: 'video', provider: 'teams', link: 'https://teams.microsoft.com/l/meetup-join/x' }, undefined, store);
    const back = page({ initialCaps: caps, memberId: 7 });
    assert.match(back, /href="\/validate\/record\?project_id=10&amp;interview=4"/);
    assert.doesNotMatch(back, /meetup-join/, 'the meeting link is never in the page');
    saveRecordDraft(7, { projectId: 10, mode: 'video', provider: 'teams' }, undefined, store);
    assert.doesNotMatch(page({ initialCaps: caps, memberId: 8 }), /teams-record-return/, 'another member sees no way back into it');
    assert.match(page({ initialCaps: null, memberId: 8 }), /data-testid="teams-retry"/, 'an unreadable read offers Try again');
  } finally { globalThis.sessionStorage = prev; }
});

test('the local Teams mark on the card and the band; every other connector keeps BrandIcon', () => {
  const teams = renderToStaticMarkup(h(ConnectorMark, { p: { key: 'teams', display_name: 'Microsoft Teams' }, size: 56 }));
  assert.match(teams, /<img src="\/microsoft-teams\.ico" width="30" height="30"/);
  assert.doesNotMatch(renderToStaticMarkup(h(ConnectorMark, { p: { key: 'microsoft', display_name: 'Microsoft 365' } })), /microsoft-teams\.ico/);
});
