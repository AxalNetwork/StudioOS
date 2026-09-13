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
import { codeOnly } from './_codeOnly.mjs';

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
  // Claim BEFORE the write, or two accepts can both pass the check. Compared in
  // CODE ONLY: this assertion used to look for `insertHypothesis`, and once the
  // dispatch moved to `services/fills/registry.ts` the only occurrence left in
  // this handler was the comment explaining why that writer cannot be
  // reimplemented — so the check was passing on prose. `spec.apply` is the write
  // now, and a docblock mentioning it cannot satisfy this.
  const code = codeOnly(body);
  const claimedAt = code.indexOf("status = 'accepted'");
  const writtenAt = code.indexOf('await spec.apply(');
  assert.ok(claimedAt > 0, 'the claim statement is gone from the accept handler');
  assert.ok(writtenAt > 0, 'the accept handler no longer applies through the registry');
  assert.ok(claimedAt < writtenAt, 'the row must be claimed before it is applied');
});

test('a failed apply puts the proposal back rather than losing it', async () => {
  // D1's HTTP API has no multi-statement transaction, so the claim and the
  // write cannot be atomic together. The compensating action is what keeps an
  // "accepted" proposal from existing with nothing written behind it.
  const body = handler(await routeSrc(), "founderValidate.post('/proposals/:id/accept'");
  assert.match(body, /const revert = async \(\) => \{/);
  assert.match(body, /status = 'pending', decided_by = NULL, decided_at = NULL/);

  // REVERT IS THE FIRST THING THE CATCH DOES. Matched by position inside the
  // catch rather than by a regex butted up against `catch (e) {`, because a
  // comment between the two is not a behaviour change and this assertion should
  // not fail on one.
  const code = codeOnly(body);
  const caught = code.slice(code.indexOf('} catch (e) {'));
  assert.ok(caught.length > 20, 'the accept path no longer catches a failed apply');
  assert.ok(caught.indexOf('await revert();') > 0
    && caught.indexOf('await revert();') < caught.indexOf('return'),
    'a throw during apply leaves the proposal accepted and unwritten');

  // A THEME DELETED BETWEEN PROPOSE AND ACCEPT IS NOT A 500: it is a proposal
  // that no longer applies, and it goes back rather than being swallowed. The
  // check itself moved into `services/fills/registry.ts` with the dispatch — the
  // entry throws and this handler maps the throw — so the guarantee is asserted
  // in both halves rather than dropped because the old one-liner is gone.
  assert.match(code, /if \(\/no longer exists\/i\.test\(msg\)\) return json\(\{ detail: msg \}, 409\)/,
    'a proposal whose theme is gone no longer comes back as a 409');
  const registry = await readFile(resolve(__dirname, '../src/services/fills/registry.ts'), 'utf8');
  assert.match(codeOnly(registry), /if \(!ok\) throw new Error\('That theme no longer exists'\)/,
    'the pain tag entry no longer refuses a theme that is not this project’s');

  // AND AN UNKNOWN KIND REVERTS TOO. A proposal whose kind has left the registry
  // is the same "cannot be applied now" case, and a 500 would strand it accepted.
  assert.match(code, /if \(!spec\) \{\s*await revert\(\);/,
    'a proposal of an unregistered kind is not put back');
});

test('accepting writes through the same function the manual route uses', async () => {
  // One writer, or the server-side `H1, H2 …` allocation has two ideas about
  // itself. It reads the highest code EVER used so a retired H2 is never
  // reissued; a second insert using `COUNT(*) + 1` would start handing out
  // duplicates the first time anything was retired.
  const src = await routeSrc();
  // ONE WRITER, WHEREVER THE CALLER LIVES. `insertHypothesis` stays imported here
  // because `POST /hypotheses` — the manual form — is in this file. The alias
  // upsert's callers moved: the accept path's is `services/fills/registry.ts` and
  // the manual one is `progress.ts`. What this test protects is that no caller
  // grew its own INSERT, which is checked directly below rather than inferred
  // from an import list.
  assert.match(src, /import \{ insertHypothesis \} from '\.\/_founder_validate_writes'/);
  const registry = await readFile(resolve(__dirname, '../src/services/fills/registry.ts'), 'utf8');
  assert.match(registry, /from '\.\.\/\.\.\/routes\/_founder_validate_writes'/,
    'the fills registry no longer draws its writers from the shared module');
  for (const [name, file] of [['founder_validate.ts', src], ['services/fills/registry.ts', registry]]) {
    const inserts = [...file.matchAll(/INSERT INTO hypotheses/g)].length;
    assert.equal(inserts, 0, `${name} writes hypotheses directly (${inserts} statements)`);
    const aliases = [...file.matchAll(/INSERT INTO pain_group_aliases/g)].length;
    assert.equal(aliases, 0, `${name} writes pain aliases directly`);
  }

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

  // EVERY ID THAT REACHES THE PROMPT STILL COMES FROM THE PROJECT'S OWN VIEW —
  // the read moved into `services/fills/registry.ts`'s `gather`, so the assertion
  // moved with it rather than being dropped. The route's only contribution is the
  // context, and `projectId` there is the SCOPED project: `s.project.id`, resolved
  // by `scope` from the path and gated, never a number off the request body.
  assert.match(body, /const ctx = \{ env: c\.env, user: s\.user, projectId: s\.project\.id \};/,
    'the fill context carries a project id the caller could have chosen');
  assert.doesNotMatch(body, /b\.project|b\.projectId|body\?\.project/,
    'the route reads a project id out of the request body');

  // And no gather reaches past its own context for one.
  const registry = await readFile(resolve(__dirname, '../src/services/fills/registry.ts'), 'utf8');
  const gathers = [...registry.matchAll(/async gather\(ctx\)[\s\S]*?\n  \},/g)].map((m) => m[0]);
  assert.ok(gathers.length >= 3, `only ${gathers.length} gathers found — has the registry shrunk?`);
  for (const g of gathers) {
    assert.doesNotMatch(g, /project_id = \?\s*'?\s*\)?\s*\.bind\((?!ctx\.projectId)/,
      'a gather binds a project id that is not its context’s');
    assert.doesNotMatch(g, /WHERE project_id = \d/, 'a gather hardcodes a project id');
  }

  // And the route validates no model of its own — run() owns that list.
  assert.doesNotMatch(body, /alternates|@cf\//,
    'the route re-derives the model allow-list instead of letting run() decide');
});

test('a proposal is refused before it is stored, and the count is reported', async () => {
  // THE GUARANTEE THE SOURCED CLASS RESTS ON, at the last point it can be
  // enforced. `parse` refuses what it can see; `refuseReason` refuses what the
  // CLASS requires regardless of what a parser was written to do — a `sourced`
  // proposal with no citation, a citation with no quote, a restatement carrying
  // one. Two checks and not a redundant one: the store must not be able to hold
  // any of those, whatever the parser does.
  const body = handler(await routeSrc(), "founderValidate.post('/propose/:projectId'");
  assert.match(body, /const why = refuseReason\(spec, p\);/);
  assert.ok(body.indexOf('const why = refuseReason(spec, p);') < body.indexOf('INSERT INTO validate_proposals'),
    'a proposal is stored before the class check runs');
  assert.match(body, /if \(why\) \{ refused\.push\(why\); continue; \}/);

  // REPORTED, NOT SWALLOWED. A run that silently returns two of five reads as a
  // model with little to say, when what happened is that three were refused.
  assert.match(body, /refused: refused\.length,/);
  assert.match(body, /refused_reasons: \[\.\.\.new Set\(refused\)\]/);

  // And the columns migration 246 added are written, or a stored proposal cannot
  // say which surface it belongs to or what it was drawn from.
  for (const column of ['surface', 'fill_class', 'citation_json', 'target_ref']) {
    assert.match(body, new RegExp(`\\b${column}\\b`), `a stored proposal carries no ${column}`);
  }
  assert.match(body, /p\.citation \? JSON\.stringify\(p\.citation\) : null,/);
});

test('nothing is spent to be told there is nothing to work from', async () => {
  // The empty cases are the ones a founder meets most and they are not errors:
  // no themes to sort into, every phrase already grouped, every sizing input
  // already filled. `gather` says so in the words the page shows, and the run
  // never happens — spending a call to be told either by a model is a call wasted.
  const body = handler(await routeSrc(), "founderValidate.post('/propose/:projectId'");
  const gatherAt = body.indexOf('await spec.gather(ctx)');
  const runAt = body.indexOf('await aiRun(c.env, {');
  assert.ok(gatherAt > 0 && runAt > gatherAt, 'the model runs before the facts are gathered');
  assert.match(body, /if \(gathered\.empty\) \{/);
  assert.ok(body.indexOf('if (gathered.empty) {') < runAt,
    'an empty project still spends a run');
  assert.match(body, /message: gathered\.emptyReason \|\|/,
    'the empty reason is dropped, so the page has to invent one');
});
