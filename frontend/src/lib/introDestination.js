/**
 * #4609 — the reading half of the introduction destination contract.
 * `cloudflare-worker/src/services/introDestination.ts` is the writing half,
 * and the pair is pinned by `frontend/test/intro_destination_4609.test.mjs`.
 *
 * WHAT THIS RESOLVES, AND WHY A UID ALONE WAS NOT ENOUGH. Two unrelated
 * introduction systems put a uid in the same query key — propositions
 * (`intro_propositions`) and teammate requests (`relationship_interactions`,
 * D4329) — and both surfaces live on the one `/network/introductions` zone.
 * Each matched the uid against its own rows to decide whether to highlight it,
 * so a uid from the other system was indistinguishable from a record that had
 * been deleted: the teammate desk announced "that request is no longer here"
 * for every proposition link. `kind` settles it, and `mine()` below is how a
 * surface asks whether a target is addressed to it.
 *
 * THE LEGACY SHAPE STILL RESOLVES. Links already sent by email cannot be
 * rewritten, so `?tab=introductions&intro=<uid>` is read too. It carries no
 * `kind`, which resolves to `null` — and a null kind means "unknown", under
 * which `mine()` says yes to both surfaces. That is exactly today's behaviour,
 * each surface matching by uid, so an old link behaves as it always did while a
 * new one is unambiguous. Backward compatibility is this function's job and not
 * the builder's; nothing emits the legacy form any more.
 */

export const INTRO_ZONE = '/network/introductions';
export const INTRO_KINDS = ['proposition', 'request'];

/** The zone slug a `?tab=` value names, for a legacy link that landed on `/network`. */
export const LEGACY_TABS = ['relationships', 'introductions', 'organizations'];

/**
 * The record a URL asks for: `{ uid, kind }`, with `kind` null when the link
 * does not say (every legacy link, and any hand-typed one).
 *
 * Takes a `URLSearchParams`, a query string or a `Location`-ish object, so a
 * caller can pass `useSearchParams()[0]` or `location.search` without ceremony.
 */
export function resolveIntroTarget(input) {
  const params = asParams(input);
  if (!params) return { uid: '', kind: null };
  const uid = String(params.get('intro') || '').trim();
  if (!uid) return { uid: '', kind: null };
  const raw = String(params.get('kind') || '').trim().toLowerCase();
  return { uid, kind: INTRO_KINDS.includes(raw) ? raw : null };
}

/**
 * Whether a resolved target is this surface's to claim.
 *
 * A target with no uid is nobody's. A target whose kind is known belongs to
 * that one surface. A target with an UNKNOWN kind belongs to both, because the
 * link did not say and refusing it would make a legacy notification open
 * nothing at all — the surface that holds the uid wins by holding it, which is
 * how this worked before `kind` existed.
 */
export function introTargetIsMine(target, kind) {
  if (!target?.uid) return false;
  if (!target.kind) return true;
  return target.kind === kind;
}

/**
 * The zone a legacy `/network?tab=<slug>` link meant, or null when the query
 * names no zone. `NetworkWorkspace` reads this to forward such a link to the
 * path the slug names, carrying `intro` and `kind` across, because that shell
 * resolves its zone from the pathname and a bare `/network` renders the
 * overview — which is where partner and advisor proposition notifications used
 * to stop.
 */
export function legacyZonePath(input) {
  const params = asParams(input);
  if (!params) return null;
  const tab = String(params.get('tab') || '').trim().toLowerCase();
  if (!LEGACY_TABS.includes(tab)) return null;
  const next = new URLSearchParams();
  // Only the two keys the destination contract owns travel. `mode=workspace`
  // and `project_id` are other features' and are carried through untouched.
  for (const key of ['intro', 'kind', 'project_id']) {
    const value = params.get(key);
    if (value) next.set(key, value);
  }
  const query = next.toString();
  return `/network/${tab}${query ? `?${query}` : ''}`;
}

/** The canonical destination, for a frontend link that needs to build one. */
export function introDestination(kind, uid) {
  const id = typeof uid === 'string' ? uid.trim() : '';
  if (!id || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return INTRO_ZONE;
  return `${INTRO_ZONE}?intro=${encodeURIComponent(id)}&kind=${kind}`;
}

function asParams(input) {
  if (!input) return null;
  if (typeof input.get === 'function') return input;
  if (typeof input === 'string') return new URLSearchParams(input);
  if (typeof input.search === 'string') return new URLSearchParams(input.search);
  return null;
}
