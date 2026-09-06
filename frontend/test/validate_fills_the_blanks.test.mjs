/**
 * "AI fills the blanks" — the switch, and what it is allowed to switch on.
 *
 * `DECISIONS` D17 refused this toggle for a specific reason: no page branched
 * on a mode, so the switch would have been a control that changed nothing, and
 * persisting it would have made a dead control look deliberate. This file
 * pins the two halves that make it live now.
 *
 *   1. IT BRANCHES. Off writes no proposal and spends nothing; on offers the
 *      two things Validate can actually fill in.
 *   2. IT APPEARS ONLY WHERE IT BRANCHES. Forty-seven pages mount this rail
 *      and one of them has proposals. A switch on the other forty-six would be
 *      exactly the dead control D17 refused, one page over.
 *
 * And the money rule, which is the one worth failing loudly: every run spends
 * the founder's own budget against their own cap, so the mode is OFF until
 * they choose it — whatever the canvas draws.
 *
 * Run with:
 *   npx tsx --test frontend/test/validate_fills_the_blanks.test.mjs
 * (from the repo root)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const RAIL = 'frontend/src/ui/WorkerRail.jsx';
const HOOK = 'frontend/src/hooks/useAssistMode.js';
const BAND = 'frontend/src/workspaces/founder/ValidateProposals.jsx';
const PAGE = 'frontend/src/workspaces/founder/FounderValidateWorkspace.jsx';
const CFG = 'frontend/src/ui/eadwynConfig.js';

test('the mode is off until the founder turns it on', () => {
  // Every run spends their own budget against their own monthly cap. A mode
  // that is on before they chose it spends money they did not agree to spend,
  // and the canvas drawing the card selected is not a reason to.
  const hook = codeOnly(read(HOOK));
  assert.match(hook, /safeReadJSON\(key, false\)/, 'the stored default must be false');
  assert.match(hook, /\(\) => false,/, 'the server snapshot must be false');
  assert.doesNotMatch(hook, /safeReadJSON\(key, true\)|=> true,/,
    'something defaults the mode to on');
});

test('the mode is remembered the way every other rail preference is', () => {
  const hook = codeOnly(read(HOOK));
  assert.doesNotMatch(hook, /localStorage\./,
    'localStorage throws outright in some embedded contexts; use safeReadJSON/safeWriteJSON');
  assert.match(hook, /safeWriteJSON\(key/);
  // Per workspace, not global: turning it on for Validate must not turn it on
  // for Raise, where nothing fills a blank.
  assert.match(hook, /const keyFor = \(workspace\)/);
});

test('the rail draws the switch only where flipping it does something', () => {
  const rail = codeOnly(read(RAIL));
  // `fills` is the host's answer to "does THIS workspace have any". The
  // surface declares the capability; the page declares whether it applies.
  assert.match(rail, /fills = false,/, 'the rail must default to no switch');
  assert.match(rail, /surface\.mode\?\.kind === 'choice' && fills/,
    'the switch must require BOTH a choice-declaring surface and a host that has work');
  // Exactly one host passes it today.
  const hosts = ['frontend/src/workspaces/founder/FounderValidateWorkspace.jsx'];
  for (const h of hosts) assert.match(read(h), /\bfills\b/, `${h} should opt in`);
});

test('a proposal band renders nothing while the mode is off', () => {
  const band = codeOnly(read(BAND));
  assert.match(band, /if \(!enabled \|\| !copy\) return null;/,
    'the band must render nothing when the mode is off');
  // And it must not have fetched on the way to rendering nothing.
  assert.match(band, /if \(!projectId \|\| !enabled\) \{ setItems\(\[\]\); return; \}/,
    'the band reads proposals even with the mode off');
});

test('nothing proposes on mount — a visit must not spend anything', () => {
  // The failure this prevents is quiet and expensive: a component that
  // proposed in an effect would bill a founder for opening a page, once per
  // navigation, and the only visible symptom is a spend meter creeping up.
  const band = codeOnly(read(BAND));
  const effects = [...band.matchAll(/useEffect\(\(\) => \{([\s\S]*?)\}, \[/g)].map((m) => m[1]);
  assert.ok(effects.length >= 1, 'the band has no effects — has it stopped loading at all?');
  for (const body of effects) {
    assert.doesNotMatch(body, /propose|proposeValidate/,
      'an effect calls the propose route; a page visit must never spend');
  }
  // The run is a click, and it is the only caller.
  assert.match(band, /onClick=\{propose\}/);
  assert.match(band, /const propose = async \(\) => \{/);
});

test('the band sends no model, because these are not the rail menu\'s task', () => {
  // The rail's menu is scoped to `workspace_explain`. These are two other task
  // classes with their own `alternates` — the 3b the rail offers for a
  // read-back is not offered for drafting a claim at all — so forwarding the
  // read-back's choice would ask the router for a model this task does not
  // offer, and it would rightly refuse.
  const band = codeOnly(read(BAND));
  assert.match(band, /api\.proposeValidate\(projectId, \{ kind \}\)/,
    'the band sends something other than the kind');
  assert.doesNotMatch(band, /worker_rail_model|activeModel/,
    'the band is reaching for the rail\'s model choice');
});

test('which model wrote a proposal is read from the row, not assumed', () => {
  // The router falls back to a smaller sibling under load. A claim drafted by
  // the small model is not the same artefact as one drafted by the large one,
  // and `decision_gates` — the shape this copies — gets this wrong by
  // returning a hardcoded model name and storing none.
  const band = codeOnly(read(BAND));
  assert.match(band, /p\.model && \(/, 'the band must show the stored model');
  assert.doesNotMatch(band, /@cf\//, 'a model id was typed into the band');
});

test('the two claims the page can no longer make are gone', () => {
  // Both were true when written and are false now. A page that keeps saying
  // "nothing here groups an interview for you" beside a control that groups
  // phrases is worse than one that never said it.
  // Through `codeOnly`, because the comment that replaced each string QUOTES
  // the string it replaced — that is the useful thing for the next reader, and
  // a guard that reads it is a guard that fails on the fix.
  const page = codeOnly(read(PAGE));
  assert.doesNotMatch(page, /never AI-grouped/,
    'the Themes tile still claims nothing is AI-grouped');
  assert.doesNotMatch(page, /does not generate, transcribe, or change records/,
    'the rail note still claims the workspace changes nothing');
  // What replaced them has to still be true. A theme is only ever NAMED by a
  // person — the parser refuses any group id that is not already the
  // founder's — and that is the distinction worth keeping.
  assert.match(page, /you name them; nothing else does/);
  assert.match(read('cloudflare-worker/src/routes/_founder_validate_proposals.ts'),
    /never propose a new theme/,
    'the page promises the founder names every theme; the prompt must say so too');
});

test('the mode note promises nothing the worker cannot do', () => {
  // This began as "transcription is named as absent", because at the time the
  // product had two of the canvas's three capabilities and the third had
  // nowhere to write a transcript. Migration 215 gave it one — so the old
  // assertion had to be deleted to ship the feature it was guarding, which
  // means it was pinning a schedule rather than an invariant.
  //
  // The invariant underneath it is the one that mattered all along: every verb
  // in that sentence is a promise, and a promise with no route behind it is the
  // same class of thing as a button posting to an endpoint that does not exist.
  const cfg = codeOnly(read(CFG));
  const at = cfg.indexOf('mode: {');
  assert.ok(at > 0, 'the workspace surface no longer declares a mode');
  const note = /note: '([^']+)'/.exec(cfg.slice(at, at + 1200))?.[1];
  assert.ok(note, 'the mode declares no note');

  const routes = read('cloudflare-worker/src/routes/founder_validate.ts');

  // Each capability is a verb AND its object, and the note is checked CLAUSE BY
  // CLAUSE against the closed set. A first version matched only the verbs and
  // only the ones it knew, so a mutation appending "and drafts your investor
  // update" sailed through: it matched /drafts/, and an unrecognised promise
  // was invisible to a test that only looked for recognised ones. The whole
  // point of this test is the promise nothing backs, which is the promise
  // nobody thought to list.
  const CAPABILITIES = [
    [/transcrib\w*\s+recording/i, /founderValidate\.post\('\/interviews\/:id\/transcribe'/, 'transcription'],
    [/tags?\s+logged\s+phrases/i, /kind === 'pain_tag'/, 'pain tagging'],
    [/drafts?\s+hypothesis/i, /insertHypothesis/, 'hypothesis drafting'],
  ];
  // The first sentence is the list of promises; the second says what happens to
  // a proposal and is checked separately below.
  const clauses = note.split('.')[0].split(/,|\band\b/).map((c) => c.trim()).filter(Boolean);
  assert.ok(clauses.length >= 2, `the note has ${clauses.length} clause(s) — has it been rewritten?`);
  for (const clause of clauses) {
    const hit = CAPABILITIES.find(([inNote]) => inNote.test(clause));
    assert.ok(hit, `the mode note promises "${clause}", which is not a capability this workspace has`);
    assert.match(routes, hit[1], `the mode note promises ${hit[2]} and no route does it`);
  }

  assert.match(note, /accept, edit or discard/,
    'the mode note must say a proposal is never applied on its own');
});

test('the rail still names a real gap, and not a closed one', () => {
  // The "Unavailable here" block is where this workspace says what it cannot
  // do. Its entry must be true: naming a gap the product has since closed is
  // the same failure as promising something it cannot do, pointed the other
  // way, and it is the failure the Transcription entry would now be.
  const page = codeOnly(read(PAGE));
  const entry = /unavailable=\{\[\['([^']+)', '([^']+)'\]\]\}/.exec(page);
  assert.ok(entry, 'the rail no longer names anything as unavailable');
  const [, title, detail] = entry;
  assert.doesNotMatch(title, /[Tt]ranscri/,
    'transcription is backed now; naming it as unavailable is a stale gap');
  assert.ok(detail.length > 30, 'a gap has to say what is missing, not just label it');
  // Speaker labels are the current gap and are genuinely absent: Whisper
  // returns `words` and `vtt`, migration 215 deliberately stores neither.
  assert.doesNotMatch(read('cloudflare-worker/sql/migrations/215_interview_recordings.sql'),
    /ADD COLUMN transcript_words|ADD COLUMN transcript_vtt|ADD COLUMN speaker/,
    'the schema stores what the rail says it does not');
});

test('the surface declares what off means, not just that it exists', () => {
  const cfg = read(CFG);
  assert.match(cfg, /kind: 'choice'/);
  assert.match(cfg, /manualNote: 'Nothing runs and nothing is spent/,
    'off must be described in the founder\'s terms, not as an absence');
  // And the builder must not have gone back to hardcoding.
  assert.match(cfg, /s\.mode\?\.kind === 'choice'/,
    'eadwynConfig hardcodes the mode again instead of reading the surface');
});

test('the band and the rail read one mode, not two copies of one', () => {
  // With `useState` in each, flipping the switch would change the rail and
  // leave the page as it was until a reload — the classic version of this bug,
  // and the reason the hook is an external store.
  const hook = codeOnly(read(HOOK));
  // The CALL, not a mention of the name. A first version of this matched
  // `/useSyncExternalStore/` and a mutation reading
  // `(globalThis.x || useSyncExternalStore)(...)` walked past it — and so
  // would a `useState` hook that merely imported the name.
  assert.match(hook, /const on = useSyncExternalStore\(\s*\n\s*subscribe,/,
    'two components read this; per-component state would desync on the first click');
  assert.doesNotMatch(hook, /useState\(/,
    'per-component state here means the rail and the page hold different answers');
  assert.match(hook, /const listeners = new Set\(\)/);
  assert.match(hook, /for \(const l of listeners\) l\(\);/,
    'a write that notifies nobody is per-component state with extra steps');
  assert.match(codeOnly(read(RAIL)), /useAssistMode\(workspace\)/);
  assert.match(codeOnly(read(PAGE)), /useAssistMode\('Validate'\)/);
});
