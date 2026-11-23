/**
 * D5585 part 2 (#5585, WorkGraph P1 under the #5577 epic) — the handlers that deliver a release's queued `release_*`
 * outbox effects (GitHub PR, Stream, signed document, website/CDN, external distribution) and the `release_retract`
 * effects a takedown queues, through #5581's outbox (`deliverEffect` / `drainEffects` in `workGraphEffects.ts`).
 * Preview-only: no adapter talks to a real provider here, nothing schedules a drain, and no route reaches it.
 * Decision: `documentation/architecture/decisions/D5585-p2.md`.
 *
 * ADAPTERS, NOT PROVIDERS. Each target is an injected `ReleaseDeliveryAdapter` with two calls, both keyed on the
 * effect's idempotency key: `lookup` (what the provider already holds under that key) and `send`. A later part wires
 * real adapters; tests use fakes.
 *
 * WHAT A HANDLER CHECKS, EVERY ATTEMPT, BEFORE ANY PROVIDER CALL (a publish):
 *   - the manifest exists, in the effect's own tenant and company, on the effect's line (`unknown_reference`,
 *     `wrong_tenant`): a forged or misrouted effect cannot publish another tenant's release;
 *   - the manifest's digest is the effect's (`stale_digest`);
 *   - the line's publication pointer still names this manifest (`superseded`): a late effect of an older release
 *     never overwrites a newer one at the provider;
 *   - the effect's audience is the line's (`audience_forbidden`);
 *   - no takedown covers the manifest or a component it pins (`taken_down`), and no pinned revision is tombstoned.
 * Any of these consumes the effect with a `withheld` or `superseded` delivery row and calls no provider.
 *
 * AMBIGUOUS DELIVERY IS RECONCILED, NEVER REPEATED. A provider may accept a send and the response be lost (a timeout,
 * a dead worker). So each attempt asks `lookup` first: `confirmed` records the delivery without sending again
 * (`reconciled = 1`); `accepted` (taken, not yet confirmed) retries later through the outbox's backoff without
 * sending; only `absent` sends. Provider acceptance and confirmed delivery are separate outcomes (D5458): only a
 * confirmed one is recorded as delivered. An adapter error is retried and, after the outbox's attempts, dead-lettered.
 *
 * A TAKEDOWN THAT RACES A SEND. The delivery row commits in the effect's `applied` batch together with a
 * `release_retract` effect that is inserted only if a takedown covering the manifest exists by then. A takedown
 * committed first is seen by that guard; one committed after sees the confirmed delivery row and queues the retraction
 * itself. Either way content delivered as a takedown landed is retracted.
 *
 * COST. Each delivery row carries the D1 statements the handler issued and the provider calls it made; the outbox's
 * own audit row carries the delivery's statements (D5581 part 3).
 */
import type { Env } from '../types';
import { sha256Hex } from './workGraphContracts';
import { WORK_GRAPH_DEPS } from './workGraphRevisions';
import { WORK_GRAPH_EFFECT_LIMITS, type EffectContext, type EffectHandler } from './workGraphEffects';
import {
  EFFECT_TARGETS, Meter, canonical, readComponents, readLine, readManifest, takedownsCovering,
  type Audience, type EffectTarget, type ManifestBody,
} from './workGraphReleases';

export const RELEASE_RETRACT_KIND = 'release_retract';

export interface ReleaseDeliveryRequest {
  op: 'publish' | 'retract';
  /** The outbox effect's key: the provider must make its write conditional on it. */
  idempotencyKey: string;
  target: EffectTarget;
  /** The effect's own tenant and company (part 6): the handler has checked the manifest is theirs before any call. */
  tenantId: number;
  companyId: number;
  /** The target's own id (`owner/repo#12`, a Stream uid, an envelope, a site, a channel). */
  ref: string;
  lineAssetUid: string;
  manifestUid: string;
  digest: string;
  audience: Audience | null;
  /** What to deliver: each pinned piece by revision, digest and source. Ids only; empty for a retraction. */
  components: ReadonlyArray<{ asset: string; revision: string; digest: string; role: string; source: ManifestBody['components'][number]['source'] }>;
}
/** `absent`: the provider holds nothing under the key; `accepted`: taken, not yet confirmed; `confirmed`: done. */
export interface ReleaseDeliveryReceipt { status: 'absent' | 'accepted' | 'confirmed'; externalRef?: string | null }
export interface ReleaseDeliveryAdapter {
  lookup(req: ReleaseDeliveryRequest): Promise<ReleaseDeliveryReceipt>;
  send(req: ReleaseDeliveryRequest): Promise<ReleaseDeliveryReceipt>;
}
export type ReleaseAdapters = Readonly<Partial<Record<EffectTarget, ReleaseDeliveryAdapter>>>;

