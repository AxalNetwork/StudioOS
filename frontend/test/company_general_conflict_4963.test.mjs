/**
 * D4963 (#4963) — Company settings › General reconciles a stale save instead of overwriting.
 *
 * What is pinned:
 *   - `rebaseOnConflict` rebuilds the form on the current company: every value the other editor committed is kept;
 *     this editor's edits to fields nobody else changed are re-applied; an edit to a field the other editor also
 *     changed is replaced by their committed value and named;
 *   - the form sends the version it loaded with its one Save, and on a 409 `version_conflict` rebuilds from the
 *     conflict's company rather than erasing it;
 *   - an archived company is drawn read-only.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/company_general_conflict_4963.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  VERSION_CONFLICT, archivedLine, changes, conflictLine, formOf, rebaseOnConflict, versionOf,
} from '../src/pages/account/companies/generalFormModel.js';

const read = (p) => readFileSync(resolve(process.cwd(), 'frontend/src', p), 'utf8');
const LOADED = { company_name: 'Northwind', description: 'Old', website: 'https://old.example.test', stage: 'seed', employee_count: 4, profile_version: 4 };

test('their committed values are kept; my other edits are re-applied; a clash is replaced by theirs and named', () => {
  const mine = { ...formOf(LOADED), description: 'Mine', website: 'https://mine.example.test', employee_count: '6' };
  const current = { ...LOADED, description: 'Theirs', stage: 'series_a', profile_version: 5 };
  const { form, conflicts } = rebaseOnConflict(mine, LOADED, current);
  assert.equal(form.stage, 'series_a', 'a field only they changed keeps their value');
  assert.equal(form.description, 'Theirs', 'a field both changed keeps their committed value');
  assert.equal(form.website, 'https://mine.example.test', 'a field only I changed keeps my edit');
  assert.equal(form.employee_count, '6');
  assert.deepEqual(conflicts, ['description']);
  // What is left to save is exactly my non-clashing edits, against their row.
  assert.deepEqual(changes(form, current), { website: 'https://mine.example.test', employee_count: 6 });
});

test('the same edit on both sides is not a clash; nothing of mine is lost when they changed other fields', () => {
  const mine = { ...formOf(LOADED), description: 'Same' };
  const current = { ...LOADED, description: 'Same', website: null, profile_version: 5 };
  const { form, conflicts } = rebaseOnConflict(mine, LOADED, current);
  assert.deepEqual(conflicts, []);
  assert.equal(form.website, '', 'their clearing is kept');
  assert.deepEqual(changes(form, current), {});
});

test('the conflict line names the replaced fields in words, and says the rest is kept', () => {
  assert.match(conflictLine(['description', 'website']), /Your edits to Description, Website were replaced by their saved value; your other changes are kept\./);
  assert.match(conflictLine(['description']), /Your edit to Description was replaced/);
  assert.match(conflictLine([]), /Their values are shown and your other changes are kept/);
  assert.match(archivedLine('Northwind'), /^Northwind is archived\. Restore it before you change its settings\.$/);
});

test('versionOf: the loaded version, or undefined for a row without one', () => {
  assert.equal(versionOf({ profile_version: 7 }), 7);
  for (const bad of [null, {}, { profile_version: 0 }, { profile_version: '3' }, { profile_version: 1.5 }]) assert.equal(versionOf(bad), undefined);
  assert.equal(VERSION_CONFLICT, 'version_conflict');
});

test('the form sends its version with each save and rebuilds from the conflict instead of erasing it', () => {
  const src = read('pages/account/companies/CompanyGeneralForm.jsx');
  const save = src.slice(src.indexOf('const onSave'), src.indexOf("if (state.status === 'loading')"));
  assert.match(save, /logoApi\.saveSettings\(uid, intent\)/, 'one save commits the fields and the logo');
  assert.match(save, /expectedVersion: versionOf\(baseline\)/, 'that save names the version the form loaded');
  assert.match(save, /e\?\.code === VERSION_CONFLICT \? e\?\.data\?\.company : null/);
  assert.match(save, /rebaseOnConflict\(form, row, current\)/);
  assert.match(save, /setState\(\{ status: 'ready', row: current \}\)/, 'the current company becomes the row the next save is against');
  assert.match(src, /&& !archived/, 'an archived company is read-only');
  assert.match(src, /archivedLine\(/);
  const logo = read('lib/api/companyLogo.js');
  assert.match(logo, /\?expected_version=\$\{v\}/);
});
