/** #3711: synthetic recordings only; recovery reuses durable work. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, seed, FOUNDER } from './_call_audio_fixture.ts';
import { loadSession } from '../src/services/interviewSessions.ts';
import { recoverSession, runInterviewProcessJob } from '../src/services/interviewProcessing.ts';
import { transcriptHash } from '../src/services/validateEngine.ts';
import { toSegments } from '../src/services/interviewStructuring.ts';

function world(chunks = 1, status = 'stopped') {
  const w = fixture();
  const id = seed(w, { chunks, ageDays: 0, stage: 'failed' });
  w.db.prepare("UPDATE interview_sessions SET status=?, processing_auto=1, expected_last_seq=? WHERE id=?").run(status, chunks-1, id);
  const messages: unknown[] = [];
  Object.assign(w.env, { USE_CF_QUEUE: 'true', JOB_QUEUE: { async send(body: unknown) { messages.push(body); } } });
  return { ...w, id, messages };
}

test('no-audio legacy failures cannot queue an empty transcript, including expected_last_seq=-1 and missing rows', async () => {
  for (const expected of [-1, 0, null]) {
    const w = world(0);
    w.db.prepare('UPDATE interview_sessions SET expected_last_seq=? WHERE id=?').run(expected,w.id);
    const result = await recoverSession(w.env,(await loadSession(w.env,w.id))!,FOUNDER);
    assert.deepEqual(result, { ok: false, detail: 'no_audio', message: 'No recorded audio is available for this session. Start a new recording.' });
    assert.equal(w.messages.length, 0);
    assert.equal(w.stt.length, 0);
  }
});

test('a completed summary of this transcript resumes placing, while changed or unreadable summaries resume summarising', async () => {
  for (const kind of ['matching','changed','unreadable','absent']) {
    const w = world(1, 'transcribed');
    const segments = toSegments(w.db.prepare("SELECT id,start_ms,end_ms,speaker_label,text FROM interview_transcript_segments WHERE session_id=? AND source='final'").all(w.id) as any);
    const hash = await transcriptHash(segments);
    w.db.prepare('UPDATE interview_sessions SET summary=?,digest_json=? WHERE id=?')
      .run(kind==='absent'?null:'Synthetic summary',kind==='unreadable'?'{':JSON.stringify({hash:kind==='changed'?'different':hash}),w.id);
    const result = await recoverSession(w.env,(await loadSession(w.env,w.id))!,FOUNDER);
    assert.deepEqual(result,{ok:true,stage:kind==='matching'?'placing':'summarising'});
    assert.equal(w.messages.length,1);
    assert.equal(w.stt.length,0);
    const again = await recoverSession(w.env,(await loadSession(w.env,w.id))!,FOUNDER);
    assert.equal(again.ok,false);
    assert.equal(w.messages.length,1);
  }
});

test('processing exceptions name the persisted step without leaking provider text or promising retained audio', async () => {
  for (const stage of ['transcribing','summarising','placing']) {
    const w = world();
    w.db.prepare('UPDATE interview_sessions SET processing_stage=? WHERE id=?').run(stage,w.id);
    // Throw from each stage's own work. Keep the outer session/auth reads real.
    const original = w.env.DB.prepare.bind(w.env.DB);
    w.env.DB.prepare = (sql: string) => {
      if ((stage==='transcribing' && sql.includes('SELECT seq FROM interview_chunk_transcripts')) ||
          (stage!=='transcribing' && sql.includes('SELECT id, start_ms, end_ms, speaker_label, text'))) throw new Error('SYNTHETIC_PRIVATE_PROVIDER_TEXT');
      return original(sql);
    };
    const warnings: unknown[][]=[];const warn=console.warn;console.warn=(...args)=>{warnings.push(args);};
    try { assert.equal(await runInterviewProcessJob(w.env,{session_id:w.id,user_id:FOUNDER}),'failed'); }
    finally {console.warn=warn;}
    const row = (await loadSession(w.env,w.id))!;
    assert.equal(row.processing_error,`${stage==='placing'?'Placing findings':stage==='summarising'?'Summarising':'Transcribing'} stopped unexpectedly. Try again to resume this step.`);
    assert.doesNotMatch(JSON.stringify(warnings), /SYNTHETIC_PRIVATE_PROVIDER_TEXT|Nothing was lost/);
    assert.match(JSON.stringify(warnings), new RegExp(stage));
  }
});
