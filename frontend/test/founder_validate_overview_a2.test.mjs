/**
 * `/validate` — the A2 artboard, and three ops that had to be made real first.
 *
 * THE OVERVIEW IS A SUMMARY OF FOUR PAGES, and `Founder Workspaces Canvas`
 * artboard A2 says what each of its four cards carries. The links were fixed in
 * `founder_overview_subpage_links`; this file is about the cards themselves.
 *
 * WHAT THE ARTBOARD ASKED FOR THAT WAS NOT THERE:
 *
 *   the transcription mark   `Transcribed · Whisper · 44 min audio` above the
 *                            featured quote
 *   the `Quotes` column      the table's fourth column was `Evidence`, a count
 *                            of records rather than of quotes
 *   three ways in            `+ Record now`, `Upload audio`, `Type notes`
 *   the proposal band        `Proposal · Advisor`, drafting a claim the pain
 *                            map supports and no hypothesis covers
 *   two card subtitles       "each carries its evidence", "living verdict"
 *
 * AND ONE THING THE ARTBOARD ASKED FOR THAT THIS PRODUCT DOES DIFFERENTLY.
 * `+ Record now` and `Upload audio` read as two ways to START an interview.
 * Audio here ATTACHES to one: every row on the interviews page carries its own
 * recorder and uploader, and no path anywhere creates an interview from a clip.
 * Shipping three links that name three things and do the same nothing is the
 * exact defect this suite keeps catching, so the three carry `?new=`, the
 * interviews page acts on it, and the form says what happens next. That is
 * checked here, because a link that merely looks distinct is how the
 * negotiations chip row shipped inert.
 *
 * EVERY FIGURE IS STILL THE READER'S OWN. The artboard's `12 logged · 3 this
 * week`, its `44 min audio` and its `Whisper` are its fixture's; the page
 * derives all three from stored fields, and prints none of the fixture's.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const read = (p) => codeOnly(raw(p));

const CANVAS = raw('design/incoming/Founder Workspaces Canvas.dc.html');
const pageRaw = raw('frontend/src/pages/founder/FounderValidatePage.jsx');
const page = codeOnly(pageRaw);
const workspace = read('frontend/src/workspaces/founder/FounderValidateWorkspace.jsx');
const modal = read('frontend/src/components/discovery/LogInterviewModal.jsx');
const dto = raw('cloudflare-worker/src/routes/progress.ts');
const css = raw('frontend/src/pages/founder/founderValidate.css');

/** The A2 artboard, bounded by the two markers either side of it. */
const A2 = CANVAS.slice(
  CANVAS.indexOf('ARTBOARD 2 — VALIDATE'),
  CANVAS.indexOf('ARTBOARD 3'),
);
assert.ok(A2.includes('Prove someone wants this'), 'the A2 artboard could not be found in the canvas');

/** Prose flattened out of comment markers, line wraps and `\uXXXX` escapes. */
const flat = (s) => s
  .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/^\s*(?:--|\/\/|\*)/gm, '')
  .replace(/\s+/g, ' ');

