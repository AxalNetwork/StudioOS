/**
 * #1524 item 2 — the data room page lists the accounts the scoring report was
 * shared with, read-only, beside the room's own grants.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/data_room_report_shares_d663.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReportShares } from '../src/pages/raise/DataRoomPage.jsx';

const html = (shares) => renderToStaticMarkup(h(ReportShares, { shares }));
const text = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim();

const SHARE = (o = {}) => ({ id: 11, report_kind: 'scoring', audience: 'investor', grantee_email: 'ivy@example.com', grantee_name: 'Ivy', opens: 1, open_limit: 5, expires_at: '2999-01-01 00:00:00', created_at: '2026-10-01', status: 'active', ...o });

test('each share names the account, says it opens the report and not the files, and its state', () => {
  const out = html([SHARE(), SHARE({ id: 12, grantee_name: null, grantee_email: 'oz@example.com', status: 'used_up', opens: 2, open_limit: 2 }), SHARE({ id: 13, status: 'revoked' }), SHARE({ id: 14, status: 'expired' })]);
  const t = text(out);
  assert.match(t, /^Scoring report shared with These accounts can open the scoring report, not the files above\. Each link is made and revoked from the report's Share button\./);
  assert.match(t, /Ivy ivy@example\.com · Scoring report · active · 1 of 5 opens · until /);
  assert.match(t, /oz@example\.com Scoring report · every open used · 2 of 2 opens/);
  assert.match(t, /Scoring report · revoked/);
  assert.match(t, /Scoring report · expired/);
  assert.doesNotMatch(out, /<button/, 'read-only: no revoke here');
});

test('an unread list says so and claims nothing; an empty list draws nothing', () => {
  assert.match(text(html(null)), /The report shares could not be read\. This is not a claim that the report was shared with no one\./);
  assert.equal(html([]), '');
  assert.equal(html(undefined), '');
});

test('a state word the read does not know is printed as given, never looked up on the prototype', () => {
  assert.match(text(html([SHARE({ status: 'constructor' })])), /Scoring report · constructor ·/);
});

test('the page draws the list beside the grants, from the room read', () => {
  const src = readFileSync(resolve(process.cwd(), 'frontend/src/pages/raise/DataRoomPage.jsx'), 'utf8');
  assert.match(src, /<ReportShares shares=\{room\?\.report_shares\} \/>\s*\n\s*\{\/\* The second grant type/);
});
