/**
 * D380 — the Spin-Out Lab honesty sweep. Each test pins what a sentence
 * CLAIMS against the code that decides whether it is true, so the next honest
 * edit to either side does not need this file rewritten, and a dishonest one
 * fails it.
 *
 *   1. `spinout_lab.ts`'s header names the routes that skip `requireAuth`.
 *      It said "JWT-auth-gated for every route" while four were public.
 *   2. The certificate page does not say the graduation email "sends" while
 *      nothing in the worker calls it.
 *   3. The Workspace and the admin view do not offer a "solo declaration" as a
 *      way to meet `cofounder_agreement_signed` while only a signed agreement
 *      records it.
 *   4. The public Lab's share card and the certificate verifier no longer sell
 *      "idea to incorporated", which D38 retired from the page itself.
 *   5. SpinoutLabPage carries none of the components that stopped rendering
 *      when the intro replaced its hero.
 *
 * Run with:  node --test frontend/test/spinout_lab_honesty_d380.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeOnly } from './_codeOnly.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8');

const LAB = read('cloudflare-worker/src/routes/spinout_lab.ts');
const CERT = read('frontend/src/pages/SpinoutLabCertificatePage.jsx');
const VERIFY = read('frontend/src/pages/PublicCertificateVerifyPage.jsx');
const WS = read('frontend/src/pages/SpinoutLabWorkspace.jsx');
const ADMIN_LAB = read('frontend/src/pages/admin/AdminSpinoutLab.jsx');
const AGREEMENT = read('frontend/src/pages/SpinoutLabCofounderAgreementPage.jsx');
const OG = read('frontend/src/lib/ogRegistry.js');
const PAGE = read('frontend/src/pages/SpinoutLabPage.jsx');

function walk(dir, out = []) {
  for (const name of readdirSync(join(root, dir))) {
    const rel = join(dir, name);
    if (statSync(join(root, rel)).isDirectory()) walk(rel, out);
    else if (/\.(ts|js|mjs)$/.test(name)) out.push(rel);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1. The header names every public route, and only those.
// ---------------------------------------------------------------------------

/** Each `spinoutLab.<verb>('/path', …)` handler and whether its body calls requireAuth. */
function handlers(src) {
  const re = /^spinoutLab\.(get|post|put|patch|delete)\('([^']+)'/gm;
  const found = [...src.matchAll(re)];
  return found.map((m, i) => {
    const body = src.slice(m.index, i + 1 < found.length ? found[i + 1].index : src.length);
    return { path: m[2], auth: /await requireAuth\(c\)/.test(body.slice(0, 400)) };
  });
}

test('spinout_lab.ts names every route that skips requireAuth in its header', () => {
  const hs = handlers(LAB);
  assert.ok(hs.length >= 10, 'the handler scan found almost nothing; the regex is stale');
  const open = [...new Set(hs.filter((h) => !h.auth).map((h) => h.path))].sort();
  assert.ok(open.length > 0, 'no public handler found — the scan is not measuring anything');
  const header = LAB.slice(0, LAB.indexOf('import '));
  assert.doesNotMatch(header, /JWT-auth-gated for every route\./, 'the header claims every route is gated again');
  for (const p of open) {
    assert.ok(header.includes(`\`${p}\``), `${p} is public and the header does not say so`);
  }
  // …and names no gated route as public.
  const named = [...header.matchAll(/EXCEPT[\s\S]*?need:([\s\S]*?)\. Those/g)][0];
  assert.ok(named, 'the header lost its list of public routes');
  const listed = [...named[1].matchAll(/`(\/[^`]+)`/g)].map((m) => m[1]).sort();
  assert.deepEqual(listed, open, 'the header lists a different set of public routes than the handlers implement');
});

// ---------------------------------------------------------------------------
// 2. The graduation email is not described as sent while nothing sends it.
// ---------------------------------------------------------------------------

test('the certificate page only says the graduation email sends if something sends it', () => {
  const callers = walk('cloudflare-worker/src')
    .filter((f) => !f.endsWith('templates/email/registry.ts'))
    .filter((f) => /['"`]spinout_graduated['"`]/.test(read(f)));
  const at = CERT.indexOf('text-[11px]">spinout_graduated</span>');
  assert.ok(at > 0, 'the certificate page no longer names the template it previews');
  const note = CERT.slice(at, at + 500);
  assert.ok(note.length > 100, 'the certificate page no longer shows the template; this slice is stale');
  if (callers.length === 0) {
    assert.doesNotMatch(note, /\bsends on graduation\b|\bis sent\b|\bwas sent\b/,
      'the page says the graduation email sends, and no worker code sends it');
    assert.match(note, /Nothing sends it yet/);
  }
});

