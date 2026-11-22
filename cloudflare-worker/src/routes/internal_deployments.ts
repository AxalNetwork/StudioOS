/**
 * D8073 (#8073): the deploy provenance record. Mounted at /api/internal.
 *
 *   POST /deployments   the production deploy job records the deploy it just
 *                       shipped: commit sha, Actions run id, Worker version id,
 *                       the build-provenance attestation URL and its clocks.
 *                       No member session: the caller sends
 *                       `Authorization: Bearer <DEPLOY_RECORD_TOKEN>`, compared
 *                       in constant time. The token is held only by the
 *                       production deploy environment. With the secret unset
 *                       the route refuses (503), so nothing is accepted until
 *                       it is set.
 *
 * One row per (run_id, worker_version_id): a re-post of the same deploy
 * answers the row already there (`created: false`), and a re-post that
 * disagrees with it is refused (409). Nothing here deploys, rolls back or
 * reads a row to decide anything; it is the record, not the mechanism.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { refuse } from '../util/refusal';
import { constantTimeEqual } from '../rpc/secret';

export const MAX_BYTES = 4096;
export const ATTESTATION_PREFIX = 'https://github.com/AxalNetwork/StudioOS/attestations/';

const SHA_RE = /^[0-9a-f]{40}$/;
const RUN_ID_RE = /^[0-9]{1,20}$/;
// A Cloudflare Worker version id is a UUID; anything else is refused rather
// than stored as provenance nobody can look up.
const VERSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ATTESTATION_RE = /^https:\/\/github\.com\/AxalNetwork\/StudioOS\/attestations\/[0-9]{1,20}$/;
const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

export type DeploymentInput = {
  sha: string;
  run_id: string;
  worker_version_id: string;
  attestation_url: string | null;
  built_at: string | null;
  deployed_at: string;
  rollback_of: number | null;
};

type Invalid = { ok: false; code: string; message: string };

function isoOrNull(v: unknown): string | null | undefined {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || !ISO_UTC_RE.test(v) || Number.isNaN(Date.parse(v))) return undefined;
  return v;
}

/** Validate a record body. Pure, so the script's pure half can share the rules by test. */
export function parseDeployment(body: unknown): { ok: true; value: DeploymentInput } | Invalid {
  const bad = (field: string, what: string): Invalid => ({ ok: false, code: 'deployment_invalid', message: `\`${field}\` ${what}.` });
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, code: 'deployment_invalid', message: 'The body is not a JSON object.' };
  const b = body as Record<string, unknown>;
  const sha = typeof b.sha === 'string' ? b.sha.toLowerCase() : '';
  if (!SHA_RE.test(sha)) return bad('sha', 'is not a 40-character commit sha');
  const runId = typeof b.run_id === 'number' && Number.isSafeInteger(b.run_id) ? String(b.run_id) : b.run_id;
  if (typeof runId !== 'string' || !RUN_ID_RE.test(runId)) return bad('run_id', 'is not an Actions run id');
  const versionId = typeof b.worker_version_id === 'string' ? b.worker_version_id.toLowerCase() : '';
  if (!VERSION_ID_RE.test(versionId)) return bad('worker_version_id', 'is not a Worker version id');
  let attestation: string | null = null;
  if (b.attestation_url !== undefined && b.attestation_url !== null && b.attestation_url !== '') {
    if (typeof b.attestation_url !== 'string' || !ATTESTATION_RE.test(b.attestation_url)) {
      return bad('attestation_url', `is not an attestation of this repository (${ATTESTATION_PREFIX}<id>)`);
    }
    attestation = b.attestation_url;
  }
  const builtAt = isoOrNull(b.built_at);
  if (builtAt === undefined) return bad('built_at', 'is not an ISO 8601 UTC time');
  const deployedAt = isoOrNull(b.deployed_at);
  if (!deployedAt) return bad('deployed_at', 'is not an ISO 8601 UTC time');
  let rollbackOf: number | null = null;
  if (b.rollback_of !== undefined && b.rollback_of !== null) {
    if (typeof b.rollback_of !== 'number' || !Number.isSafeInteger(b.rollback_of) || b.rollback_of < 1) {
      return bad('rollback_of', 'is not a deployment id');
    }
    rollbackOf = b.rollback_of;
  }
  return { ok: true, value: { sha, run_id: runId, worker_version_id: versionId, attestation_url: attestation, built_at: builtAt, deployed_at: deployedAt, rollback_of: rollbackOf } };
}

type Row = DeploymentInput & { id: number; recorded_at: string };
const SAME_FIELDS = ['sha', 'attestation_url', 'built_at', 'deployed_at', 'rollback_of'] as const;

const r = new Hono<{ Bindings: Env }>();

r.post('/deployments', async (c) => {
  const secret = c.env.DEPLOY_RECORD_TOKEN;
  if (!secret) {
    return refuse(c, 503, { code: 'deploy_record_not_configured', message: 'The deploy record is not configured on this deployment.' });
  }
  const header = c.req.header('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token || !constantTimeEqual(token, secret)) {
    return refuse(c, 401, { code: 'deploy_record_unauthorized', message: 'The deploy record token is missing or wrong.' });
  }
  const text = await c.req.text();
  if (new TextEncoder().encode(text).length > MAX_BYTES) {
    return refuse(c, 413, { code: 'deployment_too_large', message: `A deploy record is at most ${MAX_BYTES} bytes.` });
  }
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = null; }
  const parsed = parseDeployment(body);
  if (!parsed.ok) return refuse(c, 400, { code: parsed.code, message: parsed.message });
  const d = parsed.value;

  if (d.rollback_of !== null) {
    const target = await c.env.DB.prepare('SELECT id FROM deployments WHERE id = ?').bind(d.rollback_of).first<{ id: number }>();
    if (!target) return refuse(c, 422, { code: 'rollback_target_unknown', message: '`rollback_of` names no recorded deployment.' });
  }

  const ins = await c.env.DB.prepare(
    `INSERT INTO deployments (sha, run_id, worker_version_id, attestation_url, built_at, deployed_at, rollback_of)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(run_id, worker_version_id) DO NOTHING`,
  ).bind(d.sha, d.run_id, d.worker_version_id, d.attestation_url, d.built_at, d.deployed_at, d.rollback_of).run();
  const created = Number(ins.meta?.changes ?? 0) > 0;
  const row = await c.env.DB.prepare(
    `SELECT id, sha, run_id, worker_version_id, attestation_url, built_at, deployed_at, rollback_of, recorded_at
       FROM deployments WHERE run_id = ? AND worker_version_id = ?`,
  )
    .bind(d.run_id, d.worker_version_id).first<Row>();
  if (!row) return refuse(c, 500, { code: 'deploy_record_unreadable', message: 'The deploy record was not readable after it was written.' });
  if (!created) {
    const differs = SAME_FIELDS.filter((k) => (row[k] ?? null) !== (d[k] ?? null));
    if (differs.length > 0) {
      return refuse(c, 409, { code: 'deployment_conflict', message: `This run and version are already recorded with a different ${differs.join(', ')}.` });
    }
  }
  return c.json({ created, deployment: row }, created ? 201 : 200);
});

export default r;
export const mount: RouteMount = { path: '/api/internal', router: r };
