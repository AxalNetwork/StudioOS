/**
 * D602 (#1006) — the archetype card page v2, data half: the assessment
 * fallback is retired, the matches resolve to archetype slugs the Worker can
 * look up, and the radar layers and the timeline are built from the stores'
 * own replies, with nothing recorded as nothing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARCHETYPES } from '../src/lib/assessmentMeta.js';
import { archetypeTimeline, cardArchetype, matchGroups, matchSlugs, radarLayers } from '../src/lib/archetypeCardV2.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');

test('D602: the card reads the conversational archetype only; the assessment fallback is gone', () => {
  assert.deepEqual(cardArchetype({ archetype: { slug: 'fo_missionary', label: 'The Missionary', confidence: 0.8 } }),
    { slug: 'fo_missionary', label: 'The Missionary', confidence: 0.8 });
  assert.equal(cardArchetype({ archetype: null }), null);
  assert.equal(cardArchetype({ results: [{ archetype_slug: 'fo_maverick' }] }), null, 'an assessment result stood in');
  const page = read('frontend/src/pages/ArchetypeCardPage.jsx');
  assert.doesNotMatch(page, /assessment\.myResults\(/, 'the card still reads the assessment results');
  assert.match(page, /const latest = lock \? null : cardArchetype\(fitData\);/);
  assert.match(page, /const lock = archetypeLock\(fitData\);/);
});

test('D602: every match in the copy resolves to an archetype slug the Worker can look up', () => {
  assert.deepEqual(matchSlugs('fo_missionary'), ['fo_rocketeer', 'fo_maverick', 'inv_thesis_backer', 'mt_sage_guide', 'pt_systems_builder']);
  assert.deepEqual(matchSlugs('nope'), []);
  for (const [slug, meta] of Object.entries(ARCHETYPES)) {
    assert.equal(matchSlugs(slug).length, (meta.matching || []).length, `${slug} names a match no archetype carries`);
    assert.ok(matchSlugs(slug).length <= 10, `${slug} asks for more than the Worker takes`);
  }
});

test('D602: matches are the types always, plus the members who published one', () => {
  const reply = { items: [
    { user_id: 20, name: 'Ivy Investor', role: 'investor', slug: 'inv_thesis_backer', label: 'Thesis-Driven Backer' },
    { user_id: 24, name: 'Rocket Founder', role: 'founder', slug: 'fo_rocketeer', label: 'The Rocketeer' },
  ] };
  const g = matchGroups('fo_missionary', reply);
  assert.deepEqual(g.map((x) => [x.slug, x.members.map((m) => m.user_id)]),
    [['fo_rocketeer', [24]], ['fo_maverick', []], ['inv_thesis_backer', [20]], ['mt_sage_guide', []], ['pt_systems_builder', []]]);
  assert.ok(g.every((x) => x.why), 'a type lost its reason');
  assert.deepEqual(matchGroups('fo_missionary', null).map((x) => x.members.length), [0, 0, 0, 0, 0]);
});

test('D602: the radar keeps both layers, and nothing recorded stays null, never 0', () => {
  const layers = radarLayers({ axes: [
    { axis: 'product', label: 'Product', state: 'corroborated', self_level: 4, evidence_weight: 3.5, lifetime_count: 9 },
    { axis: 'design', label: 'Design', state: 'not_recorded', self_level: null, evidence_weight: null, lifetime_count: 0 },
    { axis: 'gtm_sales', label: 'GTM', state: 'evidence_only', self_level: null, evidence_weight: 1.2, lifetime_count: 2 },
  ] });
  assert.deepEqual(layers.map((l) => [l.axis, l.self, l.evidence, l.evidence_count]),
    [['product', 4, 3.5, 9], ['design', null, null, 0], ['gtm_sales', null, 1.2, 2]]);
  assert.deepEqual(radarLayers(null), []);
});

test('D602: the timeline is one point per change of the displayed archetype, oldest first', () => {
  const items = [
    { id: 4, persona: 'founder', displayed_slug: 'fo_rocketeer', computed_at: '2026-09-20T00:00:00Z', trigger: 'answer' },
    { id: 1, persona: 'founder', displayed_slug: 'fo_missionary', computed_at: '2026-08-01T00:00:00Z', trigger: 'answer' },
    { id: 2, persona: 'founder', displayed_slug: 'fo_missionary', computed_at: '2026-08-15T00:00:00Z', trigger: 'evidence' },
    { id: 3, persona: 'founder', displayed_slug: null, computed_at: '2026-09-01T00:00:00Z', trigger: 'scheduled' },
    { id: 5, persona: 'investor', displayed_slug: 'inv_thesis_backer', computed_at: '2026-09-25T00:00:00Z', trigger: 'answer' },
  ];
  assert.deepEqual(archetypeTimeline(items, 'founder').map((p) => [p.slug, p.at.slice(0, 10), p.first]),
    [['fo_missionary', '2026-08-01', true], ['fo_rocketeer', '2026-09-20', false]]);
  assert.equal(archetypeTimeline(items, 'founder')[1].label, 'The Rocketeer');
  assert.equal(archetypeTimeline(items).length, 3);
  assert.deepEqual(archetypeTimeline(null), []);
});

test('D602: the client asks the Worker route by its archetype list', () => {
  assert.match(read('frontend/src/lib/api.js'),
    /profilePublishedMembers: \(slugs\) =>\s*request\(`\/profile\/published-members\?archetypes=\$\{encodeURIComponent\(\(slugs \|\| \[\]\)\.join\(','\)\)\}`\)/);
});

test('D605: a match\'s values band reads as one line; null is not enough recorded, never aligned', async () => {
  const { valuesFitLine, VALUES_FIT_COPY } = await import('../src/lib/archetypeCardV2.js');
  assert.equal(valuesFitLine({ band: 'aligned', compared: 6 }), 'Values: aligned');
  assert.equal(valuesFitLine({ band: 'mixed', compared: 6 }), 'Values: some differences');
  assert.equal(valuesFitLine({ band: 'far_apart', compared: 6 }), 'Values: far apart');
  assert.equal(valuesFitLine({ band: null, compared: 1 }), 'Values: not enough recorded');
  assert.equal(valuesFitLine(null), null, 'no comparison (caller unpublished) draws no line');
  assert.equal(Object.keys(VALUES_FIT_COPY).length, 4);
  assert.doesNotMatch(Object.values(VALUES_FIT_COPY).join(' '), /advi[sc]e|recommend|fiduciary/i);
});
