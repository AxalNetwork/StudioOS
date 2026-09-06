/**
 * The rail's model menu: what may be typed, and what must be derived.
 *
 * `DECISIONS` D13 removed this menu and set the condition for its return — the
 * router must own the list, and `safety` must not be routable off the guard
 * model. The worker side of that is pinned in
 * `cloudflare-worker/test/ai_router_prices.test.mjs`. This file pins the
 * frontend half, which is a different failure: not "the wrong model runs" but
 * "the right model runs and the screen says something else about it".
 *
 * The line the whole file defends:
 *
 *   FACTS ARE DERIVED — the id, the rate, and which models exist at all come
 *   from `GET /api/ai/pricing`, which reads the router's own tables.
 *   COPY IS TYPED — the display name, the sentence and the recommendation are
 *   editorial judgements with nothing to derive them from, and they live in
 *   `ui/railModels.js` and nowhere else.
 *
 * Crossing that line in either direction is a real, shipped failure mode here:
 * the rail quoted `0.50 / 0.50` for a model Cloudflare bills at `0.293 / 2.253`
 * for months, because the number was typed once and never re-checked.
 *
 * Run with:
 *   npx tsx --test frontend/test/worker_rail_models.test.mjs
 * (from the repo root — the paths below are repo-relative)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const RAIL = 'frontend/src/ui/WorkerRail.jsx';
const COPY = 'frontend/src/ui/railModels.js';
const ROUTER = 'cloudflare-worker/src/services/aiRouter.ts';

/** `alternates` per ROUTE task, constants resolved — the router's own list. */
function alternatesByTask() {
  const src = read(ROUTER);
  const consts = new Map(
    [...src.matchAll(/const (SMALL_LLAMA|MID_LLAMA)\s*=\s*'(@cf\/[^']+)'/g)].map((m) => [m[1], m[2]]),
  );
  const body = src.slice(src.indexOf('export const ROUTE'));
  const entries = [...body.matchAll(/^ {2}([a-z_]+):\s*\{/gm)];
  const out = new Map();
  for (let i = 0; i < entries.length; i += 1) {
    const to = i + 1 < entries.length ? entries[i + 1].index : body.length;
    const chunk = body.slice(entries[i].index, to);
    const alt = /alternates:\s*\[([^\]]*)\]/.exec(chunk);
    out.set(entries[i][1], !alt ? [] : alt[1].split(',').map((x) => x.trim()).filter(Boolean)
      .map((n) => (consts.has(n) ? consts.get(n) : n.replace(/^'|'$/g, ''))));
  }
  return out;
}

/** Model ids used as keys in `MODEL_COPY`. */
const copiedIds = () => [...read(COPY).matchAll(/'(@cf\/[^']+)':\s*\{/g)].map((m) => m[1]);

test('the copy table prices nothing', () => {
  // The one rule that would have caught the four wrong rates. A price in this
  // file is a price nobody re-checks against Cloudflare, because it does not
  // look like configuration — it looks like a sentence.
  const src = codeOnly(read(COPY));
  assert.doesNotMatch(src, /\$\s*\d/, 'a dollar figure was typed into the copy table');
  assert.doesNotMatch(src, /\/\s*M\s+(in|out)\b/i, 'a per-million rate was typed into the copy table');
  assert.doesNotMatch(src, /\bpin\b|\bpout\b|per M input|per audio minute/i,
    'the copy table is reaching for price fields');
  // A price can also arrive as prose — "costs 0.293 per million" — which none
  // of the three patterns above would catch. Numbers are banned in the two
  // fields that carry sentences, and NOT in `name`, where a decimal is part of
  // the model's name and not a figure: an earlier version of this assertion
  // banned every decimal on a line without an id and duly failed on
  // "Llama 3.3 70B Fast".
  for (const m of src.matchAll(/^\s*(why|tags):\s*(.+)$/gm)) {
    assert.doesNotMatch(m[2], /\d+\.\d+/,
      `a decimal in the ${m[1]} field: "${m[2].trim()}" — every figure must be derived`);
  }
});

