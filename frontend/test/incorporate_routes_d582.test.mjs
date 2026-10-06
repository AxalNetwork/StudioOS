/**
 * D582 (#1209; S1's answer A) — neither /build/brand nor /incorporate retires,
 * and a Lab member reaches the Lab's own Incorporate page (D360's rule).
 *
 * Pinned: both routes keep today's guards; the Lab Brand page links to
 * /build/brand for layout and media; `incorporateRoute` sends a Lab member or
 * an admin to /spinout-lab/incorporate and everyone else to /incorporate; and
 * no Lab page links to /incorporate directly.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/incorporate_routes_d582.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import { incorporateRoute } from '../src/pages/SpinoutLabStartupPage.jsx';
import { milestoneTool } from '../src/pages/SpinoutLabOfficeHoursPage.jsx';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const APP = codeOnly(read('frontend/src/App.jsx'));

test('both routes stay, with today\'s guards', () => {
  assert.match(APP, /<Route path="\/incorporate" element=\{guard\(labRoles\(\['admin', 'founder', 'partner', 'investor'\]\), <IncorporatePage \/>\)\} \/>/);
  assert.match(APP, /<Route path="\/build\/brand" element=\{guard\(labRoles\(\['admin', 'founder'\]\), founderWorkspace\('grow', <BrandBuilderPage \/>\)\)\} \/>/);
  assert.match(APP, /<Route path="\/spinout-lab\/incorporate" element=\{guard\(labRoles\(\['admin'\]\), <SpinoutLabIncorporatePage \/>\)\} \/>/);
});

test('the Lab Brand page still links to /build/brand for layout and media', () => {
  const brand = codeOnly(read('frontend/src/pages/SpinoutLabBrandPage.jsx'));
  assert.match(brand, /<Link to="\/build\/brand"[^>]*data-testid="link-full-builder">/);
});

test('incorporateRoute: a Lab member or an admin goes to the Lab page, anyone else to the wizard', () => {
  assert.equal(incorporateRoute({ role: 'founder', spinout_lab_active: 1 }), '/spinout-lab/incorporate');
  assert.equal(incorporateRoute({ role: 'admin', spinout_lab_active: 0 }), '/spinout-lab/incorporate');
  assert.equal(incorporateRoute({ role: 'founder', spinout_lab_active: 0 }), '/incorporate');
  assert.equal(incorporateRoute({ role: 'partner' }), '/incorporate');
  assert.equal(incorporateRoute(null), '/incorporate', 'before /me loads, nobody is sent to a page that would lock them out');
  assert.deepEqual(milestoneTool('incorporation_completed', { role: 'founder', spinout_lab_active: 1 }), { label: 'Incorporate', to: '/spinout-lab/incorporate' });
  assert.deepEqual(milestoneTool('okrs_created', null), { label: 'Roadmap', to: '/spinout-lab/roadmap' });
});

test('the three Lab links go through the helper', () => {
  const oh = codeOnly(read('frontend/src/pages/SpinoutLabOfficeHoursPage.jsx'));
  assert.match(oh, /tool: milestoneTool\(k, user\)/);
  assert.match(oh, /label: 'Incorporate', desc: 'form the entity', to: incorporateRoute\(user\)/);
  const st = codeOnly(read('frontend/src/pages/SpinoutLabStartupPage.jsx'));
  assert.match(st, /label: 'Legal entity', note: 'Incorporate in Week 4', to: incorporateRoute\(user\)/);
});

test('no Lab page or component links to /incorporate directly', () => {
  const files = [
    ...readdirSync(resolve(process.cwd(), 'frontend/src/pages')).filter((f) => /^SpinoutLab.*\.jsx$/.test(f)).map((f) => join('frontend/src/pages', f)),
    ...readdirSync(resolve(process.cwd(), 'frontend/src/components/spinout')).filter((f) => f.endsWith('.jsx')).map((f) => join('frontend/src/components/spinout', f)),
  ];
  assert.ok(files.length > 20, 'the Lab pages were not found');
  const offenders = [];
  for (const f of files) {
    const src = codeOnly(read(f));
    for (const line of src.split('\n')) {
      // The helper's own fallback is the one place the literal belongs.
      if (/['"`]\/incorporate['"`]/.test(line) && !/: '\/incorporate';$/.test(line.trim())) offenders.push(`${f}: ${line.trim()}`);
    }
  }
  assert.deepEqual(offenders, []);
});
