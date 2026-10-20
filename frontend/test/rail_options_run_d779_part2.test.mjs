/**
 * D779 (#2104), part 2 — the advisor's options, and the operating partner's
 * options that run on the same components, fill, draft and place through the
 * run path, and nothing is written without the member's press, Accept or Save.
 *
 * The part is every row of `lib/railOptions/advisor.js` (14) and the nine rows
 * of `lib/railOptions/partner.js` that are the advisor's own components (the
 * Studio interview and Research): 23 options, at most 30 per part. The
 * partner's 19 other rows are the operating partner's own boards: part 3.
 *
 *   draft       A zone draft band drafts on the press, from a stubbed run; the
 *               draft is all that is written and Accept is the only further
 *               write (D770). Earnings' narrative is a draft the page holds:
 *               the run writes nothing, and Accept files it with who wrote it.
 *   form        The interview's tool pick, its explanation and Research's Ask
 *               fill the open thread or panel. The Worker keeps the turn as
 *               conversation history and writes no record. The competitor
 *               analysis writes only its own analysis, on the member's press.
 *   transcribe  The voice answer fills the composer; the member sends it.
 *   upload      The member's own document is added and indexed; nothing is placed.
 *
 * Runs are stubbed at `api.research`; nothing reaches the Worker. The Worker's
 * half (what each route writes) is read from its source.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/rail_options_run_d779_part2.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { codeOnly } from './_codeOnly.mjs';
import { ADVISOR_RAIL_OPTIONS } from '../src/lib/railOptions/advisor.js';
import { PARTNER_RAIL_OPTIONS } from '../src/lib/railOptions/partner.js';
import { periodNoteSource } from '../src/pages/advisor/practice/EarningsZone.jsx';
import { assertDraftBandRun } from './_zone_draft_run.mjs';

const read = (f) => readFileSync(f, 'utf8');
const spa = (f) => codeOnly(read(`frontend/src/${f}`));
const workerFile = (f) => codeOnly(read(`cloudflare-worker/src/${f}`));

/** One Worker handler's body, from its registration to the next one on the same router. */
function route(src, router, method, path) {
  const at = src.indexOf(`${router}.${method}('${path}'`);
  assert.ok(at >= 0, `${router}.${method}('${path}') is gone`);
  const ends = ['get', 'post', 'patch', 'put', 'delete']
    .map((m) => src.indexOf(`\n${router}.${m}(`, at + 1)).filter((i) => i >= 0);
  return src.slice(at, ends.length ? Math.min(...ends) : undefined);
}

/** Every table a body writes. */
const writes = (body) => [...new Set([...body.matchAll(/(?:INSERT INTO|UPDATE|DELETE FROM)\s+([a-z_]+)/g)].map((m) => m[1]))].sort();

// The partner's rows that are the advisor's own components; the rest are part 3.
const SHARED = new Set([
  'answer:interview', 'explain:question', 'transcribe:voice-answer',
  'ask:library', 'draft:session-brief', 'draft:checkpoint-brief',
  'upload:document', 'reindex:document', 'draft:index-gaps',
]);
const ROWS = [
  ...ADVISOR_RAIL_OPTIONS.map((o) => ({ ...o, role: 'advisor', who: 'Advisor' })),
  ...PARTNER_RAIL_OPTIONS.filter((o) => SHARED.has(o.key)).map((o) => ({ ...o, role: 'partner', who: 'Partner' })),
];

// The part's rows, by key, so a row added to either inventory is a decision for a later part.
const PART_2 = [
  'Advisor · Home|answer:interview',
  'Advisor · Home|explain:question',
  'Advisor · Home|transcribe:voice-answer',
  'Advisor · Opportunities|draft:terms',
  'Advisor · Earnings|draft:period-narrative',
  'Advisor · Ask|ask:library',
  'Advisor · Ask|draft:session-brief',
  'Advisor · Client prep|draft:checkpoint-brief',
  'Advisor · Companies|analyze:competitors',
  'Advisor · Companies|rerun:analysis',
  'Advisor · Companies|refresh:sources',
  'Advisor · Library|upload:document',
  'Advisor · Library|reindex:document',
  'Advisor · Library|draft:index-gaps',
  'Partner · Home|answer:interview',
  'Partner · Home|explain:question',
  'Partner · Home|transcribe:voice-answer',
  'Partner · Ask|ask:library',
  'Partner · Ask|draft:session-brief',
  'Partner · Client prep|draft:checkpoint-brief',
  'Partner · Library|upload:document',
  'Partner · Library|reindex:document',
  'Partner · Library|draft:index-gaps',
];

