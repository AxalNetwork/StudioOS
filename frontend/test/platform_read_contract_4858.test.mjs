/**
 * D4858 (#4858) — HQ · Platform draws each panel's read from the summary's `reads`, and the catalogue's last sync from
 * the catalogue's own record.
 *
 * What is pinned:
 *   - `readLine`: ready, partial and unavailable each read in words, with the read time, the source's last change
 *     only where it is known, the source, and the reason for anything but ready;
 *   - the Payments catalog panel's last manual sync: succeeded, failed (in red) and Not recorded, from `catalog.sync`;
 *     an unreadable change log says so rather than "never failed";
 *   - every summary-backed zone on the page passes its read.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/platform_read_contract_4858.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { PaymentsCatalogPanel, readLine, syncStateText, syncHistoryText } from '../src/pages/hq/PlatformPage.jsx';

const PAGE = readFileSync(resolve(process.cwd(), 'frontend/src/pages/hq/PlatformPage.jsx'), 'utf8');
const render = (C, props) => renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(C, props)));
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

const META = { status: 'ready', read_at: '2026-11-07T12:00:00.000Z', source_updated_at: null, complete: true, completeness_reason: null, source: 'promo_codes (D1)' };

test('readLine: each state in words, the source time only where known, the reason only when not ready', () => {
  assert.equal(readLine(META), 'Read in full at 2026-11-07 12:00 UTC · from promo_codes (D1).');
  assert.equal(
    readLine({ ...META, source_updated_at: '2026-11-06 10:00:00' }),
    'Read in full at 2026-11-07 12:00 UTC · source last changed 2026-11-06 10:00 UTC · from promo_codes (D1).',
  );
  assert.equal(
    readLine({ ...META, status: 'partial', complete: false, completeness_reason: 'Half of it.' }),
    'Partly read at 2026-11-07 12:00 UTC · from promo_codes (D1). Half of it.',
  );
  assert.match(readLine({ ...META, status: 'unavailable', complete: false, completeness_reason: 'Gone.' }), /^Not read .* Gone\.$/);
  assert.equal(readLine({ ...META, completeness_reason: 'stray' }), 'Read in full at 2026-11-07 12:00 UTC · from promo_codes (D1).', 'a ready read shows no reason');
  for (const bad of [null, undefined, 'x', {}, { status: 'fine' }]) assert.equal(readLine(bad), null, JSON.stringify(bad));
});

const CATALOG = {
  available: true, stripe_mode: 'live', products: { all: 1, active: 1 }, prices: { all: 1, active: 1 },
  other_mode: { mode: 'test', products: 0 }, unknown_mode: { products: 0 }, unreadable_price_rows: 0,
  last_written_at: '2026-11-06 10:00:00', sync_basis: 'Nothing schedules a sync of this mirror.',
};
const panel = (catalog) => text(render(PaymentsCatalogPanel, {
  payments: { publishable: { configured: true, masked: 'pk_live_••••', mode: 'live' }, catalog, webhook: { available: false, reason: 'n/a' }, storefront_note: '' },
}));
const hist = (over = {}) => ({ mode: 'on_demand', failed_syncs_recorded: true, history_readable: true, last_succeeded_at: null, last_failed_at: null, source: 's', ...over });

test('the last manual sync is the catalogue\'s own record: succeeded, failed or Not recorded', () => {
  const ok = panel({ ...CATALOG, sync_state: 'succeeded', sync: hist({ last_succeeded_at: '2026-11-06 10:00:00', last_failed_at: '2026-11-01 09:00:00' }) });
  assert.match(ok, /Last manual sync Succeeded · 2026-11-06 10:00/);
  assert.match(ok, /Last success 2026-11-06 10:00 · last failure 2026-11-01 09:00/);
  const bad = render(PaymentsCatalogPanel, {
    payments: { publishable: { configured: true, masked: 'pk', mode: 'live' }, catalog: { ...CATALOG, sync_state: 'failed', sync: hist({ last_failed_at: '2026-11-07 08:00:00' }) }, webhook: { available: false }, storefront_note: '' },
  });
  assert.match(text(bad), /Last manual sync Failed · 2026-11-07 08:00/);
  assert.match(bad, /text-red-700[^>]*>Failed/, 'a failed sync is drawn in red');
  assert.match(text(bad), /last failure 2026-11-07 08:00/);
  const none = panel({ ...CATALOG, sync_state: 'not_recorded', sync: hist() });
  assert.match(none, /Last manual sync Not recorded/);
  assert.match(none, /Last success none recorded · last failure none recorded/);
  assert.doesNotMatch(none, /not stored|leaves no record/);
});

test('an unreadable change log is unknown, never "no failures"', () => {
  assert.equal(syncHistoryText(hist({ history_readable: false })), 'The Payments change log could not be read, so the last sync is unknown.');
  assert.equal(syncStateText({ sync_state: 'not_recorded', sync: hist({ history_readable: false }) }), 'Not recorded');
  assert.equal(syncHistoryText(undefined), 'The sync history was not reported.');
  assert.match(syncHistoryText(hist({ failed_syncs_recorded: false })), /failures are not recorded/);
});

test('every summary-backed zone passes its read', () => {
  for (const [title, keys] of [
    ['Keys and connections', ['integrations']],
    ['Integration keys', ['integration_keys']],
    ['GitHub Sync', ['github_sync']],
    ['Payments catalog', ['payments_catalog']],
    ['Promo codes', ['promo_codes']],
    ['Monitoring', ['jobs', 'dlq', 'incidents']],
    ['Broadcast', ['telegram', 'x']],
    ['Feature flags', ['switches']],
  ]) {
    const re = new RegExp(`<Zone title="${title}"[^>]*reads=\\{\\[${keys.map((k) => `reads\\.${k}`).join(', ')}\\]\\}`);
    assert.match(PAGE, re, title);
  }
});
