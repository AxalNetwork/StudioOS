/**
 * D779 (#2104), part 3 — the operating partner's own boards draft through the
 * run path, nothing is written without the member's Accept, and every draft
 * band of the investor, the advisor and the operating partner names its own
 * option to the rail.
 *
 * The part is the 19 rows of `lib/railOptions/partner.js` that part 2 did not
 * take: every one a zone draft band on a partner board. With parts 1 and 2,
 * every row of the investor's, advisor's and partner's inventories is covered.
 *
 *   draft   The band drafts on the member's press, from a stubbed run; the
 *           draft is all that is written, and Accept is the only further write
 *           (D770). No band hands Accept a callback that writes elsewhere.
 *   names   A run carries the option its band names (`X-Rail-Option`, D765),
 *           and `run()` takes its models from that option's row of the rail
 *           matrix (D764). A band keyed only by its surface names a key the
 *           matrix does not hold, so its run lost its option. Each band now
 *           names its inventory key: a literal on a one-profile board, D772's
 *           `railOptionFor` lookup on a board more than one profile renders.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/rail_options_run_d779_part3.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { codeOnly } from './_codeOnly.mjs';
import { INVESTOR_RAIL_OPTIONS } from '../src/lib/railOptions/investor.js';
import { ADVISOR_RAIL_OPTIONS } from '../src/lib/railOptions/advisor.js';
import { PARTNER_RAIL_OPTIONS } from '../src/lib/railOptions/partner.js';
import { railOptionFor } from '../src/lib/railOptions/index.js';
import { pageKeyFor } from '../src/lib/railPages.js';
import { assertDraftBandRun } from './_zone_draft_run.mjs';

const read = (f) => readFileSync(f, 'utf8');
const spa = (f) => codeOnly(read(`frontend/src/${f}`));
const matrix = JSON.parse(read('cloudflare-worker/src/services/ai/railMatrix.json'));
const research = codeOnly(read('cloudflare-worker/src/routes/research.ts'));
const surfaces = research.slice(research.indexOf('const DRAFT_SURFACES'), research.indexOf('\n};', research.indexOf('const DRAFT_SURFACES')));

// Part 2's partner rows: the advisor's own components.
const PART_2_SHARED = new Set([
  'answer:interview', 'explain:question', 'transcribe:voice-answer',
  'ask:library', 'draft:session-brief', 'draft:checkpoint-brief',
  'upload:document', 'reindex:document', 'draft:index-gaps',
]);
const surfaceOf = (marker) => /^surface="([^"]+)"$/.exec(marker || '')?.[1] ?? null;
const PART_3 = PARTNER_RAIL_OPTIONS.filter((o) => !PART_2_SHARED.has(o.key))
  .map((o) => ({ ...o, surface: surfaceOf(o.source.marker) }));

test('part 3 is the partner’s 19 other rows, every one a draft band, and the three parts cover every row', () => {
  assert.deepEqual(PART_3.map((o) => `${o.page}|${o.key}`), [
    'Home|draft:operating-brief',
    'Leads|draft:proposal',
    'Proposals|draft:win-loss-read',
    'Negotiations|draft:counter',
    'Retainers|draft:renewal-risk',
    'Analytics|draft:quarter-narrative',
    'Engagements|draft:board-read',
    'Deliverables|draft:chases',
    'Capacity|draft:capacity-findings',
    'Reporting|draft:weekly-reports',
    'Health|draft:renewal-risk',
    'Catalog|draft:catalog-read',
    'Perk deals|draft:expiry-consequences',
    'Visibility|draft:attribution-read',
    'Proof|draft:consent-requests',
    'Audience fit|draft:pass-reasons',
    'Relationships|draft:orphan-reassignment',
    'Introductions|suggest:paths',
    'Organizations|draft:single-contact-exposure',
  ]);
  assert.ok(PART_3.length <= 30);
  for (const o of PART_3) assert.ok(o.handler === 'draft' && o.surface, `${o.key}: not a draft band`);
  // Part 1 took the investor's 15, part 2 the advisor's 14 and these 9; together, every row.
  assert.equal(INVESTOR_RAIL_OPTIONS.length + ADVISOR_RAIL_OPTIONS.length + PARTNER_RAIL_OPTIONS.length, 15 + 14 + 9 + 19);
});

test('each band is a zone draft the Worker drafts, whose Accept writes only the draft', () => {
  for (const o of PART_3) {
    const src = spa(o.source.file);
    assert.equal(src.split(o.source.marker).length - 1, 1, `${o.key}: ${o.source.file} does not draw one ${o.surface} band`);
    const block = src.slice(src.lastIndexOf('<ZoneDraft', src.indexOf(o.source.marker)), src.indexOf('/>', src.indexOf(o.source.marker)));
    assert.match(block, /^<ZoneDraft\b/, `${o.key}: the ${o.surface} band is not a ZoneDraft`);
    assert.doesNotMatch(block, /onAccepted=/, `${o.key}: Accept hands the page a write`);
    const at = surfaces.indexOf(`'${o.surface}': {`);
    assert.ok(at >= 0, `${o.key}: the Worker drafts no surface ${o.surface}`);
    const entry = surfaces.slice(at, surfaces.indexOf("\n  '", at + 1));
    assert.doesNotMatch(entry, /\n\s+accept:/, `${o.key}: ${o.surface}'s Accept writes a record`);
  }
});

for (const o of PART_3) {
  test(`partner ${o.key} (${o.page}) drafts from a stubbed run, and only Accept writes again`, () =>
    assertDraftBandRun({ surface: o.surface, label: o.label, key: o.key, role: 'partner' }));
}

// ------------------------------------------------------------------ the option a run names

const BANDS = [
  ...INVESTOR_RAIL_OPTIONS.map((o) => ({ o, profile: 'Investor', marker: o.source.match })),
  ...ADVISOR_RAIL_OPTIONS.map((o) => ({ o, profile: 'Advisor', marker: o.source.marker })),
  ...PARTNER_RAIL_OPTIONS.map((o) => ({ o, profile: 'Operating Partner', marker: o.source.marker })),
].filter(({ o, marker }) => o.handler === 'draft' && surfaceOf(marker));

/** The page key a row sits on: the investor names it, the advisor and partner name their route. */
const pageOf = ({ o, profile }) => (profile === 'Investor' ? o.page : pageKeyFor(o.route, profile));

