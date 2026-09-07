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
import { readFileSync, readdirSync, statSync } from 'node:fs';
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
    call: 'founderZoneFilters',
    // Build, Raise and Grow only. Founder Network (3 zones) and Founder
    // Research (5) also carry `filters:` arrays and are NOT covered here yet;
    // they are rendered by `NetworkWorkspace` and `ResearchWorkspace`, which
    // the investor profile has to touch for the same eight slugs, so both
    // licences' halves of those two components land together or not at all.
    canvas: /^Pages · Founder (Build|Raise|Grow)\.dc\.html$/,
    pages: ['frontend/src/pages/founder', 'frontend/src/workspaces'],
    actions: 'frontend/src/workspaces/founderZoneActions.js',
    zones: 18,
    mounted: 18,
    // Nothing is excluded: this profile's canvas regex above already limits the
    // set to the three buckets it covers, so every route it yields is declared.
    excluded: [],
    // Counts welded onto a real filter — `All 14`, `All 14 mo`, `Aug 2026`.
    samples: /\b(14|2026)\b/,
    // Founder canvas routes are the live routes.
    live: (route) => route.replace(/^\//, ''),
  },
};

/**
 * Every matching artboard's route and its `filters:` labels, from the canvas.
 *
 * `profile.live` maps a canvas route onto the route the router actually mounts.
 * The founder canvases need no mapping; the investor Fund canvas says `/fund/*`
 * where the router says `/funds/*` and mounts `accounting` at the slug
 * `ledger`. `profile_zone_actions.test.mjs` has carried the same hook since it
 * was written — the mapping is spelled out per profile rather than guessed,
 * so a canvas route that stops resolving fails here instead of matching
 * nothing and quietly shrinking the covered set.
 */
