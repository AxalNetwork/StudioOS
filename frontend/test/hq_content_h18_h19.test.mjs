/**
 * D214 — H18 and H19 on HQ · Content: the six-lane pipeline (C3), the Advisors
 * & Partners deck roster (C4), the Assessment Studio (C1) and the personas
 * taxonomy (C2), each read from the store its console writes.
 *
 * WHAT IS RENDERED. The four panels and the band are pure over their props, so
 * every state each can be in is RENDERED here — loading, the summary failing,
 * the block failing, empty, populated, and the part that answered but could
 * not be counted — rather than matched as source text: a branch can keep its
 * words and stop drawing, and only the output notices (D200's rule). The page
 * loads in effects, which renderToStaticMarkup never runs, so the order of its
 * zones, its links and its rail are read as source.
 *
 * THE TWO ABSENCES KEEP TWO WORDS. "Not recorded" is for a figure nothing
 * stores; "Unreadable" is for a store that did not answer. Several tests below
 * assert that a state renders one and NOT the other, because a page that used
 * either word for both would pass a test that only looked for one.
 *
 * Pinned elsewhere and not repeated here: no `|| 0`, the Localised stat, the
 * lane's `api.escalations` call and the rail's shape (hq_content_platform_h6,
 * escalation_concerns_d208, branch_rail_mount, hq_home); what the route returns
 * in each state (cloudflare-worker/test/content_studio_d214).
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
  ContentBoard, AssessmentPanel, PersonasPanel, RosterPanel,
  bandLine, cardMeta, gameMeta, personaFooting, REACH_LABEL,
} from '../src/pages/hq/ContentPage.jsx';
import { NO_GAME_HERE } from '../src/pages/branch/BranchPrograms.jsx';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const PAGE = raw('frontend/src/pages/hq/ContentPage.jsx');
const P = codeOnly(PAGE);
const ROUTE = raw('cloudflare-worker/src/routes/admin_content.ts');
const ROSTER_RULE = raw('cloudflare-worker/src/services/decks/deckRoster.ts');
const PROGRAMS = codeOnly(raw('frontend/src/pages/branch/BranchPrograms.jsx'));
const CANVAS = raw('design/canvases/integrated/Admin · Super.dc.html');

const render = (C, props) => renderToStaticMarkup(
  React.createElement(MemoryRouter, null, React.createElement(C, props)),
);
const count = (hay, needle) => hay.split(needle).length - 1;
/** Visible text, tags stripped — what a reader sees. */
const text = (html) => html
  .replace(/<[^>]+>/g, ' ')
  .replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/\s+/g, ' ');
const hrefs = (html) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replaceAll('&amp;', '&'));

/** One artboard, bounded at both ends so a slice cannot run into its neighbour. */
function artboard(id, next) {
  const a = CANVAS.indexOf(`<section class="ab" id="${id}">`);
  assert.ok(a >= 0, `the ${id.toUpperCase()} artboard could not be found in the canvas`);
  const b = CANVAS.indexOf(`<section class="ab" id="${next}">`, a);
  assert.ok(b > a, `${next.toUpperCase()} no longer follows ${id.toUpperCase()} — this slice would run past the artboard`);
  return CANVAS.slice(a, b).replaceAll('&amp;', '&');
}
const H18 = artboard('h18', 'h19');
const H19 = artboard('h19', 'h20');

/** One lane's own markup, from its testid to the next lane's — never the whole board. */
function laneSlice(html, key) {
  const at = html.indexOf(`data-testid="hq-content-lane-${key}"`);
  assert.ok(at >= 0, `the ${key} lane was not drawn`);
  // Bounded by the lane's OWN closing tag, walked through the markup. The first
  // version stopped at the next testid starting `hq-content-lane-` — and the
  // no-source paragraph INSIDE a lane is `hq-content-lane-no-source`, so the
  // slice ended just before the one element it was cut to show. A bound that
  // stops inside the thing it is bounding reads as a pass on everything after.
  const open = html.lastIndexOf('<div', at);
  const tags = /<div\b|<\/div>/g;
  tags.lastIndex = open;
  let depth = 0;
  for (let m = tags.exec(html); m; m = tags.exec(html)) {
    depth += m[0] === '</div>' ? -1 : 1;
    if (depth === 0) return html.slice(open, m.index + '</div>'.length);
  }
  return assert.fail(`the ${key} lane never closed`);
}

