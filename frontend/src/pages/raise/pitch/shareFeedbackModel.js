// D6064 (#6064) — Share & analytics, viewer feedback: what the founder's read
// (`GET /api/decks/:id/share-feedback`, `lib/api/deckShareFeedback.js`) draws.
// Pure, so it is tested without a page. Viewers are "Signed-in viewer" or
// "Anonymous" and nothing more: the read carries no identity, and this model
// never looks for one.

export const FEEDBACK_EMPTY = 'No viewer has sent feedback or reactions yet. They appear here when a reader sends them from their link.';
export const FEEDBACK_UNREADABLE = "Feedback couldn't be read.";
export const FEEDBACK_REFUSED = "Only the venture's owner and co-founders see viewer feedback.";
export const DISCOVERY_NOTE = 'Each written note also appears on the Customer Discovery panel, as an interview with a deck viewer. It is the same note, not a second one.';
export const NO_LINK = 'No link recorded';

const REACTIONS = { like: 'Like', confused: 'Confused', confusing: 'Confused', want_more: 'Want more' };
export const REACTION_ORDER = Object.freeze(['like', 'confused', 'want_more']);

/** A reaction's words; an unknown value is shown as it was sent. */
export const reactionLabel = (r) => REACTIONS[r] || String(r || '');
const reactionKey = (r) => (r === 'confusing' ? 'confused' : r);

/** The block's state: the read's, then refused, then whether there is anything. */
export function feedbackState(read) {
  if (!read || read.status === 'loading' || read.status === 'idle') return 'loading';
  if (read.status === 'refused') return 'refused';
  if (read.status === 'error' || !read.data) return 'unreadable';
  return Array.isArray(read.data.items) && read.data.items.length ? 'ready' : 'empty';
}

/** A failed read's state: a 403 or 404 is a refusal, anything else is Unreadable. */
export const failedStatus = (e) => (e?.status === 403 || e?.status === 404 ? 'refused' : 'error');

export const viewerLabel = (viewer) => (viewer === 'signed_in' ? 'Signed-in viewer' : 'Anonymous');

/** The items by the link they came through, newest link first; feedback with no link is one group at the end. */
export function byLink(items) {
  const groups = new Map();
  for (const it of Array.isArray(items) ? items : []) {
    const key = it?.link?.id != null ? `link:${it.link.id}` : 'none';
    if (!groups.has(key)) {
      const inv = it?.link?.investor;
      groups.set(key, {
        key,
        label: it?.link ? (inv?.label || 'An investor link') : NO_LINK,
        fund: it?.link ? (inv?.fund || null) : null,
        version: it?.version ?? null,
        items: [],
      });
    }
    groups.get(key).items.push(it);
  }
  const list = [...groups.values()];
  return [...list.filter((g) => g.key !== 'none'), ...list.filter((g) => g.key === 'none')];
}

/** Reactions per card across the given items, in card order: each card's count per reaction. */
export function cardTally(items) {
  const cards = new Map();
  for (const it of Array.isArray(items) ? items : []) {
    for (const r of Array.isArray(it?.reactions) ? it.reactions : []) {
      const key = r.card_uid || `place:${r.place}`;
      if (!cards.has(key)) cards.set(key, { key, place: r.place ?? null, title: r.title || (r.place != null ? `Card ${Number(r.place) + 1}` : 'A card'), counts: {} });
      const k = reactionKey(r.reaction);
      const c = cards.get(key).counts;
      c[k] = (c[k] || 0) + 1;
    }
  }
  return [...cards.values()].sort((a, b) => (a.place ?? 1e9) - (b.place ?? 1e9));
}

/** "Showing the newest 200" when the read stopped at its cap; null otherwise. */
export const capLine = (data) => (data?.truncated ? `Showing the newest ${Number(data.cap) || 0}. Older feedback is not shown here.` : null);

/** The structured answers a viewer gave beside the note, as label and value. */
export function answersOf(it) {
  const out = [];
  if (it?.problem_fit) out.push(['Problem fit', { strong: 'Strong', mild: 'Mild', none: 'None' }[it.problem_fit] || it.problem_fit]);
  if (it?.willingness_to_pay) out.push(['Would pay', it.willingness_to_pay]);
  return out;
}
