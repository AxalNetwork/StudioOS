/**
 * #5314 part 1 (D4822): the client opens a shared deliverable through the
 * Worker, and the firm's Deliverables log draws Never opened / Not recorded
 * from that read rather than hiding them.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const needs = read('src/pages/NeedsBoardPage.jsx');
const zone = read('src/pages/partner/delivery/DeliverablesZone.jsx');
const apiModule = read('src/lib/api/clientDeliverables.js');

test('the client opens a deliverable through the recording route, not the bare link', () => {
  assert.match(apiModule, /open: \(uid\) => request\(`\/client\/deliverables\/\$\{encodeURIComponent\(uid\)\}\/open`, \{ method: 'POST' \}\)/);
  const block = needs.slice(needs.indexOf('function SharedDeliverables'), needs.indexOf('function ErrorBox'));
  assert.ok(block.includes('await clientDeliverablesApi.open(item.uid)'), 'Open no longer records the open');
  assert.ok(!/href=\{item\.link_url\}/.test(block), 'a bare link would open without recording it');
  // Only the client sees it: a partner opening the modal records nothing.
  assert.match(needs, /\{isFounder && <SharedDeliverables engagementId=\{eng\.id\} \/>\}/);
  // A read failure is Unreadable, never an empty list.
  assert.ok(block.includes('Shared deliverables are unreadable right now'));
});

test('the log counts Never opened only from rows the Worker says could have been opened', () => {
  assert.match(zone, /const unopened = items\.filter\(\(r\) => r\.is_unopened === true\);/);
  // A Not recorded row says which absence it is, and never "ignored".
  assert.ok(zone.includes("'sent before client opens were recorded'"));
  assert.ok(zone.includes("'sent without a link, so the client has nothing to open here'"));
  // The median is the Worker's, and stays Not recorded while it is null.
  assert.match(zone, /nr=\{readsUnavailable \|\| d\?\.median_days_to_open == null\}/);
  // An open of an earlier version is not passed off as a read of this one.
  assert.match(zone, /row\.opened_current === false/);
});
