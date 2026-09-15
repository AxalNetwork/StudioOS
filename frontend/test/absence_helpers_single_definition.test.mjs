/**
 * One definition of each way a string says "the store has nothing".
 *
 * WHAT WENT WRONG. `frontend/src/lib/README.md` has said since it was written:
 * *"If a helper appears in two places, put it here once rather than a third
 * time."* Nothing checked it. Measured on `main` at 597f0f68c: `text` was
 * declared 16 times and the same function as `display` 3 more; a title-casing
 * helper existed 30 times under 14 names; `NOT_RECORDED` was exported twice.
 *
 * And they had drifted, in two ways a user can see:
 *
 *   1. `text('  x  ')` was `'x'` on twelve pages and `'  x  '` on the four
 *      Build pages, which tested trimmed-emptiness and then returned the value
 *      un-trimmed.
 *   2. Every founder title-caser ran AFTER its fallback had been substituted,
 *      so it re-cased a sentence a person wrote: `labelStage(null)` rendered
 *      **"Stage Not Recorded"**, `pretty(null)` rendered **"Not Recorded"**.
 *      `InvestorPortfolioPositions` cased first and fell back after, so the
 *      same null there read "Not recorded" — the same absence, two strings.
 *
 * WHY THE PROPERTY IS "DEFINED ONCE" AND NOT A COUNT. A count rots: it passes
 * as soon as somebody deletes one copy and adds another. One definition is the
 * thing that actually stops a twentieth `text` being typed, and it is the shape
 * #525 used when two hand-typed arrays of the same sixteen paths drifted.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { NOT_RECORDED, text, titleCase } from '../src/lib/absence.js';

const SRC = resolve(process.cwd(), 'frontend/src');
const HOME = 'lib/absence.js';

/** Every source file under frontend/src, as `path relative to src` → contents. */
function sources() {
  const out = new Map();
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { walk(full, rel); continue; }
      if (!/\.(js|jsx|ts|tsx)$/.test(rel)) continue;
      out.set(rel, readFileSync(full, 'utf8'));
    }
  };
  walk(SRC, '');
  return out;
}
const FILES = sources();

/** Files declaring something that matches `re`, excluding absence.js itself. */
const declaredIn = (re) =>
  [...FILES].filter(([rel, src]) => rel !== HOME && re.test(src)).map(([rel]) => rel).sort();

test('text is declared once, and nowhere under its old alias display', () => {
  assert.deepEqual(
    declaredIn(/const text = \(value, fallback = 'Not recorded'\)/),
    [],
    'a page re-declared `text` — import it from lib/absence instead',
  );
  // `display` is how three files hid from the first count of this duplication:
  // same body, different name. Both spellings have to be refused or the guard
  // only catches the rename it happens to know.
  assert.deepEqual(
    declaredIn(/const display = \(value, fallback = 'Not recorded'\)/),
    [],
    '`display` is `text` under another name — import `text` from lib/absence',
  );
});

test('NOT_RECORDED has one definition, and the two libs re-export it', () => {
  assert.deepEqual(
    declaredIn(/(?:export )?const NOT_RECORDED = 'Not recorded'/),
    [],
    'the constant was declared twice before — dealFlow.js and fundAnalytics.js',
  );
  // Both kept their public name so no import site had to move; assert that,
  // because silently dropping an export is how this fix would break callers.
  for (const lib of ['lib/dealFlow.js', 'lib/fundAnalytics.js']) {
    assert.match(FILES.get(lib), /export \{ NOT_RECORDED \}/,
      `${lib} stopped exporting NOT_RECORDED — its importers break`);
  }
});

/**
 * The title-casers this PR did not convert, with the reason they are deferred.
 *
 * Each is the same shape with its OWN fallback, and the HQ pair uses
 * `replaceAll('_', ' ')` rather than a regex. They convert in the follow-up;
 * doing them here would put a founder refactor and an investor copy change
 * behind one review. The list may only ever shrink.
 */
