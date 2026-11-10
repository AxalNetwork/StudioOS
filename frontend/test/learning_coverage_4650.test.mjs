/**
 * #4650 part 4 (D4650) — the studio's curriculum coverage record.
 *
 *   1. `coverageRows` keeps the journey's name apart from its state, names why a
 *      course is not reachable, and reads a count the route did not send as
 *      not recorded (null), never 0; a state it does not know reads unknown;
 *   2. `coverageNotes` says what the record could not see;
 *   3. the view draws loading, Unreadable (never an empty table), the empty
 *      catalogue, and the table with each journey's state and courses.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/learning_coverage_4650.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { CoverageView } from '../src/pages/learning/CurriculumCoverage.jsx';
import { coverageNotes, coverageRows } from '../src/pages/learning/coverageModel.js';

const course = (uid, extra = {}) => ({ uid, slug: uid, title: `Course ${uid}`, status: 'published', visibility: 'open', stage: null, ...extra });
const COVERAGE = {
  courses: 4,
  audience_recorded: true,
  truncated: false,
  audience_not_recorded: [course('u1', { status: 'draft' })],
  journeys: [
    { journey: 'founder', state: 'published', published: [course('f1', { stage: 'Pre-seed' }), course('f2')], inaccessible: [], unknown: 1, stages: ['Pre-seed'], stage_not_recorded: 1 },
    { journey: 'investor', state: 'inaccessible', published: [], inaccessible: [course('i1', { status: 'draft', reason: 'draft' }), course('i2', { visibility: 'program', reason: 'program_only' })], unknown: 1, stages: [], stage_not_recorded: 0 },
    { journey: 'advisor', state: 'unknown', published: [], inaccessible: [], unknown: 1, stages: [], stage_not_recorded: 0 },
    { journey: 'partner', state: 'missing', published: [], inaccessible: [], stages: [], stage_not_recorded: 0 },
  ],
};

test('1. coverageRows: journey and state apart, reasons named, an absent count not recorded', () => {
  // Mutation checked: spreading the state over the row → `label` reads "Published"; `count` returning 0 for
  // undefined → partner's unknown is 0; the unknown-state fallback removed → the odd state reads undefined.
  const rows = coverageRows(COVERAGE);
  assert.deepEqual(rows.map((r) => [r.label, r.stateLabel]), [['Founders', 'Published'], ['Investors', 'Not reachable'], ['Advisors', 'Unknown'], ['Partners', 'Missing']]);
  assert.deepEqual(rows[1].inaccessible.map((c) => c.why), ['draft', 'program members only']);
  assert.equal(rows[2].unknown, 1);
  assert.equal(rows[3].unknown, null, 'a count the route did not send is not recorded, not zero');
  assert.equal(rows[0].stageNotRecorded, 1);
  const odd = coverageRows({ journeys: [{ journey: 'founder', state: 'something-new' }] });
  assert.equal(odd[0].state, 'unknown', 'a state this page does not know never reads missing');
  assert.deepEqual(coverageRows(undefined), []);
});

test('2. coverageNotes says what the record could not see', () => {
  // Mutation checked: the audience_recorded note dropped → the first note is missing; truncated ignored → length 2.
  assert.deepEqual(coverageNotes(COVERAGE), ['1 course records no audience. Name who each is for in its "About this course" to settle the unknowns.']);
  const blind = coverageNotes({ ...COVERAGE, audience_recorded: false, truncated: true, audience_not_recorded: [] });
  assert.equal(blind.length, 2);
  assert.match(blind[0], /does not record audiences yet/);
  assert.match(blind[1], /no journey is called missing/);
});

const view = (state) => renderToStaticMarkup(h(MemoryRouter, null, h(CoverageView, { state, onRetry: () => {} })));

test('3. the view: loading, Unreadable, empty, and the table', () => {
  // Mutation checked: the unreadable branch drawing the table → no alert and no claim; the empty branch removed →
  // the table draws; the Not reachable column without `why` → "(draft)" is gone; the course link without its uid → href differs.
  assert.match(view({ status: 'loading' }), /data-testid="learning-loading"/);
  const unreadable = view({ status: 'unreadable', message: 'The course catalogue could not be read.' });
  assert.match(unreadable, /role="alert"/);
  assert.match(unreadable, /not a claim that any journey has no material/);
  assert.doesNotMatch(unreadable, /coverage-table/);
  const empty = view({ status: 'ready', coverage: { ...COVERAGE, courses: 0, journeys: [] } });
  assert.match(empty, /No courses yet/);
  assert.doesNotMatch(empty, /coverage-table/);
  const ready = view({ status: 'ready', coverage: COVERAGE });
  assert.match(ready, /4 courses in the catalogue/);
  assert.match(ready, /data-testid="coverage-row-founder"/);
  assert.match(ready, /href="\/learning\/studio\?course=f1"/);
  assert.match(ready, /Course i1<\/a><span[^>]*> \(draft\)<\/span>/);
  assert.match(ready, /Course i2<\/a><span[^>]*> \(program members only\)<\/span>/);
  assert.match(ready, /data-testid="coverage-stage-founder"[^>]*>1 without a stage recorded/);
  assert.match(ready, /data-testid="coverage-unknown-advisor"[^>]*>1 course</);
  assert.match(ready, /data-testid="coverage-unknown-partner"[^>]*><span[^>]*>Not recorded<\/span>/);
  const pills = [['founder', 'Published'], ['investor', 'Not reachable'], ['advisor', 'Unknown'], ['partner', 'Missing']];
  for (const [journey, label] of pills) {
    const row = ready.slice(ready.indexOf(`coverage-row-${journey}`)).split('</tr>')[0];
    assert.match(row, new RegExp(`<td[^>]*><span[^>]*>${label}</span>`), `${journey} reads ${label}`);
  }
});
