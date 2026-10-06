/**
 * D571 (#1174) — the Ops canvas's advisor practice tools: deliverables per
 * client (A1), session types (A2), booking links (A3), the client data access
 * log (A4) and the profile a client sees (A5).
 *
 * Fixtures are built in the shape the Worker routes send, and the first tests
 * hold them to it: each fixture's keys are read against the DTO in
 * `cloudflare-worker/src/routes/advisors.ts` or `advisor_grants.ts`, so a
 * fixture cannot carry a field no route returns. The components are then
 * rendered from those fixtures, in every state.
 *
 * Run: node --import ./frontend/test/_deck-loader.mjs --test frontend/test/advisor_practice_d571.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { codeOnly } from './_codeOnly.mjs';

import {
  DELIVERABLE_FLOW, LINK_SLUG, PRICE_MODES, accessRecord, accessWho, attachmentBody, attachmentOf,
  bookableState, bookingLinkAddress, bookingLinkUrl, canBeBookable, deliverableEdit, deliverableStep,
  distinctOf, filterAccessRows, groupByClient, initialsOf, linkBody, linksByType, parseAmount, priceMode,
  profileSub, safeHref, sessionTypeBody, sessionTypeForm, sinceYear, stampMs, suggestSlug,
} from '../src/pages/advisor/practice/practiceTools.js';
import DeliverablesByClient, {
  AttachForm, DeliverableEditor, FlowLegend, moveWarning,
} from '../src/pages/advisor/practice/DeliverablesByClient.jsx';
import SessionTypesPanel, { PriceCell, SessionTypeEditor } from '../src/pages/advisor/practice/SessionTypesPanel.jsx';
import BookingLinksPanel, { LinkCard } from '../src/pages/advisor/practice/BookingLinksPanel.jsx';
import {
  AccessLogTable, AdvisorAccessLogView, ClientCompanyAccessLogView,
} from '../src/pages/advisor/practice/ClientAccessLog.jsx';
import { AdvisorProfileView } from '../src/pages/advisor/AdvisorProfilePage.jsx';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const text = (el) => html(el).replace(/<[^>]+>/g, ' ').replace(/&#x27;|&rsquo;|’/g, "'")
  .replace(/&quot;/g, '"').replace(/&ldquo;|&rdquo;|“|”/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

const ADVISORS = read('cloudflare-worker/src/routes/advisors.ts');
const GRANTS = read('cloudflare-worker/src/routes/advisor_grants.ts');
const API = read('frontend/src/lib/api.js');
const APP = read('frontend/src/App.jsx');

/** The keys of the object literal a function or handler returns, sliced between two markers. */
function keysBetween(src, start, end) {
  const from = src.indexOf(start);
  assert.ok(from >= 0, `marker not found: ${start}`);
  const body = src.slice(from + start.length, src.indexOf(end, from + start.length));
  // A key opens a line or follows a comma; several share a line in these DTOs.
  return new Set([...body.matchAll(/(?:^|,)\s*(\w+):/gm)].map((m) => m[1]));
}
/** Both ways: no invented field in a fixture, and no field of the route left out of it. */
const assertShape = (fixture, keys, what) => {
  for (const k of Object.keys(fixture)) assert.ok(keys.has(k), `${what}: the fixture carries \`${k}\`, which the route never sends`);
  for (const k of keys) assert.ok(k in fixture, `${what}: the route sends \`${k}\`, and the fixture leaves it out`);
};

// ─────────────────────────── fixtures, in the routes' own shape ───────────────────────────

const VERSION_KEYS = keysBetween(ADVISORS, 'function versionDto(r: VersionRow): any {\n  return {', '\n  };');
const DELIVERABLE_KEYS = keysBetween(ADVISORS, 'const items = (rows.results || []).map((d) => {', '\n      };');
const TYPE_KEYS = keysBetween(ADVISORS, 'function sessionTypeDto(r: SessionTypeRow): any {\n  return {', '\n  };');
const LINK_KEYS = keysBetween(ADVISORS, 'function bookingLinkDto(r: BookingLinkRow): any {\n  return {', '\n  };');
const ADVISOR_KEYS = new Set([
  ...keysBetween(ADVISORS, 'function advisorDto(m: AdvisorRow): any {\n  return {', '...advisorProfileDto(m),'),
  ...keysBetween(ADVISORS, 'function advisorProfileDto(m: AdvisorRow): any {\n  return {', '\n  };'),
]);
const SHARED_KEYS = keysBetween(GRANTS.slice(GRANTS.indexOf("grants.get('/shared/list'")),
  'items: (rows.results || []).map((r: any) => ({', '\n    })),');
const LOG_SELECT = GRANTS.slice(GRANTS.indexOf("grants.get('/:projectUid/access-log'"));
const LOG_KEYS = new Set([...LOG_SELECT.slice(0, LOG_SELECT.indexOf('FROM advisor_client_access_log'))
  .matchAll(/(?:AS (\w+)|l\.(\w+))/g)].map((m) => m[1] || m[2]));