function canvasFilters(profile) {
  const out = {};
  for (const file of readdirSync(resolve(root, 'design/canvases/integrated')).filter((f) => profile.canvas.test(f))) {
    const src = read(`design/canvases/integrated/${file}`);
    for (const chunk of src.split(/route:\s*'/).slice(1)) {
      const route = chunk.slice(0, chunk.indexOf("'"));
      const filters = chunk.match(/filters:\s*fil\(\[([^\]]*)\]/);
      if (!filters) continue;
      out[profile.live(route)] = filters[1]
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
    // A zone the canvas specifies and this table deliberately does not carry
    // yet. Checked as an exact SET, the way `profile_zone_actions` does it, so
    // a deferral is recorded rather than silent: an exclusion cannot grow by
    // accident, and a route that stops existing on a canvas fails here instead
    // of sitting in the list forever.
    const excluded = profile.excluded || [];
    const specified = Object.keys(canvas).filter((route) => !excluded.includes(route));
    assert.deepEqual(specified.sort(), Object.keys(profile.table).sort(),
      'an artboard specifies filters for a zone this table does not cover');
    for (const skip of excluded) {
      assert.ok(canvas[skip], `${skip} is excluded but no artboard specifies it`);
      assert.ok(!profile.table[skip], `${skip} is both excluded and declared`);
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

  test(`${name}: a sample datum from the artboard is never printed as fact`, () => {
    // The pattern is per profile because the samples are. Founder's are counts
    // welded onto a real filter — `All 14`, `All 14 mo`, `Aug 2026` — which
    // `{n}` fixes. The investor Fund canvas has `Call 3`, which names one
    // specific stored record rather than carrying a count, so `{n}` is not the
    // repair and a shared `/\b(14|2026)\b/` would not even see it.
    //
    // The rule either way: a label naming a specific record becomes a `dynamic`
    // group or a relabelled positional filter ("Latest month"), never a chip
    // carrying the sample's identity.
    // The pattern must be AIMED AT SOMETHING. Mutation-checking defanged it to
    // `/__never__/` and every assertion still passed, because no label in the
    // table trips it today — every one is already correct. A pattern that
    // cannot be shown to match anything is not a guard, it is a decoration. So
    // first prove it catches the canvas's own labels, then prove none of those
    // reach the screen.
    const raw = Object.values(canvasFilters(profile)).flat();
    const caught = raw.filter((label) => profile.samples.test(label));
    assert.ok(caught.length > 0,
      `${name}'s sample pattern matches none of its ${raw.length} canvas labels — it guards nothing`);

    for (const [zone, rows] of Object.entries(profile.table)) {
      for (const row of rows) {
        const shown = row.label || (Array.isArray(row.canvas) ? row.canvas[0] : row.canvas);
        assert.ok(!profile.samples.test(shown) || shown.includes('{n}'),
          `${zone} · ${row.canvas} prints the canvas's own sample datum: "${shown}"`);
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
    // The same group in the zone whose substitution is the least obvious: the
    // canvas names three market SEGMENTS, and a customer record stores the
    // SOURCE it was captured from. The chips are the stored sources, and the
    // note beside them is what keeps that from reading as a segment breakdown.
    const bySource = profile.build('grow/customers', {
      value: 'referral',
      dynamic: { sources: [{ key: 'waitlist', label: 'Waitlist' }, { key: 'referral', label: 'Referral' }] },
    });
    assert.deepEqual(bySource.filter((i) => !i.note).map((i) => i.label), ['All', 'Waitlist', 'Referral']);
    assert.ok(bySource.find((i) => i.label === 'Referral').active, 'the supplied source cannot be selected');
    assert.ok(bySource.some((i) => i.note && /no market segment is stored/.test(i.note)),
      'the segment/source difference stopped being stated');
    // And it renders as a bare sentence, not "One chip per segment — …", since
    // with chips present there is no dead filter left to name.
    const standing = groupFilterNotes(bySource).find((g) => /no market segment/.test(g.note));
    assert.deepEqual(standing.labels, [], 'the standing note still names a filter that is not missing');
    // A fallback note keeps its label, because there the label IS the missing thing.
    const fallback = groupFilterNotes(profile.build('grow/talent', { value: 'all' }))
      .find((g) => /no job post is linked/.test(g.note));
    assert.deepEqual(fallback.labels, ['One chip per role']);

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
  /**
   * The assertion that closes the hole the rest of this file cannot see.
   *
   * Everything above takes `key: 'stalled'` at its word. Mutation-checking
   * found that turning `/grow/customers`'s dead "Stalled" filter back into a
   * live chip passed all of it — which is the precise defect this whole change
   * exists to remove. A table cannot prove its own keys do anything; only the
   * page that has to write the predicate can. So: every live key must appear in
   * the file that mounts that zone's filters, with comments stripped so a key
   * mentioned in a docblock cannot stand in for one that is used.
   *
   * A zone nobody mounts is not silently exempt — `profile.mounted` counts
   * them, and the count only ever goes up.
   */
  test(`${name}: a live filter key exists in the page that would have to implement it`, () => {
    let mounted = 0;
    for (const [zone, rows] of Object.entries(profile.table)) {
      const page = mountingFile(profile, zone);
      if (!page) continue;
      mounted += 1;
      // The mount itself is stripped first. Without that, writing
      // `founderZoneFilters('grow/customers', { value: 'stalled' })` would
      // satisfy the search for 'stalled' using nothing but the declaration
      // under test.
      const code = codeOnly(page.src).replace(new RegExp(`${profile.call}\\([^;]*?\\)\\s*\\}`, 'gs'), '');
      for (const row of rows) {
        if (!row.key) continue;
      // Either form counts: a page may compare (`period === 'six'`) or look up
      // (`PERIODS[period]`, keyed `six:`). Both implement the filter; insisting
      // on one would push pages toward a shape to satisfy a test.
      //
      // This is a proxy and it is worth saying what it cannot do: it proves the
      // page KNOWS the key, not that the predicate behind it is right. What it
        // does close is the hole mutation-checking found — declaring a filter
        // live without touching the page that would have to serve it.
        const used = new RegExp(`(['"\`]${row.key}['"\`]|\\b${row.key}\\s*:)`);
        assert.ok(
          used.test(code),
          `${zone} declares the live filter '${row.key}' but ${page.path} never uses it`,
        );
      }
    }
    assert.equal(mounted, profile.mounted,
      `${mounted} ${name} zones mount their filters; the profile says ${profile.mounted}`);
  });

  test(`${name}: every ZoneToolbar in this profile's pages names this licence`, () => {
    // `ZoneToolbar` defaults `role = 'founder'`, because founder was the first
    // and only caller. A mount that forgets `role="investor"` therefore paints
    // VIOLET chips on an indigo licence and nothing else catches it — the chip
    // still renders, still selects, still looks deliberate. It is the quiet
    // half of the same cross-licence leak the dispatcher assertion in
    // `profile_zone_actions` exists to prevent.
    //
    // Founder may omit the prop, since it IS the default — but it may not claim
    // a different licence, which is the same leak in the other direction and
    // keeps this assertion live rather than skipped until a second profile
    // arrives. Every other profile must say its own name outright.
    let checked = 0;
    for (const [zone] of Object.entries(profile.table)) {
      const page = mountingFile(profile, zone);
      if (!page) continue;
      // Split rather than match a bounded window: these mounts run to 528
      // characters and a capped regex silently found only twelve of eighteen,
      // which the count below caught. Each segment ends at the element's own
      // `/>` — the props are expressions, never nested JSX, so the first one
      // closes it.
      for (const segment of codeOnly(page.src).split('<ZoneToolbar').slice(1)) {
        const mount = segment.slice(0, segment.indexOf('/>'));
        checked += 1;
        const claimed = mount.match(/role=["'](\w+)["']/)?.[1];
        if (name === 'founder') {
          assert.ok(claimed === undefined || claimed === 'founder',
            `${page.path} mounts a founder ZoneToolbar claiming role="${claimed}"`);
        } else {
          assert.equal(claimed, name,
            `${page.path} mounts a ZoneToolbar with role="${claimed}", so it wears founder violet`);
        }
      }
    }
    assert.ok(checked >= profile.mounted,
      `only ${checked} ZoneToolbar mounts found across ${profile.mounted} mounting pages`);
  });

  test(`${name}: every zone that has a filter table also has an action table for the same zone`, () => {
    // The two halves of one row. A zone in one and not the other means the row
    // was half-wired, which is exactly how `/raise/status` lost "Timeline".
    const actions = read(profile.actions);
    for (const zone of Object.keys(profile.table)) {
      assert.ok(actions.includes(`'${zone}':`), `${zone} has filters but no actions`);
    }
  });
}

test('an excluded zone must be specified by a canvas and must not be declared', () => {
  // Founder excludes nothing, so the loop that enforces this never runs against
  // a real profile yet. Asserted directly for the same reason `live()` is: a
  // hook nothing exercises is a hook nobody notices breaking, and this one is
  // what keeps a deferral honest — it makes the excluded set exact, so an
  // exclusion cannot grow by accident and a stale one cannot linger.
  const canvas = { 'a/one': ['X'], 'a/two': ['Y'] };
  const check = (table, excluded) => {
    const specified = Object.keys(canvas).filter((r) => !excluded.includes(r));
    assert.deepEqual(specified.sort(), Object.keys(table).sort());
    for (const skip of excluded) {
      assert.ok(canvas[skip], `${skip} is excluded but no artboard specifies it`);
      assert.ok(!table[skip], `${skip} is both excluded and declared`);
    }
  };
  check({ 'a/one': [] }, ['a/two']);
  assert.throws(() => check({ 'a/one': [] }, []), /Expected values to be/,
    'an undeclared, unexcluded zone slipped through');
  assert.throws(() => check({ 'a/one': [], 'a/two': [] }, ['a/two']), /Expected values to be/,
    'a zone that is both excluded and declared slipped through');
  assert.throws(() => check({ 'a/one': [], 'a/two': [] }, ['a/three']), /no artboard specifies it/,
    'an exclusion naming no artboard slipped through');
});

test('canvasFilters maps a canvas route onto the route the router mounts', () => {
  // The hook exists for the investor Fund canvas, which says `/fund/*` where
  // the router says `/funds/*` and mounts `accounting` at the slug `ledger`.
  // Asserted directly rather than left to be exercised by the first profile
  // that needs it: a mapping nothing runs is a mapping nobody notices breaking.
  const mapped = canvasFilters({
    canvas: /^Pages · Founder Build\.dc\.html$/,
    live: (route) => `x/${route.replace(/^\//, '').replace('/', '-')}`,
  });
  assert.ok(mapped['x/build-this-week'], 'the route was not remapped');
  assert.ok(!mapped['build/this-week'], 'the unmapped route survived');
  assert.deepEqual(mapped['x/build-this-week'], ['This week', 'Last 4', 'All 14', 'Carried only'],
    'remapping changed the labels it carries');
});

/**
 * The file that mounts a zone's filters, searched across this profile's own
 * bodies. `pages` entries may be a directory or a single file: most licences
 * keep their zone bodies in one folder, but a few live loose in
 * `frontend/src/pages` beside a hundred unrelated ones, and naming those
 * outright beats scanning the folder.
 */
function mountingFile(profile, zone) {
  const needle = `${profile.call}('${zone}'`;
  for (const entry of profile.pages) {
    const full = resolve(root, entry);
    const files = statSync(full).isDirectory()
      ? readdirSync(full).filter((f) => /\.jsx?$/.test(f)).map((f) => `${entry}/${f}`)
      : [entry];
    for (const rel of files) {
      const src = read(rel);
      if (src.includes(needle)) return { path: rel, src };
    }
  }
  return null;
}

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


