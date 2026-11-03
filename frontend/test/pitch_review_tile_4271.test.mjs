// D4271 (#4271, D4254 P3): the Review tile — comments across the deck, approvals, figures and their sources, and
// the AI review's "v7 has not been reviewed yet" and "Last run on v6 · 72 / 100".
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pitch_review_tile_4271.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { mountContracts } from './_contracts_dom.mjs';
import { deckCommentsApi } from '../src/lib/api/deckComments.js';
import { deckFiguresApi } from '../src/lib/api/deckFigures.js';
import { deckCheckApi } from '../src/lib/api/deckCheck.js';
import ReviewTile from '../src/pages/raise/pitch/ReviewTile.jsx';
import {
  FILTERS, NOT_CHECKED, approvalView, claimFor, deckThreads, editorCardOf, figureRows, figuresLine, filterCounts, filterThreads, initials, threadHref,
} from '../src/pages/raise/pitch/reviewTileModel.js';
import { lastRunLine, notReviewedLine } from '../src/pages/raise/pitch/reviewModel.js';

const h = React.createElement;
const ME = 2, ADA = 5;
const SLIDES = [{ uid: 'c1', title: 'Title' }, { uid: 'c2', title: 'Problem' }, { uid: 'c3', title: 'Traction' }];
const c = (o) => ({ deck_id: 7, deck_version: 3, card_uid: null, area: null, parent_uid: null, mentions: [], assignee: null, resolved_at: null, resolved_by: null, ...o });
const COMMENTS = [
  c({ uid: 't1', card_index: 2, card_uid: 'c3', author: { id: ADA, name: 'Ada Lovelace' }, body: 'Where is the MRR from?', assignee: { id: ME, name: 'Synthetic Founder' }, created_at: '2026-11-02 10:00:00' }),
  c({ uid: 'r1', parent_uid: 't1', card_index: 2, author: { id: ME, name: 'Synthetic Founder' }, body: 'From Stripe.', created_at: '2026-11-02 11:00:00' }),
  c({ uid: 'r2', parent_uid: 't1', card_index: 2, author: { id: ADA, name: 'Ada Lovelace' }, body: 'Thanks.', created_at: '2026-11-02 12:00:00' }),
  c({ uid: 't2', card_index: 1, author: { id: ADA, name: 'Ada Lovelace' }, body: 'Sharper problem line?', mentions: [{ id: ME, name: 'Synthetic Founder' }], created_at: '2026-11-03 09:00:00' }),
  c({ uid: 't3', card_index: 0, author: { id: ADA, name: 'Ada Lovelace' }, body: 'Logo too small.', resolved_at: '2026-11-03 10:00:00', created_at: '2026-11-01 09:00:00' }),
];

test('threads across the deck: newest first, each on its card by uid, with its replies; the filters count for the viewer', () => {
  // Mutation checked: "Assigned to you" not limited to the viewer, a reply's mentions ignored, Resolved counting every thread — each red.
  const threads = deckThreads(COMMENTS, SLIDES);
  assert.deepEqual(threads.map((t) => [t.uid, t.card, t.cardTitle, t.replies.length, t.open]), [
    ['t2', 2, 'Problem', 0, true], ['t1', 3, 'Traction', 2, true], ['t3', 1, 'Title', 0, false],
  ]);
  assert.deepEqual(FILTERS.map((f) => f.label), ['Open', 'Assigned to you', 'Mentions you', 'Resolved']);
  assert.deepEqual(filterCounts(threads, ME), { open: 2, assigned: 1, mentions: 1, resolved: 1 });
  assert.deepEqual(filterCounts(threads, ADA), { open: 2, assigned: 0, mentions: 0, resolved: 1 });
  assert.deepEqual(filterThreads(threads, 'assigned', ME).map((t) => t.uid), ['t1']);
  // A mention in a reply counts as mentioning the viewer.
  const replyMention = deckThreads([...COMMENTS, c({ uid: 'r3', parent_uid: 't1', card_index: 2, author: { id: ADA, name: 'Ada' }, body: '@you', mentions: [{ id: 9, name: 'Nine' }], created_at: '2026-11-02 13:00:00' })], SLIDES);
  assert.deepEqual(filterThreads(replyMention, 'mentions', 9).map((t) => t.uid), ['t1']);
  // A card the version no longer has keeps its number; no uid match falls back to the place.
  assert.equal(deckThreads([c({ uid: 'x', card_index: 8, card_uid: 'gone', author: null, body: 'b', created_at: 'z' })], SLIDES)[0].card, 9);
  assert.equal(initials('Ada Lovelace'), 'AL');
  assert.equal(initials(''), '?');
});

test('a thread opens its card with its comments; the editor reads the card it is given, or the first', () => {
  assert.equal(threadHref(1, 3), '/raise/pitch/edit?project_id=1&card=3&comments=1');
  assert.equal(threadHref(null, null), '/raise/pitch/edit?');
  assert.deepEqual([editorCardOf('3', 5), editorCardOf('9', 5), editorCardOf('0', 5), editorCardOf('x', 5), editorCardOf(null, 5)], [2, 0, 0, 0, 0]);
  const editor = readFileSync(new URL('../src/pages/raise/pitch/PitchEditor.jsx', import.meta.url), 'utf8');
  assert.match(editor, /useState\(\(\) => editorCardOf\(deepLink\.get\('card'\), cardsOf\(deck\)\.length\)\)/);
  assert.match(editor, /deepLink\.get\('comments'\) === '1' && deepLink\.get\('card'\) \? 'comments' : null/);
});

