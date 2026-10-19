/**
 * D781 (#2106, D720's task Z1) — every page draws exactly one rail, with its
 * page key, its matrix row and its switch.
 *
 * THE PAGES are the canvas's own: each profile's sections and modules in
 * `design/incoming/airail-every-page-data/canvas.json`, keyed as D720 §5 keys
 * them, `<Profile> · <Section>` or `<Profile> · <Section> · <Module>`. That is
 * 204 keys: the 200 boards (F1–F42, I1–I27, A1–A28, P1–P27, S1–S39, H1–H37)
 * and the four homes the canvas lists as sections (Founder · Studio, and
 * Home for Investor, Advisor and Operating Partner).
 *
 * A PAGE IS DONE when all three of D720's parts reach it:
 *   · the page map (D768, #2092, `frontend/src/lib/railPages.js`) names its
 *     key, directly or in an alias row (D720 §11: an alias counts as covered);
 *   · the matrix (D764, #2089, `cloudflare-worker/src/services/ai/railMatrix.json`)
 *     has a row with that `pageKey`;
 *   · the rail draws the switch, "Turn off AI assistance on this page"
 *     (D769, #2088), which D720 §6 puts on every page.
 * A file that is not on this base yet reaches nothing, so on the day this
 * lands no page is done.
 *
 * A RATCHET (S1 on #2106). `NOT_YET` lists every page that is not done, under
 * the board task that finishes it (#2097 founder, #2098 investor, #2099
 * advisor and operating partner, #2100 admin, #2101 Super Admin). The test
 * fails on a page that is not done and not listed, and on a listed page that
 * is done: whoever finishes a page deletes its line, so the list only
 * shrinks. D781's closing PR empties it and adds the render check, each
 * mapped route drawing exactly one rail with its key in the DOM, which needs
 * the page map's routes.
 *
 * The rules are pure (`pageKeys`, `pageStatus`, `ratchet`) and are run here
 * on fixtures too, so each failure is shown to fire before the real modules
 * exist.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/airail_every_page_d781.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const at = (p) => resolve(ROOT, p);

const CANVAS = 'design/incoming/airail-every-page-data/canvas.json';
const PAGE_MAP = 'frontend/src/lib/railPages.js';
const MATRIX = 'cloudflare-worker/src/services/ai/railMatrix.json';
const RAIL = 'frontend/src/ui/WorkerRail.jsx';

/** D720 §6: the switch's words, drawn on every page. */
export const SWITCH_LINE = 'Turn off AI assistance on this page';

/** The task that finishes each profile's boards. */
export const BOARD_TASK = {
  Founder: 2097, Investor: 2098, Advisor: 2099, 'Operating Partner': 2099, Admin: 2100, 'Super Admin': 2101,
};

/** Every page key the canvas draws, in its order. */
export function pageKeys(profiles) {
  const keys = [];
  for (const [profile, sections] of Object.entries(profiles)) {
    for (const [section, modules] of Object.entries(sections)) {
      keys.push(`${profile} · ${section}`);
      for (const module of modules) keys.push(`${profile} · ${section} · ${module}`);
    }
  }
  return keys;
}

/** Every string inside a value: a module's exports, a JSON file. */
export function stringsIn(value, out = new Set(), seen = new Set()) {
  if (typeof value === 'string') { out.add(value); return out; }
  if (!value || typeof value !== 'object' || seen.has(value)) return out;
  seen.add(value);
  const items = value instanceof Map ? [...value.keys(), ...value.values()]
    : value instanceof Set ? [...value]
      : Array.isArray(value) ? value : Object.values(value);
  for (const v of items) stringsIn(v, out, seen);
  return out;
}

/** Whether one page is done, from what each part reaches. */
export function pageStatus(key, { mapped, rows, switchDrawn }) {
  const missing = [];
  if (!mapped.has(key)) missing.push('page map');
  if (!rows.has(key)) missing.push('matrix row');
  if (!switchDrawn) missing.push('switch');
  return { done: missing.length === 0, missing };
}

/** The ratchet's findings; empty when the list is exactly the pages not done. */
export function ratchet(keys, notYet, parts) {
  const listed = new Map();
  const problems = [];
  for (const [task, pages] of Object.entries(notYet)) {
    for (const key of pages) {
      if (listed.has(key)) problems.push(`${key}: listed twice`);
      listed.set(key, Number(task));
    }
  }
  const known = new Set(keys);
  for (const [key, task] of listed) {
    if (!known.has(key)) { problems.push(`${key}: listed, but the canvas has no such page`); continue; }
    const profile = key.split(' · ')[0];
    if (BOARD_TASK[profile] !== task) problems.push(`${key}: listed under #${task}; ${profile}'s boards are #${BOARD_TASK[profile]}`);
  }
  for (const key of keys) {
    const { done, missing } = pageStatus(key, parts);
    if (done && listed.has(key)) problems.push(`${key}: done, so delete it from NOT_YET`);
    if (!done && !listed.has(key)) problems.push(`${key}: no ${missing.join(', ')}, and not in NOT_YET`);
  }
  return problems;
}

