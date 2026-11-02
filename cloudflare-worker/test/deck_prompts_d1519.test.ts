/**
 * D1519 (#3771, deck v2 A20) — the prompt registry and one voice across models.
 *
 *  · every file in `services/decks/prompts/` exports `{ version, system,
 *    template }`, and every family of an element keeps its template;
 *  · `promptFor` picks the model's family (else `default`), opens with the
 *    voice preamble and the theme's voice, and names `prompt_version`;
 *  · a deck written by three models (Llama, Mistral, GLM) passes the glossary
 *    check, and a string out of the house voice is dropped, never shown;
 *  · a changed prompt without an eval update fails the CI rule; the owner's
 *    waiver passes it.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_prompts_d1519.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { FAMILIES, REGISTRY, deckGlossary, familyOf, glossaryProblems, promptFor, HOUSE_VOICE } from '../src/services/decks/prompts/index.ts';
import { BUILD_SYSTEM, buildCards, buildMessage, standardOutline, wordingFromModel } from '../src/services/decks/newDeck.ts';
import { ASSIST_PROMPT_VERSION, textMessage } from '../src/services/decks/assist.ts';
import { ELEMENT_ROUTES } from '../src/services/decks/elementModels.ts';
import { USE_KINDS } from '../src/services/ai/modelUseCases.ts';
import { fullRecords } from './fixtures/pitchStoryFixtures.ts';
import { EVAL_DOC, promptFiles, promptsHash, recordedHash, verdict } from '../../scripts/check-prompt-eval.mjs';

const DIR = resolve(process.cwd(), 'cloudflare-worker/src/services/decks/prompts');
/** Three text models from three families, read from the job table (no second model list). */
const MODELS = (() => {
  const write = USE_KINDS.write.models as readonly string[];
  const pick = (f: string) => write.find((m) => familyOf(m) === f)!;
  return { llama: pick('llama'), mistral: pick('mistral'), glm: pick('glm') };
})();

test('every prompt file is <element>.<family>.ts and exports { version, system, template }; a family keeps its element\'s template', async () => {
  // Mutation checked: a family file whose template differs from default's → the shared-template assert fails.
  const files = readdirSync(DIR).filter((n) => n.endsWith('.ts') && n !== 'index.ts' && n !== 'voice.ts');
  assert.ok(files.length >= 6);
  for (const n of files) {
    const m = /^([a-z]+)\.([a-z]+)\.ts$/.exec(n);
    assert.ok(m, `${n} is <element>.<family>.ts`);
    assert.ok((FAMILIES as readonly string[]).includes(m![2]), `${n}: ${m![2]} is a family`);
    const mod = await import(resolve(DIR, n));
    assert.deepEqual(Object.keys(mod).sort(), ['system', 'template', 'version'], n);
    assert.ok(Number.isInteger(mod.version) && mod.version >= 1, n);
    assert.ok(typeof mod.system === 'string' && mod.system.length > 40, n);
  }
  for (const [element, fams] of Object.entries(REGISTRY)) {
    assert.ok(fams.default, `${element} has a default`);
    for (const [f, file] of Object.entries(fams)) assert.equal(file!.template, fams.default!.template, `${element}.${f} keeps the element's template`);
  }
});

test('promptFor: the model\'s family or default, the voice preamble first, the theme\'s voice as data, and its prompt_version', () => {
  // Mutation checked: the preamble left out of promptFor → every family's system lacks HOUSE_VOICE.
  assert.equal(familyOf('@cf/meta/llama-3.3-70b-instruct-fp8-fast'), 'llama');
  assert.equal(familyOf('@cf/openai/gpt-oss-120b'), 'default');
  assert.equal(familyOf(null), 'default');
  for (const [f, model] of Object.entries(MODELS)) {
    const p = promptFor('build', model, 'Warm and exact, like a founder talking to a friend.');
    assert.equal(p.family, f);
    assert.equal(p.prompt_version, `build.${f}@v1`);
    assert.ok(p.system.startsWith(HOUSE_VOICE), `${f}: the voice comes first`);
    assert.match(p.system, /Warm and exact/);
    assert.match(p.system, /BEGIN_INSTRUCTION_UNTRUSTED_[0-9a-f]+/, `${f}: the theme's voice is framed as data (D1506)`);
  }
  assert.equal(promptFor('build', '@cf/openai/gpt-oss-120b').prompt_version, 'build.default@v1');
  assert.equal(promptFor('outline', MODELS.llama).prompt_version, 'outline.default@v1', 'a family with no file falls back to default');
  assert.ok(BUILD_SYSTEM.startsWith(HOUSE_VOICE));
  assert.ok(buildMessage({ audience: 'seed_fund', prompt: '', rows: standardOutline('standard', 'seed_fund').slice(0, 1), items: [], ventureName: null } as any).includes(REGISTRY.build.default!.template));
  // The text press too: the deck's voice on every action.
  const t = textMessage('rewrite', 'We close the books in a day.', { voice: 'Plain and calm.' });
  assert.ok(t.system.startsWith(HOUSE_VOICE));
  assert.match(t.system, /Plain and calm/);
  assert.equal(ASSIST_PROMPT_VERSION, 'assist.default@v1');
  assert.ok(Object.values(ELEMENT_ROUTES).some((r: any) => r.kind === 'write'), 'the text elements this voice serves are routed');
});