// ─────────────────────────────────────────────────────────── fixtures ──

const article = (over) => ({ store: 'article', id: 1, title: 'A piece', status: 'draft', updated_at: '2026-09-20 10:00:00', ...over });
const escalation = (over) => ({
  store: 'escalation', uid: 'esc_1', subject: 'French landing page', branch_code: 'fr',
  created_at: '2026-09-18 08:00:00', sla: 'past', ...over,
});
const part = (store, statuses, n, cards, extra = {}) => ({ store, statuses, n, cards, ...extra });

const BOARD = {
  lanes: [
    {
      key: 'draft', label: 'Draft', total: 3,
      parts: [
        part('articles', ['draft'], 2, [article({ id: 11, title: 'Draft article' })]),
        part('publications', ['draft'], 1, [{ store: 'publication', id: 21, title: 'Draft digest', status: 'draft', updated_at: '2026-09-19T09:30:00.000Z' }]),
      ],
    },
    {
      key: 'review', label: 'Review', total: 3,
      parts: [part('articles', ['submitted', 'in_review', 'changes_requested'], 3, [article({ id: 12, title: 'Piece in review', status: 'in_review' })])],
    },
    {
      key: 'localisation', label: 'Localisation', total: null, parts: [], recorded: false,
      reason: 'A branch localises in its own database, and nothing records that one piece is a localisation of another.',
    },
    {
      key: 'brand_approval', label: 'Brand approval', total: 2,
      parts: [part('escalations', ['open'], 2, [escalation()])],
      note: 'Content escalations a branch raised and HQ has not answered.',
    },
    {
      key: 'scheduled', label: 'Scheduled', total: 1,
      parts: [part('articles', ['approved'], 1, [])],
      note: 'Approved and waiting for someone to publish it.',
    },
    {
      key: 'published', label: 'Published', total: 3,
      parts: [part('articles', ['published'], 2, []), part('publications', ['published'], 1, [])],
      note: 'Two meanings of "published".',
    },
  ],
  total: 12,
  in_flight: 9,
  other_publication_statuses: [],
  publish_time: { recorded: false, reason: 'Scheduled means approved; publishing is a manual step, and nothing stores when a piece is meant to go out.' },
  origin: { recorded: false, reason: 'Neither an article nor a publication names a branch.' },
};
const withLane = (key, lane) => ({ ...BOARD, lanes: BOARD.lanes.map((l) => (l.key === key ? { ...l, ...lane } : l)) });

const ASSESSMENT = {
  available: true,
  games: [
    { id: 2, slug: 'founder-fit', title: 'Founder fit', status: 'published', version: 3, chapters: 2, archetypes: 4, questions: 12, runs: 7 },
    { id: 3, slug: 'market-read', title: 'Market read', status: 'draft', version: 1, chapters: 1, archetypes: 1, questions: 1, runs: 0 },
    { id: 1, slug: 'old-one', title: 'Old one', status: 'archived', version: null, chapters: 0, archetypes: 0, questions: 0, runs: 1 },
  ],
  truncated: false,
  games_total: 3,
  by_status: { draft: 1, published: 1, archived: 1 },
  other_statuses: [],
  chapters_total: 3,
  archetypes_total: 5,
  runs_available: true,
  runs_basis: 'Completed runs recorded on HQ’s database. The routes that recorded a run are retired, so this count does not grow.',
  branches: { recorded: false, reason: 'No game reaches a branch: no call sends one, and a branch database carries no seed rows.' },
};

const PERSONAS = {
  available: true,
  items: [
    { id: 'P0', label: 'First-time founder', tagged: 2 },
    { id: 'P1', label: 'Repeat founder', tagged: 0 },
  ],
  unrecognised: [],
  tagged_sum: 2,
  accounts_tagged: 2,
  unclassified: 4,
  active_accounts: 6,
  multi_primary: 0,
  basis: 'Each active account’s primary tag.',
  schema_note: 'The set is defined in code, so no console adds, renames or retires a persona.',
  scope_note: 'HQ’s database only.',
};

