/** Synthetic fixture labels/content only. No payloads or names in test output. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { fixture, seed, mig, FOUNDER } from './_call_audio_fixture.ts';
import { encryptColumn, decryptColumn } from '../src/services/columnCipher.ts';
import { AUDIO_PREFIX, deleteSessionAudio, deleteSession, loadSession } from '../src/services/interviewSessions.ts';
import { NOVA_3 } from '../src/services/sttFormats.ts';
import * as assembly from '../src/services/meetingBotAssembly.ts';
import { runInterviewProcessJob } from '../src/services/interviewProcessing.ts';
import { withGuard } from './_guard_stub.mjs';

type Module = typeof assembly;
async function world(platform = 'google_meet') {
  const w = fixture();
  if (!w.db.prepare('PRAGMA table_info(users)').all().some((c:any)=>c.name==='display_name')) w.db.exec('ALTER TABLE users ADD COLUMN display_name TEXT');
  w.db.exec(mig('531_meeting_bots.sql'));
  w.db.exec(mig('532_meeting_bot_participants.sql'));
  const session = seed(w, { chunks: 0, ageDays: 0 });
  w.db.prepare("UPDATE users SET name='Fixture Founder' WHERE id=?").run(FOUNDER);
  w.db.prepare("UPDATE interview_sessions SET submitted_via='meeting_bot', status='stopped', processing_stage='transcribing' WHERE id=?").run(session);
  const uid = crypto.randomUUID();
  w.db.prepare(`INSERT INTO meeting_bots(uid,user_id,project_id,session_id,platform,meeting_url_enc,status,scheduled_at,started_at,ended_at,limit_minutes,cost_per_minute_microusd,rate_per_minute_microusd,created_at)
    VALUES(?,?,?,?,?,'','processing',0,0,3000,30,100,125,0)`).run(uid, FOUNDER, 10, session, platform);
  let seq = 0;
  const event = async (kind: string, payload: unknown, rowUid = uid) => {
    const id = seq++;
    const enc = await encryptColumn(w.env, 'meeting_bot_events', 'payload_enc', `${rowUid}:${id}`, JSON.stringify(payload));
    w.db.prepare('INSERT INTO meeting_bot_events(run_uid,seq,kind,payload_enc,received_at) VALUES(?,?,?,?,0)').run(uid,id,kind,enc);
  };
  const people = [
    { id: 'p0', name: 'Fixture Founder', joined_ms: 0, left_ms: null },
    { id: 'p1', name: 'Fixture Participant', joined_ms: 0, left_ms: 2000 },
    { id: 'p2', name: ['fixture','invalid.example'].join('@'), joined_ms: 2000, left_ms: null },
    { id: 'bot', name: 'Eadwyn AI', joined_ms: 0, left_ms: null },
  ];
  await event('roster', { participants: people });
  for (let i = 0; i < 3; i++) {
    await event('speaker', { participant_id: i === 2 ? null : `p${i}`, at_ms: i*1000 });
    await event('chunk', { chunk_seq: i, start_ms: i*1000, size_bytes: 32044, participant_id: platform === 'zoom' ? `p${i}` : null });
    w.db.prepare('INSERT INTO interview_session_chunks(session_id,seq,r2_key,mime,size_bytes,start_ms) VALUES(?,?,?,\'audio/wav\',32044,?)')
      .run(session,i,`${AUDIO_PREFIX}${FOUNDER}/fixture/${i}.wav`,i*1000);
    w.db.prepare('INSERT INTO interview_chunk_transcripts(session_id,seq,model,language,segments_json,cost_microusd,fallback_used) VALUES(?,?,?,\'en\',?,10,0)')
      .run(session,i,NOVA_3,JSON.stringify([{start_ms:0,end_ms:1000,speaker_raw:'0',speaker_label:'Incorrect pre-assembly label',text:'Synthetic fixture passage.'}]));
  }
  return { ...w, session, uid, people, event };
}

const scenarios: Record<string, (m: Module) => Promise<void>> = {
  async 'real encrypted snapshots and raw stages produce names, silence and private participant labels'(m) {
    const w = await world();
    const before = w.db.prepare('SELECT total_changes() AS n').get().n;
    const result = await m.prepareBotAssembly(w.env,w.uid);
    assert.deepEqual(result.segments.map(s=>s.speaker_label), ['Me','Fixture Participant','Speaker 1']);
    assert.deepEqual(result.segments.map(s=>s.start_ms), [0,1000,2000]);
    assert.deepEqual(result.participants.map(p=>p.name), ['Me','Fixture Participant','Participant 1']);
    assert.deepEqual(result.participants.map(p=>[p.joined_at_ms,p.left_at_ms]), [[0,null],[0,2000],[2000,null]]);
    assert.equal(result.participants.length,3);
    assert.equal(result.costMicro,30); assert.equal(result.model,NOVA_3); assert.equal(result.language,'en');
    assert.equal(result.fallback,false); assert.equal(result.audioMinutes,0.05);
    assert.equal(w.stt.length,0);
    assert.equal(w.db.prepare('SELECT total_changes() AS n').get().n,before);
    assert.deepEqual((await m.prepareBotAssembly(w.env,w.uid)).segments,result.segments);
  },
  async 'snapshot rename applies; absent people do not get an invented departure'(m) {
    const w = await world();
    await w.event('roster',{participants:[{...w.people[1],name:'Renamed fixture',left_ms:null}]});
    const result=await m.prepareBotAssembly(w.env,w.uid);
    assert.equal(result.segments[1].speaker_label,'Renamed fixture');
    assert.equal(result.participants[0].left_at_ms,null);
  },
  async 'the founder display name takes precedence over the account name'(m) {
    const w=await world();w.db.prepare('UPDATE users SET display_name=? WHERE id=?').run('Alternate fixture',FOUNDER);
    await w.event('roster',{participants:[{...w.people[0],name:'Alternate fixture'}]});
    assert.equal((await m.prepareBotAssembly(w.env,w.uid)).segments[0].speaker_label,'Me');
  },
  async 'repeated snapshots stay compact and event reads span bounded pages'(m) {
    const row={kind:'roster',payload:{participants:[{id:'p',name:'Fixture',joined_ms:0,left_ms:null}]}};
    assert.equal(m.botSnapshotEvents(Array(1000).fill(row),1000).events.length,1);
    const w=await world();
    for(let seq=100;seq<220;seq++) w.db.prepare("INSERT INTO meeting_bot_events(run_uid,seq,kind,payload_enc,received_at) VALUES(?,?,'heartbeat','ignored',0)").run(w.uid,seq);
    let pages=0;const prepare=w.env.DB.prepare.bind(w.env.DB);
    w.env.DB.prepare=((sql:string)=>{if(sql.includes('FROM meeting_bot_events') && sql.includes('LIMIT 100')) pages++;return prepare(sql);}) as any;
    assert.equal((await m.prepareBotAssembly(w.env,w.uid)).segments.length,3);
    assert.equal(pages,2);
  },
  async 'Zoom names per-participant streams without a diarized number or speaker indicator'(m) {
    const w=await world('zoom');
    w.db.prepare("DELETE FROM meeting_bot_events WHERE kind='speaker'").run();
    w.db.prepare('UPDATE interview_chunk_transcripts SET segments_json=?').run(JSON.stringify([{start_ms:0,end_ms:1000,text:'Synthetic fixture passage.',speaker_raw:null}]));
    const result=await m.prepareBotAssembly(w.env,w.uid);
    assert.deepEqual(result.segments.map(s=>s.speaker_label),['Me','Fixture Participant','Participant 1']);
  },
  async 'null, blank and nonnumeric raw speakers never become model speaker zero'(m) {
    for (const raw of [null,'','Speaker 0','-1','1.5']) {
      const p=m.botStagedPassages([{start_ms:0,end_ms:1000,speaker_raw:raw,text:'Fixture.'}],0,2000,1000,null);
      assert.equal(p[0].speaker,null); assert.equal(p[0].start_ms,2000); assert.equal(p[0].end_ms,3000);
    }
    assert.equal(m.botStagedPassages([{start_ms:null,end_ms:null,speaker_raw:'0',text:'Fixture.'}],0,0,1000,null)[0].speaker,0);
  },
  async 'an incomplete or inconsistent audio manifest cannot prepare a transcript'(m) {
    for (const sql of [
      "DELETE FROM meeting_bot_events WHERE kind='chunk' AND seq=(SELECT MAX(seq) FROM meeting_bot_events WHERE kind='chunk')",
      'DELETE FROM interview_session_chunks WHERE seq=1',
      'UPDATE interview_session_chunks SET size_bytes=32046 WHERE seq=1',
      'UPDATE interview_session_chunks SET start_ms=5 WHERE seq=1',
      "UPDATE interview_session_chunks SET r2_key='other-feature/fixture' WHERE seq=1",
      'DELETE FROM interview_chunk_transcripts WHERE seq=1',
    ]) {
      const w=await world(); w.db.exec(sql);
      await assert.rejects(m.prepareBotAssembly(w.env,w.uid), /bot_(audio|transcript)_incomplete/);
    }
    const extra=await world(); await extra.event('chunk',{chunk_seq:3,start_ms:3000,size_bytes:32044});
    await assert.rejects(m.prepareBotAssembly(extra.env,extra.uid), /bot_audio_incomplete/);
    const staged=await world(); staged.db.prepare('INSERT INTO interview_chunk_transcripts(session_id,seq,model,segments_json) VALUES(?,3,?,\'[]\')').run(staged.session,NOVA_3);
    await assert.rejects(m.prepareBotAssembly(staged.env,staged.uid), /bot_transcript_incomplete/);
  },
  async 'cipher corruption or wrong run/sequence AAD is unreadable, never a guessed roster'(m) {
    const w=await world();
    await w.event('roster',{participants:w.people},'another-fixture-run');
    await assert.rejects(m.prepareBotAssembly(w.env,w.uid), /bot_assembly_unreadable/);
    const bad=await world(); bad.db.prepare("UPDATE interview_chunk_transcripts SET segments_json='broken fixture JSON' WHERE seq=0").run();
    await assert.rejects(m.prepareBotAssembly(bad.env,bad.uid), /bot_assembly_unreadable/);
  },
  async 'run ownership, source, consent, audio deletion and run phase are checked'(m) {
    for (const sql of [
      "UPDATE meeting_bots SET status='recording'", "UPDATE meeting_bots SET ended_at=NULL",
      "UPDATE meeting_bots SET failure_code='access_revoked'", 'UPDATE users SET jwt_min_iat=1',
      'UPDATE meeting_bots SET user_id=3', "UPDATE interview_sessions SET submitted_via='upload'",
      "UPDATE interview_sessions SET consent_status='declined'", "UPDATE interview_sessions SET audio_removed_at=datetime('now')",
    ]) { const w=await world(); w.db.exec(sql); await assert.rejects(m.prepareBotAssembly(w.env,w.uid)); }
  },
  async 'a permission revoked during reads is checked again before returning'(m) {
    const w=await world(); const original=w.env.DB.prepare.bind(w.env.DB);
    w.env.DB.prepare=((sql:string)=>{
      const statement=original(sql);
      if (sql==='SELECT name, display_name FROM users WHERE id = ?') {
        const bind=statement.bind.bind(statement);
        statement.bind=((...args:unknown[])=>{const bound=bind(...args);const first=bound.first.bind(bound);
          bound.first=async()=>{const value=await first();w.db.prepare("UPDATE interview_sessions SET consent_status='declined'").run();return value;};return bound;}) as any;
      }
      return statement;
    }) as any;
    await assert.rejects(m.prepareBotAssembly(w.env,w.uid));
  },
  async 'bad snapshots, speaker clocks, conflicting manifests and malformed stages fail with codes only'(m) {
    for (const rows of [
      [{kind:'roster',payload:{participants:[{id:'a',name:'Fixture',joined_ms:10,left_ms:1}]}}],
      [{kind:'speaker',payload:{participant_id:null,at_ms:-1}}],
      [{kind:'speaker',payload:{participant_id:42,at_ms:0}}],
      [{kind:'chunk',payload:{chunk_seq:0,start_ms:0,size_bytes:45}}],
      [{kind:'chunk',payload:{chunk_seq:0,start_ms:0,size_bytes:32044}}, {kind:'chunk',payload:{chunk_seq:0,start_ms:1,size_bytes:32044}}],
    ]) assert.throws(()=>m.botSnapshotEvents(rows,1800000), /bot_manifest_(invalid|conflict)/);
    assert.equal(m.botSnapshotEvents([{kind:'speaker',payload:{participant_id:null,at_ms:0}}],1000).events[0].type,'active_speaker');
    for(const segment of [{start_ms:0,end_ms:1001,text:'Fixture.'},{start_ms:2,end_ms:1,text:'Fixture.'},{start_ms:0,end_ms:1,text:42}]) {
      assert.throws(()=>m.botStagedPassages([segment],0,0,1000,null), /bot_stage_invalid/);
    }
  },
  async 'final segments, encrypted participants and receipt commit atomically once'(m) {
    const w=await world(), prepared=await m.prepareBotAssembly(w.env,w.uid);
    assert.equal(await m.commitBotAssembly(w.env,prepared),true);
    assert.equal(await m.commitBotAssembly(w.env,prepared),false);
    const row=w.db.prepare('SELECT participants_enc FROM meeting_bots WHERE uid=?').get(w.uid);
    assert.equal(row.participants_enc.startsWith('v1.'),true);
    assert.equal(row.participants_enc.includes('Fixture'),false);
    const participants=JSON.parse((await decryptColumn(w.env,'meeting_bots','participants_enc',w.uid,row.participants_enc))!);
    assert.equal(participants.length,3);
    assert.deepEqual(Object.keys(participants[0]).sort(),['joined_ms','left_ms','name']);
    assert.equal(participants[0].joined_ms,0);
    assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM interview_transcript_segments WHERE session_id=?').get(w.session).n,3);
    assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM interview_session_receipts WHERE session_id=?').get(w.session).n,1);
    const parallel=await world(), p=await m.prepareBotAssembly(parallel.env,parallel.uid);
    assert.equal((await Promise.all([m.commitBotAssembly(parallel.env,p),m.commitBotAssembly(parallel.env,p)])).filter(Boolean).length,1);
  },
  async 'late consent loss makes every final-write statement a no-op'(m) {
    const w=await world(), p=await m.prepareBotAssembly(w.env,w.uid);
    const batch=w.env.DB.batch.bind(w.env.DB);
    w.env.DB.batch=(async(statements:any)=>{w.db.prepare("UPDATE interview_sessions SET consent_status='declined'").run();return batch(statements);}) as any;
    await assert.rejects(m.commitBotAssembly(w.env,p));
    assert.equal(w.db.prepare('SELECT participants_enc FROM meeting_bots WHERE uid=?').get(w.uid).participants_enc,null);
    assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM interview_session_receipts WHERE session_id=?').get(w.session).n,0);
    assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM interview_transcript_segments WHERE session_id=?').get(w.session).n,1);
  },
  async 'queue handoff uses the recorder job, Nova and the stored manual choice'(m) {
    const w=await world();w.db.prepare('UPDATE interview_sessions SET processing_stage=NULL, processing_auto=NULL WHERE id=?').run(w.session);
    const messages:any[]=[];
    w.env.USE_CF_QUEUE='true';w.env.JOB_QUEUE={send:async(body:any)=>{messages.push(body);}} as any;
    await m.queueBotAssembly(w.env,w.uid);
    const row=w.db.prepare('SELECT final_model,expected_last_seq,processing_auto FROM interview_sessions WHERE id=?').get(w.session);
    assert.equal(row.final_model,NOVA_3);assert.equal(row.expected_last_seq,2);assert.equal(row.processing_auto,0);
    assert.equal(messages.length,1);assert.equal(messages[0].job_type,'interview_process');
    assert.deepEqual(messages[0].payload,{session_id:w.session,user_id:FOUNDER});
    assert.equal(messages[0].idempotency_key,`bot_assembly:${w.uid}`);
    assert.equal(w.stt.length,0);
  },
  async 'late permission loss never stages a model result'(m) {
    const w=await world();w.db.prepare('DELETE FROM interview_chunk_transcripts').run();
    const prepare=w.env.DB.prepare.bind(w.env.DB);
    w.env.DB.prepare=((sql:string)=>{
      if(sql.startsWith('INSERT OR IGNORE INTO interview_chunk_transcripts')) w.db.prepare("UPDATE interview_sessions SET consent_status='declined'").run();
      return prepare(sql);
    }) as any;
    await assert.rejects(m.stageBotChunk(w.env,w.uid,0,{model:NOVA_3,language:'en',segments:[],costMicro:1,fallback:false}));
    assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM interview_chunk_transcripts').get().n,0);
  },
  async 'a failed final write rolls back participants, transcript and receipt together'(m) {
    const w=await world(), prepared=await m.prepareBotAssembly(w.env,w.uid);
    prepared.segments[0].text=null as any;
    await assert.rejects(m.commitBotAssembly(w.env,prepared));
    assert.equal(w.db.prepare('SELECT participants_enc FROM meeting_bots WHERE uid=?').get(w.uid).participants_enc,null);
    assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM interview_transcript_segments WHERE session_id=?').get(w.session).n,1);
    assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM interview_session_receipts WHERE session_id=?').get(w.session).n,0);
  },
  async 'audio deletion keeps final labels; session deletion removes the run and its private events'(m) {
    const w=await world();await m.commitBotAssembly(w.env,await m.prepareBotAssembly(w.env,w.uid));
    const encoded=w.db.prepare('SELECT participants_enc FROM meeting_bots WHERE uid=?').get(w.uid).participants_enc;
    await deleteSessionAudio(w.env,(await loadSession(w.env,w.session))!,FOUNDER,'deleted');
    assert.equal(w.db.prepare('SELECT participants_enc FROM meeting_bots WHERE uid=?').get(w.uid).participants_enc,encoded);
    assert.equal((await m.readBotFinalParticipants(w.env,w.uid,FOUNDER)).participants!.length,3);
    await assert.rejects(m.readBotFinalParticipants(w.env,w.uid,3));
    assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM interview_transcript_segments WHERE session_id=?').get(w.session).n,3);
    await deleteSession(w.env,(await loadSession(w.env,w.session))!,FOUNDER);
    assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM meeting_bots').get().n,0);
    assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM meeting_bot_events').get().n,0);
  },
  async 'processing failures can be retried from paid stages without rewriting terminal run status'(m) {
    const w=await world();w.db.prepare("UPDATE meeting_bots SET status='failed',failure_code='processing_failed'").run();
    await m.commitBotAssembly(w.env,await m.prepareBotAssembly(w.env,w.uid));
    assert.equal(w.db.prepare('SELECT status FROM meeting_bots WHERE uid=?').get(w.uid).status,'failed');
  },
};
for(const [name,scenario] of Object.entries(scenarios)) test(name,()=>scenario(assembly));

test('the existing processing job reuses paid stages and completes with the named transcript',async()=>{
  const w=await world();w.db.prepare('UPDATE interview_sessions SET processing_auto=0,expected_last_seq=2').run();
  assert.equal(await runInterviewProcessJob(w.env,{session_id:w.session,user_id:FOUNDER}),'done');
  assert.equal(w.stt.length,0);
  const labels=w.db.prepare('SELECT speaker_label FROM interview_transcript_segments WHERE session_id=? ORDER BY start_ms').all(w.session);
  assert.deepEqual(labels.map((r:any)=>r.speaker_label),['Me','Fixture Participant','Speaker 1']);
  assert.equal(await runInterviewProcessJob(w.env,{session_id:w.session,user_id:FOUNDER}),null);
  assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM interview_session_receipts WHERE session_id=?').get(w.session).n,1);
});

test('unstaged bot chunks use Nova once and preserve the model speaker number',async()=>{
  const w=await world();w.db.prepare('UPDATE interview_sessions SET processing_auto=0,expected_last_seq=2,final_model=\'@cf/openai/whisper\'').run();
  w.db.prepare('DELETE FROM interview_chunk_transcripts WHERE seq>0').run();
  for(let seq=0;seq<3;seq++) w.objects.set(`${AUDIO_PREFIX}${FOUNDER}/fixture/${seq}.wav`,new Uint8Array(32044));
  const models:string[]=[];
  (w.env as any).AI=withGuard({run:async(model:string)=>{models.push(model);return {results:{channels:[{detected_language:'en',alternatives:[{transcript:'Fixture.',words:[{word:'Fixture.',start:0,end:1,speaker:0}]}]}]}};}});
  assert.equal(await runInterviewProcessJob(w.env,{session_id:w.session,user_id:FOUNDER}),'done');
  assert.deepEqual(models,[NOVA_3,NOVA_3]);
  const raw=JSON.parse(w.db.prepare('SELECT segments_json FROM interview_chunk_transcripts WHERE seq=1').get().segments_json);
  assert.equal(raw[0].speaker_raw,'0');
  await runInterviewProcessJob(w.env,{session_id:w.session,user_id:FOUNDER});
  assert.equal(models.length,2);
});

test('manifest validation happens before any transcription spend',async()=>{
  const w=await world();w.db.prepare('DELETE FROM interview_chunk_transcripts').run();
  w.db.prepare("DELETE FROM meeting_bot_events WHERE kind='chunk' AND seq=(SELECT MAX(seq) FROM meeting_bot_events WHERE kind='chunk')").run();
  w.db.prepare('UPDATE interview_sessions SET processing_auto=0,expected_last_seq=2').run();
  for(let seq=0;seq<3;seq++) w.objects.set(`${AUDIO_PREFIX}${FOUNDER}/fixture/${seq}.wav`,new Uint8Array(32044));
  assert.equal(await runInterviewProcessJob(w.env,{session_id:w.session,user_id:FOUNDER}),'failed');
  assert.equal(w.stt.length,0);
});

const source=await readFile(new URL('../src/services/meetingBotAssembly.ts',import.meta.url),'utf8');
const mutations=[
  ["return fail('bot_assembly_unreadable')",'return {}'],
  ['person.left_ms < person.joined_ms','false'],
  ['p.participant_id !== null &&','false &&'],
  ['previous.start !== manifest.start','false'],
  ["typeof s.speaker_raw === 'string' && /^\\d{1,6}$/.test(s.speaker_raw)", 'true'],
  ['Number(s.start_ms) + start','Number(s.start_ms)'],
  ['Number(s.end_ms) + start','Number(s.end_ms)'],
  ['!integer(s[key], duration)','false'],
  ["['processing', 'stopped'].includes(run.status)",'true'],
  ["session.submitted_via !== 'meeting_bot'",'false'],
  ['`${uid}:${event.seq}`','`${uid}:0`'],
  ['chunks.length !== manifests.size','false'],
  ['bySeq.size !== chunks.length','false'],
  ['manifest.size !== chunk.size_bytes','false'],
  ['manifest.start !== chunk.start_ms','false'],
  ['!chunk.r2_key.startsWith(AUDIO_PREFIX)','false'],
  ['participant_key: participant','participant_key: null'],
  ['founderName: founder?.display_name?.trim() || founder?.name','founderName: null'],
  ['await botSession(env, run);\n  return','return'],
  ["AND s.consent_status = 'given'",''],
  ['AND participants_enc IS NULL','AND 1 = 1'],
  ['return { events, manifests, state };','return { events: [...events,...events], manifests, state };'],
  ['if (page.length < 100) break;','break;'],
];
for(const [index,[before,after]] of mutations.entries()) test(`storage adapter mutation ${index+1} is caught`,async()=>{
  assert.equal(source.includes(before),true);
  const javascript=stripTypeScriptTypes(source.replaceAll(before,after),{mode:'strip'})
    .replace(/from '(\.[^']+)'/g,(_all,path)=>`from '${new URL(`${path}.ts`,new URL('../src/services/meetingBotAssembly.ts',import.meta.url)).href}'`)
    .replace(/import\('(\.[^']+)'\)/g,(_all,path)=>`import('${new URL(`${path}.ts`,new URL('../src/services/meetingBotAssembly.ts',import.meta.url)).href}')`);
  const mutant=await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}#${index}`);
  let caught=false;
  for(const scenario of Object.values(scenarios)) {try{await scenario(mutant);}catch{caught=true;break;}}
  assert.equal(caught,true,'mutated behavior must fail');
});
