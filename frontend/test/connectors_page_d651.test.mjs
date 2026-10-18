/**
 * D651 (#1463) — the Connectors page: its rules (connectorsModel.js), the
 * section and Build's "Connect a tool" drawn in each state, the connector
 * sheet's views, and the doors: the user menu, the Account section, the
 * redirect from Integrations that keeps a provider's sign-in return, and
 * Build's header.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/connectors_page_d651.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import {
  agoLabel, attentionReason, authKind, buildCatalogue, cardAction, cardPill, categoryOf, companiesLabel,
  connectFailure, connectionStatus, connectorsRedirect, discoverSections, disconnectNote, doesLabel,
  feedsLabel, firstPartyConnection, flowBanner, lastSyncLabel, oauthReturn, pageOf, stripReturn, toolBanner,
  toolGroups, toolState, yoursRows,
} from '../src/pages/account/connectorsModel.js';
import { ConnectorsView, AddMenu, RequestSheet } from '../src/pages/account/AccountConnectors.jsx';
import { discoverFacets } from '../src/pages/account/discoverModel.js';
import { ConnectorPanel } from '../src/pages/account/ConnectorSheet.jsx';
import { ConnectToolView } from '../src/pages/account/ConnectToolSheet.jsx';

const read = (f) => readFileSync(resolve(process.cwd(), f), 'utf8');
const html = (el, entry = '/account/connectors') => renderToStaticMarkup(h(MemoryRouter, { initialEntries: [entry] }, el));
const text = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

const NOW = Date.parse('2026-10-09T12:00:00Z');
const P = (key, display_name, integration_type, status, tier, auth_type, extra = {}) => ({
  key, display_name, integration_type, status, tier, auth_type,
  description: `${display_name} description.`, capabilities: [`${display_name} cap one`, `${display_name} cap two`],
  docs_url: `https://example.test/${key}`, has_implementation: status !== 'coming_soon', locked_for_user: false, ...extra,
});
const PROVIDERS = [
  P('hubspot', 'HubSpot', 'crm', 'live', 'growth', 'oauth2', { supports_pat: true }),
  P('calendly', 'Calendly', 'scheduling', 'live', 'free', 'oauth2', { supports_pat: true }),
  P('salesforce', 'Salesforce', 'crm', 'coming_soon', 'studio', 'oauth2'),
  P('carta', 'Carta', 'cap_table', 'beta', 'studio', 'oauth2', { locked_for_user: true }),
  P('slack', 'Slack', 'messaging', 'beta', 'free', 'oauth2'),
  P('crunchbase', 'Crunchbase', 'data_feed', 'beta', 'growth', 'api_key'),
  P('stripe', 'Stripe', 'data_feed', 'live', 'growth', 'oauth2'),
  P('affinity', 'Affinity', 'crm', 'coming_soon', 'studio', 'api_key'),
];
const ITEMS = [
  { uid: 'u-stripe', provider_key: 'stripe', status: 'active', last_synced_at: '2026-10-09 11:48:00', last_error: null, config: {} },
  { uid: 'u-hub', provider_key: 'hubspot', status: 'error', last_synced_at: '2026-10-07 12:00:00', last_error: 'invalid_grant: token expired', config: {} },
  { uid: 'u-slack', provider_key: 'slack', status: 'active', last_synced_at: null, last_error: null, config: {} },
];
const FIRST = {
  google: { configured: true, connected: true, google_email: 'me@example.test' },
  microsoft: { configured: false, connected: false },
  linkedin: null,
};
const CAT = buildCatalogue({ providers: PROVIDERS, items: ITEMS, waitlist: [{ provider_key: 'affinity' }], firstParty: FIRST });
const byKey = (k) => CAT.find((p) => p.key === k);
const ready = (catalogue = CAT, extra = {}) => ({ status: 'ready', catalogue, items: [], itemsFailed: false, reload() {}, ...extra });

// ------------------------------------------------------------------ the rules

test('categories: the registry type in the canvas words, Stripe as Payments, and D650 category first', () => {
  assert.equal(categoryOf({ key: 'hubspot', integration_type: 'crm' }), 'CRM');
  assert.equal(categoryOf({ key: 'calendly', integration_type: 'scheduling' }), 'Calendar');
  assert.equal(categoryOf({ key: 'stripe', integration_type: 'data_feed' }), 'Payments');
  assert.equal(categoryOf({ key: 'crunchbase', integration_type: 'data_feed' }), 'Data');
  assert.equal(categoryOf({ key: 'x', integration_type: 'crm', category: 'Docs' }), 'Docs');
  assert.equal(categoryOf({ key: 'x', integration_type: 'custom' }), null, 'an unknown type is not guessed');
});

test('the catalogue joins connections, the waitlist, the plan lock and the first-party three', () => {
  assert.equal(byKey('stripe').connection.uid, 'u-stripe');
  assert.equal(byKey('calendly').connection, null);
  assert.equal(byKey('affinity').joined, true);
  assert.equal(byKey('salesforce').joined, false);
  assert.equal(byKey('carta').locked, true);
  assert.equal(byKey('stripe').locked, false);
  assert.equal(byKey('salesforce').available, false);
  assert.equal(byKey('crunchbase').available, true);
  assert.equal(byKey('google').connection.external_account_name, 'me@example.test');
  assert.equal(byKey('google').available, true);
  assert.equal(byKey('microsoft').available, false, 'not configured on this deployment');
  assert.equal(byKey('microsoft').connection, null);
  assert.equal(byKey('linkedin').unreadable, true, 'an unread status is not "not connected"');
  assert.equal(byKey('linkedin').available, false);
  assert.equal(firstPartyConnection('google', { connected: false }), null);
  // A registry entry for a first-party key (D650) wins over the built-in one.
  const dup = buildCatalogue({ providers: [P('google', 'Google (registry)', 'scheduling', 'live', 'free', 'oauth2')], firstParty: {} });
  assert.equal(dup.filter((p) => p.key === 'google').length, 1);
  assert.equal(dup.find((p) => p.key === 'google').display_name, 'Google (registry)');
});

test('status: the Worker’s error says why it needs attention, and only a real error does', () => {
  assert.equal(attentionReason({ status: 'active', last_error: null }), '');
  assert.equal(attentionReason({ status: 'error', last_error: 'invalid_grant: token expired' }), 'Sign-in expired');
  assert.equal(attentionReason({ status: 'error', last_error: 'HTTP 401 from provider' }), 'Sign-in expired');
  assert.equal(attentionReason({ status: 'active', last_error: 'rate_limited:1760000000000' }), 'Daily limit reached');
  assert.equal(attentionReason({ status: 'error', last_error: 'timeout' }), 'Last sync failed');
  assert.equal(attentionReason({ status: 'error', last_error: null }), 'Last sync failed');
  assert.equal(attentionReason({ status: 'paused', last_error: null }), '');
  assert.deepEqual(connectionStatus(ITEMS[0], byKey('stripe')), { label: 'Connected', tone: 'ok', why: '' });
  assert.deepEqual(connectionStatus(ITEMS[1], byKey('hubspot')), { label: 'Needs attention', tone: 'warn', why: 'Sign-in expired' });
  assert.equal(connectionStatus(ITEMS[2], byKey('slack')).label, 'Beta');
  assert.equal(connectionStatus({ status: 'paused' }, byKey('stripe')).label, 'Paused');
  assert.equal(connectionStatus(ITEMS[0], byKey('stripe'), { syncing: true }).label, 'Syncing');
  assert.equal(connectionStatus(null, byKey('stripe')), null);
});

test('a field the registry does not carry yet is null, never a guess; D650’s fields fill it', () => {
  const stripe = byKey('stripe');
  assert.equal(doesLabel(stripe), null);
  assert.equal(feedsLabel(stripe), null);
  assert.equal(companiesLabel(stripe.connection), null);
  assert.equal(doesLabel({ pulls: [{ what: 'Charges' }], sends: [] }), 'Pulls in');
  assert.equal(doesLabel({ pulls: [], sends: [{ what: 'Leads' }] }), 'Sends out');
  assert.equal(doesLabel({ pulls: [{ what: 'Deals' }], sends: [{ what: 'Leads' }] }), 'Both');
  assert.equal(doesLabel({ pulls: [], sends: [] }), null);
  assert.equal(feedsLabel({ feeds: ['revenue_traction', { key: 'customers', label: 'Customers' }] }), 'Revenue traction, Customers');
  assert.equal(companiesLabel({ companies: [{ company_id: 1 }, { company_id: 2, enabled: false }, { company_id: 3 }] }), '2 of 3');
  assert.equal(companiesLabel({ companies: [{ company_id: 1 }, { company_id: 2 }] }), 'All');
});

test('last sync: relative, and "Not recorded · never ran" when it never ran', () => {
  assert.equal(lastSyncLabel(ITEMS[0], NOW), '12 min ago');
  assert.equal(lastSyncLabel({ last_synced_at: '2026-10-09T09:00:00Z' }, NOW), '3 h ago');
  assert.equal(lastSyncLabel(ITEMS[1], NOW), '2 days ago');
  assert.equal(agoLabel('2026-10-08T11:00:00Z', NOW), '1 day ago');
  assert.equal(agoLabel('2026-10-09T11:59:30Z', NOW), 'just now');
  assert.equal(lastSyncLabel(ITEMS[2], NOW), 'Not recorded · never ran');
  assert.equal(agoLabel('not a date', NOW), null);
});

test('Yours: search, filter, sort, and a count with pages', () => {
  const names = (rows) => rows.map((r) => r.p.key);
  assert.deepEqual(names(yoursRows(CAT)), ['google', 'hubspot', 'slack', 'stripe']);
  assert.deepEqual(names(yoursRows(CAT, { filter: 'attention' })), ['hubspot']);
  assert.deepEqual(names(yoursRows(CAT, { filter: 'connected' })), ['google', 'slack', 'stripe']);
  assert.deepEqual(names(yoursRows(CAT, { filter: 'paused' })), []);
  assert.deepEqual(names(yoursRows(CAT, { q: 'pay' })), ['stripe'], 'the category is searched');
  assert.deepEqual(names(yoursRows(CAT, { sort: 'status' })), ['hubspot', 'google', 'slack', 'stripe']);
  assert.deepEqual(names(yoursRows(CAT, { sort: 'sync' })), ['stripe', 'hubspot', 'google', 'slack']);
  assert.equal(pageOf(yoursRows(CAT), 1).count, '1–4 of 4');
  const many = Array.from({ length: 23 }, (_, i) => i);
  assert.deepEqual(pageOf(many, 3), { rows: [20, 21, 22], page: 3, pages: 3, count: '21–23 of 23' });
  assert.equal(pageOf(many, 9).page, 3, 'a page past the end lands on the last');
  assert.equal(pageOf([], 1).count, '0 of 0');
});

test('Discover: the categories, the sections, and each card’s corner and pill', () => {
  assert.deepEqual(discoverFacets(CAT, []).categories.map((r) => r.label), ['CRM', 'Payments', 'Calendar', 'Calendar and workspace', 'Messaging', 'Cap table', 'Data'], 'Google Calendar and Microsoft 365 sit in Calendar and workspace (D686 §3.1 item 6)');
  const all = discoverSections(CAT, 'All');
  assert.deepEqual(all.map((s) => s.title), ['Top connectors', 'Coming soon']);
  assert.deepEqual(all[1].cards.map((p) => p.key), ['salesforce', 'affinity']);
  assert.ok(all[0].cards.some((p) => p.key === 'microsoft'), 'a connector this deployment cannot connect stays listed, with its reason');
  assert.ok(!all[0].cards.some((p) => p.key === 'salesforce'));
  assert.deepEqual(discoverSections(CAT, 'CRM')[0].cards.map((p) => p.key), ['hubspot', 'salesforce', 'affinity']);
  assert.deepEqual(discoverSections(CAT, 'Suggested for you'), [{ title: 'Suggested for you', cards: null }], 'no suggestion is invented before D650');
  const sug = discoverSections(CAT, 'Suggested for you', { suggestions: [{ key: 'crunchbase', reason: 'Research has no funding data yet.' }, { key: 'nope' }] });
  assert.deepEqual(sug[0].cards.map((p) => [p.key, p.why]), [['crunchbase', 'Research has no funding data yet.']]);
  assert.equal(cardAction(byKey('calendly')), 'add');
  assert.equal(cardAction(byKey('stripe')), 'connected');
  assert.equal(cardAction(byKey('salesforce')), 'notify');
  assert.equal(cardAction(byKey('affinity')), 'joined');
  assert.equal(cardAction(byKey('microsoft')), 'unavailable');
  assert.deepEqual(cardPill(byKey('salesforce')), { label: 'Coming soon', tone: 'neutral' });
  assert.deepEqual(cardPill(byKey('carta')), { label: 'Studio', tone: 'info' });
  assert.deepEqual(cardPill(byKey('crunchbase')), { label: 'Beta', tone: 'info' });
  assert.equal(cardPill(byKey('stripe')), null);
});

test('a provider’s sign-in return: which sheet opens, on which view, and what is stripped', () => {
  assert.deepEqual(oauthReturn('?oauth=ok&provider=HubSpot'), { key: 'hubspot', view: 'connected', reason: '', banner: '', strip: ['oauth', 'provider', 'reason'] });
  assert.equal(oauthReturn('?oauth=error&provider=stripe&reason=access_denied').view, 'cancelled');
  assert.equal(oauthReturn('?oauth=error&provider=stripe&reason=overreach').view, 'overreach');
  assert.deepEqual(oauthReturn('?oauth=error&provider=stripe&reason=server_error'), { key: 'stripe', view: 'refused', reason: 'server_error', banner: '', strip: ['oauth', 'provider', 'reason'] });
  assert.equal(oauthReturn('?oauth=rolling_out&provider=carta').banner, 'rolling_out');
  assert.equal(oauthReturn('?oauth=ok'), null, 'a return that names no provider opens nothing');
  assert.equal(oauthReturn('?google=connected').view, 'connected');
  assert.match(oauthReturn('?google=connected&warn=google_email_mismatch&google_email=a%40b.test').banner, /a@b\.test doesn't match your StudioOS email/);
  assert.match(oauthReturn('?google=error&reason=email_mismatch&google_email=a%40b.test').banner, /That Google account \(a@b\.test\) doesn't match/);
  for (const r of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    assert.equal(oauthReturn(`?google=error&reason=${r}`).banner, '', `reason=${r} reaches no inherited method`);
  }
  assert.deepEqual(oauthReturn('?microsoft=connected'), { key: 'microsoft', view: 'connected', reason: '', banner: '', strip: ['microsoft', 'warn', 'google_email', 'reason'] });
  assert.equal(oauthReturn('?microsoft=error&reason=timeout').view, 'refused');
  assert.equal(oauthReturn('?linkedin=error&linkedin_error=oauth_denied').view, 'cancelled');
  assert.equal(oauthReturn('?linkedin=connected').key, 'linkedin');
  assert.equal(oauthReturn('?tab=x'), null);
  assert.equal(stripReturn('?oauth=ok&provider=stripe&keep=1', ['oauth', 'provider', 'reason']), '?keep=1');
  assert.equal(stripReturn('?oauth=ok&provider=stripe', ['oauth', 'provider']), '');
});

test('THE REDIRECT KEEPS OAUTH RETURNS WORKING: /integrations?… lands on its connector\'s page with its query (D753)', () => {
  // Every place a provider's sign-in returns to, as the Worker writes it.
  // D686 (#1592): the connector callback returns through one destination,
  // read from the signed state. It is still /integrations unless that state
  // says build, so every legacy return below keeps landing here.
  const integrations = read('cloudflare-worker/src/routes/integrations.ts');
  const base = integrations.match(/export function returnBase\(extra: [^)]*\): string \{\n([\s\S]*?)\n\}/);
  assert.ok(base, 'integrations.ts defines returnBase(extra)');
  const returnBase = new Function('extra', base[1]);
  for (const extra of [undefined, null, {}, { return_to: 'integrations' }, { return_to: 'https://evil.example' }, { return_to: '/x' }, { return_to: 'BUILD' }]) {
    assert.equal(returnBase(extra), '/integrations', `${JSON.stringify(extra)} returns to /integrations`);
  }
  assert.equal(returnBase({ return_to: 'build' }), '/build/connect');
  // #1597: each redirect goes through returnQuery(consumed?.extra, …), which adds Build's venture from the same signed state.
  assert.match(integrations, /c\.redirect\(returnQuery\(consumed\?\.extra, `oauth=ok&provider=\$\{encodeURIComponent\(provider\)\}`\)\)/);
  assert.match(integrations, /return `\$\{returnBase\(extra\)\}\?\$\{outcome\}\$\{venture\}`;/);
  // Every callback redirect (ok, provider error, company not linked,
  // rolling out, scope overreach, a failed connect) goes through it.
  const redirects = integrations.match(/c\.redirect\([^\n]*/g) || [];
  assert.equal(redirects.length, 6, 'the six callback redirects');
  for (const r of redirects) assert.match(r, /^c\.redirect\(returnQuery\(consumed\?\.extra, `oauth=(ok|error|rolling_out)&provider=\$\{encodeURIComponent\(provider\)\}/, r);
  for (const reason of ['company_not_linked', 'scope_overreach']) {
    assert.ok(redirects.some(r => r.includes(`&reason=${reason}\``)), `${reason} redirects through the destination`);
  }
  assert.ok(redirects.some(r => r.includes('`oauth=rolling_out&')), 'rolling_out redirects through the destination');
  const calendar = read('cloudflare-worker/src/routes/calendar.ts');
  assert.match(calendar, /returnTo === 'integrations' \? `\$\{base\}\/integrations`/);
  assert.match(calendar, /parseReturn\(returnTo\)\.kind === 'build' \? `\$\{base\}\/build\/connect`/);
  const linkedin = read('cloudflare-worker/src/routes/linkedin.ts');
  assert.match(linkedin, /returnTo === 'integrations' \? '\/integrations'/);
  assert.match(linkedin, /kind === 'build' \? '\/build\/connect'/);
  for (const [search, key] of [['?oauth=ok&provider=stripe', 'stripe'], ['?google=connected', 'google'], ['?microsoft=connected', 'microsoft'], ['?linkedin=connected', 'linkedin']]) {
    const to = connectorsRedirect({ search, hash: '#x' });
    // D753 decision 6: each return goes to its own connector's page.
    assert.deepEqual(to, { pathname: `/account/connectors/${key}`, search, hash: '#x' });
    assert.equal(oauthReturn(to.search).view, 'connected', `${search} still opens the connected view`);
  }
  // Both old addresses route through it, and ask for the once-only notice.
  const app = read('frontend/src/App.jsx');
  assert.match(app, /<Navigate to=\{connectorsRedirect\(loc\)\} state=\{\{ connectorsMoved: true \}\} replace \/>/);
  assert.match(app, /<Route path="\/integrations" element=\{authOnly\(<IntegrationsRedirect \/>\)\} \/>/);
  assert.match(app, /<Route path="\/account\/integrations" element=\{authOnly\(<IntegrationsRedirect \/>\)\} \/>/);
  // The section reads the return from the address it lands on, and strips it.
  const section = read('frontend/src/pages/account/AccountConnectors.jsx');
  assert.match(section, /const \[ret\] = useState\(\(\) => oauthReturn\(location\.search\)\);/);
  assert.match(section, /search: stripReturn\(location\.search, ret\.strip\)/);
  // D753 — any other return goes on to its connector's page.
  assert.match(section, /navigate\(\{ pathname: connectorPagePath\(ret\.key\), search: location\.search, hash: location\.hash \}, \{ replace: true, state: location\.state \}\)/);
});