const REF = /^[A-Za-z0-9][A-Za-z0-9_.:/#@-]{0,119}$/;
const EXTERNAL = /^[A-Za-z0-9][A-Za-z0-9_.:/#@=?&-]{0,199}$/;
const HEX64 = /^[0-9a-f]{64}$/;

/** An error the outbox records by its code and retries (D5581 part 3: `[a-z_]` codes). */
export class DeliveryRetry extends Error {
  code: string;
  constructor(code: string) { super(code); this.code = code; }
}

/** The retraction effect of one confirmed delivery: one per (manifest, target, ref), whoever queues it. */
export async function retractEffect(d: { manifest: string; digest: string; line: string; target: string; ref: string }) {
  const payload = { op: 'retract', manifest: d.manifest, digest: d.digest, line: d.line, target: d.target, ref: d.ref };
  const key = `release-retract:${d.manifest}:${d.target}:${d.ref}`;
  const hash = await sha256Hex(new TextEncoder().encode(canonical({ kind: RELEASE_RETRACT_KIND, asset: d.line, payload })));
  return { kind: RELEASE_RETRACT_KIND, key, payload, hash };
}

function receiptOf(r: unknown): ReleaseDeliveryReceipt {
  const x = r as ReleaseDeliveryReceipt | null;
  if (!x || !['absent', 'accepted', 'confirmed'].includes(x.status)) throw new DeliveryRetry('malformed_receipt');
  if (x.externalRef != null && (typeof x.externalRef !== 'string' || !EXTERNAL.test(x.externalRef))) throw new DeliveryRetry('malformed_receipt');
  return { status: x.status, externalRef: x.externalRef ?? null };
}

type Outcome = 'confirmed' | 'withheld' | 'superseded' | 'retracted' | 'nothing_to_retract';

async function handle(effect: EffectContext, env: Pick<Env, 'DB'>, adapters: ReleaseAdapters, op: 'publish' | 'retract'): Promise<D1PreparedStatement[]> {
  const m = new Meter(env);
  const p = effect.payload;
  const target = String(p.target) as EffectTarget;
  const manifest = String(p.manifest);
  const digest = String(p.digest);
  const line = String(p.line);
  const ref = String(p.ref);
  if (!(EFFECT_TARGETS as readonly string[]).includes(target) || !REF.test(ref) || !HEX64.test(digest)
    || !manifest || manifest.length > 80 || !line || line.length > 80
    || (op === 'publish' && effect.kind !== `release_${target}`) || (op === 'retract' && p.op !== 'retract')) {
    throw new DeliveryRetry('malformed_payload');
  }
  const { tenantId, companyId } = effect.scope;
  let calls = 0;
  const at = WORK_GRAPH_DEPS.now().toISOString();

  const record = async (outcome: Outcome, extra: { reason?: string; externalRef?: string | null; reconciled?: boolean } = {}): Promise<D1PreparedStatement[]> => {
    const raceGuard = op === 'publish' && outcome === 'confirmed' ? await retractEffect({ manifest, digest, line, target, ref }) : null;
    const stmts = [
      env.DB.prepare(
        `INSERT INTO work_graph_release_deliveries (effect_id, tenant_id, company_id, line_asset_uid, manifest_uid, manifest_digest,
           op, target, target_ref, outcome, reason_code, external_ref, reconciled, attempt, d1_statements, provider_calls, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (effect_id) DO NOTHING`,
      ).bind(effect.id, tenantId, companyId, line, manifest, digest, op, target, ref, outcome, extra.reason ?? null,
        extra.externalRef ?? null, extra.reconciled ? 1 : 0, effect.attempt, m.cost.d1Statements + (raceGuard ? 3 : 1), calls, at),
    ];
    if (raceGuard) {
      // A takedown that committed while this send was in flight: queue the retraction in the same batch.
      stmts.push(
        env.DB.prepare(
          `INSERT INTO work_graph_effects (tenant_id, company_id, asset_uid, effect_kind, idempotency_key, request_hash, payload_json,
             max_attempts, next_attempt_ms, created_at)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            WHERE EXISTS (SELECT 1 FROM work_graph_release_takedowns t
                           WHERE t.tenant_id = ? AND t.company_id = ? AND t.outcome = 'applied'
                             AND ((t.scope = 'manifest' AND t.manifest_uid = ?)
                               OR (t.scope = 'component' AND t.revision_uid IN (
                                     SELECT e.to_revision_uid FROM work_graph_edges e
                                      WHERE e.from_revision_uid = ? AND e.edge_kind = 'component'))))
           ON CONFLICT (tenant_id, company_id, idempotency_key) DO NOTHING`,
        ).bind(tenantId, companyId, line, raceGuard.kind, raceGuard.key, raceGuard.hash, canonical(raceGuard.payload),
          WORK_GRAPH_EFFECT_LIMITS.maxAttempts, WORK_GRAPH_DEPS.now().getTime(), at, tenantId, companyId, manifest, manifest),
        env.DB.prepare(
          `INSERT INTO work_graph_integrity_events (tenant_id, company_id, asset_uid, revision_uid, digest, effect_id, action, outcome,
             actor_kind, detail_json, created_at)
           SELECT ?, ?, ?, ?, ?, f.id, 'effect_enqueued', 'applied', 'system', ?, ?
             FROM work_graph_effects f WHERE f.tenant_id = ? AND f.company_id = ? AND f.idempotency_key = ? AND changes() > 0`,
        ).bind(tenantId, companyId, line, manifest, digest, JSON.stringify({ release: true, retract: target, cause: 'takedown_race' }), at,
          tenantId, companyId, raceGuard.key),
      );
    }
    return stmts;
  };

  const man = await readManifest(env, m, manifest);
  if (!man) return record('withheld', { reason: 'unknown_reference' });
  if (man.tenant_id !== tenantId || man.company_id !== companyId || man.line_asset_uid !== line) return record('withheld', { reason: 'wrong_tenant' });
  if (man.manifest_digest !== digest) return record('withheld', { reason: 'stale_digest' });
  const body = JSON.parse(man.body_json) as ManifestBody;

  if (op === 'publish') {
    const ln = await readLine(env, m, line);
    if (!ln || ln.head_revision_uid !== manifest) return record('superseded', { reason: 'not_head' });
    if (p.audience !== ln.audience) return record('withheld', { reason: 'audience_forbidden' });
    if ((await takedownsCovering(env, m, tenantId, companyId, manifest)).length) return record('withheld', { reason: 'taken_down' });
    const rows = await readComponents(env, m, body.components.map((c) => c.revision));
    if (body.components.some((c) => rows.get(c.revision)?.tombstoned_at !== null)) return record('withheld', { reason: 'tombstoned' });
  }

  const adapter = adapters[target];
  if (!adapter) throw new DeliveryRetry('no_adapter');
  const req: ReleaseDeliveryRequest = {
    op, idempotencyKey: effect.idempotencyKey, target, tenantId, companyId, ref, lineAssetUid: line, manifestUid: manifest, digest,
    audience: op === 'publish' ? man.audience : null,
    components: op === 'publish' ? body.components.map((c) => ({ asset: c.asset, revision: c.revision, digest: c.digest, role: c.role, source: c.source })) : [],
  };
  const done: Outcome = op === 'publish' ? 'confirmed' : 'retracted';

  // Reconcile first: a provider that already holds this key is never sent to again.
  calls++;
  const found = receiptOf(await adapter.lookup(req));
  if (found.status === 'confirmed') return record(done, { externalRef: found.externalRef, reconciled: true });
  if (found.status === 'accepted') throw new DeliveryRetry('awaiting_confirmation');

  calls++;
  const sent = receiptOf(await adapter.send(req));
  if (sent.status === 'confirmed') return record(done, { externalRef: sent.externalRef });
  if (sent.status === 'accepted') throw new DeliveryRetry('awaiting_confirmation');
  if (op === 'retract') return record('nothing_to_retract');
  throw new DeliveryRetry('provider_rejected');
}

/**
 * The handlers for every `release_<target>` effect and for `release_retract`, over the given adapters. Merge them into
 * the one map a drain is given (`drainEffects` fails an effect whose kind has no handler). Not scheduled anywhere yet.
 */
export function releaseEffectHandlers(adapters: ReleaseAdapters): Record<string, EffectHandler> {
  const map: Record<string, EffectHandler> = {};
  for (const t of EFFECT_TARGETS) map[`release_${t}`] = (e, env) => handle(e, env, adapters, 'publish');
  map[RELEASE_RETRACT_KIND] = (e, env) => handle(e, env, adapters, 'retract');
  return map;
}
