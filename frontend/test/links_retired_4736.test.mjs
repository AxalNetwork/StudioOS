// #4736 — D2319 retired `/company-settings` and the `/account/companies…` addresses. Nothing in frontend/src may
// build a link to one, except the three Team and Compliance routes `routes/team.jsx` still mounts (and
// `settingsScope.js`, which matches the current address against the company's settings prefix for them).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]));
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '').replace(/\s\/\/\s.*$/, ''));
const LIVE = [
  /\/account\/companies\/\$\{[^}]+\}\/settings\/team\b/,
  /\/account\/companies\/\$\{[^}]+\}\/settings\/compliance\b/,
  /\/account\/companies\/\$\{[^}]+\}\/settings\/projects\/\$\{[^}]+\}\/team\b/,
  /request\('\/account\/companies'\)/, // GET /api/account/companies, an API path
  /path="\/account\/companies\/:uid\/settings\/(team|compliance|projects\/:id\/team)"/, // the mounts themselves
  /from '[^']*'|import\('[^']*'\)/, // a source path, not an address
];
const SCOPE_PREFIX = /\/account\/companies\/\$\{[^}]+\}\/settings(\/projects\/\$\{[^}]+\})?`/; // settingsScope.js only

test('no /company-settings or /account/companies link is built in frontend/src, bar the live Team and Compliance routes', () => {
  const bad = [];
  for (const f of walk('frontend/src').filter((x) => /\.(jsx?|mjs)$/.test(x))) {
    code(readFileSync(f, 'utf8')).forEach((line, i) => {
      if (!/\/account\/companies|\/company-settings/.test(line)) return;
      const stripped = line.replace(/data-testid=\{?[`"][^`"]*[`"]\}?|testId="[^"]*"/g, '');
      if (!/\/account\/companies|\/company-settings(?![-\w])/.test(stripped)) return;
      if (LIVE.some((re) => re.test(stripped))) return;
      if (f.endsWith('lib/settingsScope.js') && SCOPE_PREFIX.test(stripped)) return;
      bad.push(`${f}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
  }
  assert.deepEqual(bad, []);
});

test('the live exceptions are really mounted by routes/team.jsx', () => {
  const team = readFileSync('frontend/src/routes/team.jsx', 'utf8');
  for (const p of ['/account/companies/:uid/settings/team', '/account/companies/:uid/settings/projects/:id/team', '/account/companies/:uid/settings/compliance']) assert.ok(team.includes(`path="${p}"`), p);
});
