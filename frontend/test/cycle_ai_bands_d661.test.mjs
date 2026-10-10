/**
 * D661 (#1474) — the four founder desks are retired, and what they carried
 * that is still true now lives on the cycle pages or is pinned here.
 *
 * `FounderValidatePage`, `FounderBuildDesk`, `FounderRaiseDesk` and
 * `FounderGrowDesk` were each a cycle's landing until the cycle overviews
 * replaced them (`pages/cycles/CycleRoute.jsx`). Their own test files pinned
 * the desks' layout against the 2026 artboards, and that went with them. What
 * is kept:
 *
 *   - THE AI BANDS (D424, D510). Every band a desk mounted is drawn on the
 *     cycle module page whose read it explains, behind the same switch, with
 *     the same spend read, and on a surface the Worker allow-lists. Raise's
 *     four had not moved when the desk was unmounted; they move here.
 *   - THE WORKER CONTRACTS the desk tests pinned that a live page still reads:
 *     draft-surface scoping, the band's accent, the cadence route, and the
 *     fields the interview, verdict, round, waterfall and focus pages read.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import { CYCLES, cycleBands, cycleDef, cycleFills, cycleRouteSource } from './_cycleBands.mjs';
import { MODULES } from '../src/pages/cycles/modules.js';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const read = (p) => codeOnly(raw(p));
const route = cycleRouteSource();
const worker = raw('cloudflare-worker/src/routes/research.ts');
const progress = raw('cloudflare-worker/src/routes/progress.ts');

const DESKS = ['FounderValidatePage', 'FounderBuildDesk', 'FounderRaiseDesk', 'FounderGrowDesk'];

test('the four desks and their own stylesheets are gone, and nothing imports them', () => {
  for (const desk of DESKS) {
    assert.ok(!existsSync(`frontend/src/pages/founder/${desk}.jsx`), `${desk} is back`);
  }
  for (const css of ['founderValidate', 'founderValidateWorkspace', 'founderBuildDesk', 'founderRaiseDesk']) {
    assert.ok(!existsSync(`frontend/src/pages/founder/${css}.css`), `${css}.css is back with no page to style`);
  }
  // founderGrowDesk.css is not the desk's alone: the seven Grow zone pages
  // reuse its header, so it stays.
  assert.ok(existsSync('frontend/src/pages/founder/founderGrowDesk.css'));
  let hits = [];
  try {
    hits = execFileSync('grep', ['-rlE', `(${DESKS.join('|')})['"]`, 'frontend/src'], { encoding: 'utf8' })
      .split('\n').filter(Boolean);
  } catch (err) {
    if (err.status !== 1) throw err; // 1 is grep's "no match"
  }
  assert.deepEqual(hits, [], `a source file still imports a retired desk: ${hits.join(', ')}`);
});

test('a founder\'s bare /build/team is the Team workspace, and the Grow landing is /grow', () => {
  const app = read('frontend/src/App.jsx');
  const team = app.match(/<Route path="\/build\/team"[^\n]*/)?.[0] || '';
  assert.match(team, /guard\(\['admin', 'founder'\], founderWorkspace\('grow', <FounderWorkspaceTabs set="grow" user=\{user\}><FounderTeamPage \/><\/FounderWorkspaceTabs>\)\)/);
  assert.doesNotMatch(team, /founderGrowLanding/, 'the bare route branches on a landing it no longer has');
  assert.match(app, /<Route path="\/grow" element=\{founderGrowLanding\s*\? guard\(\[[^\]]*\], <CycleRoute cycle="grow" \/>\)/);
});

/** Each band, on the module whose read it explains. */
const BANDS = {
  validate: [],
  raise: [
    ['cap-table', 'raise/capital'], ['cap-table', 'raise/liquidity'],
    ['fundraising-readiness', 'raise/data-room'], ['fundraising-readiness', 'raise/legal'],
  ],
  grow: [['team-expansion', 'grow/talent'], ['distribution', 'grow/customers']],
  build: [
    ['product-roadmap', 'build/roadmap'],
    ['operating-systems', 'build/this-week'], ['operating-systems', 'build/retro'], ['operating-systems', 'build/kpi'],
  ],
};

test('every band a desk mounted is on the cycle module page whose read it explains', () => {
  for (const cycle of CYCLES) {
    assert.deepEqual(cycleBands(route, cycle), BANDS[cycle], `${cycle}'s bands moved or went missing`);
    const slugs = new Set(MODULES[cycle].map((m) => m.slug));
    for (const [slug] of BANDS[cycle]) assert.ok(slugs.has(slug), `${cycle}'s band sits on ${slug}, which is not a module`);
  }
  // Validate's two are fill bands, not drafts, on the same switch.
  assert.deepEqual(cycleFills(route, 'validate'), { 'problem-discovery': 'pain_tag', experiments: 'hypothesis' });
  // A cycle's rail draws the switch unconditionally (`fills` on its own line),
  // which is only true while every cycle has something for it to turn on (D17).
  assert.match(route, /<WorkerRail[^>]*?\n\s*fills\n/);
  for (const cycle of CYCLES) {
    assert.ok(cycleBands(route, cycle).length + Object.keys(cycleFills(route, cycle)).length > 0,
      `${cycle}'s rail draws a switch that turns nothing on`);
  }
});

