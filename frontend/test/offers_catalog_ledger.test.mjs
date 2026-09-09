/**
 * Offers · Catalog — the `po1` artboard, and the two columns it waited on.
 *
 * WHAT THIS ZONE WAS. `MineTab` in `ServiceCatalogPage`: a card grid over the
 * caller's own offerings, one live chip out of four, and a `New offering`
 * button above the list. The chip row said so honestly — "`Fixed`, `Retainer`
 * and `Seat` need a pricing-model column `service_offerings` does not have" —
 * and that was the whole of what was missing from three of the four.
 *
 * MIGRATION 227 IS THOSE TWO COLUMNS. `engagement_model`, CHECKed to the
 * artboard's own three values; and `price_cents`, because the instrument's meta
 * line is "Prices stored as integers, formatted once" and `price_usd` is a REAL.
 * The REAL stays for its fifty-two readers and one helper derives both from a
 * single input, so a write cannot set one without the other.
 *
 * `Sold` AND `Booked to date` NEEDED NO COLUMN. `service_engagements`
 * (migration 034) carries `offering_id`, so the count is a correlated subquery
 * and an engagement nobody linked is counted against nothing — the rule
 * migration 209 already follows for surface attribution.
 *
 * THE ARTBOARD'S SHARPEST CLAIM IS ABOUT ANOTHER ZONE, and this file keeps it:
 * an unpriced entry is a SCORING gap, because Pipeline · Leads matches against
 * these rows. A reader who does not know that reads the draft row as cosmetic.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const read = (p) => codeOnly(raw(p));

const CANVAS = raw('design/incoming/Pages · Partner Offers.dc.html');
const pageRaw = raw('frontend/src/pages/ServiceCatalogPage.jsx');
const page = read('frontend/src/pages/ServiceCatalogPage.jsx');
const worker = raw('cloudflare-worker/src/routes/services.ts');
const migration = raw('cloudflare-worker/sql/migrations/227_service_offering_model_and_cents.sql');
const filters = read('frontend/src/workspaces/partnerZoneFilters.js');
const filtersRaw = raw('frontend/src/workspaces/partnerZoneFilters.js');
const actions = read('frontend/src/workspaces/partnerZoneActions.js');
const routes = read('frontend/src/workspaces/partner/PartnerBucketRoutes.jsx');

const PO1 = CANVAS.slice(CANVAS.indexOf("{ id:'po1'"), CANVAS.indexOf("{ id:'po2'"));
assert.ok(PO1.includes("route:'/offers/catalog'"), 'the po1 artboard could not be found in the canvas');

/** `MineTab`, bounded at the tile helper that follows it. */
const MINE = page.slice(page.indexOf('export function MineTab('), page.indexOf('function CatalogTile('));
assert.ok(MINE.length > 1000, 'MineTab could not be located');

