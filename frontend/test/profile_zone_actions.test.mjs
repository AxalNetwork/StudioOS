/**
 * The honest pass: every zone's header carries its canvas's actions, and each
 * one either works or says why it does not.
 *
 * NOT TO BE CONFUSED WITH `zone_actions.test.mjs`, which guards a different
 * thing: the `ACTIONS` map inside `FounderValidateWorkspace.jsx`, where four
 * Validate zones dispatch to handlers that call `api.*` methods. That file
 * follows one chain down to a worker route. This file follows the other
 * direction — from each canvas's `ops:` array out to what the product can
 * actually do — across every profile.
 *
 * WHAT THIS FILE IS DEFENDING. The request that produced this work was that
 * every subpage carry its data-entry actions. The way to fail it quietly is to
 * draw the buttons and wire none of them — a page then LOOKS finished and does
 * nothing, which is worse than the empty header it replaced, because the reader
 * now believes they tried. So the assertions below are about the promise, not
 * the pixels: the labels are the canvas's, every link goes somewhere that
 * profile's licence may actually open, and anything that performs nothing is
 * prose.
 *
 * ONE FILE, EVERY PROFILE. The rules are identical and the answers are not —
 * `/matches` is a working destination for an investor's "Request an intro" and
 * a closed door for a founder's identical one — so the checks are parameterised
 * over `PROFILES` and each profile brings its own table, canvases and pages.
 *
 * Run with:
 *   node --test frontend/test/profile_zone_actions.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeOnly } from './_codeOnly.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const APP = read('frontend/src/App.jsx');

const PROFILES = {
  founder: {
    table: 'frontend/src/workspaces/founderZoneActions.js',
    pages: ['frontend/src/pages/founder'],
    call: 'founderZoneActions',
    canvas: /^Pages · Founder /,
    buckets: /^(build|grow|network|raise)\//,
    zones: 21,
    links: 17,
    exports: 15,
    embeddedGuards: 3,
    // Founder canvas routes are the live routes.
    live: (route) => route.replace(/^\//, ''),
  },
  investor: {
    table: 'frontend/src/workspaces/investorZoneActions.js',
    pages: ['frontend/src/pages/investor'],
    call: 'investorZoneActions',
    canvas: /^Pages · Investor /,
    buckets: /^(deals|funds|portfolio|network)\//,
    zones: 14,
    links: 1,
    exports: 9,
    embeddedGuards: 1,
    // `Pages · Investor Fund` names /fund/*; the router and shellConfig.js both
    // say /funds/*, and "accounting" is mounted at the slug "ledger". The
    // mapping is written down rather than fuzzy-matched, so a canvas route that
    // stops resolving fails here instead of silently matching nothing.
    live: (route) => ({
      '/fund/lps': 'funds/lps',
      '/fund/calls': 'funds/calls',
      '/fund/accounting': 'funds/ledger',
      '/fund/reporting': 'funds/reporting',
    }[route] ?? route.replace(/^\//, '')),
  },
  partner: {
    table: 'frontend/src/workspaces/partnerZoneActions.js',
    // Partner zone bodies are spread over three subtrees, and two of them are
    // shared pages the bucket router hands a render prop to. All of it is in
    // scope: a zone mounted from `PartnerBucketRoutes` counts as mounted.
    pages: ['frontend/src/pages/partner', 'frontend/src/workspaces/partner'],
    extra: ['frontend/src/pages/ServiceCatalogPage.jsx', 'frontend/src/pages/PerksPage.jsx'],
    call: 'partnerZoneActions',
    canvas: /^Pages · Partner /,
    // `/pipeline` is absent on purpose — `Pages · Partner Pipeline` carries no
    // `ops:` on any artboard, so `canvasOps` finds nothing there and this
    // pattern must not claim it does. `/network` and `/research` are the shared
    // surfaces, and their canvases live in `design/incoming/` which this reader
    // does not open.
    buckets: /^(delivery|offers)\//,
    zones: 10,
    links: 0,
    exports: 10,
    embeddedGuards: 0,
    live: (route) => route.replace(/^\//, ''),
  },
  advisor: {
    table: 'frontend/src/workspaces/advisorZoneActions.js',
    pages: ['frontend/src/pages/advisor'],
    call: 'advisorZoneActions',
    // The only advisor artboard set that carries an `ops:` array. `Advisor
    // Detail · Practice`, `Advisor Canvas` and the backlog Cohorts export are
    // rendered HTML with no header actions on any artboard, and this reader
    // does not open `design/incoming/` for the other two profiles either — so
    // it must for this one, since Expertise ships from there.
    canvasDirs: ['design/incoming'],
    canvas: /^Pages · Advisor Expertise/,
    buckets: /^expertise\//,
    zones: 4,
    links: 1,
    exports: 4,
    embeddedGuards: 0,
    // The fifth artboard. `expertise/visibility` is not a zone body at all — it
    // is the one card left in AdvisorBucketRoutes' COPY, and its whole page is
    // already the gap statement ("Nothing counts profile views"). Listed here
    // so the exclusion is checked rather than silent.
    excluded: ['expertise/visibility'],
    live: (route) => route.replace(/^\//, ''),
  },
};

/** The zone → labels map, read out of a profile's own literal. */
function tableLabels(src) {
  const start = src.search(/export const [A-Z_]+_ZONE_ACTIONS/);
  const body = src.slice(start, src.indexOf('\n};', start));
  const out = {};
  let zone = null;
  for (const line of body.split('\n')) {
    const z = line.match(/^ {2}'([a-z-]+\/[a-z-]+)':/);
    if (z) { zone = z[1]; out[zone] = []; continue; }
    const l = line.match(/^ {4}\{ label: '([^']+)'/);
    if (l && zone) out[zone].push(l[1]);
  }
  return out;
}

