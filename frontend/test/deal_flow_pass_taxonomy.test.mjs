/**
 * Deal Flow — the pass taxonomy on the operator's side (task #127).
 *
 * Two failure shapes are guarded here.
 *
 * The first is drift: the worker's taxonomy is what the CHECK constraint
 * accepts and what the analytics group by. A reason added on one side only
 * either offers a radio D1 rejects at write time, or records a value the chart
 * has no row for. Neither throws anywhere a human is looking.
 *
 * The second is the one that bit this repo already — a page that references a
 * name it never imported. Vite transpiles rather than type-checks and there is
 * no eslint here, so `useCallback` missing from an import list shipped to
 * production and threw before the sidebar painted. The resolver below is the
 * same one that found it, pointed at the files this change touches.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  PASS_TAXONOMY, PASS_REASON_UNRECORDED, passReasonLabel, passReasonRevisit,
  SLA_PRESETS, DEFAULT_SLA, slaPreset, slaBand, fmtPct, fmtDays, NOT_RECORDED,
} from '../src/lib/dealFlow.js';

const root = resolve(process.cwd());
const read = (p) => readFileSync(resolve(root, p), 'utf8');

/**
 * Comment stripper. It must be a character scanner, not a regex: a regex
 * stripper reads the `/*` inside a JSX path prop as a block-comment opener and
 * silently eats the next few hundred lines. Three assertions in this repo have
 * passed by matching prose instead of code.
 */
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

// ---------- the vocabulary agrees with the worker ----------

test('the frontend and worker taxonomies list exactly the same reasons', () => {
  const ts = read('cloudflare-worker/src/services/dealPassTaxonomy.ts');
  const workerKeys = [...ts.matchAll(/^\s*key:\s*'([a-z_]+)',/gm)].map((m) => m[1]).sort();
  const uiKeys = PASS_TAXONOMY.map((r) => r.key).sort();
  assert.deepEqual(uiKeys, workerKeys,
    'a reason on one side only is either a radio D1 rejects or a value with no chart row');
  assert.ok(uiKeys.length >= 5);
});

test('the labels and hints match the worker, not just the keys', () => {
  // A key that agrees while the label drifts means the chart and the modal
  // name the same decision differently — the aggregate stops being readable.
  const ts = read('cloudflare-worker/src/services/dealPassTaxonomy.ts');
  for (const r of PASS_TAXONOMY) {
    assert.ok(ts.includes(`label: '${r.label}'`), `worker must carry the label "${r.label}"`);
    assert.ok(ts.includes(r.hint), `worker must carry the hint for "${r.key}"`);
  }
});

test('there is no free-text escape hatch on this side either', () => {
  for (const r of PASS_TAXONOMY) {
    assert.doesNotMatch(r.key, /other|misc|general/i, `"${r.key}" is an escape hatch`);
    assert.ok(r.label && r.hint, `${r.key} needs a label and a hint`);
  }
});

test('a revisit promise appears only where the fund actually re-queries', () => {
  assert.ok(passReasonRevisit('early'));
  assert.ok(passReasonRevisit('valuation'));
  assert.equal(passReasonRevisit('team'), '');
  assert.equal(passReasonRevisit('nonsense'), '');
  assert.equal(passReasonLabel('nonsense'), 'Reason not recorded');
  assert.equal(passReasonLabel(null), 'Reason not recorded');
});

// ---------- the honesty formatters ----------

test('a null measurement reads as Not recorded, never as zero', () => {
  // `null` means the denominator was zero — no deals entered that stage, no
  // passes recorded. "0%" asserts a measurement nobody made.
  for (const v of [null, undefined, NaN, 'x', {}]) {
    assert.equal(fmtPct(v), NOT_RECORDED, `${JSON.stringify(v)} must not render as a number`);
    assert.equal(fmtDays(v), NOT_RECORDED);
  }
  assert.equal(fmtPct(0), '0%', 'a real measured zero is still zero');
  assert.equal(fmtPct(66.7), '66.7%');
  assert.equal(fmtPct(30), '30%');
  assert.equal(fmtDays(0), '0d');
});

// ---------- the SLA banding ----------

test('an unknown age gets no band rather than a red one', () => {
  // Colouring an unmeasured deal red invents urgency the data cannot support.
  for (const v of [null, undefined, NaN, Infinity, '20']) {
    assert.equal(slaBand(v), 'none', `${JSON.stringify(v)} must not be banded`);
  }
});

test('the bands fire on the canvas thresholds', () => {
  assert.equal(slaPreset(DEFAULT_SLA).key, 'standard');
  const { amber, red } = slaPreset('standard');
  assert.equal(slaBand(amber - 1, 'standard'), 'ok');
  assert.equal(slaBand(amber, 'standard'), 'amber', 'amber must start AT the threshold, not after it');
  assert.equal(slaBand(red - 1, 'standard'), 'amber');
  assert.equal(slaBand(red, 'standard'), 'red');
  // Tight bands earlier than relaxed, at the same age. 15 days is past
  // tight's red (14) and still inside relaxed's green (amber at 21).
  assert.equal(slaBand(15, 'tight'), 'red');
  assert.equal(slaBand(15, 'relaxed'), 'ok');
  assert.equal(slaBand(10, 'tight'), 'amber');
  assert.equal(slaPreset('nonsense').key, 'standard', 'an unknown preset falls back, it does not crash');
  for (const p of SLA_PRESETS) assert.ok(p.amber < p.red, `${p.key}: amber must precede red`);
});

