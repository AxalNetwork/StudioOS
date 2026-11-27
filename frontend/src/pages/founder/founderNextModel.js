/**
 * D8729 (#8729) — the founder Studio's venture work, as pure rules: the Next
 * card's steps, the address each task link opens, and the words the venture
 * header and its states use. No React and no fetch, so
 * `frontend/test/studio_founder_venture_8729.test.mjs` holds every rule here.
 *
 * THE NEXT CARD (owner, Q2 A). The steps are the placed modules' own next
 * actions (`card.next` on each cycle module's overview card), in the member's
 * layout order, then Eadwyn's waiting questions when Eadwyn's questions is
 * placed. Nothing is ranked or invented: a module that names no next step adds
 * none. The first step is the card's one primary action.
 *
 * THE TASK LINK. The Worker's `next.href` is `/<cycle>/<slug>?project=<id>`,
 * with `&add=1` for a module's first Add. Studio writes the canonical address
 * itself (D5074): `?project_id=<id>`, and for an Add the module's `/new`
 * address, so the push carries `state.under` and Cancel, Esc or Back return to
 * Studio (CycleRoute's `closeAdd`). The venture is always the one Studio
 * shows: a link naming another venture is not followed with this one's id.
 */
import { CYCLES, safeHref } from '../cycles/cycleModel.js';
import { canonicalVentureSearch, ventureRef } from '../cycles/ventureQuery.js';
import { CYCLE_KEYS, cycleTileState } from '../studio/studioLayoutModel.js';
import { READY, questionsOf } from './founderStudioModel.js';

/** The Next card's states. */
export const NEXT = Object.freeze({ LOADING: 'loading', UNREADABLE: 'unreadable', NONE: 'none', READY: 'ready' });

export const NEXT_UNREADABLE = 'Your next steps could not be read. This is not a sign that nothing is waiting.';
export const NEXT_NONE_TITLE = 'None of your placed modules has a next step';
export const NEXT_NONE_BODY = 'Each module was read and named nothing to do. Add a module, or open a cycle.';
export const CHOOSE_TITLE = 'Which venture are you working on?';
export const VENTURES_UNREADABLE = 'Your ventures could not be read. This is not a sign that you have none.';
export const FIRST_VENTURE_HREF = '/build?new=1';

/**
 * Where a task link goes, for the venture Studio shows: `{ to, add }`, or null
 * for an address Studio does not follow (not a path on this site, or one that
 * names another venture).
 */
export function studioTaskLink(href, ventureId) {
  const safe = safeHref(href);
  if (!safe) return null;
  const [rest, hash = ''] = safe.split('#');
  const [path, query = ''] = rest.split('?');
  const params = new URLSearchParams(query);
  const named = ventureRef(params);
  if (named && named.id != null && ventureId != null && String(named.id) !== String(ventureId)) return null;
  const add = params.get('add') === '1';
  params.delete('add');
  const id = ventureId ?? named?.id ?? null;
  const search = canonicalVentureSearch(params, id);
  const to = `${add ? `${path.replace(/\/+$/, '')}/new` : path}${search}${hash ? `#${hash}` : ''}`;
  return { to, add };
}

/** "Add feature to Atlas Orchard": a task's accessible name carries the venture (SFD14). */
export function taskName(text, venture) {
  const t = String(text || '').trim();
  if (!venture) return t;
  return /^(add|create|record|upload|new)\b/i.test(t) ? `${t} to ${venture}` : `${t} in ${venture}`;
}

/** Two letters for a venture's chip. */
export function ventureInitials(name) {
  return String(name || '').replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 2)
    .map((w) => w[0]).join('').toUpperCase() || '?';
}

/**
 * The Next card from the placed modules (`shown`, in layout order), their
 * cycles' overview reads and the page's reads.
 *
 * - LOADING while the layout or any placed cycle's read is still out, so the
 *   first step (the one primary) never jumps when a slower read lands.
 * - READY with the steps, when at least one module names one.
 * - UNREADABLE when none does and at least one placed cycle's read failed:
 *   a failed read is never drawn as "nothing to do".
 * - NONE when every placed module was read and named nothing.
 */
export function nextStepsOf({ shown = [], cycles = {}, reads = {}, ventureId = null, layoutRead = 'ready' } = {}) {
  if (layoutRead === 'loading') return { state: NEXT.LOADING, steps: [] };
  const steps = [];
  let loading = false;
  let failed = false;
  for (const item of Array.isArray(shown) ? shown : []) {
    const key = item?.key;
    const def = key ? CYCLE_KEYS[key] : null;
    if (def) {
      const read = cycles[def.cycle];
      if (read === undefined) { loading = true; continue; }
      if (!read || read.failed) { failed = true; continue; }
      const { card } = cycleTileState(read, def.slug);
      if (card?.state === 'unreadable') { failed = true; continue; }
      const text = card?.next?.text ? String(card.next.text).trim() : '';
      if (!text) continue;
      const link = card.next.href ? studioTaskLink(card.next.href, ventureId) : null;
      steps.push({
        key,
        source: `${CYCLES[def.cycle]?.name || def.cycle} · ${def.name}`,
        text,
        detail: card.state === 'empty' && card.reason ? String(card.reason) : null,
        to: link?.to || null,
        add: !!link?.add,
      });
    } else if (key === 'eadwyn_questions') {
      const q = questionsOf(reads);
      if (q.state !== READY) continue;
      const open = q.open ?? q.items.length;
      if (open > 0) steps.push({ key, source: 'Eadwyn', text: `${open} ${open === 1 ? 'question is' : 'questions are'} waiting on you`, detail: null, to: null, add: false, eadwyn: true });
    }
  }
  if (loading) return { state: NEXT.LOADING, steps: [] };
  if (steps.length) return { state: NEXT.READY, steps };
  return { state: failed ? NEXT.UNREADABLE : NEXT.NONE, steps: [] };
}

/** The questions Eadwyn has waiting, for the phone's collapsed row; null when not read. */
export function waitingQuestions(reads) {
  const q = questionsOf(reads || {});
  if (q.state !== READY) return null;
  return q.open ?? q.items.length;
}

/** The page's heading and its line, by the venture read (SFD03, SFD09, SFD10, SFD08). */
export function ventureHeadOf({ project, ventures }) {
  if (project === undefined) return { kind: 'loading', title: null };
  if (project && project.unavailable) return { kind: 'unavailable', title: 'Venture not available' };
  if (project && project.choose) return { kind: 'choose', title: 'Studio' };
  if (project && project.failed) return { kind: 'unreadable', title: 'Studio' };
  if (!project) return { kind: ventures && ventures.failed ? 'unreadable' : 'first', title: 'Studio' };
  return { kind: 'venture', title: String(project.name || '').trim() || `Venture ${project.id}` };
}
