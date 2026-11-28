/**
 * The main Worker's compatibility date must not fall behind (#9208).
 *
 * `wrangler.toml` (production) stood at `compatibility_date = "2026-04-01"`
 * for eight months while every sibling Worker in the repo root moved on.
 * This guard reads every root `wrangler*.toml` and fails when:
 *
 *   1. `wrangler.toml` and `wrangler.pr-preview.toml` carry different dates,
 *      so the preview would run a runtime production does not;
 *   2. the main Worker's date is older than the oldest sibling Worker's
 *      (`wrangler.meeting-bot.toml`, `wrangler.merge-control.toml`,
 *      `wrangler.agent-compute.toml`, and any later `wrangler.*.toml`).
 *
 * It compares the files with each other only, never with today's date, so it
 * cannot turn red on its own. The refresh rule it backs is
 * documentation/operations/DEPLOY.md § 2.4.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MAIN = 'wrangler.toml';
const PREVIEW = 'wrangler.pr-preview.toml';

/** Every `compatibility_date` assignment in a TOML text, with whether it sits
 *  before the first table header (a top-level key) or inside a table. */
function compatDates(text) {
  const found = [];
  let table = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    const header = /^\[\[?\s*([^\]]+?)\s*\]\]?$/.exec(line);
    if (header) { table = header[1]; continue; }
    const m = /^compatibility_date\s*=\s*"([^"]*)"$/.exec(line);
    if (m) found.push({ date: m[1], table });
    else if (/^compatibility_date\b/.test(line)) found.push({ date: null, table, raw: line });
  }
  return found;
}

const validDate = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)
  && !Number.isNaN(Date.parse(`${d}T00:00:00Z`))
  && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;

/** The problems in a set of root wrangler configs, `{ name: text }`. */
function compatProblems(files) {
  const problems = [];
  const dateOf = {};
  for (const [name, text] of Object.entries(files)) {
    const all = compatDates(text);
    const top = all.filter(e => e.table === null);
    if (top.length !== 1) { problems.push(`${name}: expected one top-level compatibility_date, found ${top.length}`); continue; }
    if (!validDate(top[0].date)) { problems.push(`${name}: compatibility_date ${JSON.stringify(top[0].date ?? top[0].raw)} is not a YYYY-MM-DD date`); continue; }
    for (const e of all.filter(x => x.table !== null)) {
      if (e.date !== top[0].date) problems.push(`${name}: [${e.table}] sets compatibility_date ${JSON.stringify(e.date ?? e.raw)}, the top level says ${top[0].date}`);
    }
    dateOf[name] = top[0].date;
  }
  const main = dateOf[MAIN];
  const preview = dateOf[PREVIEW];
  if (!(MAIN in files)) problems.push(`${MAIN} is missing`);
  if (!(PREVIEW in files)) problems.push(`${PREVIEW} is missing`);
  if (main && preview && main !== preview) problems.push(`${MAIN} says ${main} but ${PREVIEW} says ${preview}: they must carry the same date`);
  const siblings = Object.keys(files).filter(n => n !== MAIN && n !== PREVIEW);
  if (siblings.length === 0) problems.push('no sibling wrangler.*.toml found to compare against');
  const dated = siblings.filter(n => dateOf[n]).sort((a, b) => dateOf[a].localeCompare(dateOf[b]) || a.localeCompare(b));
  if (main && dated.length) {
    const oldest = dated[0];
    if (main < dateOf[oldest]) problems.push(`${MAIN} says ${main}, older than the oldest sibling ${oldest} (${dateOf[oldest]}): refresh it (DEPLOY.md § 2.4)`);
  }
  return problems;
}

const rootConfigs = () => Object.fromEntries(readdirSync(root)
  .filter(n => /^wrangler(\..+)?\.toml$/.test(n))
  .sort()
  .map(n => [n, readFileSync(resolve(root, n), 'utf8')]));

test('every root wrangler*.toml: main and preview agree, and the main Worker is not older than the oldest sibling', () => {
  const files = rootConfigs();
  assert.ok(Object.keys(files).length >= 5, `expected the main, preview and at least three sibling configs, read ${Object.keys(files).join(', ')}`);
  assert.deepEqual(compatProblems(files), []);
});

const toml = date => `name = "w"\nmain = "x.ts"\ncompatibility_date = "${date}"\n`;
const fixture = (main, preview, ...siblings) => ({
  [MAIN]: toml(main), [PREVIEW]: toml(preview),
  ...Object.fromEntries(siblings.map((d, i) => [`wrangler.s${i}.toml`, toml(d)])),
});

test('the configuration main carried before #9208 fails', () => {
  const p = compatProblems(fixture('2026-04-01', '2026-04-01', '2026-10-22', '2026-11-11', '2026-11-12'));
  assert.equal(p.length, 1);
  assert.match(p[0], /2026-04-01, older than the oldest sibling wrangler\.s0\.toml \(2026-10-22\)/);
});

test('main equal to the oldest sibling passes; newer than every sibling passes', () => {
  assert.deepEqual(compatProblems(fixture('2026-10-22', '2026-10-22', '2026-10-22', '2026-11-12')), []);
  assert.deepEqual(compatProblems(fixture('2026-12-01', '2026-12-01', '2026-10-22')), []);
});

test('main and preview on different dates fail, in either direction', () => {
  assert.match(compatProblems(fixture('2026-11-12', '2026-04-01', '2026-10-22')).join('\n'), /must carry the same date/);
  assert.match(compatProblems(fixture('2026-11-12', '2026-11-13', '2026-10-22')).join('\n'), /must carry the same date/);
});

test('an env table that overrides the date, a missing or malformed date, and no siblings all fail', () => {
  const files = fixture('2026-11-12', '2026-11-12', '2026-10-22');
  files[MAIN] += '\n[env.production]\ncompatibility_date = "2026-04-01"\n';
  assert.match(compatProblems(files).join('\n'), /\[env\.production\] sets compatibility_date "2026-04-01"/);
  assert.match(compatProblems({ ...fixture('2026-11-12', '2026-11-12', '2026-10-22'), [PREVIEW]: 'name = "p"\n' }).join('\n'), /wrangler\.pr-preview\.toml: expected one top-level compatibility_date, found 0/);
  assert.match(compatProblems(fixture('2026-13-40', '2026-13-40', '2026-10-22')).join('\n'), /is not a YYYY-MM-DD date/);
  assert.match(compatProblems(fixture('2026-11-12', '2026-11-12')).join('\n'), /no sibling/);
});
