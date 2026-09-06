/**
 * What a model suggests, and what is allowed to become a row.
 *
 * These parsers stand between a language model and D1. Everything they let
 * through appears to a founder under an "Accept" button, which is a claim that
 * the platform has checked it. So the cases pinned here are the ones where a
 * plausible-looking proposal would be a lie or a break:
 *
 *   · a phrase the model invented or "corrected", which no interview contains
 *   · a `pain_group_id` the model made up, or one belonging to another venture
 *   · a claim that restates a hypothesis the founder already has
 *   · a claim the founder already threw away, offered back to them
 *   · a reply that is not JSON at all, or is JSON of the wrong shape
 *
 * Every one of those is silent if it gets through: the row looks exactly like
 * a good one.
 *
 * Run with:
 *   node --test cloudflare-worker/test/founder_validate_proposals.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { transpileTs as transpile } from './_transpile-ts.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** The mirror-the-tree loader the other Validate suites use. */
async function load(entry, deps) {
  const tmp = await mkdtemp(join(tmpdir(), 'validate-proposals-'));
  let first = '';
  for (const rel of [entry, ...deps]) {
    const src = await readFile(resolve(__dirname, '../src', rel), 'utf8');
    const out = join(tmp, rel.replace(/\.ts$/, '.mjs'));
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, transpile(src).replace(/from '(\.\.?\/[^']+)'/g, "from '$1.mjs'"));
    if (!first) first = out;
  }
  return import(pathToFileURL(first).href);
}

const mod = () => load('routes/_founder_validate_proposals.ts', []);

const GROUPS = [
  { id: 21, title: 'Manual reconciliation' },
  { id: 22, title: 'Slow onboarding' },
];
const UNGROUPED = ['reconciling by hand', 'takes weeks to onboard', 'no audit trail'];

const reply = (v) => JSON.stringify(v);

test('a phrase no interview contains is refused', async () => {
  const { parseTagProposals } = await mod();
  // The model "improved" the wording. The improved version is not in any
  // interview, so tagging it would create an alias for a phrase the venture
  // never heard — and the pain map counts aliases.
  const out = parseTagProposals(
    reply([{ phrase: 'reconciling accounts manually', pain_group_id: 21 }]),
    UNGROUPED, GROUPS,
  );
  assert.deepEqual(out, []);
});

test('the project\'s own string is stored, not the model\'s echo of it', async () => {
  const { parseTagProposals } = await mod();
  // Same phrase, different case and spacing. It matches, and what gets stored
  // is the string the interview actually holds.
  const out = parseTagProposals(
    reply([{ phrase: '  Reconciling  By   Hand ', pain_group_id: 21 }]),
    UNGROUPED, GROUPS,
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].phrase, 'reconciling by hand');
  assert.equal(out[0].pain_group_id, 21);
  assert.equal(out[0].group_title, 'Manual reconciliation');
});

test('an invented or foreign pain_group_id is refused', async () => {
  const { parseTagProposals } = await mod();
  for (const id of [999, 0, -1, null, 'twenty-one']) {
    const out = parseTagProposals(
      reply([{ phrase: 'no audit trail', pain_group_id: id }]), UNGROUPED, GROUPS,
    );
    assert.deepEqual(out, [], `pain_group_id ${JSON.stringify(id)} was accepted`);
  }
});

test('one phrase cannot be proposed into two themes at once', async () => {
  const { parseTagProposals } = await mod();
  // `pain_group_aliases` is UNIQUE on (project_id, phrase_norm) — a phrase
  // belongs to exactly one theme. Two proposals for it would present the
  // founder with a choice the second accept would silently overwrite.
  const out = parseTagProposals(reply([
    { phrase: 'no audit trail', pain_group_id: 21 },
    { phrase: 'no audit trail', pain_group_id: 22 },
  ]), UNGROUPED, GROUPS);
  assert.equal(out.length, 1);
  assert.equal(out[0].pain_group_id, 21, 'the first proposal wins');
});

test('a reply that is not JSON proposes nothing, and does not throw', async () => {
  const { parseTagProposals, parseDraftProposals } = await mod();
  for (const junk of ['', 'I cannot do that.', '{not json', '[[[', 'null', '{"a":1}']) {
    assert.deepEqual(parseTagProposals(junk, UNGROUPED, GROUPS), [], `tag: ${junk}`);
    assert.deepEqual(parseDraftProposals(junk, []), [], `draft: ${junk}`);
  }
});

test('JSON wrapped in prose or a fence is still read', async () => {
  const { parseDraftProposals } = await mod();
  const wrapped = 'Here you go:\n```json\n[{"claim":"Ops leads will pay to stop reconciling by hand."}]\n```\nHope that helps.';
  const out = parseDraftProposals(wrapped, []);
  assert.equal(out.length, 1);
  assert.equal(out[0].claim, 'Ops leads will pay to stop reconciling by hand.');
});

