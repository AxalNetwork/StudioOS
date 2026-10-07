/**
 * D636 (#1394) — the Ops canvas's sp-brand (M4) and sp-watchlist (M6) screens,
 * rendered from their real components.
 *
 * What is pinned:
 *   - the site address: `axal.vc/p/[slug]` with Edit, the rule, the warning,
 *     and a reserved word and a taken address each refused with its sentence;
 *   - each page's own address with its availability verdict, savable only
 *     when available, and a failed check never read as "Available";
 *   - saved templates: "[n] of 50 · across all your projects", each from its
 *     project or stated as not recorded, and the 51st refused with the
 *     Worker's own sentence;
 *   - the watchlist item's fields with Not recorded and how it ended, and a
 *     journal entry with its outcome and the "Edited after the outcome" mark;
 *   - every screen's loading, empty and Unreadable-with-Try-again states;
 *   - where each one is wired.
 *
 * Run:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/brand_watchlist_d636.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import {
  ADDRESS_REFUSALS, ADDRESS_RULES, ADDRESS_WARNING, TEMPLATE_LIMIT, availabilityOf, checkAddress, refusalLine, templateCount,
} from '../src/lib/brandAddress.js';
import { SiteAddressCard, PageAddressRow } from '../src/components/brand/BrandAddressPanel.jsx';
import { LIMIT_LINE, SaveTemplateForm, TemplatesList } from '../src/components/brand/SavedTemplatesPanel.jsx';
import { endedLine, expectedLine, itemRows, timelineOf } from '../src/lib/watchlistItem.js';
import { ItemFields, JournalEntryCard, WatchlistItemView } from '../src/pages/WatchlistItemPage.jsx';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const text = (markup) => markup.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();
const noop = () => {};
const BRAND = read('cloudflare-worker/src/routes/brand.ts');
const ready = (data) => ({ status: 'ready', data });

// ---------------------------------------------------------------------------
// M4 — the site address
// ---------------------------------------------------------------------------

test('the address reads axal.vc/p/[slug] with Edit', () => {
  const out = text(html(h(SiteAddressCard, { site: ready({ slug: 'acme' }), editing: false, onEdit: noop })));
  assert.equal(out, 'axal.vc/p/acme Edit');
});

test('the editor states the rule and the warning, and refuses a reserved word with its sentence', () => {
  const markup = html(h(SiteAddressCard, { site: ready({ slug: 'acme' }), editing: true, draft: 'admin', onDraft: noop, onSave: noop, onCancel: noop }));
  const out = text(markup);
  assert.ok(out.includes(ADDRESS_RULES));
  assert.ok(out.includes(ADDRESS_WARNING));
  assert.equal(ADDRESS_RULES, '1 to 48 lowercase letters, digits and hyphens. Reserved words are refused.');
  assert.equal(ADDRESS_WARNING, 'Old links stop working after a change.');
  assert.match(markup, /data-testid="brand-address-check"[^>]*>That address is reserved\. Choose another\.</);
  assert.match(markup, /<button type="button" class="[^"]*" disabled="">Save address<\/button>/, 'a reserved word can still be sent');
});

test('a taken address is refused with the Worker\'s sentence', () => {
  const markup = html(h(SiteAddressCard, {
    site: ready({ slug: 'acme' }), editing: true, draft: 'beta', error: refusalLine({ message: 'That address is already taken.', code: 'address_taken' }),
    onDraft: noop, onSave: noop, onCancel: noop,
  }));
  assert.match(markup, /data-testid="brand-address-refusal"[^>]*>That address is already taken\.</);
  // A refusal that arrives without its sentence still reads as one, never as the code.
  assert.equal(refusalLine({ code: 'address_taken', message: 'address_taken' }, 'x'), 'That address is already taken.');
});

test('the client rules and sentences are the Worker\'s', () => {
  for (const [k, v] of Object.entries({ invalid: ADDRESS_REFUSALS.address_invalid, reserved: ADDRESS_REFUSALS.address_reserved, taken: ADDRESS_REFUSALS.address_taken })) {
    assert.ok(BRAND.includes(`${k}: '${v}'`), `routes/brand.ts SITE_ADDRESS_REFUSALS.${k} is not "${v}"`);
  }
  const reserved = BRAND.match(/const RESERVED_SITE_SLUGS = new Set\(\[([^\]]+)\]\)/)[1].match(/'([^']+)'/g).map((s) => s.slice(1, -1));
  for (const w of reserved) assert.equal(checkAddress(w).code, 'address_reserved', w);
  assert.deepEqual(checkAddress('  Acme-2026 '), { ok: true, slug: 'acme-2026' });
  for (const bad of ['', '-acme', 'acme-', 'a_b', 'x'.repeat(49)]) assert.equal(checkAddress(bad).code, 'address_invalid', bad);
  assert.equal(checkAddress('x'.repeat(48)).ok, true);
});

test('an unreadable address says so with Try again, never a blank address', () => {
  const markup = html(h(SiteAddressCard, { site: { status: 'unreadable' }, onRetry: noop }));
  assert.equal(text(markup), 'Unreadable The address could not be read just now. This is not a missing address. Try again');
  assert.doesNotMatch(markup, /axal\.vc\/p\//);
  assert.equal(text(html(h(SiteAddressCard, { site: { status: 'loading' } }))), 'Reading the address…');
});

test('each page\'s address carries its availability, and only an available one can be saved', () => {
  const page = { id: 5, name: 'Pricing', page_slug: 'pricing' };
  const row = (availability) => html(h(PageAddressRow, { page, siteSlug: 'acme', editing: true, draft: 'x', availability, onDraft: noop, onSave: noop, onCancel: noop }));
  assert.match(text(html(h(PageAddressRow, { page, siteSlug: 'acme', editing: false, onEdit: noop }))), /^Pricing axal\.vc\/p\/acme\/pricing Change address$/);
  const taken = row(ready({ available: false, reason: 'taken', message: 'You already have a page at that URL.' }));
  assert.match(taken, /data-testid="brand-page-availability"[^>]*>Taken</);
  assert.match(taken, /You already have a page at that URL\./);
  assert.match(taken, /disabled="">Save address</);
  const free = row(ready({ available: true, slug: 'plans' }));
  assert.match(free, /data-testid="brand-page-availability"[^>]*>Available</);
  assert.doesNotMatch(free, /disabled="">Save address</);
  const failed = row({ status: 'unreadable' });
  assert.match(failed, /data-testid="brand-page-availability"[^>]*>Not checked</);
  assert.match(failed, /disabled="">Save address</, 'an unchecked address could be saved');
  assert.equal(availabilityOf(ready({ available: false, reason: 'reserved', message: 'm' })).label, 'Reserved');
  assert.match(text(html(h(PageAddressRow, { page: { id: 6, name: 'Draft', page_slug: null }, siteSlug: 'acme', editing: false, onEdit: noop }))),
    /Not recorded \. Address: this page has no address of its own yet\./);
});

// ---------------------------------------------------------------------------
// M4 — saved templates
// ---------------------------------------------------------------------------

const tpl = (i, project = { id: 1, name: 'Acme' }) => ({ id: i, name: `Template ${i}`, created_at: '2026-10-07 09:00:00', project });

test('saved templates show "[n] of 50" and where each came from', () => {
  assert.deepEqual(templateCount([tpl(1), tpl(2)]), { line: '2 of 50', full: false });
  const out = text(html(h(TemplatesList, { read: ready({ templates: [tpl(1), tpl(2, null)] }), onUse: noop, onAskDelete: noop })));
  assert.match(out, /Template 1 from Acme · 2026-10-07 Use for a new page Delete/);
  assert.match(out, /Template 2 Project not recorded: saved before templates kept their project · 2026-10-07/);
});

test('the 51st template is refused with the Worker\'s own sentence', () => {
  assert.equal(TEMPLATE_LIMIT, 50);
  assert.match(BRAND, /const MAX_CUSTOM_TEMPLATES = 50;/);
  assert.equal(templateCount(Array.from({ length: 50 }, (_, i) => tpl(i))).full, true);
  assert.equal(templateCount(Array.from({ length: 49 }, (_, i) => tpl(i))).full, false);
  // The Worker's sentence, with its constant filled in, is the one the form shows.
  assert.ok(BRAND.includes('message: `You have ${MAX_CUSTOM_TEMPLATES} saved templates, the most allowed across all your projects. Delete one before saving another.`'));
  assert.equal(LIMIT_LINE, 'You have 50 saved templates, the most allowed across all your projects. Delete one before saving another.');
  const pages = [{ id: 1, name: 'Home' }];
  const full = html(h(SaveTemplateForm, { pages, full: true, onSave: noop }));
  assert.match(full, /data-testid="brand-template-limit"[^>]*>You have 50 saved templates/);
  assert.match(full, /disabled="">Save as template</);
  const refused = html(h(SaveTemplateForm, { pages, full: false, error: LIMIT_LINE, onSave: noop }));
  assert.match(refused, /data-testid="brand-template-refusal"[^>]*>You have 50 saved templates/);
  assert.doesNotMatch(html(h(SaveTemplateForm, { pages, full: false, onSave: noop })), /brand-template-limit/);
});

test('the templates list draws loading, empty and Unreadable with Try again', () => {
  assert.equal(text(html(h(TemplatesList, { read: { status: 'loading' } }))), 'Reading your templates…');
  assert.equal(text(html(h(TemplatesList, { read: ready({ templates: [] }) }))), 'No saved templates yet. Save any page as one.');
  const bad = html(h(TemplatesList, { read: { status: 'unreadable' }, onRetry: noop }));
  assert.equal(text(bad), 'Unreadable Your saved templates could not be read just now. This is not an empty list. Try again');
  assert.doesNotMatch(bad, /No saved templates yet/);
});

// ---------------------------------------------------------------------------
// M6 — the watchlist item and its journal entries
// ---------------------------------------------------------------------------

const ITEM = {
  uid: 'w-1', external_name: 'Northwind', sector: 'Fintech', stage: 'Seed', created_at: '2026-08-01T00:00:00Z',
  thesis: 'Payments rails for SMEs', conviction: 'high', source: 'Intro from a founder', tags: ['b2b', 'payments'],
  status: 'passed_on', passed_reason: 'Too early', passed_at: '2026-09-01T10:00:00Z', next_check_at: null,
};

test('the item shows its fields in order, Not recorded where absent, and how it ended', () => {
  assert.deepEqual(itemRows(ITEM).map((r) => r.k), ['Thesis', 'Conviction', 'Source', 'Tags', 'Status', 'Next check', 'Ended']);
  const out = text(html(h(ItemFields, { item: ITEM })));
  assert.match(out, /Conviction High/);
  assert.match(out, /Tags b2b · payments/);
  assert.match(out, /Next check Not recorded \. Next check: no date set\./);
  assert.match(out, /Ended Passed · Too early · 1 Sept 2026|Ended Passed · Too early · 1 Sep 2026/);
  assert.equal(endedLine({ status: 'passed_on', passed_reason: null }), 'Passed · no reason recorded');
  assert.match(endedLine({ status: 'converted', converted_deal_id: 7, converted_at: '2026-09-02T00:00:00Z' }), /^Converted to a deal · 2 Sept? 2026$/);
  assert.equal(endedLine({ status: 'converted', converted_deal_id: null }), 'Converted to a deal · the deal is not recorded');
  assert.equal(endedLine({ status: 'watching' }), null);
  assert.doesNotMatch(text(html(h(ItemFields, { item: { ...ITEM, status: 'watching' } }))), /Ended/);
});

const ENTRY = {
  uid: 'j-1', decision: 'defer', conviction: 3, thesis: 'The round is led by a fund we know.', key_risks: 'Regulation',
  expected_outcome: 'Series A', expected_multiple: 3, expected_timeline_months: 60,
  outcome_status: 'partial', outcome_notes: 'Raised, smaller', outcome_actual_multiple: 1.4, edited_after_outcome_at: '2026-09-20T00:00:00Z',
};

test('a journal entry shows the decision and what was expected, then the outcome, marked when edited after it', () => {
  assert.equal(expectedLine(ENTRY), 'Series A · 3× · 5 years');
  assert.equal(timelineOf(18), '18 months');
  const markup = html(h(JournalEntryCard, { entry: ENTRY }));
  const out = text(markup);
  assert.match(out, /^Defer Conviction 3 \/ 5 Edited after the outcome Thesis The round is led by a fund we know\. Risks Regulation Expected Series A · 3× · 5 years Outcome Partial Actual 1\.4× Raised, smaller$/);
  assert.match(markup, /data-testid="journal-edited-after-outcome"[^>]*>Edited after the outcome</);
  // No mark without D618's record.
  assert.doesNotMatch(html(h(JournalEntryCard, { entry: { ...ENTRY, edited_after_outcome_at: null } })), /Edited after the outcome/);
  const pending = text(html(h(JournalEntryCard, { entry: { ...ENTRY, outcome_status: 'pending', edited_after_outcome_at: null, key_risks: null, expected_outcome: null, expected_multiple: null, expected_timeline_months: null }, onRecordOutcome: noop })));
  assert.match(pending, /Risks Not recorded \. No risks were written\./);
  assert.match(pending, /Outcome: not recorded yet\. Record outcome$/);
});

test('the item page draws loading, empty and Unreadable with Try again for each read, never an empty list on failure', () => {
  const view = (item, entries) => html(h(WatchlistItemView, { item, entries, onRetryItem: noop, onRetryEntries: noop, onWrite: noop }));
  const okItem = ready(ITEM);
  const empty = text(view(okItem, ready([])));
  assert.match(empty, /Northwind Fintech · Seed · on the watchlist since 1 Aug 2026/);
  assert.match(empty, /No journal entry for this company yet\. Write an entry$/);
  const badEntries = view(okItem, { status: 'unreadable' });
  assert.match(badEntries, /data-testid="watchlist-journal-unreadable"/);
  assert.match(text(badEntries), /Unreadable The journal entries for this company could not be read just now\. Try again/);
  assert.doesNotMatch(badEntries, /No journal entry for this company yet/);
  const badItem = view({ status: 'unreadable' }, ready([ENTRY]));
  assert.match(text(badItem), /Unreadable This item could not be read just now\. Try again/);
  assert.match(text(view({ status: 'loading' }, { status: 'loading' })), /Reading this item… Journal Reading the journal…/);
  assert.match(text(view(okItem, ready([ENTRY]))), /Journal Write an entry Defer Conviction 3 \/ 5/);
});

// ---------------------------------------------------------------------------
// Where they are wired
// ---------------------------------------------------------------------------

test('the screens are wired where the canvas places them', () => {
  const app = read('frontend/src/App.jsx');
  assert.match(app, /<Route path="\/watchlist\/:uid" element=\{guard\(\['admin', 'partner', 'investor'\], <WatchlistItemPage \/>\)\} \/>/);
  assert.match(read('frontend/src/pages/WatchlistJournalPage.jsx'), /<Link to=\{`\/watchlist\/\$\{encodeURIComponent\(it\.uid\)\}`\}/);
  const brandPage = read('frontend/src/pages/SpinoutLabBrandPage.jsx');
  assert.match(brandPage, /<BrandAddressPanel projectId=\{projectId\} pages=\{pages\} onPagesChanged=\{refreshPages\} \/>/);
  assert.match(brandPage, /<SavedTemplatesPanel projectId=\{projectId\} pages=\{pages\} onPagesChanged=\{refreshPages\} \/>/);
  const api = read('frontend/src/lib/api.js');
  assert.match(api, /brandSetPageAddress: \(pageId, pageSlug\) => request\(`\/brand\/landing\/pages\/\$\{pageId\}\/address`/);
  assert.match(api, /'project_uid', 'watchlist_uid', 'owner'/);
  assert.match(read('documentation/architecture/ROUTE_MAP.md'), /^\| Deal Flow \|.*\*\*UPDATE \(D636, #1394, Ops canvas M6 `sp-watchlist`, lit under Deals\):\*\* `\/watchlist\/:uid` → `pages\/WatchlistItemPage\.jsx`/m);
});
