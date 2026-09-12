/**
 * Task #145 — the four things the user reported on /onboarding/investor.
 *
 *   1. Country of residence: a required dropdown, not an optional text box.
 *   2. The NFX taxonomy on BOTH the thesis and the anti-thesis.
 *   3. Sliders whose value you can actually see.
 *   4. A finishing investor goes somewhere that belongs to them.
 *
 * The data and the landing rule are imported and exercised directly; the
 * page and the shared wizard are read as source, because importing either
 * pulls React and a stylesheet through the component tree and the test
 * loader cannot resolve that.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { COUNTRIES, COUNTRY_SET } from '../src/lib/countries.js';
import { NFX_SECTORS, NFX_SECTOR_SET } from '../src/lib/nfxSectors.js';
import { investorLanding, ONBOARDING_COMPLETE_EVENT } from '../src/lib/onboarding.js';
import { routeBlock } from './_routes.mjs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const page = read('../src/pages/OnboardingInvestorPage.jsx');
const wizard = read('../src/components/OnboardingWizard.jsx');
const app = read('../src/App.jsx');
const css = read('../src/index.css');
const kyc = read('../src/components/KycVerification.jsx');

/** Comments must not satisfy assertions about what the code does. */
function codeOnly(src) {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/^\s*\/\*[\s\S]*?\*\//gm, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/** The body of one wizard step, by its `key`, so a sibling step cannot stand in. */
function step(key) {
  const start = page.indexOf(`key: '${key}'`);
  assert.ok(start > 0, `the investor wizard has no step keyed '${key}'`);
  const next = page.indexOf('      key: ', start + 10);
  return codeOnly(page.slice(start, next === -1 ? page.length : next));
}

// ---------- 1. country ----------

test('the country list is complete, sorted and free of duplicates', () => {
  assert.ok(COUNTRIES.length >= 190, `expected ~196 countries, got ${COUNTRIES.length}`);
  assert.equal(COUNTRY_SET.size, COUNTRIES.length, 'the list contains a duplicate');
  const sorted = [...COUNTRIES].sort((a, b) => a.localeCompare(b, 'en'));
  assert.deepEqual(COUNTRIES, sorted, 'a 196-entry dropdown is only usable if it is sorted');
  for (const c of ['United States', 'United Kingdom', 'France', 'Japan', 'Nigeria', 'Brazil']) {
    assert.ok(COUNTRY_SET.has(c), `${c} is missing`);
  }
});

test('country of residence is a dropdown over that list, not a text box', () => {
  const s = step('accreditation');
  assert.match(s, /<SelectField/, 'it must be a select');
  assert.match(s, /options=\{COUNTRIES\}/, 'the select must be fed the shared country list');
  assert.doesNotMatch(s, /<TextField[^>]*Country/s, 'the free-text country input must be gone');
  assert.doesNotMatch(s, /placeholder="United States"/, 'the old placeholder must be gone');
});

test('country of residence is required, and Continue says so when it is blank', () => {
  const s = step('accreditation');
  assert.match(s, /required/, 'the field must be marked required');
  // The wizard blocks on a non-null string from validate(), so the rule has
  // to live there — a `required` attribute alone does nothing, because the
  // step advances on a button click and not a form submit.
  assert.match(s, /if \(!v\.country\) return '[^']+';/, 'validate() must refuse a blank country');
  const msg = s.match(/if \(!v\.country\) return '([^']+)';/);
  assert.match(msg[1], /country/i, 'the refusal must name the field the member has to fix');
});