test('a deck written by three models (Llama, Mistral, GLM) passes the glossary check', () => {
  // Mutation checked: the glossary drop removed from wordingFromModel → the hype card keeps its words and the deck fails.
  const rows = standardOutline('standard', 'seed_fund');
  const rec = fullRecords();
  // Each family's recorded answer for a third of the cards, in its own habits; the words are the house voice.
  const answer = (from: number, to: number) => ({ cards: rows.slice(from, to).map((r, i) => ({ n: i + 1, headline: `We ${r.title.toLowerCase()} for finance teams`, body: 'Our customers asked for it in their interviews.' })) });
  const thirds = [[0, 4], [4, 8], [8, rows.length]] as const;
  const wording = thirds.flatMap(([a, b]) => wordingFromModel(answer(a, b), b - a).byIndex);
  const { slides } = buildCards(rows, rec.items, wording, 'Synthetic venture', new Set(), { series: rec.series, diagrams: rec.diagrams, rows: rec.rows });
  assert.deepEqual(deckGlossary(slides), [], 'one voice across three models');
  // One model drifting into hype, an exclamation or "I" loses that string, so the deck still reads as one voice.
  const drift = wordingFromModel({ cards: [{ n: 1, headline: 'A revolutionary ledger!', body: 'I built it for finance teams.' }, { n: 2, headline: 'We close in a day', body: 'The company grew fast.' }] }, 2);
  assert.deepEqual(drift.byIndex, [{ headline: null, body: null }, { headline: 'We close in a day', body: null }]);
  assert.equal(drift.dropped, 3);
  const mixed = buildCards(rows.slice(0, 2), rec.items, [{ headline: 'Game-changing books', body: null }, { headline: null, body: null }], 'V', new Set(), { series: rec.series, diagrams: rec.diagrams, rows: rec.rows }).slides;
  assert.ok(deckGlossary(mixed).length >= 1, 'the check sees a card out of voice');
});

test('the glossary: what it refuses and what it lets through', () => {
  for (const bad of ['A cutting-edge platform', 'World-class team', 'Close in a day!', 'Built with 💡', 'I founded it', 'My team ships', 'This startup closes books', 'A paradigm shift in finance']) {
    assert.ok(glossaryProblems(bad).length >= 1, bad);
  }
  for (const ok of ['We close the books in a day.', 'Our customers asked for it.', 'Finance teams copy rows between spreadsheets.', 'India and Iceland', 'Vitamin I.V. drips', 'It is the top pain we heard.']) {
    assert.deepEqual(glossaryProblems(ok), [], ok);
  }
});

test('the CI rule: a changed prompt without an eval update fails; the recorded hash or the owner\'s waiver passes', () => {
  // Mutation checked: the waiver ignored → the waived case fails; the comparison inverted → the unchanged case fails.
  const files = promptFiles(DIR);
  const current = promptsHash(files);
  const recorded = recordedHash(readFileSync(EVAL_DOC, 'utf8'));
  assert.equal(recorded, current, 'ELEMENT_EVAL.md records the prompts on this branch (node scripts/check-prompt-eval.mjs --write)');
  assert.equal(verdict({ current, recorded, waived: false }).code, 0);
  const changed = promptsHash(files.map(([n, b]: [string, string]) => [n, n === 'build.llama.ts' ? b.replace('no preface', 'no preamble') : b]));
  assert.notEqual(changed, current, 'one word in one prompt changes the hash');
  const fail = verdict({ current: changed, recorded, waived: false });
  assert.equal(fail.code, 1);
  assert.match(fail.line, /ELEMENT_EVAL\.md was not updated/);
  assert.equal(verdict({ current: changed, recorded, waived: true }).code, 0, 'the owner\'s prompt-eval-waiver label passes it');
  assert.equal(verdict({ current, recorded: null, waived: true }).code, 2, 'no record is never a pass');
  assert.equal(promptsHash([...files].reverse()), current, 'the order files are read in does not matter');
  const wf = readFileSync(resolve(process.cwd(), '.github/workflows/prompt-eval-gate.yml'), 'utf8');
  assert.match(wf, /labeled, unlabeled/);
  assert.match(wf, /contains\(github\.event\.pull_request\.labels\.\*\.name, 'prompt-eval-waiver'\)/);
  assert.match(wf, /run: node scripts\/check-prompt-eval\.mjs\n/);
  assert.match(readFileSync(resolve(process.cwd(), '.github/labels.yml'), 'utf8'), /name: "prompt-eval-waiver"/);
});
