// D813 (#2259) — the newsletter pages' words and rules, pure, so the pages
// and their tests share one copy.
//
// THE TOPICS ARE MIGRATION 515'S. There is no public read of the topic list,
// so the six public topics and every label are written here and
// `frontend/test/newsletter_pages_d813.test.mjs` holds them equal to
// `cloudflare-worker/sql/migrations/515_newsletter_lists.sql`. The member's
// card (D1) reads its labels from `GET /api/me/newsletters` instead.
//
// THE SIGNUP NEVER SAYS WHETHER AN ADDRESS IS SUBSCRIBED. D810's subscribe
// route answers the same for a new, a pending, a confirmed and a suppressed
// address, so this page has one "sent" sentence, and it covers the
// already-subscribed case without asserting it.

/** Migration 515's topics, in its `sort_order`: key, label and audience. */
export const NEWSLETTER_TOPICS = [
  { key: 'brief', label: 'The Axal VC Brief', audience: 'public' },
  { key: 'portfolio', label: 'Portfolio news', audience: 'public' },
  { key: 'founder_calls', label: 'Founder calls', audience: 'public' },
  { key: 'events', label: 'Events', audience: 'public' },
  { key: 'insights', label: 'Insights', audience: 'public' },
  { key: 'announcements', label: 'Announcements', audience: 'public' },
  { key: 'partner_letter', label: 'Partner letter', audience: 'investors' },
  { key: 'testing_calls', label: 'Testing calls', audience: 'public' },
];

/** The six the website offers (W1). The last two are added by a member's role (D1). */
export const PUBLIC_TOPIC_KEYS = ['brief', 'portfolio', 'founder_calls', 'events', 'insights', 'announcements'];

/** The board's one-line note beside a public topic. */
export const TOPIC_NOTES = { brief: 'Monthly' };

export const PUBLIC_TOPICS = PUBLIC_TOPIC_KEYS.map((k) => NEWSLETTER_TOPICS.find((t) => t.key === k));

