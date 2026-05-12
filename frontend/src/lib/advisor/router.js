/**
 * Task #12 (AC-3) — Client-side optimistic write router.
 *
 * Mirror of the server's `cloudflare-worker/src/services/advisor/writeRouter.ts`
 * mapping, but lookup-only — we never actually persist here. Given a
 * `question_id` we return the page that the answer will land on (so
 * the chatbot can optimistically light up the matching completion
 * ring in the right rail) and the doc anchor used by the "Read more"
 * deep link in tutor mode.
 *
 * The lookup table is derived from the AC-2 banks (`./banks/*`) so
 * there is a single source of truth for `page_target` / `doc_anchor`.
 * Questions returned by the server's role-detector (`role_detect.*`)
 * and any backend-only IDs not present in the AC-2 banks fall back
 * to a sensible default.
 */
import { BANKS } from './persona';

// Build a flat { question_id -> { page_target, doc_anchor, bank } } table
// from the AC-2 banks so the client can predict landing targets without
// a server round-trip.
const QUESTION_INDEX = (() => {
  const idx = new Map();
  for (const [bankName, bank] of Object.entries(BANKS)) {
    if (!Array.isArray(bank)) continue;
    for (const q of bank) {
      if (!q?.id) continue;
      idx.set(q.id, {
        page_target: q.page_target || null,
        doc_anchor: q.doc_anchor || null,
        bank: bankName,
        label: q.label || null,
      });
    }
  }
  return idx;
})();

// Backend-only / cross-bank IDs that the AC-2 banks don't define
// (role detector + persona seed questions served by the worker before
// the role is known). Keep this list in sync with
// `cloudflare-worker/src/services/advisor/questionBank.ts`.
const FALLBACK_TARGETS = {
  'role_detect.primary': { page_target: '/onboarding/persona', doc_anchor: 'getting-started/personas', bank: 'roleDetector', label: 'Tell us your role' },
  'role_detect.secondary': { page_target: '/onboarding/persona', doc_anchor: 'getting-started/personas', bank: 'roleDetector', label: 'Any secondary roles?' },
  'role_detect.context': { page_target: '/onboarding/persona', doc_anchor: 'getting-started/personas', bank: 'roleDetector', label: 'A bit of context' },
};

/**
 * Predict the page + doc anchor an answer for `question_id` will land
 * on. Returns `null` for unknown ids — the caller should treat that
 * as a no-op (no ring to light, no deep-link button to render).
 */
export function predictTarget(question_id) {
  if (!question_id) return null;
  return QUESTION_INDEX.get(question_id) || FALLBACK_TARGETS[question_id] || null;
}

/**
 * Group every known question id by its `page_target` so the right
 * rail can render one ring per page with a "answered / total" count
 * sourced from the already-answered set the chat client maintains.
 *
 * Returns an array of `{ page, doc_anchor, ids[] }` entries, sorted
 * by page so the rail is stable across renders.
 */
export function pagesForBank(bankName) {
  const bank = BANKS[bankName];
  if (!Array.isArray(bank)) return [];
  const groups = new Map();
  for (const q of bank) {
    if (!q?.page_target) continue;
    const key = q.page_target;
    let g = groups.get(key);
    if (!g) {
      g = { page: key, doc_anchor: q.doc_anchor || null, ids: [], label: pageLabel(key) };
      groups.set(key, g);
    }
    g.ids.push(q.id);
  }
  return Array.from(groups.values()).sort((a, b) => a.page.localeCompare(b.page));
}

/** Friendly label for a page route — used by the right-rail rings. */
export function pageLabel(path) {
  if (!path) return '';
  const map = {
    '/projects': 'Projects',
    '/build/discovery': 'Discovery',
    '/build/roadmap': 'Roadmap',
    '/build/brand': 'Brand',
    '/build/deck': 'Pitch Deck',
    '/network': 'Network',
    '/onboarding/persona': 'Persona',
    '/matches': 'AI Matches',
    '/portfolio': 'Portfolio',
    '/mentorship': 'Mentorship',
    '/partners': 'Partners',
  };
  if (map[path]) return map[path];
  // Fallback: last segment, title-cased.
  const seg = path.split('/').filter(Boolean).pop() || path;
  return seg.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Task #3 (AS) — given a list of `field_sources` rows from
 * GET /api/advisor/sources, return the set of question_ids that
 * land on `page` so callers can drive sparkle icons + the
 * <AdvisorFilledBanner> filter without re-walking the bank.
 */
export function questionsFilledOnPage(page, sources) {
  const out = new Set();
  if (!page || !Array.isArray(sources)) return out;
  for (const s of sources) {
    if (!s || s.page_target !== page) continue;
    if (s.question_id) out.add(s.question_id);
  }
  return out;
}

export default predictTarget;