const version = (over = {}) => ({
  uid: 'v-1', version: 1, label: null, summary: null, link_url: null,
  sent_at: null, opened_at: null, signed_off_at: null,
  created_at: '2026-10-01T09:00:00.000Z', updated_at: '2026-10-01T09:00:00.000Z', ...over,
});
const deliverable = (over = {}) => ({
  id: 1, uid: 'd-1', advisor_id: 3, engagement_id: 7, client_name: 'Halverton', title: 'Pricing model',
  client_user_id: 41, client_user_name: 'Ada Client', client_user_email: 'ada@halverton.example',
  state: 'not_started', due_date: null, manual_status: null, version_count: 1,
  latest_version: version({ sent_at: ['sent', 'opened'].includes(over.state) ? '2026-10-01T10:00:00Z' : null, opened_at: over.state === 'opened' ? '2026-10-01T11:00:00Z' : null }), versions: [version()],
  created_at: '2026-10-01T09:00:00.000Z', updated_at: '2026-10-01T09:00:00.000Z', ...over,
});
const type = (over = {}) => ({
  id: 11, uid: 't-11', name: 'Strategy session', duration_minutes: 60, cadence_note: null,
  price_cents: 28000, is_included: null, booking_count: null, is_free_intro: false, once_per_client: false, sort_order: 0, is_active: true, ...over,
});
const link = (over = {}) => ({
  id: 21, uid: 'l-21', slug: 'ada/strategy', session_type_id: 11, audience: 'public',
  cohort_ref: null, requires_payout_account: true, note: null, is_active: true, opens_count: null, booking_count: null, ...over,
});
const logRow = (over = {}) => ({
  action: 'open_brief', created_at: '2026-10-06 09:41:00', advisor_email: 'ada@practice.example',
  advisor_name: 'Ada Advisor', document_uid: null, document_title: null, ...over,
});
const shared = (over = {}) => ({
  grant_uid: 'g-1', project_uid: 'p-1', project_name: 'Halverton', scope_project: true,
  scope_data_room: false, scope_sessions: false, expires_at: null, created_at: '2026-09-01 08:00:00', ...over,
});
const advisor = (over = {}) => ({
  id: 3, uid: 'a1b2c3', user_id: 9, display_name: 'Ada Lovelace', email: 'ada@practice.example',
  bio: 'I help seed teams price their first product.', expertise: ['Pricing', 'Go-to-market'], sectors: ['Fintech', 'Climate'],
  linkedin_url: 'https://www.linkedin.com/in/ada', hourly_rate_usd: null, is_active: true,
  created_at: '2025-03-01 10:00:00', updated_at: '2026-09-01 10:00:00', headline: 'Ex-Stripe pricing lead',
  stages: ['Seed'], languages: null, country: 'France', timezone: 'Europe/Paris', availability_note: null,
  headshot_url: null, ...over,
});

test('every fixture carries only fields its route sends', () => {
  assert.ok(VERSION_KEYS.size >= 10 && DELIVERABLE_KEYS.size >= 14 && TYPE_KEYS.size >= 10, 'the DTO parse found too few keys');
  assertShape(version(), VERSION_KEYS, 'versionDto');
  assertShape(deliverable(), DELIVERABLE_KEYS, 'GET /me/deliverables item');
  assertShape(type(), TYPE_KEYS, 'sessionTypeDto');
  assertShape(link(), LINK_KEYS, 'bookingLinkDto');
  assertShape(advisor(), ADVISOR_KEYS, 'advisorDto');
  assertShape(shared(), SHARED_KEYS, 'GET /advisor-grants/shared/list item');
  assertShape(logRow(), LOG_KEYS, 'GET /advisor-grants/:projectUid/access-log row');
  for (const k of ['due_date', 'manual_status']) assert.ok(DELIVERABLE_KEYS.has(k), `deliverables must expose ${k}`);
  for (const k of ['opens_count', 'booking_count']) assert.ok(LINK_KEYS.has(k), `links must expose ${k}`);
  assert.ok(TYPE_KEYS.has('booking_count') && TYPE_KEYS.has('is_included'), 'session type facts must reach the screen');
});

test('each method the screens call exists, and hits the Worker route behind it', async () => {
  globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  globalThis.document ??= { cookie: '' };
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push([init.method || 'GET', String(url).replace(/^.*\/api/, ''), init.body]);
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const { api } = await import('../src/lib/api.js');
    await api.listMyAdvisorDeliverables();
    await api.updateMyAdvisorDeliverable(5, { title: 'T' });
    await api.addMyAdvisorDeliverableVersion(5, { link_url: 'https://x.example' });
    await api.listMyAdvisorSessionTypes();
    await api.createMyAdvisorSessionType({ name: 'N' });
    await api.updateMyAdvisorSessionType(11, { is_active: false });
    await api.listMyAdvisorBookingLinks();
    await api.createMyAdvisorBookingLink({ slug: 'ada/x' });
    await api.advisorClientsSharedWithMe();
    await api.advisorClientAccessLog('p-1');
    await api.getAdvisor('a1b2c3');
  } finally { globalThis.fetch = orig; }
  assert.deepEqual(calls.map(([m, u]) => [m, u]), [
    ['GET', '/advisors/me/deliverables'],
    ['PATCH', '/advisors/me/deliverables/5'],
    ['POST', '/advisors/me/deliverables/5/versions'],
    ['GET', '/advisors/me/session-types'],
    ['POST', '/advisors/me/session-types'],
    ['PATCH', '/advisors/me/session-types/11'],
    ['GET', '/advisors/me/booking-links'],
    ['POST', '/advisors/me/booking-links'],
    ['GET', '/advisor-grants/shared/list'],
    ['GET', '/advisor-grants/p-1/access-log'],
    ['GET', '/advisors/a1b2c3'],
  ]);
  assert.deepEqual(JSON.parse(calls[5][2]), { is_active: false });
  for (const route of [
    "advisors.get('/me/deliverables'", "advisors.patch('/me/deliverables/:id'", "advisors.post('/me/deliverables/:id/versions'",
    "advisors.get('/me/session-types'", "advisors.post('/me/session-types'", "advisors.patch('/me/session-types/:id'",
    "advisors.get('/me/booking-links'", "advisors.post('/me/booking-links'", "advisors.get('/:uid'",
  ]) assert.ok(ADVISORS.includes(route), `the Worker no longer registers ${route}`);
  assert.ok(GRANTS.includes("grants.get('/:projectUid/access-log'") && GRANTS.includes("grants.get('/shared/list'"));
  // No new client method: every name the five screens call was in api.js before them.
  for (const file of ['DeliveryZone.jsx', 'DeliverablesByClient.jsx', 'SessionTypesPanel.jsx', 'BookingLinksPanel.jsx', 'ClientAccessLog.jsx']) {
    for (const [, name] of codeOnly(read(`frontend/src/pages/advisor/practice/${file}`)).matchAll(/api\.(\w+)\(/g)) {
      assert.match(API, new RegExp(`\\n  ${name}:`), `${file} calls api.${name}, which api.js does not have`);
    }
  }
});

