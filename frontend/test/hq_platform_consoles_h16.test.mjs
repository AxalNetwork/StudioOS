/**
 * D213 — H16's four consoles on HQ · Platform: Integration keys, GitHub Sync,
 * Payments catalog and Promo codes, each a read-only panel that ends in ONE
 * literal link to the console that changes it.
 *
 * WHAT IS RENDERED. The four panels are pure over their props, so every state
 * each can be in is RENDERED here — loading, the summary failing, the block
 * failing, empty, and populated — rather than matched as source text: a branch
 * can keep its words and stop drawing, and only the output notices (D200's
 * rule). The page itself loads in effects, which renderToStaticMarkup never
 * runs, so the order of its zones, the consoles zone and the rail are read as
 * source.
 *
 * Pinned elsewhere and not repeated here: no handler, no form, no `|| 0` and
 * the no-key-material words on this page (hq_content_platform_h6); the zone
 * slices after "Scheduled jobs" (hq_licences_h2h3, hq_platform_consoles_d202);
 * what the route returns in each state (cloudflare-worker/test/platform_consoles_d213).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { codeOnly } from './_codeOnly.mjs';
import {
  IntegrationKeysPanel, GithubSyncPanel, PaymentsCatalogPanel, PromoCodesPanel,
  PROVIDER_LABEL, KEY_STATE, keyDateLine, SYNC_STATE, PROMO_STATE, promoTerms,
} from '../src/pages/hq/PlatformPage.jsx';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const PAGE = raw('frontend/src/pages/hq/PlatformPage.jsx');
const P = codeOnly(PAGE);
const CANVAS = raw('design/canvases/integrated/Admin · Super.dc.html');

const render = (C, props) => renderToStaticMarkup(
  React.createElement(MemoryRouter, null, React.createElement(C, props)),
);
const count = (hay, needle) => hay.split(needle).length - 1;
/** Visible text, tags stripped — for asserting what a reader sees. */
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

/** H16 alone, bounded at both ends. */
function h16() {
  const a = CANVAS.indexOf('<section class="ab" id="h16">');
  assert.ok(a >= 0, 'the H16 artboard could not be found in the canvas');
  const b = CANVAS.indexOf('<section class="ab" id="h17">', a);
  assert.ok(b > a, 'H17 no longer follows H16 — this slice would run past the artboard');
  return CANVAS.slice(a, b).replaceAll('&amp;', '&');
}

// ────────────────────────────────────────────────────── the four zones ──

test('the page draws H16 as four zones, in the artboard\'s order, each once, before Scheduled jobs', () => {
  const board = h16();
  let last = -1;
  for (const panel of ['P1 · Integration keys', 'P2 · GitHub Sync', 'P3 · Payments catalog', 'P4 · Promo codes']) {
    const at = board.indexOf(panel);
    assert.ok(at > last, `the artboard no longer draws "${panel}" after the panel before it`);
    last = at;
  }
  let prev = -1;
  for (const title of ['Integration keys', 'GitHub Sync', 'Payments catalog', 'Promo codes']) {
    const zone = `<Zone title="${title}"`;
    assert.equal(count(P, zone), 1, `the page draws the ${title} zone ${count(P, zone)} times`);
    const at = P.indexOf(zone);
    assert.ok(at > prev, `${title} is out of the artboard's order`);
    prev = at;
  }
  // Placement is forced: the slices other tests take start at "Scheduled jobs"
  // and at the Monitoring zone, so the grid must sit wholly before both.
  assert.ok(prev < P.indexOf('title="Scheduled jobs"'), 'an H16 zone moved below Scheduled jobs');
  assert.ok(P.indexOf('data-testid="hq-platform-h16"') < P.indexOf('title="Scheduled jobs"'));
});

