import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runCost, batchCost, spendMeter, formatCost } from '../src/ui/assistCost.js';

const root = resolve(process.cwd());
const read = (p) => readFileSync(resolve(root, p), 'utf8');

// Two earlier assertions in this repo passed by matching a string that only
// existed in a comment, so everything below reads comment-stripped source.
// It has to be a scanner rather than a regex: a regex stripper treats the
// `/*` inside <Route path="/auth/recover/*"> as a block-comment opener and
// silently eats the next few hundred lines, which is how this same check
// first reported four functions App.jsx plainly declares as undefined.
// `blankStrings` additionally empties '...' and "..." (leaving template
// literals, whose ${} holds real code) so identifiers quoted in copy are not
// mistaken for references.
function scan(src, { blankStrings = false } = {}) {
  let out = '';
  for (let i = 0; i < src.length; ) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      const drop = blankStrings && quote !== '`';
      out += c;
      for (i++; i < src.length; ) {
        if (src[i] === '\\') { if (!drop) out += src.slice(i, i + 2); i += 2; continue; }
        const end = src[i] === quote;
        if (end || !drop) out += src[i];
        i++;
        if (end) break;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

const code = (p) => scan(read(p));

// --- The arithmetic ------------------------------------------------------
// Six of the eight rail canvases carry a comment insisting the pre-run estimate
// and the post-run receipt come from ONE calculation. Two functions drifting is
// how a user gets quoted one price and charged another, so this is the guard.

test('run cost matches the canvases own numbers', () => {
  // AIRail's first page profile, lifted from the canvas.
  const cost = runCost({ tin: 21400, tout: 1180, pin: 0.293, pout: 2.253 });
  assert.equal(formatCost(cost), '$0.0089');
  // Prices are per 1M tokens — doubling tokens must double cost, not scale oddly.
  const dbl = runCost({ tin: 42800, tout: 2360, pin: 0.293, pout: 2.253 });
  assert.ok(Math.abs(dbl - cost * 2) < 1e-12);
});

test('cached input discounts the input side only — output is never cached', () => {
  const p = { tin: 1_000_000, tout: 1_000_000, pin: 10, pout: 20, cachedIn: 1 };
  assert.equal(runCost(p), 30);                       // 10 + 20
  assert.equal(runCost(p, { cached: true }), 21);     // 1 + 20, NOT 3
});

test('a batch with no ops costs exactly one run', () => {
  const p = { tin: 5900, tout: 680, pin: 0.045, pout: 0.384 };
  assert.equal(batchCost(p, []), runCost(p));
  // costFactor weights a cheaper assist without inventing a second profile.
  assert.ok(Math.abs(batchCost(p, [{ op: 'a' }, { op: 'b', costFactor: 0.5 }]) - runCost(p) * 1.5) < 1e-12);
});

test('the spend meter clamps its bar but tells the truth about being over', () => {
  const under = spendMeter(12.5, 40);
  assert.equal(under.fraction, 0.3125);
  assert.equal(under.over, false);
  const over = spendMeter(48, 40);
  assert.equal(over.fraction, 1, 'the bar must never render past its track');
  assert.equal(over.over, true, 'but the caller must still know it is over cap');
  assert.ok(over.ratio > 1);
  // No cap configured must not divide by zero.
  assert.equal(spendMeter(5, 0).fraction, 0);
});

// --- The components ------------------------------------------------------

test('AssistRail is the AI rail, not navigation', () => {
  const src = read('frontend/src/ui/AssistRail.jsx');
  // The whole point of DECISIONS.md T3: these canvases have zero route links.
  assert.doesNotMatch(src, /<NavLink|<Link\b|react-router/,
    'AssistRail must not grow navigation — that is SidebarNav');
  // ForgeRail's boundary is the product rule, so the slot must exist.
  assert.match(src, /guardrail/);
  for (const kind of ['choice', 'fixed', 'inherited']) {
    assert.ok(src.includes(`'${kind}'`), `mode.kind '${kind}' must be handled`);
  }
});

test('SidebarNav was lifted out of App.jsx, not duplicated', () => {
  const app = read('frontend/src/App.jsx');
  const nav = code('frontend/src/ui/SidebarNav.jsx');
  assert.doesNotMatch(app, /^function SidebarNav\(/m, 'App.jsx must no longer define it');
  assert.match(app, /import SidebarNav from '\.\/ui\/SidebarNav'/);
  assert.match(app, /<SidebarNav\b/, 'ProtectedLayout must still render it');
  assert.match(nav, /^export default function SidebarNav\(/m);
  // The behaviours the census said this implementation wins on — if a later
  // "cleanup" drops one, the canvas rail is no longer the weaker option.
  assert.match(nav, /collapsed/, 'collapsed mode');
  assert.match(nav, /aria-label="Search sidebar"/, 'the sidebar search filter');
});

// Lifting SidebarNav out of App.jsx moved the code but not its scope: eleven
// names it calls were never imported into the new module. useCallback runs on
// the first render, so the sidebar threw before it painted a single item.
// Nothing caught it — Vite transpiles rather than type-checks, the repo has no
// eslint, and this very test file originally "proved" the tier locks survived
// by matching the string PaywallModal inside a COMMENT. CodeQL found three of
// the eleven; the resolver below found the other eight. So: resolve every free
// name in ui/ for real, on every file, forever.

const UI_FILES = ['AssistRail.jsx', 'SidebarNav.jsx', 'CompanySwitcher.jsx'];
const JS_KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'typeof',
  'await', 'super', 'new', 'delete', 'void', 'in', 'of', 'do', 'else', 'yield',
  'async',
]);

function freeNames(raw) {
  const src = scan(raw, { blankStrings: true });
  const bound = new Set();
  // import bindings, default + named + `as` renames
  for (const m of src.matchAll(/^import\s+([\s\S]+?)\s+from\s+'[^']*'/gm)) {
    for (const name of m[1].replace(/[{}]/g, ',').split(',')) {
      const b = name.trim().split(/\s+as\s+/).pop().trim();
      if (b) bound.add(b);
    }
  }
  // declarations, array destructuring, and object destructuring incl. `icon: Icon`
  for (const m of src.matchAll(/\b(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) bound.add(m[1]);
  for (const m of src.matchAll(/(?:const|let|var)\s*[[{]([^\]}]+)[\]}]/g)) {
    for (const n of m[1].split(',')) bound.add(n.trim().split(':').pop().trim().split('=')[0].trim());
  }
  // function parameters — `function f(a, b)` and `({ a, b }) =>`
  for (const m of src.matchAll(/(?:function\s*[\w$]*\s*|\)\s*=>|^\s*)\(([^()]*)\)\s*(?:=>|\{)/gm)) {
    for (const n of m[1].replace(/[{}]/g, ',').split(',')) bound.add(n.trim().split(':').pop().trim().split('=')[0].trim());
  }

  const used = new Set();
  for (const m of src.matchAll(/<([A-Z][\w$]*)/g)) used.add(m[1]);              // JSX tags
  // No space before the paren. JSX TEXT CHILDREN are not quoted, so the string
  // blanker never reaches them, and prose like `Target Raise ($)` is otherwise
  // indistinguishable from a call to an undefined `Raise`. This is the same
  // failure as a comment matching an assertion, one layer down. The cost is
  // that a genuine `foo (x)` is not resolved; the codebase does not write that,
  // and a checker with false positives trains you to ignore the real ones.
  for (const m of src.matchAll(/(?<![.\w$'"`])([a-zA-Z_$][\w$]*)\(/g)) used.add(m[1]);  // calls

  return [...used].filter((n) => !JS_KEYWORDS.has(n) && !bound.has(n) && !(n in globalThis));
}

for (const file of UI_FILES) {
  test(`every name ${file} uses resolves to an import or a declaration`, () => {
    assert.deepEqual(freeNames(code(`frontend/src/ui/${file}`)), []);
  });
}

// The other direction. CodeQL has now reported an unused import on this
// extraction twice: PaywallModal, then hasTier — which survived my own grep
// because its only other mention in App.jsx is inside a comment, the exact
// mistake the comment scanner above exists to prevent. App.jsx is in this
// list because it is the file the extraction keeps leaving debris in.
const IMPORT_RE = /^import\s+([\s\S]+?)\s+from\s+'[^']*'/gm;

function unusedImports(raw) {
  const src = scan(raw);
  // Tokenise the body once rather than building a regex per import. Cheaper,
  // and strictly more correct: \b does not bracket a $-prefixed identifier,
  // so /\b$foo\b/ would not have matched a real use of $foo.
  const referenced = new Set(src.replace(IMPORT_RE, '').match(/[A-Za-z_$][\w$]*/g) || []);
  const unused = [];
  for (const m of src.matchAll(IMPORT_RE)) {
    for (const name of m[1].replace(/[{}]/g, ',').split(',')) {
      const bound = name.trim().split(/\s+as\s+/).pop().trim();
      // React is imported without being referenced in 330 of 351 files here —
      // that is the house style under the automatic JSX runtime, not debris.
      if (!bound || bound === 'React') continue;
      if (!referenced.has(bound)) unused.push(bound);
    }
  }
  return unused;
}

for (const path of [...UI_FILES.map((f) => `ui/${f}`), 'App.jsx']) {
  test(`${path} imports nothing it does not use`, () => {
    assert.deepEqual(unusedImports(read(`frontend/src/${path}`)), []);
  });
}

test('the unused-import check would actually catch one', () => {
  assert.deepEqual(unusedImports("import { a, b } from 'x';\na();"), ['b']);
  // ...and is not fooled by a mention in a comment, which is how hasTier survived.
  assert.deepEqual(unusedImports("import { b } from 'x';\n// b is nice\na();"), ['b']);
  assert.deepEqual(unusedImports("import { b } from 'x';\nb();"), []);
});

test('the resolver would actually catch a missing import', () => {
  // A test that cannot fail is worse than no test — this is the one that broke.
  assert.deepEqual(freeNames("import { a } from 'x';\na(); b();"), ['b']);
  assert.deepEqual(freeNames("import { a as b } from 'x';\nb();"), []);
  assert.deepEqual(freeNames("const { icon: Icon } = i;\n<Icon />;"), []);
});

test('SidebarNav keeps its tier locks wired to the paywall', () => {
  const nav = code('frontend/src/ui/SidebarNav.jsx');
  assert.match(nav, /import \{ openPaywall \} from '\.\.\/components\/PaywallModal'/);
  assert.match(nav, /openPaywall\(/, 'a locked item must open the paywall');
  assert.match(nav, /hasTier\(/, 'founder tier gate');
  assert.match(nav, /hasInvestorTier\(/, 'investor tier gate');
});

test('CompanySwitcher is the single writer of active-company context', () => {
  // No page may show two companies at once, and no page may change which one is
  // active — pages read the context, this component is the only thing that sets it.
  const src = code('frontend/src/ui/CompanySwitcher.jsx');
  assert.match(src, /useActiveCompany/, 'it must read the shared context, not own company state');
  const app = code('frontend/src/App.jsx');
  assert.doesNotMatch(app, /^function CompanySwitcher\(/m, 'App.jsx must no longer define it');
  assert.match(code('frontend/src/ui/SidebarNav.jsx'), /<CompanySwitcher\b/, 'the nav still renders it');
});

test('the barrel exports both', () => {
  const exported = new Set(read('frontend/src/ui/index.js').match(/[A-Za-z_$][\w$]*/g) || []);
  for (const name of ['AssistRail', 'SidebarNav', 'CompanySwitcher', 'runCost', 'spendMeter']) {
    assert.ok(exported.has(name), `ui/index.js must export ${name}`);
  }
});

// ---------- the model menu is gone (Phase 4, DECISIONS D13) ----------

test('AssistRail offers no model picker', () => {
  // `aiRouter`'s ROUTE map selects the model from the TASK CLASS — llama-guard
  // for safety, bge for embeddings, qwen-coder for tool calls. A picker here
  // could only offer wrong answers or duplicate the right one, so it was
  // REMOVED rather than disabled: a control that cannot change anything reads
  // as a setting the user has already made.
  const src = scan(read('frontend/src/ui/AssistRail.jsx'));
  assert.doesNotMatch(src, /<select/, 'no model dropdown');
  assert.doesNotMatch(src, /\bonSelectModel\b/, 'no model-selection callback');
  assert.doesNotMatch(src, /\bmodelId\b/, 'no selected-model prop');
  assert.doesNotMatch(src, /config\.mode\.model\s*===\s*['"]menu['"]/,
    'the menu config branch is gone, not merely unreachable');
});

test('the model card reports the model that RAN, not the one configured', () => {
  // aiRouter degrades down a fallback chain under load. Showing the configured
  // name over a run that used a smaller sibling would misreport the one thing
  // this card exists to report.
  const src = scan(read('frontend/src/ui/AssistRail.jsx'));
  assert.match(src, /run\?\.model/, 'a known run supplies the model');
  assert.match(src, /fallback_used/, 'and whether it fell back');
  assert.match(src, /Model · last run/, 'labelled as the run it came from');
  assert.match(src, /Model · routed by task/, 'and otherwise as routed, not chosen');
});

test('lastRun accepts the spend report’s shape as well as a bare cost', () => {
  // GET /api/ai/me/spend returns last_run as an object. The rail took a number.
  // Both are handled so wiring the endpoint does not silently render nothing.
  const src = scan(read('frontend/src/ui/AssistRail.jsx'));
  assert.match(src, /typeof lastRun === 'object'/);
  assert.match(src, /typeof lastRun === 'number'/);
});

test('the rail no longer ASSERTS that the AI gateway does not exist', () => {
  // It does exist: cloudflare-worker/src/services/aiRouter.ts. The old claim
  // was made on a name (nothing is called `eadwyn`) rather than on the code.
  //
  // Deliberately not `doesNotMatch` on the phrase. The first version of this
  // test was, and it failed — on AssistRail's own correction, which QUOTES the
  // sentence in order to refute it. A guard that cannot tell a claim from a
  // record of a retracted claim would push the next author to delete the
  // history rather than keep it. So the phrase is allowed to appear, and must
  // be refuted where it does.
  const CLAIM = /there is no `?eadwyn`? AI Gateway yet/ig;
  for (const f of ['frontend/src/ui/AssistRail.jsx', 'frontend/src/ui/index.js']) {
    const raw = read(f);
    for (const m of raw.matchAll(CLAIM)) {
      const after = raw.slice(m.index, m.index + 240);
      assert.match(after, /was false/i,
        `${f} states the gateway is absent without recording that it is not`);
    }
    assert.doesNotMatch(raw, /Presentational until the eadwyn gateway lands/i,
      `${f} must not carry the un-refuted form`);
  }
  // And the correction itself must still be there to be found.
  assert.match(read('frontend/src/ui/AssistRail.jsx'), /aiRouter\.ts/,
    'the header must name the gateway it was wrong about');
});

test('the spend meter has a live source, and api.js names it', () => {
  const api = scan(read('frontend/src/lib/api.js'));
  assert.match(api, /myAiSpend:\s*\(\)\s*=>\s*request\('\/ai\/me\/spend'\)/,
    'the self-view endpoint the meter reads');
  assert.match(api, /monitoringAiUsage:/, 'the admin rollup stays separate');
});