/** A topic's label, or its key in words for one 515 does not name. */
export function topicLabel(key) {
  const t = NEWSLETTER_TOPICS.find((x) => x.key === key);
  return t ? t.label : String(key || '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

export const BLOCK_TITLE = 'The Axal VC Brief';
export const BLOCK_LINE = 'Monthly: essays, portfolio news, open roles and events.';
export const FINE_PRINT = "We'll email you to confirm. Unsubscribe in one click from any email.";

/**
 * The sent state, whatever the address. The second sentence is the board's
 * "already subscribed" state, worded so it never says whether this address is.
 */
export const SENT_TITLE = 'Check your inbox to confirm.';
export const SENT_NOTE = "If that email is already subscribed, we've sent a link to manage your topics instead.";

const SIGNUP_REFUSALS = {
  invalid_email: 'Enter a valid email address.',
  turnstile_failed: 'Verification failed. Complete the challenge again.',
  newsletter_unconfigured: 'Newsletter signups are not open yet. Try again later.',
};

/** A refused signup as a sentence. Nothing about the address's own state is in any of them. */
export function signupError(e) {
  if (e?.status === 429) return 'Too many attempts. Wait a minute, then try again.';
  return SIGNUP_REFUSALS[e?.code] || 'Your signup could not be sent. Try again.';
}

/** A rough shape check before the request: the route's own rule decides. */
export const looksLikeEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim());

/**
 * The subscribe body: the address and the picked topics, in 515's order.
 * Only the six public keys are sent; anything else the page holds is dropped.
 */
export function signupBody({ email, picked, turnstileToken = '', hp = '' }) {
  return {
    email: String(email || '').trim(),
    topics: PUBLIC_TOPIC_KEYS.filter((k) => picked?.[k]),
    turnstileToken,
    hp,
  };
}

/** The phrase for a count: "1 newsletter", "3 newsletters". */
export const newsletterCount = (n) => `${n} newsletter${n === 1 ? '' : 's'}`;

/** W2: a refused confirm check or confirm, as a page state. A 410 is an expired or used link. */
function confirmFailure(error) {
  if (error.code === 'token_expired') return { state: 'expired' };
  if (error.code === 'token_invalid') return { state: 'invalid' };
  if (error.code === 'newsletter_unconfigured') return { state: 'unconfigured' };
  return { state: 'error' };
}

/**
 * W2: the link check (`GET`, which changes nothing since S1's review of D810)
 * as a page state: a usable link waits for the person to press Confirm.
 */
export function checkView(result, error) {
  if (error) return confirmFailure(error);
  return result?.status === 'confirmed' ? confirmView(result, null) : { state: 'ready' };
}

/**
 * W2: the confirm (`POST`) as a page state. D810 answers `{ ok, status }` and,
 * should it ever carry them, the topics.
 */
export function confirmView(result, error) {
  if (error) return confirmFailure(error);
  const topics = Array.isArray(result?.topics) ? result.topics.map((t) => (typeof t === 'string' ? topicLabel(t) : t?.label)).filter(Boolean) : null;
  return { state: 'confirmed', topics };
}

/** The confirmed page's heading: the count when the route says it, else the plain sentence. */
export function confirmedTitle(topics) {
  return Array.isArray(topics) && topics.length
    ? `You're subscribed to ${newsletterCount(topics.length)}.`
    : "You're subscribed.";
}

/** W3: a failed preferences read or write as a page state. */
export function preferencesFailure(error) {
  if (error?.status === 403 || error?.code === 'token_invalid') return 'invalid';
  if (error?.code === 'newsletter_unconfigured') return 'unconfigured';
  return 'error';
}

/** The topics the preferences page draws, from the read's `{ key: bool }`, in 515's order. */
export function preferenceRows(topics) {
  const map = topics && typeof topics === 'object' ? topics : {};
  const known = NEWSLETTER_TOPICS.filter((t) => t.key in map).map((t) => t.key);
  const extra = Object.keys(map).filter((k) => !known.includes(k));
  return [...known, ...extra].map((key) => ({ key, label: topicLabel(key), enabled: Boolean(map[key]) }));
}

/** Only what changed from what was read, as `{ key: bool }`; null when nothing has. */
export function changedChoices(stored, draft) {
  const out = {};
  for (const [k, v] of Object.entries(draft || {})) {
    if (Boolean(stored?.[k]) !== Boolean(v)) out[k] = Boolean(v);
  }
  return Object.keys(out).length ? out : null;
}

/** The unsubscribed page's sentence (W3). */
export function unsubscribedLine(topic) {
  return topic ? `You're unsubscribed from ${topicLabel(topic)}.` : "You're unsubscribed from every Axal VC newsletter.";
}

/**
 * D1: the member's topics from `GET /api/me/newsletters`, split as the board
 * draws them: the website's six, then the ones a role adds.
 */
export function memberGroups(payload) {
  const rows = Array.isArray(payload?.topics) ? payload.topics : [];
  const toRow = (t) => ({ key: t.key, label: t.label || topicLabel(t.key), description: t.description || '', enabled: Boolean(t.enabled) });
  return {
    general: rows.filter((t) => PUBLIC_TOPIC_KEYS.includes(t.key)).map(toRow),
    role: rows.filter((t) => !PUBLIC_TOPIC_KEYS.includes(t.key)).map(toRow),
  };
}

/** The board's line under the card; nothing when the read carries no address. */
export const sentToLine = (email) => (email ? `Sent to ${email} by Axal VC Mail.` : '');

/** A refused member save as a sentence. */
export function memberSaveError(e) {
  if (e?.code === 'topic_not_allowed') return e.message || 'The partner letter is for investors and LPs.';
  return e?.message || 'Your choice could not be saved. Nothing was changed.';
}