const DEFERRED_TITLE_CASERS = [
  'lib/advisor/router.js', 'lib/assessmentMeta.js', 'lib/signalsMeta.js',
  'pages/FundPerformancePage.jsx', 'pages/PortfolioGrowthPage.jsx',
  'pages/admin/AdminLpApplications.jsx',
  'pages/hq/HqHomePage.jsx', 'pages/hq/SecurityPage.jsx',
  'pages/insights/InsightsPage.jsx',
  'pages/investor/InvestorFundLPs.jsx', 'pages/investor/InvestorFundLanding.jsx',
  'pages/investor/InvestorFundReporting.jsx',
  'pages/investor/InvestorNetworkWorkspace.jsx',
  'pages/investor/InvestorPortfolioCanvas.jsx',
  // Kept deliberately: it is the reference for the correct ordering — it cases
  // first and falls back after, which is why its null reads "Not recorded".
  'pages/investor/InvestorPortfolioPositions.jsx',
  'pages/investor/InvestorPortfolioUpdates.jsx',
  'pages/partner/PartnerStudioHome.jsx', 'pages/pipeline/bucketing.js',
];

test('no new title-caser appears, and the deferred list only shrinks', () => {
  const found = declaredIn(/\.replace\(\/\\b\\w\/g/);
  const extra = found.filter((f) => !DEFERRED_TITLE_CASERS.includes(f));
  assert.deepEqual(extra, [], 'import titleCase from lib/absence rather than writing a 31st copy');

  // A ledger is only worth reading if every line still points at something —
  // the rule check-inline-project-pickers states for its own baseline.
  const stale = DEFERRED_TITLE_CASERS.filter((f) => !found.includes(f));
  assert.deepEqual(stale, [], 'these were converted or deleted — remove them from the list');

  // No founder page is on it: converting them is what this change was.
  assert.deepEqual(DEFERRED_TITLE_CASERS.filter((f) => f.includes('/founder/')), []);
});

test('titleCase takes no fallback, which is the whole fix', () => {
  // A fallback that passes THROUGH the caser comes out re-cased, so the job
  // here is to stop someone "helpfully" adding the second parameter back.
  //
  // NOT `titleCase.length === 1`, which is what this assertion said first and
  // which a mutation walked straight through: a DEFAULTED parameter does not
  // count toward `Function.length`, so `(value, fallback = NOT_RECORDED)`
  // still reports 1. The assertion could not fail on the change it existed to
  // catch. Assert the behaviour instead — a second argument must do nothing.
  assert.equal(titleCase(null, 'Stage not recorded'), '',
    'titleCase grew a fallback parameter — the fallback belongs at the call site');
  assert.equal(titleCase('   ', NOT_RECORDED), '');
  assert.equal(titleCase(null), '', 'an absent value must return empty so `|| fallback` works');
  assert.equal(titleCase(undefined), '');
  assert.equal(titleCase('   '), '');

  // The bug, from both sides. Before: text(v, 'Stage not recorded') then case.
  const broken = (v) => text(v, 'Stage not recorded').replace(/[_-]/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
  assert.equal(broken(null), 'Stage Not Recorded', 'this is what shipped');
  assert.equal(titleCase(null) || 'Stage not recorded', 'Stage not recorded', 'and this is the fix');
  assert.equal(titleCase(null) || NOT_RECORDED, 'Not recorded');
});

test('titleCase cases the value, and text trims it', () => {
  assert.equal(titleCase('in_progress'), 'In Progress');
  assert.equal(titleCase('due-diligence'), 'Due Diligence');

  // The four Build pages returned String(value) un-trimmed. They now do not.
  assert.equal(text('  x  '), 'x', 'padding is not part of the value');
  assert.equal(text(''), NOT_RECORDED);
  assert.equal(text('   '), NOT_RECORDED, 'whitespace-only is an absent value');
  assert.equal(text(null, 'Stage not recorded'), 'Stage not recorded');
  assert.equal(text(0), '0', 'zero is a value, not an absence — it must survive');
  assert.equal(text(false), 'false');
});

test('the home is where the README and the barrel say it is', () => {
  assert.ok(existsSync(resolve(SRC, HOME)));
  assert.match(readFileSync(resolve(SRC, 'ui/index.js'), 'utf8'),
    /export \{ NOT_RECORDED, text, titleCase \} from '\.\.\/lib\/absence'/,
    'ui/ is the one import surface its own header promises');
  assert.match(readFileSync(resolve(SRC, 'lib/README.md'), 'utf8'), /`absence\.js`/,
    'the folder table must name it — check-folder-docs reads this file');
});
