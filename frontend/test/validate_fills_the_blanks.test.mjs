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
 *      and five of them have proposals — the Validate zones and four founder
 *      desks (D424). A switch on the others would be exactly the dead control
 *      D17 refused, one page over.
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
const BAND = 'frontend/src/workspaces/FillProposals.jsx';
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
  // The hosts that have proposal bands. The four desks joined in D424: their
  // bands had been gated on the mode since they were mounted, and no rail on
  // those desks drew a switch, so none of them could be reached.
  const hosts = [
    'frontend/src/workspaces/founder/FounderValidateWorkspace.jsx',
    ...Object.values(DESKS).filter((d) => d.bands.length).map((d) => d.file),
  ];
  for (const h of hosts) {
    assert.match(codeOnly(read(h)), /<WorkerRail[^>]*?\n\s*fills\n/,
      `${h} has proposal bands and its rail draws no switch for them`);
  }
});

/**
 * Every founder desk: its file, the draft surfaces its bands run, and the
 * clause in its `desks` sentence that promises each one (D424). A desk with no
 * bands has an empty list and must not draw a switch.
 *
 * `route` is where the capability lives: Validate's bands post to
 * founder_validate.ts, and every other desk's bands run a `DRAFT_SURFACES`
 * entry in research.ts.
 */
