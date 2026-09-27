/**
 * D465 — the investor Network book's cold flag reads the interaction log, and
 * the reminders are a store.
 *
 * IN1's book is built on the cold flag, and `partner_relationships` recorded
 * no interaction date — the only history was the row's own creation. Now
 * `partner_interactions` is the log and `last_interaction_at` is its MAX on
 * every row; `partner_reminders` is the reminder store, surfaced on the desk
 * when due (no notification fan-out). The re-engagement band's draft surface
 * is Session 2's (research.ts) and the page names it as missing rather than
 * mounting a dead band.
 *
 * The advisor side is deliberately untouched: `advisor_network_zones` pins
 * `last_interaction_at` absent there, and this store is the investor book's.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import { INVESTOR_ZONE_FILTERS } from '../src/workspaces/investorZoneFilters.js';
import { COLD_AFTER_DAYS } from '../src/lib/networkBook.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const PAGE = codeOnly(read('frontend/src/pages/investor/InvestorNetworkWorkspace.jsx'));
const API = read('frontend/src/lib/api.js');
const ROUTE = read('cloudflare-worker/src/routes/partnernet.ts');

test('the book reads the log’s MAX, and the cold chip narrows on the shared window', () => {
  // The route carries the log's MAX on every row.
  assert.match(ROUTE, /SELECT MAX\(i\.interacted_at\)[\s\S]*as last_interaction_at/,
    'the relationships read stopped carrying the log’s MAX');
  // The page reads it FIRST — never a field someone edits.
  assert.match(PAGE, /relationship\?\.last_interaction_at/, 'the page stopped reading the log');
  // The cold chip is live and narrows on the shared 60-day window.
  const row = INVESTOR_ZONE_FILTERS['network/relationships'].find((r) => r.canvas === 'Going cold');
  assert.equal(row.key, 'cold', 'Going cold must be a live chip');
  assert.match(PAGE, /bookView === 'cold'/, 'the page never reads the cold view');
  // The cold branch NARROWS — pinned on the branch itself, because the same
  // helpers also serve the header's cold count and a file-wide match cannot
  // tell a chip that narrows from one that selects everything (found by
  // mutation).
  const branch = PAGE.slice(PAGE.indexOf("const visibleRelationships"));
  assert.match(branch, /bookView === 'cold'\s*\?\s*\(relationships \|\| \[\]\)\.filter\(\(item\) => \{ const d = daysSince\(lastTouchAt\(item\)\); return d !== null && d > COLD_AFTER_DAYS; \}\)/,
    'the cold chip selects everything');
  assert.equal(COLD_AFTER_DAYS, 60, 'the canvas’s cold window moved — re-check the chip');
  // A tie with no recorded touch is unknown, not cold — said in the empty view.
  assert.match(PAGE, /unknown, not cold/, 'an untouched tie must not read as cold');
});

test('the reminders and the touch log are wired to their stores', () => {
  assert.match(PAGE, /api\.partnerReminderSet\(rel\.id, \{/, 'the reminder form is unwired');
  assert.match(PAGE, /api\.partnerReminders\(\)/, 'the due reminders are never read');
  assert.match(PAGE, /api\.partnerReminderDone\(uid, true\)/, 'the done write is gone');
  assert.match(PAGE, /api\.partnerInteractionAdd\(rel\.id, body/, 'the touch log write is gone');
  assert.match(API, /partnerReminderSet: \(id, data\) =>/, 'api.js lost the reminder write');
  assert.match(API, /partnerInteractionAdd: \(id, data\) =>/, 'api.js lost the touch write');
  // The op is the page's, and it opens on a tie rather than into thin air.
  assert.match(PAGE, /handlers: \{ setReminders: setRemindersOp \}/, 'the Set reminders op is not the page’s');
  // A reminder is a date: the page refuses an empty one before the route is asked.
  assert.match(PAGE, /if \(!reminderDate\)/, 'the page stopped refusing a dateless reminder');
});

test('the re-engagement band is named as missing rather than mounted dead', () => {
  // The canvas's AI band drafts re-engagement lines; the draft surface is
  // Session 2's (research.ts), so the page names it instead of mounting a
  // band that would 400.
  assert.match(PAGE, /Re-engagement lines are not drafted here yet/, 'the missing draft surface is no longer named');
  assert.ok(!/surface="network\/relationships"/.test(PAGE),
    'a draft band mounted without its surface — it would 400 on every run');
});
