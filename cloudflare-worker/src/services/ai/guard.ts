/**
 * D763 (#2020, part 1) — the guard's rules, as plain code: how a text is cut
 * into slices Llama Guard 3 8B reads in full, how its answer is read, what
 * each category does, and what the member is told. No `env`, no binding, no
 * D1: part 2 hooks these into `../aiRouter.ts` `run()`, which does the
 * calling, the holding and the charging.
 *
 * THE RULES.
 *   slices    Every text is checked in full, slice by slice: at most
 *             GUARD_SLICE_CHARS characters each, cut at a paragraph break
 *             where one falls inside the slice, else after a sentence's end,
 *             else at the limit. The slices join back to the text exactly.
 *   verdict   Llama Guard answers `safe`, or `unsafe` and a line of S-codes.
 *             Anything else is `unreadable`, which is a failure of the guard
 *             and never counts as safe.
 *   policy    S1–S5 and S8–S14 block. S6 (specialised advice) and S7
 *             (privacy) are logged and do not block: a legal, cap-table or
 *             diligence draft legitimately trips them. An `unsafe` with no
 *             code we know blocks.
 *   copy      In Eadwyn's voice, never naming a category. S11 (self-harm)
 *             has its own words; a founder or an admin also gets the
 *             Wellbeing link, because `/wellbeing` refuses everyone else.
 */

/** Llama Guard 3's hazard taxonomy, as the model card numbers it. */
export const GUARD_CATEGORIES = {
  S1: { name: 'Violent crimes', action: 'block' },
  S2: { name: 'Non-violent crimes', action: 'block' },
  S3: { name: 'Sex-related crimes', action: 'block' },
  S4: { name: 'Child sexual exploitation', action: 'block' },
  S5: { name: 'Defamation', action: 'block' },
  S6: { name: 'Specialised advice', action: 'log' },
  S7: { name: 'Privacy', action: 'log' },
  S8: { name: 'Intellectual property', action: 'block' },
  S9: { name: 'Indiscriminate weapons', action: 'block' },
  S10: { name: 'Hate', action: 'block' },
  S11: { name: 'Suicide and self-harm', action: 'block' },
  S12: { name: 'Sexual content', action: 'block' },
  S13: { name: 'Elections', action: 'block' },
  S14: { name: 'Code interpreter abuse', action: 'block' },
} as const satisfies Record<string, { name: string; action: 'block' | 'log' }>;

export type GuardCode = keyof typeof GUARD_CATEGORIES;

/** The longest slice the guard is given, in characters. */
export const GUARD_SLICE_CHARS = 2000;

// ---------------------------------------------------------------------------
// Slices
// ---------------------------------------------------------------------------