const rosterRow = (over) => ({ id: 1, name: 'Mia', kind: 'advisor', role: 'Operator', deck_role: 'Operator', company: 'Acme', active: true, reach: 'profile', ...over });
const ROSTER = {
  available: true,
  rows: [
    rosterRow({ id: 1, name: 'Mia', role: null, deck_role: 'Advisor', company: null }),
    rosterRow({ id: 7, name: 'Gus', role: 'CFO', deck_role: null, reach: 'named' }),
    rosterRow({ id: 9, name: 'Ivy', role: 'Counsel', deck_role: null, reach: 'counted' }),
    rosterRow({ id: 4, name: 'Old', role: 'Partner', deck_role: null, active: false, reach: 'archived' }),
    rosterRow({ id: 5, name: '', role: null, deck_role: 'Advisor', reach: 'profile' }),
  ],
  truncated: false,
  active: 4,
  archived: 1,
  by_kind: [
    { kind: 'mentor', active: 0, archived: 0, known: true },
    { kind: 'partner', active: 0, archived: 0, known: true },
    { kind: 'advisor', active: 4, archived: 1, known: true },
    { kind: 'investor', active: 0, archived: 0, known: true },
  ],
  reach_note: 'What the deck built on HQ does with each active row, in its own order.',
  nominations: { recorded: false, reason: 'Nothing records who put a person on the roster.' },
  branch_rule: 'A branch authors its own roster in its own database, and its decks read that one.',
};

// ──────────────────────────────────────────── the artboards and the page ──

test('H18 draws C1 then C2, and H19 draws the six lanes then the C4 roster', () => {
  assert.ok(H18.indexOf('C1 · Assessment Studio') >= 0, 'H18 no longer draws the Assessment Studio');
  assert.ok(H18.indexOf('C2 · Personas taxonomy') > H18.indexOf('C1 · Assessment Studio'), 'H18 draws C2 before C1');
  const lanes = 'Draft → Review → Localisation → Brand approval → Scheduled → Published';
  assert.ok(H19.includes(lanes), 'H19 no longer names the six lanes in this order');
  assert.ok(H19.indexOf('C4 · Advisors & Partners — deck roster') > H19.indexOf(lanes), 'H19 draws the roster above the lanes');
});

test('the page runs board → templates and localisation → roster → assessment and personas', () => {
  const order = [
    'data-testid="hq-content-board-zone"',
    '<Zone title="Master template library"',
    '<Zone title="Localisation"',
    'testid="hq-content-roster"',
    'testid="hq-content-assessment"',
    'testid="hq-content-personas"',
  ];
  let prev = -1;
  for (const marker of order) {
    const at = P.indexOf(marker.replace('data-testid=', 'testid='));
    assert.ok(at > prev, `${marker} is missing or out of order`);
    prev = at;
  }
  // C1 before C2, as H18 draws them side by side.
  assert.ok(P.indexOf('<AssessmentPanel') < P.indexOf('<PersonasPanel'));
  for (const panel of ['<ContentBoard', '<AssessmentPanel', '<PersonasPanel', '<RosterPanel']) {
    assert.equal(count(P, panel), 1, `${panel} is mounted ${count(P, panel)} times`);
  }
  // The zone's subtitle is the canvas's own lane sequence, character for character.
  assert.ok(P.includes('sub="Draft → Review → Localisation → Brand approval → Scheduled → Published"'));
});

test('the route builds its six lanes in the canvas\'s order, with the canvas\'s names', () => {
  const at = ROUTE.indexOf('const lanes = [');
  assert.ok(at >= 0, 'the board no longer declares its lanes in one list');
  const block = ROUTE.slice(at, ROUTE.indexOf('].map(', at));
  const labels = [...block.matchAll(/key: '[a-z_]+', label: '([^']+)'/g)].map((m) => m[1]);
  const canvas = H19.match(/Draft → Review → Localisation → Brand approval → Scheduled → Published/)[0].split(' → ');
  assert.deepEqual(labels, canvas);
});

test('every console is linked by a literal path, once, and the network-profiles route is never linked', () => {
  for (const to of ['/admin/articles', '/admin/publications', '/admin/assessment', '/admin?tab=personas', '/admin?tab=network-profiles']) {
    assert.equal(count(P, `to="${to}"`), 1, `${to} is linked ${count(P, `to="${to}"`)} times`);
  }
  // Its reachability exemption says nothing links it; a link here would make that stale.
  assert.ok(!P.includes('/admin/network-profiles'), 'the page names the standalone network-profiles route');
});

