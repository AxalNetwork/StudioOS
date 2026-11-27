/** D4557 part 2: bounded general-compute host protocol; all grants use the canonical Workspace security module. */
import { z } from 'zod';
import { LIMITS, safeName, type Workload } from './compute';
import { trustedWorkspaceSpec, type WorkspaceSpec } from './workspaceSpec';
import type { GrantTarget, WorkspaceSponsor } from './workspaceSecurity';
import failureCodes from '../../../../agent-compute/failureCodes';

export const COMPUTE_INPUT_CAP = 8 * 1024 * 1024;
export const COMPUTE_BODY_CAP = 12 * 1024 * 1024;
export const COMPUTE_OPERATIONS = { python: ['sum', 'count'], document_convert: ['extract'], spreadsheet: ['extract', 'sum', 'count'] } as const;
export const computeUid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
export const computeOperations = (workload: Workload, operation: unknown): operation is string => typeof operation === 'string'
  && (COMPUTE_OPERATIONS[workload] as readonly string[]).includes(operation);
export type HostAdmission = { job_uid: string; spec: WorkspaceSpec; sponsor: WorkspaceSponsor };
export type ComputeInput = { name: string; bytes: number; ref: string };
export type HostManifest = { workload: Workload; operation: string; inputs: ComputeInput[] };
export type HostArtifact = { name: string; bytes: number; sha256: string; data: string };
export type HostResult = { outcome: 'succeeded' | 'failed' | 'timed_out'; failure_code: string | null; artifacts: HostArtifact[];
  cpu_ms: number | null; wall_ms: number | null; peak_rss_bytes: number | null; exit_code: number | null };
const number = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const resultSchema = z.object({ outcome: z.enum(['succeeded', 'failed', 'timed_out']), failure_code: z.string().refine(value => failureCodes.includes(value)).nullable(),
  artifacts: z.array(z.object({ name: z.string().refine(safeName), bytes: number.max(COMPUTE_INPUT_CAP),
    sha256: z.string().regex(/^[a-f0-9]{64}$/), data: z.string().max(COMPUTE_BODY_CAP) }).strict()).max(5),
  cpu_ms: number.nullable(), wall_ms: number.nullable(), peak_rss_bytes: number.nullable(), exit_code: z.number().int().min(-255).max(255).nullable(),
}).strict();

export function hostAdmission(raw: unknown): HostAdmission | null {
  const value = raw as HostAdmission | null;
  if (!value || !computeUid(value.job_uid)) return null;
  const spec = trustedWorkspaceSpec(value.spec);
  if (!spec.ok || spec.value.allowed_regions.length !== 1 || spec.value.allowed_regions[0] !== 'global'
    || !(spec.value.workload_class in COMPUTE_OPERATIONS) || spec.value.network_policy.mode !== 'deny'
    || spec.value.artifact_sink_ref !== value.job_uid
    || spec.value.idempotency_key !== value.job_uid
    || !spec.value.allowed_providers.includes('cloudflare') || spec.value.checkpoint_manifest_ref !== null) return null;
  const sponsor = value.sponsor;
  if (!sponsor || !Number.isSafeInteger(sponsor.member_id) || sponsor.member_id < 1 || sponsor.tenant_id !== spec.value.tenant_id
    || sponsor.company_id !== spec.value.company_id || sponsor.project_id !== spec.value.project_id) return null;
  return { job_uid: value.job_uid, spec: spec.value, sponsor: structuredClone(sponsor) };
}

/** Byte length and digest are checked independently of untrusted VM telemetry. */
export async function hostResult(raw: unknown, workload: Workload): Promise<HostResult | null> {
  const parsed = resultSchema.safeParse(raw); if (!parsed.success) return null;
  const result = parsed.data, limits = LIMITS[workload];
  if ((result.outcome === 'succeeded' && (result.exit_code !== 0 || result.failure_code !== null || !result.artifacts.length || result.cpu_ms === null || result.wall_ms === null || result.peak_rss_bytes === null))
    || (result.outcome !== 'succeeded' && result.artifacts.length) || result.artifacts.length > limits.max_artifacts
    || (result.peak_rss_bytes !== null && result.peak_rss_bytes > limits.memory_mb * 1024 * 1024)
    || (result.cpu_ms !== null && result.cpu_ms > limits.cpu_ms + 1000) || (result.wall_ms !== null && result.wall_ms > limits.wall_ms + 5000)) return null;
  let total = 0;
  const names = new Set<string>();
  for (const artifact of result.artifacts) {
    if (names.has(artifact.name) || !/^[A-Za-z0-9+/]*={0,2}$/.test(artifact.data)) return null;
    names.add(artifact.name);
    let decoded: Uint8Array;
    try { decoded = decodeComputeBase64(artifact.data); } catch { return null; }
    total += decoded.byteLength;
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', decoded))].map(v => v.toString(16).padStart(2, '0')).join('');
    if (decoded.byteLength !== artifact.bytes || digest !== artifact.sha256 || total > limits.max_output_bytes) return null;
  }
  return result;
}

/** Avoid the intermediate character array that Uint8Array.from(string) can allocate for multi-megabyte data. */
export function decodeComputeBase64(value: string): Uint8Array {
  const raw = atob(value), bytes = new Uint8Array(raw.length);
  for (let at = 0; at < raw.length; at++) bytes[at] = raw.charCodeAt(at);
  return bytes;
}

/** Reads a bounded stream even when Content-Length is missing or dishonest. */
export async function computeBody(response: Request | Response, cap: number): Promise<Uint8Array> {
  const claimed = response.headers.get('content-length');
  if (claimed !== null && (!/^\d+$/.test(claimed) || Number(claimed) > cap)) throw Error('compute_body_limit');
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > cap) throw Error('compute_body_limit');
      chunks.push(part.value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  const joined = new Uint8Array(size); let at = 0;
  for (const chunk of chunks) { joined.set(chunk, at); at += chunk.byteLength; }
  return joined;
}
export const computeTarget = (admission: HostAdmission, audience: GrantTarget['audience'], object_ref?: string, region?: string): GrantTarget => ({
  run_id: admission.spec.run_id, execution_generation: admission.spec.execution_generation, audience,
  ...(object_ref ? { object_ref, region } : {}),
});
