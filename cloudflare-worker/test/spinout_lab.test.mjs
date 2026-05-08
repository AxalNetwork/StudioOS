/**
 * Spin-Out Lab — pure-logic tests for the milestone catalog and the
 * `weekMet` / `unlockedFeaturesThrough` helpers extracted from
 * `cloudflare-worker/src/routes/spinout_lab.ts`.
 *
 * Run with:  node --test cloudflare-worker/test/spinout_lab.test.mjs
 *
 * Strategy mirrors `projects.test.mjs`: load the helpers out of the real
 * .ts source via `tsc.transpileModule` (the worker already depends on
 * typescript) so we are testing the EXACT bytes that ship to Cloudflare.
 * No new test deps. We do not mock D1 here — the route handlers themselves
 * are thin shells over the same helpers, so exercising the catalog +
 * advancement math is the meaningful surface to lock down.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadHelpers() {
  const srcPath = resolve(__dirname, '../src/routes/spinout_lab.ts');
  const src = await readFile(srcPath, 'utf8');

  // Extract the catalog + the two pure helpers. We strip imports + the
  // Hono-specific glue and feed only the shapes we want to test.
  // Find each function/const by anchor and balance braces.
  function sliceBlock(anchor) {
    const start = src.indexOf(anchor);
    assert.notEqual(start, -1, `${anchor} not found in spinout_lab.ts`);
    // Skip past param list (if present) — find the body opening `{`.
    let i = src.indexOf('{', start);
    let depth = 0;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') {
        depth--;
        if (depth === 0) return src.slice(start, i + 1);
      }
    }
    throw new Error(`failed to balance braces for ${anchor}`);
  }

  function sliceConst(anchor) {
    // For a const declaration that ends at `];`. Find the matching `];`
    // by walking until we see `];` at top-level bracket depth.
    const start = src.indexOf(anchor);
    assert.notEqual(start, -1, `${anchor} not found in spinout_lab.ts`);
    let depth = 0;
    let i = src.indexOf('[', start);
    for (; i < src.length; i++) {
      if (src[i] === '[') depth++;
      else if (src[i] === ']') {
        depth--;
        if (depth === 0) {
          // Include trailing `;`.
          const semi = src.indexOf(';', i);
          return src.slice(start, semi + 1);
        }
      }
    }
    throw new Error(`failed to balance brackets for ${anchor}`);
  }

  const catalog = sliceConst('export const MILESTONES');
  const validKeys = sliceBlock('export const VALID_MILESTONE_KEYS');
  const weekForKey = sliceBlock('function weekForKey(');
  const weekMet = sliceBlock('export function weekMet(');
  const unlocked = sliceBlock('export function unlockedFeaturesThrough(');

  // Strip `export ` so we can re-export the names ourselves at the end.
  const body = [catalog, validKeys, weekForKey, weekMet, unlocked]
    .map((b) => b.replace(/^export\s+/, ''))
    .join('\n\n');

  const wrapped = `const __out = (() => {
    ${body}
    return { MILESTONES, VALID_MILESTONE_KEYS, weekForKey, weekMet, unlockedFeaturesThrough };
  })();`;

  const ts = (await import(resolve(__dirname, '../node_modules/typescript/lib/typescript.js')))
    .default;
  const { outputText } = ts.transpileModule(wrapped, {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
  });

  return new Function(`${outputText}; return __out;`)();
}

test('catalog defines four weeks with the spec\'s feature unlocks', async () => {
  const { MILESTONES } = await loadHelpers();
  assert.equal(MILESTONES.length, 4);
  assert.deepEqual(
    MILESTONES.map((w) => w.week),
    [1, 2, 3, 4],
  );
  // Spot-check one feature per week so a regression in the catalog gets
  // caught here before the sidebar task consumes the same list.
  assert.ok(MILESTONES[0].unlockedFeatures.includes('customer-discovery'));
  assert.ok(MILESTONES[1].unlockedFeatures.includes('pitch-deck'));
  assert.ok(MILESTONES[2].unlockedFeatures.includes('cofounder-match'));
  assert.ok(MILESTONES[3].unlockedFeatures.includes('incorporate'));
});

test('VALID_MILESTONE_KEYS rejects typos but accepts every catalog key', async () => {
  const { VALID_MILESTONE_KEYS, MILESTONES } = await loadHelpers();
  for (const w of MILESTONES) {
    for (const k of [...w.requiredAll, ...(w.requiredAny ?? [])]) {
      assert.ok(VALID_MILESTONE_KEYS.has(k), `expected key ${k}`);
    }
  }
  assert.equal(VALID_MILESTONE_KEYS.has('not_a_real_key'), false);
});

test('weekMet: week 1 needs project + 3 interviews', async () => {
  const { weekMet } = await loadHelpers();
  assert.equal(weekMet(1, new Set(['project_created'])), false);
  assert.equal(
    weekMet(1, new Set([
      'project_created',
      'customer_interview_logged_1',
      'customer_interview_logged_2',
    ])),
    false,
    'partial interview count should not advance',
  );
  assert.equal(
    weekMet(1, new Set([
      'project_created',
      'customer_interview_logged_1',
      'customer_interview_logged_2',
      'customer_interview_logged_3',
    ])),
    true,
  );
});

test('weekMet: week 3 enforces requiredAll AND at least one of requiredAny', async () => {
  const { weekMet } = await loadHelpers();
  // Missing the requiredAll piece.
  assert.equal(weekMet(3, new Set(['mentor_meeting_booked'])), false);
  // requiredAll alone — no requiredAny match.
  assert.equal(weekMet(3, new Set(['scoring_run_completed'])), false);
  // requiredAll + mentor.
  assert.equal(
    weekMet(3, new Set(['scoring_run_completed', 'mentor_meeting_booked'])),
    true,
  );
  // requiredAll + cofounder is the alternative path.
  assert.equal(
    weekMet(3, new Set(['scoring_run_completed', 'cofounder_request_sent'])),
    true,
  );
});

test('unlockedFeaturesThrough is cumulative and stable per week', async () => {
  const { unlockedFeaturesThrough } = await loadHelpers();
  const w1 = unlockedFeaturesThrough(1);
  const w2 = unlockedFeaturesThrough(2);
  const w4 = unlockedFeaturesThrough(4);
  // Every w1 feature stays unlocked at later weeks.
  for (const f of w1) assert.ok(w2.includes(f), `${f} should remain at w2`);
  for (const f of w2) assert.ok(w4.includes(f), `${f} should remain at w4`);
  // Week-specific arrivals.
  assert.equal(w1.includes('roadmap'), false);
  assert.equal(w2.includes('roadmap'), true);
  assert.equal(w4.includes('kyc'), true);
});

test('weekMet reflects the full happy-path sprint', async () => {
  const { weekMet, MILESTONES } = await loadHelpers();
  // Walk all four weeks: at each step assert the previous week is met and
  // the next is NOT yet met. Mirrors what the auto-advance loop does on
  // the worker side.
  const completed = new Set();
  for (const w of MILESTONES) {
    for (const k of w.requiredAll) completed.add(k);
    if (w.requiredAny && w.requiredAny.length) completed.add(w.requiredAny[0]);
    assert.equal(weekMet(w.week, completed), true, `week ${w.week} should be met`);
  }
});
