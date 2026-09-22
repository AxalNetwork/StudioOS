/**
 * Admin Studio — the admin profile's front door.
 *
 * An admin used to land on `/studio` and fall through to the founder fit
 * block (skills, values, archetype) under Eadwyn. The branch shell's first
 * row was Home at `/branch`, the digest. Both are the old profile. Studio is
 * the row, and the page under the chat is one card per other Admin page.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import { AdminStudioOverview } from '../src/pages/admin/AdminStudioOverview.jsx';
import {
  accountLines,
  approvalsGlance,
  contractsGlance,
  freezeLine,
  insightsGlance,
  programmeGlance,
} from '../src/pages/admin/adminStudioOverview.js';
import { seatState } from '../src/pages/branch/BranchAccounts.jsx';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const HOME = read('frontend/src/pages/admin/AdminStudioHome.jsx');
import { codeOnly } from './_codeOnly.mjs';

const OVERVIEW = read('frontend/src/pages/admin/AdminStudioOverview.jsx');
const DASH = read('frontend/src/pages/Dashboard.jsx');

test('an admin render returns Admin Studio before the founder fit block', () => {
  const adminAt = DASH.indexOf("if (activeRole === 'admin' && authUser)");
  const fitAt = DASH.indexOf('<ProfileFitSection');
  assert.ok(adminAt > 0, 'Dashboard no longer has an admin return');
  assert.ok(fitAt > adminAt, 'the fit block renders for an admin');
  assert.match(DASH, /<AdminStudioHome user=\{authUser\} \/>/);
  assert.match(HOME, /<PersonalAdvisor \/>/);
  assert.ok(!HOME.includes('ProfileFitSection'), 'Admin Studio mounts the founder fit block');
  assert.ok(!HOME.includes('WorkerRail') && !OVERVIEW.includes('WorkerRail'),
    'Admin Studio mounts a second assistant beside Eadwyn');
  assert.ok(!HOME.includes('VentureNextStep') && !OVERVIEW.includes('VentureNextStep'));
});

test('the seven cards are the other Admin pages, in sidebar order, with no invented counts', () => {
  const order = ['Accounts', 'Approvals', 'Programs', 'Community', 'Contracts', 'Insights', 'Settings'];
  let at = 0;
  for (const label of order) {
    const next = OVERVIEW.indexOf(`title="${label}"`, at);
    assert.ok(next > at, `${label} is missing or out of order`);
    at = next;
  }
  assert.match(OVERVIEW, /COMMUNITY_CONSOLES/);
  assert.ok(!OVERVIEW.includes('184'), 'a sample seat count was left in the card');
  assert.ok(!/€|\$[0-9]/.test(OVERVIEW), 'a currency figure was drawn');
  // D197 — THE HOSTNAME IS NO LONGER "not recorded", because a store exists.
  // What this card must still never do is print a host without its state, or
  // claim a register it did not read. All four arms are pinned, so a later
  // edit that collapses two of them into one sentence fails here.
  assert.match(OVERVIEW, /Hostname not read/, 'an unread licence stopped being its own state');
  assert.match(OVERVIEW, /Hostname not readable/, 'an unreadable register stopped being its own state');
  assert.match(OVERVIEW, /No hostname bound/, 'a read register with no host stopped being its own state');
  assert.match(OVERVIEW, /\{lic\.domain\.hostname\}<\/b> · \{lic\.domain\.state\}/,
    'a bound host is printed without the state that says whether it serves');
  // The typed count is the defect this replaced: the branch page derives it,
  // and this card cannot, so it states no number at all.
  //
  // THE SCAN READS CODE, NOT THE FILE — "a lexical scan cannot tell a rule
  // from its violation", for the sixth time in this programme. The comment
  // above the removal quotes the sentence it removed, so a raw scan matches
  // the explanation and reports it as the offence. The pair below proves the
  // stripper did work rather than ate the file: the raw text must still carry
  // the reasoning while the rendered code must not.
  const code = codeOnly(OVERVIEW);
  assert.match(code, /admin-studio-settings/,
    'the comment stripper ate the card, so the assertion below could not fail');
  assert.match(OVERVIEW, /4 of 5 rows owned by HQ/,
    'the card stopped recording WHY it no longer states a row count');
  assert.doesNotMatch(code, /\d+ of \d+ rows owned by HQ/,
    'the card went back to typing a row count it has no read to derive');
  assert.match(OVERVIEW, /Brand kit not recorded/);
  assert.ok(!/<input\b/.test(OVERVIEW) && !/<form\b/.test(OVERVIEW), 'a form appeared for a store that does not exist');
  assert.doesNotMatch(OVERVIEW, /Good morning/);
  const copy = OVERVIEW
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*import[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '');
  assert.doesNotMatch(copy, /advisor|advice|recommendation|fiduciary/i);
});

test('seat lines are absent rather than zero when the count was not read', () => {
  assert.equal(accountLines(null, { founder: 10 }), null);
  assert.equal(accountLines(undefined, {}), null);
  const lines = accountLines(
    { founder: 9, investor: 1, advisor: 0, partner: 1 },
    { founder: 10, investor: 10, advisor: 0, partner: 10 },
  );
  assert.equal(lines.tightestType, 'founder');
  assert.equal(lines.tiles.find((t) => t.type === 'founder').state, seatState(9, 10));
  assert.equal(lines.tiles.find((t) => t.type === 'advisor').state, 'unlicensed');
  const missing = accountLines({ founder: 1 }, { founder: 2 });
  assert.equal(missing.tiles.find((t) => t.type === 'investor').missing, true);
});

test('approvals say nothing is waiting only when every lane answered empty', () => {
  assert.equal(approvalsGlance([
    { key: 'a', label: 'Cohort', count: 0, oldest_age_hours: null, sla: 'ok' },
    { key: 'b', label: 'Referrals', count: 0, oldest_age_hours: null, sla: 'ok' },
  ]).text, 'Nothing is waiting.');
  const gap = approvalsGlance([
    { key: 'a', label: 'Cohort', count: null, oldest_age_hours: null, sla: 'unknown' },
    { key: 'b', label: 'Referrals', count: 0, oldest_age_hours: null, sla: 'ok' },
  ]);
  assert.equal(gap.kind, 'unrecorded');
  assert.match(gap.reason, /not a claim that nothing is waiting/);
  const urgent = approvalsGlance([
    { key: 'new', label: 'New work', count: 40, oldest_age_hours: 2, sla: 'ok' },
    { key: 'old', label: 'Cohort application', count: 5, oldest_age_hours: 144, sla: 'past' },
  ]);
  assert.match(urgent.text, /Cohort application/);
  assert.match(urgent.text, /6 days/);
  assert.match(urgent.text, /past the window/);
  assert.match(urgent.text, /5 open/);
  assert.doesNotMatch(urgent.text, /^New work/);
});

test('a programme deadline without its zone is not shown', () => {
  const open = { open_week: 2, zone: 'America/New_York', week_closes_at: '2026-09-23T04:00:00.000Z' };
  assert.equal(programmeGlance(open, null).kind, 'unrecorded');
  assert.equal(programmeGlance({ ...open, zone: '' }, '23 Sep, 00:00').kind, 'unrecorded');
  assert.equal(
    programmeGlance(open, '23 Sep, 00:00').text,
    'Week 2 gate closes 23 Sep, 00:00 America/New_York',
  );
  assert.equal(programmeGlance({ open_week: null, reason: 'No cohort week is open.' }, null).kind, 'unrecorded');
});

test('contracts name the library and never an expiring-agreement count or a currency', () => {
  const ready = contractsGlance({
    available: true,
    items: [{ slug: 'a' }, { slug: 'b' }, { slug: 'c' }, { slug: 'd' }],
    pushed_at: '2026-09-22T07:12:00.000Z',
    currency: 'EUR',
    annual_fee_cents: 5000,
  });
  assert.match(ready.text, /4 HQ templates ready to instantiate/);
  assert.match(ready.text, /2026-09-22 07:12/);
  assert.equal(ready.agreements.kind, 'unrecorded');
  assert.doesNotMatch(JSON.stringify(ready), /EUR|5000|\$/);
  const never = contractsGlance({ available: true, items: [], never_pushed_reason: 'HQ has not pushed.' });
  assert.equal(never.kind, 'unrecorded');
  assert.match(never.reason, /not pushed/);
});

test('insights refuse a median HQ did not publish, and refuse an amount', () => {
  const empty = insightsGlance(
    { share_bps: 3500, amount_cents: null, reason: 'no base' },
    { benchmarks: [], benchmarks_empty_reason: 'HQ has not published a median.' },
  );
  assert.equal(empty.share.text, '35% share on this licence');
  assert.equal(empty.median.kind, 'unrecorded');
  assert.match(empty.median.reason, /has not published a median/);
  assert.doesNotMatch(JSON.stringify(empty), /amount/);
  const none = insightsGlance(null, null);
  assert.equal(none.median.kind, 'unrecorded');
  assert.match(none.median.reason, /has not published a median/);
});

function markup(props) {
  return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(AdminStudioOverview, props)));
}

test('off a branch the cards render the absence and no sample figures', () => {
  const html = markup({ user: { role: 'admin' }, home: null, licence: null, templates: null, insights: null });
  assert.match(html, /not on a branch deployment/);
  // Off a branch with `licence: null` nothing was read, so the card says that
  // rather than "no host bound" — which would be a claim about a register it
  // never consulted.
  assert.match(html, /Hostname not read/);
  // RE-AIMED BY D198, AND THE GUARD WAS RIGHT TO FAIL. This asserted "Brand kit
  // not recorded", which was the only state the card had when it was written —
  // the kit had no store, so unread and absent could not differ. Migration 281
  // gave it one, and the card now draws the same four states the hostname block
  // beside it draws. With `licence: null` the correct one is UNREAD: "not
  // recorded" would be a claim about a store this render never consulted, which
  // is the exact distinction the line above exists to make.
  assert.match(html, /Brand kit not read/);
  assert.doesNotMatch(html, /Brand kit not recorded/,
    'an unread licence renders the kit as absent, which is a claim nothing measured');
  assert.match(html, /href="\/branch\/accounts"/);
  assert.match(html, /href="\/admin\/events"/);
  assert.match(html, /href="\/admin\/jobs"/);
  assert.match(html, /href="\/admin\/circles"/);
  assert.match(html, /href="\/admin\/network-profiles"/);
  assert.doesNotMatch(html, /184|€|\$|Good morning/);
  assert.doesNotMatch(html, /0 of 0/);
});

test('a branch with a real read renders seats, the oldest queue, and the zoned deadline', () => {
  const html = markup({
    user: {
      role: 'admin',
      branch: { code: 'fr', name: 'Axal VC France', territories: ['FR', 'BE', 'LU'], status: 'active' },
    },
    home: {
      queue_pressure: [
        { key: 'cohort', label: 'Cohort application', count: 5, oldest_age_hours: 144, sla: 'past' },
      ],
      programme: { open_week: 2, zone: 'America/New_York', week_closes_at: '2026-09-23T04:00:00.000Z' },
      revenue: { share_bps: 3500, amount_cents: null, reason: 'no base' },
    },
    licence: {
      licence: {
        seats: { founder: 10, investor: 10, advisor: 0, partner: 10 },
        seats_used_by_type: { founder: 9, investor: 1, advisor: 0, partner: 1 },
      },
    },
    templates: {
      available: true,
      items: [{ slug: 'a' }],
      pushed_at: '2026-09-22T07:12:00.000Z',
    },
    insights: { benchmarks: [], benchmarks_empty_reason: 'HQ has not published a median.' },
  });
  assert.match(html, /Axal VC France/);
  assert.match(html, /FR · BE · LU/);
  assert.match(html, /Active/);
  assert.match(html, /Founder/);
  assert.match(html, /9 of 10/);
  assert.match(html, /tightest/);
  assert.match(html, /no seats of this type licensed/);
  assert.match(html, /Cohort application/);
  assert.match(html, /6 days/);
  assert.match(html, /past the window/);
  assert.match(html, /America\/New_York/);
  assert.match(html, /1 HQ template ready to instantiate/);
  assert.match(html, /35% share on this licence/);
  assert.match(html, /has not published a median/);
  assert.doesNotMatch(html, /€|\$/);
});

test('a suspension stays a line and the cards stay readable', () => {
  const html = markup({
    user: {
      role: 'admin',
      branch: { code: 'ib', name: 'Axal VC Iberia', territories: ['ES'], status: 'suspended' },
    },
    home: { queue_pressure: [{ key: 'a', label: 'Cohort', count: 0, oldest_age_hours: null, sla: 'ok' }], programme: { open_week: null, reason: 'No cohort week is open.' }, revenue: { share_bps: null } },
    licence: { licence: { status: 'suspended', suspended_at: '2026-07-18T12:00:00.000Z', seats_used_by_type: null, seats: {} } },
    templates: { available: true, items: [], never_pushed_reason: 'HQ has not pushed.' },
    insights: { benchmarks: [] },
  });
  assert.match(html, /Axal VC Iberia · frozen since 18 Jul · writes are blocked/);
  assert.match(html, /Nothing is waiting/);
  assert.match(html, /href="\/branch\/accounts"/);
});

test('a suspension line names the territory and does not invent the day', () => {
  assert.equal(freezeLine('Axal VC Iberia', null), 'Axal VC Iberia · frozen · writes are blocked');
  assert.match(freezeLine('Axal VC Iberia', '2026-07-18T12:00:00.000Z'), /frozen since 18 Jul/);
  assert.match(freezeLine('Axal VC Iberia', 'not-a-date'), /frozen · writes are blocked/);
});
