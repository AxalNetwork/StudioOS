#!/usr/bin/env node
/**
 * D1518 (#3770, deck v2 A7) — the element eval and the deck benchmark, one
 * harness (`scripts/lib/deckEval.mjs`). It reads the Worker's TypeScript, so
 * run it through the test loader:
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     scripts/eval-elements.mjs [--plan | --benchmark [--write] | --live]
 *
 *   --plan       (default) each golden brief against its element's job and
 *                the models #3741's rail suggests for it (≤ 3, from
 *                `ELEMENT_ROUTES` and `choicesFor`): what a live run would
 *                call. Calls nothing.
 *   --benchmark  the zero-edit acceptance arm: the one-click output for the
 *                three sample ventures exactly as generated (`buildCards` on
 *                the venture's records, every unrecorded record unticked, the
 *                recorded words the fake binding answers), scored by rubric
 *                v0 with its placeholders and overflow. `--write` puts the
 *                table into documentation/product/DECK_BENCHMARK.md between
 *                its markers. Calls no model.
 *   --live       each brief through each suggested model on a staging
 *                Worker. Refused until the owner sets the evaluation cap
 *                (decision N) and a staging URL; never production.
 *
 * Results feed documentation/product/ELEMENT_EVAL.md as proposed changes to
 * #3721's plan: there is no separate defaults file.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GOLDEN_BRIEFS, VENTURES, baselineTable, liveRefusal, zeroEditVerdict } from './lib/deckEval.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BENCHMARK = resolve(root, 'documentation/product/DECK_BENCHMARK.md');

/** The plan: each brief, its route and the models a live run would try. */
export async function plan() {
  const { ELEMENT_ROUTES, choicesFor } = await import('../cloudflare-worker/src/services/decks/elementModels.ts');
  return GOLDEN_BRIEFS.map((b) => {
    const route = ELEMENT_ROUTES[b.element];
    return { brief: b.id, element: b.element, job: route?.job ?? null, kind: route?.kind ?? null, venture: b.venture, card: b.card, models: choicesFor(b.element).suggested.map((m) => m.id) };
  });
}

/** The zero-edit arm for the three sample ventures, keyed by venture. */
export async function zeroEditArm() {
  const { buildCards, standardOutline } = await import('../cloudflare-worker/src/services/decks/newDeck.ts');
  const { RUBRIC_GATE, deckRubric, placeholders } = await import('../cloudflare-worker/src/services/decks/rubric.ts');
  const { fitProblems } = await import('../cloudflare-worker/src/services/decks/designSystem.ts');
  const fixtures = await import('../cloudflare-worker/test/fixtures/pitchStoryFixtures.ts');
  const rows = {};
  for (const [venture, fn] of Object.entries(VENTURES)) {
    const rec = fixtures[fn]();
    const outline = standardOutline('standard', 'seed_fund');
    // What the founder unticks on the one-click run: every record the venture has not made (as D1511's run).
    const exclude = new Set(rec.items.filter((i) => i.state !== 'recorded').map((i) => i.source_key));
    const { slides } = buildCards(outline, rec.items, fixtures.wordsFor(outline), 'Synthetic venture', exclude, { series: rec.series, diagrams: rec.diagrams, rows: rec.rows });
    const cards = slides.filter((s) => !s.appendix);
    const measured = { score: deckRubric(slides).score, placeholders: placeholders(cards), overflow: fitProblems(cards).filter((p) => p.kind !== 'single_word_line').length };
    rows[venture] = { ...measured, ...zeroEditVerdict(measured, RUBRIC_GATE) };
  }
  return rows;
}

/** DECK_BENCHMARK.md with the arm's table put between its markers. */
export function withBaseline(markdown, rows) {
  const [head, rest] = markdown.split('<!-- zero-edit:start -->');
  const tail = rest.split('<!-- zero-edit:end -->')[1];
  return `${head}<!-- zero-edit:start -->\n${baselineTable(rows)}\n<!-- zero-edit:end -->${tail}`;
}

async function main(argv) {
  if (argv.includes('--live')) {
    const refusal = liveRefusal(process.env);
    console.error(refusal ?? 'The live arm is not wired on this base: it lands once decisions N and F are made (D1518 §5). Nothing was run.');
    return 2;
  }
  if (argv.includes('--benchmark')) {
    const rows = await zeroEditArm();
    if (argv.includes('--write')) {
      writeFileSync(BENCHMARK, withBaseline(readFileSync(BENCHMARK, 'utf8'), rows));
      console.log(`Wrote the zero-edit baseline to ${BENCHMARK}.`);
    }
    console.log(baselineTable(rows));
    return Object.values(rows).every((r) => r.pass) ? 0 : 1;
  }
  console.log(JSON.stringify(await plan(), null, 2));
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
