// D770 (#2095, D720 F3 §6), PR 2 — a draft is checked before it is shown.
//
// D763's guard checks every run's output inside `run()` (#2058), and nothing
// it has not passed reaches the reader. A fill band's proposals and a zone
// draft are written and checked in the same request, so while that request
// is in flight the band says "Eadwyn is checking this draft." and holds every
// Accept: nothing is accepted while a check is open. A withheld output, or a
// guard that could not check it, answers with the guard's own words (the
// Worker's `message`), never the draft and never "unavailable".

export const CHECKING = 'Eadwyn is checking this draft.';

/** The refusals that are the guard's on the output side (`aiRouter.ts`). */
export const GUARD_REFUSALS = new Set(['guard_blocked_output', 'guard_unavailable']);

/**
 * The guard's refusal from a failed request, or null. The code travels on
 * `e.code` (a `detail` code, D258) or on `e.data.refusal` (the propose route's
 * body). The words are `e.message`, which `request()` reads from the body's
 * `message`. Its link is kept only when it is a path on this site.
 */
export function guardRefusal(e) {
  const code = GUARD_REFUSALS.has(e?.code) ? e.code : GUARD_REFUSALS.has(e?.data?.refusal) ? e.data.refusal : null;
  if (!code) return null;
  const l = e?.data?.link;
  const link = l && typeof l.href === 'string' && /^\/(?!\/)/.test(l.href) && typeof l.label === 'string' && l.label ? { href: l.href, label: l.label } : null;
  return { code, message: typeof e?.message === 'string' && e.message ? e.message : null, link };
}
