/**
 * D4362 (#4362), superseding D1419 SM11 — an admin customises the Founder,
 * Investor, Advisor or Partner Studio they switch to, saved as their own
 * layout, keyed by (admin, profile). The four homes stop passing the admin
 * preview as `readOnly`, and every tile the preview withholds stays withheld
 * (`withheld`), so arranging modules unlocks nothing. The Admin Studio (D598)
 * is unchanged. The Worker side is cloudflare-worker/test/studio_layout_admin_d4362.test.ts.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/studio_admin_customise_d4362.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deriveStudio } from '../src/pages/studio/useStudioLayout.js';

const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const READY = { profile: 'founder', source: 'default', layout: [{ key: 'company_progress', size: 'full' }], revision: null, updated_at: null, dropped: [] };
const MODULES = { profile: 'founder', groups: [], modules: [{ key: 'company_progress', title: 'Company progress', group: 'build', default_size: 'full' }] };

test('an admin is offered Customise in each of the four member Studios; a member still is; readOnly still means none', () => {
  for (const profile of ['founder', 'investor', 'advisor', 'partner']) {
    const admin = deriveStudio({ profile, viewer: { role: 'admin' }, modules: MODULES, layout: { ...READY, profile } });
    assert.equal(admin.canCustomise, true, profile);
    assert.equal(admin.readOnly, false, profile);
  }
  assert.equal(deriveStudio({ profile: 'founder', viewer: { role: 'founder' }, modules: MODULES, layout: READY }).canCustomise, true);
  assert.equal(deriveStudio({ profile: 'founder', viewer: { role: 'admin' }, readOnly: true, modules: MODULES, layout: READY }).canCustomise, false);
  assert.equal(deriveStudio({ profile: 'founder', viewer: { role: 'admin' }, modules: MODULES, layout: undefined }).canCustomise, false, 'not before the layout reads');
});

test('the four homes no longer pass the admin preview as readOnly, and the three previews keep their tiles withheld', () => {
  assert.match(read('pages/founder/FounderStudioHome.jsx'), /useStudioLayout\(\{ profile: 'founder', viewer: user \}\)/);
  for (const [file, profile] of [['investor/InvestorStudioHome.jsx', 'investor'], ['advisor/AdvisorStudioHome.jsx', 'advisor'], ['partner/PartnerStudioHome.jsx', 'partner']]) {
    const src = read(`pages/${file}`);
    assert.match(src, new RegExp(`useStudioLayout\\(\\{ profile: '${profile}', viewer: user \\}\\)`), file);
    assert.doesNotMatch(src, /readOnly: previewing/, file);
    assert.match(src, /<StudioModules studio=\{studio\} tiles=\{tiles\} withheld=\{previewing\} \/>/, `${file} keeps its tiles withheld`);
  }
  assert.doesNotMatch(read('pages/studio/useStudioLayout.js'), /!readOnly && !admin/, 'Customise no longer turns on who is looking');
});