test('a claim that restates an existing hypothesis is refused', async () => {
  const { parseDraftProposals } = await mod();
  const existing = ['Ops leads will pay to stop reconciling by hand.'];
  const out = parseDraftProposals(
    reply([{ claim: '  ops leads WILL pay to stop   reconciling by hand. ' }]),
    existing,
  );
  assert.deepEqual(out, [], 'a case-and-spacing variant is the same claim');
});

test('a fragment is not a hypothesis', async () => {
  const { parseDraftProposals } = await mod();
  // A model that has run out of ideas emits fragments rather than stopping.
  const out = parseDraftProposals(reply([
    { claim: 'Reconciliation' },
    { claim: 'Maybe pricing' },
    { claim: 'Ops leads at mid-market freight firms will pay to stop reconciling by hand.' },
  ]), []);
  assert.equal(out.length, 1);
  assert.match(out[0].claim, /^Ops leads at mid-market/);
});

test('two identical claims in one reply yield one proposal', async () => {
  const { parseDraftProposals } = await mod();
  const out = parseDraftProposals(reply([
    { claim: 'Ops leads will pay to stop reconciling by hand.' },
    { claim: 'Ops leads will pay to stop reconciling by hand.' },
  ]), []);
  assert.equal(out.length, 1);
});

test('a bare string array is accepted as claims', async () => {
  const { parseDraftProposals } = await mod();
  // Models ignore the object shape about a third of the time. Refusing this
  // would throw away a usable answer over its packaging.
  const out = parseDraftProposals(
    reply(['Ops leads at freight firms will pay to stop reconciling by hand.']), [],
  );
  assert.equal(out.length, 1);
});

test('a run cannot propose more than the cap', async () => {
  const { parseDraftProposals, MAX_PROPOSALS_PER_RUN } = await mod();
  const many = Array.from({ length: 40 }, (_, i) => ({ claim: `Ops leads in segment ${i} will pay for this monthly.` }));
  const out = parseDraftProposals(reply(many), []);
  assert.equal(out.length, MAX_PROPOSALS_PER_RUN);
  assert.ok(MAX_PROPOSALS_PER_RUN <= 5, 'a wall of cards is not a draft');
});

test('the prompts forbid the two things the product forbids everywhere else', async () => {
  const { TAG_PROMPT, DRAFT_PROMPT } = await mod();
  // The same two rules `WORKSPACE_EXPLAIN_PROMPT` carries, because they are
  // product rules and not per-surface taste.
  assert.match(DRAFT_PROMPT, /Never state a fact that is not in the list you were given/);
  assert.match(DRAFT_PROMPT, /Do not estimate/);
  assert.match(DRAFT_PROMPT, /No advice about raising money, investing, taxes, or legal structure/);
  // And the one rule that is specific to this surface: the model sorts into
  // themes, it does not name them.
  assert.match(TAG_PROMPT, /never propose a new theme/);
  assert.match(TAG_PROMPT, /Never invent or reword one/);
});

test('the two kinds route to two task classes, both real', async () => {
  const { TASK_FOR_KIND, PROPOSAL_KINDS } = await mod();
  const router = await readFile(resolve(__dirname, '../src/services/aiRouter.ts'), 'utf8');
  assert.deepEqual([...PROPOSAL_KINDS].sort(), ['hypothesis', 'pain_tag']);
  for (const kind of PROPOSAL_KINDS) {
    const task = TASK_FOR_KIND[kind];
    assert.ok(task, `${kind} has no task class`);
    // Registered in ROUTE, or every figure the rail reports for it is wrong —
    // and `run()` refuses an unknown task outright.
    assert.match(router, new RegExp(`^  ${task}: \\{`, 'm'), `${task} is not a ROUTE entry`);
    assert.match(router, new RegExp(`\\| '${task}'`), `${task} is not in the TaskClass union`);
  }
  // Distinct classes, because /api/ai/me/spend groups by task and the rail
  // quotes the caller's observed average per task.
  assert.notEqual(TASK_FOR_KIND.pain_tag, TASK_FOR_KIND.hypothesis);
});