// ───────────────────────────────────────────────────────────── the band ──

test('the band counts what is short of published and refuses "one meaning of published"', () => {
  assert.equal(bandLine({ loading: true }), '…');
  assert.equal(bandLine({ unreadable: true }), 'the content summary could not be read');
  assert.equal(bandLine({ board: BOARD }), '9 in pipeline · localisation not recorded · two meanings of published');
  assert.equal(
    bandLine({ board: { ...BOARD, in_flight: null } }),
    'in pipeline: not fully counted · localisation not recorded · two meanings of published',
  );
  // The canvas claims one meaning; the page never repeats the claim.
  assert.ok(H19.includes('one meaning of published'));
  for (const line of [bandLine({ board: BOARD }), bandLine({ board: { ...BOARD, in_flight: null } })]) {
    assert.ok(!line.includes('one meaning of published'), `the band claims one meaning: ${line}`);
  }
});

// ──────────────────────────────────────────────────────────── C3 · board ──

test('a card\'s small line names its store first, in lower case', () => {
  assert.equal(cardMeta(article({ status: 'in_review' })), 'article · in_review · 2026-09-20 10:00');
  assert.equal(
    cardMeta({ store: 'publication', status: 'draft', updated_at: '2026-09-19T09:30:00.000Z' }),
    'publication · draft · 2026-09-19 09:30',
  );
  assert.equal(cardMeta(escalation()), 'escalation · raised 2026-09-18 08:00 · past SLA');
  assert.equal(cardMeta(escalation({ sla: 'due_soon' })), 'escalation · raised 2026-09-18 08:00 · due soon');
  assert.equal(cardMeta(escalation({ sla: undefined })), 'escalation · raised 2026-09-18 08:00');
  for (const meta of [cardMeta(article()), cardMeta(escalation())]) {
    assert.match(meta, /^[a-z]/, `a card line starts with a capital: ${meta}`);
  }
});

test('the board: loading and a failed summary draw no lanes, and say which', () => {
  const loading = render(ContentBoard, { loading: true });
  assert.match(text(loading), /Reading the pipeline…/);
  const failed = render(ContentBoard, { unreadable: true });
  assert.match(text(failed), /Unreadable — The content summary did not answer, so the pipeline could not be read\./);
  const missing = render(ContentBoard, { board: null });
  assert.match(text(missing), /The board was not in the summary\./);
  for (const html of [loading, failed, missing]) {
    assert.ok(!html.includes('data-testid="hq-content-board"'), 'a board was drawn with nothing behind it');
    assert.ok(!html.includes('hq-content-link-articles'), 'the console links were drawn without a board');
  }
});

test('the board draws six lanes in the order given, each part named by its store', () => {
  const html = render(ContentBoard, { board: BOARD, unifiedReason: 'Two stores, two consoles.' });
  const keys = [...html.matchAll(/data-testid="hq-content-lane-([a-z_]+)"/g)].map((m) => m[1]).filter((k) => k !== 'no');
  assert.deepEqual(keys, ['draft', 'review', 'localisation', 'brand_approval', 'scheduled', 'published']);
  const draft = text(laneSlice(html, 'draft'));
  assert.match(draft, /Draft 3/);
  assert.match(draft, /2 articles/);
  assert.match(draft, /1 publications/);
  assert.match(draft, /article · draft · 2026-09-20 10:00/);
  assert.match(draft, /publication · draft · 2026-09-19 09:30/);
  assert.equal(count(html, 'data-testid="hq-content-card"'), 4);
  // Only an escalation knows its branch, so only it carries the chip.
  const brand = laneSlice(html, 'brand_approval');
  assert.match(text(brand), /French landing page/);
  assert.match(text(brand), /escalation · raised 2026-09-18 08:00 · past SLA/);
  assert.match(text(brand), /\bfr\b/);
  assert.ok(!text(laneSlice(html, 'draft')).match(/\bfr\b/), 'an article drew a branch chip');
  assert.match(text(html), /Publish time · Not recorded — Scheduled means approved/);
  assert.match(text(html), /Branch of origin · Not recorded — Neither an article nor a publication names a branch\./);
  assert.match(text(html), /Two stores, two consoles\./);
  assert.deepEqual(hrefs(html), ['/admin/articles', '/admin/publications']);
});

