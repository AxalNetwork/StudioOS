/**
 * Branch · Accounts — canvas S2, the half of S8 that is true, and the sentence
 * that expired (D129).
 *
 * WHAT THIS FILE IS FOR. Three failure modes, and the first one already
 * happened once:
 *
 *   1. A NOTICE THAT OUTLIVED ITS FACT. `/branch/accounts` said seats used
 *      "needs the seat assignment store, which is why this is not a number
 *      that can be shown today". D127 made that false — a branch counts its
 *      own seats from `users.role` — and the sentence survived the merge that
 *      falsified it. It is the THIRD expired promise in this programme:
 *      `routes/licence.ts` and `rpc/branchOps.ts` each carried one saying PR 5
 *      would build the store, and PR 5 shipped without it. A notice states a
 *      fact about the platform, so a literal scan refuses the retired sentence
 *      the way `founderZoneFilters.js` refuses `NO_VERDICT_SNAPSHOT`.
 *   2. A TILE THAT ROUNDS A PROBLEM AWAY. `free = licensed − used` goes
 *      negative when a branch holds more accounts of a type than HQ licensed.
 *      Clamping to zero renders "0 free", which is indistinguishable from
 *      exactly-full and hides the one condition on this screen that HQ needs
 *      told about. `seatState` is imported and called rather than scanned,
 *      because a regex cannot tell 87% from 88%.
 *   3. A PROP THE COMPONENT DOES NOT DECLARE. React discards it silently. PR A
 *      (D126) found three shipped HQ pages doing exactly this to `WorkerRail`
 *      and built the guard for that ONE component. The same class is open on
 *      every other component in the tree, and writing this page reproduced it
 *      immediately — four `Unreadable`/`Unrecorded` mounts passing `reason`
 *      and `what` that neither declares. So the rule here is widened to the
 *      two absence primitives, whose whole job is to be the honest state: one
 *      that silently renders nothing is worse than no primitive at all.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { seatState, AMBER_AT } from '../src/pages/branch/BranchAccounts.jsx';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const PAGE = raw('frontend/src/pages/branch/BranchAccounts.jsx');
const APP = raw('frontend/src/App.jsx');
const LICENCE = raw('cloudflare-worker/src/routes/licence.ts');
const CANVAS = raw('design/canvases/integrated/Admin · Subsidiary.dc.html');

/**
 * Blanks comments to spaces while KEEPING newlines, so a docblock quoting a
 * retired sentence cannot satisfy — or trip — a scan of the code. Line numbers
 * survive, which `codeOnly()` does not preserve because it deletes its matches.
 */
function blankComments(src) {
  let out = '';
  let i = 0;
  let mode = 'code';
  let quote = '';
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (mode === 'code') {
      if (two === '//') { mode = 'line'; out += '  '; i += 2; continue; }
      if (two === '/*') { mode = 'block'; out += '  '; i += 2; continue; }
      if (src[i] === '"' || src[i] === "'" || src[i] === '`') { mode = 'str'; quote = src[i]; }
      out += src[i]; i += 1; continue;
    }
    if (mode === 'str') {
      if (src[i] === '\\') { out += src.slice(i, i + 2); i += 2; continue; }
      if (src[i] === quote) mode = 'code';
      out += src[i]; i += 1; continue;
    }
    if (mode === 'line') {
      if (src[i] === '\n') { mode = 'code'; out += '\n'; } else out += ' ';
      i += 1; continue;
    }
    // block
    if (two === '*/') { mode = 'code'; out += '  '; i += 2; continue; }
    out += src[i] === '\n' ? '\n' : ' ';
    i += 1;
  }
  return out;
}