// ---------------------------------------------------------------------------
// 3. "(or solo declaration)" only while a solo path records the milestone.
// ---------------------------------------------------------------------------

test('no deliverable row offers a solo declaration the milestone does not accept', () => {
  // The agreement page records the milestone from a SIGNED document, and its
  // own solo banner says there is no solo declaration document.
  const records = AGREEMENT.slice(
    AGREEMENT.indexOf("markMilestone(user, 'cofounder_agreement_signed')") - 300,
    AGREEMENT.indexOf("markMilestone(user, 'cofounder_agreement_signed')"),
  );
  assert.match(records, /status[^\n]*=== 'signed'/, 'the milestone no longer waits for a signed document');
  const soloRecords = /solo[\s\S]{0,300}markMilestone\(user, 'cofounder_agreement_signed'\)/.test(AGREEMENT);
  if (!soloRecords) {
    for (const [label, src] of [['SpinoutLabWorkspace', WS], ['AdminSpinoutLab', ADMIN_LAB]]) {
      assert.doesNotMatch(src, /solo declaration/i, `${label} offers a solo declaration that records nothing`);
    }
  }
});

// ---------------------------------------------------------------------------
// 4. The retired positioning stays retired where people share the Lab.
// ---------------------------------------------------------------------------

test('the Lab share card and the verifier no longer say "idea to incorporated"', () => {
  const entry = OG.slice(OG.indexOf("path: '/spinout-lab',"), OG.indexOf("path: '/spinout-lab',") + 400);
  assert.ok(entry.includes('description'), 'the /spinout-lab OG entry moved; this slice is stale');
  for (const [label, src] of [['ogRegistry /spinout-lab', entry], ['certificate verifier', codeOnly(VERIFY)],
    ['SpinoutLabPage', codeOnly(PAGE)]]) {
    assert.doesNotMatch(src, /idea to incorporated/i, `${label} sells the positioning D38 retired`);
    assert.doesNotMatch(src, /demo day/i, `${label} promises a demo day`);
  }
});

// ---------------------------------------------------------------------------
// 5. The page holds no component that nothing renders.
// ---------------------------------------------------------------------------

test('SpinoutLabPage exports only components something renders', () => {
  const src = codeOnly(PAGE);
  const exported = [...src.matchAll(/^export (?:function|const) (\w+)/gm)].map((m) => m[1]);
  const tree = walk('frontend/src').filter((f) => /\.(js|mjs)$/.test(f))
    .concat(readdirSync(join(root, 'frontend/src'), { recursive: true })
      .filter((f) => String(f).endsWith('.jsx')).map((f) => join('frontend/src', String(f))));
  const others = tree.filter((f) => !f.endsWith('pages/SpinoutLabPage.jsx')).map((f) => codeOnly(read(f)));
  for (const name of exported) {
    const usedHere = new RegExp(`<${name}[\\s/>]|\\b${name}\\(`).test(src.replace(new RegExp(`^export (?:function|const) ${name}\\b`, 'm'), ''));
    const usedElsewhere = others.some((o) => new RegExp(`\\b${name}\\b`).test(o));
    assert.ok(usedHere || usedElsewhere || name === 'default', `${name} is exported from SpinoutLabPage and rendered nowhere`);
  }
  for (const gone of ['PHASE_THEMES', 'TRACKER_COLUMNS', 'deliverablesFor', 'JurisdictionBar', 'HeroStatsPanel', 'CohortTrackerSection']) {
    assert.doesNotMatch(src, new RegExp(`\\b${gone}\\b`), `${gone} is back in SpinoutLabPage`);
  }
});
