/**
 * Offers · Catalog reads and writes the fields the worker actually has.
 *
 * WHAT THIS EXISTS TO STOP, FOUND WHILE MATCHING THE OFFERS ARTIFACT.
 * `ServiceCatalogPage.jsx` was written against a payload shape that has never
 * existed. `GET /services/offerings` answers `serialize(o)` — `id`, `uid`,
 * `owner_user_id`, `title`, `category`, `summary`, `price_usd`, `is_active`,
 * `created_at`, `updated_at` — and the page read `o.price`, `o.currency`,
 * `o.sla_days`, `o.listed` and `o.description`. Five names, none of them sent.
 *
 * THE FIRST ONE THREW. Four sites called `o.price.toLocaleString()` with no
 * guard, so the card crashed on the first row it drew. The page has looked
 * fine only because `service_offerings` holds no rows in production: the empty
 * state renders and the card that crashes never does. The zone was one
 * published offering away from a blank screen.
 *
 * THE WRITES WERE WORSE, BECAUSE THEY FAILED SILENTLY. The editor posted
 * `description`, `deliverables`, `price`, `currency`, `sla_days` and `listed`;
 * `POST` and `PUT` read `title`, `category`, `summary`, `price_usd` and
 * `is_active`. A field a handler does not name is not rejected — it is simply
 * not read — so a partner filled in a price, a currency, an SLA and a
 * description, pressed save, and got a row carrying a title and a category.
 * The per-row list/unlist toggle sent `{ listed }` against a handler reading
 * `body.is_active`, which made it a no-op that looked like it worked.
 *
 * HOW THIS IS CHECKED. The worker file is the contract and is parsed for what
 * it serializes and what its two write handlers name; the page is then held to
 * that set. Nothing here is a hardcoded list of field names, so a column added
 * to `service_offerings` and served by the worker does not fail this test —
 * only a page reading or writing something the worker does not have does.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

const WORKER = read('cloudflare-worker/src/routes/services.ts');
const PAGE = codeOnly(read('frontend/src/pages/ServiceCatalogPage.jsx'));
const ROUTES = codeOnly(read('frontend/src/workspaces/partner/PartnerBucketRoutes.jsx'));

/** The keys `serialize()` puts on the wire — the read contract. */
function serializedKeys() {
  const at = WORKER.indexOf('function serialize(');
  assert.ok(at > 0, 'services.ts no longer declares serialize()');
  const body = WORKER.slice(WORKER.indexOf('{', at), WORKER.indexOf('\n}', at));
  const keys = [...body.matchAll(/^\s{4}([a-z_]+):/gm)].map((m) => m[1]);
  assert.ok(keys.length >= 8, `serialize() yielded ${keys.length} keys — the parser is not parsing`);
  return new Set(keys);
}

/** The body fields POST and PUT actually read — the write contract. */
function acceptedKeys() {
  const keys = new Set();
  for (const m of WORKER.matchAll(/body\??\.([a-z_]+)/g)) keys.add(m[1]);
  assert.ok(keys.size >= 4, `only ${keys.size} body fields found — the parser is not parsing`);
  return keys;
}

const SERIALIZED = serializedKeys();
const ACCEPTED = acceptedKeys();

test('the worker still serializes the fields this page is built on', () => {
  // A floor, so the two tests below cannot pass by the contract emptying out.
  for (const key of ['title', 'category', 'summary', 'price_usd', 'is_active']) {
    assert.ok(SERIALIZED.has(key), `serialize() stopped sending ${key}`);
  }
  for (const key of ['title', 'category', 'summary', 'price_usd', 'is_active']) {
    assert.ok(ACCEPTED.has(key), `neither write handler reads ${key} any more`);
  }
});

test('the page reads no offering field the worker does not send', () => {
  // Every `o.<field>` and `offering.<field>` the page dereferences. `partner_name`
  // and `partner_kyb_status` are joined in by other callers of this component and
  // are read defensively, so they are allowed through by name.
  const JOINED = new Set(['partner_name', 'partner_kyb_status', 'id']);
  const seen = new Set();
  for (const m of PAGE.matchAll(/\b(?:o|offering)\??\.([a-z_]+)/g)) seen.add(m[1]);
  assert.ok(seen.size >= 5, `only ${seen.size} field reads found — the matcher is not matching`);
  for (const field of seen) {
    if (JOINED.has(field)) continue;
    assert.ok(SERIALIZED.has(field),
      `the page reads o.${field}, which GET /services/offerings does not send`);
  }
});

test('the page writes no offering field the worker does not read', () => {
  // The payload the editor sends, and the per-row toggle beside it. A field a
  // handler does not name is not rejected — it is dropped — so this is the only
  // thing standing between a filled-in form and a row that lost half of it.
  const at = PAGE.indexOf('function OfferingFormModal');
  assert.ok(at > 0, 'the offering editor is gone or renamed');
  const modal = PAGE.slice(at);
  const state = modal.slice(modal.indexOf('useState({'), modal.indexOf('});'));
  const fields = [...state.matchAll(/^\s{4}([a-z_]+):/gm)].map((m) => m[1]);
  assert.ok(fields.length >= 3, `only ${fields.length} form fields found — the parser is not parsing`);
  for (const field of fields) {
    assert.ok(ACCEPTED.has(field),
      `the editor collects "${field}", which neither POST nor PUT reads — it would be typed and dropped`);
  }

  for (const m of PAGE.matchAll(/updateServiceOffering\([^,]+,\s*\{\s*([a-z_]+):/g)) {
    assert.ok(ACCEPTED.has(m[1]),
      `a write sends { ${m[1]} }, which neither handler reads — the control would be a no-op`);
  }
});

test('no price is dereferenced without a guard', () => {
  // The specific crash: `.toLocaleString()` straight off a nullable column that
  // was not even the column being sent. One helper owns it now, and it returns
  // a dash rather than a fabricated zero — an offering priced on enquiry does
  // not cost nothing.
  assert.match(PAGE, /function priceLabel\(o\)/, 'the price helper is gone');
  assert.match(PAGE, /typeof usd === 'number' && Number\.isFinite\(usd\)/,
    'priceLabel no longer proves the value is a finite number before formatting');
  assert.doesNotMatch(PAGE, /\.price\.toLocaleString\(\)/,
    'a price is dereferenced unguarded again');
  assert.doesNotMatch(PAGE, /price_usd\.toLocaleString\(\)/,
    'a nullable price is dereferenced unguarded again');
});

test('the catalog export names only columns the payload fills', () => {
  // The same mismatch, one layer out: the export declared six headings and
  // filled three, so every row wrote three empty cells under confident labels.
  const at = ROUTES.indexOf("partnerZoneActions('offers/catalog'");
  assert.ok(at > 0, 'the catalog export view is gone');
  const view = ROUTES.slice(at, ROUTES.indexOf('} })} />', at));
  const header = view.match(/header: \[([^\]]*)\]/);
  const cells = view.match(/cells: \(o\) => \[([^\]]*)\]/);
  assert.ok(header && cells, 'the export view no longer declares a header and cells');

  const headings = header[1].split(',').length;
  const values = cells[1].split(',').length;
  assert.equal(headings, values, `${headings} headings against ${values} cells`);
  for (const m of cells[1].matchAll(/\bo\.([a-z_]+)/g)) {
    assert.ok(SERIALIZED.has(m[1]),
      `the export writes o.${m[1]}, which GET /services/offerings does not send`);
  }
});