test('D573: practice routes now expose the stored facts, with client acceptance kept separate', () => {
  assert.match(ADVISORS, /advisors\.patch\('\/me\/booking-links\/:id'/);
  assert.match(APP, /path="\/b\/\*"/);
  assert.match(ADVISORS, /advisors\.get\('\/me\/access-log'/);
  assert.match(ADVISORS, /advisors\.post\('\/received\/deliverables\/:uid\/accept'/);
  const migration = read('cloudflare-worker/sql/migrations/394_advisor_practice.sql');
  for (const column of ['due_date', 'manual_status', 'is_included', 'session_type_id', 'booking_link_id', 'opens_count']) {
    assert.match(migration, new RegExp(`ADD COLUMN ${column}\\b`));
  }
});

// ─────────────────────────── A1 · deliverables per client ───────────────────────────

test('A1: the canvas flow is four steps over the store\'s derived state', () => {
  assert.deepEqual(DELIVERABLE_FLOW.map((s) => s.label), ['Planned', 'In progress', 'Sent', 'Opened', 'Accepted']);
  assert.deepEqual(DELIVERABLE_FLOW.flatMap((s) => s.canvas), ['Planned', 'In progress', 'Delivered', 'Accepted']);
  assert.equal(deliverableStep(deliverable({ state: 'not_started' })), null);
  assert.equal(deliverableStep(deliverable({ state: 'sent' })), 'sent');
  assert.equal(deliverableStep(deliverable({ state: 'opened' })), 'opened');
  assert.equal(deliverableStep(deliverable({ state: 'opened', latest_version: version({ signed_off_at: '2026-10-02T00:00:00Z' }) })), 'accepted');
  // An older version's sign-off is not the latest's.
  assert.equal(deliverableStep(deliverable({ state: 'sent', versions: [version({ version: 2 }), version({ signed_off_at: 'x' })] })), 'sent');
  assert.equal(deliverableStep(deliverable({ state: 'planned' })), null, 'a state the route never sends is not mapped');
});

test('A1: grouping follows the route\'s exact client names, blank last', () => {
  const groups = groupByClient([
    deliverable({ id: 1, client_name: 'Zephyr' }), deliverable({ id: 2, client_name: 'Halverton' }),
    deliverable({ id: 3, client_name: '' }), deliverable({ id: 4, client_name: 'Halverton ' }), null,
  ]);
  assert.deepEqual(groups.map((g) => [g.client, g.rows.map((r) => r.id)]), [['Halverton', [2, 4]], ['Zephyr', [1]], ['', [3]]]);
  assert.deepEqual(groupByClient(undefined), []);
});

test('A1: the attachment is the newest version with a web link; anything else is never an href', () => {
  const att = attachmentOf(deliverable({ versions: [version({ version: 2 }), version({ version: 1, link_url: 'https://docs.example.com/v1.pdf' })] }));
  assert.equal(att.url, 'https://docs.example.com/v1.pdf');
  assert.equal(att.version.version, 1);
  assert.equal(attachmentOf(deliverable({ versions: [version()] })), null);
  const two = attachmentOf(deliverable({ versions: [version({ version: 1, link_url: 'https://a.example/v1' }), version({ version: 2, link_url: 'https://a.example/v2' })] }));
  assert.equal(two.url, 'https://a.example/v2', 'the newest link wins, whatever order the versions arrive in');
  assert.equal(safeHref('javascript:alert(1)'), null);
  assert.equal(safeHref('www.example.com'), null);
  assert.equal(safeHref(' https://x.example/a '), 'https://x.example/a');
  assert.deepEqual(attachmentBody({ link_url: 'ftp://x' }), { error: 'Enter a web address that starts with https://' });
  assert.deepEqual(attachmentBody({ link_url: 'https://x.example', summary: ' ' }), { body: { link_url: 'https://x.example', summary: null } });
});

test('A1: an edit sends what changed, refuses what the route would quietly drop, and confirms a move once sent', () => {
  const item = deliverable();
  assert.deepEqual(deliverableEdit(item, { title: '  ', engagement_id: '7' }), { error: 'A work product needs a title.' });
  assert.deepEqual(deliverableEdit(item, { title: 'New', engagement_id: '7' }), { body: { title: 'New' }, confirm: false });
  assert.deepEqual(deliverableEdit(item, { title: 'New', engagement_id: '', client_name: '' }),
    { error: 'Name the client, or pick the engagement it belongs to.' });
  assert.deepEqual(deliverableEdit(item, { title: 'New', engagement_id: '', client_name: 'Other Co' }),
    { body: { title: 'New', engagement_id: null, client_name: 'Other Co' }, confirm: false });
  // Sent: moving it changes which client can see it, so it is confirmed.
  assert.equal(deliverableEdit(deliverable({ state: 'sent' }), { title: 'T', engagement_id: '8' }).confirm, true);
  assert.equal(deliverableEdit(deliverable({ state: 'opened' }), { title: 'T', engagement_id: '7' }).confirm, false, 'same engagement');
  assert.match(moveWarning(deliverable(), { client_name: 'Zephyr' }), /takes it out of Halverton’s received work, and Zephyr will see it instead/);
  assert.match(moveWarning(deliverable(), null), /Taking it off its engagement/);
});

test('A1: per-client cards — due Not recorded, status from the flow, send only where it can go, attach where there is no link', () => {
  const items = [
    deliverable({ id: 1, title: 'Pricing model' }),
    deliverable({ id: 2, title: 'Board brief', state: 'sent', latest_version: version({ sent_at: '2026-10-02T00:00:00Z', link_url: 'https://docs.example.com/brief.pdf' }),
      versions: [version({ sent_at: '2026-10-02T00:00:00Z', link_url: 'https://docs.example.com/brief.pdf' })] }),
    deliverable({ id: 3, title: 'Roadmap', client_name: 'Zephyr', client_user_email: null, client_user_id: null }),
  ];
  const markup = html(h(DeliverablesByClient, { items, engagements: [] }));
  const t = text(h(DeliverablesByClient, { items, engagements: [] }));
  assert.match(t, /Halverton 2 deliverables/);
  assert.match(t, /Zephyr 1 deliverable /);
  assert.equal((t.match(/Due Not recorded/g) || []).length, 3, 'every row reads Not recorded for due, never a date');
  assert.match(markup, /title="No due date has been set\."/);
  assert.match(markup, /data-testid="send-a1-1"/, 'an unsent row with a client account can be sent');
  assert.doesNotMatch(markup, /send-a1-2|send-a1-3/, 'a sent row, and a row with no account, offer no send');
  assert.match(t, /No client account, so it cannot be sent/);
  assert.match(markup, /href="https:\/\/docs\.example\.com\/brief\.pdf"[^>]*>docs\.example\.com\s↗/);
  // The route builds `latest_version` and `versions` as separate objects, as
  // these fixtures do: a link on the latest version carries no "on vN" note.
  assert.doesNotMatch(t, /docs\.example\.com\s↗ on v/);
  const older = text(h(DeliverablesByClient, { items: [deliverable({ id: 9, version_count: 2, latest_version: version({ version: 2 }),
    versions: [version({ version: 2 }), version({ version: 1, link_url: 'https://docs.example.com/v1.pdf' })] })] }));
  assert.match(older, /docs\.example\.com\s↗ on v1/, 'a link on an older version says which');
  assert.match(markup, /data-testid="attach-a1-1"/);
  assert.doesNotMatch(markup, /attach-a1-2/, 'a row with a link has no Attach');
  for (const id of [1, 2, 3]) assert.match(markup, new RegExp(`data-testid="edit-a1-${id}"`));
  assert.match(t, /Status flow: Planned → In progress → Sent → Opened → Accepted/);
  assert.match(text(h(FlowLegend)), /Accepted is the client's sign-off on the latest version/);
});

test('A1: the editor and the attach form say what they will write', () => {
  const ed = html(h(DeliverableEditor, { item: deliverable(), engagements: [{ id: 7, client_name: 'Halverton', founder_user_id: 41 }, { id: 8, client_name: 'Zephyr', founder_user_id: null }] }));
  assert.match(ed, /value="Pricing model"/);
  assert.match(ed, /<option value="7" selected="">Halverton<\/option>/);
  assert.match(ed, /Zephyr \(no account, so it cannot be sent\)/);
  const at = text(h(AttachForm, { item: deliverable({ version_count: 2 }) }));
  assert.match(at, /this records v3, not sent , carrying the link/);
  assert.match(at, /Attach as v3/);
});

// ─────────────────────────── A2 · session types ───────────────────────────

test('A2: four price modes, and a null price is never read as zero', () => {
  assert.equal(priceMode(type()), 'price');
  assert.equal(priceMode(type({ price_cents: 0 })), 'price');
  assert.equal(priceMode(type({ price_cents: null })), 'unset');
  assert.equal(priceMode(type({ price_cents: null, is_free_intro: true })), 'free');
  assert.deepEqual(PRICE_MODES.map((m) => m.key), ['price', 'included', 'free', 'unset']);
  assert.match(text(h(PriceCell, { type: type({ price_cents: null }) })), /^Not recorded · no price set$/);
  assert.doesNotMatch(text(h(PriceCell, { type: type({ price_cents: null }) })), /\$0/);
  assert.match(text(h(PriceCell, { type: type({ price_cents: 0, is_included: true }) })), /^Included no separate charge$/);
  assert.equal(text(h(PriceCell, { type: type() })), '$280');
  assert.equal(text(h(PriceCell, { type: type({ price_cents: null, is_free_intro: true }) })), 'Free intro');
});

test('A2: the canvas rule — no price, not bookable — in the body, the switch and the stored contradiction', () => {
  assert.equal(canBeBookable(type({ price_cents: null })), false);
  assert.equal(canBeBookable(type({ price_cents: 0 })), true, 'a recorded zero price counts as set');
  assert.equal(canBeBookable(type({ price_cents: null, is_free_intro: true })), true);
  assert.equal(bookableState(type({ price_cents: null, is_active: true })), 'unpriced_on');
  assert.equal(bookableState(type({ price_cents: null, is_active: false })), 'off');
  assert.equal(bookableState(type()), 'bookable');

  assert.deepEqual(sessionTypeBody({ name: 'Deep dive', duration: '90', mode: 'unset', bookable: true }),
    { error: 'A type with no price cannot be bookable. Set a price or mark it included first.' });
  assert.deepEqual(sessionTypeBody({ name: 'Deep dive', duration: '90', mode: 'unset', bookable: false }), {
    body: { name: 'Deep dive', duration_minutes: 90, cadence_note: null, price_cents: null, is_free_intro: false, is_included: false, is_active: false },
  });
  assert.equal(sessionTypeBody({ name: 'Retainer call', mode: 'included', bookable: true }).body.price_cents, 0);
  assert.deepEqual(sessionTypeBody({ name: 'Intro', mode: 'free', bookable: true }).body,
    { name: 'Intro', duration_minutes: null, cadence_note: null, price_cents: null, is_free_intro: true, is_included: false, is_active: true });
  assert.equal(sessionTypeBody({ name: 'Single', mode: 'price', amount: '$1,250.50', bookable: true }).body.price_cents, 125050);
  assert.equal(sessionTypeBody({ name: 'Single', mode: 'price', amount: '0', bookable: true }).body.price_cents, 0);
  assert.equal(sessionTypeBody({ name: '', mode: 'free' }).error, 'A session type needs a name.');
  assert.equal(sessionTypeBody({ name: 'X', mode: 'free', duration: '0' }).error, 'Length is whole minutes, from 1 to 1440.');
  assert.deepEqual(parseAmount('12.345'), { error: 'Enter an amount like 150 or 150.50' });
  assert.deepEqual(sessionTypeForm(type({ price_cents: 28050 })), { name: 'Strategy session', duration: '60', mode: 'price', amount: '280.5', bookable: true, note: '' });
});

test('A2: the table — switch disabled where the rule forbids it, the contradiction flagged, bookings Not recorded', () => {
  const types = [
    type({ id: 1, name: 'Strategy session' }),
    type({ id: 2, name: 'Deep dive', price_cents: null, is_active: false }),
    type({ id: 3, name: 'Old type', price_cents: null, is_active: true }),
    type({ id: 4, name: 'Retainer call', price_cents: 0, is_active: false }),
  ];
  const markup = html(h(SessionTypesPanel, { types, read: true }));
  const t = text(h(SessionTypesPanel, { types, read: true }));
  // The opening tag of switch `id`, by string search rather than a RegExp built
  // from a variable (Semgrep's detect-non-literal-regexp).
  const sw = (id) => {
    const at = markup.indexOf(`data-testid="toggle-a2-${id}"`);
    assert.ok(at >= 0, `switch ${id} is drawn`);
    const open = markup.lastIndexOf('<button', at);
    return markup.slice(open, markup.indexOf('>', at) + 1);
  };
  const OFF = /\sdisabled=""/;
  assert.doesNotMatch(sw(1), OFF);
  assert.match(sw(2), OFF, 'an unpriced type that is off cannot be switched on');
  assert.match(sw(2), /title="Set a price or mark it included first\."/);
  assert.doesNotMatch(sw(3), OFF, 'a stored contradiction can always be switched off');
  assert.doesNotMatch(sw(4), OFF, 'included is a price for this rule');
  assert.match(sw(1), /aria-checked="true"/);
  assert.match(sw(2), /aria-checked="false"/);
  assert.match(t, /Old type Length 60 min Price Not recorded · no price set Bookable Bookable with no price/);
  assert.match(t, /Deep dive Length 60 min Price Not recorded · no price set Not bookable/);
  assert.equal((t.match(/Bookings Not recorded/g) || []).length, 4);
  assert.match(t, /A type with no price reads Not recorded and cannot be bookable until a price or "included" is set/);
  assert.match(markup, /data-testid="new-session-type"/);
});

test('A2: loading, unreadable and empty are three different screens', () => {
  const loading = html(h(SessionTypesPanel, { types: [], loading: true }));
  assert.match(loading, /aria-busy="true"/);
  assert.doesNotMatch(loading, /No session types yet/);
  const bad = text(h(SessionTypesPanel, { types: [], read: false, onChanged: () => {} }));
  assert.match(bad, /Your session types could not be read\. This is not a claim that you offer none\./);
  assert.doesNotMatch(bad, /No session types yet/);
  assert.match(text(h(SessionTypesPanel, { types: [], read: true })), /No session types yet\. Clients cannot book until one is bookable\./);
  const ed = html(h(SessionTypeEditor, {}));
  assert.match(ed, /New session type/);
  assert.match(ed, /<input type="checkbox" disabled=""/, 'a new type starts unpriced, so Bookable starts disabled');
});

// ─────────────────────────── A3 · booking links ───────────────────────────

test('A3: the slug rule is the Worker\'s own, and a create body is refused before the round trip', () => {
  const worker = /if \(!(\/\^\[a-z0-9\]\[a-z0-9\/-\]\{1,98\}\[a-z0-9\]\$\/)\.test\(slug\)\)/.exec(ADVISORS);
  assert.ok(worker, 'the Worker slug check moved');
  assert.equal(LINK_SLUG.source, worker[1].slice(1, -1).replace(/\\\//g, '/'));
  assert.equal(linkBody({ slug: 'Ada/Intro' }).error.startsWith('Use lowercase'), true);
  assert.equal(linkBody({ slug: 'ab' }).error.startsWith('Use lowercase'), true);
  assert.deepEqual(linkBody({ slug: 'ada/cohort', audience: 'cohort', cohort_ref: ' ' }), { error: 'A cohort link needs the cohort it admits.' });
  assert.deepEqual(linkBody({ slug: 'ada/strategy', session_type_id: '11', audience: 'public', requires_payout_account: true }).body,
    { slug: 'ada/strategy', session_type_id: 11, audience: 'public', cohort_ref: null, requires_payout_account: true, note: null });
  assert.equal(suggestSlug('Strategy Session — 60 min'), 'strategy-session-60-min');
  assert.equal(bookingLinkAddress('ada/x'), 'axal.vc/b/ada/x');
  assert.equal(bookingLinkUrl('ada/x'), 'https://axal.vc/b/ada/x');
});

test('A3: one card per link under its type, a create offer for a type with none, loose links kept', () => {
  const types = [type({ id: 11 }), type({ id: 12, name: 'Deep dive' })];
  const links = [link({ id: 21, session_type_id: 11 }), link({ id: 22, slug: 'ada/old', session_type_id: 99 }), link({ id: 23, slug: 'ada/open', session_type_id: null, is_active: false })];
  assert.deepEqual(linksByType(types, links).map((g) => [g.type?.id ?? null, g.links.map((l) => l.id)]), [[11, [21]], [12, []], [null, [22, 23]]]);
  const markup = html(h(BookingLinksPanel, { links, types, read: true, typesRead: true }));
  const t = text(h(BookingLinksPanel, { links, types, read: true, typesRead: true }));
  assert.match(markup, /data-testid="unlinked-a3-12"/);
  assert.match(t, /A copied link opens its session type\./);
  assert.match(t, /Session type not found/);
  assert.match(t, /No session type/);
  assert.match(t, /Opens count accepted page-open requests/);
  const card = html(h(LinkCard, { link: link(), typeName: 'Strategy session' }));
  assert.match(card, /axal\.vc\/b\/ada\/strategy/);
  assert.match(card, /data-testid="copy-a3-21"/);
  const toggle = /<button[^>]*data-testid="toggle-a3-21"[^>]*>/.exec(card)[0];
  assert.match(toggle, /role="switch"/);
  assert.doesNotMatch(toggle, /\sdisabled=""/, 'the mounted PATCH route enables the switch');
  assert.match(toggle, /aria-checked="true"/);
  assert.match(text(h(LinkCard, { link: link({ is_active: false }), typeName: 'X' })), /Disabled/);
  assert.match(text(h(LinkCard, { link: link(), typeName: 'X' })), /Opens: Not recorded Bookings: Not recorded/);
  assert.match(text(h(BookingLinksPanel, { links: [], types: [], read: false, onChanged: () => {} })),
    /Your booking links could not be read\. This is not a claim that you have none\./);
  assert.match(html(h(BookingLinksPanel, { links: [], types: [], read: true })), /data-testid="booking-links-empty"/);
  assert.match(html(h(BookingLinksPanel, { links: [], types: [], loading: true })), /aria-busy="true"/);
});

// ─────────────────────────── A4 · the client data access log ───────────────────────────

test('A4: a SQLite stamp is UTC, and the filters keep client, who and a day window', () => {
  // Read in a zone that is not UTC, or a stamp parsed as local time would pass
  // on any CI box that runs in UTC.
  const tz = process.env.TZ;
  process.env.TZ = 'America/New_York';
  try {
    assert.notEqual(new Date(Date.UTC(2026, 9, 6)).getTimezoneOffset(), 0, 'the zone switch did not take');
    assert.equal(stampMs('2026-10-06 09:41:00'), Date.UTC(2026, 9, 6, 9, 41));
    assert.equal(stampMs('2026-10-06T09:41:00.000Z'), Date.UTC(2026, 9, 6, 9, 41));
  } finally {
    if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz;
  }
  assert.equal(stampMs('not a date'), null);
  const rows = [
    logRow({ client: 'Halverton', created_at: '2026-10-01 12:00:00' }),
    logRow({ client: 'Zephyr', created_at: '2026-10-05 12:00:00', advisor_name: null, advisor_email: 'bo@x.example' }),
    logRow({ client: 'Halverton', created_at: 'garbled' }),
  ];
  assert.equal(filterAccessRows(rows).length, 3, 'no filter keeps every row, a garbled stamp too');
  assert.deepEqual(filterAccessRows(rows, { client: 'Halverton' }).map((r) => r.created_at), ['2026-10-01 12:00:00', 'garbled']);
  assert.deepEqual(filterAccessRows(rows, { who: 'bo@x.example' }).map((r) => r.client), ['Zephyr']);
  assert.deepEqual(filterAccessRows(rows, { from: '2026-10-03' }).map((r) => r.client), ['Zephyr'], 'a garbled stamp cannot be placed in a window');
  assert.deepEqual(filterAccessRows(rows, { to: '2026-10-01' }).map((r) => r.client), ['Halverton']);
  assert.deepEqual(distinctOf(rows, (r) => r.client), ['Halverton', 'Zephyr']);
  assert.equal(accessWho(logRow({ advisor_name: '' })), 'ada@practice.example');
  assert.deepEqual(accessRecord(logRow()), { label: 'Client brief', missing: null });
  assert.deepEqual(accessRecord(logRow({ action: 'open_document' })), { label: null, missing: 'the document was deleted after it was opened' });
});

test('A4: the log is read-only — no row carries a control — and filterable', () => {
  const rows = [logRow({ client: 'Halverton' }), logRow({ client: 'Zephyr', action: 'open_document', document_title: 'Cap table' })];
  const markup = html(h(AccessLogTable, { rows }));
  const t = text(h(AccessLogTable, { rows }));
  for (const row of markup.split('data-testid="access-row"').slice(1)) {
    const cell = row.slice(0, row.indexOf('data-testid="access-row"') >= 0 ? row.indexOf('data-testid="access-row"') : row.indexOf('access-read-only'));
    assert.doesNotMatch(cell, /<button|<input|<select|<a /, 'a log row carries a control');
  }
  assert.match(t, /Read-only\. Rows cannot be edited or removed by anyone\./);
  assert.match(t, /Ada Advisor Client brief Halverton Opened/);
  assert.match(t, /Cap table Zephyr Opened/);
  assert.match(markup, /data-testid="filter-access-client"/);
  assert.match(markup, /data-testid="filter-access-from"/);
  assert.match(markup, /data-testid="filter-access-to"/);
  assert.match(t, /2 of 2 rows/);
  const one = text(h(AccessLogTable, { rows, initialFilters: { client: 'Zephyr' } }));
  assert.match(one, /1 of 2 rows/);
  assert.doesNotMatch(one, /Client brief/);
  assert.match(text(h(AccessLogTable, { rows, initialFilters: { from: '2027-01-01' } })), /No access recorded for this client in this period\./);
  // The client company's own view has no client column or filter: the project is theirs.
  assert.doesNotMatch(html(h(AccessLogTable, { rows, showClient: false })), /filter-access-client/);
});

test('A4: the advisor reads only their own access rows and preserves loading, failure and empty states', () => {
  assert.match(html(h(AdvisorAccessLogView, { state: { loading: true, items: [] } })), /aria-busy="true"/);
  const bad = text(h(AdvisorAccessLogView, { state: { loading: false, error: 'failed', items: [] } }));
  assert.match(bad, /Your access log could not be read\. This is not a claim that no record was opened\./);
  assert.doesNotMatch(bad, /No client record opens recorded yet/);
  assert.match(text(h(AdvisorAccessLogView, { state: { loading: false, items: [] } })), /No client record opens recorded yet/);
  const t = text(h(AdvisorAccessLogView, { state: { loading: false, items: [logRow({ client: 'Halverton' })] } }));
  assert.match(t, /Client brief Halverton Opened/);
  assert.match(t, /Read-only\. Rows cannot be edited or removed by anyone\./);
  const src = codeOnly(read('frontend/src/pages/advisor/practice/ClientAccessLog.jsx'));
  const advisorSide = src.slice(src.indexOf('export default function AdvisorAccessLog'), src.indexOf('export function ClientCompanyAccessLog'));
  assert.match(advisorSide, /api\.listMyAdvisorAccessLog\(/);
  assert.doesNotMatch(advisorSide, /api\.advisorClientAccessLog\(/);
});

test('A4: the client company\'s side reads the real log in four states', () => {
  assert.match(html(h(ClientCompanyAccessLogView, { state: { status: 'loading' } })), /aria-busy="true"/);
  const bad = text(h(ClientCompanyAccessLogView, { state: { status: 'unreadable' }, onRetry: () => {} }));
  assert.match(bad, /The access log could not be read\. This is not a claim that no advisor opened your record\./);
  assert.match(text(h(ClientCompanyAccessLogView, { state: { status: 'ready', rows: [] } })), /No advisor has opened your record yet\./);
  const t = text(h(ClientCompanyAccessLogView, { state: { status: 'ready', rows: [logRow()] } }));
  assert.match(t, /Who opened your record/);
  assert.match(t, /Ada Advisor Client brief Opened/);
  assert.match(t, /Rows cannot be edited or removed by anyone/);
  const grant = read('frontend/src/pages/raise/AdvisorGrantSection.jsx');
  assert.match(grant, /<ClientCompanyAccessLog projectUid=\{projectUid\} \/>/);
});

// ─────────────────────────── A5 · the profile a client sees ───────────────────────────

test('A5: the profile renders what the route holds, and Not recorded where a client cannot be told', () => {
  const t = text(h(AdvisorProfileView, { state: { status: 'ready', advisor: advisor() } }));
  assert.match(t, /Ada Lovelace Ex-Stripe pricing lead · Fintech, Climate · France/);
  assert.match(t, /Pricing Go-to-market/);
  assert.match(t, /I help seed teams price their first product\./);
  assert.match(t, /Not recorded Engagements 2025 On Axal since Not recorded Response/);
  assert.match(t, /Stages Seed Languages Not recorded Timezone Europe\/Paris Availability Not recorded LinkedIn Profile ↗/);
  assert.match(t, /Hourly rate Not recorded/);
  assert.match(t, /Session types Session types not recorded/);
  const markup = html(h(AdvisorProfileView, { state: { status: 'ready', advisor: advisor() } }));
  assert.doesNotMatch(markup, />Book</, 'no Book button that would open nothing');
  assert.doesNotMatch(markup, /ada@practice\.example/, 'the advisor\'s address is not shown to a client');
  assert.match(text(h(AdvisorProfileView, { state: { status: 'ready', advisor: advisor({ hourly_rate_usd: 250 }) } })), /\$250 an hour/);
  assert.match(text(h(AdvisorProfileView, { state: { status: 'ready', advisor: advisor({ stages: [] }) } })), /Stages None listed/);
  assert.match(text(h(AdvisorProfileView, { state: { status: 'ready', advisor: advisor({ expertise: [], headline: null, sectors: [], country: null }) } })),
    /No positioning recorded .* No expertise listed/);
  assert.match(html(h(AdvisorProfileView, { state: { status: 'ready', advisor: advisor() }, isOwner: true })), /data-testid="advisor-profile-owner"/);
  assert.equal(profileSub(advisor({ sectors: [] })), 'Ex-Stripe pricing lead · France');
  assert.equal(initialsOf('Ada  Lovelace'), 'AL');
  assert.equal(sinceYear(advisor({ created_at: null })), null);
});

test('A5: loading, unreadable and missing are three screens, and the page collapses to one column on a phone', () => {
  assert.match(html(h(AdvisorProfileView, { state: { status: 'loading' } })), /aria-busy="true"/);
  const bad = text(h(AdvisorProfileView, { state: { status: 'unreadable' }, onRetry: () => {} }));
  assert.match(bad, /The profile could not be read\. This is not a claim that the advisor is not here\./);
  assert.match(text(h(AdvisorProfileView, { state: { status: 'missing' } })), /No advisor profile at this address/);
  const markup = html(h(AdvisorProfileView, { state: { status: 'ready', advisor: advisor() } }));
  // Every multi-column grid on the page is behind a breakpoint: below it, one column.
  for (const [, cls] of markup.matchAll(/class="([^"]*\bgrid\b[^"]*)"/g)) {
    for (const cols of cls.match(/(?:^|\s)grid-cols-\d+/g) || []) assert.equal(cols.trim(), 'grid-cols-1', `an unbroken ${cols.trim()} on a phone`);
  }
  assert.match(markup, /lg:grid-cols-2/);
  assert.match(markup, /sm:grid-cols-3/);
});

// ─────────────────────────── the routes and the zones ───────────────────────────

test('the canvas addresses land on the zone sections, behind the zones\' own guard', () => {
  for (const [path, to] of [
    ['/practice/deliverables', '/practice/delivery?view=by_client'],
    ['/practice/session-types', '/practice/sessions#session-types'],
    ['/practice/booking-links', '/practice/sessions#booking-links'],
    ['/practice/access-log', '/practice/engagements#access-log'],
  ]) {
    assert.ok(APP.includes(`<Route path="${path}" element={guard(['admin', 'advisor'], <Navigate to="${to}" replace />)} />`), path);
  }
  assert.ok(APP.includes('<Route path="/advisors/:uid" element={<AdvisorProfilePage />} />'), 'the approved profile is publicly readable');
  assert.match(APP, /const AdvisorProfilePage = lazy\(\(\) => import\('\.\/pages\/advisor\/AdvisorProfilePage'\)\);/);

  const delivery = codeOnly(read('frontend/src/pages/advisor/practice/DeliveryZone.jsx'));
  assert.match(delivery, /const VIEWS = new Set\(\['all', 'by_client', 'unopened', 'opened', 'draft'\]\);/);
  assert.match(delivery, /VIEWS\.has\(searchParams\.get\('view'\)\)/);
  assert.match(delivery, /filter === 'by_client'\s*\n?\s*\? <DeliverablesByClient/);
  assert.match(delivery, /api\.updateMyAdvisorDeliverable\(item\.id, body\)/);
  const sessions = codeOnly(read('frontend/src/pages/advisor/practice/SessionsZone.jsx'));
  assert.match(sessions, /id="session-types"/);
  assert.match(sessions, /id="booking-links"/);
  assert.match(sessions, /<SessionTypesPanel types=\{types\} loading=\{restLoading\} read=\{typesRead\}/);
  assert.match(sessions, /setTypesRead\(Array\.isArray\(t\?\.items\)\)/, 'a failed read is not an empty catalogue');
  const engagements = codeOnly(read('frontend/src/pages/advisor/practice/EngagementsZone.jsx'));
  assert.match(engagements, /<\/ZoneBody>\s*<AdvisorAccessLog \/>/, 'the log sits outside the board\'s own four states');
  assert.match(read('frontend/src/pages/advisor/practice/ClientAccessLog.jsx'), /id="access-log"/);
});

test('the Practice rail states the missing drafts in Eadwyn\'s voice, without the licence\'s words', () => {
  const routes = read('frontend/src/workspaces/advisor/AdvisorBucketRoutes.jsx');
  const line = /\['Drafts for clients', '([^']+)'\]/.exec(routes);
  assert.ok(line, 'the rail no longer says the canvas proposals have no draft source');
  // `advi[cs]`: advice, advise, adviser, advisor, advisory. `advis` alone let
  // "advice" through, which the mutation run caught.
  assert.doesNotMatch(line[1], /advi[cs]|recommend|fiduciary/i);
});
