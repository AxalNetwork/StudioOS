/**
 * The ICP definition module on Lab Customer Discovery — D353.
 *
 * The page draws a five-step wizard from `lib/icpDefinition.js`; the Worker
 * validates against `ICP_FIELDS` in routes/projects.ts. If the two lists drift,
 * the wizard offers an answer the Worker refuses (or silently drops), so this
 * file holds them equal key for key and option for option, and pins:
 *   * a stored blob that cannot be read is "unreadable", never "not started";
 *   * progress counts required answers only, as the canvas does;
 *   * the payload never carries version or timestamps (the Worker sets them);
 *   * `icp_defined` is marked from a CONFIRMED stored definition plus the
 *     interview gate — no longer from a derived segment alone.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import { ICP_STEPS, readIcpDefinition, icpProgress, icpPayload, icpSummary } from '../src/lib/icpDefinition.js';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const ROUTE = raw('cloudflare-worker/src/routes/projects.ts');
const PAGE = codeOnly(raw('frontend/src/pages/SpinoutLabDiscoveryPage.jsx'));
const CARD = codeOnly(raw('frontend/src/components/discovery/IcpDefinitionCard.jsx'));
const CANVAS = raw('design/canvases/out-of-scope/Customer Discovery.dc.html');

/** The Worker's ICP_FIELDS, read as data from its source. */
function workerFields() {
  const block = ROUTE.slice(ROUTE.indexOf('export const ICP_FIELDS'), ROUTE.indexOf('};', ROUTE.indexOf('export const ICP_FIELDS')));
  const out = {};
  for (const m of block.matchAll(/^\s+(\w+): \{ step: (\d), kind: '(\w+)'(?:, options: \[([^\]]*)\])?(, optional: true)?/gm)) {
    out[m[1]] = {
      step: Number(m[2]), kind: m[3],
      options: m[4] ? [...m[4].matchAll(/'([^']*)'/g)].map((x) => x[1]) : undefined,
      optional: Boolean(m[5]),
    };
  }
  return out;
}

test('the wizard’s fields are the Worker’s, key for key and option for option', () => {
  const w = workerFields();
  const page = {};
  for (const s of ICP_STEPS) for (const f of s.fields) page[f.key] = { step: s.n, kind: f.kind, options: f.options, optional: Boolean(f.optional) };
  assert.equal(Object.keys(w).length, 19, 'the Worker field list could not be read');
  assert.deepEqual(page, w);
});

test('the canvas’s five steps and nineteen fields are the wizard’s', () => {
  const block = CANVAS.slice(CANVAS.indexOf('const ICP_STEPS = ['), CANVAS.indexOf('const stepFilled'));
  const names = [...block.matchAll(/\{ n:\d, name:'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(names, ICP_STEPS.map((s) => s.name));
  const keys = [...block.matchAll(/\{ key:'(\w+)'/g)].map((m) => m[1]);
  assert.deepEqual(keys, ICP_STEPS.flatMap((s) => s.fields.map((f) => f.key)));
});

test('an unreadable stored blob is unreadable, not "not started"', () => {
  assert.equal(readIcpDefinition(null).state, 'empty');
  assert.equal(readIcpDefinition('{not json').state, 'unreadable');
  assert.equal(readIcpDefinition('[1,2]').state, 'unreadable');
  const d = readIcpDefinition(JSON.stringify({ status: 'confirmed', step: 5, fields: { persona: 'CFO' }, version: 2 }));
  assert.equal(d.state, 'confirmed');
  assert.equal(d.version, 2);
});

test('progress counts required answers only (the optional pains are not required)', () => {
  const p = icpProgress({ type: 'B2B', pain2: 'x', pain3: 'y' });
  assert.equal(p.total, 17);
  assert.equal(p.done, 1);
  assert.equal(p.steps[1].total, 3);
});

test('the payload carries answers only — the Worker sets version and timestamps', () => {
  const out = JSON.parse(icpPayload({ status: 'confirmed', step: 5, fields: { persona: '  CFO ', blank: '', industry: '' } }));
  assert.deepEqual(out, { status: 'confirmed', step: 5, fields: { persona: 'CFO' } });
  assert.ok(!('version' in out) && !('updated_at' in out) && !('confirmed_at' in out));
});

test('the summary shows only answers on file', () => {
  assert.deepEqual(icpSummary({ pain1: 'P', urgency: 'Active — looking now' }).map((r) => r.k), ['Primary pain', 'Buying trigger']);
});

test('the card writes through updateProject and prints the Worker’s refusal', () => {
  assert.match(CARD, /api\.updateProject\(project\.id, \{\s+icp_definition_meta: icpPayload\(\{ status, step: nextStep, fields \}\),/);
  assert.match(CARD, /setError\(e\?\.message \|\| 'The ICP definition was not saved\.'\)/);
  assert.match(CARD, /data-testid="icp-definition-unreadable"/);
  assert.match(CARD, /Generate a landing page from this ICP: <Unrecorded reason=/);
});

test('icp_defined is marked from a confirmed stored definition plus the interview gate', () => {
  assert.match(PAGE, /if \(!failed\.interviews && derived\.ivs\?\.length >= MIN_INTERVIEWS && icpDef\.state === 'confirmed'\) \{\s+markMilestone\(user, 'icp_defined'\);/);
  assert.doesNotMatch(PAGE, /derived\.topRole && derived\.topPain\) \{\s+markMilestone/);
  assert.match(PAGE, /<IcpDefinitionCard\s+project=\{project\}/);
});

test('none of the canvas’s ICP fixtures is rendered', () => {
  for (const fixture of ['Head of Operations', 'Notion plus Slack threads', 'Hours per week spent reconstructing status']) {
    assert.ok(CANVAS.includes(fixture), `fixture ${fixture} left the canvas — re-aim this test`);
    assert.ok(!CARD.includes(fixture) && !PAGE.includes(fixture), `the canvas fixture "${fixture}" is rendered`);
  }
});
