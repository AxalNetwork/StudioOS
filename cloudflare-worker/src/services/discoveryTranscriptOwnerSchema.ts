/**
 * D4626 (#4626) — the bootstrap for `discovery_interviews.transcript_session_uid`,
 * the session whose final transcript is projected onto its interview.
 *
 * The canonical declaration is migration
 * `202611062140_interview_transcript_projection_owner.sql`, which deploys apply
 * first. This narrow bootstrap keeps partial local fixtures and an interrupted
 * preview migration from turning transcription or deletion into an untracked
 * parent write. It asks the table first through `runSchemaBootstrap`
 * (`util/schemaBootstrap.ts`, #4568 R2-04), so an up-to-date database sees no
 * ALTER at all. Readiness is cached per binding, and only on success.
 */
import type { Env } from '../types';
import { bindingKey, runSchemaBootstrap } from '../util/schemaBootstrap';

const TRANSCRIPT_PROJECTION_OWNER_READY = new WeakMap<object, boolean>();

/** True once the owner column exists; false (uncached) when it cannot be made to. */
export async function ensureDiscoveryTranscriptProjectionOwnerColumn(env: Env): Promise<boolean> {
  const key = bindingKey(env);
  if (TRANSCRIPT_PROJECTION_OWNER_READY.get(key)) return true;
  try {
    await runSchemaBootstrap(env, [
      `ALTER TABLE discovery_interviews ADD COLUMN transcript_session_uid TEXT`,
    ]);
    TRANSCRIPT_PROJECTION_OWNER_READY.set(key, true);
    return true;
  } catch (e) {
    console.warn('[discoveryTranscriptOwnerSchema] transcript projection owner bootstrap failed', e);
    return false;
  }
}