// ---------- the page ----------

test('the page reaches the terminal stage only through the pass route', () => {
  const src = code('frontend/src/pages/DealsPage.jsx');
  assert.match(src, /api\.passDeal\(/, 'the Pass control must call the pass route');
  // updateDeal({status:'rejected'}) would bypass the reason entirely. The
  // worker refuses it, but the UI must not be written to try.
  assert.doesNotMatch(src, /updateDeal\([^)]*rejected/,
    'the page must not write the terminal stage directly');
});

test('the pass modal cannot submit without a reason', () => {
  const src = code('frontend/src/pages/DealsPage.jsx');
  assert.match(src, /disabled=\{!reason \|\| saving\}/, 'the confirm button must require a reason');
  assert.match(src, /if \(!reason \|\| saving\) return;/,
    'and the handler must refuse too — a disabled button is a suggestion');
});

test('the page renders every taxonomy reason and the unrecorded bucket', () => {
  const src = code('frontend/src/pages/DealsPage.jsx');
  assert.match(src, /PASS_TAXONOMY\.map/, 'the modal lists the taxonomy rather than hardcoding it');
  assert.match(src, /PASS_REASON_UNRECORDED/, 'and the panel names the unrecorded bucket');
  assert.match(src, /unrecorded_note/, 'and explains why it is not backfilled');
});

test('the SLA preference stays in the browser', () => {
  // It changes which cards look urgent, never what is true about them. Sending
  // it to the server would let one partner repaint everyone else's board.
  const src = code('frontend/src/pages/DealsPage.jsx');
  assert.match(src, /safeWriteJSON\('dealFlowSla'/);
  assert.doesNotMatch(src, /api\.[a-zA-Z]*[Ss]la/, 'the SLA must never be sent to an endpoint');
});

// ---------- names resolve ----------

const JS_KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'typeof',
  'await', 'super', 'new', 'delete', 'void', 'in', 'of', 'do', 'else', 'yield',
  'async',
]);

function freeNames(raw) {
  const src = scan(raw, { blankStrings: true });
  const bound = new Set();
  for (const m of src.matchAll(/^import\s+([\s\S]+?)\s+from\s+'[^']*'/gm)) {
    for (const name of m[1].replace(/[{}]/g, ',').split(',')) {
      const b = name.trim().split(/\s+as\s+/).pop().trim();
      if (b) bound.add(b);
    }
  }
  for (const m of src.matchAll(/\b(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) bound.add(m[1]);
  for (const m of src.matchAll(/(?:const|let|var)\s*[[{]([^\]}]+)[\]}]/g)) {
    for (const n of m[1].split(',')) bound.add(n.trim().split(':').pop().trim().split('=')[0].trim());
  }
  for (const m of src.matchAll(/(?:function\s*[\w$]*\s*|\)\s*=>|^\s*)\(([^()]*)\)\s*(?:=>|\{)/gm)) {
    for (const n of m[1].replace(/[{}]/g, ',').split(',')) bound.add(n.trim().split(':').pop().trim().split('=')[0].trim());
  }
  const used = new Set();
  for (const m of src.matchAll(/<([A-Z][\w$]*)/g)) used.add(m[1]);
  // No space before the paren — JSX text children are unquoted, so prose like
  // `Target Raise ($)` would otherwise resolve as a call to an undefined
  // `Raise`. See the note in ui_assist_rail_and_sidebar.test.mjs.
  for (const m of src.matchAll(/(?<![.\w$'"`])([a-zA-Z_$][\w$]*)\(/g)) used.add(m[1]);
  return [...used].filter((n) => !JS_KEYWORDS.has(n) && !bound.has(n) && !(n in globalThis));
}

const IMPORT_RE = /^import\s+([\s\S]+?)\s+from\s+'[^']*'/gm;

function unusedImports(raw) {
  const src = scan(raw);
  const referenced = new Set(src.replace(IMPORT_RE, '').match(/[A-Za-z_$][\w$]*/g) || []);
  const unused = [];
  for (const m of src.matchAll(IMPORT_RE)) {
    for (const name of m[1].replace(/[{}]/g, ',').split(',')) {
      const bound = name.trim().split(/\s+as\s+/).pop().trim();
      if (!bound || bound === 'React') continue;
      if (!referenced.has(bound)) unused.push(bound);
    }
  }
  return unused;
}

for (const path of ['pages/DealsPage.jsx', 'lib/dealFlow.js']) {
  test(`every name ${path} uses resolves to an import or a declaration`, () => {
    assert.deepEqual(freeNames(code(`frontend/src/${path}`)), []);
  });
  test(`${path} imports nothing it does not use`, () => {
    assert.deepEqual(unusedImports(read(`frontend/src/${path}`)), []);
  });
}

test('the resolvers would actually catch one', () => {
  // A test that cannot fail is worse than no test.
  assert.deepEqual(freeNames("import { a } from 'x';\na(); b();"), ['b']);
  assert.deepEqual(unusedImports("import { a, b } from 'x';\na();"), ['b']);
  assert.deepEqual(unusedImports("import { b } from 'x';\n// b is nice\na();"), ['b']);
});