/**
 * The pages that do not yet draw one rail with their page key, matrix row and
 * switch, under the task that finishes each. Delete a line when its page is
 * done; never add one.
 */
export const NOT_YET = {
  2097: [
  ],
  2098: [
  ],
  2099: [
  ],
  2100: [
  ],
  2101: [
  ],
};

async function repoParts() {
  let mapped = new Set();
  if (existsSync(at(PAGE_MAP))) {
    const mod = await import(pathToFileURL(at(PAGE_MAP)).href);
    mapped = stringsIn({ ...mod });
    for (const s of readFileSync(at(PAGE_MAP), 'utf8').matchAll(/(['"`])((?:(?!\1)[^\\\n])+)\1/g)) mapped.add(s[2]);
  }
  const rows = new Set();
  if (existsSync(at(MATRIX))) {
    const walk = (v) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') {
        if (typeof v.pageKey === 'string') rows.add(v.pageKey);
        Object.values(v).forEach(walk);
      }
    };
    walk(JSON.parse(readFileSync(at(MATRIX), 'utf8')));
  }
  const switchDrawn = existsSync(at(RAIL)) && readFileSync(at(RAIL), 'utf8').includes(SWITCH_LINE);
  return { mapped, rows, switchDrawn };
}

const KEYS = pageKeys(JSON.parse(readFileSync(at(CANVAS), 'utf8')).profiles);

test('the canvas draws 204 pages: the 200 boards and four homes, each key once', () => {
  assert.equal(KEYS.length, 204);
  assert.equal(new Set(KEYS).size, 204, 'no page key twice');
  const per = Object.fromEntries(Object.keys(BOARD_TASK).map((p) => [p, KEYS.filter((k) => k.split(' · ')[0] === p).length]));
  assert.deepEqual(per, { Founder: 43, Investor: 28, Advisor: 29, 'Operating Partner': 28, Admin: 39, 'Super Admin': 37 });
  for (const home of ['Founder · Studio', 'Investor · Home', 'Advisor · Home', 'Operating Partner · Home']) assert.ok(KEYS.includes(home), home);
});

test('every page draws one rail with its page key, matrix row and switch, or is listed, and no listed page is done', async () => {
  const problems = ratchet(KEYS, NOT_YET, await repoParts());
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('the list only names the five board tasks, each with its profile', () => {
  assert.deepEqual(Object.keys(NOT_YET).map(Number).sort(), [2097, 2098, 2099, 2100, 2101]);
});

// The ratchet on fixtures: each failure fires, so the real check above means something.
const ALL = (keys) => ({ mapped: new Set(keys), rows: new Set(keys), switchDrawn: true });

test('fixtures: a page with all three parts is done; any one missing keeps it listed', () => {
  const key = 'Founder · Validate';
  assert.deepEqual(pageStatus(key, ALL([key])), { done: true, missing: [] });
  assert.deepEqual(pageStatus(key, { ...ALL([key]), mapped: new Set() }).missing, ['page map']);
  assert.deepEqual(pageStatus(key, { ...ALL([key]), rows: new Set() }).missing, ['matrix row']);
  assert.deepEqual(pageStatus(key, { ...ALL([key]), switchDrawn: false }).missing, ['switch']);
});

test('fixtures: a page that drops its rail and is not listed fails', () => {
  const keys = ['Founder · Studio', 'Founder · Validate'];
  assert.deepEqual(ratchet(keys, {}, ALL(keys)), []);
  const dropped = { ...ALL(keys), mapped: new Set(['Founder · Studio']) };
  assert.deepEqual(ratchet(keys, {}, dropped), ['Founder · Validate: no page map, and not in NOT_YET']);
});

test('fixtures: a listed page that is done fails, so the list only shrinks', () => {
  const keys = ['Admin · Accounts'];
  assert.deepEqual(ratchet(keys, { 2100: ['Admin · Accounts'] }, ALL(keys)), ['Admin · Accounts: done, so delete it from NOT_YET']);
  assert.deepEqual(ratchet(keys, { 2100: ['Admin · Accounts'] }, { ...ALL(keys), switchDrawn: false }), []);
});

test('fixtures: a stray, doubled or misfiled line fails', () => {
  const keys = ['Investor · Home'];
  const none = { mapped: new Set(), rows: new Set(), switchDrawn: false };
  assert.deepEqual(ratchet(keys, { 2098: ['Investor · Home', 'Investor · Nowhere'] }, none), ['Investor · Nowhere: listed, but the canvas has no such page']);
  assert.deepEqual(ratchet(keys, { 2098: ['Investor · Home'], 2101: ['Investor · Home'] }, none), [
    'Investor · Home: listed twice', "Investor · Home: listed under #2101; Investor's boards are #2098",
  ]);
});

test('fixtures: an alias row counts as covered, and the matrix is read wherever its rows sit', () => {
  const mapped = stringsIn({ ALIASES: [{ route: '/admin/exploring', pageKey: 'Admin · Accounts · Exploring members', aliasOf: 'Admin · Approvals' }] });
  assert.ok(mapped.has('Admin · Accounts · Exploring members'));
  assert.ok(stringsIn(new Map([['/x', { key: 'Super Admin · Licences' }]])).has('Super Admin · Licences'));
});