test('the retired seat-store sentence is gone, and cannot come back', () => {
  // The exact promise D127 falsified. Written here in pieces so this test file
  // is not itself the thing the scan finds — the guard on #595 read its own
  // docblock, which is how that lesson was earned.
  const RETIRED = ['seat', 'assignment', 'store'].join(' ');
  const offenders = [];
  const walk = (dir) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, ent.name);
      if (ent.isDirectory()) { walk(p); continue; }
      if (!/\.(jsx?|tsx?)$/.test(ent.name)) continue;
      let src;
      try { src = readFileSync(p, 'utf8'); } catch { continue; }
      if (src.toLowerCase().includes(RETIRED)) offenders.push(p);
    }
  };
  walk(resolve(process.cwd(), 'frontend/src'));
  assert.deepEqual(
    offenders,
    [],
    'a surface still promises a seat assignment store. D127 decided one does not ship: '
    + 'seats used is counted from users.role, and saying otherwise tells a branch admin '
    + 'to wait for something nobody is building.',
  );
});

test('/branch/accounts is a page, not a notice', () => {
  const at = APP.indexOf('path="/branch/accounts"');
  assert.ok(at > 0, 'the /branch/accounts route is gone');
  const el = APP.slice(at, at + 200);
  assert.match(el, /<BranchAccounts\b/, 'the route no longer renders the page');
  assert.doesNotMatch(
    el,
    /BranchZonePending/,
    'the route went back to a stated notice — the page it stands in for now exists',
  );
  // The page owns its own frame, because only it knows what its rail loaded.
  assert.match(PAGE, /<BranchZone\b/, 'the page dropped its BranchZone frame');
  assert.doesNotMatch(
    APP.slice(at, at + 200),
    /<BranchZone\b/,
    'the route wraps the page in a second BranchZone, which would mount two rails',
  );
});

test('a seat tile tells full from over-subscribed, at the boundary', () => {
  // The threshold is READ, not restated: an assertion hardcoding 0.88 passes
  // after somebody moves the tile to 0.9.
  assert.equal(typeof AMBER_AT, 'number');
  assert.ok(AMBER_AT > 0 && AMBER_AT < 1, 'the amber threshold is not a ratio');

  const licensed = 100;
  const justUnder = Math.floor(AMBER_AT * licensed) - 1;
  assert.equal(seatState(justUnder, licensed), 'ok', 'a tile below the threshold ambers');
  assert.equal(seatState(Math.ceil(AMBER_AT * licensed), licensed), 'tight', 'a tile at the threshold does not amber');
  assert.equal(seatState(licensed, licensed), 'tight', 'a full tile does not amber');

  // THE ONE THE CANVAS CANNOT DRAW AND THE PAGE MUST NOT ROUND AWAY.
  assert.equal(seatState(licensed + 1, licensed), 'over', 'over-subscription reads as merely tight');
  assert.equal(seatState(3, 0), 'over', 'accounts with no licensed seats read as something other than over');
  // Nothing licensed and nobody holding one is not a problem, and must not
  // amber a row that has no ratio to be measured against.
  assert.equal(seatState(0, 0), 'unlicensed', 'an unlicensed type with no accounts reads as a problem');

  // The page must render the overage, not just classify it.
  assert.match(PAGE, /over by/, 'the over state has no wording, so it renders as a colour only');
});

test('the tiles read the per-type breakdown, never the total', () => {
  const code = blankComments(PAGE);
  assert.match(code, /seats_used_by_type/, 'the page stopped reading the per-type count');
  // Deriving four tiles from one total is the shape that cannot be right; the
  // worker returns the breakdown precisely so the page never has to guess.
  assert.match(LICENCE, /seats_used_by_type/, 'the worker stopped sending the per-type count');
  // Every seat role gets a key, including the measured zeroes — a missing key
  // makes the page choose between rendering nothing and inventing a zero.
  assert.match(
    LICENCE,
    /for \(const role of SEAT_ROLES\) byType\[role\] = 0;/,
    'the worker no longer seeds every seat role, so a role with no accounts has no key',
  );
});