test('approvals: each approver by name, approved or waiting; none named says so', () => {
  const v = approvalView({ approvers: [{ user_id: 5, name: 'Ada Lovelace', approved: true, approved_at: '2026-11-02 10:00:00' }, { user_id: 6, name: null, approved: false }], message: 'Waiting on one approver.' });
  assert.deepEqual(v.rows.map((r) => [r.name, r.state, r.at, r.initials]), [['Ada Lovelace', 'Approved', '2026-11-02', 'AL'], ['Not recorded', 'Waiting', null, '?']]);
  assert.equal(v.line, 'Waiting on one approver.');
  assert.equal(approvalView({ approvers: [{ user_id: 5, name: 'A', approved: true }] }).line, '1 of 1 approved this version.');
  assert.match(approvalView({ approvers: [] }).line, /No one is named to approve this version/);
});

test('figures and their sources: Linked with its source and date, Stated, No source; Checked only when the check backs it', () => {
  // Mutation checked: a figure with no claim drawn Checked → the Not checked row fails; the label match dropped → MRR takes the card's other claim.
  const figures = [
    { card: 2, block_id: 'm1', kind: 'metric', label: 'MRR', at: null, state: 'linked', value: '$18.4k', source: { source_key: 'grow.mrr', label: 'Revenue', module: 'Grow', as_of: '2026-10-01' } },
    { card: 2, block_id: 'm2', kind: 'metric', label: 'Customers', at: null, state: 'stated', value: '41', source: null },
    { card: 1, block_id: 't1', kind: 'text', label: null, at: null, state: 'uncited', value: null, source: null, figures: ['40%'] },
    { card: 0, block_id: 'm3', kind: 'metric', label: 'Runway', at: null, state: 'not_recorded', value: null, source: null },
  ];
  const check = { claims: [
    { uid: 'k-mrr', slide: 3, label: 'MRR', display_state: 'backed' },
    { uid: 'k-cust', slide: 3, label: 'Customers', display_state: 'mismatch' },
  ] };
  assert.equal(claimFor(figures[0], check.claims).uid, 'k-mrr');
  assert.equal(claimFor(figures[2], check.claims), null);
  const rows = figureRows(figures, check, SLIDES, 1);
  assert.deepEqual(rows.map((r) => [r.name, r.card, r.source, r.check]), [
    ['40%', 'Card 2 · Problem', 'No source', NOT_CHECKED],
    ['Customers · 41', 'Card 3 · Traction', 'Stated · typed on the card', 'Does not match the record'],
    ['Runway', 'Card 1 · Title', 'Not recorded', NOT_CHECKED],
    ['MRR · $18.4k', 'Card 3 · Traction', 'Linked · Revenue · as of 2026-10-01', 'Checked'],
  ]);
  assert.equal(rows[3].href, '/raise/evidence/claim/k-mrr?project=1', 'a checked figure opens its claim');
  assert.equal(rows[0].href, '/raise/pitch/edit?project_id=1&card=2', 'one with no claim opens its card');
  assert.equal(figuresLine(rows), '4 figures · 1 checked');
  assert.ok(figureRows(figures, null, SLIDES, 1).every((r) => r.check === NOT_CHECKED), 'a version never checked is Not checked throughout');
});

test('the AI review: "v7 has not been reviewed yet" names the version; "Last run on v6 · 72 / 100" only for a returned score', () => {
  assert.equal(notReviewedLine('v7'), 'v7 has not been reviewed yet.');
  assert.equal(notReviewedLine(null), 'This version has not been reviewed yet.');
  assert.equal(lastRunLine([{ deck_version: 6, overall_score: 71.6 }, { deck_version: 5, overall_score: 60 }]), 'Last run on v6 · 72 / 100');
  assert.equal(lastRunLine([{ deck_version: 6, overall_score: null }, { deck_version: 5, overall_score: 60 }]), 'Last run on v5 · 60 / 100', 'a run with no score is passed over');
  assert.equal(lastRunLine([]), null);
});

const READS = {
  versions: { status: 'ok', data: { versions: [{ id: 7, version: 3, is_current: true, title: 'Seed deck' }] } },
  deck: { status: 'ok', data: { id: 7, slides: SLIDES } },
};

