/**
 * D554 — Dependabot's labels are declared, and three ROUTE_MAP rows stop
 * calling finished work open.
 *
 * On 2026-10-05 Dependabot opened ten PRs and could not apply `deps`, `ci`,
 * `frontend`, `worker`, `production` or `dev-backend`: dependabot.yml names
 * them and labels.yml did not, so labels-sync never created them.
 *
 * The same day three ROUTE_MAP status cells still listed work that had
 * shipped: the AI rail's per-user reads, the founder's Friday retro and
 * per-page draft attribution (D510), and the investor model card, estimate
 * and receipt (D400/D402, RunEstimate, ZoneDraft).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

function declaredNames(src) {
  return [...src.matchAll(/^- name: "([^"]+)"/gm)].map((m) => m[1]);
}

function dependabotLabels(src) {
  const names = new Set();
  for (const m of src.matchAll(/labels:\s*\[([^\]]+)\]/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().replace(/^['"]|['"]$/g, '');
      if (name) names.add(name);
    }
  }
  return [...names];
}

function row(src, canvas) {
  const line = src.split('\n').find((l) => l.startsWith(`| ${canvas} |`));
  assert.ok(line, `ROUTE_MAP has no row for ${canvas}`);
  return line;
}

test('every label dependabot.yml asks for is declared in labels.yml', () => {
  const asked = dependabotLabels(read('.github/dependabot.yml'));
  const declared = new Set(declaredNames(read('.github/labels.yml')));
  const missing = asked.filter((n) => !declared.has(n));
  assert.deepEqual(missing, [],
    `labels-sync creates only what labels.yml declares, so Dependabot cannot apply: ${missing.join(', ')}`);
  assert.ok(asked.length >= 6, 'the reader missed dependabot.yml labels');
});

test('labels.yml says it also holds Dependabot\'s labels', () => {
  const head = read('.github/labels.yml').split('\n').slice(0, 6).join('\n');
  assert.match(head, /Dependabot/, 'the file opens on the task-protocol labels and never says it holds Dependabot\'s');
});

test('the AIRail row names the three mounted reads and does not call them missing', () => {
  const line = row(read('documentation/architecture/ROUTE_MAP.md'), 'AIRail');
  assert.match(line, /GET \/api\/ai\/me\/spend/);
  assert.match(line, /GET \/api\/ai\/pricing/);
  assert.match(line, /POST \/api\/ai\/workspace\/explain/);
  assert.match(line, /does not treat them as missing/);
  assert.doesNotMatch(line, /no per-user rail endpoint/);
});

test('the founder workspace row records the Friday retro and page attribution as done', () => {
  const line = row(read('documentation/architecture/ROUTE_MAP.md'), 'Founder Workspaces Canvas');
  assert.match(line, /D510/);
  assert.match(line, /build\/retro/);
  assert.doesNotMatch(line, /zone-draft route sends none/);
  assert.doesNotMatch(line, /Friday retro draft \(a `DRAFT_SURFACES` entry\)/);
});

test('the investor LP row records the model card, estimate and receipt as done', () => {
  const line = row(read('documentation/architecture/ROUTE_MAP.md'), 'Investor LP Canvas');
  assert.match(line, /D400, D402/);
  assert.match(line, /RunEstimate\.jsx/);
  assert.match(line, /ZoneDraft/);
  assert.doesNotMatch(line, /no investor surface is registered/);
  assert.match(line, /locked states for the Institutional Fund row/);
});
