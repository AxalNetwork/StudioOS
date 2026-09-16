/**
 * Branch · Home — the three blocks that are real, and the three that say why
 * they are not (D131).
 *
 * WHAT THIS FILE IS FOR. This page's risk is not a wrong number, it is a
 * *plausible* one: S1 draws six blocks and three of them have no source, so
 * every shortcut on this screen produces something that looks measured.
 *
 *   1. THE NOTICE THAT PROMISED ALL SIX IS GONE, and the route is a page
 *      rather than `BranchZonePending`. Its sentence may not reappear anywhere
 *      under `frontend/src` — the `NO_VERDICT_SNAPSHOT` precedent.
 *   2. EVERY DEADLINE PRINTS ITS ZONE. The programme runs on
 *      America/New_York; a branch admin does not. The helper takes the zone as
 *      a REQUIRED argument, and this asserts that rather than the string,
 *      because a formatter that quietly fell back to the reader's zone is the
 *      exact wrong hour it exists to prevent.
 *   3. NO AMOUNT AND NO SPARKLINE. The share rate is real; the base is not
 *      totalled anywhere on a branch. A twelve-month chart of a number nobody
 *      measured is the most convincing wrong thing this page could show.
 *
 * The behaviour assertions IMPORT AND CALL the page's helpers rather than
 * scanning for them: a regex cannot tell 3500 bps rendered as 35% from 3500
 * rendered as 3500%, and that is the only mistake `pctFromBps` can make.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { pctFromBps, inZone } from '../src/pages/branch/BranchHome.jsx';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

/**
 * Comments blanked to spaces, newlines kept — the D130 helper, needed here for
 * the same reason it was needed there. This page's docblock quotes the retired
 * promise in order to say it is retired, so a scan that reads comments finds
 * the sentence in the very file that deleted it.
 */
function code(src) {
  const keep = (s) => s.replace(/[^\n]/g, ' ');
  let out = '';
  for (let i = 0; i < src.length;) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      const end = src.indexOf('\n', i);
      const stop = end < 0 ? src.length : end;
      out += keep(src.slice(i, stop));
      i = stop;
      continue;
    }
    if (c === '/' && d === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? src.length : end + 2;
      out += keep(src.slice(i, stop));
      i = stop;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      out += c;
      for (i++; i < src.length;) {
        if (src[i] === '\\') { out += src.slice(i, i + 2); i += 2; continue; }
        out += src[i];
        const done = src[i] === c;
        i++;
        if (done) break;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

const PAGE = raw('frontend/src/pages/branch/BranchHome.jsx');
const PAGE_CODE = code(PAGE);
const APP = raw('frontend/src/App.jsx');
const API = raw('frontend/src/lib/api.js');
const ROUTE = raw('cloudflare-worker/src/routes/branch_home.ts');
const SERVICE = raw('cloudflare-worker/src/services/branchHome.ts');

test('/branch is a page now, not a notice promising six blocks', () => {
  const at = APP.indexOf('path="/branch"');
  assert.ok(at > 0, '/branch must still be a registered route');
  const row = APP.slice(at, at + 160);
  assert.ok(row.includes('<BranchHome />'), '/branch must render the page');
  assert.ok(
    !row.includes('BranchZonePending'),
    '/branch still renders the pending notice, which promises three blocks this PR ships',
  );
  assert.match(API, /branchHome:/, 'the api method is gone');
  assert.match(ROUTE, /'\/home'/, 'the worker route is gone');
});

test('the retired promise cannot reappear anywhere under frontend/src', () => {
  // Assembled in pieces so this file is not itself what a future scan finds.
  const promise = ['queue pressure ordered by the oldest item', 'rather than by count'].join(' ');
  const hits = [];
  const walk = (dir) => {
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) { walk(p); continue; }
      if (!/\.(jsx?|tsx?)$/.test(e.name)) continue;
      let src = '';
      try { src = readFileSync(p, 'utf8'); } catch { continue; }
      if (code(src).includes(promise)) hits.push(p);
    }
  };
  walk(resolve(process.cwd(), 'frontend/src'));
  assert.deepEqual(hits, [], `the retired S1 promise is back at: ${hits.join(', ')}`);
  assert.ok(statSync(resolve(process.cwd(), 'frontend/src')).isDirectory());
});

test('a basis-point rate renders as a percentage, not as itself', () => {
  // IMPORTED AND CALLED. 3500 bps is 35%; a page that printed 3500% or 3.5%
  // would still match every regex a source scan could write.
  assert.equal(pctFromBps(3500), 35);
  assert.equal(pctFromBps(4000), 40);
  assert.equal(pctFromBps(3750), 37.5, 'a half point survives — rounding to a whole number loses it');
  assert.equal(pctFromBps(0), 0, 'a rate of zero is a rate, not an absence');
  assert.equal(pctFromBps(null), null, 'an absent rate is null, never 0%');
  assert.equal(pctFromBps(undefined), null);
  assert.equal(pctFromBps('not a rate'), null);
});

