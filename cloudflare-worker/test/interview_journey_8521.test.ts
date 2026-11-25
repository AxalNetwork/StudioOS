/**
 * D8521 (#8521) — one customer interview, from the invitation to what the
 * founder reads: invited → consent → the questions → the answers → the summary.
 *
 * The journey runs through the real routes and the real job on the whole
 * production schema (`_interview_journey_8521.mjs`), with the model stubbed:
 * no speech-to-text, no summary, no structuring run anywhere but in a recording
 * stand-in, no mail, no network. The stub says what the "interviewee" said and
 * what a model might claim; every assertion is on a record the product wrote
 * or a field the founder's read returns, never on wording the model chose.
 *
 *   1. a complete interview reaches a summary that quotes only what was said;
 *   2. an interviewee who declines consent leaves no answers and no summary
 *      (and one who withdraws afterwards leaves no summary);
 *   3. an interview abandoned half way carries its marker and is not complete;
 *   4. an answer with an email address or a phone number: TODAY the product
 *      does not redact it, and the founder's summary carries it verbatim. The
 *      test pins that, so a later redaction is a deliberate change (D8521).
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/interview_journey_8521.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTACT_EMAIL, CONTACT_PHONE, FOUNDER, INTERVIEWEES, OUTSIDER, QUESTIONS,
  call, openSession, putChunk, scriptedSummary, world,
} from './_interview_journey_8521.mjs';
import { runInterviewProcessJob, NO_CONSENT_SENTENCE } from '../src/services/interviewProcessing.ts';
import { missingLine, sweepInterviewSessions, SILENT_MINUTES, UPLOAD_MINUTES } from '../src/services/sessionSweeper.ts';

const VERBAL = { status: 'given', method: 'verbal' } as const;
const INVENTED_QUOTE = 'We will switch vendors next quarter.';
const INVENTED_CLAIM = 'They are about to churn.';

type W = ReturnType<typeof world>;
const one = (w: W, sql: string, ...args: unknown[]) => w.db.prepare(sql).get(...args) as any;
const all = (w: W, sql: string, ...args: unknown[]) => w.db.prepare(sql).all(...args).map((r: any) => ({ ...r })) as any[];
const interviewStage = (w: W, id: number) => one(w, 'SELECT stage FROM discovery_interviews WHERE id = ?', id).stage;
const sessionRow = (w: W, sid: number) => one(w, 'SELECT * FROM interview_sessions WHERE id = ?', sid);
const finalTexts = (w: W, sid: number) =>
  all(w, "SELECT text FROM interview_transcript_segments WHERE session_id = ? AND source = 'final' ORDER BY COALESCE(start_ms, 0), id", sid).map((r) => r.text);
const read = (w: W, sid: number) => call(w.env, FOUNDER, 'GET', `/sessions/${sid}`);
const hasAnswers = (w: W, sid: number) => one(w, 'SELECT COUNT(*) AS n FROM interview_transcript_segments WHERE session_id = ?', sid).n;

/** Invitation → consent → questions: the session, open, with the study's three questions on it. */
async function open(w: W, person: typeof INTERVIEWEES.rowan, consent: unknown = VERBAL) {
  assert.equal(interviewStage(w, person.id), 'invited', 'the interviewee starts invited');
  const opened = await openSession(w, person, consent);
  assert.equal(opened.status, 201, JSON.stringify(opened.body));
  return { sid: opened.body.session.id as number, points: opened.body.points as Array<{ id: number }> };
}

/** The founder asks the first `asked` questions (ticks them) while the interviewee answers `chunks` parts. */
async function conduct(w: W, sid: number, points: Array<{ id: number }>, { asked, chunks }: { asked: number; chunks: number[] }) {
  assert.equal((await call(w.env, FOUNDER, 'POST', `/sessions/${sid}/start`)).status, 200);
  for (const seq of chunks) assert.equal((await putChunk(w, sid, seq)).status, 201);
  for (const p of points.slice(0, asked)) assert.equal((await call(w.env, FOUNDER, 'PUT', `/sessions/${sid}/points/${p.id}`, { covered: true })).status, 200);
}