test('the Localisation lane has no source: "Not recorded" with its reason, never a number or "Unreadable"', () => {
  const lane = laneSlice(render(ContentBoard, { board: BOARD }), 'localisation');
  const seen = text(lane);
  assert.match(seen, /Localisation Not recorded/);
  assert.ok(lane.includes('data-testid="hq-content-lane-no-source"'));
  assert.match(seen, /nothing records that one piece is a localisation of another/);
  assert.ok(!seen.includes('Unreadable'), 'a lane with no source reads as a failed read');
  assert.ok(!/>\s*0\s*</.test(lane), 'a lane with no source drew a zero');
});

test('a part whose read failed is "Unreadable", the lane has no total, and nothing reads as zero', () => {
  const board = withLane('review', {
    total: null,
    total_reason: 'articles could not be counted, so this lane has no total rather than one smaller than the truth.',
    parts: [part('articles', ['submitted', 'in_review', 'changes_requested'], null, null, { reason: 'The articles table could not be read.' })],
  });
  const lane = laneSlice(render(ContentBoard, { board }), 'review');
  const seen = text(lane);
  assert.match(seen, /Review Unreadable/);
  assert.match(seen, /articles · Unreadable — The articles table could not be read\./);
  assert.match(seen, /no total rather than one smaller than the truth/);
  assert.ok(!seen.includes('Not recorded'), 'a failed read reads as a missing store');
  assert.ok(!/>\s*0\s*</.test(lane), 'a failed read drew a zero');
});

test('past its ceiling, the brand lane is "not fully counted" and still draws the oldest rows it read', () => {
  const reason = 'More than 2000 escalations are open, so the read stopped counting and this lane shows the oldest rather than a total.';
  const board = withLane('brand_approval', {
    total: null,
    total_reason: 'escalations could not be counted, so this lane has no total rather than one smaller than the truth.',
    parts: [part('escalations', ['open'], null, [escalation(), escalation({ uid: 'esc_2', subject: 'Nordic pricing page', branch_code: 'no' })], { reason })],
  });
  const lane = laneSlice(render(ContentBoard, { board }), 'brand_approval');
  const seen = text(lane);
  assert.match(seen, /Brand approval Not fully counted/);
  assert.match(seen, /open content escalations · not fully counted — More than 2000 escalations are open/);
  // The reason promises the oldest rows; the lane must actually draw them.
  assert.equal(count(lane, 'data-testid="hq-content-card"'), 2);
  assert.match(seen, /Nordic pricing page/);
  // It answered, so it is not a failed read.
  assert.ok(!seen.includes('Unreadable'), 'a count that stopped reads as a failed read');
});

test('a counted part whose newest rows could not be read keeps its count', () => {
  const board = withLane('scheduled', { parts: [part('articles', ['approved'], 1, null)] });
  const seen = text(laneSlice(render(ContentBoard, { board }), 'scheduled'));
  assert.match(seen, /1 articles/);
  assert.match(seen, /The newest rows could not be read; the count above stands\./);
});

test('statuses no lane names are reported, never dropped', () => {
  const html = render(ContentBoard, {
    board: { ...BOARD, other_publication_statuses: [{ status: 'embargoed', n: 2 }] },
    pipeline: { available: true, rejected: 1, unmapped_statuses: [{ status: 'held', n: 3 }] },
  });
  assert.match(text(html), /3 × held — articles in no lane above/);
  assert.match(text(html), /2 × embargoed — publications in a status no lane names/);
  assert.match(text(html), /1 article rejected, which is not a lane/);
});

// ─────────────────────────────────────────────────── C1 · Assessment Studio ──

test('C1: loading, the summary failing and the block failing draw no games, and all keep the footer and the link', () => {
  const states = [
    [render(AssessmentPanel, { loading: true }), /Reading the assessment games…/],
    [render(AssessmentPanel, { unreadable: true }), /Unreadable — The content summary did not answer, so the assessment games could not be read\./],
    [render(AssessmentPanel, { assessment: { available: false, reason: 'The assessment games could not be read.' } }), /Unreadable — The assessment games could not be read\./],
  ];
  for (const [html, expected] of states) {
    assert.match(text(html), expected);
    assert.ok(!html.includes('data-testid="hq-assessment-games"'), 'a game list was drawn with nothing behind it');
    assert.ok(html.includes('data-testid="hq-assessment-edit-reach"'), 'the edit-reach footer went missing');
    assert.deepEqual(hrefs(html), ['/admin/assessment']);
  }
});

