#!/usr/bin/env node
/**
 * D1581 (#3828) — the staging test: "the remote advances Present within 300 ms".
 *
 * Pairs a deck, joins as the phone, opens Present's socket, sends steps and
 * times each from the phone's request to the `step` frame on Present's socket.
 * It needs a deployed Worker with the DECK_REMOTE binding and a member's token
 * (who may read the deck); nothing here is committed with it.
 *
 *   STUDIOOS_BASE=https://<staging host> STUDIOOS_TOKEN=<jwt> \
 *     node scripts/remote-latency.mjs <deck id> [steps=10]
 *
 * Prints each step's time and exits 1 when any is 300 ms or more. Node 22 or
 * later (a global WebSocket).
 */
const [deckId, stepsArg] = process.argv.slice(2);
const base = process.env.STUDIOOS_BASE;
const token = process.env.STUDIOOS_TOKEN;
const LIMIT_MS = 300;
if (!deckId || !base || !token) {
  console.error('usage: STUDIOOS_BASE=… STUDIOOS_TOKEN=… node scripts/remote-latency.mjs <deck id> [steps]');
  process.exit(2);
}
const steps = Math.max(1, Number(stepsArg) || 10);
const api = async (method, path, body) => {
  const res = await fetch(`${base}/api${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${json?.error ?? ''}`);
  return json;
};

const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/api/decks/${deckId}/remote/ws`, [`bearer.${token}`]);
const waiting = [];
ws.onmessage = (ev) => {
  let frame = null;
  try { frame = JSON.parse(ev.data); } catch { return; }
  if (frame?.type === 'step' && waiting.length) waiting.shift()(performance.now());
};
await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = () => fail(new Error('Present socket did not open')); });

const { code } = await api('POST', `/decks/${deckId}/remote/pair`);
const { remote_id: remoteId } = await api('POST', '/decks/remote/join', { code });
const times = [];
for (let k = 0; k < steps; k++) {
  const arrived = new Promise((ok) => waiting.push(ok));
  const t0 = performance.now();
  await api('POST', `/decks/${deckId}/remote/step`, { remote_id: remoteId, step: k % 2 ? 'prev' : 'next' });
  const ms = (await Promise.race([arrived, new Promise((ok) => setTimeout(() => ok(t0 + 5000), 5000))])) - t0;
  times.push(ms);
  console.log(`step ${k + 1}: ${ms.toFixed(0)} ms`);
}
await api('DELETE', `/decks/${deckId}/remote`);
ws.close();
const worst = Math.max(...times);
console.log(`worst ${worst.toFixed(0)} ms, limit ${LIMIT_MS} ms`);
process.exit(worst < LIMIT_MS ? 0 : 1);