test('the connect flow: how each connector connects, where a failure lands, and what each state says', () => {
  assert.equal(authKind(byKey('crunchbase')), 'key');
  assert.equal(authKind(byKey('hubspot')), 'token_first');
  assert.equal(authKind(byKey('calendly')), 'oauth');
  assert.equal(authKind(byKey('google')), 'first_party');
  assert.equal(connectFailure({ status: 402 }, byKey('stripe')), 'pro');
  assert.equal(connectFailure({ status: 400, code: 'connect_failed' }, byKey('crunchbase')), 'badkey');
  assert.equal(connectFailure({ status: 400, code: 'connect_failed' }, byKey('hubspot')), 'badkey');
  assert.equal(connectFailure({ status: 400, code: 'connect_failed' }, byKey('stripe')), 'refused', 'an OAuth connector has no key to be bad');
  assert.equal(connectFailure({ status: 503, code: 'coming_soon' }, byKey('crunchbase')), 'refused');
  assert.equal(flowBanner('cancelled', 'HubSpot'), 'The sign-in was cancelled. Nothing was connected.');
  assert.equal(flowBanner('refused', 'HubSpot'), 'HubSpot refused access. Ask your HubSpot admin to allow Axal StudioOS, or try again.');
  assert.equal(flowBanner('refused', 'HubSpot', { reason: 'server_error' }), 'HubSpot refused access. (server_error) Ask your HubSpot admin to allow Axal StudioOS, or try again.');
  assert.equal(flowBanner('refused', 'Carta', { banner: 'rolling_out' }), 'Carta is still rolling out. Nothing was connected.');
  assert.equal(flowBanner('refused', 'Google', { banner: 'Custom words.' }), 'Custom words.');
  assert.equal(flowBanner('badkey', 'Crunchbase'), 'That key is not valid. Check it at Crunchbase and paste it again.');
  assert.equal(flowBanner('overreach', 'X'), 'This sign-in asked for more than StudioOS uses. Nothing was connected. Report it, or try again.');
  assert.equal(disconnectNote(byKey('stripe')), 'Data already in StudioOS stays. The stored credentials are deleted.');
  assert.match(disconnectNote(byKey('google')), /"Continue with Google" sign-in is unlinked/);
});

