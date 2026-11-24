/** D8011: isolated, inactive issuer-key cache and admission budgets for s39 composition. */
import { createHash } from 'node:crypto';
const ISSUER = 'https://token.actions.githubusercontent.com';
export const CAPACITY_KEY_URL = `${ISSUER}/.well-known/jwks`;
/** Proposed per-isolate ceilings, not measured production capacity. */
export const CAPACITY_AUTH_LIMITS = Object.freeze({
  keyLifetimeMs: 300_000, refreshIntervalMs: 30_000, keyDeadlineMs: 5_000,
  keyBytes: 65_536, keyCount: 20, keyChunks: 128, keyWaiters: 16,
  windowMs: 60_000, authPerWindow: 128, authConcurrent: 6, authDeadlineMs: 5_000,
  progressAuthPerWindow: 96, progressAuthConcurrent: 2, progressProofMs: 30_000,
  receiptPerWindow: 96, receiptPerCaller: 12, receiptCallers: 32, receiptConcurrent: 4,
  submitPerWindow: 24, submitPerCaller: 4, submitCallers: 8, submitConcurrent: 2,
});
type Clock = { now: () => number; timer: (callback: () => void, ms: number) => () => void };
const nativeClock: Clock = {
  now: () => performance.now(),
  timer: (callback, ms) => { const handle = setTimeout(callback, ms); return () => clearTimeout(handle); },
};
const refused = (code: string) => new Error(`capacity_${code}`);
/** Clamps backwards movement. A bad clock fails closed rather than resetting allowances. */
function monotonic(now: () => number): () => number {
  let last = 0;
  return () => {
    const next = now();
    if (!Number.isFinite(next) || next < 0) throw refused('policy_clock');
    last = Math.max(last, next);
    return last;
  };
}
export type CapacitySigningKey = JsonWebKey & { kid: string; alg: 'RS256'; use: 'sig' };

export class CapacityIssuerKeys {
  private clock: Clock;
  private fetcher: typeof fetch;
  private keys: readonly CapacitySigningKey[] = [];
  private validUntil = 0;
  private nextRefresh = 0;
  private flight: Promise<void> | null = null;
  private waiters = 0;
  constructor(fetcher: typeof fetch = fetch, clock: Clock = nativeClock) {
    this.fetcher = fetcher;
    this.clock = { ...clock, now: monotonic(clock.now) };
  }
  /** Returns key material only. Every request still imports/verifies its token and checks claims. */
  async get(kid: string): Promise<CapacitySigningKey> {
    if (typeof kid !== 'string' || !/^[A-Za-z0-9_.-]{1,200}$/.test(kid)) throw refused('invalid_key_id');
    const known = this.keys.find(key => key.kid === kid);
    if (known && this.clock.now() < this.validUntil) return { ...known };
    if (!this.flight) {
      if (this.clock.now() < this.nextRefresh) throw refused('key_refresh_limited');
      this.refresh();
    }
    if (this.waiters >= CAPACITY_AUTH_LIMITS.keyWaiters) throw refused('key_waiters_limited');
    this.waiters++;
    try { await this.flight; } finally { this.waiters--; }
    const key = this.keys.find(item => item.kid === kid);
    if (!key || this.clock.now() >= this.validUntil) throw refused('unknown_key');
    return { ...key };
  }
  private refresh(): void {
    const limits = CAPACITY_AUTH_LIMITS;
    this.nextRefresh = this.clock.now() + limits.refreshIntervalMs;
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let expired = false;
    let cancel = () => {};
    const raw = Promise.resolve().then(async () => {
      const response = await this.fetcher(CAPACITY_KEY_URL, { method: 'GET', redirect: 'error', signal: controller.signal });
      if (expired) { void response.body?.cancel().catch(() => undefined); throw refused('key_timeout'); }
      if (!response.ok || response.redirected || !response.body) {
        void response.body?.cancel().catch(() => undefined);
        throw refused('keys_unavailable');
      }
      reader = response.body.getReader();
      const bytes = new Uint8Array(limits.keyBytes);
      let used = 0, complete = false;
      try {
        for (let n = 0; n < limits.keyChunks; n++) {
          const chunk = await reader.read();
          if (expired) throw refused('key_timeout');
          if (chunk.done) { complete = true; break; }
          if (!(chunk.value instanceof Uint8Array) || used + chunk.value.byteLength > bytes.length) throw refused('key_body_bound');
          bytes.set(chunk.value, used); used += chunk.value.byteLength;
        }
        if (!complete) throw refused('key_chunk_bound');
        const doc = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, used)));
        if (!doc || !Array.isArray(doc.keys) || !doc.keys.length || doc.keys.length > limits.keyCount) throw refused('invalid_keys');
        const keys: CapacitySigningKey[] = [];
        for (const key of doc.keys) {
          if (!key || key.kty !== 'RSA' || key.alg !== 'RS256' || key.use !== 'sig'
            || typeof key.kid !== 'string' || !/^[A-Za-z0-9_.-]{1,200}$/.test(key.kid)
            || typeof key.n !== 'string' || !/^[A-Za-z0-9_-]{1,1024}$/.test(key.n)
            || typeof key.e !== 'string' || !/^[A-Za-z0-9_-]{1,16}$/.test(key.e)
            || keys.some(other => other.kid === key.kid)) throw refused('invalid_keys');
          // Store a bounded allowlist, never provider extensions or private key material.
          keys.push({ kty: 'RSA', alg: 'RS256', use: 'sig', kid: key.kid, n: key.n, e: key.e });
        }
        if (expired) throw refused('key_timeout');
        this.keys = keys;
        this.validUntil = this.clock.now() + limits.keyLifetimeMs;
      } finally { void reader.cancel().catch(() => undefined); }
    });
    const timeout = new Promise<never>((_, reject) => {
      cancel = this.clock.timer(() => {
        expired = true; controller.abort(); void reader?.cancel().catch(() => undefined);
        reject(refused('key_timeout'));
      }, limits.keyDeadlineMs);
    });
    const flight = Promise.race([raw, timeout]).catch(() => {
      this.nextRefresh = this.clock.now() + limits.refreshIntervalMs;
      throw refused('keys_unavailable');
    }).finally(() => cancel());
    this.flight = flight;
    // A timed-out but non-cooperative fetch/read retains the slot until it actually settles.
    // Releasing at the deadline would allow unlimited detached native/network work.
    const release = () => { if (this.flight === flight) this.flight = null; };
    void raw.then(release, release);
  }
}

