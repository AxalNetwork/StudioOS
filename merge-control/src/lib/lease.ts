/** D5618: issue-scoped TTL leases with a monotonic, persistent fencing counter. */
export interface Lease { holder: string; fence: number; expiresAt: number }
export interface LeaseState { counter: number; lease: Lease | null }
export interface LeaseInput { operation: 'acquire' | 'renew' | 'release'; holder: string; fence?: number; ttlSeconds?: number }
export function changeLease(state: LeaseState, input: LeaseInput, now: number) {
  if (!/^[\w .:@/-]{1,200}$/.test(input.holder)) throw new Error('invalid holder');
  const ttl = input.ttlSeconds ?? 86400;
  if (!Number.isFinite(ttl) || ttl < 1 || ttl > 86400) throw new Error('invalid TTL');
  const active = state.lease && state.lease.expiresAt > now;
  if (input.operation === 'acquire') {
    if (active) return { state, status: 409, lease: state.lease };
    if (!Number.isSafeInteger(state.counter + 1)) throw new Error('fencing counter exhausted');
    const lease = { holder: input.holder, fence: state.counter + 1, expiresAt: now + ttl * 1000 };
    return { state: { counter: lease.fence, lease }, status: 200, lease };
  }
  if (!active || state.lease?.holder !== input.holder || state.lease?.fence !== input.fence) return { state, status: 409, lease: null };
  if (input.operation === 'release') return { state: { counter: state.counter, lease: null }, status: 200, lease: null };
  if (input.operation !== 'renew') throw new Error('invalid operation');
  const lease = { ...state.lease, expiresAt: now + ttl * 1000 } as Lease;
  return { state: { counter: state.counter, lease }, status: 200, lease };
}
