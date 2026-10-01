/**
 * The one comparison both RPC directions authenticate with (D120).
 *
 * WHY THIS IS A MODULE AND NOT A SECOND COPY. Until PR 11 there was exactly one
 * authenticated direction — a branch presenting `RPC_SECRET` to HQ — and its
 * digest helper and constant-time compare were private to `hqOps.ts`. PR 11
 * adds the reverse leg, and the obvious way to write it is to paste the same
 * twelve lines into `branchOps.ts`. That is how two comparisons come to differ:
 * one trims the stored hash and the other does not, one refuses an empty
 * presented secret and the other compares it against a digest it can never
 * equal, and both look correct in isolation. The security-critical part is not
 * the SHA-256 — it is the normalisation and the refusals around it, and those
 * are what must not diverge.
 *
 * `frontend/src/lib/README.md` states the rule this file follows in the SPA's
 * voice — *"if a helper appears in two places, put it here once rather than a
 * third time"* — and D117 enforced it there. This is the same rule one tier
 * down.
 *
 * WHAT A SHARED SECRET DOES AND DOES NOT ESTABLISH. It proves the caller holds
 * a value the provisioning run put on exactly one Worker. It does not prove
 * anything about the human behind the call: HQ's own route checks TOTP, a
 * recent step-up and the admin role before it ever reaches the binding, and the
 * branch's trust in that is exactly what the secret buys and nothing more.
 * `hqOps.ts`'s header draws the same line for the other direction.
 */

/** SHA-256 of a string, lower-case hex. */
export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Length-independent, difference-independent compare over two hex digests. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Does `presented` hash to `storedHash`?
 *
 * THREE REFUSALS, EACH WITH ITS OWN NAME, because a caller that could not tell
 * them apart would report "wrong secret" for a deployment that was never given
 * one — and an operator would go looking for a mismatch that does not exist.
 *
 *   `no_hash`   the verifying side holds no hash. NEVER a pass: a null here
 *               means nobody has provisioned this leg, which is exactly when a
 *               default-open turns the whole control off, on exactly the
 *               deployments nobody has audited.
 *   `no_secret` the caller presented nothing.
 *   `mismatch`  both present, digests differ.
 */
export type SecretVerdict = 'ok' | 'no_hash' | 'no_secret' | 'mismatch';

export async function verifySecret(
  presented: string | null | undefined,
  storedHash: string | null | undefined,
): Promise<SecretVerdict> {
  const hash = String(storedHash ?? '').trim().toLowerCase();
  if (!hash) return 'no_hash';
  const secret = String(presented ?? '');
  if (!secret) return 'no_secret';
  return constantTimeEqual(await sha256Hex(secret), hash) ? 'ok' : 'mismatch';
}
