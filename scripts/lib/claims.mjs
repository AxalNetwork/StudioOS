/** Atomic claim metadata. Invalid metadata is expired, never a valid holder. */
export function claimRef(issue) {
  if (!/^[1-9]\d*$/.test(String(issue))) throw new Error('issue must be a positive integer');
  return `refs/heads/claim/${issue}`;
}
// D7259: `batch` marks a member tracker's ref that a remediation batch claim wrote; release of that batch removes it.
export function claimMessage({ issue, slot, agent, session, at = new Date(), ttlHours = 24, batch }) {
  claimRef(issue);
  if (![slot, agent, session].every(v => typeof v === 'string' && v.length > 0 && v.length <= 200)) throw new Error('slot, agent and session required');
  const createdAt = new Date(at).toISOString();
  if (!(Number.isFinite(ttlHours) && ttlHours > 0 && ttlHours <= 168)) throw new Error('invalid TTL');
  if (batch !== undefined) claimRef(batch);
  return JSON.stringify({ version: 1, issue: Number(issue), slot, agent, session, at: createdAt, ttlHours,
    ...(batch === undefined ? {} : { batch: Number(batch) }) });
}
export function parseClaim(message) {
  try {
    const value = JSON.parse(message);
    if (value?.version !== 1) return null;
    claimMessage(value);
    return value;
  } catch { return null; }
}
export function isExpired(claim, now = Date.now()) {
  return !claim || !parseClaim(JSON.stringify(claim)) || new Date(now).getTime() >= Date.parse(claim.at) + claim.ttlHours * 3600000;
}