const stop = (w: W, sid: number) => call(w.env, FOUNDER, 'POST', `/sessions/${sid}/stop`);
const job = (w: W, sid: number) => runInterviewProcessJob(w.env, { session_id: sid, user_id: FOUNDER });

/** Every quote the founder can read from this session's summary and digest. */
function quotesShown(body: any): string[] {
  return [
    ...(body.summary?.sentences ?? []).flatMap((s: any) => s.cites.map((c: any) => c.quote)),
    ...(body.digest?.overview ?? []).map((o: any) => o.cite?.quote),
    ...(body.digest?.key_quotes ?? []).map((k: any) => k.quote),
  ].filter((q) => typeof q === 'string');
}

// ── 1. A complete interview ──────────────────────────────────────────────────

test('a complete interview reaches a summary that quotes only what was said', async () => {
  const rowan = INTERVIEWEES.rowan;
  const w = world();
  w.script.said.push(...rowan.answers);
  // The model "summary": a real quote, an invented quote, and a sentence resting on a span nobody spoke in.
  w.script.summary = scriptedSummary({ quoteReal: rowan.answers[0] });

  const { sid, points } = await open(w, rowan);
  assert.equal(points.length, QUESTIONS.length, 'the study\'s three questions are on the session');
  assert.equal(interviewStage(w, rowan.id), 'booked', 'opening the session books the invited interviewee');
  await conduct(w, sid, points, { asked: 3, chunks: [0, 1, 2] });
  assert.equal((await stop(w, sid)).status, 200);
  assert.equal(interviewStage(w, rowan.id), 'done', 'it lands in Interviews once stopped');
  const fin = await call(w.env, FOUNDER, 'POST', `/sessions/${sid}/finish`, { last_seq: 2, auto: true });
  assert.equal(fin.status, 202);
  assert.equal(fin.body.queued, true, 'every part is in, so the job is queued');
  assert.equal(await job(w, sid), 'done');

  // The records written.
  assert.deepEqual(finalTexts(w, sid), rowan.answers, 'the answers are stored as said, in order');
  const s = sessionRow(w, sid);
  assert.equal(s.processing_stage, 'done');
  assert.equal(s.processing_error, null);
  assert.ok(s.summary && s.digest_json, 'a summary and a digest were stored');
  assert.deepEqual(all(w, 'SELECT step, outcome FROM interview_summary_receipts WHERE session_id = ?', sid), [{ step: 'summarised', outcome: 'ok' }]);
  assert.deepEqual(w.calls.map((c) => c.kind).filter((k) => k !== 'structure'), ['stt', 'stt', 'stt', 'summary'], 'each answer transcribed once, one summary run');

  // What the founder reads.
  const r = await read(w, sid);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.processing, { ...r.body.processing, stage: 'done', error: null });
  assert.equal(r.body.points_covered, 3);
  assert.equal(r.body.points.length, 3);
  const said = rowan.answers.join(' ');
  const shown = quotesShown(r.body);
  assert.ok(shown.length >= 2, 'the summary quotes something');
  for (const q of shown) assert.ok(said.includes(q), `quoted text is in the transcript: ${q}`);
  assert.deepEqual(r.body.digest.key_quotes.map((k: any) => k.quote), [rowan.answers[0]], 'only the quote that was said is kept');
  assert.equal(r.body.digest.key_quotes[0].segment_id, r.body.segments.find((x: any) => x.text === rowan.answers[0]).id, 'its source passage is a stored segment');
  const everything = JSON.stringify({ summary: r.body.summary, digest: r.body.digest, row: [s.summary, s.summary_citations_json, s.digest_json] });
  assert.ok(!everything.includes(INVENTED_QUOTE), 'a quote nobody said is dropped');
  assert.ok(!everything.includes(INVENTED_CLAIM), 'a sentence that cites nothing said is dropped');
  assert.equal(r.body.summary.sentences.length, 1);

  // Nothing leaked to the other invitee or another venture's founder.
  assert.equal(interviewStage(w, INTERVIEWEES.sasha.id), 'invited');
  assert.equal(one(w, 'SELECT COUNT(*) AS n FROM interview_sessions WHERE interview_id = ?', INTERVIEWEES.sasha.id).n, 0);
  assert.equal((await call(w.env, OUTSIDER, 'GET', `/sessions/${sid}`)).status, 404, 'another founder cannot read it');
});