test('each console is linked once, from its own panel, by a literal path', () => {
  const links = [
    ['/admin?tab=integration-keys', 'hq-h16-link-keys'],
    ['/admin?tab=github', 'hq-h16-link-sync'],
    ['/admin?tab=payments', 'hq-h16-link-payments'],
    ['/admin?tab=promos', 'hq-h16-link-promos'],
  ];
  for (const [to, testid] of links) {
    assert.equal(count(P, `to="${to}"`), 1, `${to} is linked ${count(P, `to="${to}"`)} times on the page`);
    const at = P.indexOf(`to="${to}"`);
    assert.ok(P.slice(at, at + 120).includes(`data-testid="${testid}"`), `${to} is not the ${testid} link`);
  }
  // Operator consoles keeps only the two consoles with no panel here.
  const zone = P.slice(P.indexOf('data-testid="hq-platform-consoles"'), P.indexOf('<Zone title="Feature flags"'));
  assert.deepEqual([...zone.matchAll(/to="([^"]+)"/g)].map((m) => m[1]), ['/monitoring', '/admin/telegram']);
});

test('the four panels each render exactly one console link, and it is the right one', () => {
  const cases = [
    [IntegrationKeysPanel, { keys: { available: false, reason: 'x' } }, '/admin?tab=integration-keys'],
    [GithubSyncPanel, { unreadable: true }, '/admin?tab=github'],
    [PaymentsCatalogPanel, { unreadable: true }, '/admin?tab=payments'],
    [PromoCodesPanel, { promos: { available: false, reason: 'x' } }, '/admin?tab=promos'],
  ];
  for (const [Panel, props, to] of cases) {
    const html = render(Panel, props);
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replaceAll('&amp;', '&'));
    assert.deepEqual(hrefs, [to], `${Panel.name} renders ${JSON.stringify(hrefs)}`);
  }
});

// ─────────────────────────────────────────────────── P1 · Integration keys ──

const KEYS = {
  available: true,
  managed: 3,
  db_readable: true,
  db_reason: null,
  counts: { env: 1, db: 1, unset: 1, unreadable: 0 },
  items: [
    { provider_key: 'slack', state: 'env', last_set_at: '2026-03-03 08:00:00', last_set_basis: 'console_audit' },
    { provider_key: 'hubspot', state: 'db', last_set_at: '2026-02-10 12:00:00', last_set_basis: 'd1_row' },
    { provider_key: 'gcip', state: 'unset', last_set_at: null, last_set_basis: null },
  ],
  last_set_available: true,
  last_set_reason: 'A key held as a Worker secret is dated by the last save…',
  notes: ['Google sign-in is set at deploy…', 'The GitHub token belongs to the ticket mirror…'],
};

test('P1: loading, the summary failing and the block failing are three states, none a list', () => {
  const loading = render(IntegrationKeysPanel, { loading: true });
  assert.match(loading, /Reading the keys/);
  const failed = render(IntegrationKeysPanel, { unreadable: true });
  assert.match(failed, /platform summary could not be read/);
  const block = render(IntegrationKeysPanel, { keys: { available: false, reason: 'The managed keys could not be read.' } });
  assert.match(block, /The managed keys could not be read/);
  for (const html of [loading, failed, block]) {
    assert.ok(!html.includes('data-testid="hq-keys-list"'), 'a list was drawn with nothing behind it');
    assert.ok(html.includes('data-testid="hq-keys-no-reveal"'), 'the no-reveal sentence went missing');
  }
});

test('P1: each key reads where it lives, dated only by what stored the date', () => {
  const html = render(IntegrationKeysPanel, { keys: KEYS });
  const t = text(html);
  const counts = text(html.slice(html.indexOf('data-testid="hq-keys-counts"'), html.indexOf('</p>', html.indexOf('data-testid="hq-keys-counts"'))));
  assert.match(counts, /3 managed · 1 as Worker secrets · 1 in the database · 1 not set/);
  assert.ok(!/unknown/i.test(counts), 'a zero unknown count was drawn');
  assert.match(t, /Slack Worker secret saved from the console 2026-03-03 08:00/);
  assert.match(t, /HubSpot In the database row written 2026-02-10 12:00/);
  assert.match(t, /Google Identity \(SMS\) Not set/);
  assert.equal(keyDateLine({ state: 'env', last_set_basis: 'no_record' }), 'no date: set at deploy, or before the console recorded its saves');
  assert.equal(keyDateLine({ state: 'db', last_set_basis: 'no_record' }), 'no date on its row');
  assert.match(keyDateLine({ state: 'env', last_set_basis: 'unreadable' }), /audit log could not be read/);
  assert.equal(keyDateLine({ state: 'unset', last_set_basis: null }), null, 'an unset key was given a date line');
});