test('the four chips are live, and the reason they were not is gone', () => {
  const canvasChips = JSON.parse(`[${PO1.match(/filters: fil\(\[([^\]]+)\]/)[1].replace(/'/g, '"')}]`);
  assert.deepEqual(canvasChips, ['All', 'Fixed', 'Retainer', 'Seat']);
  const at = filters.indexOf("'offers/catalog': [");
  const row = filters.slice(at, filters.indexOf(']', at));
  for (const chip of canvasChips) {
    assert.match(row, new RegExp(`canvas: '${chip}', key: '[a-z]+'`), `${chip} is not a live chip`);
  }
  assert.ok(!filters.includes('NO_PRICING_MODEL'), 'the retired reason is still referenced');
  // Quoted rather than deleted: it was a correct reading of the store, and the
  // store changed. Flattened because the quote wraps across comment lines —
  // and this note is a `//` block rather than a docblock, so the prefix to
  // strip is the slashes rather than the stars.
  const doc = filtersRaw.replace(/^\s*(?:\*|\/\/)/gm, '').replace(/[`\s]+/g, ' ');
  assert.ok(doc.includes('a service stores one price and nothing saying whether it is charged'),
    'the docblock no longer records the gap this row waited on');
});

test('the model column is CHECKed to the three the chips name', () => {
  assert.match(migration, /ADD COLUMN engagement_model TEXT/, 'the model column is gone');
  assert.match(migration, /CHECK \(engagement_model IS NULL OR engagement_model IN \('fixed', 'retainer', 'seat'\)\)/,
    'the model column accepts any text again');
  // NULLABLE WITH NO DEFAULT. A service whose firm has not decided how it
  // charges reads `Not recorded`, not "Fixed" — defaulting would have the store
  // answer a question nobody asked it.
  assert.ok(!/engagement_model TEXT[^\n]*DEFAULT/.test(migration), 'the model column has been given a default');
  // One list, so a value the route lets through cannot be one the store refuses.
  assert.match(worker, /const MODELS = \['fixed', 'retainer', 'seat'\];/,
    'the route’s accepted models are no longer spelled out');
  assert.match(page, /const MODELS = \[\['fixed', 'Fixed'\], \['retainer', 'Retainer'\], \['seat', 'Seat'\]\];/,
    'the form’s options no longer match the column’s CHECK');
});

test('one input produces both money columns, so they cannot disagree', () => {
  // `price_usd` is a REAL read in fifty-two places and stays for them;
  // `price_cents` is what this zone reads and writes. A write that set one and
  // not the other would leave the catalog and every legacy reader disagreeing
  // about the same number.
  const fn = worker.slice(worker.indexOf('function priceFrom('), worker.indexOf('function isAdmin('));
  assert.match(fn, /const cents = Math\.round\(n \* 100\);/, 'the integer is no longer rounded from the input');
  assert.match(fn, /return \{ cents, usd: cents \/ 100 \};/,
    'the dollar figure is no longer derived from the integer, so the two can part company');
  for (const stmt of ['INSERT INTO service_offerings', 'UPDATE service_offerings SET']) {
    const at = worker.indexOf(stmt);
    assert.ok(at > 0, `${stmt} is gone`);
    const sql = worker.slice(at, at + 400);
    assert.ok(sql.includes('price_usd') && sql.includes('price_cents'),
      `${stmt} writes one money column without the other`);
  }
  // And the migration carries no backfill, because a migration reading
  // `price_usd` on this multiply-defined table cannot be sure the shape
  // carrying it won — `check-migration-column-shapes` refuses it, correctly.
  //
  // ASSERTED ON THE STATEMENTS, NOT THE FILE. The header quotes the very
  // statement it is explaining why it does not run, so a whole-file search for
  // it is satisfied by the explanation.
  const sql = migration.replace(/^\s*--.*$/gm, '');
  assert.ok(sql.includes('ADD COLUMN price_cents'), 'the SQL could not be separated from the header');
  assert.ok(!/UPDATE service_offerings/.test(sql),
    'the migration is reading a shape-dependent column again');
  assert.match(worker, /price_cents: o\.price_cents \?\? \(o\.price_usd == null \? null : Math\.round\(o\.price_usd \* 100\)\)/,
    'the read-side resolution that replaces that backfill is gone');
});

test('sold is counted from engagements, never stored on the row', () => {
  assert.match(worker, /SELECT COUNT\(\*\) FROM service_engagements se\s*\n\s*WHERE se\.offering_id = o\.id/,
    'the sold count is no longer joined from the engagement table');
  assert.ok(!/ADD COLUMN sold|sold INTEGER/.test(migration),
    'a sold counter has been added to the row, where it can drift');
  // A service nobody has linked reads an em dash rather than a zero: nothing
  // has been sold AND nothing has been recorded are the same cell here, and
  // "0" claims the first.
  assert.match(MINE, /\{ text: o\.sold \? String\(o\.sold\) : '—' \}/,
    'an unlinked service is reporting a zero it cannot know');
});

test('an unpriced service is a draft, and the draft is derived rather than stored', () => {
  const fn = page.slice(page.indexOf('export function catalogState('), page.indexOf('export function MineTab('));
  assert.match(fn, /if \(o\.price_cents == null\) return 'Draft';/,
    'a service that cannot be quoted is no longer a draft');
  assert.match(fn, /return o\.is_active \? 'Live' : 'Unlisted';/,
    'the listing flag has stopped meaning what it meant');
  // The Price cell says so too, rather than printing a placeholder figure.
  assert.match(MINE, /o\.price_cents == null\s*\n\s*\? \{ nr: true \}/,
    'an unpriced service is being given a number');
});

test('the price column carries per-month only on the models that recur', () => {
  // The artboard's own rule, and its instNote's point: a seat and a retainer
  // price monthly, a fixed service prices once, and a figure without the suffix
  // beside one that has it reads as the same kind of number.
  assert.match(CANVAS, /c\.mode === 'Retainer' \|\| c\.mode === 'Seat' \? ' \/ mo' : ''/,
    'the canvas’s per-month rule has moved');
  assert.match(MINE, /o\.engagement_model === 'retainer' \|\| o\.engagement_model === 'seat' \? ' \/ mo' : ''/,
    'the per-month suffix no longer follows the artboard’s two recurring models');
});

test('the four tiles are the artboard’s, and the strip counts the whole catalog', () => {
  const adds = PO1.slice(PO1.indexOf('adds:['), PO1.indexOf('linkage:'));
  const labels = [...adds.matchAll(/label:'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(labels, ['Live services', 'Booked to date', 'Highest price', 'Retainer price']);
  for (const label of labels) {
    assert.ok(MINE.includes(`label="${label}"`), `the strip has lost the ${label} tile`);
  }
  // COUNTED OVER `rows`, NEVER OVER THE CHIP-NARROWED LIST. A tile that changes
  // because you clicked `Seat` is not reporting what it claims to.
  const tiles = MINE.slice(MINE.indexOf('const priced = rows.filter('), MINE.indexOf('const handlers ='));
  assert.ok(tiles.length > 0, 'the tile counts are gone');
  assert.ok(!/\bvisible\b/.test(tiles), 'a tile count is reading the chip-narrowed list');
  // The artboard's `Retainer price` is `Not recorded` because its retainer is
  // the unpriced draft. Here it is the firm's own retainer when they have
  // priced one — the same tile reporting on this reader's catalog.
  assert.match(MINE, /label="Retainer price" nr/, 'the retainer tile can no longer be absent');
  assert.match(MINE, /the one draft — scope not final/, 'the artboard’s note for that tile is gone');
});

test('the linkage note says an unpriced entry is a scoring gap', () => {
  // The artboard's `linkage`, and the reason it is not decoration: "The unpriced
  // retainer scores as a capability but not as a fit, so retainer-shaped leads
  // currently read lower than they should — a pricing decision, surfacing as a
  // pipeline symptom."
  assert.match(PO1, /Pipeline · Leads computes each lead/, 'the canvas’s linkage note has moved');
  assert.ok(MINE.includes('Reads through to Pipeline:'), 'the linkage note is gone');
  assert.ok(MINE.includes('Pipeline · Leads computes each lead’s match score against these entries.'),
    'the linkage note no longer says what reads through');
  assert.ok(MINE.includes('as a capability but not as a fit'),
    'the linkage note no longer says what an unpriced entry costs');
});

test('the instrument draws the artboard’s columns, in its order and at its widths', () => {
  const head = JSON.parse(`[${PO1.match(/head:\[([^\]]+)\]/)[1].replace(/\\u2019/g, '’').replace(/'/g, '"')}]`);
  assert.deepEqual(head, ['Service', 'Model', 'Price', 'Sold', 'What’s included']);
  assert.ok(MINE.includes(`head={${JSON.stringify(head).replace(/"/g, "'").replace(/,/g, ', ')}}`),
    'the instrument head is no longer the artboard’s five columns in its order');
  assert.ok(MINE.includes(`cols="${PO1.match(/cols:'([^']+)'/)[1]}"`),
    'the instrument no longer uses the artboard’s column widths');
  assert.ok(MINE.includes(PO1.match(/instMeta:'([^']+)'/)[1]),
    'the instrument’s meta line has left the artboard');
});

test('the row keeps every control the card grid had', () => {
  // The list became a table, and a table with no way to edit a row would be a
  // composition that cost capability. The controls ride inside the cell whose
  // subject they act on, which is what `Cell`'s `node` is for.
  for (const control of ['>Edit<', '>Delete<', "{o.is_active ? 'Unlist' : 'List'}"]) {
    assert.ok(MINE.includes(control), `the rewrite lost the row control: ${control}`);
  }
  assert.ok(MINE.includes('<OfferingFormModal'), 'the offering form is gone');
});

test('New service is a page op, and Pricing history is still prose', () => {
  const at = actions.indexOf("'offers/catalog': [");
  const ops = actions.slice(at, actions.indexOf('],', at));
  const canvasOps = JSON.parse(`[${PO1.match(/ops:\[([^\]]+)\]/)[1].replace(/'/g, '"')}]`);
  assert.deepEqual(canvasOps, ['New service', 'Pricing history', 'Export']);
  assert.match(ops, /\{ label: 'New service', kind: 'handler', handler: 'newService' \}/,
    'New service is no longer performed by the page');
  // AND MIGRATION 227 DID NOT MAKE `Pricing history` BUILDABLE. It added a
  // MODEL, not a series: one price is stored and an edit overwrites it.
  assert.match(ops, /\{ label: 'Pricing history', unbuilt: '/, 'Pricing history has been given a control');
  assert.ok(!/price_history|offering_prices/.test(migration + worker),
    'a price history table has appeared, so that op should no longer be prose');
  // The binder passes handlers, or the op renders nowhere at all.
  assert.match(routes, /zoneActions=\{\(rows, handlers\) => partnerZoneActions\('offers\/catalog', \{ handlers, view: \{/,
    'the catalog binder drops handlers, so its page-supplied op renders nowhere');
});

test('the AI band is the artboard’s, on its own allow-listed surface', () => {
  const label = PO1.match(/aiLabel:'([^']*)'/)[1];
  const accept = PO1.match(/aiAccept:'([^']*)'/)[1];
  const foot = PO1.match(/aiFoot:'([^']*)'/)[1];
  const band = MINE.slice(MINE.indexOf('<ZoneDraft'), MINE.indexOf('/>', MINE.indexOf('<ZoneDraft')));
  assert.ok(band.includes('surface="offers/catalog"'), 'the band is on the wrong surface');
  assert.ok(band.includes(`label="${label}"`), `the band's label left the artboard: ${label}`);
  assert.ok(band.includes(`accept="${accept}"`), `the band's accept left the artboard: ${accept}`);
  assert.ok(band.includes(`foot="${foot}"`), `the band's footnote left the artboard: ${foot}`);
  // And the gather reads the catalog rather than anything else — a draft over a
  // different table would be grounded in the wrong record.
  const spec = raw('cloudflare-worker/src/routes/research.ts');
  const at = spec.indexOf("'offers/catalog': {");
  assert.ok(at > 0, 'the catalog surface is not allow-listed, so the band 400s');
  const gather = spec.slice(at, spec.indexOf("'network/organizations': {"));
  assert.ok(gather.includes('FROM service_offerings o WHERE o.owner_user_id = ?'),
    'the draft is no longer read from the caller’s own catalog');
  assert.ok(gather.includes('NO PRICE RECORDED'),
    'the draft no longer sees which entries have no price, which is the gap it exists to name');
});

test('five icons went with the card grid, and the docblock says which', () => {
  // `check-unused-imports` is CodeQL-backed and reports an imported-but-unused
  // name as an alert. The five that labelled the grid's controls are gone.
  const imports = pageRaw.slice(0, pageRaw.indexOf("} from 'lucide-react';"));
  for (const icon of ['Plus', 'Edit3', 'Trash2', 'ToggleLeft', 'ToggleRight']) {
    assert.ok(!new RegExp(`\\b${icon}\\b`).test(imports.split('import {')[1] || ''),
      `${icon} is still imported and nothing uses it`);
  }
  assert.ok(pageRaw.includes('FIVE ICONS WENT WITH THE CARD GRID'),
    'the removal is no longer recorded, so the next reader re-adds them');
});
