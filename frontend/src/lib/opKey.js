/**
 * D4675 (#4675): `newOpKey` — the key one administrative act carries.
 *
 * A dialog makes one when it opens and sends the same one on every retry of
 * that act (a lost response, a step-up prompt, a second click), so the Worker
 * records the act once and answers a repeat with the record it already made.
 * A different act (another outcome, another dialog) gets a new key.
 */
export function newOpKey() {
  const c = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (c && typeof c.randomUUID === 'function') return `op_${c.randomUUID().replace(/-/g, '')}`;
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return `op_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}
