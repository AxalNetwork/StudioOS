/**
 * Build queue #128 — DD checklist catalog integrity tests.
 *
 * Pins the CHECKLIST_CATALOG shape so a catalog edit can't silently
 * break case seeding (routes/dd.ts POST /cases relies on unique keys +
 * valid section references) or invert the depth tiers. No D1 / auth —
 * the route layer is thin plumbing over these pure functions.
 *
 * Run via the strip-types loader:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/dd_checklists_requests.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SECTION_CATALOG,
  CHECKLIST_CATALOG,
  DEPTH_RANK,
  checklistFor,
  sectionsFor,
  type DDSubjectType,
  type ChecklistDepth,
} from '../src/services/dueDiligence.ts';

const DEPTHS: ChecklistDepth[] = ['lite', 'standard', 'deep'];
const SUBJECTS: DDSubjectType[] = ['project', 'founder', 'advisor', 'investor', 'partner'];

test('catalog keys are unique and namespaced under their section', () => {
  const seen = new Set<string>();
  for (const it of CHECKLIST_CATALOG) {
    assert.ok(!seen.has(it.key), `duplicate item key: ${it.key}`);
    seen.add(it.key);
    assert.ok(it.key.startsWith(`${it.section_key}.`), `item key ${it.key} not namespaced under ${it.section_key}`);
    assert.ok(it.key.length > it.section_key.length + 1, `item key ${it.key} has an empty slug`);
    assert.ok(it.title.trim().length > 0, `item ${it.key} has an empty title`);
  }
});

test('every item references a real section and a valid depth', () => {
  const sectionKeys = new Set(SECTION_CATALOG.map(s => s.key));
  for (const it of CHECKLIST_CATALOG) {
    assert.ok(sectionKeys.has(it.section_key), `item ${it.key} references unknown section ${it.section_key}`);
    assert.ok(DEPTHS.includes(it.depth), `item ${it.key} has invalid depth ${it.depth}`);
  }
});

test('every section carries at least one lite item', () => {
  // Even the lightest template must touch every applicable section —
  // otherwise a lite case seeds a section with zero checklist items.
  for (const s of SECTION_CATALOG) {
    const lite = CHECKLIST_CATALOG.filter(i => i.section_key === s.key && i.depth === 'lite');
    assert.ok(lite.length >= 1, `section ${s.key} has no lite items`);
  }
});

test('depth tiers are cumulative and strictly growing for every subject type', () => {
  for (const subject of SUBJECTS) {
    const lite = checklistFor(subject, 'lite');
    const standard = checklistFor(subject, 'standard');
    const deep = checklistFor(subject, 'deep');
    assert.ok(lite.length > 0, `${subject}: lite template is empty`);
    assert.ok(lite.length < standard.length, `${subject}: standard must add items over lite`);
    assert.ok(standard.length < deep.length, `${subject}: deep must add items over standard`);
    // Cumulative: every shallower item appears at the deeper tier.
    const stdKeys = new Set(standard.map(i => i.key));
    const deepKeys = new Set(deep.map(i => i.key));
    for (const i of lite) assert.ok(stdKeys.has(i.key), `${subject}: lite item ${i.key} missing from standard`);
    for (const i of standard) assert.ok(deepKeys.has(i.key), `${subject}: standard item ${i.key} missing from deep`);
  }
});

test('checklistFor only emits sections that apply to the subject type', () => {
  for (const subject of SUBJECTS) {
    const applicable = new Set(sectionsFor(subject).map(s => s.key));
    for (const i of checklistFor(subject, 'deep')) {
      assert.ok(applicable.has(i.section_key), `${subject}: item ${i.key} from non-applicable section ${i.section_key}`);
    }
  }
});

test('DEPTH_RANK orders lite < standard < deep', () => {
  assert.ok(DEPTH_RANK.lite < DEPTH_RANK.standard);
  assert.ok(DEPTH_RANK.standard < DEPTH_RANK.deep);
});

test('partner deep template includes the KYB/KYC/accreditation stack', () => {
  const keys = new Set(checklistFor('partner', 'deep').map(i => i.section_key));
  assert.ok(keys.has('kyb_entity'));
  assert.ok(keys.has('kyc_individual'));
  assert.ok(keys.has('accreditation'));
  // ...and a project case never sees them.
  const projectKeys = new Set(checklistFor('project', 'deep').map(i => i.section_key));
  assert.ok(!projectKeys.has('kyb_entity'));
  assert.ok(!projectKeys.has('kyc_individual'));
});
