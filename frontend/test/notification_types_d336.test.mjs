/**
 * D336 — the notification type → label map lives in one file and both
 * callers use it, instead of the bell/`/inbox` row rendering the raw
 * backend `type` key while only the Settings matrix had a label for it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { labelForType, NOTIFICATION_EVENTS, PARTNER_NOTIFICATION_EVENTS } from '../src/lib/notificationTypes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('a known type returns its matrix label', () => {
  assert.equal(labelForType('score_generated'), 'New score generated for your startup');
  assert.equal(labelForType('partner_kyc_block'), 'A founder you backed is blocked on KYC');
});

test('an unknown type titleises rather than rendering blank or raw', () => {
  assert.equal(labelForType('some_future_event_type'), 'Some Future Event Type');
  assert.equal(labelForType(''), 'Notification');
  assert.equal(labelForType(null), 'Notification');
});

test('every NOTIFICATION_EVENTS/PARTNER_NOTIFICATION_EVENTS key is unique', () => {
  const keys = [...NOTIFICATION_EVENTS, ...PARTNER_NOTIFICATION_EVENTS].map((e) => e.key);
  assert.equal(new Set(keys).size, keys.length, 'a duplicate event key would make one label shadow another');
});

test('SettingsPage.jsx imports the shared map instead of declaring its own', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/pages/SettingsPage.jsx'), 'utf8');
  assert.match(src, /import \{ NOTIFICATION_EVENTS, PARTNER_NOTIFICATION_EVENTS \} from '\.\.\/lib\/notificationTypes'/);
  assert.doesNotMatch(src, /const NOTIFICATION_EVENTS = \[/, 'SettingsPage redeclared its own copy of the matrix');
});

test('NotificationList.jsx renders labelForType(n.type), not the raw key', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/components/NotificationList.jsx'), 'utf8');
  assert.match(src, /\{labelForType\(n\.type\)\}/);
  assert.doesNotMatch(src, /\{n\.type\}/, 'the row still renders the raw backend type key somewhere');
});

test('App.jsx redirects /notifications and /notifications/* to /inbox', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/App.jsx'), 'utf8');
  assert.match(src, /<Route path="\/notifications" element=\{<Navigate to="\/inbox" replace \/>\}\s*\/>/);
  assert.match(src, /<Route path="\/notifications\/\*" element=\{<Navigate to="\/inbox" replace \/>\}\s*\/>/);
});
