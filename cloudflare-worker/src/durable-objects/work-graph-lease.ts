/**
 * D5581 part 2 (#5581): `WorkGraphLease` — one Durable Object per tenant, company and asset (`leaseKey`, through
 * `idFromName`) that hands out short, renewable leases on the asset's units (`whole`, `section`, `segment`) with a
 * fencing token. Only `services/workGraphLeases.ts` reaches it. Kept apart from #5618's Merge Control (D5618), which
 * is its own Worker with its own lease; nothing here is shared with it.
 *
 * DURABLE. The whole state (the bound key, the last fence issued, the live leases) is read from storage on every
 * call and written back BEFORE the call answers, so an eviction, a crash or a deploy finds every outstanding lease
 * and the last fence: a restarted object never issues a fence lower than or equal to one it already issued. Calls
 * are applied one at a time (the storage input gate, and `serial` below), so two acquires never read the same state.
 *
 * EXPIRY. Checked lazily on every call, and by a storage alarm set to the earliest expiry. Leases the alarm expires
 * are kept in `expired` until the next call hands them to the service for the audit.
 *
 * REFUSED: while `WORK_GRAPH_LEASES` is not `on` (`flag_off`), and when the request's key is not the key this
 * object was bound to, or is not the key of the request's own tenant, company and asset (`wrong_tenant`).
 *
 * A lease grants NO edit authorization (D5581-p2.md §3).
 */
import type { Env } from '../types';
import {
  LEASE_STATE_KEY, changeLeases, expireLeases, leaseKey, leasesOn, readLeaseState, validAssetId, validScope,
  type LeaseOp, type LeaseReply, type LeaseState,
} from '../services/workGraphLeases';

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
const OPS = new Set(['acquire', 'renew', 'release', 'check']);

export class WorkGraphLease implements DurableObject {
  private state: DurableObjectState;
  private env: Env;
  /** Orders the read-modify-writes. It holds no lease state: storage is the authority. */
  private serial: Promise<unknown> = Promise.resolve();

  constructor(state: DurableObjectState, env: Env) { this.state = state; this.env = env; }

  private run<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.serial.then(fn);
    this.serial = p.catch(() => undefined);
    return p;
  }

  /** Set the alarm to the earliest live expiry, or clear it. Returns how many alarm writes it made. */
  private async schedule(s: LeaseState): Promise<number> {
    const storage: any = this.state.storage;
    if (typeof storage.setAlarm !== 'function') return 0;
    const next = s.leases.reduce((m, l) => Math.min(m, l.expiresAt), Infinity);
    if (Number.isFinite(next)) { await storage.setAlarm(next); return 1; }
    if (typeof storage.deleteAlarm === 'function') { await storage.deleteAlarm(); return 1; }
    return 0;
  }

  async fetch(req: Request): Promise<Response> {
    if (req.method !== 'POST' || new URL(req.url).pathname !== '/op') return json({ error: 'not_found' }, 404);
    let body: any;
    try { body = await req.json(); } catch { return json({ error: 'invalid_body' }, 400); }
    const cost = { storageReads: 0, storageWrites: 0, alarmWrites: 0 };
    const refused = (code: 'flag_off' | 'wrong_tenant' | 'invalid_request'): Response =>
      json({ outcome: { status: 'refused', code }, expired: [], cost } satisfies LeaseReply);

    if (!leasesOn(this.env)) return refused('flag_off');
    const op = body?.op as LeaseOp | undefined;
    if (!op || !OPS.has(op.op) || !validScope(body?.scope) || !validAssetId(body?.assetId) || typeof body?.key !== 'string') return refused('invalid_request');
    // The request's key must be its own tenant, company and asset's key, and the platform's name for this object.
    if (body.key !== leaseKey(body.scope, body.assetId)) return refused('wrong_tenant');
    const name = (this.state.id as any)?.name;
    if (typeof name === 'string' && name !== body.key) return refused('wrong_tenant');

    return this.run(async () => {
      const storage = this.state.storage;
      const prev = readLeaseState(await storage.get(LEASE_STATE_KEY));
      cost.storageReads += 1;
      // Bound on its first call: an object answers for one key, forever.
      if (prev.key !== null && prev.key !== body.key) return refused('wrong_tenant');
      const bound: LeaseState = prev.key === null ? { ...prev, key: body.key } : prev;
      const r = changeLeases(bound, op, Date.now());
      const handed = [...bound.expired, ...r.expired];
      const next: LeaseState = { ...r.state, expired: [] };
      if (r.changed || bound !== prev || bound.expired.length) {
        await storage.put(LEASE_STATE_KEY, next);
        cost.storageWrites += 1;
        cost.alarmWrites += await this.schedule(next);
      }
      return json({ outcome: r.outcome, expired: handed, cost } satisfies LeaseReply);
    });
  }

  /** The earliest lease ran out: move every expired lease to `expired` for the next call's audit, and re-arm. */
  async alarm(): Promise<void> {
    await this.run(async () => {
      const storage = this.state.storage;
      const prev = readLeaseState(await storage.get(LEASE_STATE_KEY));
      const { state, expired } = expireLeases(prev, Date.now());
      if (expired.length) await storage.put(LEASE_STATE_KEY, { ...state, expired: [...prev.expired, ...expired] });
      await this.schedule(state);
    });
  }
}
