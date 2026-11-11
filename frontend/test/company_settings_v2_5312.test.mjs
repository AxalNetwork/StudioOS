/**
 * D4966 (#5312) — Company settings › General v2: the four intent groups, the
 * public-only preview, the twelve-state save rail, the problem summary, the
 * currency combobox and the URL fields.
 *
 * What is pinned:
 *   - the four groups hold every field exactly once, each with the canvas's line;
 *   - the preview draws the Worker's PUBLIC fields only, and says when what it
 *     draws includes unsaved changes; the private four and the currency never
 *     reach it;
 *   - `railStatus` answers one of twelve states, in the canvas's order, with how
 *     each is announced; a clean form names when it was last saved, and an
 *     unreadable stamp is left out rather than guessed;
 *   - `fieldProblems` names every bad field and `problemOf` is its first, so the
 *     summary and the save bar cannot disagree;
 *   - the currency combobox searches by code and by name, always offers "Not
 *     recorded" and the stored code, and guesses no default;
 *   - a URL field offers Open only for an address that would be stored, and says
 *     what will be stored when it differs from what was typed.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/company_settings_v2_5312.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { h, mountForm } from './_form_d695.mjs';
import { CurrencyCombobox, ProblemSummary, PublicPreview, UrlField } from '../src/pages/account/companies/CompanyGeneralFields.jsx';
import {
  CURRENCY_CODES, CURRENCY_NONE, FIELDS, FIELD_HELP, FIELD_HINT, LABELS, PREVIEW_NEVER, PREVIEW_PUBLIC, PREVIEW_UNSAVED,
  SECTIONS, changeCount, currencyLabel, currencyMatches, currencyName, descriptionCount, fieldProblems, normalisedHint,
  openableUrl, previewOf, problemOf, railStatus, savedAtText, stageLabel,
} from '../src/pages/account/companies/generalFormModel.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const ROW = {
  uid: 'co-1', company_name: 'Tidepool Labs', stage: 'seed', description: 'Coastal water sensors for aquaculture.',
  website: 'https://tidepool.example', linkedin_url: 'https://www.linkedin.com/company/tidepool', logo_url: null,
  international_presence: 'europe, uk_ireland', region_codes: ['europe', 'uk_ireland'],
  revenue_range: '100k_1m', employee_count: 12, current_products: 'Buoy', expansion_goals: 'Canada',
  default_currency: 'EUR', profile_version: 3, updated_at: '2026-11-07 18:42:00',
};
async function press(ui, testid) {
  const node = ui.by(testid);
  assert.ok(node, testid);
  await act(async () => ui.props(node).onClick?.({ preventDefault() {}, stopPropagation() {} }));
}
async function fire(ui, testid, handler, event) {
  const node = ui.by(testid);
  assert.ok(node, testid);
  await act(async () => ui.props(node)[handler]?.(event));
}

test('the four intent groups hold every field exactly once, each with the line that says what it affects', () => {
  assert.deepEqual(SECTIONS.map((s) => s.key), ['identity', 'presence', 'matching', 'snapshot']);
  assert.deepEqual(SECTIONS.map((s) => s.title), ['Company identity', 'Public presence', 'Matching profile', 'Business snapshot']);
  for (const sec of SECTIONS) {
    assert.ok(sec.line && sec.line.length > 30, `${sec.key} says what it affects`);
    assert.ok(sec.fields.length > 0);
  }
  // Every field is in exactly one group, and the whole contract is still the whole contract.
  const flat = SECTIONS.flatMap((s) => s.fields);
  assert.equal(new Set(flat).size, flat.length, 'no field is in two groups');
  assert.deepEqual([...flat].sort(), [...FIELDS].sort());
  for (const f of flat) assert.ok(LABELS[f], `${f} has a label`);
  // A hint or a help line exists only where the canvas gives one; none is invented.
  for (const key of Object.keys(FIELD_HINT)) assert.ok(flat.includes(key), key);
  for (const key of Object.keys(FIELD_HELP)) assert.ok(flat.includes(key), key);
  // The canvas puts revenue with matching, not with the private snapshot.
  assert.ok(SECTIONS.find((s) => s.key === 'matching').fields.includes('revenue_range'));
});

test('the preview draws the public fields only; the private four and the currency never reach it', () => {
  const p = previewOf(ROW, null, null, {});
  assert.deepEqual(Object.keys(p).sort(), ['description', 'linkedin', 'logo', 'name', 'regions', 'stage', 'unsaved', 'website']);
  assert.equal(p.name, 'Tidepool Labs');
  assert.equal(p.stage, 'Seed');
  // The regions come back in the vocabulary's own order, not the stored order.
  assert.deepEqual(p.regions, ['UK and Ireland', 'Europe']);
  assert.equal(p.website, 'https://tidepool.example');
  assert.equal(p.unsaved, false);
  // Nothing private is in the preview, by value or by key.
  const json = JSON.stringify(p);
  for (const f of PREVIEW_NEVER) {
    assert.doesNotMatch(json, new RegExp(f), `${f} is not in the preview`);
    assert.equal(PREVIEW_PUBLIC.includes(f), false, `${f} is not a public field`);
  }
  assert.doesNotMatch(json, /100k_1m|Buoy|Canada|EUR/, 'no private value reaches it');
  // An edit to a public field marks the preview; one to a private field does not.
  assert.equal(previewOf(ROW, { ...ROW, description: 'New' }, null, { description: 'New' }).unsaved, true);
  assert.equal(previewOf(ROW, ROW, null, { revenue_range: '1m_5m' }).unsaved, false, 'a private edit is not shown, so it is not marked');
  assert.equal(previewOf(ROW, ROW, { upload: {} }, {}).unsaved, true, 'a pending logo is a change the preview draws');
  // A company with nothing recorded says so, rather than showing a placeholder.
  const bare = previewOf({ uid: 'co-2' }, null, null, {});
  assert.deepEqual([bare.name, bare.stage, bare.description, bare.website, bare.linkedin, bare.logo], [null, null, null, null, null, null]);
  assert.equal(stageLabel(''), null, 'no stage is not "Not set" in a preview');
  assert.equal(stageLabel('seed'), 'Seed');
  assert.deepEqual(bare.regions, []);
});

test('the preview card marks unsaved changes, names the private fields it leaves out, and never shows a 0', async () => {
  const dirty = renderToStaticMarkup(h(PublicPreview, { preview: previewOf(ROW, { ...ROW, description: 'New words' }, null, { description: 'New words' }) }));
  assert.match(dirty, new RegExp(PREVIEW_UNSAVED));
  assert.match(dirty, /New words/);
  const clean = renderToStaticMarkup(h(PublicPreview, { preview: previewOf(ROW, null, null, {}) }));
  assert.doesNotMatch(clean, new RegExp(PREVIEW_UNSAVED), 'a saved company is not marked');
  assert.match(clean, /stay private to your company/);
  assert.doesNotMatch(clean, /100k_1m|Buoy/);
  const bare = await mountForm(h(PublicPreview, { preview: previewOf({ uid: 'co-2' }, null, null, {}) }));
  try {
    assert.ok(bare.by('company-general-preview-no-description'), 'no description is said, not left blank');
    assert.match(bare.text(), /Stage and regions are not recorded/);
    assert.doesNotMatch(bare.text(), /\b0\b/, 'nothing recorded is never a 0');
  } finally { await bare.unmount(); }
  // CS-13 A: on a phone the preview collapses, and says which way it is.
  const collapsible = await mountForm(h(PublicPreview, { preview: previewOf(ROW, null, null, {}), collapsible: true }));
  try {
    assert.equal(collapsible.props(collapsible.by('company-general-preview-toggle')).children, 'Hide preview');
    await press(collapsible, 'company-general-preview-toggle');
    assert.equal(collapsible.props(collapsible.by('company-general-preview-toggle')).children, 'Show preview');
    // Collapsed, the body is hidden from the page and from a screen reader
    // (`display: none`), and comes back at `lg`, where the preview is the
    // canvas's sticky rail and the toggle is not drawn at all.
    const wrap = collapsible.by('company-general-preview-body');
    assert.ok(wrap, 'the body is still addressable');
    assert.equal(collapsible.props(wrap).className, 'hidden lg:block');
    assert.equal(collapsible.props(collapsible.by('company-general-preview-toggle')).className.includes('lg:hidden'), true, 'and the toggle is a phone control');
  } finally { await collapsible.unmount(); }
});

test('the save rail answers one of twelve states, in the canvas\'s order, with how each is announced', () => {
  const state = (o) => railStatus({ row: ROW, ...o });
  assert.deepEqual(state({ archived: true }), { state: 'archived', line: 'Archived · restore to edit', announce: 'none' });
  assert.equal(state({ canEdit: false, row: { ...ROW, viewer: { read_only_reason: 'support_session' } } }).state, 'read_only');
  assert.match(state({ canEdit: false, row: { ...ROW, viewer: { read_only_reason: 'support_session' } } }).line, /^Read-only · /);
  assert.deepEqual(state({ status: 'conflict', message: 'Someone else saved first.' }), { state: 'conflict', line: 'Someone else saved first.', announce: 'assertive' });
  assert.equal(state({ status: 'unknown' }).state, 'unknown');
  assert.equal(state({ status: 'unknown' }).announce, 'polite');
  assert.equal(state({ status: 'partly', message: 'Logo saved; 2 left.' }).announce, 'assertive');
  assert.equal(state({ status: 'error', message: 'Save failed · down' }).state, 'failed');
  assert.deepEqual(state({ status: 'saving' }), { state: 'saving', line: 'Saving…', announce: 'polite' });
  assert.equal(state({ status: 'reconciling' }).state, 'checking');
  assert.equal(state({ status: 'saved', message: 'Saved · just now' }).state, 'saved');
  assert.deepEqual(state({ problems: [{ field: 'website' }, { field: 'description' }] }), { state: 'invalid', line: 'Fix 2 fields', announce: 'assertive' });
  assert.equal(state({ problems: [{ field: 'website' }] }).line, 'Fix 1 field');
  assert.equal(state({ patch: { description: 'x' } }).line, 'Unsaved changes · 1 field');
  assert.equal(state({ patch: { description: 'x' }, logo: { remove: true } }).line, 'Unsaved changes · 2 fields', 'a pending logo is a change');
  assert.deepEqual(state({}), { state: 'clean', line: 'All changes saved · last saved 7 Nov, 18:42', announce: 'none' });
  // Order: what the server last said wins over what the form is doing, and a problem never hides a failure.
  assert.equal(state({ status: 'error', problems: [{ field: 'website' }], patch: { website: 'x' } }).state, 'failed');
  assert.equal(state({ status: 'saved', problems: [{ field: 'website' }] }).state, 'invalid', 'a problem outranks a stale "saved"');
  assert.equal(state({ canEdit: false, archived: true }).state, 'archived', 'an archived company is archived, not merely read-only');
  // An unreadable or missing stamp is left out, never guessed.
  assert.equal(savedAtText({ updated_at: 'not a date' }), null);
  assert.equal(savedAtText({}), null);
  assert.equal(railStatus({ row: { uid: 'co-2' } }).line, 'All changes saved', 'no stamp, no claim about when');
  assert.equal(changeCount({ a: 1 }, null), 1);
  assert.equal(changeCount({}, { upload: {} }), 1);
});

test('fieldProblems names every bad field, one problem each, and problemOf is its first', () => {
  const form = { ...ROW, region_codes: ROW.region_codes, employee_count: '12' };
  assert.deepEqual(fieldProblems(form, ROW), []);
  const bad = { ...form, company_name: '  ', employee_count: 'twelve', website: 'northwind', linkedin_url: 'https://example.com/x' };
  const problems = fieldProblems(bad, ROW);
  assert.deepEqual(problems.map((p) => p.field), ['company_name', 'employee_count', 'website', 'linkedin_url']);
  assert.equal(new Set(problems.map((p) => p.field)).size, problems.length, 'one problem per field');
  for (const p of problems) assert.ok(p.message.length > 10, p.field);
  // The save bar and the summary read the same function, so they cannot disagree.
  assert.equal(problemOf(bad, ROW), problems[0].message);
  assert.equal(problemOf(form, ROW), null);
  // A legacy value the editor did not touch is not a problem.
  assert.deepEqual(fieldProblems(formWith(ROW, {}), { ...ROW, website: 'northwind' }), []);
  // One field can break two rules at once — too long AND holding a character
  // that cannot be saved. It still gets ONE problem, the first, so the summary
  // never lists the same field twice.
  const twice = fieldProblems({ ...form, description: `${'x'.repeat(300)}\u0000` }, ROW);
  assert.deepEqual(twice.map((pr) => pr.field), ['description']);
  assert.match(twice[0].message, /at most 280 characters/, 'the first rule it breaks is what it says');
});
function formWith(row, over) { return { ...row, employee_count: String(row.employee_count ?? ''), ...over }; }

test('the problem summary links to every bad field and is announced once', async () => {
  const problems = fieldProblems({ ...ROW, company_name: '', website: 'northwind', employee_count: '12' }, ROW);
  const ui = await mountForm(h(ProblemSummary, { problems }));
  try {
    assert.match(ui.text(), /Fix 2 fields before saving\./);
    for (const p of problems) {
      const link = ui.by(`general-problem-link-${p.field}`);
      assert.ok(link, p.field);
      assert.equal(ui.props(link).href, `#general-${p.field}`);
      assert.match(ui.text(), new RegExp(LABELS[p.field]));
    }
    const box = ui.by('general-problem-summary');
    assert.deepEqual([ui.props(box).role, ui.props(box)['aria-live']], ['alert', 'assertive']);
  } finally { await ui.unmount(); }
  assert.equal(renderToStaticMarkup(h(ProblemSummary, { problems: [] })), '', 'no problems, no summary');
});

test('the currency combobox searches by code and by name, always offers Not recorded, and guesses no default', async () => {
  // The search itself.
  assert.deepEqual(currencyMatches('eur'), ['EUR'].concat(currencyMatches('eur').slice(1)));
  assert.ok(currencyMatches('eur').includes('EUR'));
  assert.ok(currencyMatches('dollar').includes('AUD'), 'by name, not only by code');
  assert.ok(currencyMatches('').includes('USD') && currencyMatches('').includes('GBP'), 'the common list when nothing is typed');
  assert.deepEqual(currencyMatches('zzzzz'), [], 'no match is no match, not a guess');
  assert.equal(currencyMatches('', { stored: 'XCG' })[0], 'XCG', 'the stored code is always first');
  assert.ok(currencyMatches('', { stored: 'ZZZ' }).includes('ZZZ'), 'even one off the list is kept, never dropped');
  assert.equal(currencyName('USD'), 'US Dollar');
  assert.equal(currencyLabel('USD'), 'USD · US Dollar');
  assert.equal(currencyName('ZZZ'), '', 'a code the runtime cannot name gets no invented name');
  assert.equal(currencyLabel('ZZZ'), 'ZZZ');

  const picked = [];
  const ui = await mountForm(h(CurrencyCombobox, { value: '', stored: '', onChange: (v) => picked.push(v) }));
  try {
    const input = ui.by('general-default-currency');
    assert.equal(ui.props(input).role, 'combobox');
    assert.equal(ui.props(input).value, CURRENCY_NONE, 'an unrecorded currency reads as Not recorded');
    assert.equal(ui.props(input)['aria-expanded'], false);
    assert.equal(ui.by('general-default-currency-list'), undefined, 'closed until it is opened');
    await fire(ui, 'general-default-currency', 'onFocus', {});
    assert.equal(ui.props(ui.by('general-default-currency'))['aria-expanded'], true);
    assert.ok(ui.by('general-default-currency-none'), 'Not recorded is always an option');
    assert.ok(ui.by('general-default-currency-USD'));
    await fire(ui, 'general-default-currency', 'onChange', { target: { value: 'pound' } });
    assert.ok(ui.by('general-default-currency-GBP'), 'searched by name');
    assert.equal(ui.by('general-default-currency-USD'), undefined, 'and only the matches are listed');
    await fire(ui, 'general-default-currency-GBP', 'onMouseDown', { preventDefault() {} });
    assert.deepEqual(picked, ['GBP']);
    assert.equal(ui.by('general-default-currency-list'), undefined, 'picking closes it');
  } finally { await ui.unmount(); }

  // The keyboard: Down opens and moves, Enter picks, Escape closes without picking.
  const keyed = [];
  const kb = await mountForm(h(CurrencyCombobox, { value: 'EUR', stored: 'EUR', onChange: (v) => keyed.push(v) }));
  try {
    assert.equal(kb.props(kb.by('general-default-currency')).value, 'EUR · Euro');
    await fire(kb, 'general-default-currency', 'onKeyDown', { key: 'ArrowDown', preventDefault() {} });
    await fire(kb, 'general-default-currency', 'onKeyDown', { key: 'Enter', preventDefault() {} });
    assert.deepEqual(keyed, ['EUR'], 'the first move lands on the stored code');
    await fire(kb, 'general-default-currency', 'onKeyDown', { key: 'ArrowDown', preventDefault() {} });
    await fire(kb, 'general-default-currency', 'onKeyDown', { key: 'Escape', preventDefault() {} });
    assert.deepEqual(keyed, ['EUR'], 'Escape picks nothing');
    assert.equal(kb.by('general-default-currency-list'), undefined);
  } finally { await kb.unmount(); }
  // The list the combobox searches is the Worker's own list, unchanged.
  assert.ok(CURRENCY_CODES.includes('USD') && CURRENCY_CODES.length > 150);
});

test('a URL field offers Open only for an address that would be stored, and says what will be stored', async () => {
  assert.equal(openableUrl('website', 'tidepool.example'), 'https://tidepool.example');
  assert.equal(openableUrl('website', 'not a url'), null);
  assert.equal(openableUrl('linkedin_url', 'https://example.com/x'), null, 'not a LinkedIn page');
  assert.equal(openableUrl('linkedin_url', 'linkedin.com/company/tidepool'), 'https://www.linkedin.com/company/tidepool');
  assert.equal(normalisedHint('website', 'tidepool.example'), 'Will be saved as https://tidepool.example');
  assert.equal(normalisedHint('website', 'https://tidepool.example'), null, 'nothing to say when it is already stored form');
  assert.equal(normalisedHint('website', 'not a url'), null);

  const typed = [];
  const ui = await mountForm(h(UrlField, { field: 'website', value: 'tidepool.example', onChange: (v) => typed.push(v) }));
  try {
    assert.equal(ui.props(ui.by('general-website-open')).href, 'https://tidepool.example');
    assert.match(ui.text(), /Will be saved as https:\/\/tidepool\.example/);
  } finally { await ui.unmount(); }
  const bad = await mountForm(h(UrlField, { field: 'website', value: 'not a url', onChange: () => {}, error: 'Enter a web address that starts with http:// or https://.' }));
  try {
    assert.equal(bad.by('general-website-open'), undefined, 'nothing to open');
    assert.ok(bad.by('general-website-error'), 'the error sits beside its own field');
    assert.match(bad.text(), /starts with http:\/\//);
  } finally { await bad.unmount(); }
  // CS-15: the error is addressed by `aria-describedby` and the field is `aria-invalid`.
  const markup = renderToStaticMarkup(h(UrlField, { field: 'website', value: 'not a url', onChange: () => {}, error: 'Bad address.' }));
  assert.match(markup, /aria-invalid="true"/);
  assert.match(markup, /aria-describedby="[^"]*general-website-error/);
  assert.match(markup, /id="general-website-error"/);
  assert.doesNotMatch(renderToStaticMarkup(h(UrlField, { field: 'website', value: 'https://ok.example', onChange: () => {} })), /aria-invalid/, 'a good address is not marked invalid');
  const linked = await mountForm(h(UrlField, { field: 'linkedin_url', value: '', onChange: () => {} }));
  try {
    assert.ok(linked.by('general-linkedin-hint'), 'LinkedIn says which pages it takes');
  } finally { await linked.unmount(); }
});

test('the description count marks near and over the limit, and never counts a field nobody typed in', () => {
  assert.deepEqual(descriptionCount(''), { text: '0 / 280', near: false, over: false });
  assert.deepEqual(descriptionCount('x'.repeat(239)), { text: '239 / 280', near: false, over: false });
  assert.deepEqual(descriptionCount('x'.repeat(240)), { text: '240 / 280', near: true, over: false });
  assert.deepEqual(descriptionCount('x'.repeat(280)), { text: '280 / 280', near: true, over: false });
  assert.deepEqual(descriptionCount('x'.repeat(281)), { text: '281 / 280', near: false, over: true });
});

test('the form wires every v2 part, and no client method without a mounted Worker route', () => {
  const form = read('frontend/src/pages/account/companies/CompanyGeneralForm.jsx');
  assert.match(form, /<ProblemSummary problems=\{problems\} \/>/);
  assert.match(form, /<PublicPreview preview=\{preview\} collapsible \/>/);
  assert.match(form, /const rail = railStatus\(/);
  assert.match(form, /data-rail-state=\{rail\.state\}/);
  assert.match(form, /dirty=\{f in patch\}/, 'a changed field is marked from the patch, never from a copy');
  assert.match(form, /data-testid="company-general-group-picker"/, 'the phone\'s section selector');
  // The save machinery is #4960 to #4964's and is not rebuilt here.
  assert.match(form, /logoApi\.saveSettings\(uid, intent\)/);
  assert.match(form, /expectedVersion: versionOf\(baseline\)/);
  assert.match(form, /useLeaveGuard\(dirty, LEAVE_PROMPT\)/);
  assert.doesNotMatch(form, /\bfetch\(/, 'the form makes no request of its own');
  // No new client method at all: v2 is frontend only (D4966 "Frontend only"). The
  // form's only client is the one #4961 gave it; the field components have none.
  assert.deepEqual(form.match(/from '\.\.\/\.\.\/\.\.\/lib\/api[^']*'/g), ["from '../../../lib/api/companyLogo'"]);
  const fields = read('frontend/src/pages/account/companies/CompanyGeneralFields.jsx');
  assert.equal(fields.match(/lib\/api/g), null, 'the field components name no client');
  assert.doesNotMatch(fields, /useCompanyDetail|companyLogoApi|\bfetch\(/, 'the field components read nothing');
  // Every dark pair: the canvas has a dark board, and `check-dark-mode` runs over the tree.
  for (const cls of ['dark:border-gray-700', 'dark:bg-gray-950']) assert.ok(fields.includes(cls), cls);
});