test('P1: an unreadable key table draws Unknown with its reason, never Not set', () => {
  const keys = {
    ...KEYS,
    db_readable: false,
    db_reason: 'The key table could not be read, so a key not set as a Worker secret may or may not be held there.',
    counts: { env: 1, db: 0, unset: 0, unreadable: 2 },
    items: [
      { provider_key: 'slack', state: 'env', last_set_at: null, last_set_basis: 'no_record' },
      { provider_key: 'hubspot', state: 'unreadable', last_set_at: null, last_set_basis: null },
      { provider_key: 'gcip', state: 'unreadable', last_set_at: null, last_set_basis: null },
    ],
  };
  const html = render(IntegrationKeysPanel, { keys });
  const t = text(html);
  assert.ok(html.includes('data-testid="hq-keys-db-unreadable"'), 'the unreadable table was not said');
  assert.match(t, /may or may not be held there/);
  assert.match(t, /· 2 unknown/);
  assert.match(t, /HubSpot Unknown/);
  assert.ok(!/HubSpot Not set/.test(t), 'an unread key was drawn as a measured absence');
  assert.deepEqual(Object.keys(KEY_STATE).sort(), ['db', 'env', 'unreadable', 'unset'],
    'the page\'s key states are not exactly the route\'s four');
});

test('P1: a provider the label map does not know shows its key, and the map is the console\'s own', () => {
  const html = render(IntegrationKeysPanel, {
    keys: { ...KEYS, items: [{ provider_key: 'newco', state: 'unset', last_set_at: null, last_set_basis: null }] },
  });
  assert.match(text(html), /newco Not set/);
  // AdminPage's PROVIDER_LABELS is the Integration keys console's; the two maps
  // must name every key the same way, and name exactly the worker's list.
  const admin = raw('frontend/src/pages/AdminPage.jsx');
  const a = admin.indexOf('const PROVIDER_LABELS = {');
  assert.ok(a > 0, 'AdminPage no longer declares PROVIDER_LABELS');
  const body = admin.slice(a, admin.indexOf('};', a));
  const consoleLabels = Object.fromEntries([...body.matchAll(/^\s*(\w+): '([^']+)',/gm)].map((m) => [m[1], m[2]]));
  assert.deepEqual(PROVIDER_LABEL, consoleLabels);
  const worker = raw('cloudflare-worker/src/services/providerOauthKeys.ts');
  const w = worker.indexOf('export const MANAGED_PROVIDERS');
  const list = worker.slice(w, worker.indexOf('];', w));
  const managed = [...list.matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
  assert.deepEqual(Object.keys(PROVIDER_LABEL).sort(), [...managed].sort());
});

test('P1: no screen is said to reveal a saved key, and nothing is said to re-hide', () => {
  // The artboard draws "reveal 30s" and a re-hide. Neither exists: a saved key
  // is write-only. The only sentences that may name them are the ones that
  // say so, and the old "reveal and revoke live on the console" claim is gone.
  assert.ok(!PAGE.includes('Reveal and revoke live where'), 'the stale reveal claim came back');
  assert.ok(!/reveal and revoke/i.test(PAGE), 'the page claims a reveal exists');
  for (const m of PAGE.matchAll(/re-hide/g)) {
    // The qualifier can come either side of the word ("nothing here re-hides",
    // "…re-hide after thirty seconds\" is drawn nowhere"), so the window is the sentence.
    const around = PAGE.slice(Math.max(0, m.index - 220), m.index + 80);
    assert.ok(/No screen reveals|nothing here|drawn nowhere/.test(around), `an unqualified re-hide claim: …${around}…`);
  }
  const route = raw('cloudflare-worker/src/routes/admin_platform.ts');
  assert.ok(!/reveal and revoke live/i.test(route), 'the route header still claims a reveal exists');
});

// ─────────────────────────────────────────────────────── P2 · GitHub Sync ──

const SYNC = {
  target: { token_set: true, repo: 'acme/repo', configured: true },
  window: { available: true, window_hours: 24, synced: 4, failed: 1, not_configured: 0, lag: { value: null, reason: 'Not recorded: a ticket keeps only its latest attempt.' } },
  recent: {
    available: true,
    items: [
      { ticket_id: 12, issue_number: null, status: 'failed', error: 'Validation Failed', attempted_at: '2026-01-05 11:00:00' },
      { ticket_id: 9, issue_number: 41, status: 'synced', error: null, attempted_at: '2026-01-05T10:00:00.000Z' },
      { ticket_id: 7, issue_number: null, status: 'queued', error: null, attempted_at: '2026-01-04 10:00:00' },
    ],
  },
  recent_note: 'A ticket keeps only its latest mirror attempt…',
};

test('P2: the target names the repository only when the route does, and says the mirror is off', () => {
  let t = text(render(GithubSyncPanel, { sync: SYNC }));
  assert.match(t, /Mirrors tickets to acme\/repo · token set/);
  const off = render(GithubSyncPanel, {
    sync: { ...SYNC, target: { token_set: true, repo: null, configured: false } },
  });
  t = text(off);
  assert.match(t, /No repository is named: the mirror needs both halves of it set, and never falls back to a default/);
  assert.ok(off.includes('data-testid="hq-sync-off"'), 'a mirror that cannot run was not said to be off');
  assert.ok(!t.includes('AxalNetwork/StudioOS'), 'a default repository was drawn');
});

test('P2: the day\'s counts, a lag that is not recorded, and each attempt linked to its ticket', () => {
  const html = render(GithubSyncPanel, { sync: SYNC });
  const t = text(html);
  assert.match(t, /Synced \(24h\) 4/);
  assert.match(t, /Failed \(24h\) 1/);
  assert.match(t, /Average lag/);
  assert.match(t, /not recorded/);
  for (const id of [12, 9, 7]) assert.ok(html.includes(`href="/help/tickets/${id}"`), `ticket ${id} is not linked`);
  assert.match(t, /issue #41/);
  assert.match(t, /Validation Failed/);
  // A status the page has no tone for draws as itself, never as a known state.
  assert.match(t, /Ticket #7 queued/);
  assert.deepEqual(Object.keys(SYNC_STATE).sort(), ['failed', 'not_configured', 'synced']);
});

test('P2: an unreadable window or list says why; an empty list says it is empty, not unreadable', () => {
  const html = render(GithubSyncPanel, {
    sync: {
      ...SYNC,
      window: { available: false, reason: 'The mirror status could not be read on this database. Its columns arrive with migration 273.' },
      recent: { available: false, reason: 'The mirror status could not be read on this database. Its columns arrive with migration 273.' },
    },
  });
  const t = text(html);
  assert.equal(count(t, 'migration 273'), 2);
  assert.ok(!html.includes('data-testid="hq-sync-stats"'), 'counts were drawn for an unreadable window');
  const empty = text(render(GithubSyncPanel, { sync: { ...SYNC, recent: { available: true, items: [] } } }));
  assert.match(empty, /That is an empty list, not an unreadable one/);
});

// ─────────────────────────────────────────────────── P3 · Payments catalog ──

const PAYMENTS = {
  publishable: { configured: true, masked: 'pk_live_••••mnop', mode: 'live' },
  catalog: {
    available: true, products: { all: 4, active: 3 }, prices: { all: 3, active: 2 },
    unreadable_price_rows: 2, last_written_at: '2026-01-05 11:00:00', sync_basis: 'Nothing schedules a sync of this mirror.',
  },
  webhook: {
    available: true, window_hours: 24, deliveries: 3, not_2xx: 1,
    last: { status_code: 200, latency_ms: 41, at: '2026-01-05 12:00:00' }, basis: 'Read from the request log.',
  },
  storefront_note: 'Each deployment reads its own mirror of its own Stripe catalog.',
};

test('P3: the key checkout is served, the mirror counts, and the webhook\'s day', () => {
  const html = render(PaymentsCatalogPanel, { payments: PAYMENTS });
  const t = text(html);
  assert.match(t, /pk_live_••••mnop live mode/);
  assert.match(t, /3 active of 4/);
  assert.match(t, /2 active of 3/);
  assert.match(t, /2 products have a price list that could not be read, and are not counted/);
  assert.match(t, /Mirror last written 2026-01-05 11:00/);
  assert.match(t, /HTTP 200 in 41ms · 2026-01-05 12:00/);
  assert.match(t, /3 in 24h · 1 not 2xx/);
  assert.match(t, /Nothing schedules a sync/);
  assert.match(t, /Each deployment reads its own mirror/);
});

test('P3: no key, an unknown mode, a missing status and no delivery each say what they are', () => {
  const t = text(render(PaymentsCatalogPanel, {
    payments: {
      ...PAYMENTS,
      publishable: { configured: false, masked: null, mode: null },
      catalog: { ...PAYMENTS.catalog, unreadable_price_rows: 0, last_written_at: null },
      webhook: { ...PAYMENTS.webhook, last: null, deliveries: 0, not_2xx: 0 },
    },
  }));
  assert.match(t, /Not configured: checkout is served no key/);
  assert.match(t, /never written/);
  assert.match(t, /no delivery recorded/);
  assert.ok(!/could not be read/.test(t), 'a readable price list was said to be unreadable');
  const odd = render(PaymentsCatalogPanel, {
    payments: {
      ...PAYMENTS,
      publishable: { configured: true, masked: 'rk_l••••', mode: 'unknown' },
      webhook: { ...PAYMENTS.webhook, last: { status_code: null, latency_ms: null, at: '2026-01-05 12:00:00' } },
    },
  });
  assert.match(text(odd), /mode unknown/);
  assert.match(text(odd), /status not recorded · 2026-01-05 12:00/);
  assert.ok(!text(odd).includes('HTTP ?'), 'a missing status was drawn as a placeholder');
});

test('P3: a refused delivery is red; an unreadable log is red and says why, never a count', () => {
  const refused = render(PaymentsCatalogPanel, {
    payments: { ...PAYMENTS, webhook: { ...PAYMENTS.webhook, last: { status_code: 500, latency_ms: 9, at: '2026-01-05 12:00:00' } } },
  });
  assert.match(refused, /class="text-red-700 dark:text-red-300">HTTP 500/);
  const ok = render(PaymentsCatalogPanel, { payments: PAYMENTS });
  assert.ok(!/text-red-700[^>]*>HTTP 200/.test(ok), 'a 2xx delivery was drawn as a refusal');
  const gone = render(PaymentsCatalogPanel, {
    payments: {
      ...PAYMENTS,
      webhook: { available: false, window_hours: 24, reason: 'The request log could not be read, so the webhook\'s deliveries are unknown rather than none.' },
    },
  });
  assert.ok(gone.includes('data-testid="hq-pay-webhook-unreadable"'));
  assert.match(text(gone), /unknown rather than none/);
  assert.ok(!/not 2xx/.test(text(gone)), 'an unreadable log drew counts');
});

test('P3: an unreadable mirror says why, and the summary failing is not a catalog', () => {
  const t = text(render(PaymentsCatalogPanel, {
    payments: { ...PAYMENTS, catalog: { available: false, reason: 'The catalog mirror could not be read on this database.' } },
  }));
  assert.match(t, /catalog mirror could not be read/);
  assert.ok(!/active of/.test(t), 'counts were drawn for an unreadable mirror');
  assert.match(text(render(PaymentsCatalogPanel, { unreadable: true })), /platform summary could not be read/);
  assert.match(text(render(PaymentsCatalogPanel, { loading: true })), /Reading the catalog/);
});

// ─────────────────────────────────────────────────────── P4 · Promo codes ──

const PROMOS = {
  available: true,
  total: 4,
  counts: { active: 1, inactive: 1, expired: 1, exhausted: 1 },
  items: [
    { code: 'LIVE', state: 'active', percent_off: 25, amount_off: null, currency: null, duration: 'once', product_count: 0, max_redemptions: null, times_redeemed: 2, expires_at: null },
    { code: 'AMT', state: 'exhausted', percent_off: null, amount_off: 500, currency: 'usd', duration: 'repeating', product_count: 2, max_redemptions: 3, times_redeemed: 3, expires_at: null },
    { code: 'BAD', state: 'expired', percent_off: 10, amount_off: null, currency: null, duration: 'forever', product_count: null, max_redemptions: null, times_redeemed: 0, expires_at: '2026-01-01T00:00:00.000Z' },
    { code: 'OFF', state: 'inactive', percent_off: 5, amount_off: null, currency: null, duration: 'once', product_count: 1, max_redemptions: 10, times_redeemed: 1, expires_at: null },
  ],
  listed_limit: 50,
  truncated: false,
  caveats: ['Redemptions are the ones this platform recorded.', 'A code names no licence and no cohort.'],
};

test('P4: every code\'s terms, cap, recorded redemptions and one state', () => {
  const html = render(PromoCodesPanel, { promos: PROMOS });
  const t = text(html);
  assert.match(t, /4 codes · 1 active · 1 switched off · 1 expired · 1 at their cap/);
  assert.match(t, /LIVE 25% off · once · all products · no expiry set 2 recorded · no cap Active/);
  assert.match(t, /AMT 5\.00 USD off · repeating, for months Stripe keeps · 2 products · no expiry set 3 recorded of 3 At its cap/);
  assert.match(t, /BAD 10% off · every payment · product list unreadable · expires 2026-01-01 00:00 0 recorded · no cap Expired/);
  assert.match(t, /OFF 5% off · once · 1 product · no expiry set 1 recorded of 10 Switched off/);
  assert.match(t, /Redemptions are the ones this platform recorded/);
  assert.ok(!html.includes('data-testid="hq-promo-truncated"'), 'a complete list said it was cut');
  assert.deepEqual(Object.keys(PROMO_STATE).sort(), ['active', 'exhausted', 'expired', 'inactive'],
    'the page\'s promo states are not exactly promoState\'s four');
});

test('P4: a state the page does not know draws as itself, never borrowed from a known one', () => {
  const t = text(render(PromoCodesPanel, {
    promos: { ...PROMOS, items: [{ ...PROMOS.items[0], code: 'ODD', state: 'paused' }] },
  }));
  assert.match(t, /ODD .* paused/);
  // The pill labels are capitalised and the counts line is not, so a label
  // appearing at all means the one row borrowed it.
  for (const [label] of Object.values(PROMO_STATE)) {
    assert.ok(!t.includes(label), `an unknown state borrowed the label "${label}"`);
  }
});

test('P4: all products, an unreadable list and a missing discount are three different phrases', () => {
  assert.match(promoTerms({ percent_off: 5, duration: 'once', product_count: 0 }), /all products$/);
  assert.match(promoTerms({ percent_off: 5, duration: 'once', product_count: null }), /product list unreadable$/);
  assert.match(promoTerms({ percent_off: null, amount_off: null, duration: 'once', product_count: 0 }), /^no discount recorded/);
});

test('P4: a cut list says so and the counts still cover every code; an empty one is empty', () => {
  const cut = render(PromoCodesPanel, { promos: { ...PROMOS, total: 55, truncated: true } });
  assert.match(text(cut), /The newest 50 of 55 are listed; the counts above cover every code/);
  const empty = text(render(PromoCodesPanel, {
    promos: { ...PROMOS, total: 0, counts: { active: 0, inactive: 0, expired: 0, exhausted: 0 }, items: [] },
  }));
  assert.match(empty, /No promo code exists\. That is an empty list, not an unreadable one/);
  const gone = text(render(PromoCodesPanel, { promos: { available: false, reason: 'The promo code mirror could not be read, so no code is listed rather than none existing.' } }));
  assert.match(gone, /rather than none existing/);
  assert.ok(!/codes ·/.test(gone), 'an unreadable mirror drew counts');
});

// ───────────────────────────────────────────── honesty across the four ──

test('no panel draws a bare dash for a value it does not have', () => {
  const htmls = [
    render(IntegrationKeysPanel, { keys: KEYS }),
    render(GithubSyncPanel, { sync: SYNC }),
    render(PaymentsCatalogPanel, { payments: PAYMENTS }),
    render(PromoCodesPanel, { promos: PROMOS }),
  ];
  for (const html of htmls) {
    assert.ok(!/>\s*[—–-]\s*</.test(html), 'a bare dash stands in for a value');
  }
});

test('the rail names the five things H16 draws that nothing stores, one literal row each', () => {
  const a = P.indexOf('unavailable={[');
  const b = P.indexOf(']}', a);
  const rows = P.slice(a, b);
  for (const title of ['Key material', 'Secret reveal', 'Key expiry', 'Mirror lag', 'Catalog schedule', 'Code attribution']) {
    assert.equal(count(rows, `['${title}', '`), 1, `the rail's "${title}" row is missing or doubled`);
  }
  assert.ok(!/Reveal and revoke live/.test(rows), 'the rail still claims a reveal exists');
  const cov = P.slice(P.indexOf('const coverage = ['), P.indexOf('].filter(Boolean);'));
  for (const probe of ['integrationKeys?.available', 'githubSync?.window?.available', 'paymentsCatalog?.catalog?.available', 'promoCodes?.available']) {
    assert.ok(cov.includes(probe), `the rail reads back nothing from ${probe}`);
  }
});

test('Revenue labels its active-code count by the rule it now counts with', () => {
  const rev = raw('frontend/src/pages/hq/RevenuePage.jsx');
  assert.ok(rev.includes('note="switched on, unexpired, under their recorded cap"'), 'Revenue\'s note says less than it counts');
  assert.ok(!rev.includes('redeemable now'), 'Revenue still says "redeemable now" of a count that is not');
});
