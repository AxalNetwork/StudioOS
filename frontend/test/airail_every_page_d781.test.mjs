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
 * landed no page was done. D768 (#2133) then named all 204 keys at once,
 * beside the matrix and the switch already on main, so every page passes
 * these three checks and every list is empty (S1, 2026-10-19). Which of
 * M1–M5's pages really draw their rail is part 2's render check to tell.
 *
 * A RATCHET (S1 on #2106). `NOT_YET` lists every page that is not done, under
 * the board task that finishes it (#2097 founder, #2098 investor, #2099
 * advisor and operating partner, #2100 admin, #2101 Super Admin). The test
 * fails on a page that is not done and not listed, and on a listed page that
 * is done: whoever finishes a page deletes its line, so the list only
 * shrinks.
 *
 * PART 2 (S1 on #2106, 2026-10-19) renders: each route in the page map,
 * mounted in the real App as a member of its profile, draws exactly one rail
 * with its page key in the DOM, or is listed in `RENDER_NOT_YET` under the
 * task that wires it. The harness and the list are `_airailRender.mjs`; the
 * six `airail_render_*_d781.test.mjs` files render; this file holds its rules
 * to fixtures, below.
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
import { RENDER_NOT_YET, renderCases, renderRatchet, renderStatus } from './_airailRender.mjs';

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
  // Every page passed the three checks once D768 (#2133) named all 204 keys.
  2097: [],
  2098: [],
  2099: [],
  2100: [],
  2101: [],
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
  // The owner removed the editor on 2026-10-21; frozen canvas keys stay historical.
  const retired = new Set(['Admin · Programs · Assessment runs', 'Super Admin · Content · Assessment Studio']);
  const problems = ratchet(KEYS.filter((key) => !retired.has(key)), NOT_YET, await repoParts());
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

// ── Part 2: the render check's rules, on fixtures ───────────────────────────
// The six `airail_render_*_d781.test.mjs` files render App at every route in
// the page map and judge each with these rules (`_airailRender.mjs`). Each
// failure is shown to fire here, on drawings a fixture describes.

const drawn = (state, keys, landed, expected) => ({ state, keys, rails: keys.length, landed, expected });
const FOUNDER_VALIDATE = 'Founder · Validate';

test('render fixtures: one rail with the landed page\'s key passes; none, two, or another key fails', () => {
  assert.deepEqual(renderStatus([drawn('down', [FOUNDER_VALIDATE], '/validate', FOUNDER_VALIDATE)]), { pass: true, why: [] });
  assert.deepEqual(renderStatus([drawn('down', [], '/validate', FOUNDER_VALIDATE), drawn('empty', [], '/validate', FOUNDER_VALIDATE)]),
    { pass: false, why: ['down: no rail at /validate', 'empty: no rail at /validate'] });
  assert.deepEqual(renderStatus([drawn('down', [FOUNDER_VALIDATE, FOUNDER_VALIDATE], '/validate', FOUNDER_VALIDATE)]).why, ['down: 2 rails']);
  assert.deepEqual(renderStatus([drawn('down', [null], '/validate', FOUNDER_VALIDATE)]).why,
    ['down: a rail keyed null at /validate, which is "Founder · Validate"']);
});

test('render fixtures: a later state can pass a route, but a wrong rail in any state fails it', () => {
  assert.equal(renderStatus([drawn('down', [], '/studio', 'Founder · Studio'), drawn('empty', ['Founder · Studio'], '/studio', 'Founder · Studio')]).pass, true);
  const wrong = renderStatus([drawn('down', ['Founder · Build'], '/studio', 'Founder · Studio'), drawn('empty', ['Founder · Studio'], '/studio', 'Founder · Studio')]);
  assert.equal(wrong.pass, false);
  // A redirect is judged where it lands: the key expected is the target's.
  assert.equal(renderStatus([drawn('down', ['Founder · Build'], '/build', 'Founder · Build')]).pass, true);
});

test('render fixtures: the ratchet holds the list to exactly the routes that do not pass', () => {
  const pages = {
    Founder: [{ route: '/validate', key: FOUNDER_VALIDATE }, { route: '/messages', key: 'Founder · Messages', offCanvas: true }],
    Admin: [{ route: '/admin/held/accounts', key: 'Admin · Accounts' }],
  };
  const cases = renderCases(pages);
  assert.deepEqual(cases.map((c) => c.name), ['Founder /validate', 'Founder /messages', 'Admin /admin/held/accounts']);
  const pass = { pass: true, why: [] };
  const fail = { pass: false, why: ['down: no rail at /messages'] };
  const verdicts = new Map([['Founder /validate', pass], ['Founder /messages', fail], ['Admin /admin/held/accounts', pass]]);
  assert.deepEqual(renderRatchet(cases, { offCanvas: ['Founder /messages'] }, verdicts), []);
  // Not listed and failing.
  assert.deepEqual(renderRatchet(cases, {}, verdicts), ['Founder /messages: down: no rail at /messages, and not in RENDER_NOT_YET']);
  // Listed and passing: the list only shrinks.
  assert.deepEqual(renderRatchet(cases, { offCanvas: ['Founder /messages'], 2097: ['Founder /validate'] }, verdicts),
    ['Founder /validate: draws its rail now, so delete it from RENDER_NOT_YET']);
  // Misfiled, doubled, or naming no route.
  assert.deepEqual(renderRatchet(cases, { 2097: ['Founder /messages'] }, verdicts), ['Founder /messages: listed under 2097; it belongs under offCanvas']);
  assert.deepEqual(renderRatchet(cases, { offCanvas: ['Founder /messages', 'Founder /messages'] }, verdicts), ['Founder /messages: listed twice']);
  assert.deepEqual(renderRatchet(cases, { offCanvas: ['Founder /messages'], 2097: ['Founder /nowhere'] }, verdicts),
    ['Founder /nowhere: listed, but the page map has no such route']);
  // A profile's run judges its own lines only.
  const founder = cases.filter((c) => c.profile === 'Founder');
  assert.deepEqual(renderRatchet(founder, { offCanvas: ['Founder /messages'], 2100: ['Admin /admin/held/accounts'] }, verdicts, (n) => n.startsWith('Founder ')), []);
});

test('the render list names the five board tasks and the off-canvas pages, each route under its owner', () => {
  assert.deepEqual(Object.keys(RENDER_NOT_YET).sort(), ['2097', '2098', '2099', '2100', '2101', 'offCanvas']);
  const cases = renderCases();
  const names = new Set(cases.map((c) => c.name));
  const listed = Object.values(RENDER_NOT_YET).flat();
  assert.equal(new Set(listed).size, listed.length, 'no route listed twice');
  for (const n of listed) assert.ok(names.has(n), `${n} is a route in the page map`);
  // Every verdict a pass: the rest of the ratchet is the render files'.
  const verdicts = new Map(cases.map((c) => [c.name, { pass: !listed.includes(c.name), why: ['listed'] }]));
  assert.deepEqual(renderRatchet(cases, RENDER_NOT_YET, verdicts), []);
});