test('C1: the footer says what an edit reaches, and never the canvas\'s republish claim', () => {
  assert.ok(H18.includes('republishes to every branch'), 'the canvas no longer makes the claim this refuses');
  assert.ok(H18.includes('the branch is told'));
  for (const html of [render(AssessmentPanel, { assessment: ASSESSMENT }), render(AssessmentPanel, { loading: true })]) {
    const seen = text(html);
    assert.ok(!seen.includes('republishes to every branch'), 'C1 claims an edit republishes to branches');
    assert.ok(!seen.includes('the branch is told'), 'C1 claims a branch is told');
    assert.match(seen, /nothing is republished and there is no branch to tell/);
  }
});

test('C1: the games render in the order given, with their pills and their line', () => {
  const html = render(AssessmentPanel, { assessment: ASSESSMENT });
  const seen = text(html);
  assert.match(seen, /Games authored 3/);
  assert.match(seen, /Chapters 3/);
  assert.match(seen, /Archetypes 5/);
  assert.match(seen, /1 published · 1 draft · 1 archived/);
  const titles = ['Founder fit', 'Market read', 'Old one'].map((t) => seen.indexOf(t));
  assert.ok(titles.every((at, i) => at > (titles[i - 1] ?? -1)), 'the games are out of the order given');
  assert.match(seen, /Founder fit v3 · 2 chapters · 4 archetypes · 12 active questions · 7 completed runs Published/);
  assert.match(seen, /Market read v1 · 1 chapter · 1 archetype · 1 active question · 0 completed runs Draft/);
  assert.match(seen, /Old one 0 chapters · 0 archetypes · 0 active questions · 1 completed run Archived/);
  assert.match(seen, /Completed runs recorded on HQ’s database/);
  assert.match(seen, /Live on branches · Not recorded — No game reaches a branch/);
  // "Live on N branches" is stated as absent, never drawn as a number.
  assert.ok(!/Live on \d/.test(seen), 'C1 drew a branch count');
});

test('C1: an empty studio says so; unreadable runs are never zero; a cut list says it was cut', () => {
  const empty = text(render(AssessmentPanel, {
    assessment: { ...ASSESSMENT, games: [], games_total: 0, chapters_total: 0, archetypes_total: 0, by_status: { draft: 0, published: 0, archived: 0 } },
  }));
  assert.match(empty, /No game is authored on HQ’s database\./);

  const runsDown = render(AssessmentPanel, {
    assessment: {
      ...ASSESSMENT,
      runs_available: false,
      runs_reason: 'The completed runs could not be read.',
      games: ASSESSMENT.games.map((g) => ({ ...g, runs: null })),
    },
  });
  assert.ok(runsDown.includes('data-testid="hq-assessment-runs-unreadable"'));
  assert.equal(count(text(runsDown), 'runs unreadable'), 3);
  // The property is a NUMBER of runs, not the words: the refusal's own reason
  // says "The completed runs could not be read", and a scan for the phrase
  // cannot tell that sentence from a count.
  assert.ok(!/\d+\s+completed runs?\b/.test(text(runsDown)), 'an unreadable run count read as a number');

  const cut = text(render(AssessmentPanel, { assessment: { ...ASSESSMENT, truncated: true, games_total: 51 } }));
  assert.match(cut, /The first 3 of 51 games are listed\./);

  const odd = text(render(AssessmentPanel, { assessment: { ...ASSESSMENT, other_statuses: [{ status: 'retired', n: 2 }] } }));
  assert.match(odd, /2 × retired — a status the code does not name/);
});

test('gameMeta: the counts the server measured, singular and plural, and no version when none', () => {
  assert.equal(gameMeta({ version: 3, chapters: 1, archetypes: 2, questions: 10, runs: 0 }),
    'v3 · 1 chapter · 2 archetypes · 10 active questions · 0 completed runs');
  assert.equal(gameMeta({ version: null, chapters: 2, archetypes: 1, questions: 1, runs: null }),
    '2 chapters · 1 archetype · 1 active question · runs unreadable');
});

