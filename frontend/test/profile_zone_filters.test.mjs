/**
 * The other half of the zone header row: every canvas filter is accounted for,
 * and each one either narrows real rows or says what is missing.
 *
 * `profile_zone_actions.test.mjs` guards the `ops:` array on the right of that
 * row. This guards the `filters:` array on the left, and it exists because the
 * failure mode is quieter. An action nothing performs at least does nothing
 * visible. A filter nothing backs returns an EMPTY SET, and an empty set reads
 * as an answer: `/grow/customers` shipped a live "Stalled" chip whose predicate
 * was `return []`, so clicking it said "you have no stalled accounts" when the
 * truth was that no store records activity at all. That is the product's
 * central rule — absent is not empty — failing where the failure looks like
 * data, which is the only place it really costs anything.
 *
 * WHY IT READS THE MODULE AND NOT THE SOURCE TEXT. Its sibling regexes the
 * table out of the file because `founderZoneActions.js` cannot be imported by
 * Node. This table can, so it is, and the assertions run against the real
 * structure rather than a parser that agrees with it on a good day.
 *
 * Run with:
 *   node --test frontend/test/profile_zone_filters.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeOnly } from './_codeOnly.mjs';
import { FOUNDER_ZONE_FILTERS, founderZoneFilters } from '../src/workspaces/founderZoneFilters.js';
import { canvasFilterLabels, groupFilterNotes } from '../src/workspaces/zoneFilterBuilder.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');

const PROFILES = {
  founder: {
    table: FOUNDER_ZONE_FILTERS,
    build: founderZoneFilters,
    canvas: /^Pages · Founder (Build|Raise|Grow)\.dc\.html$/,
    zones: 18,
  },
};

/** Every matching artboard's route and its `filters:` labels, from the canvas. */
function canvasFilters(profile) {
  const out = {};
  for (const file of readdirSync(resolve(root, 'design/canvases/integrated')).filter((f) => profile.canvas.test(f))) {
    const src = read(`design/canvases/integrated/${file}`);
    for (const chunk of src.split(/route:\s*'/).slice(1)) {
      const route = chunk.slice(0, chunk.indexOf("'"));
      const filters = chunk.match(/filters:\s*fil\(\[([^\]]*)\]/);
      if (!filters) continue;
      out[route.replace(/^\//, '')] = filters[1]
        .split(',')
        .map((one) => one.trim().replace(/^'|'$/g, ''))
        .filter(Boolean);
    }
  }
  return out;
}

for (const [name, profile] of Object.entries(PROFILES)) {
  test(`${name}: every artboard's filters are accounted for, in canvas order`, () => {
    const canvas = canvasFilters(profile);
    const zones = Object.keys(profile.table);
    assert.equal(zones.length, profile.zones, 'the table gained or lost a zone');
    for (const zone of zones) {
      assert.ok(canvas[zone], `${zone} has no artboard — where did its labels come from?`);
      assert.deepEqual(
        canvasFilterLabels(profile.table, zone),
        canvas[zone],
        `${zone} does not match its artboard's filters`,
      );
    }
    for (const route of Object.keys(canvas)) {
      assert.ok(profile.table[route], `${route} has artboard filters this table does not cover`);
    }
  });

  test(`${name}: an entry is a live key, a stated reason, or a dynamic group — never two`, () => {
    for (const [zone, rows] of Object.entries(profile.table)) {
      for (const row of rows) {
        const kinds = [row.key ? 'key' : null, row.dynamic ? 'dynamic' : null,
          !row.key && !row.dynamic && row.note ? 'note' : null].filter(Boolean);
        assert.equal(kinds.length, 1, `${zone} · ${row.canvas} is ${kinds.length} things at once`);
        if (row.key) assert.ok(!row.note, `${zone} · ${row.canvas} is live and would never show its note`);
        if (!row.key) assert.ok(row.note, `${zone} · ${row.canvas} states no reason`);
      }
    }
  });

  test(`${name}: a stated reason says what is missing, not that something is`, () => {
    // "Unavailable", "not supported", "coming soon" name no absent record, so a
    // reader learns nothing they could act on. Every note here has to point at
    // the thing that does not exist.
    const EMPTY = /\b(unavailable|not supported|unsupported|coming soon|n\/a|tbd)\b/i;
    for (const [zone, rows] of Object.entries(profile.table)) {
      for (const row of rows) {
        if (!row.note) continue;
        assert.ok(!EMPTY.test(row.note), `${zone} · ${row.canvas} says nothing: "${row.note}"`);
        assert.ok(row.note.length > 25, `${zone} · ${row.canvas} is too short to be a reason`);
        // It renders after an em dash, so it is a clause and not a sentence.
        assert.ok(/^[a-z]/.test(row.note), `${zone} · ${row.canvas} reads as a sentence, not a clause`);
        assert.ok(!/\.$/.test(row.note), `${zone} · ${row.canvas} ends in a full stop`);
      }
    }
  });

  test(`${name}: a sample figure from the artboard is never printed as fact`, () => {
    // `All 14`, `All 14 mo` and `Aug 2026` are that artboard's mock data. A
    // label that reproduces one states a count this account has not got.
    for (const [zone, rows] of Object.entries(profile.table)) {
      for (const row of rows) {
        const shown = row.label || (Array.isArray(row.canvas) ? row.canvas[0] : row.canvas);
        assert.ok(!/\b(14|2026)\b/.test(shown) || shown.includes('{n}'),
          `${zone} · ${row.canvas} prints the canvas's own sample figure: "${shown}"`);
      }
    }
  });

  test(`${name}: {n} is filled from the page's count, or the clause is dropped`, () => {
    const items = profile.build('build/kpi', { value: 'all', counts: { all: 3 } });
    assert.ok(items.some((i) => i.label === 'All 3 months'), 'the page count is not substituted');
    const blind = profile.build('build/kpi', { value: 'all' });
    assert.ok(blind.some((i) => i.label === 'All months'), 'a missing count invents a figure');
    // Rendering found this one: an empty ledger produced "All 0 months", which
    // is a broken string rather than a filter name.
    const empty = profile.build('build/kpi', { value: 'all', counts: { all: 0 } });
    assert.ok(empty.some((i) => i.label === 'All months'), 'a zero count is printed into the label');
    // `Last 6 mo` and `Stale > 7d` keep their digits on purpose: a window is
    // part of the filter's definition, not a count of this account's records.
    // What must never survive is a `{n}` with nothing to fill it.
    assert.ok(!blind.some((i) => /\{n\}/.test(i.label || '')), 'an unfilled placeholder reached the chip');
    for (const zone of Object.keys(profile.table)) {
      const counted = profile.table[zone].filter((row) => String(row.label || '').includes('{n}'));
      for (const row of counted) {
        const shown = profile.build(zone, { value: row.key }).find((i) => i.active)?.label || '';
        assert.ok(!/\d/.test(shown), `${zone} · ${row.canvas} printed a figure with no count supplied`);
      }
    }
  });

  test(`${name}: a dynamic group becomes its stored names, or its reason`, () => {
    const withRoles = profile.build('grow/talent', {
      value: 'r7', dynamic: { roles: [{ key: 'r7', label: 'Backend engineer' }] },
    });
    const role = withRoles.find((i) => i.label === 'Backend engineer');
    assert.ok(role && !role.note && role.active, 'a supplied role is not a live chip');
    const without = profile.build('grow/talent', { value: 'all' });
    assert.ok(without.some((i) => i.note && /no job post is linked/.test(i.note)),
      'an empty dynamic group draws nothing and explains nothing');
    assert.ok(!without.some((i) => i.label === 'Backend engineer'), 'a sample name leaked through');
  });

  test(`${name}: a filter with no source is never selectable`, () => {
    for (const zone of Object.keys(profile.table)) {
      for (const item of profile.build(zone, { value: '__none__' })) {
        if (!item.note) continue;
        assert.equal(item.onSelect, undefined, `${zone} · ${item.label} is prose with a click handler`);
        assert.equal(item.active, undefined, `${zone} · ${item.label} is prose that can look selected`);
      }
    }
  });
}

/**
 * The assertion that closes the hole the rest of this file cannot see.
 *
 * Everything above takes `key: 'stalled'` at its word. Mutation-checking found
 * that turning `/grow/customers`'s dead "Stalled" filter back into a live chip
 * passed all of it — which is the precise defect this whole change exists to
 * remove. A table cannot prove its own keys do anything; only the page that
 * has to write the predicate can. So: every live key must appear in the file
 * that mounts that zone's filters, with comments stripped so a key mentioned
 * in a docblock cannot stand in for one that is used.
 *
 * A zone nobody mounts is not silently exempt — MOUNTED counts them, and the
 * count only ever goes up.
 */
const MOUNTED = 5;

function mountingFile(zone) {
  const dirs = ['frontend/src/pages/founder', 'frontend/src/workspaces'];
  for (const dir of dirs) {
    for (const file of readdirSync(resolve(root, dir))) {
      if (!/\.jsx?$/.test(file)) continue;
      const src = read(`${dir}/${file}`);
      if (src.includes(`founderZoneFilters('${zone}'`)) return { path: `${dir}/${file}`, src };
    }
  }
  return null;
}

test('a live filter key exists in the page that would have to implement it', () => {
  let mounted = 0;
  for (const [zone, rows] of Object.entries(FOUNDER_ZONE_FILTERS)) {
    const page = mountingFile(zone);
    if (!page) continue;
    mounted += 1;
    // The mount itself is stripped first. Without that, writing
    // `founderZoneFilters('grow/customers', { value: 'stalled' })` would satisfy
    // the search for 'stalled' using nothing but the declaration under test.
    const code = codeOnly(page.src).replace(/founderZoneFilters\([^;]*?\)\s*\}/gs, '');
    for (const row of rows) {
      if (!row.key) continue;
      // Either form counts: a page may compare (`period === 'six'`) or look up
      // (`PERIODS[period]`, keyed `six:`). Both implement the filter; insisting
      // on one would push pages toward a shape to satisfy a test.
      //
      // This is a proxy and it is worth saying what it cannot do: it proves the
      // page KNOWS the key, not that the predicate behind it is right. What it
      // does close is the hole mutation-checking found — declaring a filter live
      // without touching the page that would have to serve it.
      const used = new RegExp(`(['"\`]${row.key}['"\`]|\\b${row.key}\\s*:)`);
      assert.ok(
        used.test(code),
        `${zone} declares the live filter '${row.key}' but ${page.path} never uses it`,
      );
    }
  }
  assert.equal(mounted, MOUNTED, `${mounted} zones mount their filters; MOUNTED says ${MOUNTED}`);
});

test('filters sharing one reason collapse into one sentence that names them all', () => {
  // /build/cadence has four filters and one reason. Saying it four times is
  // noise; saying it once and naming three of the four is a lie by omission.
  const items = founderZoneFilters('build/cadence', { value: 'x' });
  const grouped = groupFilterNotes(items);
  assert.equal(grouped.length, 1, 'one reason produced more than one sentence');
  assert.deepEqual(grouped[0].labels, ['All rituals', 'Plans', 'Retros', 'Skipped']);
  // /build/this-week has two distinct reasons across three dead filters.
  const week = groupFilterNotes(founderZoneFilters('build/this-week', { value: 'now' }));
  assert.equal(week.length, 2, 'two distinct reasons were merged into one');
  assert.deepEqual(week[0].labels, ['Last 4', 'All weeks']);
  assert.deepEqual(week[1].labels, ['Carried only']);
});

test('every zone that has a filter table also has an action table for the same zone', () => {
  // The two halves of one row. A zone in one and not the other means the row
  // was half-wired, which is exactly how `/raise/status` lost "Timeline".
  const actions = read('frontend/src/workspaces/founderZoneActions.js');
  for (const zone of Object.keys(FOUNDER_ZONE_FILTERS)) {
    assert.ok(actions.includes(`'${zone}':`), `${zone} has filters but no actions`);
  }
});