test('an instant formats in the zone it is GIVEN, never the reader\'s', () => {
  const iso = '2026-09-22T04:00:00.000Z';
  const ny = inZone(iso, 'America/New_York');
  const paris = inZone(iso, 'Europe/Paris');
  assert.ok(ny && paris, 'both zones must format');
  assert.notEqual(ny, paris,
    'the same instant reads differently in two zones — a formatter that ignored its zone argument '
    + 'would return the same string twice, and the deadline would be the wrong hour');
  assert.match(ny, /22 Sep/, 'midnight ET on the 22nd is the 22nd in New York');
  assert.match(paris, /22 Sep/);
  assert.match(ny, /00:00/, 'the deadline is midnight in the zone it is cut in');
  assert.match(paris, /06:00/, '…and six in the morning in Paris, which is the point');
  // A missing zone must refuse rather than silently using the reader's.
  assert.equal(inZone(iso, null), null);
  assert.equal(inZone(iso, ''), null);
  assert.equal(inZone(null, 'America/New_York'), null);
  assert.equal(inZone('not a date', 'America/New_York'), null);
});

test('the page prints the zone beside the deadline it governs', () => {
  assert.match(PAGE_CODE, /branch-home-zone/, 'the zone must be rendered, not merely received');
  assert.match(PAGE_CODE, /prog\.zone/, 'the zone comes from the payload, never a literal on the page');
  // And the formatter is called WITH it — a call with one argument would
  // return null and the deadline would read as unreadable rather than wrong,
  // but a later "fix" that defaulted the zone is what this pins against.
  assert.match(PAGE_CODE, /inZone\(prog\.week_closes_at,\s*prog\.zone\)/);
  assert.ok(
    !/America\/New_York/.test(PAGE_CODE),
    'the page hardcodes the programme zone — it must read the server\'s, or the two drift',
  );
});

test('the revenue block shows a rate and refuses an amount', () => {
  assert.match(PAGE_CODE, /branch-home-revenue-amount/, 'the absent amount must be rendered as a state');
  assert.match(PAGE_CODE, /<Unrecorded reason=\{rev\.reason\}>/,
    'the amount\'s reason must be the SERVER\'s — a reason typed on the page is a second copy that drifts');
  // No chart, no sparkline, no series. S1 draws twelve months of a number that
  // is not measured anywhere. `PieChart` is excluded ON PURPOSE and by name:
  // it is a lucide ICON in the card heading, and a bare /Chart/ matched it —
  // a first draft of this assertion failed on the page's own section icon,
  // which is a guard accusing its subject rather than catching a defect.
  assert.ok(
    !/sparkline|Sparkline|<svg|recharts|victory|d3-|<(Line|Area|Bar)Chart\b/.test(PAGE_CODE),
    'a chart on this page would be drawn from a base nothing totals',
  );
  assert.ok(
    !/amount_cents\s*\*|share_bps\s*\*|\*\s*rev\./.test(PAGE_CODE),
    'the page multiplies the rate by something — there is no base to multiply, so any product is invented',
  );
});