const DESKS = {
  Validate: {
    file: 'frontend/src/pages/founder/FounderValidatePage.jsx',
    bands: [
      [/transcrib\w*\s+recording/i, /founderValidate\.post\('\/interviews\/:id\/transcribe'/, 'transcription', null],
      [/tags?\s+logged\s+phrases/i, /kind === 'pain_tag'/, 'pain tagging', 'kind="pain_tag"'],
      [/drafts?\s+hypothesis/i, /insertHypothesis/, 'hypothesis drafting', 'kind="hypothesis"'],
    ],
  },
  Build: {
    file: 'frontend/src/pages/founder/FounderBuildDesk.jsx',
    bands: [
      [/monday plan/i, 'build/this-week'],
      // D510 — the cadence card's band, between the week and the roadmap.
      [/friday retro/i, 'build/retro'],
      [/roadmap ordering/i, 'build/roadmap'],
      [/annotates the metric/i, 'build/kpi'],
    ],
  },
  Raise: {
    file: 'frontend/src/pages/founder/FounderRaiseDesk.jsx',
    bands: [
      [/round back/i, 'raise/capital'],
      [/clauses/i, 'raise/legal'],
      [/data room/i, 'raise/data-room'],
      [/order of payment/i, 'raise/liquidity'],
    ],
  },
  Grow: {
    file: 'frontend/src/pages/founder/FounderGrowDesk.jsx',
    bands: [
      [/ranks applicants/i, 'grow/talent'],
      [/outreach sequence/i, 'grow/customers'],
    ],
  },
  Network: { file: 'frontend/src/pages/founder/FounderNetworkDesk.jsx', bands: [] },
  Research: { file: 'frontend/src/pages/founder/FounderResearchDesk.jsx', bands: [] },
};

/** `desks: { Name: { fills|none: '…' } }` out of the config, as text. */
function deskCopy() {
  const cfg = codeOnly(read(CFG));
  const at = cfg.indexOf('desks: {');
  assert.ok(at > 0, 'the workspace surface declares no per-desk copy');
  const block = cfg.slice(at, cfg.indexOf('\n    },', at));
  return Object.fromEntries([...block.matchAll(/^ {6}(\w+): \{ (fills|none): '([^']+)' \},$/gm)]
    .map(([, name, kind, text]) => [name, { kind, text }]));
}

test('a proposal band renders nothing while the mode is off', () => {
  const band = codeOnly(read(BAND));
  // `!spec` where this used to read `!copy`: the band's words now come from the
  // server's registry on the list response rather than from a local map, so the
  // same early return also covers a kind the server does not offer — a heading
  // for a capability that may not exist is the rail's own failure mode, one
  // surface over.
  assert.match(band, /if \(!enabled \|\| !spec\) return null;/,
    'the band must render nothing when the mode is off');
  // And it must not have fetched on the way to rendering nothing.
  assert.match(band, /if \(!projectId \|\| !enabled\) \{ setItems\(\[\]\); return; \}/,
    'the band reads proposals even with the mode off');
  // The local COPY map is gone, not shadowed. Two places for one fact is what
  // `services/fills/registry.ts` was built to stop, and a leftover map here would
  // be the half that drifts.
  assert.doesNotMatch(band, /const COPY = \{/,
    'the band kept its own copy map, so a new kind has to be added twice');
});

test('Edit the claim exists, and only where the value may be rewritten', () => {
  // The canvas has drawn accept / edit / discard since this band was designed and
  // only two of the three were ever built; the third lived in a header comment
  // describing an artboard. Accepting a value a founder would have corrected
  // teaches them to discard and retype, which is the same work with the
  // proposal's provenance thrown away.
  const band = codeOnly(read(BAND));
  assert.match(band, /data-testid=\{`action-edit-\$\{p\.id\}`\}/,
    'the Edit control is missing again');
  assert.match(band, /data-testid=\{`edit-field-\$\{p\.id\}`\}/, 'there is nothing to type into');

  // GATED ON THE SERVER'S ANSWER, not on the kind. A `pain_tag`'s phrase is the
  // project's own logged string and the accept route refuses an edit to it, so an
  // ungated control would be a button that always fails.
  assert.match(band, /\{spec\.editable && \(/,
    'the Edit control is drawn for kinds whose value cannot be edited');

  // AN UNCHANGED EDIT IS A PLAIN ACCEPT. `fill_provenance` derives `edited` by
  // comparing the two values, so sending the untouched original would mark every
  // accept corrected and the column would stop meaning anything.
  assert.match(band, /next === readable\(p\.kind, p\.payload\)\.trim\(\) \? undefined : next/,
    'an unchanged edit is sent as an edit');
  const api = read('frontend/src/lib/api.js');
  assert.match(api, /acceptValidateProposal: \(id, body\) =>/);
  assert.match(api, /\.\.\.\(body \? \{ body: JSON\.stringify\(body\) \} : \{\}\)/,
    'the accept call always sends a body, so an unedited accept looks edited');
});

test('a sourced proposal shows its source, quote included', () => {
  // A citation that names a document and nothing else asks a reader to trust the
  // label. The quote is what lets them judge whether the source says what the fill
  // claims it says — which is the only check available to them.
  const band = codeOnly(read(BAND));
  assert.match(band, /function Citation\(\{ citation \}\)/);
  assert.match(band, /if \(!citation\) return null;/,
    'a restatement, which has no citation by design, renders an empty source line');
  assert.match(band, /citation\.quote \?/, 'the quote is not shown');
  assert.match(band, /<Citation citation=\{p\.citation\} \/>/, 'nothing renders the citation');
  // And the server sends it.
  const route = read('cloudflare-worker/src/routes/founder_validate.ts');
  const at = route.indexOf("founderValidate.get('/proposals/:projectId'");
  assert.ok(at > 0, 'the proposals list route is gone');
  const body = route.slice(at, route.indexOf('\n});', at));
  assert.match(body, /citation: \(\(\) => \{/, 'the list no longer returns the citation');
  assert.match(body, /kinds: Object\.fromEntries\(Object\.values\(FILL_KINDS\)/,
    'the band has no source for its own copy');
  assert.match(body, /editable: k\.editableField != null/,
    'the list does not say which kinds may be edited');
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

test('the mode card promises only what is true on every desk that draws it', () => {
  // The card reads ONE surface on every host (D424), so its sentence may name
  // no desk's capability: a Validate list here promised transcription on the
  // Raise desk the moment Raise drew the switch. What each desk does is its
  // own sentence, checked below.
  const cfg = codeOnly(read(CFG));
  const at = cfg.indexOf('mode: {');
  assert.ok(at > 0, 'the workspace surface no longer declares a mode');
  const note = /note: '([^']+)'/.exec(cfg.slice(at, at + 1200))?.[1];
  assert.ok(note, 'the mode declares no note');
  for (const { bands } of Object.values(DESKS)) {
    for (const [inNote] of bands) {
      assert.doesNotMatch(note, inNote, `the shared card promises one desk's capability: ${inNote}`);
    }
  }
  assert.match(note, /only when you press/, 'the card must say nothing runs until a press');
  assert.match(note, /accept, edit or discard/,
    'the mode note must say a proposal is never applied on its own');
});

test('each desk promises exactly the bands it mounts, and nothing else', () => {
  // This began as "transcription is named as absent", because at the time the
  // product had two of the canvas's three capabilities and the third had
  // nowhere to write a transcript. Migration 215 gave it one — so the old
  // assertion had to be deleted to ship the feature it was guarding, which
  // means it was pinning a schedule rather than an invariant.
  //
  // The invariant underneath it is the one that mattered all along: every verb
  // in a desk's sentence is a promise, and a promise with no route behind it is
  // the same class of thing as a button posting to an endpoint that does not
  // exist. So each sentence is checked CLAUSE BY CLAUSE against a closed set —
  // a first version matched only the verbs it knew, and a mutation appending
  // "and drafts your investor update" sailed through. And the other direction
  // (D424): a band the desk mounts that its sentence does not name is a
  // capability the switch turns on without saying so.
  const copy = deskCopy();
  const validateRoutes = read('cloudflare-worker/src/routes/founder_validate.ts');
  const research = read('cloudflare-worker/src/routes/research.ts');
  assert.deepEqual(Object.keys(copy).sort(), Object.keys(DESKS).sort(),
    'the per-desk copy and the six founder desks disagree');

  for (const [name, desk] of Object.entries(DESKS)) {
    const page = codeOnly(read(desk.file));
    const entry = copy[name];
    // The rail's `note` IS this desk's sentence — read from the config under
    // the desk's own name, never another desk's and never retyped.
    assert.match(page, new RegExp(`note=\\{ASSIST_SURFACES\\.workspace\\.desks\\.${name}\\.${entry.kind}\\}`),
      `${name}'s rail does not print its own sentence`);
    assert.match(page, new RegExp(`<WorkerRail[\\s\\S]*?workspace="${name}"`), `${name}'s rail names another workspace`);

    if (!desk.bands.length) {
      assert.equal(entry.kind, 'none', `${name} has no band, so it must say why there is no switch`);
      assert.doesNotMatch(page, /<ZoneDraft|<FillProposals/, `${name} mounts a band its copy says it does not have`);
      assert.doesNotMatch(page, /<WorkerRail[^>]*?\n\s*fills\n/, `${name} draws a switch that changes nothing (D17)`);
      continue;
    }
    assert.equal(entry.kind, 'fills', `${name} has bands, so its sentence must say what the switch does`);
    const clauses = entry.text.split('.')[0].split(/,|\band\b/).map((c) => c.trim()).filter(Boolean);
    assert.ok(clauses.length >= desk.bands.length,
      `${name}'s sentence has ${clauses.length} clause(s) for ${desk.bands.length} band(s)`);
    for (const clause of clauses) {
      const hit = desk.bands.find(([inNote]) => inNote.test(clause));
      assert.ok(hit, `${name} promises "${clause}", which is not a band on that desk`);
    }
    for (const band of desk.bands) {
      const [inNote, target] = band;
      assert.ok(clauses.some((c) => inNote.test(c)), `${name} mounts ${target} and its sentence does not say so`);
      if (target instanceof RegExp) {
        // Validate: the route must exist, and the band (where it is one on
        // this desk) must be mounted with that kind.
        assert.match(validateRoutes, target, `${name} promises ${band[2]} and no route does it`);
        if (band[3]) assert.ok(page.includes(band[3]), `${name} promises ${band[2]} and mounts no band for it`);
      } else {
        assert.ok(page.includes(`surface="${target}"`), `${name} promises ${target} and mounts no band for it`);
        assert.ok(research.includes(`\n  '${target}': {`), `${name}'s ${target} band has no DRAFT_SURFACES entry`);
      }
    }
    // Every draft band the desk mounts is one the sentence accounts for.
    for (const [, surf] of page.matchAll(/surface="([^"]+)"/g)) {
      assert.ok(desk.bands.some(([, t]) => t === surf), `${name} mounts ${surf} and its sentence does not name it`);
    }
  }
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
