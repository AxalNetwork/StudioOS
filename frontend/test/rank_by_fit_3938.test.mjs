// #3938 part 8 (D1478 task 4): the page buttons for the match-row presses.
//   * `applyRank` orders the page's own rows by the answer, keeps every row
//     (unranked ones after, in their order), and gives a line only where the
//     press wrote one;
//   * `rankKeyOf` reads each route's key; `rankRefusal` says the Worker's words;
//   * each page that lists a ranked collection mounts `RankByFit` on its own
//     route's client and reorders its list through `applyRank`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { applyRank, rankKeyOf, rankRefusal, rankedLine } from '../src/lib/rankByFit.js';

const src = (rel) => readFileSync(fileURLToPath(new URL(`../src/${rel}`, import.meta.url)), 'utf8');

test('applyRank: ranked rows first by position, every other row kept in its order, lines only where written', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  const out = applyRank(items, (x) => x.id, { rows: [{ uid: 'c', position: 1, line: ' Closest to your need ' }, { uid: 'a', position: 2, line: null }, { uid: 'zz', position: 3, line: 'not on this page' }] });
  assert.deepEqual(out.list.map((x) => x.id), ['c', 'a', 'b', 'd']);
  assert.equal(out.ranked, 2, 'a row not on the page is not counted');
  assert.equal(out.lineFor(items[2]), 'Closest to your need');
  assert.equal(out.lineFor(items[0]), null, 'no line written, no line shown');
  assert.equal(out.lineFor(items[1]), null);
  const none = applyRank(items, (x) => x.id, null);
  assert.deepEqual([none.list, none.ranked], [items, 0], 'no answer: the list as it was');
  assert.deepEqual(applyRank(null, (x) => x, { rows: [] }).list, []);
});

test('rankKeyOf reads each route\'s key; numeric keys match string ids', () => {
  assert.equal(rankKeyOf({ uid: 'u1' }), 'u1');
  assert.equal(rankKeyOf({ event_id: 7 }), '7');
  assert.equal(rankKeyOf({ need_id: 9 }), '9');
  assert.equal(rankKeyOf({ ref: 3 }), '3');
  assert.equal(rankKeyOf({ application_id: 4 }), '4');
  assert.equal(rankKeyOf({}), null);
  assert.deepEqual(applyRank([{ id: 7 }, { id: 8 }], (x) => x.id, { rows: [{ event_id: 8, position: 1 }] }).list.map((x) => x.id), [8, 7]);
});

test('rankRefusal says the Worker\'s words, and names the state when it gave none', () => {
  assert.equal(rankRefusal({ status: 402, data: { message: 'You have 12 tokens; this press holds 40.' } }), 'You have 12 tokens; this press holds 40.');
  assert.match(rankRefusal({ status: 402 }), /Not enough AI tokens/);
  assert.match(rankRefusal({ status: 403 }), /switched off/);
  assert.equal(rankRefusal({ status: 422, data: { detail: 'Write what you are looking for, or add a profile.' } }), 'Write what you are looking for, or add a profile.');
  assert.match(rankRefusal({ status: 500, message: 'stack trace here' }), /could not be run just now\. Nothing changed/, 'a server error never shows its internals');
  assert.match(rankedLine(3, 10), /3 of 10 first/);
  assert.match(rankedLine(0, 10), /nothing on this list to rank/);
});

const PAGES = [
  ['pages/raise/caprel/CapRelMatch.jsx', /capitalRelationshipsApi\.matchRank\(projectId, matchQuery\(f\), query\)/, /applyRank\(d\?\.items \|\| \[\], \(fund\) => fund\.uid, rank\)/],
  ['pages/events/MyEventsPage.jsx', /eventsApi\.suggestedRank\(query\)/, /const tipsRank = applyRank\(Array\.isArray\(suggested\.data\?\.events\) \? suggested\.data\.events : \[\], \(ev\) => ev\.id, eventsRank\)/],
  ['pages/partner/pipeline/LeadsZone.jsx', /api\.rankPartnerLeads\(query\)/, /applyRank\(items, \(r\) => r\.need_id, rank\)/],
  ['pages/SpinoutLabCofounderMatchPage.jsx', /api\.cofounderBrowseRank\(query, /, /applyRank\(sortCards\(cards, sortKey\), \(c\) => c\.uid, browseRank\)/],
  ['pages/SpinoutLabAdvisorsPage.jsx', /api\.advisorsMatchRank\(query, \{ gap: refineGap, focus: refineFocus \}\)/, /applyRank\(items, \(m\) => m\.uid, advisorRank\)/],
];

test('each page mounts Rank by fit on its own route and reorders its own list', () => {
  for (const [file, call, order] of PAGES) {
    const s = src(file);
    assert.match(s, /import RankByFit from '[./]+ui\/RankByFit';/, `${file}: mounts the shared button`);
    assert.match(s, /<RankByFit run=\{\(query\) => /, file);
    assert.match(s, call, `${file}: runs its own route`);
    assert.match(s, order, `${file}: reorders its own rows`);
    // IN10 ranks and writes no line (D1478 part 3), so the leads page shows none; every other job writes one.
    if (file.includes('LeadsZone')) assert.doesNotMatch(s, /\.lineFor\(/, 'IN10 writes no line');
    else assert.match(s, /\.lineFor\(/, `${file}: shows the press's line`);
    assert.ok(!/\balert\(|\bconfirm\(|window\.prompt/.test(s), `${file}: no browser pop-up`);
  }
});

test('the button saves nothing, says it is a view and that it uses tokens, and puts the usual order back', () => {
  const s = src('ui/RankByFit.jsx');
  assert.match(s, /nothing is saved, and each press uses AI tokens/);
  assert.match(s, /onClick=\{\(\) => onRanked\(null\)\}/, 'Usual order clears the ranking');
  assert.match(s, /setError\(rankRefusal\(e\)\)/);
  assert.ok(!/request\(|fetch\(/.test(s), 'the button calls only the page\'s client');
});