test('KYC and onboarding ask for a country from the same list', () => {
  assert.match(
    kyc,
    /from '\.\.\/lib\/countries'/,
    'KycVerification must read the shared list, not keep its own copy',
  );
  assert.doesNotMatch(
    codeOnly(kyc),
    /const ALL_COUNTRIES = \[/,
    'the module-local country array has reappeared — two surfaces, two lists, two spellings',
  );
});

// ---------- 2. the NFX taxonomy ----------

test('the NFX taxonomy is the 82 sectors the user supplied', () => {
  assert.equal(NFX_SECTORS.length, 82, 'the user supplied exactly 82 sectors');
  assert.equal(NFX_SECTOR_SET.size, 82, 'the list contains a duplicate');
  assert.ok(NFX_SECTORS.every((s) => s === s.trim() && s.length > 0), 'an entry is blank or padded');
  // Spot-check entries that exist ONLY in this taxonomy, so swapping in the
  // Axal company taxonomy cannot satisfy this test.
  for (const s of ['Creator/Passion Economy', 'Gig Economy', 'General Tech', 'SMB Software', 'Parenting/Families']) {
    assert.ok(NFX_SECTOR_SET.has(s), `${s} is missing from the NFX list`);
  }
});

test('the thesis and the anti-thesis offer the same sectors', () => {
  assert.match(codeOnly(page), /const SECTORS = NFX_SECTORS;/, 'the page must use the NFX list');
  for (const key of ['sectors', 'anti-thesis']) {
    assert.match(step(key), /options=\{SECTORS\}/, `the '${key}' step must offer the shared list`);
  }
  // A sector that can be excluded but never selected — or the reverse — is
  // the bug this pins shut.
  assert.doesNotMatch(
    codeOnly(page),
    /options=\{\[['"]/,
    'a step is offering an inline sector list of its own',
  );
});

test('the old eleven-entry sector list is gone', () => {
  assert.doesNotMatch(
    codeOnly(page),
    /'AI\/ML','Climate','Fintech'/,
    'the previous hard-coded taxonomy must be gone',
  );
});

test('the investor taxonomy stays separate from the company taxonomy', () => {
  // lib/sectors.js classifies what a founder is BUILDING and is used by
  // SectorSelect; merging them would offer founders 'General Tech' and
  // strip investors of the distinctions a thesis turns on.
  assert.doesNotMatch(
    codeOnly(page),
    /from '\.\.\/lib\/sectors'/,
    'the investor wizard must not reach for the company taxonomy',
  );
});

// ---------- 3. the sliders ----------

test('the slider no longer relies on accent-color over a stripped widget', () => {
  const src = codeOnly(wizard);
  const slider = src.slice(src.indexOf('export function SliderField'));
  assert.doesNotMatch(
    slider,
    /accent-violet/,
    'accent-color cannot reach a widget that appearance-none removed — that was the bug',
  );
  assert.match(slider, /className="axal-range"/, 'the slider must use the drawn style');
  assert.match(slider, /'--range-pct':/, 'the fill has to know where the value sits');
});

test('the drawn slider fills purple to the value and paints a visible thumb', () => {
  assert.match(css, /\.axal-range\s*\{/, '.axal-range must exist');
  // Slice to the BASE rule's own braces. Reading to end-of-file let the
  // thumb rules below satisfy an assertion about the fill: recolouring the
  // gradient to grey escaped, because the thumb's #7c3aed still matched.
  const open = css.indexOf('.axal-range {');
  const rule = css.slice(open, css.indexOf('}', open));
  assert.match(rule, /var\(--range-pct/, 'the fill must stop at the value');
  const gradient = rule.match(/linear-gradient\(([\s\S]*)/);
  assert.ok(gradient, 'the fill must be a gradient, or there is nothing to stop at the value');
  assert.match(gradient[1], /#7c3aed/, 'the filled portion must be the brand purple');
  // Both engines, in SEPARATE rules: a selector either engine cannot parse
  // invalidates the whole rule for both, so merging them silently kills the
  // thumb in one of them.
  assert.match(css, /\.axal-range::-webkit-slider-thumb\s*\{/, 'WebKit thumb rule missing');
  assert.match(css, /\.axal-range::-moz-range-thumb\s*\{/, 'Gecko thumb rule missing');
  assert.doesNotMatch(
    css,
    /::-webkit-slider-thumb\s*,\s*[\s\S]{0,40}::-moz-range-thumb/,
    'the two thumb selectors must not share one rule',
  );
});

// ---------- 4. where a finishing investor lands ----------

test('a real investor lands on their own deal flow', () => {
  assert.equal(investorLanding('investor'), '/deals');
  assert.equal(investorLanding(undefined), '/deals');
  assert.notEqual(investorLanding('investor'), '/onboarding/founder');
});

test('an account still under review lands on the holding dashboard', () => {
  // /deals is guarded ['admin','partner','investor']; an exploring account
  // would be bounced straight back out of it.
  assert.equal(investorLanding('exploring'), '/exploring');
});

test('both landings are routes that actually exist and admit the role', () => {
  const deals = routeBlock(app, '/deals');
  assert.ok(deals, '/deals is not mounted');
  assert.match(deals, /'investor'/, '/deals must admit an investor');
  const exploring = routeBlock(app, '/exploring');
  assert.ok(exploring, '/exploring is not mounted');
  assert.match(exploring, /'exploring'/, '/exploring must admit an exploring account');
});

test('the page routes its finish through that rule', () => {
  const body = codeOnly(page);
  assert.match(body, /navigate\(investorLanding\(user\?\.role\)/, 'finish must use the shared rule');
  assert.doesNotMatch(body, /navigate\('\/studio'\)/, 'the generic workspace root is not a destination');
});

// ---------- the gate that was undoing all of it ----------

test('finishing a wizard tells the shell, so the resume gate stops re-firing', () => {
  assert.match(
    codeOnly(wizard),
    new RegExp(`dispatchEvent\\(new CustomEvent\\(ONBOARDING_COMPLETE_EVENT`),
    'the wizard must announce completion',
  );
  // Scope to the listener effect's OWN body. Reading the whole of App.jsx
  // let the original progress effect's catch branch — which also calls
  // setOnboardingComplete(true) — stand in for the listener's, so gutting
  // the listener escaped.
  const src = codeOnly(app);
  const at = src.indexOf('addEventListener(ONBOARDING_COMPLETE_EVENT');
  assert.ok(
    at > 0,
    'App must listen, or its cached completed=false bounces the user back into a wizard',
  );
  const effect = src.slice(src.lastIndexOf('useEffect(', at), src.indexOf('}, []);', at));
  assert.match(
    effect,
    /setOnboardingComplete\(true\)/,
    'the listener itself must clear the stale belief',
  );
  assert.match(
    effect,
    /removeEventListener\(ONBOARDING_COMPLETE_EVENT/,
    'the listener must be torn down',
  );
});

test('both sides name the event from one constant', () => {
  assert.equal(ONBOARDING_COMPLETE_EVENT, 'axal:onboarding-complete');
  for (const [name, src] of [['App.jsx', app], ['OnboardingWizard.jsx', wizard]]) {
    assert.match(
      src,
      /import \{[^}]*ONBOARDING_COMPLETE_EVENT[^}]*\} from '\.{1,2}\/lib\/onboarding'/,
      `${name} must import the name rather than spell it by hand`,
    );
  }
});

test('the completion screen does not promise a destination it no longer picks', () => {
  const done = codeOnly(wizard).slice(codeOnly(wizard).indexOf('You\'re all set'));
  assert.doesNotMatch(
    done.slice(0, 400),
    /redirecting you to Studio/,
    'this shell serves three flows and each finishes somewhere different',
  );
});
