// D1088 (#2953, Notion part 4 of #2405) — From Notion on Build's three modules:
// each `notion` line in buildParts.jsx mounts the shared part for its own module.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/notion_build_d1088.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BUILD_PARTS } from '../src/pages/cycles/buildParts.jsx';

const SRC = readFileSync(new URL('../src/pages/cycles/buildParts.jsx', import.meta.url), 'utf8');

test('each Build module that Notion feeds draws From Notion for that module, in the build section', () => {
  for (const [slug, module] of [['solution-design', 'solution_design'], ['prototype-mvp', 'prototype_mvp'], ['product-roadmap', 'product_roadmap']]) {
    const entry = BUILD_PARTS[slug].find(([key]) => key === 'notion');
    assert.ok(entry && typeof entry[1] === 'function', `${slug} draws Notion's part`);
    const el = entry[1]({}, { projectId: 7 });
    assert.deepEqual([el.props.section, el.props.module, el.props.projectId], ['build', module, 7], slug);
  }
  assert.equal((SRC.match(/<FromNotion section="build"/g) || []).length, 3, 'three mounts, no more');
  assert.ok(!BUILD_PARTS['operating-systems'].some(([key]) => key === 'notion'), 'Notion feeds no other Build module');
});
