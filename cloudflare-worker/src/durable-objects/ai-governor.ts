/**
 * D1502 part 2 (#3753, deck v2 A3a): `AiGovernor` — one Durable Object per
 * account that hands out the per-step slots of its deck generation runs
 * (`services/decks/aiGovernor.ts`: kind caps, two runs at once, a token bucket
 * per model). That state is in memory: leases expire on their own, so an
 * evicted governor starts empty and costs a step at most a short wait.
 * Only `governorFor` reaches it, under `account:<n>`.
 *
 * D5338 (#5338): the same class also holds the shared upstream lease of one AI
 * Gateway (`services/upstreamLease.ts`), under `upstream-lease:<slug>`, on the
 * `/upstream/*` paths. That state is DURABLE: it is read from and written to
 * this object's storage on every call, so an eviction, a restart or a deploy
 * finds every outstanding lease. Calls are applied one at a time (the storage
 * input gate, and `serial` below), so two admissions never read the same
 * state. Only `upstreamAdmission` reaches it.
 *
 * D9205 (#9205): the same class, in the same serial, durable way, holds the
 * minute cron's queue lease (`cron-lease:<lease>`, on `/cron-lease/*`) and
 * the counters of the fail-closed rate-limit buckets (`rate-counter:<key>`,
 * on `/counter/bump`), so neither is a KV read followed by a KV write any
 * more (`services/atomicLease.ts`). A counter's alarm clears it once its
 * window has ended.
 */
import type { Env } from '../types';
import { Governor, type AcquireInput } from '../services/decks/aiGovernor';
import {
  acquireUpstream, attemptUpstream, readUpstreamState, releaseUpstream, upstreamHeld,
  type Completion, type UpstreamState,
} from '../services/upstreamLease';
import {
  COUNTER_KEY, CRON_LEASE_KEY, CRON_LEASE_TTL_MS, bumpWindow, readCounter, readCronLease, releaseLease, takeLease,
} from '../services/atomicLease';

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
const UPSTREAM_KEY = 'upstream';
const COMPLETIONS: readonly Completion[] = ['done', 'none', 'unknown'];
const text = (v: unknown, max = 200) => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : null);

export class AiGovernor implements DurableObject {
  private governor = new Governor();
  /** Orders the upstream read-modify-writes. It holds no lease state: storage is the authority. */
  private serial: Promise<unknown> = Promise.resolve();
  private state: DurableObjectState;
  constructor(state: DurableObjectState, _env: Env) { this.state = state; }

  private upstream<T>(fn: (s: UpstreamState, now: number) => { state: UpstreamState; out: T }): Promise<T> {
    return this.serialized(UPSTREAM_KEY, readUpstreamState, fn);
  }

  /** One read-modify-write of `key`, after every earlier one has finished. A `null` state deletes the key. */
  private serialized<S, T>(key: string, read: (v: unknown) => S, fn: (s: S, now: number) => { state: S; out: T }, after?: (s: S) => Promise<void>): Promise<T> {
    const run = this.serial.then(async () => {
      const storage = this.state.storage;
      const { state, out } = fn(read(await storage.get(key)), Date.now());
      if (state === null) await storage.delete(key);
      else await storage.put(key, state);
      if (after) await after(state);
      return out;
    });
    this.serial = run.catch(() => undefined);
    return run;
  }

  /** D9205: the cron lease and the fail-closed counters (`services/atomicLease.ts`). */
  private async atomicFetch(path: string, body: any): Promise<Response> {
    if (!this.state?.storage) return json({ error: 'no_storage' }, 503);
    if (path === '/cron-lease/take' || path === '/cron-lease/release') {
      const holder = text(body?.holder, 400);
      if (!holder) return json({ error: 'invalid_body' }, 400);
      if (path === '/cron-lease/release') return json(await this.serialized(CRON_LEASE_KEY, readCronLease, (s) => releaseLease(s, holder)));
      const ttl = Number(body?.ttlMs);
      const ttlMs = Number.isSafeInteger(ttl) && ttl > 0 && ttl <= 15 * 60_000 ? ttl : CRON_LEASE_TTL_MS;
      return json(await this.serialized(CRON_LEASE_KEY, readCronLease, (s, now) => takeLease(s, holder, now, ttlMs)));
    }
    if (path === '/counter/bump') {
      const window = Number(body?.window); const windowSec = Number(body?.windowSec);
      if (!Number.isSafeInteger(window) || window < 0 || !Number.isSafeInteger(windowSec) || windowSec <= 0) return json({ error: 'invalid_body' }, 400);
      return json(await this.serialized(COUNTER_KEY, readCounter, (s) => bumpWindow(s, window, windowSec), async (s) => {
        const storage: any = this.state.storage;
        // The first count of a window sets the alarm that clears it; later counts leave it.
        if (s && s.count === 1 && typeof storage.setAlarm === 'function') await storage.setAlarm(s.endsAt + 1000);
      }));
    }
    return json({ error: 'not_found' }, 404);
  }

  /** D9205: a counter's window has ended, so its count can go. A newer window's count is kept. */
  async alarm(): Promise<void> {
    await this.serialized(COUNTER_KEY, readCounter, (s, now) => ({ state: s && s.endsAt <= now ? null : s, out: null }));
  }

  private async upstreamFetch(path: string, body: any): Promise<Response> {
    if (!this.state?.storage) return json({ error: 'no_storage' }, 503);
    if (path === '/upstream/acquire') {
      const execution = text(body?.execution); const tenant = text(body?.tenant, 80); const product = text(body?.product, 80); const model = text(body?.model, 120);
      if (!execution || !tenant || !product || !model) return json({ error: 'invalid_body' }, 400);
      const token = crypto.randomUUID();
      return json(await this.upstream((s, now) => {
        const r = acquireUpstream(s, { execution, tenant, product, model }, now, token);
        return { state: r.state, out: r.result };
      }));
    }
    const token = text(body?.token, 80);
    if (path === '/upstream/status') return json(await this.upstream((s, now) => ({ state: s, out: upstreamHeld(s, now) })));
    if (!token) return json({ error: 'invalid_body' }, 400);
    if (path === '/upstream/attempt') {
      return json(await this.upstream((s, now) => { const r = attemptUpstream(s, token, now); return { state: r.state, out: r.result }; }));
    }
    if (path === '/upstream/release') {
      const completion = COMPLETIONS.includes(body?.completion) ? body.completion as Completion : 'unknown';
      return json(await this.upstream((s, now) => { const r = releaseUpstream(s, token, completion, now); return { state: r.state, out: { released: r.released } }; }));
    }
    return json({ error: 'not_found' }, 404);
  }

  async fetch(req: Request): Promise<Response> {
    if (req.method !== 'POST') return json({ error: 'not_found' }, 404);
    const path = new URL(req.url).pathname;
    let body: any;
    try { body = await req.json(); } catch { return json({ error: 'invalid_body' }, 400); }
    if (path.startsWith('/upstream/')) return this.upstreamFetch(path, body);
    if (path.startsWith('/cron-lease/') || path === '/counter/bump') return this.atomicFetch(path, body);
    if (path === '/acquire') {
      const input: AcquireInput = { account: Number(body?.account), run: String(body?.run ?? ''), kind: String(body?.kind ?? 'text'), model: typeof body?.model === 'string' ? body.model : null };
      if (!Number.isSafeInteger(input.account) || input.account <= 0 || !input.run) return json({ error: 'invalid_body' }, 400);
      return json(this.governor.acquire(input));
    }
    if (path === '/release') return json({ released: this.governor.release(String(body?.id ?? '')) });
    return json({ error: 'not_found' }, 404);
  }
}