// ───────────────────────────────────────────────────── C2 · personas ──

test('C2: loading, the summary failing and the block failing draw no list, and all keep the link', () => {
  const states = [
    [render(PersonasPanel, { loading: true }), /Reading the persona tags…/],
    [render(PersonasPanel, { unreadable: true }), /Unreadable — The content summary did not answer, so the persona tags could not be read\./],
    [render(PersonasPanel, { personas: { available: false, reason: 'The persona tags could not be read.' } }), /Unreadable — The persona tags could not be read\./],
  ];
  for (const [html, expected] of states) {
    assert.match(text(html), expected);
    assert.ok(!html.includes('data-testid="hq-personas-list"'));
    assert.deepEqual(hrefs(html), ['/admin?tab=personas']);
  }
});

test('C2: each persona with its count, the unclassified row, and a measured zero stays a zero', () => {
  const seen = text(render(PersonasPanel, { personas: PERSONAS }));
  assert.match(seen, /First-time founder 2 tagged/);
  assert.match(seen, /Repeat founder 0 tagged/);
  assert.match(seen, /Unclassified 4 with no primary tag/);
  assert.match(seen, /2 of 6 active accounts carry a primary tag; 4 carry none\./);
  assert.match(seen, /The set is defined in code, so no console adds, renames or retires a persona\./);
  assert.ok(!seen.includes('tagged with an id the code does not define'), 'an unrecognised line was drawn with none');
});

test('C2: a tag the code does not define is reported, and a double primary tag is explained', () => {
  const seen = text(render(PersonasPanel, {
    personas: { ...PERSONAS, unrecognised: [{ id: 'ghost_persona', tagged: 1 }], multi_primary: 1, tagged_sum: 3 },
  }));
  assert.match(seen, /ghost_persona \(1\) — tagged with an id the code does not define/);
  assert.match(seen, /1 account holds more than one primary tag — nothing prevents it — so the rows sum to 3 rather than 2\./);
});

test('personaFooting: one line when the rows foot, two when they do not', () => {
  assert.deepEqual(personaFooting(PERSONAS), ['2 of 6 active accounts carry a primary tag; 4 carry none.']);
  assert.deepEqual(personaFooting({ ...PERSONAS, tagged_sum: 5 }), [
    '2 of 6 active accounts carry a primary tag; 4 carry none.',
    'The rows sum to 5, not 2.',
  ]);
  assert.equal(personaFooting({ ...PERSONAS, multi_primary: 2, tagged_sum: 4 })[1],
    '2 accounts hold more than one primary tag — nothing prevents it — so the rows sum to 4 rather than 2.');
});

// ───────────────────────────────────────────────────────── C4 · roster ──

test('C4: loading, the summary failing and the block failing draw no table, and all keep the link', () => {
  const states = [
    [render(RosterPanel, { loading: true }), /Reading the roster…/],
    [render(RosterPanel, { unreadable: true }), /Unreadable — The content summary did not answer, so the roster could not be read\./],
    [render(RosterPanel, { roster: { available: false, reason: 'The network profiles table could not be read.' } }), /Unreadable — The network profiles table could not be read\./],
  ];
  for (const [html, expected] of states) {
    assert.match(text(html), expected);
    assert.ok(!html.includes('data-testid="hq-roster-rows"'));
    assert.deepEqual(hrefs(html), ['/admin?tab=network-profiles']);
  }
});

test('C4: the columns are the canvas\'s, with "Nominated by" stated as absent rather than drawn', () => {
  const html = render(RosterPanel, { roster: ROSTER });
  const columns = [...html.matchAll(/<th[^>]*>([^<]+)<\/th>/g)].map((m) => m[1]);
  const canvas = [...H19.matchAll(/<span class="th">([^<]+)<\/span>/g)].map((m) => m[1]);
  assert.deepEqual(canvas, ['Name', 'Role on decks', 'Nominated by', 'Appears on', 'State']);
  assert.deepEqual(columns, canvas.filter((c) => c !== 'Nominated by'));
  assert.match(text(html), /Nominated by · Not recorded — Nothing records who put a person on the roster\./);
});

