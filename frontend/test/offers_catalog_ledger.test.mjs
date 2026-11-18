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

const CANVAS = raw('design/canvases/integrated/Pages · Partner Offers.dc.html');
const pageRaw = raw('frontend/src/pages/ServiceCatalogPage.jsx');
const page = read('frontend/src/pages/ServiceCatalogPage.jsx');
// #4843 part 3 (D4843-p3): the price basis and the request cell moved to the zone's pure model.
const model = read('frontend/src/pages/partner/offers/catalogModel.js');
const worker = raw('cloudflare-worker/src/routes/services.ts');
const migration = raw('cloudflare-worker/sql/migrations/227_service_offering_model_and_cents.sql');
const filters = read('frontend/src/workspaces/partnerZoneFilters.js');
const filtersRaw = raw('frontend/src/workspaces/partnerZoneFilters.js');
const actions = read('frontend/src/workspaces/partnerZoneActions.js');
const routes = read('frontend/src/workspaces/partner/PartnerBucketRoutes.jsx');

const PO1 = CANVAS.slice(CANVAS.indexOf("{ id:'po1'"), CANVAS.indexOf("{ id:'po2'"));
assert.ok(PO1.includes("route:'/offers/catalog'"), 'the po1 artboard could not be found in the canvas');

/** `MineTab`, bounded at the offering form that follows it (#4843 part 3 removed the tile helper). */
const MINE = page.slice(page.indexOf('export function MineTab('), page.indexOf('function OfferingFormModal('));
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

test('requests are counted from the request table by status, never stored on the row', () => {
  // #4696: `sold` counted every non-cancelled request, so a pending request read
  // as a sale. The worker serves counts by status from the request table.
  assert.match(worker, /SELECT COUNT\(\*\) FROM service_engagements se WHERE se\.offering_id = o\.id\) AS requested/,
    'the request counts are no longer joined from the request table');
  assert.ok(!/\bsold\b/.test(worker.replace(/\/\/.*$/gm, '')), 'a sold count is back on the offering read');
  assert.ok(!/ADD COLUMN (sold|requested)|(sold|requested) INTEGER/.test(migration),
    'a request counter has been added to the row, where it can drift');
  // #4843 part 3 (D4843-p3, OF-02): the count is a join, so a recorded 0 is a real zero
  // ("0 requests"); a row the read sent without counts reads Not recorded, never zero.
  assert.match(model, /const r = rowRequests\(o\);\s*if \(!r\) return null;/, 'a row without counts is given a number');
  assert.match(MINE, /requestsLine\(o\);\s*return line \?\? <NotMeasured label="Not recorded"/,
    'a row without counts no longer reads Not recorded');
});

test('an unpriced service is a draft, and the draft is derived rather than stored', () => {
  const fn = page.slice(page.indexOf('export function catalogState('), page.indexOf('export function MineTab('));
  assert.match(fn, /if \(o\.price_cents == null\) return 'Draft';/,
    'a service that cannot be quoted is no longer a draft');
  assert.match(fn, /return o\.is_active \? 'Live' : 'Unlisted';/,
    'the listing flag has stopped meaning what it meant');
  // The Price cell says so too, rather than printing a placeholder figure (OF-02: "No price yet").
  assert.match(model, /if \(o\?\.price_cents == null\) return null;/, 'an unpriced service is being given a number');
  assert.match(MINE, /priceBasis\(o\);\s*return line \?\? <span[^>]*>No price yet<\/span>/, 'the unpriced cell no longer says so');
});

test('the price column carries per-month only on the models that recur', () => {
  // The artboard's own rule, and its instNote's point: a seat and a retainer
  // price monthly, a fixed service prices once, and a figure without the suffix
  // beside one that has it reads as the same kind of number.
  assert.match(CANVAS, /c\.mode === 'Retainer' \|\| c\.mode === 'Seat' \? ' \/ mo' : ''/,
    'the canvas’s per-month rule has moved');
  // #4843 part 3 (D4843-p3): the price reads with its basis, "$48,000 fixed" or "$6,500 / month".
  assert.match(model, /if \(o\.engagement_model === 'retainer' \|\| o\.engagement_model === 'seat'\) return `\$\{amount\} \/ month`;/,
    'the per-month suffix no longer follows the artboard’s two recurring models');
});

test('OF-02 supersedes the po1 composition: no tiles, no linkage note, no instrument', () => {
  // #4843 part 3 (D4843-p3). Offers v2 board OF-02 draws the catalogue as one table: Service with its
  // category, Engagement model, Price with its basis, Listing, Requests, one row action. The po1 strip,
  // its linkage note and the five-column instrument with its long note left the page.
  assert.ok(PO1.includes('Pipeline · Leads computes each lead'), 'the po1 artboard this test reads has moved');
  for (const gone of ['<CatalogTile', 'Reads through to Pipeline', '<Instrument', 'label="Highest price"', 'Prices stored as integers']) {
    assert.ok(!MINE.includes(gone), `${gone} is back on the page`);
  }
  const heads = [...MINE.matchAll(/<th scope="col"[^>]*>([^<]+)<\/th>/g)].map((m) => m[1]);
  assert.deepEqual(heads, ['Service', 'Engagement model', 'Price', 'Listing', 'Requests']);
  // The listing switch counts the whole page of rows, never the narrowed list.
  assert.match(MINE, /const counts = listingCounts\(rows, catalogState\);/, 'the switch counts a narrowed list');
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
  assert.match(ops, /\{ label: 'New service', kind: 'handler', handler: 'newService', primary: true \}/,
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

test('the /offers board reads the catalog with the payload’s own field names', () => {
  // THE BUCKET BOARD AT `/offers` SHARES THIS ZONE'S PAYLOAD AND HAD ITS OWN
  // NAMES FOR IT. `rows: (d) => top(d?.items).map((o) => [o.name, title(o.category),
  // usd(o.price)])` — `name` and `price` are not keys `serialize()` emits, so
  // the Offering and Price columns rendered blank on every row while Category,
  // the one real name of the three, filled. Same shape as the `.offerings` /
  // `.items` envelope bug this file's header opens with, and as the five blank
  // export columns on Negotiations: a plausible key resolving to undefined and
  // nothing anywhere to say so.
  const board = read('frontend/src/workspaces/boards/partnerOffers.js');
  const section = board.slice(board.indexOf("slug: 'catalog'"), board.indexOf("slug: 'perk-deals'"));
  const rowFields = [...section.matchAll(/\bo\.([a-z_]+)/g)].map((m) => m[1]);
  assert.ok(rowFields.length >= 3, 'the catalog section no longer maps over the offering rows');

  // Every one of them has to be a key the worker actually sends.
  const serialize = worker.slice(worker.indexOf('function serialize('), worker.indexOf('services.get('));
  const emitted = new Set([...serialize.matchAll(/^\s{4}([a-z_]+):/gm)].map((m) => m[1]));
  // `sold` is added by the list query beside the serialized row, not inside it.
  emitted.add('sold');
  for (const f of rowFields) {
    assert.ok(emitted.has(f),
      `the board reads \`o.${f}\`, which GET /services/offerings does not send — that column renders blank`);
  }

  // And cents through the cents formatter: the artboard's instMeta is "Prices
  // stored as integers, formatted once", so `usd` over `price_cents` would
  // print $480,000 where the zone page prints $4,800.
  assert.match(section, /usdCents\(o\.price_cents\)/,
    'the board must format the integer price with the cents formatter');
});