test('Build’s tools: grouped by category, filtered, with the failing banner before the locked one', () => {
  assert.equal(toolState(byKey('hubspot')), 'failing');
  assert.equal(toolState(byKey('stripe')), 'connected');
  assert.equal(toolState(byKey('calendly')), 'not_connected');
  assert.equal(toolState(byKey('salesforce')), 'soon');
  assert.equal(toolState(byKey('microsoft')), 'unavailable');
  const all = toolGroups(CAT);
  assert.deepEqual(all.groups.map((g) => g.label), ['Payments', 'CRM', 'Calendar and workspace', 'Calendar', 'Messaging', 'Cap table', 'Data'], 'Build\'s order (D686 §5.4), not the Connectors chips\'');
  assert.deepEqual(toolGroups(CAT, { pin: 'Cap table' }).groups.map((g) => g.label)[0], 'Cap table', 'the failing tool\'s group first');
  assert.deepEqual(toolGroups(CAT, { pin: 'Nowhere' }).groups.map((g) => g.label), all.groups.map((g) => g.label), 'an absent pin changes nothing');
  assert.equal(all.total, CAT.length);
  assert.deepEqual(toolGroups(CAT, { filter: 'Failing' }).groups.map((g) => g.rows.map((p) => p.key)), [['hubspot']]);
  assert.deepEqual(toolGroups(CAT, { filter: 'Connected' }).groups.flatMap((g) => g.rows.map((p) => p.key)), ['stripe', 'google', 'slack']);
  assert.equal(toolGroups(CAT, { q: 'zzz' }).total, 0);
  const failed = toolBanner(CAT);
  assert.equal(failed.view, 'failed');
  assert.match(failed.text, /^HubSpot: sign-in expired\. The last good sync was \d+ days? ago; what it feeds keeps the last good data\.$/);
  const noFail = CAT.filter((p) => p.key !== 'hubspot');
  assert.deepEqual(toolBanner(noFail), { tone: 'neutral', view: 'locked', text: 'Cap table connections are part of the Studio plan. Free keeps every tool you have already connected.' });
  assert.equal(toolBanner(noFail.filter((p) => p.key !== 'carta')), null);
});