// ── 2. Consent declined ──────────────────────────────────────────────────────

test('an interviewee who declines consent leaves no answers and no summary', async () => {
  const sasha = INTERVIEWEES.sasha;
  const w = world();
  w.script.said.push(...sasha.answers);
  w.script.summary = scriptedSummary({ quoteReal: sasha.answers[0] });

  const { sid } = await open(w, sasha, { status: 'declined' });
  assert.equal(sessionRow(w, sid).consent_status, 'declined');
  const refused = [
    await call(w.env, FOUNDER, 'POST', `/sessions/${sid}/start`),
    await putChunk(w, sid, 0),
    await call(w.env, FOUNDER, 'POST', `/sessions/${sid}/finish`, { last_seq: 0, auto: true }),
    await call(w.env, FOUNDER, 'POST', `/sessions/${sid}/summarise`),
    await call(w.env, FOUNDER, 'POST', `/sessions/${sid}/process`),
  ];
  for (const r of refused) {
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.equal(r.body.error ?? r.body.detail, 'consent_not_recorded');
  }
  assert.equal(w.objects.size, 0, 'no audio kept');
  assert.equal(one(w, 'SELECT COUNT(*) AS n FROM interview_session_chunks WHERE session_id = ?', sid).n, 0);
  assert.equal(hasAnswers(w, sid), 0, 'no answers');
  assert.equal(w.calls.length, 0, 'no model ran');
  assert.equal(w.queued.length, 0, 'no job queued');
  const s = sessionRow(w, sid);
  assert.equal(s.status, 'draft');
  assert.equal(s.summary, null);
  assert.equal(s.digest_json, null);
  assert.equal(s.processing_stage, null);
  assert.equal(one(w, 'SELECT COUNT(*) AS n FROM interview_summary_receipts WHERE session_id = ?', sid).n, 0);
  assert.equal(one(w, 'SELECT transcript FROM discovery_interviews WHERE id = ?', sasha.id).transcript, null);
  assert.equal(interviewStage(w, sasha.id), 'booked', 'the interview is not marked held');
  const r = await read(w, sid);
  assert.equal(r.body.summary, null);
  assert.equal(r.body.digest, null);
  assert.deepEqual(r.body.segments, []);
});

test('an interviewee who withdraws consent after the answers loses the summary; today the transcript stays', async () => {
  const rowan = INTERVIEWEES.rowan;
  const w = world();
  w.script.said.push(...rowan.answers);
  w.script.summary = scriptedSummary({ quoteReal: rowan.answers[0] });
  const { sid, points } = await open(w, rowan);
  await conduct(w, sid, points, { asked: 3, chunks: [0, 1, 2] });
  await stop(w, sid);
  await call(w.env, FOUNDER, 'POST', `/sessions/${sid}/finish`, { last_seq: 2, auto: true });
  assert.equal(await job(w, sid), 'done');
  assert.ok(sessionRow(w, sid).summary, 'there was a summary to lose');
  const callsBefore = w.calls.length;

  const withdrawn = await call(w.env, FOUNDER, 'PATCH', `/sessions/${sid}/consent`, { status: 'declined' });
  assert.equal(withdrawn.status, 200, JSON.stringify(withdrawn.body));
  const s = sessionRow(w, sid);
  assert.equal(s.consent_status, 'declined');
  assert.equal(s.summary, null);
  assert.equal(s.digest_json, null);
  assert.equal(s.summary_citations_json, null);
  const r = await read(w, sid);
  assert.equal(r.body.summary, null);
  assert.equal(r.body.digest, null);
  // Today's behaviour, for the owner (D8521): the transcript is kept until the founder deletes the session.
  assert.deepEqual(finalTexts(w, sid), rowan.answers);
  // And nothing runs again on it.
  const again = await call(w.env, FOUNDER, 'POST', `/sessions/${sid}/summarise`);
  assert.equal(again.status, 409);
  assert.equal(again.body.error, 'consent_not_recorded');
  assert.equal(w.calls.length, callsBefore, 'no model ran after the withdrawal');
});

