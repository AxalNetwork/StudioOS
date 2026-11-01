// #3939: scripts/check-model-coverage.mjs, one fixture per failure mode. The clean fixture
// passes; each test breaks it in exactly one way and expects exactly that rule. The run against
// the repository is the script itself, in test:guards.
//
//   node --test frontend/test/model_coverage_check_3939.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkCoverage, indexOfWhole, stripComments } from '../../scripts/check-model-coverage.mjs';

const CATALOGUE = [
  { id: '@cf/zai-org/glm-4.7-flash', kind: 'Text Generation', status: 'ga' },
  { id: '@cf/openai/whisper-large-v3-turbo', kind: 'Automatic Speech Recognition', status: 'ga' },
  { id: '@cf/black-forest-labs/flux-1-schnell', kind: 'Text-to-Image', status: 'ga' },
  { id: '@cf/google/gemma-4-26b-a4b-it', kind: 'Text Generation', status: 'ga' },
  { id: '@cf/llava-hf/llava-1.5-7b-hf', kind: 'Image-to-Text', status: 'beta' },
  { id: '@cf/meta/llama-3.1-8b-instruct', kind: 'Text Generation', status: 'deprecated' },
];

const clean = () => ({
  catalogue: CATALOGUE.map((m) => ({ ...m })),
  models: CATALOGUE.filter((m) => m.status !== 'deprecated').map((m) => ({ id: m.id })),
  jobs: [
    { id: 'ST1', kind: 'Chat', default: '@cf/zai-org/glm-4.7-flash' },
    { id: 'VA1', kind: 'Listen', default: '@cf/openai/whisper-large-v3-turbo' },
    { id: 'DK4', kind: 'Draw', default: '@cf/black-forest-labs/flux-1-schnell' },
    { id: 'RA3', steps: [{ kind: 'Read images', default: '@cf/google/gemma-4-26b-a4b-it' }, { kind: 'Chat', default: '@cf/zai-org/glm-4.7-flash' }] },
  ],
  kindModels: {
    Chat: ['@cf/zai-org/glm-4.7-flash'],
    Listen: ['@cf/openai/whisper-large-v3-turbo'],
    Draw: ['@cf/black-forest-labs/flux-1-schnell'],
    'Read images': ['@cf/google/gemma-4-26b-a4b-it', '@cf/llava-hf/llava-1.5-7b-hf'],
  },
  selectors: [
    { where: 'railMatrix Founder · Raise · Pitch deck / deck:image', kind: 'image', models: ['@cf/black-forest-labs/flux-1-schnell'] },
    { where: 'railMatrix Founder · Validate · Customer research', kind: 'speech', models: ['@cf/openai/whisper-large-v3-turbo'] },
    { where: 'railMatrix Founder · Raise · Data room', kind: 'vision', models: ['@cf/google/gemma-4-26b-a4b-it'] },
  ],
  elementGroups: [{ id: 'text', job: 'ST1' }, { id: 'images', job: 'DK4' }],
  sources: [
    { path: 'cloudflare-worker/src/services/ai/catalogue.ts', text: "{ id: '@cf/meta/llama-3.1-8b-instruct', status: 'deprecated' }" },
    { path: 'cloudflare-worker/src/services/aiRouter.ts', text: "export const PRICE_USD_PER_1M_TOKENS: X = tokenPriceView([\n  '@cf/meta/llama-3.1-8b-instruct',\n]);\nconst SMALL = '@cf/meta/llama-3.1-8b-instruct-fp8';" },
    { path: 'cloudflare-worker/ai-workers/systemRun.ts', text: "/** It called `@cf/meta/llama-3.1-8b-instruct` directly before. */\nexport const x = 1;" },
  ],
});
const rules = (input) => checkCoverage(input).map((f) => f.rule);

test('the clean fixture passes: retired ids in the catalogue, the router price list and a comment are not uses', () => {
  assert.deepEqual(checkCoverage(clean()), []);
});

test('uncovered: a current catalogue id in no row', () => {
  const x = clean(); x.models = x.models.filter((m) => m.id !== '@cf/llava-hf/llava-1.5-7b-hf');
  assert.deepEqual(rules(x), ['uncovered']);
});

test('duplicated: a catalogue id in two rows', () => {
  const x = clean(); x.models.push({ id: '@cf/zai-org/glm-4.7-flash' });
  assert.deepEqual(rules(x), ['duplicated']);
});

test('no-default: a job, or one step of a chain, with no Default', () => {
  const x = clean(); x.jobs[0].default = '';
  assert.deepEqual(rules(x), ['no-default']);
  const y = clean(); delete y.jobs[3].steps[1].default;
  assert.deepEqual(rules(y), ['no-default']);
});