// ------------------------------------------------------------------ the screens

test('yours: the table with every column, a Needs-attention reason, and the count', () => {
  const out = html(h(ConnectorsView, { data: ready() }));
  const t = text(out);
  assert.match(out, /data-tab="yours"/);
  assert.match(t, /Connector Category Does Feeds Companies Last sync Status/);
  assert.match(out, /data-testid="connector-row-hubspot"/);
  // D753 F6: the grey line names who made it only when the Worker says so (`made_by`), never "by <the provider>".
  assert.match(t, /HubSpot CRM Not recorded Not recorded Not recorded \d+ days? ago Needs attention Sign-in expired/);
  assert.match(t, /Slack Messaging Not recorded Not recorded Not recorded Not recorded · never ran Beta/);
  assert.doesNotMatch(t, /HubSpot by HubSpot|Slack by Slack/);
  assert.match(t, /1–4 of 4/);
  assert.doesNotMatch(out, /connector-row-calendly/, 'only the member’s connectors are listed');
  assert.match(t, /Bring your tools into StudioOS, and send your work back to them\./);
});

test('yoursEmpty, loading, unreadable, noresults and an unread connection list each say their sentence', () => {
  const none = buildCatalogue({ providers: PROVIDERS, items: [], firstParty: {} });
  assert.match(text(html(h(ConnectorsView, { data: ready(none) }))), /No connectors yet\. Connect Stripe to see your revenue, or your calendar to book interviews\. Browse connectors/);
  assert.match(text(html(h(ConnectorsView, { data: { status: 'loading', catalogue: [], reload() {} } }))), /Loading connectors…/);
  assert.match(text(html(h(ConnectorsView, { data: { status: 'unreadable', catalogue: [], reload() {} } }))), /The catalogue could not be read\. This is not a claim that you have no connectors\./);
  assert.match(text(html(h(ConnectorsView, { data: ready(), initialQuery: 'Notion' }))), /No connector called ‘Notion’\. Request it\./);
  assert.match(text(html(h(ConnectorsView, { data: ready(CAT, { itemsFailed: true }) }))), /Your connections could not be read\. This is not a claim that you have none\./);
});

