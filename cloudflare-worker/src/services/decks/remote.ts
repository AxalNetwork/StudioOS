/**
 * D1581 (#3828, deck v2 F2) — the phone remote's rules: the pairing code, the
 * remote's lifetime and the steps it may send. Pure; `durable-objects/
 * deck-remote.ts` holds the state and `routes/deck_remote.ts` the access.
 *
 * PAIRING. The presenter asks for a code: six digits, good for
 * `CODE_TTL_MS` and for one join. The phone joins with it and gets a
 * `remote_id`, good for `REMOTE_TTL_MS`. Both sides must be signed in and able
 * to read the deck (`projectOwned`), so a guessed code controls nothing its
 * guesser could not already open, and the pair and join routes sit under
 * fail-closed rate buckets. A new code, or Unpair, ends the old remote.
 *
 * STEPS are Present's own keys: `next`, `prev`, `first`, `last`, or a card
 * number (1-based). Anything else is refused, never guessed.
 */
export const CODE_DIGITS = 6;
export const CODE_TTL_MS = 10 * 60_000;
export const REMOTE_TTL_MS = 4 * 60 * 60_000;
export const MAX_CARD = 200;
export const STEP_WORDS = Object.freeze(['next', 'prev', 'first', 'last'] as const);

export type RemoteStep = (typeof STEP_WORDS)[number] | { card: number };

const SPAN = 10 ** CODE_DIGITS;
/** The largest multiple of a million below 2^32: draws at or above it are refused, so every code is equally likely. */
const LIMIT = Math.floor(2 ** 32 / SPAN) * SPAN;
const crypto32 = () => crypto.getRandomValues(new Uint32Array(1))[0];

/**
 * A six-digit code, leading zeros kept, from uniform 32-bit draws (crypto in
 * the Worker). Rejection sampling, not division: a draw at or above LIMIT is
 * drawn again, so no code is likelier than another.
 */
export function makeCode(next32: () => number = crypto32): string {
  for (let i = 0; i < 64; i++) {
    const x = next32() >>> 0;
    if (x < LIMIT) return String(x % SPAN).padStart(CODE_DIGITS, '0');
  }
  throw new Error('no unbiased draw');
}

export const isCode = (v: unknown): v is string => typeof v === 'string' && /^[0-9]{6}$/.test(v);
export const isRemoteId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/.test(v);

/** The step a remote sent, or null when it is not one Present takes. */
export function stepOf(v: unknown): RemoteStep | null {
  if (typeof v === 'string' && (STEP_WORDS as readonly string[]).includes(v)) return v as RemoteStep;
  const n = typeof v === 'number' ? v : typeof v === 'object' && v ? Number((v as any).card) : NaN;
  if (Number.isInteger(n) && n >= 1 && n <= MAX_CARD) return { card: n };
  return null;
}

/** What the room keeps about its pairing. */
export type Pairing = { code: string | null; code_expires: number; remote_id: string | null; remote_expires: number; paired_by: number };

export const codeLive = (p: Pairing | null | undefined, now: number) => !!p?.code && p.code_expires > now;
export const remoteLive = (p: Pairing | null | undefined, remoteId: unknown, now: number) =>
  !!p?.remote_id && p.remote_id === remoteId && p.remote_expires > now;