test('two-defaults: two values, or the same job declared twice', () => {
  const x = clean(); x.jobs[0].default = ['@cf/zai-org/glm-4.7-flash', '@cf/google/gemma-4-26b-a4b-it'];
  assert.deepEqual(rules(x), ['two-defaults']);
  const y = clean(); y.jobs.push({ id: 'ST1', kind: 'Chat', default: '@cf/zai-org/glm-4.7-flash' });
  assert.deepEqual(rules(y), ['two-defaults']);
});

test('default-kind: a Default outside its kind, or a kind with no list', () => {
  const x = clean(); x.jobs[1].default = '@cf/zai-org/glm-4.7-flash';
  assert.deepEqual(rules(x), ['default-kind']);
  const y = clean(); y.jobs[0].kind = 'Decide';
  assert.deepEqual(rules(y), ['default-kind']);
});

test('deprecated: a retired id used in code, in a JSON override, or past the router price list', () => {
  const x = clean(); x.sources.push({ path: 'cloudflare-worker/ai-workers/persona-router.ts', text: "export async function persona(ai) {\n  return ai.run('@cf/meta/llama-3.1-8b-instruct', {});\n}" });
  const f = checkCoverage(x);
  assert.deepEqual(f.map((r) => r.rule), ['deprecated']);
  assert.match(f[0].detail, /persona-router\.ts:2 /);
  const y = clean(); y.sources.push({ path: 'scripts/lib/railMatrixOverrides.json', text: '{\n  "Llama 3.1 8B": { "id": "@cf/meta/llama-3.1-8b-instruct" }\n}' });
  assert.deepEqual(rules(y), ['deprecated']);
  const z = clean(); z.sources[1].text += "\nconst LIVE = '@cf/meta/llama-3.1-8b-instruct';";
  assert.deepEqual(rules(z), ['deprecated'], 'the router allowance covers its price list only');
  const w = clean(); w.sources.push({ path: 'scripts/lib/retired.mjs', text: "@cf/meta/llama-3.1-8b-instruct is the first thing in this file" });
  assert.deepEqual(rules(w), ['deprecated'], 'an id at the very start of a file');
});

test('deprecated: a longer current id that starts with a retired one is not a match', () => {
  const x = clean(); x.sources.push({ path: 'cloudflare-worker/src/services/queueWorker.ts', text: "const m = '@cf/meta/llama-3.1-8b-instruct-fp8';" });
  assert.deepEqual(checkCoverage(x), []);
});

test('reader-in-draw: a reader, or an unknown id, under Draw', () => {
  const x = clean(); x.selectors[0].models.push('@cf/llava-hf/llava-1.5-7b-hf');
  assert.deepEqual(rules(x), ['reader-in-draw']);
  const y = clean(); y.kindModels.Draw.push('@cf/google/gemma-4-26b-a4b-it');
  y.selectors.push({ where: 'modelUseCases Draw', kind: 'draw', models: y.kindModels.Draw });
  assert.deepEqual(rules(y), ['reader-in-draw']);
});

test('text-in-listen: a text model in a Listen selector', () => {
  const x = clean(); x.selectors[1].models.push('@cf/zai-org/glm-4.7-flash');
  const f = checkCoverage(x);
  assert.deepEqual(f.map((r) => r.rule), ['text-in-listen']);
  assert.match(f[0].detail, /Customer research/);
});

test('group-no-job: a deck element group with no job id, or an unknown one', () => {
  const x = clean(); x.elementGroups.push({ id: 'media' });
  assert.deepEqual(checkCoverage(x).map((f) => f.detail), ['deck element group media names no job id']);
  const y = clean(); y.elementGroups[0].job = 'ZZ9';
  assert.deepEqual(rules(y), ['group-no-job']);
});

test('stripComments keeps strings, a URL included, and drops both comment forms', () => {
  const out = stripComments("const u = 'https://x.test/a'; // '@cf/old'\n/* '@cf/old' */ const v = \"b\";");
  assert.match(out, /https:\/\/x\.test\/a/);
  assert.doesNotMatch(out, /@cf\/old/);
  assert.match(out, /const v = "b";/);
});

test('indexOfWhole finds an id only where it ends, past an earlier longer match', () => {
  assert.equal(indexOfWhole("'a/x-1-fp8' 'a/x-1'", 'a/x-1'), 13);
  assert.equal(indexOfWhole("'a/x-1.5'", 'a/x-1'), -1);
  assert.equal(indexOfWhole('a/x-1', 'a/x-1'), 0, 'at the end of the text');
});