test('C4: each row says what the deck does with it, in the deck\'s words', () => {
  const html = render(RosterPanel, { roster: ROSTER });
  const rows = [...html.matchAll(/<tr class="border-t[^"]*">([\s\S]*?)<\/tr>/g)].map((m) => text(m[1]).trim());
  assert.equal(rows.length, 5);
  assert.match(rows[0], /^Mia advisor Advisor Team & Network slide Active$/);
  assert.match(rows[1], /^Gus advisor · CFO · Acme name only Names list only Active$/);
  assert.match(rows[2], /^Ivy advisor · Counsel · Acme not printed Network total only Active$/);
  assert.match(rows[3], /^Old advisor · Partner · Acme not printed Not on the deck Archived$/);
  assert.match(rows[4], /^No name advisor · Acme Advisor Team & Network slide Active$/);
  const seen = text(html);
  assert.match(seen, /4 active · 1 archived · mentor 0 · partner 0 · advisor 4 · investor 0/);
  assert.match(seen, /A branch authors its own roster in its own database/);
  assert.ok(!html.includes('data-testid="hq-roster-unknown-kind"'), 'a known kind was reported as unknown');
});

test('C4: an empty roster says so, an unknown kind is reported, and a cut list says it was cut', () => {
  assert.match(text(render(RosterPanel, { roster: { ...ROSTER, rows: [], active: 0, archived: 0 } })),
    /No one is on the roster, so the deck built on HQ has no advisors to draw\./);
  const odd = text(render(RosterPanel, {
    roster: { ...ROSTER, by_kind: [...ROSTER.by_kind, { kind: 'coach', active: 1, archived: 0, known: false }] },
  }));
  assert.match(odd, /coach — a kind the code does not define\./);
  assert.match(text(render(RosterPanel, { roster: { ...ROSTER, truncated: true } })),
    /The first 5 rows are listed, in the deck’s own order\./);
});

test('REACH_LABEL names exactly the route\'s four states, and none in a word the platform retired', () => {
  const union = ROSTER_RULE.match(/export type DeckReach = ([^;]+);/);
  assert.ok(union, 'deckRoster.ts no longer exports its reach type');
  const states = [...union[1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
  assert.deepEqual(Object.keys(REACH_LABEL), [...states, 'archived']);
  for (const [state, label] of Object.entries(REACH_LABEL)) {
    assert.ok(!/mentor/i.test(label), `the ${state} label says "mentor", a role the platform renamed`);
  }
});

// ───────────────────────────────────────────────────────────── the rail ──

test('the rail counts the three new reads and names what H18 and H19 draw that nothing stores', () => {
  const at = P.indexOf('const coverage = [');
  const coverage = P.slice(at, P.indexOf('].filter(Boolean);', at));
  for (const read of ['assessment?.available', 'personas?.available', 'roster?.available', 'board && num(board.in_flight)']) {
    assert.ok(coverage.includes(read), `the rail's coverage no longer counts ${read}`);
  }
  const unavailable = P.slice(P.indexOf('unavailable={['), P.indexOf(']}', P.indexOf('unavailable={[')));
  for (const title of ['Publish time', 'Games on branches', 'Persona schema', 'Roster nominations', 'Localisation link']) {
    assert.equal(count(unavailable, `['${title}',`), 1, `the rail names "${title}" ${count(unavailable, `['${title}',`)} times`);
  }
});

// ─────────────────────────────────────────── Branch Programs, same fact ──

test('Branch Programs says what its empty game list read, and stops blaming HQ', () => {
  assert.match(NO_GAME_HERE, /this branch’s own database/);
  assert.match(NO_GAME_HERE, /no call sends one to a branch/);
  // Drawn as a sentence, not only as a hover title.
  const noGame = PROGRAMS.slice(PROGRAMS.indexOf('data-testid="branch-programs-no-game"'));
  assert.ok(noGame.slice(0, 400).includes('{NO_GAME_HERE}'), 'the reason lives only in a title attribute');
  assert.ok(!PROGRAMS.includes('authored at HQ yet'), 'the empty state blames HQ for having authored nothing');
  assert.ok(!/Per-game analytics is what/.test(PROGRAMS), 'the page claims to read per-game analytics');
  assert.ok(!/adminAssessment\.\w*[aA]nalytics/.test(PROGRAMS), 'the page calls per-game analytics after all');
});