test('every model the copy table describes is one the router offers', () => {
  // Copy for a model no task offers is dead weight that reads as a promise:
  // someone maintaining the file would reasonably assume the menu shows it.
  const alts = alternatesByTask();
  const offered = new Set([...alts.values()].flat());
  assert.ok(offered.size >= 3, 'no alternates parsed — the matcher is not matching');
  const ids = copiedIds();
  assert.ok(ids.length >= 3, 'the copy table describes fewer models than the menu shows');
  for (const id of ids) {
    assert.ok(offered.has(id),
      `railModels.js describes ${id}, which no ROUTE entry offers — the menu will never show it`);
  }
});

test('every model the router offers has copy, or renders on its bare id', () => {
  // The reverse direction is ALLOWED and this test says so rather than
  // banning it: `modelsForTask` falls back to the id's last segment and an
  // empty sentence. Ugly, not wrong — the model is real and the router offers
  // it; the only thing missing is a description someone has yet to write. What
  // must exist is that fallback.
  const hook = codeOnly(read('frontend/src/hooks/useAiSpend.js'));
  assert.match(hook, /name: c\.name \|\| id\.split\('\/'\)\.pop\(\)/,
    'a model with no copy would render a blank name');
  assert.match(hook, /why: c\.why \|\| ''/, 'a model with no copy would render undefined');
});

test('a recommendation names a model that task actually offers', () => {
  const alts = alternatesByTask();
  const src = read(COPY);
  const block = src.slice(src.indexOf('RECOMMENDED_BY_TASK'));
  const perTask = [...block.matchAll(/^\s{2}([a-z_]+):\s*\[([^\]]*)\]/gm)];
  assert.ok(perTask.length >= 1, 'no task declares a recommendation');
  for (const [, task, list] of perTask) {
    const offered = alts.get(task);
    assert.ok(offered, `RECOMMENDED_BY_TASK names task "${task}", which is not a ROUTE entry`);
    for (const raw of list.split(',').map((x) => x.trim()).filter(Boolean)) {
      const id = raw.replace(/^'|'$/g, '');
      assert.ok(offered.includes(id),
        `${task} recommends ${id}, which is not in its alternates — the rail would badge `
        + 'a model it cannot offer, and the badge would sit on nothing');
    }
  }
});

