/**
 * D424 — the founder desks' rail and proposal anatomy.
 *
 * Four things, each of which failed in the direction that looks finished:
 *
 *   1. THE SWITCH. Build, Raise and Grow mounted proposal bands gated on their
 *      workspace's mode, and no rail on those desks drew the switch, so no
 *      band could ever be reached. (The per-desk sentences, and the rule that
 *      each promises exactly the bands its desk mounts, are pinned in
 *      `validate_fills_the_blanks.test.mjs`.)
 *   2. THE COST BEFORE A RUN. `ZoneDraft` said it showed the cost before the
 *      run; it drew one only after a draft existed. The desks now pass their
 *      `useAiSpend()` result, and both bands quote the founder's own average
 *      for the task they run — measured, never modelled (D16).
 *   3. EADWYN'S MARK ON A CLAIM. The board route reads `fill_provenance` (the
 *      Worker half is `cloudflare-worker/test/validate_claim_provenance_d424`),
 *      and the Validate desk draws the mark, or says the read failed.
 *   4. THE TOKENS the anatomy paints with, minted at their census values.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/founder_desk_rail_anatomy_d424.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { codeOnly } from './_codeOnly.mjs';
import { renderedText } from './_renderedText.mjs';
import RunEstimate, { runEstimate } from '../src/workspaces/RunEstimate.jsx';
import ZoneDraft, { DRAFT_TASK } from '../src/workspaces/ZoneDraft.jsx';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
// The repo's character scan, not a regex strip: `renderedText` never returns
// a `<`, which is the property CodeQL asks of anything shaped like a
// sanitizer (alert 6191 on this file's first push).
const text = renderedText;

const SPEND = {
  recorded: true,
  by_task_recorded: true,
  month: { spend_usd: 0.4, cap_usd: 5, calls: 9 },
  by_task: [
    { task: 'workspace_explain', calls: 4, spend_usd: 0.0084 },
    { task: 'validate_draft_hypotheses', calls: 2, spend_usd: 0.003 },
  ],
};
const ai = (over = {}) => ({ spend: SPEND, spendError: null, loading: false, reload: () => {}, ...over });

const DESKS = {
  Validate: 'frontend/src/pages/founder/FounderValidatePage.jsx',
  Build: 'frontend/src/pages/founder/FounderBuildDesk.jsx',
  Raise: 'frontend/src/pages/founder/FounderRaiseDesk.jsx',
  Grow: 'frontend/src/pages/founder/FounderGrowDesk.jsx',
};

// ── 2. The cost before a run ─────────────────────────────────────────────────

test('the estimate keeps its four states apart', () => {
  assert.equal(runEstimate(ai({ loading: true }), 'workspace_explain').state, 'loading');
  const seen = runEstimate(ai(), 'workspace_explain');
  assert.equal(seen.state, 'observed');
  assert.equal(seen.calls, 4);
  assert.ok(Math.abs(seen.cost - 0.0021) < 1e-12, 'the average is spend over calls for THIS task');
  assert.equal(runEstimate(ai(), 'validate_tag_pains').state, 'none',
    'a task with no runs is "no average", never a zero');
  // A failed read is three different shapes on the wire; all three are
  // unreadable, never "no runs yet".
  assert.equal(runEstimate(ai({ spend: null, spendError: new Error('x') }), 'workspace_explain').state, 'unreadable');
  assert.equal(runEstimate(ai({ spend: { ...SPEND, recorded: false } }), 'workspace_explain').state, 'unreadable');
  assert.equal(runEstimate(ai({ spend: { ...SPEND, by_task_recorded: false } }), 'workspace_explain').state, 'unreadable');
  // A host that passed nothing gets nothing, not a claim.
  assert.equal(runEstimate(undefined, 'workspace_explain'), null);
  assert.equal(runEstimate(ai(), undefined), null);
});

test('each state reads as what it is', () => {
  const render = (props) => text(renderToStaticMarkup(React.createElement(RunEstimate, props)));
  const seen = render({ ai: ai(), task: 'workspace_explain' });
  assert.match(seen, /^Before you run it · your runs of this have averaged \$0\.0021, over 4\.$/);
  assert.match(render({ ai: ai(), task: 'workspace_explain', shared: "the rail's read-back" }),
    /\(the rail's read-back runs the same task, so it is in the average\)/,
    'an average shared with the rail must say so');
  assert.match(render({ ai: ai(), task: 'validate_tag_pains' }), /no run of this is recorded for you yet, so there is no average to quote/);
  assert.doesNotMatch(render({ ai: ai(), task: 'validate_tag_pains' }), /\$0/, 'no history rendered as a zero');
  const failed = render({ ai: ai({ spend: null, spendError: new Error('x') }), task: 'workspace_explain' });
  assert.match(failed, /Your average for this run could not be read\. That is not a claim that it costs nothing\./);
  assert.match(failed, /Retry/);
  assert.equal(render({ ai: ai({ loading: true }), task: 'workspace_explain' }), '', 'a loading read flickers a figure');
});

test('a zone draft quotes its cost BEFORE the run button, and only where the host passes it', () => {
  const band = (extra) => renderToStaticMarkup(React.createElement(ZoneDraft, {
    surface: 'build/kpi', scopeKey: '7', label: 'Out of range', run: 'Draft an annotation', empty: 'Nothing proposed yet.', accent: 'violet', ...extra,
  }));
  const withAi = band({ ai: ai() });
  const est = withAi.indexOf('data-testid="text-zone-draft-estimate-build-kpi"');
  const button = withAi.indexOf('Draft an annotation');
  assert.ok(est > 0, 'the band drew no cost before its run');
  assert.ok(est < button, 'the cost comes after the button it prices');
  assert.match(text(withAi), /averaged \$0\.0021, over 4/);
  // The other mounts are unchanged: no estimate, and so no fetch was needed.
  assert.doesNotMatch(band({}), /text-zone-draft-estimate/, 'a host that passed nothing still gets an estimate');
});

test('the task a zone draft quotes is the task the Worker runs it on', () => {
  const research = read('cloudflare-worker/src/routes/research.ts');
  const at = research.indexOf("research.post('/drafts'");
  assert.ok(at > 0, 'the draft route moved');
  const body = research.slice(at, research.indexOf('\n});', at));
  const task = /runAI\(c\.env, \{\s*task: '([a-z_]+)'/.exec(body)?.[1];
  assert.ok(task, 'the draft route no longer names its task');
  assert.equal(DRAFT_TASK, task, 'the band quotes one task and bills another');
});

test('a fill band quotes its own kind\'s task, which the Worker sends with the copy', () => {
  const band = codeOnly(read('frontend/src/workspaces/FillProposals.jsx'));
  assert.match(band, /<RunEstimate ai=\{ai\} task=\{spec\.task\}/,
    'the fill band quotes a task other than its own kind\'s');
  const route = read('cloudflare-worker/src/routes/founder_validate.ts');
  const at = route.indexOf("founderValidate.get('/proposals/:projectId'");
  const body = route.slice(at, route.indexOf('\n});', at));
  assert.match(body, /\n\s+task: k\.task,\n/, 'the list does not say which task a kind bills');
});

test('every band on the four desks gets the desk\'s spend read, and the read waits for the mode', () => {
  for (const [name, file] of Object.entries(DESKS)) {
    const page = codeOnly(read(file));
    assert.match(page, /const ai = useAiSpend\(\{ enabled: fillsOn && Boolean\(projectId\) \}\);/,
      `${name} reads spend with its bands off, or not at all`);
    const bands = [...page.matchAll(/<(ZoneDraft|FillProposals)\b[\s\S]*?\/>/g)].map((m) => m[0]);
    assert.ok(bands.length > 0, `${name} has no bands`);
    for (const b of bands) assert.match(b, /\bai=\{ai\}/, `${name} mounts a band with no cost before its run:\n${b.slice(0, 120)}`);
  }
});

// ── 3. Eadwyn's mark on a claim ──────────────────────────────────────────────

test('the Validate desk draws Eadwyn\'s mark from the board, and says when it could not read it', () => {
  const page = codeOnly(read(DESKS.Validate));
  assert.match(page, /<FilledMark filled=\{item\.filled\} id=\{item\.id\} \/>/, 'the hypothesis card draws no mark');
  assert.match(page, /if \(!filled\) return null;/);
  assert.match(page, /filled\.edited \? 'Proposed by Eadwyn · you edited it' : 'Proposed by Eadwyn'/,
    'a corrected proposal reads as an unaided one');
  assert.match(page, /fillsRecorded=\{board\?\.fills_recorded !== false\}/);
  assert.match(page, /!fillsRecorded \? <div data-testid="status-desk-fills-unreadable"><Unreadable/,
    'a failed provenance read renders as a board with no marks');
});

// ── Voice ────────────────────────────────────────────────────────────────────

test('no desk calls what Eadwyn produces advice or a recommendation', () => {
  // "Advisor" is not banned here: human advisors are a real persona, and the
  // Network zones filter by them. What is banned is the assistant's output
  // described as advice.
  for (const file of [...Object.values(DESKS),
    'frontend/src/pages/founder/FounderNetworkDesk.jsx', 'frontend/src/pages/founder/FounderResearchDesk.jsx']) {
    const page = codeOnly(read(file));
    assert.doesNotMatch(page, /\badvice\b/i, `${file} says "advice"`);
    assert.doesNotMatch(page, /\brecommend(ation|ed|s)?\b/i, `${file} says "recommend"`);
  }
  assert.match(read(DESKS.Raise), /foot="A reading of your documents, not counsel's review\. Counsel is on the Team page\."/);
});

// ── 4. Tokens ────────────────────────────────────────────────────────────────

test('the semantic tokens the anatomy paints with are minted at their census values', () => {
  const css = read('frontend/src/index.css');
  const census = JSON.parse(read('design/tokens/tokens.json')).color;
  const MINTED = [
    ['--color-axal-lavender-edge', 'lavenderEdge'],
    ['--color-axal-positive', 'positive'],
    ['--color-axal-destructive', 'destructive'],
    ['--color-axal-destructive-tint', 'destructiveTint'],
    ['--color-axal-destructive-edge', 'destructiveEdge'],
  ];
  const theme = css.slice(css.indexOf('@theme {'), css.indexOf('\n}', css.indexOf('@theme {')));
  for (const [cssVar, key] of MINTED) {
    const value = new RegExp(`${cssVar}:\\s*(#[0-9a-f]{6});`).exec(theme)?.[1];
    assert.equal(value, census[key].value, `${cssVar} is not the census's ${key}`);
  }
  // Each is used, with its own dark counterpart beside it: a status colour is
  // not a neutral, and the dark skin does not flip it.
  const uses = [
    ['frontend/src/workspaces/ZoneDraft.jsx', /text-axal-positive dark:text-emerald-400/],
    ['frontend/src/workspaces/ZoneDraft.jsx', /border-axal-destructive-edge bg-axal-destructive-tint[\s\S]{0,80}text-axal-destructive dark:border-red-900 dark:bg-red-950\/30 dark:text-red-200/],
    [DESKS.Validate, /border-axal-lavender-edge bg-axal-lavender[^"]*dark:border-violet-900 dark:bg-violet-950\/40 dark:text-violet-300/],
  ];
  for (const [file, re] of uses) assert.match(read(file), re, `${file} paints a semantic token with no dark pair`);
});
