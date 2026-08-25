/**
 * Carrying the founder onboarding answers into the intake form.
 *
 * `OnboardingFounderPage` asks "what problem are you solving?", "how are you
 * solving it?" and "why now?" before handing the founder to the active
 * workspace. The retired portal form no longer consumes these answers.
 *
 * There are two receiving surfaces, because the wizard branches on `journey`:
 *   • pre_incorp    → /spinout-lab, which has no intake form at all, so the
 *                     worker projects the answers straight into `projects`
 *                     (services/onboardingProjection.ts).
 *   • incorporated  → /studio, where the founder continues with the active
 *                     workspace instead of a retired intake form.
 *
 * Both halves must speak the same field names or half the answers vanish, and
 * the last test in this file is what stops them drifting.
 *
 * Run with:  node --test frontend/test/founder_onboarding_prefill.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PORTAL = readFileSync(
  fileURLToPath(new URL('../src/pages/FounderPortal.jsx', import.meta.url)),
  'utf8',
);
const WIZARD = readFileSync(
  fileURLToPath(new URL('../src/pages/OnboardingFounderPage.jsx', import.meta.url)),
  'utf8',
);
const WORKER = readFileSync(
  fileURLToPath(new URL('../../cloudflare-worker/src/services/onboardingProjection.ts', import.meta.url)),
  'utf8',
);

// Evaluated from the real source rather than reimplemented — the module pulls
// in React, lucide and react-router, which this bare node:test runner has no
// loader for.
const founderFormPrefill = (() => {
  const mapStart = PORTAL.indexOf('const ONBOARDING_TO_FORM');
  const fnStart = PORTAL.indexOf('export function founderFormPrefill');
  assert.notEqual(mapStart, -1, 'ONBOARDING_TO_FORM not found — renamed?');
  assert.notEqual(fnStart, -1, 'founderFormPrefill not found — renamed?');
  const map = PORTAL.slice(mapStart, PORTAL.indexOf('\n};\n', mapStart) + 3);
  const fn = PORTAL.slice(fnStart, PORTAL.indexOf('\n}\n', fnStart) + 3).replace(/^export /, '');
  // eslint-disable-next-line no-new-func
  return new Function(`${map}\n${fn}\nreturn founderFormPrefill;`)();
})();

const ANSWERS = {
  full_name: 'Jane Doe',
  linkedin: 'https://linkedin.com/in/jane',
  journey: 'incorporated',
  company_name: 'Acme AI',
  tagline: 'Agents for freight brokers',
  stage: 'Prototype',
  problem: 'Brokers reconcile load documents by hand.',
  solution: 'An agent that reads the documents and books the load.',
  why_now: 'Document models finally clear the accuracy bar.',
  primary_need: 'Capital',
  notes: 'Two technical co-founders.',
};

test('the three re-asked questions arrive already answered', () => {
  const seed = founderFormPrefill(ANSWERS);
  assert.equal(seed.problem_statement, 'Brokers reconcile load documents by hand.');
  assert.equal(seed.solution, 'An agent that reads the documents and books the load.');
  assert.equal(seed.why_now, 'Document models finally clear the accuracy bar.');
});

test('name, description and founder name come across too', () => {
  const seed = founderFormPrefill(ANSWERS);
  assert.equal(seed.name, 'Acme AI');
  assert.equal(seed.description, 'Agents for freight brokers');
  assert.equal(seed.founder_name, 'Jane Doe');
});

test('answers with no field on this form are dropped, not smuggled in', () => {
  const seed = founderFormPrefill(ANSWERS);
  assert.deepEqual(
    Object.keys(seed).sort(),
    ['description', 'founder_name', 'name', 'problem_statement', 'solution', 'why_now'],
  );
  // A stray key would reach api.founderSubmit and be scored against.
  for (const orphan of ['Capital', 'incorporated', 'Prototype', 'https://linkedin.com/in/jane']) {
    assert.equal(Object.values(seed).includes(orphan), false, `${orphan} must not be sent`);
  }
});

test('blank and whitespace answers are omitted so they cannot blank the form', () => {
  const seed = founderFormPrefill({ company_name: 'Acme', tagline: '  ', problem: '', why_now: null });
  assert.deepEqual(seed, { name: 'Acme' });
});

test('values are trimmed', () => {
  assert.equal(founderFormPrefill({ company_name: '  Acme AI \n' }).name, 'Acme AI');
});

test('a missing or malformed blob yields an empty seed, never a throw', () => {
  for (const bad of [null, undefined, '', 'str', 42, [], [ANSWERS]]) {
    assert.deepEqual(founderFormPrefill(bad), {}, `input: ${JSON.stringify(bad)}`);
  }
});

// --- the wiring ------------------------------------------------------------

const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('the form actually loads the answers on mount', () => {
  const src = code(PORTAL);
  assert.match(src, /api\.onboardingGetProgress\(\)/, 'must fetch the stored answers');
  assert.match(src, /founderFormPrefill\(p\.data\)/);
  assert.match(src, /p\?\.flow !== 'founder'/, "another role's flow must not seed this form");
});

test('prefill never overwrites something the founder has already typed', () => {
  // The fetch resolves after first paint, so a fast typist can be mid-field
  // when it lands.
  const src = code(PORTAL);
  assert.match(src, /String\(prev\[k\] \?\? ''\)\.trim\(\) === ''/);
});

test('every field the wizard collects is either mapped or knowingly dropped', () => {
  // A new wizard question that lands in neither list is a silent regression to
  // exactly the bug this file exists for.
  const asked = [...code(WIZARD).matchAll(/set\('(\w+)'/g)].map((m) => m[1]);
  assert.ok(asked.length >= 10, `expected ~11 wizard fields, parsed ${asked.length}`);

  const mapped = [...code(PORTAL)
    .slice(code(PORTAL).indexOf('const ONBOARDING_TO_FORM'))
    .matchAll(/^\s*(\w+):/gm)].map((m) => m[1]);
  // Deliberately unmapped, each for a stated reason in the source comments:
  // no column (journey/primary_need/notes), belongs to `founders` (linkedin),
  // or admin/partner-owned with no shared vocabulary (stage).
  const dropped = ['journey', 'primary_need', 'notes', 'linkedin', 'stage'];

  const unaccounted = asked.filter((f) => !mapped.includes(f) && !dropped.includes(f));
  assert.deepEqual(unaccounted, [], `unaccounted wizard fields: ${unaccounted.join(', ')}`);
});

test('the frontend and worker mappings read the same wizard keys', () => {
  // Both consume `onboarding_progress.data`. If the worker reads `d.problem`
  // and this form reads `problem_text`, whichever path a founder takes decides
  // whether their answers survive — the failure would be invisible on one
  // branch and total on the other.
  const shared = ['company_name', 'tagline', 'problem', 'solution', 'why_now'];
  const workerSeed = code(WORKER).slice(
    code(WORKER).indexOf('export function projectSeedFromOnboarding'),
  );
  const formMap = code(PORTAL).slice(code(PORTAL).indexOf('const ONBOARDING_TO_FORM'));
  for (const key of shared) {
    assert.match(workerSeed, new RegExp(`d\\.${key}\\b`), `worker must read ${key}`);
    assert.match(formMap, new RegExp(`^\\s*${key}:`, 'm'), `form must read ${key}`);
  }
  // …and both must land on the same three project columns.
  for (const col of ['problem_statement', 'solution', 'why_now']) {
    assert.match(workerSeed, new RegExp(`${col}:`), `worker must write ${col}`);
    assert.match(formMap, new RegExp(`'${col}'`), `form must write ${col}`);
  }
});
