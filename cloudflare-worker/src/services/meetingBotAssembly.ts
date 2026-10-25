/** D886 B6: B1's encrypted manifests into the recorder's one processing path. */
import type { Env } from '../types';
import { decryptColumn, encryptColumn } from './columnCipher';
import { botRow, botSession, sessionBot } from './meetingBots';
import { AUDIO_PREFIX, MAX_CHUNK_BYTES, UPLOAD_BYTES_PER_SECOND, WAV_HEADER_BYTES, listChunks, type StoredSegment } from './interviewSessions';
import { assembleBotTranscript, BOT_NAME, type BotEvent, type BotPassage } from './channels/botTranscript';
import { NOVA_3 } from './sttFormats';
import { writableSession } from './interviewIntake';

export class BotAssemblyError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}
const fail = (code: string): never => { throw new BotAssemblyError(code); };
const integer = (value: unknown, max: number): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function decode(raw: string | null): any {
  if (!raw || raw.length > 2_000_000) return fail('bot_assembly_unreadable');
  try { return JSON.parse(raw); } catch { return fail('bot_assembly_unreadable'); }
}

interface SnapshotState {
  marks: BotEvent[];
  manifests: Map<number, { start: number; size: number; participant: string | null }>;
  stays: Map<string, Map<number, number | null>>;
  names: Map<string, string>;
  bots: Set<string>;
  count: number;
}
/** B1 snapshots include explicit stays; repeated snapshots do not multiply them. */
export function botSnapshotEvents(rows: readonly { kind: string; payload: unknown }[], limitMs: number, previous?: SnapshotState) {
  const state: SnapshotState = previous ?? { marks: [], manifests: new Map(), stays: new Map(), names: new Map(), bots: new Set(), count: 0 };
  const { manifests } = state;
  for (const row of rows) {
    if (!['roster', 'speaker', 'chunk'].includes(row.kind)) continue;
    if (!object(row.payload)) return fail('bot_manifest_invalid');
    const p = row.payload;
    if (row.kind === 'roster') {
      if (!Array.isArray(p.participants) || p.participants.length > 500) return fail('bot_manifest_invalid');
      const ids = new Set<string>();
      for (const person of p.participants) {
        if (!object(person) || typeof person.id !== 'string' || !person.id || person.id.length > 128 || ids.has(person.id)
          || typeof person.name !== 'string' || person.name.length > 160 || !integer(person.joined_ms, limitMs)
          || person.left_ms !== null && (!integer(person.left_ms, limitMs) || person.left_ms < person.joined_ms)) return fail('bot_manifest_invalid');
        ids.add(person.id);
        const stays = state.stays.get(person.id) ?? new Map<number, number | null>();
        if (!stays.has(person.joined_ms)) state.count++;
        if (state.count > 5000) return fail('bot_manifest_limit');
        stays.set(person.joined_ms,person.left_ms);
        state.stays.set(person.id,stays);
        state.names.set(person.id,person.name);
        if (person.name.trim().replace(/\s+/g,' ').toLowerCase() === BOT_NAME.toLowerCase()) state.bots.add(person.id);
      }
    } else if (row.kind === 'speaker') {
      if (p.participant_id !== null && (typeof p.participant_id !== 'string' || !p.participant_id || p.participant_id.length > 128)
        || !integer(p.at_ms, limitMs)) return fail('bot_manifest_invalid');
      state.marks.push({ type: 'active_speaker', participant_id: p.participant_id as string | null, at_ms: p.at_ms });
    } else {
      if (!integer(p.chunk_seq, 3599) || !integer(p.start_ms, limitMs) || !integer(p.size_bytes, MAX_CHUNK_BYTES)
        || p.size_bytes <= WAV_HEADER_BYTES || (p.size_bytes - WAV_HEADER_BYTES) % 2 !== 0
        || p.participant_id !== null && p.participant_id !== undefined && (typeof p.participant_id !== 'string' || !p.participant_id || p.participant_id.length > 128)) return fail('bot_manifest_invalid');
      const manifest = { start: p.start_ms, size: p.size_bytes, participant: p.participant_id as string | null ?? null };
      const previous = manifests.get(p.chunk_seq);
      if (previous && (previous.start !== manifest.start || previous.size !== manifest.size || previous.participant !== manifest.participant)) return fail('bot_manifest_conflict');
      manifests.set(p.chunk_seq, manifest);
    }
  }
  const events: BotEvent[] = [...state.marks];
  for (const [id,stays] of state.stays) for (const [joined,left] of stays) {
    events.push({type:'join',participant_id:id,name:state.names.get(id)!,at_ms:joined,is_bot:state.bots.has(id)});
    if (left !== null) events.push({type:'leave',participant_id:id,at_ms:left});
  }
  return { events, manifests, state };
}