test('queue pressure reads the server\'s order and does not re-sort', () => {
  // THE ORDER IS THE SERVER'S ONE CLAIM. A `.sort()` here would be a second
  // definition of "worst", and the two would disagree the first time either
  // changed — the same argument the SLA bands travel on the payload for.
  assert.ok(
    !/queue_pressure[\s\S]{0,200}?\.sort\(/.test(PAGE_CODE),
    'the page re-sorts queue pressure, which makes a second definition of worst-first',
  );
  assert.match(SERVICE, /queue_pressure\.sort\(byPressure\)/, 'the server must be the one that sorts');
  assert.match(PAGE_CODE, /branch-home-lane-/, 'each lane must be addressable for the render assertions');
});

test('an unreadable lane renders its own state, never a zero', () => {
  assert.match(PAGE_CODE, /l\.count === null \? \(/, 'the null branch must exist and come first');
  assert.match(PAGE_CODE, /Not readable/);
  assert.ok(
    !/l\.count \|\| 0|\(l\.count \?\? 0\)/.test(PAGE_CODE),
    'a `|| 0` or `?? 0` on a lane count turns "could not read" into "nothing waiting"',
  );
});

test('the rail names what cannot be drawn, from the server\'s list', () => {
  assert.match(PAGE_CODE, /home\.unavailable \|\| \[\]/,
    'the unavailable list must come from the payload — a copy on the page is a second place to update');
  // And the server names all three, each with a reason rather than a label.
  for (const block of ['AI digest', 'Flagged by the rail', 'Local territory clock']) {
    assert.ok(ROUTE.includes(block), `the route stopped naming: ${block}`);
  }
  assert.ok(
    (ROUTE.match(/reason:/g) || []).length >= 3,
    'every unavailable block carries its own reason — a list of labels says nothing',
  );
});

test('coverage is derived from what loaded, never a typed list', () => {
  // THE RAIL MUST NEVER READ AS "NOTHING WAITING" WHILE LOADING OR AFTER A
  // FAILURE, which is what a static coverage array would do. The precedent is
  // `BranchApprovals`, whose coverage is built from the rows it actually got.
  assert.match(PAGE_CODE, /const coverage = ready/, 'coverage must be conditional on a successful load');
  assert.match(PAGE_CODE, /coverageNote=\{coverage\.length/,
    'with no coverage the rail must say why rather than staying silent');
  assert.match(PAGE_CODE, /of \$\{lanes\.length\} local queues/,
    'the coverage line must say how many lanes it is speaking for — a total over three of four '
    + 'reads as the whole territory');
});

test('the page mounts the honesty components with props they declare', () => {
  // D126'S RULE, WIDENED BY D129. React discards an undeclared prop silently,
  // so an honest state can render WITHOUT its reason — on the two components
  // whose entire job is to be the honest state.
  const honesty = raw('frontend/src/ui/Honesty.jsx');
  // D137 — NO REGEX BUILT FROM DATA (Semgrep 6112), and the stronger assertion
  // is the reason rather than the alert. The query was wrong about ReDoS — the
  // two names come from the literal object below — and right that the pattern
  // was weak: `[^}]*` stopped at the FIRST `}`, so a destructured prop whose
  // default is an object (`{ reason = {} }`) truncated the list and the guard
  // silently checked only its head. Balancing the braces reads the whole
  // signature and needs no pattern at all.
  const propsOf = (name) => {
    const head = `export function ${name}({`;
    const at = honesty.indexOf(head);
    assert.ok(at >= 0, `${name} must still be a destructuring component`);
    let depth = 1;
    let i = at + head.length;
    for (; i < honesty.length && depth > 0; i += 1) {
      if (honesty[i] === '{') depth += 1;
      else if (honesty[i] === '}') depth -= 1;
    }
    assert.equal(depth, 0, `${name}'s destructured prop list is unterminated`);
    // Split on top-level commas only, for the same reason: a nested default
    // would otherwise contribute its own commas as if they were prop names.
    const inner = honesty.slice(at + head.length, i - 1);
    const parts = [];
    let nest = 0;
    let start = 0;
    for (let k = 0; k < inner.length; k += 1) {
      const ch = inner[k];
      if (ch === '{' || ch === '[' || ch === '(') nest += 1;
      else if (ch === '}' || ch === ']' || ch === ')') nest -= 1;
      else if (ch === ',' && nest === 0) { parts.push(inner.slice(start, k)); start = k + 1; }
    }
    parts.push(inner.slice(start));
    return parts.map((s) => s.trim().split(/[=:]/)[0].trim()).filter(Boolean);
  };
  // The same claim the `<${name}\\b([^>]*)>` regex made, as a literal scan. The
  // word-boundary check is explicit so `<Unreadable` cannot match a longer
  // component name that starts with it.
  const usagesOf = (name) => {
    const out = [];
    const open = `<${name}`;
    for (let at = PAGE_CODE.indexOf(open); at >= 0; at = PAGE_CODE.indexOf(open, at + 1)) {
      const after = PAGE_CODE[at + open.length];
      if (after && /[\w$]/.test(after)) continue;
      const end = PAGE_CODE.indexOf('>', at);
      if (end < 0) continue;
      out.push(PAGE_CODE.slice(at + open.length, end));
    }
    return out;
  };
  const allowed = { Unrecorded: propsOf('Unrecorded'), Unreadable: propsOf('Unreadable') };
  for (const [name, ok] of Object.entries(allowed)) {
    assert.ok(ok.length > 0, `${name} parsed as declaring no props — the scan is broken, not the page`);
    for (const attrs of usagesOf(name)) {
      for (const attr of attrs.matchAll(/([a-zA-Z][\w-]*)=/g)) {
        assert.ok(
          ok.includes(attr[1]),
          `<${name}> is passed "${attr[1]}", which it does not declare — React drops it, so the `
          + `honest state renders without it. Declared: ${ok.join(', ')}`,
        );
      }
    }
  }
});

test('the page wraps itself in BranchZone exactly once', () => {
  assert.equal((PAGE_CODE.match(/<BranchZone\b/g) || []).length, 1);
  assert.equal((PAGE_CODE.match(/<\/BranchZone>/g) || []).length, 1);
  // And the route does NOT wrap it a second time, which is how a page ends up
  // with two AI rails.
  const at = APP.indexOf('path="/branch"');
  assert.ok(!APP.slice(at, at + 160).includes('<BranchZone'), '/branch double-wraps the page');
});