test('the rail types no rate and no model name', () => {
  const src = codeOnly(read(RAIL));
  assert.doesNotMatch(src, /\$\d|\$\{?\s*\d/, 'a rate was typed into the rail');
  assert.doesNotMatch(src, /Llama|DeepSeek|Whisper|Qwen|Mistral|GPT-OSS|Gemma/i,
    'a model NAME was typed into the rail; names live in railModels.js');
  assert.doesNotMatch(src, /@cf\//, 'a model id was typed into the rail');
  // Both sides of every rate go through the one formatter, so what is shown is
  // what the price list says rather than a rounding of it.
  assert.match(src, /formatRate\(m\.pin\)/);
  assert.match(src, /formatRate\(m\.pout\)/);
  assert.doesNotMatch(src, /\.toFixed\(/, 'the rail is formatting a figure by hand');
});

test('the menu is built from the router, not from the copy table', () => {
  const src = codeOnly(read(RAIL));
  assert.match(src, /modelsForTask\(pricing, surface\.task/,
    'the menu must be derived from the task the surface declares');
  // The single-model card the rail has always drawn is still the fallback for
  // a task that offers no choice, and three other test files require this
  // exact call to be present.
  assert.match(src, /priceForTask\(pricing, surface\.task\)/);

  const hook = codeOnly(read('frontend/src/hooks/useAiSpend.js'));
  // `.map` over `route.alternates`, not merely a mention of it. An earlier
  // version of this matched the bare name and a mutation that returned
  // `Object.keys(copy)` walked straight past it — the guard clause above the
  // return still says `route.alternates`, so the name was there either way.
  assert.match(hook, /return route\.alternates\s*\n\s*\.map\(/,
    'the menu must be MAPPED from the router\'s alternates, not from the copy table');
  assert.doesNotMatch(hook, /Object\.keys\(copy\)|Object\.entries\(copy\)/,
    'the copy table must never decide which models exist');
  assert.match(hook, /if \(!p \|\| typeof p\.in !== 'number' \|\| typeof p\.out !== 'number'\) return null;[\s\S]{0,400}?\.filter\(Boolean\)/,
    'an unpriced model must be dropped from the menu, never rendered at zero');
});

test('the fuller treatment is what a recommendation buys, gated on the flag', () => {
  // The canvas gates the id, the tags and the full rate line on the same
  // `recommended` flag (design/incoming/AIRail.dc.html, three <sc-if> blocks),
  // so the badge is a label on a difference rather than the difference itself.
  // The render check proves a non-recommended entry shows none of the three;
  // this proves the source still asks.
  const src = codeOnly(read(RAIL));
  // Each of the three named, not a count of gates. Counting let a mutation
  // that ungated the id line pass, because the badge's own gate kept the
  // total above the threshold.
  for (const [what, re] of [
    ['the @cf id line', /\{m\.recommended && <span className="fwr-model-id">/],
    ['the tags row', /\{m\.recommended && m\.tags\.length > 0 && \(/],
    ['the full rate line', /\{m\.recommended && \(\s*\n\s*<span className="fwr-model-rate">/],
  ]) {
    assert.match(src, re, `${what} is not gated on m.recommended`);
  }
  assert.match(src, /\{!m\.recommended && \(/,
    'a non-recommended entry must still carry its inline rate');
});

test('the badge is a bare token, and the rail says nothing else about recommending', () => {
  // `scripts/check-regulated-wording.mjs` scans this file and bans
  // `recommend*` — a lexicon aimed at the product sounding like it gives
  // financial advice. A bare RECOMMENDED passes that scan and SHOULD: the
  // script only treats a literal containing a space as prose, on its own
  // stated rule that "a literal that looks like an identifier is not prose".
  //
  // So no exemption was added, and this keeps it that way: the moment the word
  // appears inside a sentence, it is prose, the scanner is right to flag it,
  // and this fails first with the reason.
  const src = codeOnly(read(RAIL));
  // The badge, the boolean field, and the imported constant are all
  // identifiers or a bare token. What must not appear is an inflected form —
  // "recommends", "recommended for", "recommendation" — which is prose.
  const ALLOWED = new Set(['RECOMMENDED', 'recommended', 'RECOMMENDED_BY_TASK']);
  const hits = [...src.matchAll(/\brecommend\w*\b/gi)].map((m) => m[0]);
  assert.deepEqual([...new Set(hits)].filter((h) => !ALLOWED.has(h)), [],
    'a form of "recommend" beyond the bare badge, the boolean field and the imported constant');
  assert.match(src, />RECOMMENDED</,
    'the badge is no longer a bare token; if it grew a sentence it belongs to the lexicon');
});

test('the chosen model reaches the worker', () => {
  // Two links in one chain, and dropping either is silent: the rail renders
  // the 3b selected and its rate, the 70b runs, and every figure on screen is
  // wrong by eight times. Neither end had a source assertion — the browser
  // check caught it, and a browser check is not what CI runs.
  const rail = codeOnly(read(RAIL));
  assert.match(rail, /api\.aiWorkspaceExplain\(\{[\s\S]{0,200}?model: activeModel \|\| undefined/,
    'the rail no longer sends the model it is showing as selected');

  const api = codeOnly(read('frontend/src/lib/api.js'));
  const method = api.slice(api.indexOf('aiWorkspaceExplain:'), api.indexOf('aiWorkspaceExplain:') + 400);
  assert.ok(method.length > 100, 'aiWorkspaceExplain was not found in api.js');
  assert.match(method, /\(\{ workspace, zone, coverage, model \}\)/,
    'the api method no longer accepts a model');
  assert.match(method, /JSON\.stringify\(\{ workspace, zone, coverage, model \}\)/,
    'the api method accepts a model and drops it before the request');
});

test('the estimate is measured, and is not attributed to one model', () => {
  // D16: the caller's own observed average, absent until they have one. And
  // OUTSIDE the menu — `/api/ai/me/spend` groups by task, not by model, so an
  // average printed inside a card claims to be that model's when it is the
  // average across every model this caller has run the task on.
  const src = read(RAIL);
  assert.match(src, /observedRunCost\(spend, surface\.task\)/);
  const fieldset = src.slice(src.indexOf('<fieldset'), src.indexOf('</fieldset>'));
  assert.ok(fieldset.length > 200, 'the menu markup was not found');
  assert.doesNotMatch(fieldset, /observed/,
    'the observed average is rendered inside a model card, where it reads as that model\'s');
  assert.match(src, /No runs of this yet/,
    'with no history the rail must say so rather than print a zero');
  assert.doesNotMatch(codeOnly(src), /tin:|tout:/,
    'a modelled token count reached the rail (D16)');
});

test('the choice is remembered the way every other rail preference is', () => {
  const src = codeOnly(read(RAIL));
  assert.doesNotMatch(src, /localStorage\./,
    'localStorage throws outright in some embedded contexts; use safeReadJSON/safeWriteJSON');
  assert.match(src, /safeReadJSON\(modelKeyFor\(workspace\)/);
  assert.match(src, /safeWriteJSON\(modelKeyFor\(workspace\)/);
  // Per workspace, not per zone: the Validate canvas settles this — "Mode and
  // model are chosen on the workspace, not re-picked here."
  assert.match(src, /const modelKeyFor = \(workspace\)/);
});

test('a stored model the router stopped offering cannot strand the rail', () => {
  // Two halves, and both are needed. Before a run: a stale id is not treated
  // as a selection, so the menu renders the primary selected rather than
  // nothing. After a refused run: the stored id is dropped, or every later
  // click fails identically with no way out short of clearing site data.
  const src = codeOnly(read(RAIL));
  assert.match(src, /models\.some\(\(m\) => m\.id === chosen\) \? chosen : \(models\[0\]\?\.id \?\? null\)/,
    'a stale stored id must fall back to the primary');
  assert.match(src, /refusal === 'model_not_offered'/,
    'the rail must recognise the one refusal it can act on');
  const branch = src.slice(src.indexOf("refusal === 'model_not_offered'"));
  assert.match(branch.slice(0, 300), /setChosen\(null\)/,
    'the rail recognises the refusal and keeps the choice that caused it');
});

test('formatRate prints the published figure, not a rounding of it', async () => {
  // Every one of these is a real row from Cloudflare's pricing tables, read
  // 2026-09-06. `formatSpend`'s two decimal places renders the first as $0.29
  // and the audio rate as $0.00, and a rate shown as $0.00 reads as free —
  // which is how this function came to exist and is the mutation that survived
  // its first run, because nothing pinned it.
  const { formatRate } = await import('../src/ui/assistCost.js');
  const PUBLISHED = [
    [0.293, '$0.293'], [2.253, '$2.253'],     // llama-3.3-70b-instruct-fp8-fast
    [0.152, '$0.152'], [0.287, '$0.287'],     // llama-3.1-8b-instruct-fp8
    [0.051, '$0.051'], [0.335, '$0.335'],     // llama-3.2-3b-instruct
    [0.484, '$0.484'], [0.030, '$0.030'],     // llama-guard-3-8b — trailing zero kept
    [1.320, '$1.320'],                        // deepseek-v4-pro — a whole cent, still 3 places
    [0.012, '$0.012'],                        // bge-m3
    [0.0005, '$0.0005'],                      // whisper, per audio minute — four places
  ];
  for (const [value, want] of PUBLISHED) {
    assert.equal(formatRate(value), want, `${value} printed as something other than ${want}`);
  }
  // Absent is absent, and a bad value is not silently a price.
  assert.equal(formatRate(0), '$0.000');
  assert.equal(formatRate(null), '$0.000');
  assert.equal(formatRate(Number.NaN), '$0.000');
});