async function mountTile({ readOnly = false } = {}) {
  const calls = [];
  const saved = { c: { ...deckCommentsApi }, f: { ...deckFiguresApi }, k: { ...deckCheckApi } };
  deckCommentsApi.list = async (id) => { calls.push(['list', id]); return { deck_id: id, version: 3, viewer: { user_id: ME, kind: 'founder', can_manage: true }, people: [{ id: ME, name: 'Synthetic Founder' }, { id: ADA, name: 'Ada Lovelace' }], comments: structuredClone(COMMENTS), open: 2 }; };
  deckCommentsApi.resolve = async (id, uid, resolved) => { calls.push(['resolve', id, uid, resolved]); const root = COMMENTS.find((x) => x.uid === uid); return { comment: { ...root, resolved_at: resolved ? '2026-11-03 12:00:00' : null } }; };
  deckCommentsApi.assign = async (id, uid, userId) => { calls.push(['assign', id, uid, userId]); return { comment: { ...COMMENTS.find((x) => x.uid === uid), assignee: userId ? { id: userId, name: 'Ada Lovelace' } : null } }; };
  deckCommentsApi.approval = async (id) => { calls.push(['approval', id]); return { approvers: [{ user_id: ADA, name: 'Ada Lovelace', approved: false }], message: 'Waiting on Ada Lovelace.' }; };
  deckFiguresApi.list = async (id) => { calls.push(['figures', id]); return { deck_id: id, figures: [{ card: 2, block_id: 'm1', label: 'MRR', state: 'linked', value: '$18.4k', source: { label: 'Revenue', as_of: '2026-10-01' } }] }; };
  deckCheckApi.read = async (id) => { calls.push(['check', id]); return { claims: [{ uid: 'k-mrr', slide: 3, label: 'MRR', display_state: 'backed' }] }; };
  const m = await mountContracts(h(ReviewTile, { reads: READS, readOnly, projectId: 1 }), '/raise/pitch/review?project_id=1');
  await m.flush(); await m.flush();
  const by = (id) => m.nodes().find((n) => m.props(n)?.['data-testid'] === id);
  const press = async (id, arg) => { const n = by(id); if (!n) throw new Error(`Missing ${id}`); m.props(n).onClick?.(arg); await m.flush(); };
  return { m, calls, by, press, restore: async () => { Object.assign(deckCommentsApi, saved.c); Object.assign(deckFiguresApi, saved.f); Object.assign(deckCheckApi, saved.k); await m.unmount(); } };
}

test('the tile: Open by default, a filter switches the list, Resolve answers in place, approvals and the figures table drawn', async () => {
  // Mutation checked: the filter ignored → Resolved still lists the open threads; Resolve sending the wrong flag → the call fails.
  const t = await mountTile();
  try {
    let text = t.m.text();
    assert.match(text, /Comments across the deck/);
    assert.ok(t.by('pitch-review-thread-t1') && t.by('pitch-review-thread-t2'));
    assert.equal(Boolean(t.by('pitch-review-thread-t3')), false, 'a resolved thread is not under Open');
    assert.match(text, /Card 3 · Traction/);
    assert.match(text, /2 replies/);
    assert.match(text, /Assigned to Synthetic Founder/);
    assert.equal(t.m.props(t.by('pitch-review-thread-open-t1')).href, '/raise/pitch/edit?project_id=1&card=3&comments=1');

    await t.press('pitch-review-filter-resolved');
    assert.equal(Boolean(t.by('pitch-review-thread-t1')), false);
    assert.ok(t.by('pitch-review-thread-t3'));
    await t.press('pitch-review-filter-mentions');
    assert.deepEqual(['t1', 't2', 't3'].map((u) => Boolean(t.by(`pitch-review-thread-${u}`))), [false, true, false]);

    await t.press('pitch-review-filter-open');
    await t.press('pitch-review-resolve-t2');
    assert.deepEqual(t.calls.find((x) => x[0] === 'resolve'), ['resolve', 7, 't2', true]);
    assert.equal(Boolean(t.by('pitch-review-thread-t2')), false, 'a resolved thread leaves Open at once');
    assert.equal(t.m.props(t.by('pitch-review-filter-count-resolved')).children, 2);

    text = t.m.text();
    assert.match(text, /Waiting on Ada Lovelace\./);
    assert.match(text, /Figures and their sources/);
    assert.match(text, /Linked · Revenue · as of 2026-10-01/);
    assert.match(text, /1 figure · 1 checked/);
    assert.equal(JSON.stringify(t.m.text()).includes('@'), false, 'no email anywhere');
  } finally { await t.restore(); }
});

test('the tile for an admin: no comments or approvals read, the line that says where their thread is; figures still drawn', async () => {
  // Mutation checked: readOnly ignored → the comments read is made and refused.
  const t = await mountTile({ readOnly: true });
  try {
    assert.match(t.m.text(), /Your notes to the founders are under Notes\./);
    assert.deepEqual(t.calls.filter((x) => x[0] === 'list' || x[0] === 'approval'), []);
    assert.ok(t.by('pitch-review-figures'));
  } finally { await t.restore(); }
});

test('the studio draws the tile above the AI review on /raise/pitch/review', () => {
  const studio = readFileSync(new URL('../src/pages/raise/pitch/PitchStudio.jsx', import.meta.url), 'utf8');
  assert.match(studio, /<ReviewTile reads=\{reads\} readOnly=\{readOnly\} projectId=\{projectId\} \/>\s*<PitchReview reads=\{reads\} readOnly=\{readOnly\} \/>/);
});
