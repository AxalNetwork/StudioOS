/** D5673: redacted Cloudflare source receipts for the existing #5664/#5665 event/delivery boundary; never sends Slack. */
import { z } from 'zod';
export const CF_SCRIPTS = ['studioos', 'studioos-meeting-bot', 'studioos-meeting-bot-preview', 'studioos-tail'] as const;
export type CfScript = typeof CF_SCRIPTS[number];
const uuid = z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
const ms = z.number().int().nonnegative().max(8640000000000000);
export const cfReceiptSchema = z.object({
  version: z.literal(1), id: z.string().regex(/^[a-f0-9]{64}$/), script: z.enum(CF_SCRIPTS),
  audience: z.enum(['prod','preview']), family: z.enum(['deployment','recording','preview','archive']),
  component: z.enum(['release','startup','callback','admission','notice','capture','upload','processing','recording','archive','canary','coverage','retention']),
  state: z.enum(['observed','firing','recovered','unknown','activity','disabled']),
  code: z.enum(['version_uploaded','traffic_changed','rollback','unattributed','provider_unavailable','history_gap','not_verified',
    'idle','startup_failed','callback_missing','provider_denied','capture_stalled','upload_failed','processing_failed','success','cancelled','disabled',
    'prerequisite_missing','canary_failed','signature_rejected','write_failed','marker_missing','policy_drift','telemetry_unavailable','write_verified']),
  occurred_ms: ms, observed_ms: ms, count: z.number().int().nonnegative(), denominator: z.number().int().nonnegative().nullable(),
  window_start_ms: ms, window_end_ms: ms,
  versions: z.array(z.object({ id: uuid, weight: z.number().finite().min(0).max(100).nullable() }).strict()).max(10),
  provider: z.enum(['none','zoom','google_meet','teams']).default('none'),
  source: z.enum(['wrangler','api','dashboard','rollback','unknown']),
  github: z.object({ run_id: z.number().int().positive(), attempt: z.number().int().positive(), sha: z.string().regex(/^[a-f0-9]{40}$/),
    rollout_key: z.string().regex(/^[A-Za-z0-9_.:-]{1,120}$/) }).strict().nullable(),
  revision: z.string().regex(/^[a-f0-9]{7,40}$/).nullable(),
  episode_key: z.string().regex(/^[a-f0-9]{64}$/),
  owner: z.enum(['release_engineering','meeting_oncall','preview_owner','storage_oncall']),
}).strict();
export type CfReceipt = z.infer<typeof cfReceiptSchema>;
export const cfAudience = (script: CfScript) => script === 'studioos-meeting-bot-preview' ? 'preview' as const : 'prod' as const;
export async function cfHash(value: unknown): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export function parseCfReceipt(value: unknown): CfReceipt {
  const r=cfReceiptSchema.parse(value);
  if (r.audience !== cfAudience(r.script) || r.window_start_ms > r.window_end_ms || r.occurred_ms > r.observed_ms + 60000
    || (r.denominator !== null && r.count > r.denominator) || new Set(r.versions.map(v=>v.id)).size !== r.versions.length) throw Error('invalid_cf_receipt');
  return r;
}
export function cfRoute(r: CfReceipt) {
  r=parseCfReceipt(r);
  const destination=r.audience==='preview'?'preview':r.family==='deployment' && r.state==='observed' && r.github && r.code!=='version_uploaded'?'release':r.state==='firing'||r.state==='recovered'?'health':'activity';
  return { destination, labels: `[cf][${r.audience}][${r.script}][${r.component}][${r.state}]`,
    // #5667 alone creates a production rollout thread. An unattributed deployment never borrows a previous SHA's thread.
    subject: r.family==='deployment' ? (r.github?.rollout_key || r.episode_key) : r.episode_key,
    owner:r.owner, drilldown:'/hq/platform', receipt:r };
}
export type SourceCursor = { revision: number; through_ms: number; active_id: string | null; active_versions: string[] };
export interface CfSourceStore {
  read(key: string): Promise<SourceCursor>;
  commit(key: string, expected: number, next: Omit<SourceCursor,'revision'>, receipts: CfReceipt[]): Promise<boolean>;
}
/** The existing sender owns Slack roots/outbox/retries/receipts. Acceptance here means durable enqueue, never Slack delivery. */
export interface CfDeliveryPort { enqueue(receipt: ReturnType<typeof cfRoute>): Promise<{ durable: boolean }> }
export async function forwardCfReceipt(port: CfDeliveryPort, receipt: CfReceipt): Promise<void> {
  if ((await port.enqueue(cfRoute(receipt))).durable !== true) throw Error('cf_delivery_not_durable');
}