export type CapacityCaller = { repository_id: string; run_id: string; run_attempt: string; exp?: number };
export type CapacityWorkLane = 'submit' | 'receipt';
export type CapacityBudgetWindow = {
  version: 1; window: number; authUsed: number; progressAuthUsed: number;
  lanes: Record<CapacityWorkLane, { used: number; callers: [string, number][] }>;
};
/** Must atomically persist the returned window before resolving, scoped to the capacity authority. */
export type CapacityBudgetStore = {
  update: (decide: (state: CapacityBudgetWindow | null) => { state: CapacityBudgetWindow; accepted: boolean }) => Promise<boolean>;
};
const wallClock: Clock = { ...nativeClock, now: () => Date.now() };
function windowState(old: CapacityBudgetWindow | null, window: number): CapacityBudgetWindow {
  if (old !== null && (typeof old !== 'object' || Array.isArray(old) || old.version !== 1 || !Number.isSafeInteger(old.window) || old.window < 0
    || !Number.isSafeInteger(old.authUsed) || old.authUsed < 0 || old.authUsed > CAPACITY_AUTH_LIMITS.authPerWindow
    || !Number.isSafeInteger(old.progressAuthUsed) || old.progressAuthUsed < 0 || old.progressAuthUsed > CAPACITY_AUTH_LIMITS.progressAuthPerWindow
    || !['receipt', 'submit'].every(name => {
      const lane = old.lanes?.[name as CapacityWorkLane];
      const max = name === 'receipt' ? CAPACITY_AUTH_LIMITS.receiptCallers : CAPACITY_AUTH_LIMITS.submitCallers;
      const maxUsed = name === 'receipt' ? CAPACITY_AUTH_LIMITS.receiptPerWindow : CAPACITY_AUTH_LIMITS.submitPerWindow;
      const maxCaller = name === 'receipt' ? CAPACITY_AUTH_LIMITS.receiptPerCaller : CAPACITY_AUTH_LIMITS.submitPerCaller;
      return lane && Number.isSafeInteger(lane.used) && lane.used >= 0 && lane.used <= maxUsed
        && Array.isArray(lane.callers) && lane.callers.length <= max
        && lane.callers.every(row => Array.isArray(row) && row.length === 2 && typeof row[0] === 'string'
          && /^[1-9][0-9]{0,14}\/[1-9][0-9]{0,14}\/[1-9][0-9]{0,14}$/.test(row[0])
          && Number.isSafeInteger(row[1]) && row[1] > 0 && row[1] <= maxCaller)
        && new Set(lane.callers.map(row => row[0])).size === lane.callers.length
        && lane.callers.reduce((sum, row) => sum + row[1], 0) === lane.used;
    }))) throw refused('budget_state_invalid');
  // A clock rollback or process restart must not reopen the same persisted allowance.
  if (old && old.window >= window) return {
    version: 1, window: old.window, authUsed: old.authUsed, progressAuthUsed: old.progressAuthUsed,
    lanes: {
      receipt: { used: old.lanes.receipt.used, callers: old.lanes.receipt.callers.map(([key, used]) => [key, used]) },
      submit: { used: old.lanes.submit.used, callers: old.lanes.submit.callers.map(([key, used]) => [key, used]) },
    },
  };
  return { version: 1, window, authUsed: 0, progressAuthUsed: 0, lanes: { submit: { used: 0, callers: [] }, receipt: { used: 0, callers: [] } } };
}
/** Trusted code supplies verification and lane authorization. A path/body alone grants no lane. */
export class CapacityRequestBudget {
  private clock: Clock;
  private store: CapacityBudgetStore;
  private authActive = 0;
  private progressActive = 0;
  // At most one token fingerprint per proven receipt caller, never raw bearer tokens.
  private progress: { fingerprint: string; caller: string; until: number }[] = [];
  private active: Record<CapacityWorkLane, number> = { submit: 0, receipt: 0 };
  constructor(store: CapacityBudgetStore, clock: Clock = wallClock) {
    this.store = store;
    this.clock = { ...clock, now: monotonic(clock.now) };
  }
  private reserve(kind: 'auth' | 'progress-auth' | CapacityWorkLane, caller = ''): Promise<boolean> {
    const limits = CAPACITY_AUTH_LIMITS;
    const window = Math.floor(this.clock.now() / limits.windowMs);
    return this.store.update(old => {
      const state = windowState(old, window);
      if (kind === 'auth' || kind === 'progress-auth') {
        const field = kind === 'auth' ? 'authUsed' : 'progressAuthUsed';
        const max = kind === 'auth' ? limits.authPerWindow : limits.progressAuthPerWindow;
        if (state[field] >= max) return { state, accepted: false };
        state[field]++;
      } else {
        const lane = state.lanes[kind];
        const entry = lane.callers.find(row => row[0] === caller);
        const maxUsed = kind === 'receipt' ? limits.receiptPerWindow : limits.submitPerWindow;
        const maxCaller = kind === 'receipt' ? limits.receiptPerCaller : limits.submitPerCaller;
        const maxCallers = kind === 'receipt' ? limits.receiptCallers : limits.submitCallers;
        if (lane.used >= maxUsed || (entry && entry[1] >= maxCaller) || (!entry && lane.callers.length >= maxCallers)) return { state, accepted: false };
        lane.used++;
        if (entry) entry[1]++; else lane.callers.push([caller, 1]);
      }
      return { state, accepted: true };
    });
  }
  /** No queue, no refunds after a failed attempt, and no cached token authority. */
  async run<I extends CapacityCaller, T>(
    verify: () => Promise<I>, authorize: (identity: I) => CapacityWorkLane | null,
    work: (identity: I) => Promise<T>,
    progress?: { token: string; ownedReceipt: (result: T) => boolean },
  ): Promise<T> {
    const limits = CAPACITY_AUTH_LIMITS;
    const now = this.clock.now();
    this.progress = this.progress.filter(proof => proof.until > now);
    const fingerprint = progress && typeof progress.token === 'string' && /^[A-Za-z0-9_.-]{1,16384}$/.test(progress.token)
      ? createHash('sha256').update(progress.token).digest('hex') : null;
    const proof = fingerprint ? this.progress.find(item => item.fingerprint === fingerprint) : undefined;
    if (proof ? this.progressActive >= limits.progressAuthConcurrent : this.authActive >= limits.authConcurrent) throw refused('auth_limited');
    if (proof) this.progressActive++; else this.authActive++;
    let expired = false;
    const verification = (async () => {
      if (!await this.reserve(proof ? 'progress-auth' : 'auth')) throw refused('auth_limited');
      if (expired) throw refused('auth_timeout');
      return verify();
    })().finally(() => { if (proof) this.progressActive--; else this.authActive--; });
    let cancel = () => {};
    let identity: I;
    try {
      identity = await Promise.race([verification, new Promise<never>((_, reject) => {
        cancel = this.clock.timer(() => { expired = true; reject(refused('auth_timeout')); }, limits.authDeadlineMs);
      })]);
    } finally { cancel(); }
    const kind = authorize(identity);
    if ((kind !== 'submit' && kind !== 'receipt') || (proof && kind !== 'receipt')) throw refused('lane_unauthorized');
    if (![identity.repository_id, identity.run_id, identity.run_attempt].every(value => typeof value === 'string' && /^[1-9][0-9]{0,14}$/.test(value))) throw refused('caller_invalid');
    const maxActive = kind === 'receipt' ? limits.receiptConcurrent : limits.submitConcurrent;
    if (this.active[kind] >= maxActive) throw refused('work_limited');
    this.active[kind]++;
    try {
      const caller = `${identity.repository_id}/${identity.run_id}/${identity.run_attempt}`;
      if (proof && proof.caller !== caller) throw refused('lane_unauthorized');
      if (!await this.reserve(kind, caller)) throw refused('work_limited');
      const result = await work(identity);
      // Promotion requires both verified identity and a trusted, successful owned-receipt check.
      if (kind === 'receipt' && fingerprint && progress?.ownedReceipt(result) === true
        && Number.isSafeInteger(identity.exp) && identity.exp! * 1000 > this.clock.now()) {
        this.progress = this.progress.filter(item => item.caller !== caller);
        if (this.progress.length < limits.receiptCallers) this.progress.push({ fingerprint, caller,
          until: Math.min(this.clock.now() + limits.progressProofMs, identity.exp! * 1000) });
      }
      return result;
    } finally { this.active[kind]--; }
  }
}
