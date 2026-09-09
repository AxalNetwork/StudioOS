/**
 * `/build` — the A3 artboard, element by element.
 *
 * THE OVERVIEW IS A SUMMARY OF FIVE PAGES, and `Founder Workspaces Canvas`
 * artboard A3 says what each of its cards carries. The links were fixed in
 * `founder_overview_subpage_links`; this file is about the cards themselves.
 *
 * WHAT THE ARTBOARD ASKED FOR THAT WAS NOT THERE:
 *
 *   the chip order        A3's `anchB` is This week, Board, Roadmap, Cadence,
 *                         KPI entry; Cadence sat third
 *   a fourth column       the board draws Backlog / In progress / Review /
 *                         Shipped and the desk drew three, silently
 *   the column notes      "2 added this week", "1 stale 5 days"
 *   the roadmap period    `roadmap_okrs.quarter` exists and had never been read
 *   the horizon pills     In flight / Committed / Provisional
 *   KPI ENTRY AS ENTRY    "Input only" is the card's own subtitle; the desk
 *                         rendered four read-only figures and two links away
 *   three proposal bands  Monday plan, tradeoff-reasoned, out-of-range
 *
 * AND WHAT THE ARTBOARD ASKS FOR THAT THIS PRODUCT CANNOT DO. A key result
 * records `text/current/target/unit` and nothing else, so the artboard's owner
 * column and its On track / At risk / Done pill have nothing behind them;
 * `mvp_tasks.status` has no review state; and no cadence store exists at all.
 * Each is drawn as an absence with its reason rather than filled in (D56/D68) —
 * and the count beside "commitments" says `risk not recorded` rather than
 * quietly reporting zero at risk.
 *
 * EVERY FIGURE IS STILL THE READER'S OWN. The artboard's `4 commitments · 1 at
 * risk`, its `$21,412` and its `Amara` are its fixture's; the page prints none
 * of them.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const read = (p) => codeOnly(raw(p));

const CANVAS = raw('design/incoming/Founder Workspaces Canvas.dc.html');
const pageRaw = raw('frontend/src/pages/founder/FounderBuildDesk.jsx');
const page = codeOnly(pageRaw);
const css = raw('frontend/src/pages/founder/founderBuildDesk.css');
const worker = raw('cloudflare-worker/src/routes/research.ts');

/** The A3 artboard, bounded by the two markers either side of it. */
const A3 = CANVAS.slice(
  CANVAS.indexOf('ARTBOARD 3 — BUILD'),
  CANVAS.indexOf('ARTBOARD 4'),
);
assert.ok(A3.includes('Operate the company this week'), 'the A3 artboard could not be found in the canvas');
/**
 * A3's fixtures live in the canvas DATA BLOCK, not inside the artboard.
 *
 * Slicing the `<section id="a3">` alone finds the markup and none of the
 * columns, pills or KPI labels the markup loops over — every one of those is a
 * `const` further down the file. An earlier guard in this suite sliced the
 * wrong artboard's chips by searching the whole file instead (`indexOf
 * 'r_views'` matched `pr_views`), so both halves are bounded here: the anchor
 * row by its own key, and the rest by the `---- Build ----` marker and the
 * `---- Raise ----` one after it.
 */
const ANCH_B = CANVAS.match(/anchB: this\.anchorsFor\('B', \[([\s\S]*?)\]\),/)?.[1] || '';
assert.ok(ANCH_B.includes('b-week'), 'A3’s anchor row could not be found in the canvas');
const A3DATA = CANVAS.slice(CANVAS.indexOf('// ---- Build ----'), CANVAS.indexOf('// ---- Raise ----'));
assert.ok(A3DATA.includes('commits: ['), 'A3’s data block could not be found in the canvas');

/** Prose flattened out of comment markers, line wraps and `\uXXXX` escapes. */
const flat = (s) => s
  .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/^\s*(?:--|\/\/|\*)/gm, '')
  .replace(/\s+/g, ' ');

test('the headline and its one-line answer to “why this page” are the artboard’s', () => {
  assert.ok(page.includes('Operate the company this week'));
  const line = 'Commitments first. Everything else on this page exists to serve the seven days in front of you.';
  assert.ok(flat(A3).includes(line), 'the artboard’s subtitle changed');
  assert.ok(flat(page).includes(line), 'the desk no longer carries the artboard’s subtitle');
});

