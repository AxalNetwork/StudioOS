// #4736 — every file directly in frontend/src/pages/studio/ is named in its README, and the lightbox is the
// "Artifact map" everywhere, not "the module map" (#4551).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const dir = 'frontend/src/pages/studio';
const readme = readFileSync(`${dir}/README.md`, 'utf8');

test('every .jsx and .js file in the Studio folder is named in its README', () => {
  const files = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && /\.(jsx?|css)$/.test(e.name)).map((e) => e.name);
  assert.ok(files.includes('StudioArtifactMark.jsx'));
  assert.deepEqual(files.filter((f) => !readme.includes(`\`${f}\``)), []);
});

test('the lightbox is the Artifact map: the README and StudioModules.jsx no longer say "module map"', () => {
  assert.doesNotMatch(readme, /module map/i);
  assert.doesNotMatch(readFileSync(`${dir}/StudioModules.jsx`, 'utf8').split('\n').slice(0, 12).join('\n'), /module map/i);
  assert.match(readFileSync(`${dir}/StudioArtifactMark.jsx`, 'utf8'), /^\/\*\*/, 'a header comment');
});