/** Where a sentence ends: `.`, `!` or `?` (with any closing quotes or brackets), then whitespace. */
const SENTENCE_END = /[.!?]["')\]’”]*\s+/g;

/**
 * The text as slices of at most `max` characters. Each cut falls after the
 * last paragraph break (a blank line) inside the window, else after the last
 * sentence end, else at `max`. `slices.join('') === text`, always; an empty
 * text has no slices.
 */
export function sliceForGuard(text: string, max: number = GUARD_SLICE_CHARS): string[] {
  const s = String(text ?? '');
  if (!s) return [];
  const out: string[] = [];
  let at = 0;
  while (s.length - at > max) {
    const window = s.slice(at, at + max);
    out.push(window.slice(0, cutIn(window)));
    at += out[out.length - 1].length;
  }
  out.push(s.slice(at));
  return out;
}

/** The cut inside one full window: after a paragraph break, else a sentence end, else the window's end. */
function cutIn(window: string): number {
  let cut = 0;
  for (const m of window.matchAll(/\n[ \t]*\n\s*/g)) cut = m.index + m[0].length;
  if (cut > 0 && cut < window.length) return cut;
  cut = 0;
  for (const m of window.matchAll(SENTENCE_END)) cut = m.index + m[0].length;
  return cut > 0 && cut < window.length ? cut : window.length;
}

// ---------------------------------------------------------------------------
// Verdicts
// ---------------------------------------------------------------------------

export type GuardVerdict =
  | { verdict: 'safe' }
  | { verdict: 'unsafe'; codes: GuardCode[] }
  | { verdict: 'unreadable' };

const KNOWN = new Set<string>(Object.keys(GUARD_CATEGORIES));

/**
 * Llama Guard's answer: `safe`, or `unsafe` then its codes (`S1`, or `S1,S10`)
 * on the next line. Codes are read in order, once each; ones it does not know
 * are dropped. Anything else — empty, prose, a code with no `unsafe` — is
 * `unreadable`.
 */
export function parseVerdict(output: unknown): GuardVerdict {
  if (typeof output !== 'string') return { verdict: 'unreadable' };
  const lines = output.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const head = (lines[0] ?? '').toLowerCase();
  if (head === 'safe' && lines.length === 1) return { verdict: 'safe' };
  if (head !== 'unsafe' || lines.length > 2) return { verdict: 'unreadable' };
  const codes: GuardCode[] = [];
  for (const raw of (lines[1] ?? '').split(/[,\s]+/)) {
    const code = raw.toUpperCase();
    if (KNOWN.has(code) && !codes.includes(code as GuardCode)) codes.push(code as GuardCode);
  }
  return { verdict: 'unsafe', codes };
}

/**
 * What the run does with one slice's verdict:
 *   pass    safe
 *   log     unsafe, but only under codes the policy logs (S6, S7)
 *   block   unsafe under any blocking code, or with no code we know
 *   fail    unreadable: the guard failed, and the run fails closed
 */
export type GuardDecision =
  | { action: 'pass' }
  | { action: 'log'; codes: GuardCode[] }
  | { action: 'block'; codes: GuardCode[] }
  | { action: 'fail' };

export function decide(v: GuardVerdict): GuardDecision {
  if (v.verdict === 'safe') return { action: 'pass' };
  if (v.verdict === 'unreadable') return { action: 'fail' };
  if (v.codes.length && v.codes.every((c) => GUARD_CATEGORIES[c].action === 'log')) return { action: 'log', codes: v.codes };
  return { action: 'block', codes: v.codes };
}

/** Several slices' decisions as one: any failure fails, else any block blocks, else any log logs. */
export function combine(decisions: GuardDecision[]): GuardDecision {
  if (decisions.some((d) => d.action === 'fail')) return { action: 'fail' };
  const codes = (action: 'block' | 'log') => [...new Set(decisions.flatMap((d) => (d.action === action ? d.codes : [])))];
  if (decisions.some((d) => d.action === 'block')) return { action: 'block', codes: codes('block') };
  if (decisions.some((d) => d.action === 'log')) return { action: 'log', codes: codes('log') };
  return { action: 'pass' };
}

// ---------------------------------------------------------------------------
// What the member is told
// ---------------------------------------------------------------------------

/** Where Wellbeing lives, and who may open it (`frontend/src/App.jsx`: founders and admins). */
export const WELLBEING_PATH = '/wellbeing';
const WELLBEING_ROLES = new Set(['founder', 'admin']);

export const GUARD_COPY = {
  input: "I can't help with that request. If you put what you need another way, I'll try again.",
  output: "I wrote something I can't show you, so I've held it back. Try asking another way.",
  unavailable: "I can't check this right now, so I haven't run it. Try again in a minute.",
  selfHarm: "It sounds like things might be heavy right now. I'm not the right help for this, but you don't have to carry it alone.",
  wellbeingLabel: 'Open Wellbeing',
} as const;

export interface GuardRefusal { message: string; link: { href: string; label: string } | null }

/**
 * The words for a refusal. `where` is the side that was refused, or
 * `unavailable` when the guard could not answer. No category code ever
 * reaches the member; S11 gets its own words, and the Wellbeing link only
 * for a role that can open it.
 */
export function refusalFor(where: 'input' | 'output' | 'unavailable', codes: readonly GuardCode[], role: string | null | undefined): GuardRefusal {
  if (where !== 'unavailable' && codes.includes('S11')) {
    const linked = WELLBEING_ROLES.has(String(role ?? '').toLowerCase());
    return {
      message: GUARD_COPY.selfHarm,
      link: linked ? { href: WELLBEING_PATH, label: GUARD_COPY.wellbeingLabel } : null,
    };
  }
  return { message: GUARD_COPY[where], link: null };
}