/** speaker_raw already preserves Nova's number in the shared recorder stage. */
export function botStagedPassages(raw: unknown, seq: number, start: number, duration: number, participant: string | null): BotPassage[] {
  if (!Array.isArray(raw)) return fail('bot_stage_invalid');
  return raw.map((s) => {
    if (!object(s) || typeof s.text !== 'string') return fail('bot_stage_invalid');
    for (const key of ['start_ms', 'end_ms']) if (s[key] !== null && !integer(s[key], duration)) return fail('bot_stage_invalid');
    if (s.start_ms !== null && s.end_ms !== null && Number(s.end_ms) < Number(s.start_ms)) return fail('bot_stage_invalid');
    // null/blank/labels are not the model's speaker zero.
    const speaker = typeof s.speaker_raw === 'string' && /^\d{1,6}$/.test(s.speaker_raw) ? Number(s.speaker_raw) : null;
    return { chunk: seq, participant_key: participant, text: s.text, speaker,
      start_ms: s.start_ms === null ? null : Number(s.start_ms) + start,
      end_ms: s.end_ms === null ? null : Number(s.end_ms) + start };
  });
}

export async function botAssemblyInputs(env: Env, uid: string) {
  const run = await botRow(env, uid);
  if (!run || !(['processing', 'stopped'].includes(run.status) || run.status === 'failed' && ['processing_failed','processing_timeout'].includes(run.failure_code ?? ''))
    || run.started_at === null || run.ended_at === null) return fail('bot_not_ready');
  const session = await botSession(env, run);
  const { scoped } = await writableSession(env,run.user_id,session.id);
  if (['access_revoked','session_deleted'].includes(run.failure_code ?? '') || Number(scoped.member.jwt_min_iat ?? 0)*1000 > run.created_at) return fail('bot_authority_revoked');
  if (session.submitted_via !== 'meeting_bot' || (await sessionBot(env, session.id, run.user_id))?.uid !== uid) return fail('bot_run_mismatch');
  let projection = botSnapshotEvents([],run.limit_minutes*60000);
  let last = -1, count = 0;
  for (;;) {
    const encrypted = await env.DB.prepare('SELECT seq, kind, payload_enc FROM meeting_bot_events WHERE run_uid = ? AND seq > ? ORDER BY seq LIMIT 100')
      .bind(uid,last).all<{ seq: number; kind: string; payload_enc: string }>();
    const page = encrypted.results ?? [];
    count += page.length;
    if (count > 20000) return fail('bot_manifest_limit');
    const rows: Array<{ kind: string; payload: unknown }> = [];
    for (const event of page) {
      last = event.seq;
      if (!['roster', 'speaker', 'chunk'].includes(event.kind)) continue;
      rows.push({ kind: event.kind, payload: decode(await decryptColumn(env, 'meeting_bot_events', 'payload_enc', `${uid}:${event.seq}`, event.payload_enc)) });
    }
    projection = botSnapshotEvents(rows,run.limit_minutes*60000,projection.state);
    if (page.length < 100) break;
  }
  const { events, manifests } = projection;
  const chunks = await listChunks(env, session.id);
  if (!chunks.length || chunks.length !== manifests.size) return fail('bot_audio_incomplete');
  for (const [index, chunk] of chunks.entries()) {
    const manifest = manifests.get(chunk.seq);
    if (chunk.seq !== index || !chunk.r2_key.startsWith(AUDIO_PREFIX) || !manifest || manifest.size !== chunk.size_bytes || manifest.start !== chunk.start_ms) return fail('bot_audio_incomplete');
  }
  return { run, session, events, manifests, chunks };
}