test('consent withdrawn before the job runs: the job fails with the consent sentence and runs no model', async () => {
  const rowan = INTERVIEWEES.rowan;
  const w = world();
  w.script.said.push(...rowan.answers);
  const { sid, points } = await open(w, rowan);
  await conduct(w, sid, points, { asked: 1, chunks: [0] });
  await stop(w, sid);
  await call(w.env, FOUNDER, 'POST', `/sessions/${sid}/finish`, { last_seq: 0, auto: true });
  assert.equal((await call(w.env, FOUNDER, 'PATCH', `/sessions/${sid}/consent`, { status: 'declined' })).status, 200);
  assert.equal(await job(w, sid), 'failed');
  const s = sessionRow(w, sid);
  assert.equal(s.processing_stage, 'failed');
  assert.equal(s.processing_error, NO_CONSENT_SENTENCE);
  assert.equal(w.calls.length, 0, 'no model ran');
  assert.equal(hasAnswers(w, sid), 0, 'no answers were written');
  assert.equal(s.summary, null);
});

// ── 3. Abandoned half way ────────────────────────────────────────────────────

test('an interview whose last part never arrives is summarised with its missing-parts marker, not as complete', async () => {
  const rowan = INTERVIEWEES.rowan;
  const w = world();
  w.script.said.push(...rowan.answers.slice(0, 2));
  w.script.summary = scriptedSummary({ quoteReal: rowan.answers[0] });
  const { sid, points } = await open(w, rowan);
  // The founder asked two of three questions and the tab closed before the third part uploaded.
  await conduct(w, sid, points, { asked: 2, chunks: [0, 1] });
  assert.equal((await stop(w, sid)).status, 200);
  const fin = await call(w.env, FOUNDER, 'POST', `/sessions/${sid}/finish`, { last_seq: 2, auto: true });
  assert.equal(fin.status, 202);
  assert.equal(fin.body.queued, false, 'a part is missing, so the job is not queued yet');
  assert.equal(fin.body.processing.stage, 'uploading');
  assert.equal(w.queued.length, 0);
  assert.equal(w.calls.length, 0);
  assert.equal(sessionRow(w, sid).summary, null, 'no summary while parts are still awaited');

  // Half an hour on, the sweeper goes on with what arrived and says what did not.
  w.db.prepare("UPDATE interview_sessions SET processing_updated_at = datetime('now', ?) WHERE id = ?").run(`-${UPLOAD_MINUTES + 1} minutes`, sid);
  const swept = await sweepInterviewSessions(w.env);
  assert.equal(swept.resumed, 1);
  assert.equal(w.queued.length, 1);
  assert.equal(await job(w, sid), 'done');

  const s = sessionRow(w, sid);
  assert.equal(s.processing_stage, 'done');
  assert.equal(s.processing_error, missingLine([2]), 'the founder is told part 3 never arrived');
  assert.deepEqual(finalTexts(w, sid), rowan.answers.slice(0, 2), 'only the answers that arrived are in the transcript');
  const r = await read(w, sid);
  assert.equal(r.body.processing.error, missingLine([2]));
  assert.equal(r.body.points_covered, 2, 'two of the three questions were asked');
  assert.equal(r.body.points.length, 3);
  assert.ok(r.body.summary, 'a summary of what was said exists');
  const shown = JSON.stringify([quotesShown(r.body), r.body.summary, r.body.digest]);
  assert.ok(!shown.includes(rowan.answers[2]), 'the unanswered part is not in the summary');
  assert.ok(!shown.includes(INVENTED_QUOTE));
});

