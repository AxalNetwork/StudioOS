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
    "Founder · Studio",
    "Founder · Validate",
    "Founder · Validate · Problem discovery",
    "Founder · Validate · Customer research",
    "Founder · Validate · Ideal customer profile",
    "Founder · Validate · Market intelligence",
    "Founder · Validate · Demand and urgency signals",
    "Founder · Validate · Experiments and evidence",
    "Founder · Validate · Verdict",
    "Founder · Build",
    "Founder · Build · Solution design",
    "Founder · Build · Prototype / MVP",
    "Founder · Build · Product roadmap",
    "Founder · Build · Founding team",
    "Founder · Build · Company creation",
    "Founder · Build · Operating systems",
    "Founder · Raise",
    "Founder · Raise · Fundraising readiness",
    "Founder · Raise · Investor narrative",
    "Founder · Raise · Pitch deck",
    "Founder · Raise · Data room",
    "Founder · Raise · Cap table",
    "Founder · Raise · Use of funds",
    "Founder · Raise · Capital relationships",
    "Founder · Grow",
    "Founder · Grow · Product improvement",
    "Founder · Grow · Distribution",
    "Founder · Grow · Revenue and traction",
    "Founder · Grow · Team expansion",
    "Founder · Grow · Partner network",
    "Founder · Grow · Market expansion",
    "Founder · Grow · Durable company-building",
    "Founder · Network",
    "Founder · Network · Relationships",
    "Founder · Network · Introductions",
    "Founder · Network · Organizations",
    "Founder · Research",
    "Founder · Research · Ask",
    "Founder · Research · Markets",
    "Founder · Research · Geographies",
    "Founder · Research · Companies",
    "Founder · Research · Funds",
    "Founder · Research · Library",
  ],
  2098: [
    "Investor · Home",
    "Investor · Deals",
    "Investor · Deals · Pipeline",
    "Investor · Deals · Screening",
    "Investor · Deals · Commit",
    "Investor · Deals · Closing",
    "Investor · Portfolio",
    "Investor · Portfolio · Positions",
    "Investor · Portfolio · Performance",
    "Investor · Portfolio · Updates",
    "Investor · Portfolio · Value-add",
    "Investor · Axal VC Fund",
    "Investor · Fund",
    "Investor · Fund · Overview",
    "Investor · Fund · LPs",
    "Investor · Fund · Capital calls",
    "Investor · Fund · Distributions",
    "Investor · Fund · Reporting",
    "Investor · Network",
    "Investor · Network · Relationships",
    "Investor · Network · Introductions",
    "Investor · Network · Organizations",
    "Investor · Research",
    "Investor · Research · Ask",
    "Investor · Research · Diligence",
    "Investor · Research · Benchmarking",
    "Investor · Research · Markets",
    "Investor · Research · Library",
  ],
  2099: [
    "Advisor · Home",
    "Advisor · Practice",
    "Advisor · Practice · Opportunities",
    "Advisor · Practice · Engagements",
    "Advisor · Practice · Delivery",
    "Advisor · Practice · Sessions",
    "Advisor · Practice · Earnings",
    "Advisor · Cohorts",
    "Advisor · Cohorts · Founders",
    "Advisor · Cohorts · Guidance",
    "Advisor · Cohorts · This week",
    "Advisor · Cohorts · Calendar",
    "Advisor · Cohorts · Outcomes",
    "Advisor · Expertise",
    "Advisor · Expertise · Profile",
    "Advisor · Expertise · Services",
    "Advisor · Expertise · Proof",
    "Advisor · Expertise · Thinking",
    "Advisor · Expertise · Visibility",
    "Advisor · Network",
    "Advisor · Network · Relationships",
    "Advisor · Network · Introductions",
    "Advisor · Network · Organizations",
    "Advisor · Research",
    "Advisor · Research · Ask",
    "Advisor · Research · Client prep",
    "Advisor · Research · Markets",
    "Advisor · Research · Companies",
    "Advisor · Research · Library",
    "Operating Partner · Home",
    "Operating Partner · Pipeline",
    "Operating Partner · Pipeline · Leads",
    "Operating Partner · Pipeline · Proposals",
    "Operating Partner · Pipeline · Negotiations",
    "Operating Partner · Pipeline · Retainers",
    "Operating Partner · Pipeline · Analytics",
    "Operating Partner · Delivery",
    "Operating Partner · Delivery · Engagements",
    "Operating Partner · Delivery · Deliverables",
    "Operating Partner · Delivery · Capacity",
    "Operating Partner · Delivery · Reporting",
    "Operating Partner · Delivery · Health",
    "Operating Partner · Offers",
    "Operating Partner · Offers · Catalog",
    "Operating Partner · Offers · Perk deals",
    "Operating Partner · Offers · Visibility",
    "Operating Partner · Offers · Proof",
    "Operating Partner · Offers · Audience fit",
    "Operating Partner · Network",
    "Operating Partner · Network · Relationships",
    "Operating Partner · Network · Introductions",
    "Operating Partner · Network · Organizations",
    "Operating Partner · Research",
    "Operating Partner · Research · Ask",
    "Operating Partner · Research · Client prep",
    "Operating Partner · Research · Market",
    "Operating Partner · Research · Library",
  ],
  2100: [
    "Admin · Accounts",
    "Admin · Accounts · Users",
    "Admin · Accounts · Exploring members",
    "Admin · Accounts · Trash",
    "Admin · Approvals",
    "Admin · Approvals · Identity checks",
    "Admin · Approvals · Entity profiles",
    "Admin · Approvals · LP applications",
    "Admin · Approvals · Referrals",
    "Admin · Approvals · Best fit",
    "Admin · Approvals · Due diligence",
    "Admin · Approvals · Spin-Out applications",
    "Admin · Approvals · Spin-Out moderation",
    "Admin · Approvals · Exploring members",
    "Admin · Approvals · Events",
    "Admin · Approvals · Jobs",
    "Admin · Approvals · Communities",
    "Admin · Approvals · Advisor cohort access",
    "Admin · Programs",
    "Admin · Programs · Spin-Out Lab",
    "Admin · Programs · Advisor cohorts",
    "Admin · Programs · Assessment runs",
    "Admin · Programs · Profiling trends",
    "Admin · Community",
    "Admin · Community · Events",
    "Admin · Community · Jobs",
    "Admin · Community · Communities",
    "Admin · Community · Wellbeing experts",
    "Admin · Community · Advisors and partners",
    "Admin · Community · Directory",
    "Admin · Community · Partner invitations",
    "Admin · Contracts",
    "Admin · Contracts · Agreements",
    "Admin · Contracts · NDAs",
    "Admin · Contracts · Partner deals",
    "Admin · Contracts · Templates",
    "Admin · Contracts · Forms",
    "Admin · Insights",
    "Admin · Settings",
  ],
  2101: [
    "Super Admin · Licences",
    "Super Admin · Funds",
    "Super Admin · Contracts",
    "Super Admin · Contracts · Agreements",
    "Super Admin · Contracts · NDAs",
    "Super Admin · Contracts · Partner deals",
    "Super Admin · Contracts · Templates",
    "Super Admin · Contracts · Forms",
    "Super Admin · Contracts · Document types",
    "Super Admin · Team",
    "Super Admin · Team · Users",
    "Super Admin · Revenue",
    "Super Admin · Revenue · Overview",
    "Super Admin · Revenue · Disputes",
    "Super Admin · Revenue · Refunds",
    "Super Admin · Revenue · Statements",
    "Super Admin · Revenue · Promotions",
    "Super Admin · Content",
    "Super Admin · Content · Content queue",
    "Super Admin · Content · Publications",
    "Super Admin · Content · Assessment Studio",
    "Super Admin · Content · Personas",
    "Super Admin · Content · Advisors and partners",
    "Super Admin · Content · Directory",
    "Super Admin · Content · Public team page",
    "Super Admin · Platform",
    "Super Admin · Platform · Integration keys",
    "Super Admin · Platform · GitHub sync",
    "Super Admin · Platform · Payments catalogue",
    "Super Admin · Platform · Promo codes",
    "Super Admin · Platform · Credit rules",
    "Super Admin · Platform · AI allowances",
    "Super Admin · Platform · Monitoring",
    "Super Admin · Platform · Telegram channels",
    "Super Admin · Support",
    "Super Admin · Security",
    "Super Admin · Settings",
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