test('discover and discoverCat: the filter, sections, corners, the Notify-me state and the Coming-soon pill', () => {
  const out = html(h(ConnectorsView, { data: ready(), initialTab: 'discover' }));
  const t = text(out);
  assert.match(out, /data-testid="button-connectors-filter"/);
  assert.doesNotMatch(out, /connectors-chips/);
  assert.match(t, /Top connectors \d+[\s\S]*Coming soon 2/);
  assert.match(out, /data-testid="connector-card-calendly" data-action="add"/);
  assert.match(out, /data-testid="connector-card-stripe" data-action="connected"/);
  assert.match(out, /data-testid="connector-card-salesforce" data-action="notify"[\s\S]*?Notify me/);
  assert.match(out, /data-testid="connector-card-affinity" data-action="joined"[\s\S]*?We&#x27;ll tell you/);
  assert.match(out, /data-testid="connector-card-microsoft" data-action="unavailable"[\s\S]*?Not set up here/);
  assert.match(out, /data-testid="connector-card-microsoft"/, 'Microsoft, the 8th of 9 Top cards, is shown before Show all');
  assert.doesNotMatch(out, /data-testid="connector-card-linkedin"/, 'the 9th waits for Show all');
  assert.match(out, /data-testid="button-connectors-show-all"[^>]*>Show all →/);
  assert.match(out, /data-testid="connector-community-telegram"/);
  const crm = text(html(h(ConnectorsView, { data: ready(), initialTab: 'discover', initialFilter: { where: 'category:CRM', type: 'all' } })));
  assert.match(crm, /CRM 3/);
  assert.doesNotMatch(crm, /Stripe/);
  const sug = text(html(h(ConnectorsView, { data: ready(), initialTab: 'discover', initialFilter: { where: 'all', type: 'suggested' } })));
  assert.match(sug, /Not recorded · Suggestions could not be read\./, 'no suggestion is invented when the read fails');
  const none = text(html(h(ConnectorsView, { data: { ...ready(), suggestions: null, suggestionsNote: 'Choose a company in the sidebar to see what its empty modules could be fed by.' }, initialTab: 'discover', initialFilter: { where: 'all', type: 'suggested' } })));
  assert.match(none, /Not recorded · Choose a company in the sidebar/);
  const got = html(h(ConnectorsView, { data: { ...ready(), suggestions: [{ provider_key: 'calendly', module: 'customer_research', reason: 'Customer research has no recorded interviews yet.' }] }, initialTab: 'discover', initialFilter: { where: 'all', type: 'suggested' } }));
  assert.match(got, /data-testid="connector-card-calendly"/);
  assert.match(text(got), /Suggested for you 1 .*Customer research has no recorded interviews yet\./);
  assert.match(text(html(h(ConnectorsView, { data: { ...ready(), suggestions: [] }, initialTab: 'discover', initialFilter: { where: 'all', type: 'suggested' } }))), /Nothing to suggest/);
});

test('moved: the notice shows on an arrival from Integrations, and not otherwise', () => {
  const moved = html(h(ConnectorsView, { data: ready() }), { pathname: '/account/connectors', state: { connectorsMoved: true } });
  assert.match(moved, /data-testid="connectors-moved"[^>]*>Integrations are now Connectors\./);
  assert.doesNotMatch(html(h(ConnectorsView, { data: ready() })), /Integrations are now Connectors/);
  const section = read('frontend/src/pages/account/AccountConnectors.jsx');
  assert.match(section, /if \(window\.localStorage\.getItem\(MOVED_SEEN_KEY\)\) return false;\s*window\.localStorage\.setItem\(MOVED_SEEN_KEY, '1'\);/, 'once: remembered the first time it shows');
});

test('add and request: the Add menu’s three entries, custom shown as Pro and Coming soon, and an honest form', () => {
  const add = text(html(h(AddMenu, { onBrowse() {}, onRequest() {}, initialOpen: true })));
  assert.match(add, /Browse connectors Request a connector Add a custom connector PRO Coming soon/);
  assert.match(html(h(AddMenu, { onBrowse() {}, onRequest() {}, initialOpen: true })), /<button type="button" role="menuitem" class="[^"]*" disabled="" title="The Worker has no MCP client yet\.">Add a custom connector/);
  const req = html(h(RequestSheet, { onClose() {}, tool: 'Notion' }));
  assert.match(text(req), /Request a connector Tell us which tool you need\. .*Tool name .*What you would use it for/);
  assert.match(req, /value="Notion"/);
  assert.match(req, /disabled="" data-testid="button-send-request">Send request/, 'Send waits for both fields');
  assert.doesNotMatch(text(req), /not stored/);
});

const panel = (key, view, extra = {}) => text(html(h(ConnectorPanel, { p: byKey(key), view, setView() {}, onClose() {}, ...extra })));

test('sheetStripe and sheetHubspot: what it does, permissions, companies, sync, activity, and Disconnect with what happens', () => {
  const stripe = panel('stripe', 'detail');
  assert.match(stripe, /Stripe by Stripe · Connected/);
  assert.match(stripe, /What it does Stripe cap one Stripe cap two Which modules it fills Not recorded/);
  assert.match(stripe, /Permissions Not recorded in plain words The provider's own sign-in screen lists what it grants\./);
  assert.match(stripe, /Companies Not recorded Now fed by Stripe/, 'companies unread: not recorded, never a guess');
  assert.match(stripe, /Sync How often Live \(the default\) Last sync \d+ (min|h) ago|Sync How often Live \(the default\) Last sync \d+ days? ago/);
  assert.match(stripe, /Sync now/);
  assert.match(stripe, /Activity/);
  assert.match(stripe, /Data already in StudioOS stays\. The stored credentials are deleted\. Disconnect/);
  assert.doesNotMatch(stripe, /Reconnect/);
  const freq = (f) => text(html(h(ConnectorPanel, { p: { ...byKey('stripe'), connection: { ...byKey('stripe').connection, config: { sync_frequency: f } } }, view: 'detail', setView() {}, onClose() {} })));
  assert.match(freq('hourly'), /How often Hourly/);
  assert.match(freq('constructor'), /How often Not recorded/, 'a settings value is looked up only among the map’s own keys');
  const hub = panel('hubspot', 'detail');
  assert.match(hub, /HubSpot by HubSpot · Needs attention/);
  assert.match(hub, /Sign-in expired\. The last good sync was \d+ days? ago\. HubSpot said: invalid_grant: token expired/);
  assert.match(hub, /Settings Pipeline Default pipeline Change Access token Stored encrypted Replace/);
  assert.match(hub, /Reconnect Disconnect/);
  // D650's fields, when present, are drawn instead of "Not recorded".
  const rich = { ...byKey('stripe'), pulls: [{ what: 'Charges', module: 'Revenue and traction' }], sends: [], permissions: ['Read your charges'] };
  const out = text(html(h(ConnectorPanel, { p: rich, view: 'detail', setView() {}, onClose() {} })));
  assert.match(out, /What it pulls in Charges → Revenue and traction What it sends out Nothing Stripe only pulls in\. Permissions Read your charges Granted/);
});

test('the connect flow’s views: pre, signin, key, connected, and each state', () => {
  const pre = panel('calendly', 'pre');
  assert.match(pre, /Connect Calendly Before you sign in, here is what StudioOS will do\./);
  assert.match(pre, /1 · What it uses 2 · Sign in 3 · Connected/);
  assert.match(pre, /What it does Calendly cap one/);
  assert.match(pre, /It will serve Your active company Once connected, choose the other companies it feeds from its sheet\./);
  assert.match(pre, /Use a personal access token instead/);
  assert.match(pre, /Cancel Continue to Calendly/);
  assert.match(panel('crunchbase', 'pre'), /1 · What it uses 2 · Key 3 · Connected[\s\S]*Cancel Continue\s*$/);
  assert.match(panel('stripe', 'signin'), /Sign in to Stripe Stripe is opening\. StudioOS never sees your password\./);
  const key = html(h(ConnectorPanel, { p: byKey('crunchbase'), view: 'key', setView() {}, onClose() {} }));
  assert.match(text(key), /Crunchbase Basic user key\..*Daily Basic quota is 200 calls\..*Crunchbase user key/);
  assert.match(key, /data-testid="crunchbase-user-key"/);
  assert.match(text(key), /Stored encrypted\. StudioOS never shows it again\. Where to find it/);
  assert.match(text(panel('hubspot', 'key')), /Replace the token for HubSpot/, 'a connected HubSpot replaces its token');
  const connected = panel('stripe', 'connected');
  assert.match(connected, /Stripe is connected .*3 · Connected Now fed by Stripe .*Done/, 'a connection with a uid reads what it delivered');
  const noUid = { ...byKey('stripe'), connection: null };
  assert.match(text(html(h(ConnectorPanel, { p: noUid, view: 'connected', setView() {}, onClose() {} }))), /Now fed by Stripe Not recorded The first sync runs in the background\./);
  const fed = text(html(h(ConnectorPanel, { p: { ...noUid, feeds: ['revenue_traction', 'customers'] }, view: 'connected', setView() {}, onClose() {} })));
  assert.match(fed, /Now fed by Stripe Revenue traction Customers Done/, 'the registry’s feeds are listed before the first read');
  assert.match(panel('google', 'connected', { ret: { banner: 'Connected, but not linked.' } }), /Connected, but not linked\./);
  assert.match(panel('stripe', 'cancelled'), /The sign-in was cancelled\. Nothing was connected\. .*Close Try again/);
  assert.match(panel('stripe', 'refused'), /Stripe refused access\. Ask your Stripe admin to allow Axal StudioOS, or try again\./);
  assert.match(panel('crunchbase', 'badkey'), /That key is not valid\. Check it at Crunchbase and paste it again\./);
  assert.match(panel('stripe', 'overreach'), /asked for more than StudioOS uses\. .*Report Try again/);
  const pro = panel('carta', 'pro');
  assert.match(pro, /Carta by Carta · Beta Carta is part of the Studio plan\./);
  assert.match(pro, /Close See plans/);
  assert.match(pro, /Studio plan\. Free keeps every connector you already have\./, 'since #1611 sync has no tier gate, so the canvas’s promise is true and printed');
});

test('Build’s "Connect a tool": list, failed, locked and loading', () => {
  const out = html(h(ConnectToolView, { data: ready(), onClose() {} }));
  const t = text(out);
  assert.match(t, /Build Connect a tool Connected tools fill your modules with real data\. Each one says what it feeds\./);
  assert.match(out, /data-testid="connect-tool-failed"/);
  assert.match(t, /All Connected Not connected Failing Sorted by category · 1–\d+ of \d+/);
  // D687: a row's tile sits before its name; Affinity's is its recorded monogram, HubSpot's its mark.
  assert.match(t, /CRM A Affinity .*Coming soon HubSpot Sign-in expired · last good sync \d+ days? ago Failing Reconnect/);
  assert.match(t, /Microsoft 365 Calendar, Two-way sync Not set up here/);
  assert.match(t, /LinkedIn .* Status unreadable/);
  assert.match(t, /Salesforce What it will feed is not recorded Coming soon/, 'D686 §5.4: a coming-soon row says what it will feed, or that it is not recorded');
  assert.match(t, /Sorted by category · 1–\d+ of \d+ CRM /, 'the failing tool\'s group first while the failed banner shows');
  assert.match(t, /Payments Stripe Stripe cap one, Stripe cap two · synced \d+ (min|h|days?) ago Connected Disconnect/, 'D686 §3.1 item 2: a connected row offers Disconnect');
  assert.match(t, /Cap table C Carta Carta cap one, Carta cap two Studio Upgrade to Studio/, 'the real tier, never "Pro"');
  assert.match(t, /Calendar Calendly .* Not connected Connect/);
  assert.match(t, /Google Calendar Calendar, Gmail invites · last sync not recorded Connected Disconnect/);
  const locked = html(h(ConnectToolView, { data: ready(CAT.filter((p) => p.key !== 'hubspot')), onClose() {} }));
  assert.match(locked, /data-testid="connect-tool-locked"[^>]*>Cap table connections are part of the Studio plan\. Free keeps every tool you have already connected\./);
  assert.match(text(html(h(ConnectToolView, { data: { status: 'loading', catalogue: [], reload() {} }, onClose() {} }))), /Loading tools…/);
});

// ------------------------------------------------------------------ the doors

test('the doors: the user menu under Usage, the Account section after Usage, and Build’s header', () => {
  const app = read('frontend/src/App.jsx');
  const menu = app.slice(app.indexOf('function UserDropdown('), app.indexOf('Log Out', app.indexOf('function UserDropdown(')));
  assert.match(menu, /Usage\s*<\/Link>\s*\{\/\*[^*]*\*\/\}\s*<Link to="\/account\/connectors"[\s\S]*?Connectors\s*<\/Link>\s*<Link to="\/trust"/, 'Connectors, right under Usage');
  const settings = read('frontend/src/pages/SettingsPage.jsx');
  assert.match(settings, /\{ id: 'usage', label: 'Usage' \},\n(?:\s*\/\/[^\n]*\n)*\s*\{ id: 'connectors', label: 'Connectors' \},/);
  assert.doesNotMatch(settings, /id: 'integrations'/, 'Integrations left the section list');
  // D753 — a connector's key opens its page; the hub keeps the section and the API-keys card.
  assert.match(settings, /\{safeActive === 'connectors' && <ConnectorsTab connectorKey=\{connectorKey\} \/>\}/);
  assert.match(settings, /function ConnectorsTab\(\{ connectorKey = null \}\) \{\s*return connectorKey \? <ConnectorPage connectorKey=\{connectorKey\} \/> : <ConnectorsHubTab \/>;/);
  assert.match(settings, /function ConnectorsHubTab\(\) \{[\s\S]*?<ConnectorsSection \/>\s*<Card title="API keys"/);
  // Build's header is the Build cycle overview's primary action since the A3
  // desk retired (D661, #1474): "Connect a tool" opens the same sheet, now at
  // /build/connect over the page (D686 §5.1), mounted by the one lightbox mount.
  const build = read('frontend/src/pages/cycles/CycleRoute.jsx');
  const def = build.slice(build.indexOf('\n  build: {'), build.indexOf('\n};', build.indexOf('\n  build: {')));
  assert.match(def, /path: 'connect',\s*Mount: BuildMount,\s*action: \(q, open\) => \(\{ label: 'Connect a tool', href: `\/build\/connect\$\{q\}`, onOpen: open \}\),/);
  // D686 §5.4 (#1597): the sheet connects for the project's company and tells the page a tool changed.
  assert.match(build, /function BuildMount\(\{ projectId, onClose, onChanged, asPage \}\) \{\s*return <ConnectToolSheet projectId=\{projectId\} onClose=\{onClose\} onChanged=\{onChanged\} asPage=\{asPage\} \/>;/);
  assert.match(build, /import ConnectToolSheet from '\.\.\/account\/ConnectToolSheet';/);
  assert.match(build, /\{lightbox && Mount && projectId && \(\s*<Mount projectId=\{projectId\} q=\{q\} searchParams=\{searchParams\} onClose=\{closeAction\}/);
});

test('IntegrationsPage.jsx is retired, and nothing in the app links to the old addresses', () => {
  assert.equal(existsSync(resolve(process.cwd(), 'frontend/src/pages/IntegrationsPage.jsx')), false);
  for (const f of ['frontend/src/pages/SettingsPage.jsx', 'frontend/src/pages/ProjectDetail.jsx', 'frontend/src/pages/CapTablePage.jsx', 'frontend/src/pages/admin/consoles/PartnerProfilesConsole.jsx']) {
    const src = read(f);
    assert.doesNotMatch(src, /(?:href|to)="\/(?:account\/)?integrations"/, `${f} links to the old address`);
    assert.doesNotMatch(src, /import\('\.\/IntegrationsPage'\)/);
  }
});

test('a connector belongs to the member: no connectors read takes a company', () => {
  for (const f of ['AccountConnectors.jsx', 'ConnectorSheet.jsx', 'ConnectToolSheet.jsx', 'connectorsModel.js', 'discoverModel.js', 'ConnectorFilterMenu.jsx']) {
    assert.doesNotMatch(read(`frontend/src/pages/account/${f}`), /activeCompany|company_id=|useActiveCompany/, f);
  }
});
