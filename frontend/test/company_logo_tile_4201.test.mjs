/**
 * #4201 (ST2, ST2b, ST2c): the logo tile in Company settings › General.
 * Every company and file below is made up.
 *
 *   · a picked file is checked before it is held: PNG or SVG, not empty, at most 2 MB;
 *   · the tile shows the pending logo (or none, when Remove is pending), else the row's;
 *   · Replace, Remove and Undo; a member who cannot edit gets them disabled;
 *   · the logo is saved with the form's one Save, before the fields' PATCH, and counts as a change;
 *   · the preview shows what will be saved.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FIELDS, LABELS, LOGO_HINT, LOGO_MAX_BYTES, logoProblem, shownLogo, unsavedLine } from '../src/pages/account/companies/generalFormModel.js';
import { LogoTile } from '../src/pages/account/companies/CompanyGeneralForm.jsx';
import { logoSrcOf } from '../src/pages/account/companies/portfolioUi.jsx';

const h = React.createElement;
const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const file = (name, type, size) => ({ name, type, size });
const STORED = `/api/company/co-north/logo?v=${'a'.repeat(32)}.png`;
const ROW = { uid: 'co-north', company_name: 'Northwind', logo_url: STORED };

test('a picked file is checked before it is held', () => {
  assert.equal(LOGO_MAX_BYTES, 2 * 1024 * 1024, 'the issue\'s limit');
  assert.equal(logoProblem(file('n.png', 'image/png', 1000)), null);
  assert.equal(logoProblem(file('n.svg', 'image/svg+xml', LOGO_MAX_BYTES)), null, 'exactly 2 MB is kept');
  assert.equal(logoProblem(file('n.svg', '', 10)), null, 'an SVG some browsers send untyped, by its name');
  assert.match(logoProblem(file('n.png', 'image/png', LOGO_MAX_BYTES + 1)), /2 MB or smaller/);
  assert.match(logoProblem(file('n.jpg', 'image/jpeg', 10)), /PNG or SVG/);
  assert.match(logoProblem(file('n.png', 'image/png', 0)), /empty/);
  assert.match(logoProblem(null), /Choose/);
});

test('the tile shows the pending logo, none when Remove is pending, else the row\'s', () => {
  assert.equal(shownLogo(ROW, null), STORED);
  assert.equal(shownLogo(ROW, { remove: true }), null);
  assert.equal(shownLogo(ROW, { upload: {}, preview: 'blob:https://axal.vc/1' }), 'blob:https://axal.vc/1');
  assert.equal(shownLogo({ logo_url: null }, null), null);
  assert.equal(logoSrcOf('blob:https://axal.vc/1'), 'blob:https://axal.vc/1', 'a preview draws');
  assert.equal(logoSrcOf('javascript:alert(1)'), null);
  assert.deepEqual([unsavedLine({}, { remove: true }), unsavedLine({ stage: 'seed' }, { upload: {} }), unsavedLine({}, null)], ['1 unsaved change', '2 unsaved changes', null]);
});

test('the tile: Replace and Remove with the hint; Undo only while a change is held; disabled for a member who cannot edit', () => {
  const tile = (props) => renderToStaticMarkup(h(LogoTile, { name: 'Northwind', row: ROW, pending: null, onPick() {}, onRemove() {}, onUndo() {}, disabled: false, problem: null, ...props }));
  const plain = tile({});
  assert.match(plain, new RegExp(LOGO_HINT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(plain, /data-testid="company-logo-replace"[^>]*>Replace</);
  assert.match(plain, /company-logo-remove/);
  assert.doesNotMatch(plain, /company-logo-undo/);
  assert.match(plain, /data-logo="stored"/);
  const none = tile({ row: { ...ROW, logo_url: null } });
  assert.match(none, />Upload</);
  assert.doesNotMatch(none, /company-logo-remove/, 'nothing to remove');
  const removing = tile({ pending: { remove: true } });
  assert.match(removing, /removed when you save/);
  assert.match(removing, /company-logo-undo/);
  assert.doesNotMatch(removing, /data-logo=/, 'the initials while Remove is pending');
  const picked = tile({ pending: { upload: {}, preview: 'blob:https://axal.vc/1' } });
  assert.match(picked, /saved with the form/);
  assert.match(picked, /data-logo="pending"/);
  assert.match(tile({ problem: 'The logo must be 2 MB or smaller.' }), /role="alert"[^>]*>The logo must be 2 MB or smaller\./);
  const readOnly = tile({ disabled: true });
  assert.match(readOnly, /data-testid="company-logo-replace"/);
  for (const id of ['company-logo-replace', 'company-logo-remove']) assert.match(readOnly, new RegExp(`disabled=""[^>]*data-testid="${id}"`), `${id} disabled`);
  assert.match(plain, /accept="image\/png,image\/svg\+xml,\.png,\.svg"/);
});

test('the form saves the logo with its one Save, before the fields, and the preview shows it', () => {
  const src = read('pages/account/companies/CompanyGeneralForm.jsx');
  assert.match(src, /const dirty = Object\.keys\(patch\)\.length > 0 \|\| logo !== null;/, 'a held logo makes the form dirty');
  const save = src.slice(src.indexOf('const onSave'), src.indexOf('if (state.status === \'loading\')'));
  // D4961: one request commits the logo and the fields. #4963: it carries the version the form loaded.
  assert.match(save, /logoApi\.saveSettings\(uid, intent\)/, 'the logo and the fields commit in one request');
  assert.match(save, /expectedVersion: versionOf\(baseline\)/, 'the save names the version it loaded');
  assert.doesNotMatch(save, /logoApi\.upload|logoApi\.remove|api\.updateCompany/, 'no separate logo-then-fields writes');
  assert.match(src, /const why = logoProblem\(file\);\s*setLogoError\(why\);\s*if \(why\) return;/, 'a bad file is never held');
  // D4966 (#5312): the preview is built by `previewOf`, which takes the pending
  // logo and answers `logo` through the same `shownLogo`, and `PublicPreview`
  // draws it. So a picked or removed logo is still what the preview shows.
  assert.match(src, /const preview = previewOf\(row, form, logo, patch\);/, 'the preview is built from the pending logo');
  assert.match(src, /<PublicPreview preview=\{preview\} collapsible \/>/, 'and the preview card draws it');
  const fields = read('pages/account/companies/CompanyGeneralFields.jsx');
  assert.match(fields, /<CompanyMark name=\{preview\.name \|\| ''\} size=\{28\} logoUrl=\{preview\.logo\} \/>/, 'the preview shows what will be saved');
  const model = read('pages/account/companies/generalFormModel.js');
  assert.match(model, /logo: shownLogo\(row, logo\),/, 'and `previewOf` reads it through shownLogo, not a copy of the rule');
  assert.match(src, /holdLogo\(null\)/, 'Discard drops the held logo too');
  // D4966 (#5312): the save rail counts the changes, and a pending logo is still
  // one of them — `railStatus` and `unsavedLine` both read the one `changeCount`.
  assert.match(src, /railStatus\(\{ canEdit, archived, row, status: save\.status, message: save\.message, problems: showProblems \? problems : \[\], patch, logo \}\)/);
  assert.match(read('pages/account/companies/generalFormModel.js'), /export const unsavedLine = \(patch, logo = null\) => \{\n  const n = changeCount\(patch, logo\);/);
  // Still no "paste a logo URL" field: the tile is the only way in. D4966's
  // `PREVIEW_PUBLIC` names `logo_url` as one of the Worker's public fields,
  // which is a read, so the rule is checked where it lives — the form's own
  // field list and its labels.
  assert.equal(FIELDS.includes('logo_url'), false, 'still no logo URL field');
  assert.equal('logo_url' in LABELS, false, 'and no label for one');
});