/** Every matching artboard's `route` and its `ops` array, from the canvases. */
function canvasOps(profile) {
  const out = {};
  let seen = 0;
  for (const dir of profile.canvasDirs || ['design/canvases/integrated']) {
    const files = readdirSync(resolve(root, dir)).filter((f) => profile.canvas.test(f));
    seen += files.length;
    for (const f of files) {
      const src = read(`${dir}/${f}`);
      for (const chunk of src.split(/route:\s*'/).slice(1)) {
        const route = chunk.slice(0, chunk.indexOf("'"));
        const ops = chunk.match(/ops:\s*\[([^\]]*)\]/);
        if (!ops) continue;
        out[profile.live(route)] = [...ops[1].matchAll(/'([^']*)'/g)].map((m) => m[1]);
      }
    }
  }
  assert.ok(seen, `no canvases matched ${profile.canvas}`);
  return out;
}

/** The inside of `[ … ]` starting at index 0, brackets balanced. */
function balanced(text) {
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    if ('([{'.includes(text[i])) depth += 1;
    else if (')]}'.includes(text[i])) {
      depth -= 1;
      if (depth === 0) return text.slice(1, i);
    }
  }
  throw new Error('unbalanced cells array');
}

/** Every `.jsx` under a profile's subtrees, plus any file it names outright. */
function pageFiles(profile) {
  const out = [];
  const walk = (rel) => {
    for (const entry of readdirSync(resolve(root, rel))) {
      const next = `${rel}/${entry}`;
      if (statSync(resolve(root, next)).isDirectory()) walk(next);
      else if (entry.endsWith('.jsx')) out.push(next);
    }
  };
  for (const dir of profile.pages) walk(dir);
  for (const f of profile.extra || []) out.push(f);
  return out;
}