test('an interview left recording and never stopped has no summary, and is not marked held', async () => {
  const rowan = INTERVIEWEES.rowan;
  const w = world();
  w.script.said.push(...rowan.answers);
  w.script.summary = scriptedSummary({ quoteReal: rowan.answers[0] });
  const { sid, points } = await open(w, rowan);
  await conduct(w, sid, points, { asked: 1, chunks: [0] });
  assert.equal(sessionRow(w, sid).status, 'recording');
  // Silent past the limit: the sweeper pauses it, and still nothing is summarised.
  const back = `-${SILENT_MINUTES + 1} minutes`;
  w.db.prepare("UPDATE interview_sessions SET recording_since = datetime('now', ?) WHERE id = ?").run(back, sid);
  w.db.prepare("UPDATE interview_session_chunks SET created_at = datetime('now', ?) WHERE session_id = ?").run(back, sid);
  const swept = await sweepInterviewSessions(w.env);
  assert.equal(swept.paused, 1);
  const s = sessionRow(w, sid);
  assert.equal(s.status, 'paused');
  assert.equal(s.summary, null);
  assert.equal(s.digest_json, null);
  assert.equal(s.processing_stage, null);
  assert.equal(hasAnswers(w, sid), 0, 'nothing is transcribed until the founder stops and finishes');
  assert.equal(interviewStage(w, rowan.id), 'booked', 'not held');
  const asked = await call(w.env, FOUNDER, 'POST', `/sessions/${sid}/summarise`);
  assert.equal(asked.status, 409);
  assert.equal(asked.body.error, 'no_final_transcript');
  assert.equal(w.calls.length, 0, 'no model ran');
  assert.equal((await read(w, sid)).body.summary, null);
});

// ── 4. An answer with contact details ────────────────────────────────────────

test('an answer with an email address and a phone number: TODAY it reaches the founder\'s summary verbatim (no redaction)', async () => {
  const sasha = INTERVIEWEES.sasha;
  const contactLine = sasha.answers[1];
  assert.ok(contactLine.includes(CONTACT_EMAIL) && contactLine.includes(CONTACT_PHONE));
  const w = world();
  w.script.said.push(...sasha.answers);
  w.script.summary = scriptedSummary({ quoteReal: contactLine, overview: 'They said where to send the report.', span: { from: 10_000, to: 12_500 } });
  const { sid, points } = await open(w, sasha);
  await conduct(w, sid, points, { asked: 3, chunks: [0, 1, 2] });
  await stop(w, sid);
  await call(w.env, FOUNDER, 'POST', `/sessions/${sid}/finish`, { last_seq: 2, auto: true });
  assert.equal(await job(w, sid), 'done');

  // Recorded as it is today (owner decision, D8521): nothing between the transcript and the summary removes them.
  const r = await read(w, sid);
  assert.ok(r.body.segments.some((x: any) => x.text.includes(CONTACT_EMAIL) && x.text.includes(CONTACT_PHONE)), 'the transcript has them');
  assert.ok(r.body.digest.key_quotes.some((k: any) => k.quote.includes(CONTACT_EMAIL) && k.quote.includes(CONTACT_PHONE)), 'the key quote has them');
  assert.ok(r.body.digest.overview.some((o: any) => o.cite.quote.includes(CONTACT_EMAIL)), 'the overview citation has the email');
  assert.ok(r.body.summary.sentences.some((s: any) => s.cites.some((c: any) => c.quote.includes(CONTACT_PHONE))), 'the summary citation has the phone number');
  const s = sessionRow(w, sid);
  assert.ok(String(s.digest_json).includes(CONTACT_EMAIL) && String(s.summary_citations_json).includes(CONTACT_PHONE), 'and so do the stored rows');
  assert.equal(one(w, 'SELECT transcript FROM discovery_interviews WHERE id = ?', sasha.id).transcript.includes(CONTACT_EMAIL), true, 'and the interview\'s plain transcript');
  assert.equal(one(w, 'SELECT COUNT(*) AS n FROM interview_summary_receipts WHERE session_id = ? AND outcome = \'ok\'', sid).n, 1);
  // Still only what was said: the invented quote is gone here too.
  assert.ok(!JSON.stringify(r.body).includes(INVENTED_QUOTE));
});
