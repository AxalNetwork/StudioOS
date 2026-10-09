/**
 * D552 — THE PAGES AN AI RUN IS RECORDED AGAINST.
 *
 * `ai_usage_logs.surface` (migration 319, D404) is the app path a run was asked
 * from, and the AI rail's "This page this month" is a sum over it. Until D552
 * only two callers wrote it — the rail's read-back (`routes/ai.ts`) and the
 * zone drafts (`routes/research.ts`), both forwarding the path the page sent —
 * so every other model call landed in the month's unattributed group and a
 * page's figure was a fraction of what that page had cost.
 *
 * Every other call site now records ONE FIXED NAME, taken from this object and
 * nowhere else:
 *
 *   - The name is the app path of the page that owns the feature, so it lives
 *     in the same namespace as the paths the rail already records, and passes
 *     `aiRouter`'s `SURFACE_RE` unchanged (a test pins that).
 *   - A feature reached from more than one page records the page that owns it.
 *     Research Ask is answered on `/research/ask` and also from two desks; it
 *     is recorded as `/research/ask`, because a server route cannot tell which
 *     button was pressed without trusting the request, and a fixed name is the
 *     point.
 *   - `GET /api/ai/me/spend?surface=` accepts these names, and since D552
 *     step 3 any other page path in the exact form the router records (the
 *     rail's own pages), so the route never needs a second list.
 *
 * `cloudflare-worker/test/ai_surface_d552.test.ts` scans `src/` and fails when
 * a call into the router does not pass a `surface`, or passes a quoted string
 * instead of a name from here. Add the page here first, then the call.
 *
 * NO VALUE IMPORT INTO `aiRouter.ts`. That module is loaded by one test as
 * bytes with its single `import type` stripped; this list is read by the
 * callers and the spend route, never by the router.
 */
export const AI_SURFACE = {
  /** Validate · fill proposals (`/api/founder/validate/propose`) and the citations they fetch. */
  validate: '/validate',
  /** Validate · Interviews — transcribing an interview recording. */
  validateInterviews: '/validate/interviews',
  /** Research · Ask — the grounded answer (`POST /api/research/ask`). */
  researchAsk: '/research/ask',
  /** Research · Companies — the competitor analysis (`/api/competitors/*`). */
  researchCompanies: '/research/companies',
  /** Grow · Brand — landing autofill, palette and tagline suggestions (`/api/brand/*`). */
  buildBrand: '/build/brand',
  /** Raise · Pitch · Review — the deck reviewer's section map and review (`/api/deck-reviewer/*`). */
  raisePitchReview: '/raise/pitch/review',
  /** Studio — Eadwyn's interview: answers, explain, tool routing, rerank, dictation, and their safety pass. */
  studio: '/studio',
  /** Onboarding · Chat — the profiling conversation and its extraction (`/api/profiling/*`). */
  onboardingChat: '/onboarding/chat',
  /** HQ · Publications — the drafted headline summary (`/api/admin/publications/draft`). */
  adminPublications: '/admin/publications',
  /** Grow · Share an update — Eadwyn's draft of the highlights and lowlights (D654, `/api/portfolio-updates/share/draft-lines`). */
  growUpdate: '/grow/update',
} as const;

export type AiSurface = (typeof AI_SURFACE)[keyof typeof AI_SURFACE];

/** Every fixed name, in declaration order. Frozen: it is an allow-list. */
export const AI_SURFACES: readonly AiSurface[] = Object.freeze(Object.values(AI_SURFACE));

/** True for exactly the names above — no trimming, no trailing-slash folding. */
export function isAiSurface(value: unknown): value is AiSurface {
  return typeof value === 'string' && (AI_SURFACES as readonly string[]).includes(value);
}