export async function prepareBotAssembly(env: Env, uid: string) {
  const { run, session, events, manifests, chunks } = await botAssemblyInputs(env, uid);
  const staged = await env.DB.prepare('SELECT seq, model, language, segments_json, cost_microusd, fallback_used FROM interview_chunk_transcripts WHERE session_id = ? ORDER BY seq')
    .bind(session.id).all<{ seq: number; model: string; language: string | null; segments_json: string; cost_microusd: number; fallback_used: number }>();
  const bySeq = new Map((staged.results ?? []).map(row => [row.seq, row]));
  if (bySeq.size !== chunks.length) return fail('bot_transcript_incomplete');
  const passages: BotPassage[] = [];
  let endMs = 0, costMicro = 0, audioMinutes = 0;
  let language: string | null = null;
  let fallback = false, model = NOVA_3;
  for (const [index, chunk] of chunks.entries()) {
    const manifest = manifests.get(chunk.seq), stage = bySeq.get(chunk.seq);
    if (chunk.seq !== index || !chunk.r2_key.startsWith(AUDIO_PREFIX) || !manifest || !stage || manifest.size !== chunk.size_bytes || manifest.start !== chunk.start_ms) return fail('bot_audio_incomplete');
    const duration = (manifest.size - WAV_HEADER_BYTES) / UPLOAD_BYTES_PER_SECOND * 1000;
    if (manifest.start + duration > run.limit_minutes * 60000) return fail('bot_manifest_invalid');
    passages.push(...botStagedPassages(decode(stage.segments_json), chunk.seq, manifest.start, duration, manifest.participant));
    endMs = Math.max(endMs, manifest.start + duration);
    audioMinutes += duration / 60000;
    if (!integer(stage.cost_microusd, Number.MAX_SAFE_INTEGER)) return fail('bot_stage_invalid');
    costMicro += stage.cost_microusd;
    language ||= stage.language;
    if (stage.fallback_used) { fallback = true; model = stage.model; }
  }
  const founder = await env.DB.prepare('SELECT name, display_name FROM users WHERE id = ?').bind(run.user_id).first<{ name: string; display_name: string | null }>();
  const assembled = assembleBotTranscript(passages, events, { founderName: founder?.display_name?.trim() || founder?.name, endMs });
  const segments: StoredSegment[] = assembled.passages.map(p => ({ start_ms: p.start_ms, end_ms: p.end_ms,
    text: p.text, speaker_label: p.speaker, speaker_raw: null }));
  // Recheck after decryption and reads: revoked/removed sessions cannot be prepared.
  await botSession(env, run);
  return { uid, session, segments, participants: assembled.participants, stats: assembled.stats,
    model, language, costMicro, audioMinutes, fallback };
}

/** Queue the existing recorder job only after the complete manifest is stored. */
export async function queueBotAssembly(env: Env, uid: string) {
  const { run, session, chunks } = await botAssemblyInputs(env, uid);
  if (session.processing_stage === 'done' || session.processing_stage === 'failed') return;
  await env.DB.prepare(`UPDATE interview_sessions SET expected_last_seq = ?, final_model = ?, processing_auto = COALESCE(processing_auto,0),
    processing_stage = 'uploading', processing_done = ?, processing_total = ?, processing_error = NULL, processing_updated_at = datetime('now')
    WHERE id = ? AND submitted_via = 'meeting_bot' AND consent_status = 'given' AND audio_removed_at IS NULL AND processing_stage IS NULL`)
    .bind(chunks.length-1,NOVA_3,chunks.length,chunks.length,session.id).run();
  await botSession(env, run);
  const { enqueueProcess } = await import('./interviewProcessing');
  await enqueueProcess(env,session.id,run.user_id,`bot_assembly:${uid}`);
}

