/**
 * The founder honest pass: 21 zones, the canvas's own labels, and the promise
 * behind each one.
 *
 * WHAT THIS FILE IS DEFENDING. The request that produced this work was that
 * every subpage carry its data-entry actions. The way to fail it quietly is to
 * draw the buttons and wire none of them — a page then LOOKS finished and does
 * nothing, which is worse than the empty header it replaced, because the reader
 * now believes they tried. So the assertions below are about the promise, not
 * the pixels: the labels are the canvas's, every link goes somewhere a founder
 * may actually open, and anything that performs nothing is prose.
 *
 * Run with:
 *   node --test frontend/test/founder_zone_actions.test.mjs
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

const TABLE = read('frontend/src/workspaces/founderZoneActions.js');
const APP = read('frontend/src/App.jsx');

/** The zone → labels map, evaluated out of the module's own literal. */
function tableLabels() {
  const start = TABLE.indexOf('export const FOUNDER_ZONE_ACTIONS');
  const body = TABLE.slice(start, TABLE.indexOf('\n};', start));
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

/** Every founder artboard's `route` and its `ops` array, from the canvases. */
function canvasOps() {
  const dir = 'design/canvases/integrated';
  const files = readdirSync(resolve(root, dir)).filter((f) => /^Pages · Founder /.test(f));
  const out = {};
  for (const f of files) {
    const src = read(`${dir}/${f}`);
    for (const chunk of src.split(/route:\s*'/).slice(1)) {
      const route = chunk.slice(0, chunk.indexOf("'"));
      const ops = chunk.match(/ops:\s*\[([^\]]*)\]/);
      if (!ops) continue;
      out[route.replace(/^\//, '')] = [...ops[1].matchAll(/'([^']*)'/g)].map((m) => m[1]);
    }
  }
  return out;
}

test('every zone lists exactly the canvas\'s actions, in the canvas\'s order', () => {
  const table = tableLabels();
  const canvas = canvasOps();
  assert.equal(Object.keys(table).length, 21, 'the founder profile has 21 zone pages');
  for (const [zone, labels] of Object.entries(table)) {
    assert.ok(canvas[zone], `${zone} has no artboard — where did its labels come from?`);
    // Order matters: the canvas puts the destructive or configuring action
    // last, and re-ordering them here would quietly re-rank them on screen.
    assert.deepEqual(labels, canvas[zone], `${zone} does not match its artboard's ops`);
  }
  // And nothing in a founder canvas was skipped.
  const founderRoutes = Object.keys(canvas).filter((r) => /^(build|grow|network|raise)\//.test(r));
  assert.deepEqual(founderRoutes.sort(), Object.keys(table).sort(),
    'a founder artboard specifies actions for a zone this table does not cover');
});

test('every link is a route a founder is allowed to open', () => {
  const links = [...TABLE.matchAll(/to: '([^']+)'/g)].map((m) => m[1]);
  assert.ok(links.length >= 15, `expected the linked actions, found ${links.length}`);
  for (const link of new Set(links)) {
    const path = link.split('?')[0];
    const i = APP.indexOf(`path="${path}"`);
    assert.ok(i > 0, `${path} is not a route App.jsx mounts`);
    // The guard is the first `[...]` after the path — either a bare array or
    // one wrapped in labRoles(...), which only ever ADDS the caller's own role.
    const decl = APP.slice(i, i + 400);
    const roles = decl.match(/guard\((?:labRoles\()?\[([^\]]*)\]/);
    assert.ok(roles, `${path} does not go through guard()`);
    assert.match(roles[1], /'founder'/, `${path} is mounted, but not for a founder`);
  }
});

test('a note never points at a path, because prose is not checked', () => {
  // Every `to` in this table is verified against the router by the test above.
  // A note is prose and nothing verifies it, so a note that says "go to
  // /matches" is an unchecked link wearing a sentence — and /matches is exactly
  // the route a founder cannot open. Notes name surfaces the way a person
  // would ("the deck builder"), and the checked field carries the path.
  const notes = [...TABLE.matchAll(/note: '([^']*)'/g)].map((m) => m[1]);
  assert.ok(notes.length >= 25, `expected the stated gaps, found ${notes.length}`);
  for (const note of notes) {
    assert.doesNotMatch(note, /(^|\s)\/[a-z]/, `a note carries an unchecked path: "${note}"`);
  }
});

test('no action is given both a destination and an excuse', () => {
  // The builder prefers `to`, so a `note` beside it would never be read — the
  // gap would be recorded in the source and invisible on screen. `linkNote` is
  // the deliberate way to qualify a link, and it renders as the title.
  const entries = [...TABLE.matchAll(/^ {4}\{ label: '[^']+',([^\n]*)$/gm)].map((m) => m[1]);
  assert.ok(entries.length >= 55, `expected every action, found ${entries.length}`);
  for (const rest of entries) {
    assert.ok(!(/\bto: /.test(rest) && /\bnote: /.test(rest)),
      `an action declares both a destination and a gap: ${rest.trim()}`);
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

test('every zone page mounts its own zone, and only its own', () => {
  const dir = 'frontend/src/pages/founder';
  const table = tableLabels();
  const seen = new Set();
  for (const f of readdirSync(resolve(root, dir)).filter((f) => f.endsWith('.jsx'))) {
    const src = read(`${dir}/${f}`);
    const calls = [...src.matchAll(/founderZoneActions\('([^']+)'/g)].map((m) => m[1]);
    if (!calls.length) continue;
    assert.equal(calls.length, 1, `${f} mounts ${calls.length} zone action rows`);
    assert.ok(table[calls[0]], `${f} names a zone the table does not declare: ${calls[0]}`);
    assert.ok(!seen.has(calls[0]), `${calls[0]} is mounted by more than one page`);
    seen.add(calls[0]);
    // It belongs in the zone header, which is the one place the canvas draws
    // it — not floating in the body where it reads as a card's toolbar.
    const at = src.indexOf('<ZoneActions');
    const nav = src.search(/<nav\b[^>]*aria-label="[A-Za-z ]+ sections"/);
    assert.ok(nav > 0 && at > nav, `${f} renders its actions before the zone nav`);
  }
  assert.equal(seen.size, 21, `21 zones declared, ${seen.size} mounted`);
});

test('a zone row names only variables its page actually has', () => {
  // `scope: project?.name` on a page with no `project` is a ReferenceError that
  // blanks the whole route at render — and it is NOT a build error: esbuild
  // bundles it happily, and this repo has no lint step to catch it. It shipped
  // into one of these twenty-one pages and only a browser found it.
  const dir = 'frontend/src/pages/founder';
  const KNOWN = new Set(['true', 'false', 'null', 'undefined', 'Number', 'String',
    'Boolean', 'Array', 'Object', 'Math', 'JSON', 'Date', 'founderZoneActions']);
  let checked = 0;
  for (const f of readdirSync(resolve(root, dir)).filter((f) => f.endsWith('.jsx'))) {
    const src = read(`${dir}/${f}`);
    const at = src.indexOf("founderZoneActions('");
    if (at < 0) continue;
    const call = src.slice(at, src.indexOf('} />', at));
    const bare = call
      // A template literal is text plus real expressions: keep the `${…}`
      // bodies, drop the rest, or `?project_id=${id}` contributes a bare `$`.
      .replace(/`([^`]*)`/g, (_m, inner) => [...inner.matchAll(/\$\{([^}]*)\}/g)].map((x) => x[1]).join(' '))
      .replace(/'[^']*'/g, "''")           // string literals
      .replace(/\b[A-Za-z_$][\w$]*\s*:/g, '')  // object keys
      .replace(/\.[A-Za-z_$][\w$]*/g, '');    // property access
    // An arrow's own parameter is declared right there — `cells: (r) => [r.x]`
    // leaves a bare `r` once the property is stripped, and it is not a page
    // variable. Collect the parameters instead of pretending they are.
    const params = new Set([...call.matchAll(/\(\s*([A-Za-z_$][\w$]*)\s*\)\s*=>/g)].map((m) => m[1]));
    for (const id of new Set([...bare.matchAll(/[A-Za-z_$][\w$]*/g)].map((m) => m[0]))) {
      if (KNOWN.has(id) || params.has(id)) continue;
      const declared = new RegExp(`(const|let|var|function|import)[^\n;]*\\b${id}\\b`).test(src);
      assert.ok(declared, `${f} passes \`${id}\` to its zone row, and never declares it`);
      checked += 1;
    }
  }
  assert.ok(checked >= 40, `expected every referenced name to be checked, saw ${checked}`);
});

test('a zone row is never sealed inside a header that does not render', () => {
  // The three Network zones only ever mount through NetworkWorkspace, which
  // passes `embedded` — so their own `{!embedded && <header>…}` block is dead
  // on the route a founder opens. The actions row placed inside it rendered
  // nowhere on all three, and every source assertion still passed.
  const dir = 'frontend/src/pages/founder';
  let guarded = 0;
  for (const f of readdirSync(resolve(root, dir)).filter((f) => f.endsWith('.jsx'))) {
    const src = read(`${dir}/${f}`);
    if (!src.includes('<ZoneActions')) continue;
    const at = src.indexOf('{!embedded &&');
    if (at < 0) continue;
    guarded += 1;
    const block = src.slice(at, src.indexOf('</header>}', at));
    assert.ok(!block.includes('<ZoneActions'),
      `${f} hides its actions behind !embedded, on a route that is always embedded`);
  }
  assert.equal(guarded, 3, `expected the three Network zones to carry the guard, saw ${guarded}`);
});

test('an export names the columns it writes, and fills every one', () => {
  const dir = 'frontend/src/pages/founder';
  let checked = 0;
  for (const f of readdirSync(resolve(root, dir)).filter((f) => f.endsWith('.jsx'))) {
    const src = read(`${dir}/${f}`);
    if (!src.includes('founderZoneActions(')) continue;
    const header = src.match(/header: \[([^\]]*)\]/);
    if (!header) continue;              // a zone whose canvas asks for no export
    const cells = src.match(/cells: \([a-z]\) => \[(.*?)\] \}/);
    assert.ok(cells, `${f} declares export columns but no row mapping`);
    const cols = [...header[1].matchAll(/'/g)].length / 2;
    // Top-level commas only: an accessor may itself carry brackets or calls.
    let depth = 0, count = 1;
    for (const ch of cells[1]) {
      if ('([{'.includes(ch)) depth += 1;
      else if (')]}'.includes(ch)) depth -= 1;
      else if (ch === ',' && depth === 0) count += 1;
    }
    assert.equal(count, cols, `${f} writes ${count} values under ${cols} column headings`);
    checked += 1;
  }
  assert.ok(checked >= 13, `expected every exporting zone to be checked, saw ${checked}`);
});

test('the client CSV escapes exactly as the worker does', () => {
  // Three copies of this function already disagree in this repo; a fourth
  // drifting a fifth way is the failure that consolidating them was meant to
  // end. A bare carriage return left unquoted splits a record for any RFC 4180
  // reader, which is how a founder's export loses half its rows.
  // The reason this reads through `codeOnly`: the docblock of the file under
  // test QUOTES the rule it implements, so a check against the raw source
  // passes on the comment while the code says something else. That mutation
  // survived once here before this line existed.
  const client = codeOnly(read('frontend/src/lib/csvExport.js'));
  const worker = codeOnly(read('cloudflare-worker/src/services/csv.ts'));
  const rule = /\[",\\n\\r\]/;
  assert.match(client, rule, 'the client CSV does not quote on all four characters');
  assert.match(worker, rule, 'the worker CSV rule moved — this test is now comparing to nothing');
  assert.match(client, /replace\(\/"\/g, '""'\)/, 'a quote inside a cell is not doubled');
  // A file with a header row and no body reads as "there is no data".
  assert.match(client, /if \(!list\.length\) return false;/,
    'exportView writes an empty file instead of refusing');
});

test('the label says the export is of this view, because it is', () => {
  // It exports the rows the page has LOADED, which on most zones is a capped
  // page. "Export" over a truncated list, with no hint of the truncation, is
  // how a founder pastes twenty-five of two hundred rows into an update.
  assert.match(TABLE, /label: `\$\{item\.label\} · this view`/,
    'the export button no longer says which rows it covers');
  assert.match(read('frontend/src/lib/csvExport.js'), /\$\{list\.length\}-rows/,
    'the filename no longer carries the row count');
  assert.match(TABLE, /note: 'nothing loaded to export yet'/,
    'an export with no rows is offered as a button');
});
