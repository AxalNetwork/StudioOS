/**
 * Branch · Approvals — the board that replaced a notice, and the link that is
 * deliberately absent (D130).
 *
 * WHAT THIS FILE IS FOR. Three things this page can get wrong, and the third
 * is a finding rather than a style rule:
 *
 *   1. THE NOTICE OUTLIVING ITS FACT, which is the class D129 was written
 *      about. `BranchZonePending` promised *"the read model that makes them
 *      one board"* as PR 13's work. PR 13 is this, so the promise must be gone
 *      — and what replaces it in the rail's `unavailable` list must be the
 *      NARROWER true thing (assignment, history, the AI note) rather than
 *      nothing at all. Narrowing rather than deleting is the D111 pattern.
 *   2. THE BOARD DECIDING. It reads four stores it does not own. An Approve
 *      button here would be a fifth writer restating four sets of rules, and
 *      restating a rule is how the copies drift. The payload says
 *      `decides: false`; the page must not contradict it.
 *   3. A LINK TO A CONSOLE THAT DOES NOT EXIST. Measured, not assumed:
 *      `api.adminSpinoutModeration` and `adminSpinoutModerationDecide` have
 *      **zero callers in `frontend/src`**, so spinout moderation has a Worker
 *      route, an api method, a place in the backlog count and now a place on
 *      this board — and no screen on which to decide it. The row says so. A
 *      link would 404, which `sidebarConfig.js` names as worse than no link:
 *      it looks shipped.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

/**
 * Comments blanked to spaces, newlines kept.
 *
 * BOTH SCANS IN THIS FILE NEEDED IT, AND BOTH FAILED WITHOUT IT — which is the
 * fourth time this session a guard has read its own subject's prose and
 * accused it. The page's docblock quotes the retired promise (to say it is
 * retired) and names `api.adminSpinoutModeration` (to say nothing calls it),
 * so a scanner reading comments concludes the opposite of the truth in both
 * cases. Blanking in place rather than deleting keeps every index where it was.
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

const PAGE = raw('frontend/src/pages/branch/BranchApprovals.jsx');
const PAGE_CODE = code(PAGE);
const APP = raw('frontend/src/App.jsx');
const ADMIN_PAGE = raw('frontend/src/pages/AdminPage.jsx');
const API = raw('frontend/src/lib/api.js');
const ROUTE = raw('cloudflare-worker/src/routes/branch_approvals.ts');
const SOURCES = raw('cloudflare-worker/src/services/approvalSources.ts');
const BRANCH_OPS = raw('cloudflare-worker/src/rpc/branchOps.ts');
const CANVAS = raw('design/canvases/integrated/Admin · Subsidiary.dc.html');

test('the board exists, and the promise it fulfilled is gone', () => {
  assert.match(PAGE, /branch-board-rows/, 'the page lost its board');
  assert.match(API, /branchApprovals:/, 'the api method is gone');
  // The retired sentence, in pieces so this file is not what the scan finds.
  const promise = ['read model that makes them', 'one board'].join(' ');
  assert.ok(
    !PAGE_CODE.includes(promise),
    'the page still promises the read model as future work — PR 13 IS the read model',
  );
  // And what replaced it in the rail is NARROWER rather than absent: the
  // things that genuinely still have no store.
  assert.match(PAGE, /Assignment and history/, 'the rail stopped naming what is still missing');
  assert.match(PAGE, /AI-drafted decision note/, 'the AI note refusal is gone');
});

test('the board reads; it does not decide', () => {
  assert.match(ROUTE, /decides: false/, 'the payload stopped saying the board does not decide');
  // No write verb on this route. A POST/PATCH here would be the fifth writer.
  assert.doesNotMatch(ROUTE, /r\.(post|patch|put|delete)\(/, 'the board route grew a write');
  assert.doesNotMatch(
    PAGE.slice(PAGE.indexOf('branch-board-rows')),
    /Approve|Decline/,
    'the board grew a decision control for a store this page does not write',
  );
});

test('spinout moderation has no console, and the row says so', () => {
  // The finding, re-measured here rather than trusted: if somebody builds the
  // moderation console, this test tells them to make the row link to it.
  const callers = [];
  const walk = (dir) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, ent.name);
      if (ent.isDirectory()) { walk(p); continue; }
      if (!/\.(jsx?|tsx?)$/.test(ent.name)) continue;
      if (p.endsWith(join('lib', 'api.js'))) continue;   // the declaration, not a caller
      const src = code(readFileSync(p, 'utf8'));
      if (/adminSpinoutModeration/.test(src)) callers.push(p);
    }
  };
  walk(resolve(process.cwd(), 'frontend/src'));

  if (callers.length === 0) {
    assert.match(PAGE, /moderation: null/, 'the lane must have no console entry while no page calls it');
    assert.match(PAGE, /no console/, 'the row must say the decision surface does not exist');
  } else {
    assert.fail(
      `A spinout moderation console now exists (${callers.join(', ')}). `
      + 'Give the moderation lane its `LANE_CONSOLE` entry so its rows link to it, and delete '
      + 'the "no console" copy — this branch of the test is the reminder.',
    );
  }
});

test('every console a lane DOES link to is a registered route', () => {
  // The other half: a link that 404s looks shipped, which `sidebarConfig.js`
  // calls worse than a missing row. `/admin/spinout-lab` in particular is
  // where the cohort panel is RENDERED rather than routed on its own — a
  // `/admin/cohort` link would have 404'd, and this is what caught that.
  const block = PAGE.slice(PAGE.indexOf('const LANE_CONSOLE'), PAGE.indexOf('const VIEWS'));
  const tos = [...block.matchAll(/to: '([^']+)'/g)].map((m) => m[1]);
  assert.ok(tos.length >= 3, `expected at least three console links, found ${tos.length}`);
  for (const to of tos) {
    // S16 (D215): KYC and partner profiles are TABS of `/admin`, reached by
    // `?tab=`. The path must be routed AND the tab must exist, or the link
    // lands on the admin page's default tab — shipped-looking, and wrong.
    const [path, query] = to.split('?');
    assert.ok(
      APP.includes(`path="${path}"`),
      `${path} is not a registered route in App.jsx — a link that 404s looks shipped`,
    );
    const tab = query && new URLSearchParams(query).get('tab');
    if (tab) {
      assert.ok(ADMIN_PAGE.includes(`value: '${tab}'`), `/admin has no '${tab}' tab for ${to}`);
    }
  }
});

test('one list of sources, read by both the board and the backlog count', () => {
  // The consolidation, asserted on the CONSUMER rather than on the new file:
  // a test that only checked `approvalSources.ts` exists would pass while
  // `backlogOf` kept its own copy.
  //
  // THE IMPORT IS ASSERTED, NOT THE IDENTIFIER, and the difference is a
  // correct change that failed here once. The first draft pinned
  // `APPROVAL_SOURCES` by name; D131 moved `backlogOf` onto `laneCounts` —
  // the same list read one level up, so the total is the sum of the parts by
  // construction — and a guard on the name called that a regression. What
  // matters is that `branchOps` reads the shared module at all, whichever
  // shape it takes from it.
  assert.match(
    BRANCH_OPS,
    /import \{[^}]+\} from '\.\.\/services\/approvalSources'/,
    'backlogOf stopped reading the shared list',
  );
  assert.doesNotMatch(
    BRANCH_OPS,
    /FROM lp_applications WHERE status = 'pending'/,
    'backlogOf re-declared a source predicate, which is the drift this PR removed',
  );
  // The two traps the shared list exists to hold, pinned by name.
  assert.match(SOURCES, /cohort_applicants/, 'the cohort table is the applicant row, not spinout_applications');
  assert.doesNotMatch(SOURCES, /FROM spinout_applications/, 'the wrong cohort table came back');
  assert.match(SOURCES, /under_review/, "a moderation case awaiting a decision is 'under_review'");
  assert.match(SOURCES, /!== 'draft'/, 'a draft referral is not reviewer backlog');
});

test('the SLA bands come from the server, not from the page', () => {
  // D108 made this call for escalations: a band recomputed in the browser is a
  // second definition that drifts the first time one of them changes.
  assert.match(ROUTE, /sla_bands/, 'the route stopped sending its band thresholds');
  const board = PAGE.slice(PAGE.indexOf('branch-board-rows'));
  assert.doesNotMatch(board, /age_hours\s*[><]=?\s*\d/, 'the page recomputed a band from raw hours');
  assert.match(PAGE, /it\.sla === 'past'/, 'the page must read the band the server derived');
});

test('the artboard still draws what this page claims to be', () => {
  // So the divergence stays deliberate rather than quietly going stale.
  //
  // RE-AIMED BY D195, NOT LOOSENED. The canvas this page was built against
  // said "five lanes"; the export D195 landed says "five columns" and
  // "absorbs five formerly separate queues". The wording moved, the property
  // did not, so the assertion follows the property. What it must NOT become
  // is /five/, which any of a dozen sentences on the artboard satisfies.
  const at = CANVAS.indexOf('S3 · APPROVALS');
  const end = CANVAS.indexOf('id="s4"');
  assert.ok(at > 0, 'the S3 artboard is gone from the canvas');
  assert.ok(end > at, 'S4 no longer follows S3, so S3 has no end bound');
  // Bounded at BOTH ends now. The old `at + 7000` overshot the artboard by
  // about a thousand characters into S4, so a phrase belonging to the next
  // screen could satisfy an assertion about this one.
  const s3 = CANVAS.slice(at, end).replaceAll('&amp;', '&');
  assert.match(s3, /five columns/i, 'S3 no longer describes a five-column board');
  assert.match(s3, /oldest/i, 'S3 no longer orders by age, which is the board\'s whole claim');
  // The canvas draws assignment and the AI note; the page refuses both with a
  // reason. If the canvas ever stops drawing them, the refusals are stale.
  assert.match(s3, /assign to reviewer/i, 'the assignment refusal may be stale');
  assert.match(s3, /decision note/i, 'the AI-note refusal may be stale');

  // TWO THINGS D195's EXPORT ADDED, AND THE PAGE IS NEITHER OF THEM YET.
  // Asserted here so the divergence is on the record and fails if the canvas
  // quietly reverts — which is the only way this file can tell the difference
  // between "the design moved on" and "somebody edited the export".
  //
  //   1 · Which five columns is now decided by AGE rather than being a fixed
  //       order, so the board always shows the lanes that are hurting. The
  //       shipped board's columns are fixed.
  //   2 · The board is the SECOND view. The primary view — every lane
  //       reachable, one age-sorted list — is S16, which does not exist as a
  //       page. That is why this test is named for what the page CLAIMS to be
  //       rather than for what the artboard is.
  assert.match(s3, /decided by age/i,
    'S3 stopped saying its five columns are chosen by age — the board is a fixed order again');
  assert.match(s3, /primary view/i,
    'S3 stopped naming a primary view, so the "this board is the second view" divergence is stale');
  assert.match(s3, /S16/,
    'S3 stopped pointing at S16, so the unbuilt primary view is no longer on the record here');
});