/**
 * One atomic guarded final write, including the encrypted participants and
 * receipt. The new ciphertext is a transaction marker: if the first guarded
 * update loses permission, every following statement is a no-op as well.
 */
export async function commitBotAssembly(env: Env, prepared: Awaited<ReturnType<typeof prepareBotAssembly>>) {
  const { uid, session } = prepared;
  const run = await botRow(env, uid);
  if (!run) return fail('bot_not_ready');
  await botSession(env, run);
  const { scoped } = await writableSession(env,run.user_id,session.id);
  if (run.participants_enc) return false; // A retry never duplicates final rows or receipts.
  const participants = prepared.participants.map(p=>({ name:p.name, joined_ms:p.joined_at_ms, left_ms:p.left_at_ms }));
  const encrypted = await encryptColumn(env,'meeting_bots','participants_enc',uid,JSON.stringify(participants));
  const results = await env.DB.batch([
    env.DB.prepare(`UPDATE meeting_bots SET participants_enc = ? WHERE uid = ? AND user_id = ? AND session_id = ? AND participants_enc IS NULL
      AND (status IN ('processing','stopped') OR status = 'failed' AND failure_code IN ('processing_failed','processing_timeout'))
      AND COALESCE(failure_code,'') NOT IN ('access_revoked','session_deleted')
      AND EXISTS (SELECT 1 FROM interview_sessions s JOIN users u ON u.id = s.created_by_user_id JOIN projects p ON p.id = s.project_id
        WHERE s.id = meeting_bots.session_id AND s.interview_id = ? AND s.project_id = ?
        AND s.submitted_via = 'meeting_bot' AND s.consent_status = 'given' AND s.audio_removed_at IS NULL
        AND u.is_active != 0 AND u.deletion_requested_at IS NULL AND u.role = ? AND u.founder_id IS ? AND u.jwt_min_iat IS ?
        AND p.deleted_at IS NULL AND p.founder_id IS ?)`)
      .bind(encrypted,uid,run.user_id,session.id,session.interview_id,run.project_id,scoped.member.role,scoped.member.founder_id,scoped.member.jwt_min_iat,scoped.project.founder_id),
    env.DB.prepare('DELETE FROM interview_transcript_segments WHERE session_id = ? AND EXISTS (SELECT 1 FROM meeting_bots WHERE uid = ? AND participants_enc = ?)')
      .bind(session.id,uid,encrypted),
    ...prepared.segments.map(s=>env.DB.prepare(`INSERT INTO interview_transcript_segments(session_id,source,start_ms,end_ms,speaker_label,speaker_raw,text,model)
      SELECT ?, 'final', ?, ?, ?, NULL, ?, ? WHERE EXISTS (SELECT 1 FROM meeting_bots WHERE uid = ? AND participants_enc = ?)`)
      .bind(session.id,s.start_ms,s.end_ms,s.speaker_label,s.text,prepared.model,uid,encrypted)),
    env.DB.prepare(`UPDATE interview_sessions SET status = 'transcribed', language = COALESCE(?,language), final_model = ?, updated_at = datetime('now')
      WHERE id = ? AND EXISTS (SELECT 1 FROM meeting_bots WHERE uid = ? AND participants_enc = ?)`)
      .bind(prepared.language,prepared.model,session.id,uid,encrypted),
    env.DB.prepare(`UPDATE discovery_interviews SET transcript = ?, transcribed_at = datetime('now'), transcribed_by_model = ?, updated_at = datetime('now')
      WHERE id = ? AND EXISTS (SELECT 1 FROM meeting_bots WHERE uid = ? AND participants_enc = ?)`)
      .bind(prepared.segments.map(s=>s.text).join('\n'),prepared.model,session.interview_id,uid,encrypted),
    env.DB.prepare(`INSERT INTO interview_session_receipts(session_id,kind,model,requested_model,fallback_used,audio_minutes,cost_microusd,outcome)
      SELECT ?, 'final', ?, ?, ?, ?, ?, 'ok' WHERE EXISTS (SELECT 1 FROM meeting_bots WHERE uid = ? AND participants_enc = ?)`)
      .bind(session.id,prepared.model,NOVA_3,prepared.fallback?1:0,prepared.audioMinutes,prepared.costMicro,uid,encrypted),
  ]);
  if (!results[0]?.meta?.changes) {
    await botSession(env, run);
    if ((await botRow(env,uid))?.participants_enc) return false;
    return fail('bot_assembly_revoked');
  }
  return true;
}