for (const [name, profile] of Object.entries(PROFILES)) {
  const SRC = read(profile.table);

  test(`${name}: every zone lists exactly the canvas's actions, in the canvas's order`, () => {
    const table = tableLabels(SRC);
    const canvas = canvasOps(profile);
    assert.equal(Object.keys(table).length, profile.zones);
    for (const [zone, labels] of Object.entries(table)) {
      assert.ok(canvas[zone], `${zone} has no artboard — where did its labels come from?`);
      // Order matters: the canvas puts the destructive or configuring action
      // last, and re-ordering them here would quietly re-rank them on screen.
      assert.deepEqual(labels, canvas[zone], `${zone} does not match its artboard's ops`);
    }
    // And nothing in a canvas for one of this profile's own buckets was skipped.
    // An excluded zone is one the canvas specifies and this table deliberately
    // does not carry. Checking the set exactly means an exclusion cannot grow
    // by accident — a new unbacked zone fails here rather than vanishing.
    const excluded = profile.excluded || [];
    const specified = Object.keys(canvas)
      .filter((r) => profile.buckets.test(r))
      .filter((r) => !excluded.includes(r));
    assert.deepEqual(specified.sort(), Object.keys(table).sort(),
      'an artboard specifies actions for a zone this table does not cover');
    for (const skip of excluded) {
      assert.ok(canvas[skip], `${skip} is excluded but no artboard specifies it`);
      assert.ok(!table[skip], `${skip} is both excluded and declared`);
    }
  });

  test(`${name}: every link is a route this licence is allowed to open`, () => {
    const links = [...SRC.matchAll(/to: '([^']+)'/g)].map((m) => m[1]);
    // The count is pinned because a working action quietly downgraded to a
    // note is the regression this whole pass exists against, and it would
    // otherwise pass every other assertion in this file.
    assert.equal(links.length, profile.links,
      `${name} declares ${links.length} linked actions, expected ${profile.links}`);
    assert.equal((SRC.match(/kind: 'export'/g) || []).length, profile.exports,
      `${name} declares a different number of exports than it did`);
    for (const link of new Set(links)) {
      const path = link.split('?')[0];
      const i = APP.indexOf(`path="${path}"`);
      assert.ok(i > 0, `${path} is not a route App.jsx mounts`);
      // The guard is the first `[...]` after the path — either a bare array or
      // one wrapped in labRoles(...), which only ever ADDS the caller's own role.
      const decl = APP.slice(i, i + 400);
      // `authOnly(…)` is the one legitimate alternative to `guard([…])`: it
      // gates on being signed in and on nothing else, so it is MORE permissive
      // than any role list and every licence may open it. `/articles/draft`,
      // where an advisor writes a new piece, is mounted that way.
      if (/authOnly\(/.test(decl.slice(0, decl.indexOf('/>') + 2))) continue;
      const roles = decl.match(/guard\((?:labRoles\()?\[([^\]]*)\]/);
      assert.ok(roles, `${path} goes through neither guard() nor authOnly()`);
      assert.match(roles[1], new RegExp(`'${name}'`), `${path} is mounted, but not for a ${name}`);
    }
  });

  test(`${name}: a note never points at a path, because prose is not checked`, () => {
    // Every `to` in this table is verified against the router by the test above.
    // A note is prose and nothing verifies it, so a note that says "go to
    // /matches" is an unchecked link wearing a sentence. Notes name surfaces the
    // way a person would; the checked field carries the path.
    const notes = [...SRC.matchAll(/^ {4}\{ label: '[^']+', note: '([^']*)'/gm)].map((m) => m[1]);
    // Exact rather than a floor: every action is a link, an export or a gap,
    // and nothing is untyped. An entry that is none of the three would render
    // as a dead button — which is the one thing this whole pass forbids.
    const actions = [...SRC.matchAll(/^ {4}\{ label: '/gm)].length;
    assert.equal(profile.links + profile.exports + notes.length, actions,
      `${name} has ${actions} actions but ${profile.links} links, ${profile.exports} exports and ${notes.length} gaps`);
    for (const note of notes) {
      assert.doesNotMatch(note, /(^|\s)\/[a-z]/, `a note carries an unchecked path: "${note}"`);
    }
  });

  test(`${name}: no action is given both a destination and an excuse`, () => {
    // The builder prefers `to`, so a `note` beside it would never be read — the
    // gap would be recorded in the source and invisible on screen. `linkNote` is
    // the deliberate way to qualify a link, and it renders as the title.
    const entries = [...SRC.matchAll(/^ {4}\{ label: '[^']+',([^\n]*)$/gm)].map((m) => m[1]);
    assert.ok(entries.length >= profile.zones * 2, `expected every action, found ${entries.length}`);
    for (const rest of entries) {
      assert.ok(!(/\bto: /.test(rest) && /\bnote: /.test(rest)),
        `an action declares both a destination and a gap: ${rest.trim()}`);
    }
  });

  test(`${name}: a zone row names only variables its page actually has`, () => {
    // `scope: project?.name` on a page with no `project` is a ReferenceError
    // that blanks the whole route at render — and it is NOT a build error:
    // esbuild bundles it happily, and this repo has no lint step to catch it.
    // It shipped into one of the founder pages and only a browser found it.
    const KNOWN = new Set(['true', 'false', 'null', 'undefined', 'Number', 'String',
      'Boolean', 'Array', 'Object', 'Math', 'JSON', 'Date', profile.call]);
    let checked = 0;
    for (const f of pageFiles(profile)) {
      const src = read(f);
      let at = src.indexOf(`${profile.call}('`);
      while (at >= 0) {
        const call = src.slice(at, src.indexOf('})}', at) + 3);
        const bare = call
          // A template literal is text plus real expressions: keep the `${…}`
          // bodies, drop the rest, or `?project_id=${id}` contributes a bare `$`.
          .replace(/`([^`]*)`/g, (_m, inner) => [...inner.matchAll(/\$\{([^}]*)\}/g)].map((x) => x[1]).join(' '))
          .replace(/'[^']*'/g, "''")               // string literals
          .replace(/\b[A-Za-z_$][\w$]*\s*:/g, '')  // object keys
          .replace(/\.[A-Za-z_$][\w$]*/g, '');     // property access
        // An arrow's own parameter is declared right there — `cells: (r) =>
        // [r.x]` leaves a bare `r` once the property is stripped.
        // Including an ENCLOSING arrow's parameter: the partner bucket router
        // hands these pages `(rows) => partnerZoneActions(…)`, so `rows` is
        // declared just before the call rather than inside it.
        const around = src.slice(Math.max(0, at - 160), at) + call;
        const params = new Set([...around.matchAll(/\(\s*([A-Za-z_$][\w$]*)\s*\)\s*=>/g)].map((m) => m[1]));
        for (const id of new Set([...bare.matchAll(/[A-Za-z_$][\w$]*/g)].map((m) => m[0]))) {
          if (KNOWN.has(id) || params.has(id)) continue;
          const declared = new RegExp(`(const|let|var|function|import)[^\\n;]*\\b${id}\\b`).test(src);
          assert.ok(declared, `${f} passes \`${id}\` to its zone row, and never declares it`);
          checked += 1;
        }
        at = src.indexOf(`${profile.call}('`, at + 1);
      }
    }
    // A floor, only so a broken extractor returning nothing cannot pass. The
    // real assertion is the one inside the loop; the number of DISTINCT names a
    // profile references is not a fact worth pinning (partner's ten zones name
    // eight between them, because most of them call their list `items`).
    assert.ok(checked >= 2, `the name extractor found almost nothing: ${checked}`);
  });

  test(`${name}: a zone row is never sealed inside a header that does not render`, () => {
    // The Network zones mount only through NetworkWorkspace, which passes
    // `embedded` — so their own `{!embedded && <header>…}` block is dead on the
    // route the reader opens. Rows placed inside rendered nowhere on three
    // founder pages, and every source assertion still passed.
    //
    // Read through `codeOnly`, and check EVERY guard rather than the first: the
    // comment explaining this rule quotes `{!embedded &&` itself, and a file
    // can carry more than one guarded block. Both bit this assertion.
    let guarded = 0;
    for (const f of pageFiles(profile)) {
      const src = codeOnly(read(f));
      if (!src.includes('<ZoneActions')) continue;
      for (const m of src.matchAll(/\{!embedded &&/g)) {
        const close = src.indexOf('</header>}', m.index);
        if (close < 0) continue;
        guarded += 1;
        assert.ok(!src.slice(m.index, close).includes('<ZoneActions'),
          `${f} hides its actions behind !embedded, on a route that is always embedded`);
      }
    }
    assert.ok(guarded >= profile.embeddedGuards,
      `${name} checked ${guarded} embedded-guarded blocks, expected at least ${profile.embeddedGuards}`);
  });

  test(`${name}: every zone is mounted, exactly once`, () => {
    const table = tableLabels(SRC);
    const seen = new Map();
    for (const f of pageFiles(profile)) {
      const src = read(f);
      for (const m of src.matchAll(new RegExp(`${profile.call}\\('([^']+)'`, 'g'))) {
        assert.ok(table[m[1]], `${f} names a zone the table does not declare: ${m[1]}`);
        assert.ok(!seen.has(m[1]), `${m[1]} is mounted by ${seen.get(m[1])} and ${f}`);
        // CALLING the builder is not mounting it. Renaming the prop from
        // `actions=` to anything else leaves the call in the file and the row
        // off the screen, and every other assertion here still passes — so the
        // call has to be the value of a prop something actually renders.
        const before = src.slice(Math.max(0, m.index - 220), m.index);
        assert.match(before, /(?:^|\s)(?:actions|items|zoneActions)=\{[^}]*$/,
          `${f} calls the builder for ${m[1]} but does not hand the result to anything`);
        seen.set(m[1], f);
      }
    }
    assert.equal(seen.size, profile.zones,
      `${profile.zones} zones declared, ${seen.size} mounted`);
  });

  test(`${name}: an export names the columns it writes, and fills every one`, () => {
    let checked = 0;
    for (const f of pageFiles(profile)) {
      const src = read(f);
      if (!src.includes(`${profile.call}(`)) continue;
      for (const header of src.matchAll(/header: \[([^\]]*)\]/g)) {
        const after = src.slice(header.index);
        const open = after.search(/cells: \([a-z]+\) => \[/);
        assert.ok(open >= 0, `${f} declares export columns but no row mapping`);
        const body = balanced(after.slice(after.indexOf('[', open)));
        const cols = [...header[1].matchAll(/'/g)].length / 2;
        // Top-level commas only: an accessor may carry brackets or calls.
        let depth = 0, count = 1;
        for (const ch of body) {
          if ('([{'.includes(ch)) depth += 1;
          else if (')]}'.includes(ch)) depth -= 1;
          else if (ch === ',' && depth === 0) count += 1;
        }
        assert.equal(count, cols, `${f} writes ${count} values under ${cols} column headings`);
        checked += 1;
      }
    }
    assert.ok(checked >= 3, `expected every exporting zone to be checked, saw ${checked}`);
  });
}

test('one builder, so the rules cannot drift apart between profiles', () => {
  // Four tables and four copies of "what an empty export says" is how this repo
  // ended up with three CSV escapers that disagree.
  const builder = read('frontend/src/workspaces/zoneActionBuilder.js');
  assert.match(builder, /export function makeZoneActions\(/);
  for (const [name, profile] of Object.entries(PROFILES)) {
    const src = read(profile.table);
    assert.match(src, /import \{ makeZoneActions \} from '\.\/zoneActionBuilder'/,
      `${name} does not use the shared builder`);
    assert.doesNotMatch(src, /exportView|localStorage/,
      `${name}'s table reimplements what the builder does`);
  }
});

test('the shared zone body actually renders the row it is handed', () => {
  // Seven partner zones pass their row to `ZoneBody`, which is the only thing
  // that renders it. `const row = null` in there empties all seven at once and
  // leaves every table, every wiring assertion and the build untouched.
  const kit = read('frontend/src/pages/advisor/expertise/kit.jsx');
  const fn = kit.slice(kit.indexOf('export function ZoneBody'));
  const body = fn.slice(0, fn.indexOf('\n}') + 2);
  assert.match(body, /actions\?\.length \? <ZoneActions[^>]*items=\{actions\}/,
    'ZoneBody no longer renders the actions it is given');
  // And it renders above every one of the four states, not only the happy one:
  // a stated gap is as true while the store is loading or failed as after.
  for (const state of ['loading', 'error', 'isEmpty']) {
    assert.ok(body.includes(state), `ZoneBody no longer handles ${state}`);
  }
  assert.equal((body.match(/wrap\(/g) || []).length, 4,
    'a ZoneBody return path stopped carrying the actions row');
});

test('an action that performs nothing is prose, never a button', () => {
  const zone = read('frontend/src/workspaces/ZoneActions.jsx');
  const render = zone.slice(zone.indexOf('export default function ZoneActions'));
  // The note branch returns before either the Link or the button branch is
  // reached. Order is the mechanism, so order is what is asserted.
  const note = render.indexOf('if (item.note)');
  const link = render.indexOf('if (item.to)');
  const button = render.indexOf('<button');
  assert.ok(note > 0 && link > note && button > link,
    'the note branch no longer precedes the link and button branches');
  assert.match(render.slice(note, link), /<span/, 'a note is not rendered as text');
  assert.doesNotMatch(render.slice(note, link), /<button|onClick/,
    'the note branch grew something clickable');
});

test('the client CSV escapes exactly as the worker does', () => {
  // Three copies of this function already disagree in this repo; a fourth
  // drifting a fifth way is the failure that consolidating them was meant to
  // end. A bare carriage return left unquoted splits a record for any RFC 4180
  // reader, which is how a founder's export loses half its rows.
  //
  // Read through `codeOnly`: the docblock of the file under test QUOTES the
  // rule it implements, so a check against the raw source passes on the comment
  // while the code says something else. That mutation survived once here.
  const client = codeOnly(read('frontend/src/lib/csvExport.js'));
  const worker = codeOnly(read('cloudflare-worker/src/services/csv.ts'));
  const rule = /\[",\\n\\r\]/;
  assert.match(client, rule, 'the client CSV does not quote on all four characters');
  assert.match(worker, rule, 'the worker CSV rule moved — this test is comparing to nothing');
  assert.match(client, /replace\(\/"\/g, '""'\)/, 'a quote inside a cell is not doubled');
  assert.match(client, /if \(!list\.length\) return false;/,
    'exportView writes an empty file instead of refusing');
});

test('the label says the export is of this view, because it is', () => {
  // It exports the rows the page has LOADED, which on most zones is a capped
  // page. "Export" over a truncated list, with no hint of the truncation, is
  // how a reader pastes twenty-five of two hundred rows into an update.
  const builder = read('frontend/src/workspaces/zoneActionBuilder.js');
  assert.match(builder, /label: `\$\{item\.label\} · this view`/,
    'the export button no longer says which rows it covers');
  assert.match(read('frontend/src/lib/csvExport.js'), /\$\{list\.length\}-rows/,
    'the filename no longer carries the row count');
  assert.match(builder, /note: 'nothing loaded to export yet'/,
    'an export with no rows is offered as a button');
});