test('the page is the artboard’s four cards, in its order', () => {
  const titles = [...A2.matchAll(/class="zt">([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(titles, ['Interview library', 'Pain map', 'Hypotheses', 'Validation summary']);
  const drawn = [...page.matchAll(/<SectionHead\b[^>]*?title="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(drawn, titles, 'the overview is no longer the artboard’s four cards in its order');
  // AND ITS HEADLINE AND ITS ONE-LINE ANSWER TO "why this page".
  assert.ok(page.includes('Prove someone wants this'));
  assert.ok(flat(A2).includes('Every interview, every pain, every hypothesis and the verdict they add up to'));
  assert.ok(flat(page).includes('Every interview, every pain, every hypothesis and the verdict they add up to'));
});

test('the artboard’s card subtitles are on the cards', () => {
  // The artboard's `zs` line is what each card is FOR, which the count cannot
  // say. Two of the four were missing and one described the plumbing.
  const subs = [...A2.matchAll(/class="zs">([^<]+)</g)].map((m) => m[1]);
  assert.ok(subs.some((s) => s.includes('edit any grouping')), 'the artboard’s pain-map subtitle changed');
  assert.ok(subs.some((s) => s.includes('each carries its evidence')), 'the artboard’s hypotheses subtitle changed');
  assert.ok(subs.some((s) => s.includes('Living verdict')), 'the artboard’s verdict subtitle changed');

  assert.match(page, /title="Pain map"[^/]*sub="Edit any grouping on the pain map"/);
  assert.match(page, /title="Hypotheses"[^/]*sub="Each carries its evidence"/);
  assert.match(page, /title="Validation summary" meta="Living verdict · rewrites as evidence lands"/);
  assert.ok(!/meta="Derived from stored records"/.test(page),
    'the verdict card went back to describing its plumbing rather than itself');
  assert.match(page, /function SectionHead\(\{ icon: Icon, title, meta, sub \}\)/,
    'the head stopped carrying the artboard’s second line');
});

test('the interview card counts what the artboard counts', () => {
  // `12 logged · 3 THIS WEEK`, not `· N featured`. A featured count says which
  // row this desk chose to quote; the artboard's second figure is about pace.
  assert.ok(flat(A2).includes('12 logged · 3 this week'), 'the artboard’s interview meta changed');
  assert.match(page, /\$\{interviews\.length\} logged · \$\{loggedThisWeek\(interviews\)\} this week/);
  assert.ok(!/interviews\.filter\(\(item\) => item\.featured\)\.length\} featured/.test(page),
    'the meta went back to counting featured rows');
  const week = page.slice(page.indexOf('function loggedThisWeek'));
  assert.match(week, /7 \* 86400000/, 'the week stopped being seven days');
  assert.match(week, /interview_date \|\| r\.created_at/,
    'a row with no interview date must fall back to when it was logged, not drop out');
});

test('the transcription mark is provenance, and is absent where there is none', () => {
  assert.ok(flat(A2).includes('Transcribed · Whisper'), 'the artboard’s transcription mark is gone');
  assert.ok(/44 min audio/.test(A2), 'the artboard stopped naming the clip length');

  // DRAWN ONLY WHERE THE RECORD CARRIES IT. An interview somebody typed up by
  // hand gets no mark rather than one claiming a model read it.
  assert.match(page, /featured\.transcript != null && <div className="source-transcribed"/,
    'the mark is drawn without checking that a transcript exists');
  assert.match(page, /featured\.transcribed_by_model \? ` · \$\{featured\.transcribed_by_model\}` : ''/,
    'the model name is being invented rather than read');
  assert.ok(!/Whisper/.test(page), 'the page hardcodes the canvas’s own model name');
  // PINNED AT THE GUARD, not at the call. The length appears twice — once in
  // the condition and once in the output — so matching the call alone passes
  // while the site that renders it is gone.
  assert.match(page, /clipLength\(featured\.recording_duration_sec\) \? <span className="num">\{clipLength\(featured\.recording_duration_sec\)\}<\/span> : null/,
    'the clip length is no longer drawn, or is drawn without checking it resolves');

  // NULL AND EMPTY STRING ARE DIFFERENT, which is why the check is `!= null`:
  // an empty transcript means transcribed and silent, and the worker's DTO is
  // explicit about that.
  assert.match(dto, /NULL means never transcribed; an EMPTY STRING means transcribed/,
    'the field this mark reads changed meaning');
  for (const field of ['transcript', 'transcribed_by_model', 'recording_duration_sec']) {
    assert.ok(dto.includes(`${field}:`), `the listing stopped returning ${field}`);
  }
  // MATCHED WITH THE OPENING BRACE. `includes('.source-transcribed')` also
  // matches `.source-transcribed-x`, so renaming the selector — which is
  // exactly how a style goes missing — passed a prefix check.
  // AND THE LIGHT RULE IS PINNED SO THE DARK ONE CANNOT SATISFY IT.
  // `.dark .source-transcribed{` CONTAINS `.source-transcribed{`, so renaming
  // only the light selector passed — which is the half a reader in the default
  // theme actually sees.
  assert.match(css, /(^|\})\.source-transcribed\{/, 'the mark has no light-mode style');
  assert.match(css, /\.dark \.source-transcribed\{/, 'the mark has no dark-mode style');
  assert.match(css, /(^|\})\.evidence-ops\{/, 'the three ways in have no light-mode style');
  assert.match(css, /\.dark \.evidence-ops a\{/, 'the three ways in have no dark-mode style');
});

test('the Quotes column is quotes, and says which cannot be quoted', () => {
  const head = [...A2.matchAll(/class="th">([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(head, ['Person', 'Role', 'Date', 'Quotes']);
  assert.match(page, /<span>Person<\/span><span>Role<\/span><span>Date<\/span><span>Quotes<\/span>/,
    'the table’s fourth column drifted from the artboard');
  assert.ok(!/<span>Evidence<\/span>/.test(page), 'the column went back to counting records');

  // CONSENT, NOT A FLAG. The V1 subpage artboard is explicit: deck-eligibility
  // "is not a flag someone sets — it derives from consent". So a row with
  // quotes and no consent says its quotes cannot leave the page.
  assert.match(page, /const quotable = \(row\) => row\?\.quote_consent === true;/,
    'quotability stopped deriving from consent');
  assert.match(page, /quoteCount\(item\) > 0 && !quotable\(item\)/,
    'a row whose quotes cannot be used no longer says so');
  // THREE-STATE, so never-asked does not read as declined.
  assert.match(page, /item\.quote_consent === false \? 'Consent was declined/,
    'a row nobody has asked reads as having refused');
  assert.match(dto, /Consent is three-state on purpose: true, false, or never/,
    'the field this reads changed shape');
});

test('the three ways in are three different things, and the page acts on each', () => {
  for (const op of ['+ Record now', 'Upload audio', 'Type notes']) {
    assert.ok(A2.includes(op), `the artboard stopped offering ${op}`);
    assert.ok(page.includes(op), `the overview stopped offering ${op}`);
  }
  const ops = page.slice(page.indexOf('data-testid="ops-interviews"'), page.indexOf('link-manage-interviews'));
  for (const mode of ['record', 'upload', 'notes']) {
    assert.ok(ops.includes(`new=${mode}`), `the ${mode} op carries no intent, so all three do the same thing`);
  }

  // AND THE INTERVIEWS PAGE READS IT. Three links that name three things and
  // navigate identically is the defect, not the fix.
  assert.match(workspace, /const newParam = searchParams\.get\('new'\);/,
    'the interviews page ignores the intent the ops send');
  assert.match(workspace, /\['notes', 'record', 'upload'\]\.includes\(newParam\)/,
    'the intent is not validated against the three the artboard names');
  assert.match(workspace, /setLogOpen\(true\);/);
  assert.match(workspace, /next\.delete\('new'\);/,
    'the parameter is not consumed, so the form reopens on a back-navigation');

  // THE FORM SAYS WHAT HAPPENS NEXT for the two that are not a form.
  assert.match(modal, /const INTENT_NOTE = \{/, 'the form does not explain the record/upload sequence');
  for (const mode of ['record', 'upload']) {
    assert.ok(new RegExp(`  ${mode}: 'Save the interview first`).test(modal),
      `the ${mode} intent has no note, so a founder is left hunting for a control`);
  }
  assert.ok(!/  notes: 'Save the interview first/.test(modal),
    'typing notes IS this form, so it needs no sequence note');
  assert.match(modal, /!editing && INTENT_NOTE\[intent\]/,
    'the note shows while EDITING an interview, where the sequence does not apply');
});

test('the hypotheses card carries the artboard’s proposal band, and one drafter', () => {
  assert.ok(A2.includes('Proposal · Advisor'), 'the artboard’s proposal band is gone');
  assert.match(page, /<ValidateProposals key="overview-hypotheses" projectId=\{projectId\} kind="hypothesis"/,
    'the overview does not mount the artboard’s proposal band');

  // THE SAME COMPONENT THE HYPOTHESES PAGE MOUNTS, with the same kind: one
  // drafter, so accepting here and accepting there are the same write and the
  // copy about what accepting means cannot drift between two surfaces.
  assert.match(workspace, /kind="hypothesis"/, 'the hypotheses page stopped mounting the drafter');
  assert.match(page, /import ValidateProposals from '\.\.\/\.\.\/workspaces\/founder\/ValidateProposals'/,
    'the overview grew its own copy of the drafter');

  // AND IT IS OFF UNTIL A FOUNDER TURNS IT ON. Every run spends their budget.
  assert.match(page, /const \[fillsOn\] = useAssistMode\('Validate'\);/,
    'the band no longer reads the per-workspace mode');
  assert.match(page, /enabled=\{fillsOn\}/, 'the band runs regardless of the mode');
  assert.match(read('frontend/src/hooks/useAssistMode.js'), /safeReadJSON\(key, false\)/,
    'the mode stopped defaulting to off');
});

test('the page keeps the artboard’s argument and none of its sample records', () => {
  // The verdict card's provenance line is the artboard's `Provenance` shield.
  assert.ok(A2.includes('Provenance'), 'the artboard’s provenance shield is gone');
  assert.ok(/Provenance/.test(page), 'the verdict card stopped showing where its clauses come from');
  // THE FIXTURE'S PEOPLE, COMPANIES AND FIGURES STAY IN THE FIXTURE.
  for (const sample of ['Priya Menon', 'Verwood', 'Handoff opacity', 'Tool sprawl', '44 min', '$0.0220']) {
    assert.ok(CANVAS.includes(sample), `the canvas no longer carries ${sample}`);
    assert.ok(!page.includes(sample), `the page prints the canvas’s own ${sample} as this founder’s`);
  }
});