/** Keep completed D872 chunks reusable while refusing late writes after revocation. */
export async function stageBotChunk(env: Env, uid: string, seq: number, result: {
  model: string; language: string | null; segments: StoredSegment[]; costMicro: number; fallback: boolean;
}) {
  const run = await botRow(env,uid);
  if (!run) return fail('bot_not_ready');
  const session = await botSession(env,run);
  const { scoped } = await writableSession(env,run.user_id,session.id);
  const written = await env.DB.prepare(`INSERT OR IGNORE INTO interview_chunk_transcripts(session_id,seq,model,language,segments_json,cost_microusd,fallback_used)
    SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM interview_sessions s JOIN users u ON u.id = s.created_by_user_id JOIN projects p ON p.id = s.project_id
      WHERE s.id = ? AND s.created_by_user_id = ? AND s.project_id = ? AND s.interview_id = ?
      AND s.submitted_via = 'meeting_bot' AND s.consent_status = 'given' AND s.audio_removed_at IS NULL
      AND u.is_active != 0 AND u.deletion_requested_at IS NULL AND u.role = ? AND u.founder_id IS ? AND u.jwt_min_iat IS ?
      AND p.deleted_at IS NULL AND p.founder_id IS ?)`)
    .bind(session.id,seq,result.model,result.language,JSON.stringify(result.segments),result.costMicro,result.fallback?1:0,
      session.id,run.user_id,session.project_id,session.interview_id,scoped.member.role,scoped.member.founder_id,scoped.member.jwt_min_iat,scoped.project.founder_id).run();
  await botSession(env,run);
  if (!written.meta.changes && !await env.DB.prepare('SELECT seq FROM interview_chunk_transcripts WHERE session_id = ? AND seq = ?').bind(session.id,seq).first()) return fail('bot_assembly_revoked');
}

/** B7 may prefer these final labels over the current roster once assembled. */
export async function readBotFinalParticipants(env: Env, uid: string, userId: number) {
  const run = await botRow(env,uid);
  if (!run || run.user_id !== userId) return fail('bot_not_found');
  const { session } = await writableSession(env,userId,run.session_id);
  if (session.created_by_user_id !== userId || session.project_id !== run.project_id) return fail('bot_not_found');
  if (!run.participants_enc) return { participants: null };
  const parsed = decode(await decryptColumn(env,'meeting_bots','participants_enc',uid,run.participants_enc));
  if (!Array.isArray(parsed) || parsed.length > 500) return fail('bot_assembly_unreadable');
  return { participants: parsed.map(p=>{
    if (!object(p) || typeof p.name !== 'string' || !p.name.trim() || p.name.includes('@') || !integer(p.joined_ms,run.limit_minutes*60000)
      || p.left_ms !== null && (!integer(p.left_ms,run.limit_minutes*60000) || p.left_ms < p.joined_ms)) return fail('bot_assembly_unreadable');
    return { display_name:p.name, joined_ms:p.joined_ms, left_ms:p.left_ms };
  }) };
}