test('part 2 is the advisor’s 14 options and the partner’s 9 on the same components, at most 30', () => {
  assert.ok(PART_2.length <= 30);
  assert.deepEqual(ROWS.map((o) => `${o.who} · ${o.page}|${o.key}`), PART_2);
  for (const o of ROWS) {
    assert.ok(['draft', 'form', 'upload', 'transcribe'].includes(o.handler), `${o.key}: no rule for handler ${o.handler}`);
  }
  // A shared row is the advisor's row: the same component, so the same rule holds.
  for (const o of ROWS.filter((r) => r.role === 'partner')) {
    const twin = ADVISOR_RAIL_OPTIONS.find((a) => a.key === o.key);
    assert.ok(twin, `${o.key}: the advisor has no such option`);
    assert.deepEqual([o.handler, o.source.file, o.source.marker], [twin.handler, twin.source.file, twin.source.marker], `${o.key}: not the advisor's component`);
  }
  // What part 3 takes: the partner's own boards, every one a zone draft band.
  const rest = PARTNER_RAIL_OPTIONS.filter((o) => !SHARED.has(o.key));
  assert.equal(rest.length, 19);
  assert.ok(rest.every((o) => o.handler === 'draft' && /^surface="/.test(o.source.marker)));
});

// ------------------------------------------------------------------ drafts

const research = workerFile('routes/research.ts');
const surfaces = research.slice(research.indexOf('const DRAFT_SURFACES'), research.indexOf('\n};', research.indexOf('const DRAFT_SURFACES')));
const BANDS = ROWS.filter((o) => o.handler === 'draft' && /^surface="/.test(o.source.marker))
  .map((o) => ({ ...o, surface: /^surface="([^"]+)"$/.exec(o.source.marker)[1] }));

test('each band option is a zone draft whose run and Accept write only the draft', () => {
  assert.deepEqual(BANDS.map((o) => `${o.role}|${o.key}`), [
    'advisor|draft:terms', 'advisor|draft:session-brief', 'advisor|draft:checkpoint-brief', 'advisor|draft:index-gaps',
    'partner|draft:session-brief', 'partner|draft:checkpoint-brief', 'partner|draft:index-gaps',
  ]);
  assert.deepEqual(writes(route(research, 'research', 'post', '/drafts')), ['research_zone_drafts']);
  assert.deepEqual(writes(route(research, 'research', 'patch', '/drafts/:uid')), ['research_zone_drafts']);
  for (const o of BANDS) {
    assert.ok(spa(o.source.file).includes(o.source.marker), `${o.key}: ${o.source.file} draws no ${o.surface} band`);
    const at = surfaces.indexOf(`'${o.surface}': {`);
    assert.ok(at >= 0, `${o.key}: the Worker drafts no surface ${o.surface}`);
    const entry = surfaces.slice(at, surfaces.indexOf("\n  '", at + 1));
    assert.doesNotMatch(entry, /\n\s+accept:/, `${o.key}: ${o.surface}'s Accept writes a record`);
  }
});

for (const o of BANDS) {
  test(`${o.role} ${o.key} (${o.page}) drafts from a stubbed run, and only Accept writes again`, () =>
    assertDraftBandRun({ surface: o.surface, label: o.label, key: o.key, role: o.role }));
}

test('Earnings’ narrative is held on the page until Accept, which files it with who wrote it', () => {
  const [row] = ROWS.filter((o) => o.key === 'draft:period-narrative');
  assert.equal(row.source.file, 'pages/advisor/practice/EarningsZone.jsx');
  const zone = spa(row.source.file);
  // The press runs the read-back and keeps its text on the page; it saves nothing.
  const narrate = zone.slice(zone.indexOf('const narrate = useCallback'), zone.indexOf('const accept = useCallback'));
  assert.match(narrate, /await api\.aiWorkspaceExplain\(\{ workspace: 'Practice', zone: 'Earnings', coverage \}\)/);
  assert.match(narrate, /setDraft\(text\); setModelText\(text\); setEditing\(true\);/);
  assert.doesNotMatch(narrate, /saveMyAdvisorPeriodNote|request\(/, 'the draft is filed before Accept');
  // Accept is the only write, and it says who wrote what is filed.
  const accept = zone.slice(zone.indexOf('const accept = useCallback'), zone.indexOf('const discard = useCallback'));
  assert.match(accept, /api\.saveMyAdvisorPeriodNote\(window_\.key, \{\s*body: draft,\s*source: periodNoteSource\(draft, modelText, note\?\.source\),/);
  assert.equal(zone.split('api.saveMyAdvisorPeriodNote(').length - 1, 1);
  // The Worker's read-back writes nothing for a page's coverage lines: its one
  // write is the audit of a named branch, which Earnings never sends.
  const explain = route(workerFile('routes/ai.ts'), 'ai', 'post', '/workspace/explain');
  assert.deepEqual(writes(explain), ['admin_audit_log']);
  assert.match(explain, /rail: railFor\(c, \{ page: workspace, option: 'explain:zone' \}\)/);
  assert.doesNotMatch(narrate, /branch/);
});

test('a period note says the model wrote it only when it is the model’s text unchanged', () => {
  // Accepted as drafted.
  assert.equal(periodNoteSource('Gross up 10%.', 'Gross up 10%.', undefined), 'ai');
  // A draft the advisor changed before Accept.
  assert.equal(periodNoteSource('Gross up 12%.', 'Gross up 10%.', undefined), 'edited');
  // Written by hand, with no draft.
  assert.equal(periodNoteSource('My own read.', null, undefined), 'advisor');
  // A filed 'ai' note re-filed: unchanged stays 'ai', changed becomes 'edited'.
  assert.equal(periodNoteSource('Gross up 10%.', 'Gross up 10%.', 'ai'), 'ai');
  assert.equal(periodNoteSource('Gross up 11%.', null, 'ai'), 'edited');
  // An edited note stays edited; a hand-written one stays the advisor's.
  assert.equal(periodNoteSource('Still mine.', null, 'edited'), 'edited');
  assert.equal(periodNoteSource('Still mine.', null, 'advisor'), 'advisor');
  // A filed 'ai' note is the model's text when the page loads it.
  const zone = spa('pages/advisor/practice/EarningsZone.jsx');
  assert.match(zone, /setModelText\(n\?\.note\?\.source === 'ai' \? n\.note\.body : null\);/);
});

// ------------------------------------------------------------------ the interview

const advisor = workerFile('routes/advisor.ts');
// Conversation history: the turn, its audit, the conversation it belongs to, the activity log.
const HISTORY = ['activity_logs', 'advisor_conversations', 'advisor_messages', 'advisor_turn_audit'];
/** The tables a handler writes, through its own SQL or the history helpers it calls. */
const handlerWrites = (body) => {
  const t = new Set(writes(body));
  if (/\brecordMessage\(/.test(body)) t.add('advisor_messages');
  if (/\bwriteTurnAudit\(/.test(body)) t.add('advisor_turn_audit');
  if (/\bcreateConversation\(/.test(body)) t.add('advisor_conversations');
  return [...t].sort();
};

test('the interview’s Answer picks a tool on the press and writes only the conversation’s history', () => {
  const rows = ROWS.filter((o) => o.key === 'answer:interview');
  assert.equal(rows.length, 2);
  const pa = spa('components/advisor/PersonalAdvisor.jsx');
  for (const o of rows) assert.equal(o.source.marker, 'api.advisor.toolAuto(');
  assert.equal(pa.split('api.advisor.toolAuto(').length - 1, 1);
  // The pick's result is a message in the thread with its buttons; the member presses one.
  assert.match(pa, /const r = await api\.advisor\.toolAuto\(raw\);\s*setMessages\(\(m\) => \[\.\.\.m, \{\s*role: 'tool',/);
  const body = route(advisor, 'advisor', 'post', '/tool/auto');
  for (const t of handlerWrites(body)) assert.ok(HISTORY.includes(t), `/tool/auto writes ${t}`);
  assert.doesNotMatch(body, /recordAnswer\(|writeRouter|routeWrite\(/, '/tool/auto records an answer');
  assert.match(body, /rail: railFor\(c, \{ page: pageFromPath\(AI_SURFACE\.studio, 'studio'\), option: 'tool:advisor' \}\)/);
  // The tools it runs read and return a call to action; none of them writes.
  const tools = workerFile('services/advisor/tools.ts');
  assert.deepEqual(writes(tools), []);
  assert.doesNotMatch(tools, /\.run\(\)|getSQL\(/);
});

test('the interview’s Explain streams into the tutor panel and writes only the conversation’s history', () => {
  const pa = spa('components/advisor/PersonalAdvisor.jsx');
  for (const o of ROWS.filter((r) => r.key === 'explain:question')) assert.ok(pa.includes(o.source.marker));
  assert.match(pa, /const openTutor = useCallback\(async \(topic\) => \{[\s\S]*?fetch\(api\.advisor\.explainUrl\(\)/);
  assert.match(pa, /setTutor\(\(t\) => \(t \? \{ \.\.\.t, text: assembled \} : t\)\)/);
  const body = route(advisor, 'advisor', 'post', '/explain');
  for (const t of handlerWrites(body)) assert.ok(HISTORY.includes(t), `/explain writes ${t}`);
  assert.doesNotMatch(body, /recordAnswer\(|writeRouter|routeWrite\(/);
  assert.match(body, /option: 'explain:advisor'/);
});

test('the voice answer fills the composer; the member sends it, and transcribing writes nothing', () => {
  const pa = spa('components/advisor/PersonalAdvisor.jsx');
  for (const o of ROWS.filter((r) => r.key === 'transcribe:voice-answer')) assert.equal(o.source.marker, 'api.advisor.transcribe(');
  assert.match(pa, /const res = await api\.advisor\.transcribe\(b64, mime\);\s*const text = String\(res\?\.text \|\| ''\)\.trim\(\);\s*if \(text\) onTextRef\.current\?\.\(text\);/);
  const body = route(advisor, 'advisor', 'post', '/transcribe');
  assert.deepEqual(handlerWrites(body), []);
  assert.match(body, /option: 'transcribe:voice'/);
});

// ------------------------------------------------------------------ Research's forms

test('Ask answers on the press, and its answer is stored unsaved until Save', () => {
  for (const o of ROWS.filter((r) => r.key === 'ask:library')) assert.equal(o.source.marker, 'api.research.ask(');
  const ask = spa('pages/research/AskZone.jsx');
  assert.match(ask, /const r = await api\.research\.ask\(q, sessionUid\);/);
  assert.match(ask, /onClick=\{\(\) => toggleSaved\(t\)\}/, 'Save is not a press');
  assert.match(read('cloudflare-worker/sql/migrations/221_research_ask_sessions.sql'), /saved\s+INTEGER NOT NULL DEFAULT 0/);
  assert.match(route(research, 'research', 'patch', '/ask/answers/:uid'), /UPDATE research_ask_answers SET saved = \?/);
  assert.match(route(research, 'research', 'post', '/ask'), /rail: railFor\(c, \{ page: 'research', option: 'ask:library' \}\)/);
});

test('the competitor analysis runs on the press and writes only its own analysis', () => {
  const rows = ROWS.filter((o) => o.source.file === 'components/CompetitorAnalysis.jsx');
  assert.deepEqual(rows.map((o) => o.key), ['analyze:competitors', 'rerun:analysis', 'refresh:sources']);
  const ui = spa('components/CompetitorAnalysis.jsx');
  for (const o of rows) assert.equal(ui.split(o.source.marker).length - 1, 1, `${o.key}: not one press`);
  // Re-run keeps the member's hand-added competitors.
  assert.match(ui, /api\.competitors\.rerun\(analysis\.id, \{ inputs: analysis\.inputs \|\| inputs, keep_manual: true \}\)/);
  const src = workerFile('routes/competitors.ts');
  const OWN = ['competitor_analyses', 'competitor_analysis_outputs', 'competitor_candidates', 'competitor_signals', 'competitor_sources'];
  for (const [method, path] of [['post', '/analyze'], ['post', '/:id/rerun'], ['post', '/:id/refresh']]) {
    const body = route(src, 'competitors', method, path);
    for (const t of writes(body)) assert.ok(OWN.includes(t), `${path} writes ${t}`);
    assert.match(body, /await persistResult\(c\.env, id, result\);/);
  }
  // persistResult writes the analysis's own rows, every one keyed by the analysis.
  const persist = src.slice(src.indexOf('export async function persistResult'), src.indexOf('async function loadAnalysis'));
  for (const t of writes(persist)) assert.ok(OWN.includes(t), `persistResult writes ${t}`);
  assert.doesNotMatch(persist, /ai_rail_proposals|validate_proposals|fill_provenance|INSERT INTO projects|UPDATE projects/);
  // And the synthesis runs on the page's rail (D765).
  assert.match(workerFile('services/competitorAnalysis.ts'), /rail: \{ page: 'research', option: 'scan:competitors' \}/);
});

// ------------------------------------------------------------------ uploads

test('the library’s upload and re-index add the member’s own document and place nothing', () => {
  const library = spa('pages/research/LibraryZone.jsx');
  for (const o of ROWS.filter((r) => ['upload:document', 'reindex:document'].includes(r.key))) {
    assert.ok(library.includes(o.source.marker), `${o.key}: ${o.source.marker} is gone`);
  }
  for (const [method, path] of [['post', '/documents'], ['post', '/documents/:uid/reindex']]) {
    const body = route(research, 'research', method, path);
    assert.deepEqual(writes(body), ['research_documents'], `${path} writes beyond the library`);
    assert.match(body, /Jobs\.enqueue\(c\.env, 'embed_entity', \{ type: 'research_doc', id/);
    assert.doesNotMatch(body, /ai_rail_proposals|validate_proposals|fill_provenance/);
  }
});