test('a band is drawn only with the switch on and a venture chosen, and spends nothing to be looked at', () => {
  assert.match(route, /\{fillsOn && projectId \? drafts\.map\(\(draft\) => \(\s*<ZoneDraft key=\{`\$\{slug\}-\$\{draft\.surface\}`\} \{\.\.\.draft\} scopeKey=\{String\(projectId\)\} ai=\{ai\} accent="violet" \/>/,
    'a band is drawn without the switch, without a venture, or without its scope');
  // The cost read (D424) waits for the switch and for a band to show it on,
  // and every band, draft or fill, quotes its cost from it before its run.
  assert.match(route, /const ai = useAiSpend\(\{ enabled: Boolean\(fillsOn && projectId && \(drafts\.length \|\| fillKind\)\) \}\);/);
  assert.match(route, /<FillProposals key=\{`\$\{slug\}-\$\{fillKind\}`\} projectId=\{projectId\} kind=\{fillKind\} enabled=\{fillsOn\} ai=\{ai\}/,
    'a fill band has no cost before its run');
  for (const b of route.match(/<(ZoneDraft|FillProposals)\b[\s\S]*?\/>/g) || []) {
    assert.match(b, /\bai=\{ai\}/, `a band is mounted with no cost before its run:\n${b.slice(0, 120)}`);
  }
  // A slug never reaches an inherited key: the table is a Map.
  assert.match(route, /def\?\.drafts instanceof Map && Array\.isArray\(def\.drafts\.get\(slug\)\)/);
  // Every surface drawn is allow-listed, and every band says what it reads.
  for (const cycle of CYCLES) {
    for (const [, surface] of BANDS[cycle]) {
      assert.ok(worker.includes(`\n  '${surface}': {`), `${surface} has no DRAFT_SURFACES entry`);
    }
  }
  const drafts = CYCLES.map((cycle) => {
    const def = cycleDef(route, cycle);
    const at = def.indexOf('drafts: new Map([');
    return at < 0 ? '' : def.slice(at, def.indexOf('\n    ]),', at));
  }).join('\n');
  for (const field of ['label', 'run', 'accept', 'empty', 'nothingToDraft', 'foot']) {
    const n = (drafts.match(new RegExp(`\\b${field}: '`, 'g')) || []).length;
    assert.equal(n, 10, `${n} of the ten bands carry ${field}`);
  }
  // D424's voice rule, kept from the desks: Eadwyn's output is never advice.
  assert.doesNotMatch(drafts, /\b(advice|recommend\w*)\b/i, 'a band calls what Eadwyn produces advice');
});

test('every founder draft surface scopes to a project the caller owns', () => {
  // `/research/drafts` authorises on `requireAuth` alone and delegates scoping
  // to each surface, so a gather that forgets is a cross-account read.
  const table = worker.slice(worker.indexOf('const DRAFT_SURFACES'));
  for (const surface of Object.values(BANDS).flat().map(([, s]) => s)) {
    assert.ok(table.includes(`'${surface}': {`), `${surface} has no DRAFT_SURFACES entry`);
    const body = table.slice(table.indexOf(`'${surface}': {`));
    const gather = body.slice(body.indexOf('gather:'), body.indexOf('\n  },'));
    assert.match(gather, /const pid = await founderProject\(c, userId, scope\);/,
      `${surface} does not resolve its project through the ownership check`);
    assert.match(gather, /if \(pid == null\) return \[\];/,
      `${surface} continues after the ownership check fails`);
  }
  assert.match(worker, /JOIN users u ON u\.founder_id = p\.founder_id\n\s*WHERE u\.id = \? AND p\.deleted_at IS NULL/,
    'the founder project check no longer joins the caller to the project');
  assert.match(worker, /return ids\.length === 1 \? ids\[0\] : null;/,
    'a founder with two startups and no scope key must get nothing, not an arbitrary pick');
  // A scope key that was SENT must resolve or refuse: `scope_key: "null"` once
  // read as "none sent" and drafted over whichever single project was owned.
  assert.match(worker, /if \(scope !== ''\) \{\n\s*const asked = Number\(scope\);\n\s*return Number\.isInteger\(asked\) && ids\.includes\(asked\) \? asked : null;/,
    'an unparseable scope key falls through to the lone-project branch');

  // An applicant's EMAIL is not handed to a third-party model.
  const talentStart = table.indexOf("'grow/talent': {");
  const talent = table.slice(talentStart, table.indexOf('\n};', talentStart));
  assert.doesNotMatch(talent, /SELECT[^`]*\bemail\b/, 'an applicant email is being sent to the model');
  assert.match(talent, /APPLICANT'S EMAIL IS DELIBERATELY NOT HERE/);
  // The outreach sequence opens on the founder's own recorded pains, and names
  // only the stages a signup can be in.
  const customers = table.slice(table.indexOf("'grow/customers': {"), table.indexOf("'grow/talent': {"));
  assert.match(customers, /FROM pain_groups g WHERE g\.project_id = \?/);
  assert.match(customers, /NO PAIN IS RECORDED for this startup/);
  const rank = progress.match(/const CRM_STATUS_RANK: Record<string, number> = \{([^}]*)\}/)?.[1] || '';
  const stored = [...rank.matchAll(/(\w+): \d+/g)].map((m) => m[1]);
  assert.deepEqual(stored, ['new', 'invited', 'followed_up', 'promoted']);
  const named = customers.match(/Use only the (\w+) stages the record has — ([^.]+)\./)?.[2] || '';
  assert.deepEqual(named.split(',').map((s) => s.trim().replace(/^and /, '').replace(/ /g, '_')), stored,
    'the outreach instruction no longer names exactly the stages a signup can be in');
  assert.match(customers, /Do not place anyone at a demo, a trial or a paid plan: none of those is recorded\./);
  // The liquidity read hands the model a company with no preference terms, and
  // says so, or a model supplies a standard stack and calls it this founder's.
  const liquidity = table.slice(table.indexOf("'raise/liquidity': {"));
  assert.match(liquidity, /NO LIQUIDATION PREFERENCE, PARTICIPATION RIGHT OR EXIT MODEL IS RECORDED/);
});

test('the shared band honours the accent it is handed', () => {
  // The cycle pages mount it violet; 23 Partner mounts take the amber default.
  // Asserting `accent="violet"` on the mount alone would pass with the prop
  // dropped on the floor.
  const band = read('frontend/src/workspaces/ZoneDraft.jsx');
  assert.match(band, /const skin = ACCENTS\[accent\] \|\| ACCENTS\.amber;/,
    'the band no longer resolves its palette from the prop');
  assert.match(band, /accent = 'amber',/, 'amber must stay the default so no Partner mount changes');
  const table = band.match(/const ACCENTS = \{([\s\S]*?)\n\};/)?.[1] || '';
  for (const name of ['amber', 'violet']) {
    assert.ok(new RegExp(`\\b${name}: \\{`).test(table), `the ${name} palette is gone`);
  }
  for (const part of ['band', 'ink', 'edit', 'button']) {
    assert.ok(new RegExp(`skin\\.${part}\\b`).test(band), `the ${part} no longer follows the accent`);
  }
  assert.equal((band.match(/text-axal-amber-deep/g) || []).length, 1,
    'the amber ink colour is used outside its own palette entry');
});

test('the Worker fields the desks pinned stay, for the live pages that read them', () => {
  // Build: the cadence page and its one schedule phrase.
  assert.match(raw('cloudflare-worker/src/index.ts'), /app\.route\('\/api\/founder\/cadence', founderCadence\);/);
  assert.match(read('frontend/src/lib/cadence.js'), /export function scheduleLabel\(ritual\)/);
  assert.match(read('frontend/src/pages/founder/FounderBuildCadence.jsx'), /import \{[^}]*\bscheduleLabel\b[^}]*\} from '\.\.\/\.\.\/lib\/cadence';/,
    'the cadence page grew its own schedule phrase again');
  // Validate: the interview recording's provenance and the quotes' consent
  // (workspaces/founder/InterviewRecording.jsx, FounderValidateWorkspace.jsx).
  assert.match(progress, /NULL means never transcribed; an EMPTY STRING means transcribed/);
  for (const field of ['transcript', 'transcribed_by_model', 'recording_duration_sec']) {
    assert.ok(progress.includes(`${field}:`), `the interview listing stopped returning ${field}`);
  }
  assert.match(progress, /Consent is three-state on purpose: true, false, or never/);
  // Validate: the hypothesis board the fill band writes to, and the verdict reads.
  assert.match(raw('cloudflare-worker/src/routes/founder_validate.ts'), /founderValidate\.get\('\/board\/:projectId'/);
  assert.match(raw('cloudflare-worker/src/routes/_founder_validate_writes.ts'), /INSERT INTO hypotheses/);
  // Raise: the round funnel (RoundCallPage) and the waterfall
  // (FounderRaiseLiquidity, FounderRaiseCapital, CapTablePage).
  assert.match(raw('cloudflare-worker/src/services/roundMath.ts'), /committed = wired \+ signed/);
  assert.match(raw('cloudflare-worker/src/routes/contacts.ts'), /progress: computeRoundProgress\(allocations, round\?\.target_amount \?\? null\)/);
  const simulator = raw('cloudflare-worker/src/services/captable.ts');
  assert.match(simulator, /if \(exit != null && roundsOut\.length\) wf = waterfall\(roundsOut, Number\(exit\)\);/);
  assert.match(simulator, /preference_paid: bankersRound\(prefPaid, 2\)/);
  // Grow: the month's plan number (FounderGrowFocus, FounderBuildKpi).
  assert.match(progress, /progress\.get\('\/metrics\/:projectId\/targets'/);
});