test('the members column is headed Role, because there is no seat id', () => {
  const code = blankComments(PAGE);
  // D127's stated consequence, and the canvas draws "Seat". A column headed
  // Seat with a role in it is the lie this page exists not to tell.
  assert.match(code, /<th[^>]*>Role<\/th>/, 'the members table lost its Role column');
  assert.doesNotMatch(code, /<th[^>]*>Seat<\/th>/, 'the members table headed a column Seat, which has nothing to put in it');
  // And the canvas really does draw Seat, so this is a deliberate divergence
  // rather than a column that was never asked for.
  const s2 = CANVAS.slice(CANVAS.indexOf('S2 · ACCOUNTS'), CANVAS.indexOf('S2 · ACCOUNTS') + 4000);
  assert.match(s2, /Seat/, 'the S2 artboard no longer draws a Seat column — this divergence may be stale');
});

test('the search says what it searches, and the table says it is a page', () => {
  const code = blankComments(PAGE);
  // S0 wall rule 2. A resting label, not a placeholder that vanishes on focus
  // exactly when the question is being asked.
  assert.match(code, /Searching \$\{brand\} accounts/, 'the scope caption is gone');
  assert.doesNotMatch(code, /placeholder=\{[^}]*Searching/, 'the scope moved into a placeholder, which vanishes on focus');
  // D128's rule, kept rather than re-broken on a new surface.
  assert.match(code, /branch-members-showing/, 'the table stopped saying how many of the total it shows');
});

test('more seats is an escalation, not an input', () => {
  const code = blankComments(PAGE);
  assert.match(code, /kind: 'seat_increase'/, 'the request no longer raises the escalation kind HQ reads');
  // A number input here would be a branch editing a licence term.
  assert.doesNotMatch(
    code,
    /type="number"/,
    'the page grew a number input — seats are set by HQ, so there is nothing here to type into',
  );
  assert.match(code, /branchEscalate/, 'the request path does not reach the escalation route');
});

test('no absence primitive is mounted with a prop it does not declare', () => {
  // THE WIDENED RULE. PR A built this for `WorkerRail` alone after three HQ
  // pages passed it `surface` and `title`, which it does not declare and React
  // discards. The allowed set is parsed from each component's own destructure,
  // so it cannot go stale the way a typed-in list does.
  const honesty = raw('frontend/src/ui/Honesty.jsx');
  const declared = {};
  for (const m of honesty.matchAll(/export function (Unrecorded|Unreadable)\(\{([^}]*)\}/g)) {
    declared[m[1]] = m[2]
      .split(',')
      .map((s) => s.split('=')[0].trim())
      .filter(Boolean);
  }
  assert.deepEqual(
    Object.keys(declared).sort(),
    ['Unreadable', 'Unrecorded'],
    'the absence primitives changed shape, so this guard is reading the wrong thing',
  );

  const ALWAYS_OK = new Set(['key', 'className', 'children']);
  const offenders = [];
  const walk = (dir) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, ent.name);
      if (ent.isDirectory()) { walk(p); continue; }
      if (!/\.(jsx|tsx)$/.test(ent.name)) continue;
      const src = blankComments(readFileSync(p, 'utf8'));
      for (const [comp, allowed] of Object.entries(declared)) {
        for (const m of src.matchAll(new RegExp(`<${comp}(\\s[^>]*?)?/?>`, 'gs'))) {
          const body = m[1] || '';
          let depth = 0;
          let i = 0;
          const names = [];
          while (i < body.length) {
            const ch = body[i];
            if (ch === '{') depth += 1;
            else if (ch === '}') depth -= 1;
            else if (depth === 0) {
              const am = /^([A-Za-z_][\w:-]*)\s*=/.exec(body.slice(i));
              if (am) { names.push(am[1]); i += am[0].length - 1; }
            }
            i += 1;
          }
          for (const n of names) {
            if (allowed.includes(n) || ALWAYS_OK.has(n) || n.startsWith('data-')) continue;
            offenders.push(`${p}: <${comp}> passes ${n}, which it does not declare`);
          }
        }
      }
    }
  };
  walk(resolve(process.cwd(), 'frontend/src'));
  assert.deepEqual(
    offenders,
    [],
    'an absence primitive was mounted with a prop it does not declare. React discards it '
    + 'silently, so the honest state renders without its reason — the same defect D126 found '
    + 'on WorkerRail.',
  );
});
