import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { transformWithOxc } from 'vite';
import { SourcedFrom } from '../src/pages/PitchPositioningPage.jsx';
const render = (sourced, Component = SourcedFrom) => renderToStaticMarkup(React.createElement(Component, { sourced }));
function verify(Component = SourcedFrom) {
  assert.match(render({ team: 0, team_status: 'not_recorded' }, Component), /No team recorded/);
  assert.match(render({ team: null, team_status: 'unreadable' }, Component), /Team unreadable/);
  assert.doesNotMatch(render({ team: null, team_status: 'unreadable' }, Component), /No team recorded/);
  assert.match(render({ team: 1, team_status: 'recorded' }, Component), /1 team member</);
  assert.match(render({ team: 3, team_status: 'recorded' }, Component), /3 team members</);
  assert.doesNotMatch(render({ team: 3, team_status: 'recorded' }, Component), /3 founders/);
}
test('positioning distinguishes absent, unreadable and recorded team members', () => verify());
let variant = 0;
async function changed(before, after) {
  const url = new URL('../src/pages/PitchPositioningPage.jsx', import.meta.url);
  const source = readFileSync(url, 'utf8'); assert.ok(source.includes(before));
  let { code } = await transformWithOxc(source.replace(before, after), fileURLToPath(url), { jsx: { runtime: 'automatic' } });
  code = code.replace(/^((?:import\s+[^'";]+|export\s*\{[^}]*\})\s+from\s*['"])([^'"]+)(['"])/gm,
    (_m, prefix, spec, quote) => {
      let resolved;
      if (spec.startsWith('.')) {
        const base = new URL(spec, url);
        resolved = ['.js', '.jsx', '.mjs', '/index.js', ''].map((suffix) => new URL(base.href + suffix)).find((candidate) => existsSync(fileURLToPath(candidate))).href;
      } else resolved = import.meta.resolve(spec);
      return prefix + resolved + quote;
    });
  return (await import('data:text/javascript;base64,' + Buffer.from(code + '\n// #2435 variant ' + ++variant).toString('base64'))).SourcedFrom;
}
for (const [label, before, after] of [
  ['missing record copy', "'No team recorded'", "'No team data'"],
  ['unreadable state', "sourced.team_status === 'unreadable' || sourced.team === null", 'false'],
  ['recorded member label', ' team member${', ' founder${'],
]) test('team display mutation: ' + label, async () => {
  verify(); const Component = await changed(before, after);
  assert.throws(() => verify(Component), { code: 'ERR_ASSERTION' }); verify();
});
