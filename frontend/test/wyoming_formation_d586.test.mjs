/**
 * D586 (#1213) — the Lab Incorporate page forms a Wyoming C-Corp, and no
 * surface calls a jurisdiction live unless a founder can order it.
 *
 * The owner chose A. The page maps a Wyoming application to `us_wy_ccorp`,
 * names the entity and charter for the state ("Wyoming C-Corp", "Articles of
 * Incorporation"), and prices it from the catalog quote only. The Worker's
 * half is cloudflare-worker/test/wyoming_formation_d586.test.ts.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/wyoming_formation_d586.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import { charterName, entityLabel, formationJurisdiction } from '../src/lib/incorporationPricing.js';
import { LAB_JURISDICTIONS } from '../src/lib/spinoutLab.js';
import { JURISDICTIONS as BRIEF_JURISDICTIONS } from '../src/lib/spinoutBrief.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const PAGE = codeOnly(read('frontend/src/pages/SpinoutLabIncorporatePage.jsx'));
const LEGAL = read('cloudflare-worker/src/routes/legal.ts');
const WORKER_IDS = new Set([...LEGAL.slice(LEGAL.indexOf('const JURISDICTIONS = ['), LEGAL.indexOf('];', LEGAL.indexOf('const JURISDICTIONS = ['))).matchAll(/\{ id: '([a-z_]+)'/g)].map((m) => m[1]));

test('a Wyoming application forms a Wyoming C-Corp, and only a C-Corp', () => {
  const wy = formationJurisdiction('Wyoming C-Corp — Wyoming, USA', 'ccorp');
  assert.deepEqual([wy.state, wy.jurisdictionId, wy.fromApplication, wy.reason], ['Wyoming', 'us_wy_ccorp', true, null]);
  for (const [entity, kind] of [['llc', /an LLC/], ['pbc', /public benefit corporation/]]) {
    const other = formationJurisdiction('Wyoming C-Corp — Wyoming, USA', entity);
    assert.equal(other.jurisdictionId, null, entity);
    assert.match(other.reason, /C-Corp only/);
    assert.match(other.reason, kind);
  }
  assert.ok(WORKER_IDS.has('us_wy_ccorp'), 'the Worker has no Wyoming jurisdiction to order');
});

test('every jurisdiction a Lab list calls live maps to one the Worker can order', () => {
  const live = [
    ...LAB_JURISDICTIONS.filter((j) => !j.soon).map((j) => `${j.entity} — ${j.label}`),
    ...BRIEF_JURISDICTIONS.filter((j) => !j.soon).map((j) => j.name),
  ];
  assert.ok(live.some((l) => /Wyoming/.test(l)), 'Wyoming is no longer drawn live');
  for (const label of live) {
    const { jurisdictionId } = formationJurisdiction(label, 'ccorp');
    assert.ok(jurisdictionId && WORKER_IDS.has(jurisdictionId), `${label} is drawn live but cannot be ordered`);
  }
  for (const j of BRIEF_JURISDICTIONS) assert.equal(/· live$/.test(j.sub), !j.soon, `${j.name}: "${j.sub}" disagrees with soon`);
});

test('the entity and the charter take the state\'s names', () => {
  assert.equal(entityLabel('ccorp', 'Wyoming'), 'Wyoming C-Corp');
  assert.equal(entityLabel('ccorp', 'Delaware'), 'Delaware C-Corp');
  assert.equal(entityLabel('pbc', 'Delaware'), 'Delaware PBC');
  assert.equal(entityLabel('llc', 'Delaware'), 'Delaware LLC');
  assert.equal(charterName('Wyoming'), 'Articles of Incorporation');
  assert.equal(charterName('Delaware'), 'Certificate of Incorporation');
});

test('the page names the formed entity and its charter from the state, never "Delaware" for Wyoming', () => {
  assert.match(PAGE, /name: d\.key === 'coi' \? charterName\(juris\.state\) : d\.name/);
  assert.match(PAGE, /`State review of the \$\{charterName\(juris\.state\)\}`/);
  assert.match(PAGE, /`\$\{charterName\(juris\.state\)\} stamped and returned`/);
  assert.match(PAGE, /entity_type: entityLabel\(selected, juris\.state\)/);
  assert.match(PAGE, /data-testid="investor-entity-type">\{entityLabel\(selected, juris\.state\)\} · State of \{juris\.state\}/);
  assert.match(PAGE, /\{docs\.find\(\(d\) => d\.key === docModal\)\?\.name\}/);
  assert.doesNotMatch(PAGE, /ENTITIES\[selected\]\.name/, 'a formed-entity label still reads the Delaware-named catalog');
  assert.doesNotMatch(PAGE, /State review of Certificate|Certificate stamped/);
});