/** What the band hands ZoneDraft as `railOption`, resolved on the row's page. */
function namedKey(row) {
  const { o, marker } = row;
  const src = spa(o.source.file);
  const at = src.indexOf(marker);
  const block = src.slice(src.lastIndexOf('<ZoneDraft', at), src.indexOf('/>', at));
  const literal = /railOption="([^"]+)"/.exec(block)?.[1];
  if (literal) return literal;
  const lookup = /railOption=\{railOptionFor\(railPage, \{ file: (?:'([^']+)'|ZONE_FILE), control: '([^']+)' \}\)\?\.key\}/.exec(block);
  if (lookup) {
    const file = lookup[1] ?? /const ZONE_FILE = '([^']+)'/.exec(src)?.[1];
    assert.match(src, /const railPage = useRailPage\(\)\?\.page \?\? null;/, `${o.key}: ${o.source.file} reads no page for its lookup`);
    return railOptionFor(pageOf(row), { file, control: lookup[2] })?.key ?? null;
  }
  return null;
}

test('every draft band of the three profiles names its own option, and the matrix holds that option', () => {
  assert.equal(BANDS.length, 11 + 4 + 22);
  const options = new Map(matrix.options.map((r) => [`${r.pageKey}|${r.optionKey}`, r]));
  for (const row of BANDS) {
    const page = pageOf(row);
    assert.ok(page, `${row.o.key}: ${row.o.route ?? row.o.page} is on no rail page`);
    assert.equal(namedKey(row), row.o.key, `${row.profile} ${row.o.key}: the band names another option to the rail`);
    assert.ok(options.has(`${page}|${row.o.key}`), `${row.profile} ${row.o.key}: the matrix has no option row on ${page}`);
  }
});

test('a shared band still names the founder’s own key on the founder’s board', () => {
  for (const [file, surface, page, key] of [
    ['pages/RelationshipsPage.jsx', 'network/relationships', 'Founder · Network · Relationships', 'draft:network/relationships'],
    ['pages/IntroductionsPanel.jsx', 'network/introductions', 'Founder · Network · Introductions', 'draft:network/introductions'],
  ]) {
    assert.equal(railOptionFor(page, { file, control: surface })?.key, key);
  }
  // A board no profile lists the band on (a founder's marketplace catalog) names nothing,
  // and ZoneDraft keeps D770's `draft:<surface>`.
  assert.equal(railOptionFor('Founder · Studio', { file: 'pages/ServiceCatalogPage.jsx', control: 'offers/catalog' }), null);
  assert.match(spa('workspaces/ZoneDraft.jsx'), /useRailOption\(busy === 'run' \|\| item \? railOption \|\| `draft:\$\{surface\}` : null,/);
});