test('neither proposal task is cached', async () => {
  // A proposal is drawn from evidence that changes every time an interview is
  // logged — which is exactly when someone would ask for one again. A cached
  // answer would describe the map as it was and look current.
  const { TASK_FOR_KIND } = await mod();
  const router = await readFile(resolve(__dirname, '../src/services/aiRouter.ts'), 'utf8');
  const body = router.slice(router.indexOf('export const ROUTE'));
  const entries = [...body.matchAll(/^ {2}([a-z_]+):\s*\{/gm)];
  for (const task of Object.values(TASK_FOR_KIND)) {
    const i = entries.findIndex((e) => e[1] === task);
    assert.ok(i >= 0, `${task} not found`);
    const to = i + 1 < entries.length ? entries[i + 1].index : body.length;
    assert.doesNotMatch(body.slice(entries[i].index, to), /cacheTtlSec/,
      `${task} caches, so a proposal could describe evidence that has moved on`);
  }
});

// ---------------------------------------------------------------------------
// The route layer. Source-shape assertions, in the same style as
// `ai_workspace_explain.test.ts`: the accept path needs auth, a project and a
// D1 to exercise for real, and the three properties below are the ones whose
// absence is silent.
// ---------------------------------------------------------------------------

const routeSrc = () => readFile(resolve(__dirname, '../src/routes/founder_validate.ts'), 'utf8');
const handler = (src, marker) => {
  const from = src.indexOf(marker);
  assert.ok(from > 0, `${marker} is gone`);
  const end = src.indexOf('\n});', from);
  return src.slice(from, end < 0 ? src.length : end + 4);
};

test('two founders cannot both accept one proposal', async () => {
  // Without `AND status = 'pending'` the second accept writes the row again:
  // a second hypothesis with the same claim and the next code, or a pain alias
  // silently re-pointed. `routes/pipeline.ts` uses this idiom on
  // `decision_gates` and it is the reason that table is safe.
  const body = handler(await routeSrc(), "founderValidate.post('/proposals/:id/accept'");
  assert.match(body, /WHERE id = \? AND status = 'pending'/,
    'the accept path claims the row without optimistic concurrency');
  assert.match(body, /if \(!claim\.meta\?\.changes\)/,
    'the claim result is not checked, so a losing race writes anyway');
  assert.match(body, /409/, 'a lost race must be a 409, not a second write');
  // Claim BEFORE the write, or two accepts can both pass the check.
  assert.ok(body.indexOf("status = 'accepted'") < body.indexOf('insertHypothesis'),
    'the row must be claimed before it is applied');
});

test('a failed apply puts the proposal back rather than losing it', async () => {
  // D1's HTTP API has no multi-statement transaction, so the claim and the
  // write cannot be atomic together. The compensating action is what keeps an
  // "accepted" proposal from existing with nothing written behind it.
  const body = handler(await routeSrc(), "founderValidate.post('/proposals/:id/accept'");
  assert.match(body, /const revert = async \(\) => \{/);
  assert.match(body, /status = 'pending', decided_by = NULL, decided_at = NULL/);
  assert.match(body, /catch \(e\) \{\s*await revert\(\);/,
    'a throw during apply leaves the proposal accepted and unwritten');
  // A theme deleted between propose and accept is not a 500: it is a proposal
  // that no longer applies, and it goes back rather than being swallowed.
  assert.match(body, /if \(!ok\) \{ await revert\(\); return json\(\{ detail: 'That theme no longer exists' \}, 409\); \}/);
});

test('accepting writes through the same function the manual route uses', async () => {
  // One writer, or the server-side `H1, H2 …` allocation has two ideas about
  // itself. It reads the highest code EVER used so a retired H2 is never
  // reissued; a second insert using `COUNT(*) + 1` would start handing out
  // duplicates the first time anything was retired.
  const src = await routeSrc();
  assert.match(src, /import \{ insertHypothesis, upsertPainAlias \} from '\.\/_founder_validate_writes'/);
  const inserts = [...src.matchAll(/INSERT INTO hypotheses/g)].length;
  assert.equal(inserts, 0, `founder_validate.ts writes hypotheses directly (${inserts} statements)`);
  const aliases = [...src.matchAll(/INSERT INTO pain_group_aliases/g)].length;
  assert.equal(aliases, 0, 'founder_validate.ts writes pain aliases directly');

  // And the other caller went through it too, rather than keeping its copy.
  const progress = await readFile(resolve(__dirname, '../src/routes/progress.ts'), 'utf8');
  assert.match(progress, /upsertPainAlias\(c\.env, projectId, groupId, display\)/);
  assert.doesNotMatch(progress, /INSERT INTO pain_group_aliases/,
    'progress.ts kept its own copy of the alias upsert');

  // The allocation itself exists exactly once, in the shared writer. Scoped to
  // the FUNCTION rather than the file: the docblock above it explains the rule
  // by naming the anti-pattern, so a whole-file ban on `COUNT(*)` fails on the
  // comment that documents why `COUNT(*)` is wrong.
  const writes = await readFile(resolve(__dirname, '../src/routes/_founder_validate_writes.ts'), 'utf8');
  const fn = writes.slice(writes.indexOf('export async function insertHypothesis'));
  const bodyOnly = fn.slice(0, fn.indexOf('\n}') + 2);
  assert.match(bodyOnly, /MAX\(CAST\(substr\(code, 2\) AS INTEGER\)\)/);
  assert.doesNotMatch(bodyOnly, /COUNT\(\*\)/, 'codes must come from the highest ever used, not the count');
});

test('a run reads only this project, and nothing a caller names', async () => {
  const body = handler(await routeSrc(), "founderValidate.post('/propose/:projectId'");
  assert.match(body, /const s = await scope\(c, Number\(c\.req\.param\('projectId'\)\), canWrite\)/,
    'propose is not behind the write gate');
  // Every id that reaches the prompt comes from the project's own view.
  assert.match(body, /getPainGroupsView\(c\.env, s\.project\.id\)/);
  // And the route validates no model of its own — run() owns that list.
  assert.doesNotMatch(body, /alternates|@cf\//,
    'the route re-derives the model allow-list instead of letting run() decide');
});
