/**
 * #1524 item 2 — the data room lists the accounts the scoring report was
 * shared with, read-only, beside the room's own grants. D1109 (#2989) moved
 * the list out of the retired files tool (`DataRoomPage.jsx`) into the tool's
 * Access tab: `raise/dataroom/ReportShares.jsx` words each share, every state
 * included, and Access draws them.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/data_room_report_shares_d663.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReportShareRows, reportShareLine } from '../src/pages/raise/dataroom/ReportShares.jsx';

const html = (shares) => renderToStaticMarkup(h(ReportShareRows, { shares }));
const text = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim();

const SHARE = (o = {}) => ({ id: 11, report_kind: 'scoring', audience: 'investor', grantee_email: 'ivy@example.com', grantee_name: 'Ivy', opens: 1, open_limit: 5, expires_at: '2999-01-01 00:00:00', created_at: '2026-10-01', status: 'active', ...o });

test('each share names the account and its state, a revoked or used-up link included', () => {
  const out = html([SHARE(), SHARE({ id: 12, grantee_name: null, grantee_email: 'oz@example.com', status: 'used_up', opens: 2, open_limit: 2 }), SHARE({ id: 13, status: 'revoked' }), SHARE({ id: 14, status: 'expired' })]);
  const t = text(out);
  assert.match(t, /Ivy ivy@example\.com · Scoring report · active · 1 of 5 opens · until 1 Jan 2999/);
  assert.match(t, /oz@example\.com Scoring report · every open used · 2 of 2 opens/);
  assert.match(t, /Scoring report · revoked/);
  assert.match(t, /Scoring report · expired/);
  assert.doesNotMatch(out, /<button/, 'read-only: no revoke here');
});

test('an end date that cannot be read is said, never invented', () => {
  assert.match(reportShareLine(SHARE({ expires_at: null })).detail, /until a date not recorded$/);
});

test('a state word the read does not know is printed as given, never looked up on the prototype', () => {
  assert.match(text(html([SHARE({ status: 'constructor' })])), /Scoring report · constructor ·/);
});

test('Access draws every share from the room read, an unread list says so, and none is filtered to active only', () => {
  const src = readFileSync(resolve(process.cwd(), 'frontend/src/pages/raise/dataroom/DataRoomAccess.jsx'), 'utf8');
  assert.ok(src.includes('const shares = Array.isArray(room?.report_shares) ? room.report_shares : null;'));
  assert.ok(src.includes("shares.length ? <ReportShareRows shares={shares} />"));
  assert.ok(src.includes('<Unreadable what="The report shares" claim="This is not a claim that the report is shared with no one."'));
  assert.doesNotMatch(src, /report_shares\.filter\(/, 'a revoked share was hidden');
});
