/**
 * D1072 (#2425) — the public trust center at /trust and its five tabs, for
 * anyone, in the public site frame; the member's own part kept at /trust/me.
 * Every fact is one the code shows; a claim with no proof says Not recorded,
 * and nothing is a certification or a figure the platform does not hold.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/trust_center_d1072.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CHECKED_WAIT, DISCLOSURE_GAPS, PUBLIC_PATHS, RESPONSE_TIMES, SECURITY, TABS, YOUR_TRUST, documentRows, statusLine, tabOf,
} from '../src/pages/site/trustCenterModel.js';
import { isPublicPath } from '../src/lib/api.js';
import { LEGAL_FOOTER_LINKS } from '../src/lib/siteLinks.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

test('the tabs and their addresses; the member part is /trust/me; public paths are public and /trust/me is not', () => {
  assert.deepEqual(TABS.map((t) => t.path), ['/trust', '/trust/security', '/trust/data', '/trust/subprocessors', '/trust/documents', '/trust/disclosure']);
  assert.equal(YOUR_TRUST.path, '/trust/me');
  assert.equal(tabOf('/trust/disclosure/'), 'disclosure');
  assert.equal(tabOf('/trust/anything'), 'overview');
  for (const p of PUBLIC_PATHS) assert.equal(isPublicPath(p), true, p);
  assert.equal(isPublicPath('/trust/me'), false, 'a 401 on the member part still signs in');
  assert.deepEqual(LEGAL_FOOTER_LINKS.slice(-2).map((l) => [l.label, l.to]), [['Trust center', '/trust'], ['Status', '/status']]);
});

test('every fact is checked as Not recorded, every gap says why, and nothing claims a certification, a test or a drill', () => {
  assert.equal(CHECKED_WAIT, 'Checked: Not recorded');
  const all = SECURITY.flatMap((s) => s.facts).concat(DISCLOSURE_GAPS);
  for (const f of all.filter((x) => !x.recorded)) assert.ok(f.why, f.text);
  const text = all.map((f) => f.text).join(' ');
  assert.match(text, /Certifications: none held\./);
  assert.ok(all.some((f) => f.text === 'Independent penetration test' && !f.recorded));
  assert.ok(all.some((f) => f.text === 'Last recovery drill' && !f.recorded));
  assert.doesNotMatch(text, /SOC ?2|ISO ?27001|certified/i);
  assert.deepEqual(RESPONSE_TIMES[0], ['Critical', '4 business hours', 'every 24 hours', '7 days']);
  assert.equal(statusLine('operational'), 'All systems operational');
  assert.equal(statusLine(undefined), 'Status not known', 'an unknown status is never "operational"');
  const docs = documentRows({ terms: 'July 8, 2026', privacy: null, risk: 'March 31, 2026' });
  assert.deepEqual(docs.map((d) => d.updated), ['July 8, 2026', null, 'March 31, 2026', null, null]);
  assert.equal(docs.find((d) => d.name === 'Data Processing Addendum').to, null, 'not published, not linked');
});

test('wiring: the public routes have no guard, /trust/me keeps the six-role guard, and every signed-in door opens /trust/me', () => {
  const app = read('frontend/src/App.jsx');
  for (const p of PUBLIC_PATHS) assert.ok(app.split('\n').some((l) => l.trim() === `<Route path="${p}" element={<TrustCenter />} />`), p);
  assert.ok(app.includes(`<Route path="/trust/me" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'], investorWorkspace('trust', <TrustCenterPage chromeless={effectiveRole === 'investor'} />))} />`));
  assert.ok(app.includes('<Link to="/trust/me" onClick={() => setOpen(false)}'), 'the account menu');
  for (const f of ['frontend/src/ui/phone/AccountSheet.jsx', 'frontend/src/sidebarConfig.js', 'frontend/src/workspaces/shellConfig.js', 'frontend/src/pages/account/accountPhone.js',
    'frontend/src/pages/SettingsPage.jsx', 'frontend/src/pages/docs/DocsLayout.jsx', 'frontend/src/pages/SpinoutLabLpWorkspacePage.jsx', 'frontend/src/pages/founder/FounderTeamPage.jsx']) {
    const src = read(f);
    assert.ok(!src.includes('to="/trust"') && !src.includes("to: '/trust'") && !src.includes("'/trust']") && !src.includes("route: '/trust',"), `${f} still opens /trust`);
  }
  const page = read('frontend/src/pages/site/TrustCenter.jsx');
  assert.doesNotMatch(page, /window\.(alert|confirm)|\balert\(|\bconfirm\(/);
  assert.ok(read('design/incoming/Trust center · Boards.dc.html').includes('TRU20'));
});