test('the chip row is the artboard’s anchors, in its order', () => {
  const labels = [...ANCH_B.matchAll(/\['([^']+)','[^']+'\]/g)].map((m) => m[1]);
  assert.deepEqual(labels, ['This week', 'Board', 'Roadmap', 'Cadence', 'KPI entry']);
  const sections = page.match(/const SECTIONS = \[([\s\S]*?)\];/)?.[1] || '';
  assert.deepEqual(
    [...sections.matchAll(/\['([^']+)', '[^']+'\]/g)].map((m) => m[1]),
    labels,
    'the chip row is no longer A3’s anchors in A3’s order',
  );
});

test('the cards are the artboard’s cards, in its order', () => {
  const titles = [...A3.matchAll(/class="zt">([^<]+)</g)].map((m) => m[1].replace(/ · .*/, ''));
  assert.deepEqual(titles, ['This week', 'Execution board', 'Operating cadence', 'Roadmap', 'KPI entry']);
  const drawn = [...page.matchAll(/<SectionHead\b[^>]*?title=(?:"([^"]+)"|\{`([^`]+)`\})/g)]
    .map((m) => (m[1] || m[2]).replace(/ · .*/, '').replace(/\$\{.*/, '').trim());
  assert.deepEqual(drawn, titles, 'the overview is no longer the artboard’s five cards in its order');
});

test('the board draws all four of the artboard’s columns, and says why one is empty', () => {
  const columns = [...A3DATA.matchAll(/\{ col:'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(columns, ['Backlog', 'In progress', 'Review', 'Shipped']);
  const table = page.match(/const BOARD_COLUMNS = \[([\s\S]*?)\];/)?.[1] || '';
  assert.deepEqual(
    [...table.matchAll(/\['([^']+)', (?:'(\w+)'|null)\]/g)].map((m) => m[1]),
    columns,
    'the execution board no longer draws the artboard’s four columns',
  );
  // Review is the one with no status behind it, and it must be the ONLY one:
  // a second null would mean a real column had quietly lost its key.
  const unbacked = [...table.matchAll(/\['([^']+)', null\]/g)].map((m) => m[1]);
  assert.deepEqual(unbacked, ['Review'], 'exactly one board column may be unbacked, and it is Review');
  // A zero would read as "nothing is in review", which is a different claim
  // from "review is not a state this product records".
  assert.match(page, /if \(key === null\) return \{ label, key, count: null, note: 'No review state is recorded' \};/,
    'the unbacked column must draw no count at all, and say why');
  assert.match(page, /column\.count === null \? '—' :/);
  // AND THE UNREADABLE BOARD IS A THIRD ABSENCE. `Number(taskCounts.todo) || 0`
  // told a founder their board was empty whenever the read behind it failed,
  // because the failure was caught into an empty array.
  assert.match(page, /return \{ label, key, count: null, note: 'The board could not be read' \};/,
    'an unreadable board reports a zero rather than saying it could not be read');
  assert.match(page, /const rows = Array\.isArray\(cards\) \? cards\.filter\(\(card\) => card\.status === key\) : null;/);
  assert.ok(!/setCards\((?:detail\?\.tasks )?\|\| \[\]\)/.test(page),
    'a failed detail read is being flattened into "no cards"');
  assert.match(css, /(^|\})\.stage-grid>div\.is-unbacked\{/m,
    'the unbacked column is styled the same as a backed one');
});

test('each column note is derived from the rows its own count came from', () => {
  // The artboard prints "2 added this week" under "6". The Partner Retainers
  // zone shipped a chip that narrowed one list while its tile counted another,
  // and this is the same shape: the note and the number must come from one set
  // of rows or they will eventually disagree.
  assert.match(page, /if \(rows\) return \{ label, key, count: rows\.length, note: columnNote\(rows, key\) \};/,
    'the note and the count no longer come from one set of rows');
  assert.match(page, /if \(added\) return `\$\{added\} added this week`;/);
  assert.match(page, /days >= 5 \? `1 stale \$\{days\} days`/);
  assert.match(page, /api\.pipelineDealDetail\(projectId\)/,
    'the notes need the rows, and only the detail read returns them');
});

test('the roadmap draws the artboard’s quarter and its horizon pill', () => {
  const states = [...A3DATA.matchAll(/state:'([^']+)',\s*$/gm)].map((m) => m[1]);
  assert.deepEqual(states, ['In flight', 'Committed', 'Provisional'], 'A3’s roadmap pills changed');
  const horizons = page.match(/const HORIZONS = \[([\s\S]*?)\];/)?.[1] || '';
  assert.deepEqual([...horizons.matchAll(/\['\w+', '([^']+)'\]/g)].map((m) => m[1]), states);
  // `quarter` is a real column that nothing read, which is why a founder who
  // set one saw "now" where they had written it.
  assert.match(page, /function periodOf\(items\) \{/);
  assert.match(page, /item\.quarter/, 'the roadmap period no longer reads the stored quarter');
  assert.match(page, /if \(!quarters\.length\) return 'Quarter not recorded';/);
});

test('KPI entry is entry: three fields, a save, and a derived runway that is not one', () => {
  const labels = [...A3DATA.matchAll(/\{ label:'([^']+)', value:'[^']*', flag:/g)].map((m) => m[1]);
  assert.deepEqual(labels, ['MRR', 'Paid trials', 'Monthly burn', 'Runway']);
  const fields = page.match(/const fields = \[([\s\S]*?)\];/)?.[1] || '';
  const drawn = [...fields.matchAll(/\['(\w+)', '([^']+)', '[^']*'\]/g)];
  assert.deepEqual(drawn.map((m) => m[2]), ['MRR', 'Paid trials', 'Monthly burn'],
    'the three enterable KPIs are no longer the artboard’s first three');
  assert.deepEqual(drawn.map((m) => m[1]), ['mrr', 'paying_accounts', 'net_burn'],
    'a KPI field no longer writes the column the server stores it in');
  // Runway is the fourth box on the artboard and the one the server refuses
  // from a client, so that cash, burn and runway cannot disagree in one board
  // pack (`progress.ts`). It is drawn, and it is not a field.
  // AND THEY ARE ACTUALLY FIELDS. Renaming the test ids while leaving read-only
  // markup behind them would pass every assertion above and ship the same
  // read-back card the artboard is not.
  assert.match(page, /<input\n\s*data-testid=\{`input-kpi-\$\{key\}`\}/,
    'the KPI figures are not input elements');
  assert.match(page, /onChange=\{\(event\) => setForm\(\(old\) => \(\{ \.\.\.old, \[key\]: event\.target\.value \}\)\)\}/,
    'the KPI fields cannot be typed into');
  assert.match(page, /className="is-derived"><span>Runway<\/span>/);
  assert.match(page, /Derived from cash and burn — not entered/);
  assert.ok(!/data-testid=\{?`?input-kpi-runway/.test(page), 'runway must not be enterable');
  assert.match(page, /api\.createMetricsSnapshot\(projectId,/,
    'the KPI card no longer writes anything');
  assert.match(page, /data-testid="button-save-kpi"/);
  assert.match(css, /(^|\})\.kpi-grid input\{/m, 'the KPI fields are not styled as inputs');
});

test('the out-of-range flag needs two snapshots and a real move', () => {
  // A3 flags burn with "+31% on last month". One snapshot is not a movement,
  // and a flag on every figure that wobbled a point would be noise on a card
  // whose whole job is to show the one figure worth explaining.
  assert.match(page, /if \(!latest \|\| !previous\) return null;/);
  assert.match(page, /if \(Math\.abs\(pct\) < 20\) return null;/);
  assert.match(page, /on the previous snapshot/);
  assert.ok(!/\+31%/.test(page), 'the artboard’s own figure is on the page');
});

test('the three proposal bands are mounted, off by default, and allow-listed', () => {
  const bands = [...A3.matchAll(/class="propb">([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(bands, ['Proposal · Monday plan', 'Proposal · tradeoff, reasoned', 'Out of range · explain this?']);
  const mounted = [...page.matchAll(/<ZoneDraft\b[\s\S]*?label="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(mounted, bands, 'the desk no longer carries A3’s three bands, in its order');

  const surfaces = [...page.matchAll(/<ZoneDraft\s+surface="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(surfaces, ['build/this-week', 'build/roadmap', 'build/kpi']);
  // CONFIG FOLLOWS A MOUNT. Five `ZoneDraft` mounts once sat with no
  // `DRAFT_SURFACES` entry behind them and failed silently on every press.
  for (const surface of surfaces) {
    assert.ok(worker.includes(`'${surface}': {`), `${surface} is mounted with no DRAFT_SURFACES entry`);
  }
  // OFF UNTIL THE FOUNDER TURNS IT ON. Every run spends their own budget
  // against their own cap.
  assert.match(page, /const \[fillsOn\] = useAssistMode\('Build'\);/);
  assert.equal((page.match(/\{fillsOn && projectId \? <ZoneDraft/g) || []).length, 3,
    'a band renders without the assist mode being on, or without a project to scope it to');
  assert.equal((page.match(/accent="violet"/g) || []).length, 3,
    'a founder band is drawing in the Partner palette');
});

test('every founder draft surface scopes to a project the caller owns', () => {
  // `/research/drafts` authorises on `requireAuth` alone and delegates scoping
  // to each surface, so a gather that forgets is a cross-account read.
  const table = worker.slice(worker.indexOf('const DRAFT_SURFACES'));
  for (const surface of ['build/this-week', 'build/roadmap', 'build/kpi']) {
    const body = table.slice(table.indexOf(`'${surface}': {`));
    const gather = body.slice(body.indexOf('gather:'), body.indexOf('\n  },'));
    assert.match(gather, /const pid = await founderProject\(c, userId, scope\);/,
      `${surface} does not resolve its project through the ownership check`);
    assert.match(gather, /if \(pid == null\) return \[\];/,
      `${surface} continues after the ownership check fails`);
    assert.ok(!/\bWHERE [^`]*user_?id = \?[^`]*`\s*\)\.bind\(userId\)/.test(gather)
      || /founderProject/.test(gather),
      `${surface} reads by user id without going through the project check`);
  }
  assert.match(worker, /JOIN users u ON u\.founder_id = p\.founder_id\n\s*WHERE u\.id = \? AND p\.deleted_at IS NULL/,
    'the founder project check no longer joins the caller to the project');
  assert.match(worker, /return ids\.length === 1 \? ids\[0\] : null;/,
    'a founder with two startups and no scope key must get nothing, not an arbitrary pick');
  // A scope key that was SENT must resolve or refuse. Testing `Number.isFinite`
  // first let `scope_key: "null"` read as "none sent" and draft over whichever
  // single project the caller owned — a draft about a startup nobody named.
  assert.match(worker, /if \(scope !== ''\) \{\n\s*const asked = Number\(scope\);\n\s*return Number\.isInteger\(asked\) && ids\.includes\(asked\) \? asked : null;/,
    'an unparseable scope key falls through to the lone-project branch');
});

test('the shared band honours the accent it is handed', () => {
  // A3 is the first violet mount of `ZoneDraft` — 23 Partner mounts came
  // first and it was amber-hardcoded in five places. Asserting `accent="violet"`
  // on the desk alone would pass with the prop dropped on the floor, which is
  // what a mutation of exactly that shape did.
  const band = read('frontend/src/workspaces/ZoneDraft.jsx');
  assert.match(band, /const skin = ACCENTS\[accent\] \|\| ACCENTS\.amber;/,
    'the band no longer resolves its palette from the prop');
  assert.match(band, /accent = 'amber',/, 'amber must stay the default so no Partner mount changes');
  const table = band.match(/const ACCENTS = \{([\s\S]*?)\n\};/)?.[1] || '';
  for (const name of ['amber', 'violet']) {
    assert.ok(new RegExp(`\\b${name}: \\{`).test(table), `the ${name} palette is gone`);
  }
  // Every hardcoded site moved: a band whose eyebrow was violet and whose
  // button stayed amber would read as two different things on one card.
  for (const part of ['band', 'ink', 'edit', 'button']) {
    assert.ok(new RegExp(`skin\\.${part}\\b`).test(band), `the ${part} no longer follows the accent`);
  }
  assert.ok(!/border-amber-600 bg-amber-600[\s\S]*?border-violet-600 bg-violet-600[\s\S]*?border-amber-600/.test(band),
    'an amber literal survives outside the palette table');
  assert.equal((band.match(/text-axal-amber-deep/g) || []).length, 1,
    'the amber ink colour is used outside its own palette entry');
});

test('A3 never turns canvas fixtures into product data or claims', () => {
  assert.doesNotMatch(page, /Async digest|pending trials|Pricing page copy|Amara|Guillaume|Dmitri|Slack integration|permissions model|Self-serve trial|EU data residency|\$4,200|\$21,412|18 mo|4 commitments|14 cards|Mon 9:00|Wed 9:00|Fri 16:00|Llama|QwQ|Granite|flux-/i);
  // The owner column and the state pill are the artboard's, and nothing
  // records either.
  assert.doesNotMatch(page, /On track|At risk['"]/);
  assert.match(page, /An owner and an at-risk state are not recorded against a key result/);
  assert.match(page, /risk not recorded/, 'the commitment count silently reports zero at risk');
});
