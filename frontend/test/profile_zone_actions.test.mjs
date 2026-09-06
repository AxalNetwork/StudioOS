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
import { readFileSync, readdirSync } from 'node:fs';
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
    pages: 'frontend/src/pages/founder',
    call: 'founderZoneActions',
    canvas: /^Pages · Founder /,
    buckets: /^(build|grow|network|raise)\//,
    zones: 21,
    // Founder canvas routes are the live routes.
    live: (route) => route.replace(/^\//, ''),
  },
  investor: {
    table: 'frontend/src/workspaces/investorZoneActions.js',
    pages: 'frontend/src/pages/investor',
    call: 'investorZoneActions',
    canvas: /^Pages · Investor /,
    buckets: /^(deals|funds|portfolio|network)\//,
    zones: 14,
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
  const dir = 'design/canvases/integrated';
  const files = readdirSync(resolve(root, dir)).filter((f) => profile.canvas.test(f));
  assert.ok(files.length, `no canvases matched ${profile.canvas}`);
  const out = {};
  for (const f of files) {
    const src = read(`${dir}/${f}`);
    for (const chunk of src.split(/route:\s*'/).slice(1)) {
      const route = chunk.slice(0, chunk.indexOf("'"));
      const ops = chunk.match(/ops:\s*\[([^\]]*)\]/);
      if (!ops) continue;
      out[profile.live(route)] = [...ops[1].matchAll(/'([^']*)'/g)].map((m) => m[1]);
    }
  }
  return out;
}

const pageFiles = (profile) =>
  readdirSync(resolve(root, profile.pages)).filter((f) => f.endsWith('.jsx'));

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
    const specified = Object.keys(canvas).filter((r) => profile.buckets.test(r));
    assert.deepEqual(specified.sort(), Object.keys(table).sort(),
      'an artboard specifies actions for a zone this table does not cover');
  });

  test(`${name}: every link is a route this licence is allowed to open`, () => {
    const links = [...SRC.matchAll(/to: '([^']+)'/g)].map((m) => m[1]);
    assert.ok(links.length >= 1, `expected at least one linked action, found ${links.length}`);
    for (const link of new Set(links)) {
      const path = link.split('?')[0];
      const i = APP.indexOf(`path="${path}"`);
      assert.ok(i > 0, `${path} is not a route App.jsx mounts`);
      // The guard is the first `[...]` after the path — either a bare array or
      // one wrapped in labRoles(...), which only ever ADDS the caller's own role.
      const roles = APP.slice(i, i + 400).match(/guard\((?:labRoles\()?\[([^\]]*)\]/);
      assert.ok(roles, `${path} does not go through guard()`);
      assert.match(roles[1], new RegExp(`'${name}'`), `${path} is mounted, but not for a ${name}`);
    }
  });

  test(`${name}: a note never points at a path, because prose is not checked`, () => {
    // Every `to` in this table is verified against the router by the test above.
    // A note is prose and nothing verifies it, so a note that says "go to
    // /matches" is an unchecked link wearing a sentence. Notes name surfaces the
    // way a person would; the checked field carries the path.
    const notes = [...SRC.matchAll(/note: '([^']*)'/g)].map((m) => m[1]);
    assert.ok(notes.length >= 20, `expected the stated gaps, found ${notes.length}`);
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
      const src = read(`${profile.pages}/${f}`);
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
        const params = new Set([...call.matchAll(/\(\s*([A-Za-z_$][\w$]*)\s*\)\s*=>/g)].map((m) => m[1]));
        for (const id of new Set([...bare.matchAll(/[A-Za-z_$][\w$]*/g)].map((m) => m[0]))) {
          if (KNOWN.has(id) || params.has(id)) continue;
          const declared = new RegExp(`(const|let|var|function|import)[^\\n;]*\\b${id}\\b`).test(src);
          assert.ok(declared, `${f} passes \`${id}\` to its zone row, and never declares it`);
          checked += 1;
        }
        at = src.indexOf(`${profile.call}('`, at + 1);
      }
    }
    assert.ok(checked >= profile.zones, `expected every referenced name checked, saw ${checked}`);
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
      const src = codeOnly(read(`${profile.pages}/${f}`));
      if (!src.includes('<ZoneActions')) continue;
      for (const m of src.matchAll(/\{!embedded &&/g)) {
        const close = src.indexOf('</header>}', m.index);
        if (close < 0) continue;
        guarded += 1;
        assert.ok(!src.slice(m.index, close).includes('<ZoneActions'),
          `${f} hides its actions behind !embedded, on a route that is always embedded`);
      }
    }
    assert.ok(guarded >= 1, `expected at least one embedded-guarded page in ${name}`);
  });

  test(`${name}: every zone is mounted, exactly once`, () => {
    const table = tableLabels(SRC);
    const seen = new Map();
    for (const f of pageFiles(profile)) {
      const src = read(`${profile.pages}/${f}`);
      for (const m of src.matchAll(new RegExp(`${profile.call}\\('([^']+)'`, 'g'))) {
        assert.ok(table[m[1]], `${f} names a zone the table does not declare: ${m[1]}`);
        assert.ok(!seen.has(m[1]), `${m[1]} is mounted by ${seen.get(m[1])} and ${f}`);
        seen.set(m[1], f);
      }
    }
    assert.equal(seen.size, profile.zones,
      `${profile.zones} zones declared, ${seen.size} mounted`);
  });

  test(`${name}: an export names the columns it writes, and fills every one`, () => {
    let checked = 0;
    for (const f of pageFiles(profile)) {
      const src = read(`${profile.pages}/${f}`);
      if (!src.includes(`${profile.call}(`)) continue;
      for (const header of src.matchAll(/header: \[([^\]]*)\]/g)) {
        const after = src.slice(header.index);
        const cells = after.match(/cells: \([a-z]+\) => \[(.*?)\] \}/);
        assert.ok(cells, `${f} declares export columns but no row mapping`);
        const cols = [...header[1].matchAll(/'/g)].length / 2;
        // Top-level commas only: an accessor may carry brackets or calls.
        let depth = 0, count = 1;
        for (const ch of cells[1]) {
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
