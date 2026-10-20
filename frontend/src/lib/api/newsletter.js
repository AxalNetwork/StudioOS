// D810 (#2256) — newsletter lists. Worker: routes/newsletter.ts, migration 515.
// No UI yet (D813); the pages that call these come with it.
//
// Public, no session needed (a signed token in the query is the authority):
//   POST /api/newsletter/subscribe { email, topics[], turnstileToken, hp } → { ok, message },
//        the same answer whatever the address's state; 403 turnstile_failed
//   GET  /api/newsletter/confirm?token=              → { ok, status }; 410 token_invalid | token_expired
//   GET  /api/newsletter/preferences?token=          → { email (masked), status, topics: { <key>: bool } }
//   PUT  /api/newsletter/preferences?token= { topics: { <key>: bool } }
//   POST /api/newsletter/unsubscribe?token=[&topic=] → { ok, topic, status }
//   A forged or retired token is 403 token_invalid. Every one is 503
//   newsletter_unconfigured in production until NEWSLETTER_TOKEN_KEY is set.
//
// Signed in, on the account email:
//   GET  /api/me/newsletters → { email, status, topics: [{ key, label, description, audience, enabled }] }
//   PUT  /api/me/newsletters { topics: { <key>: bool } }; 403 topic_not_allowed for the
//        partner letter unless the member is an investor or LP
import { request } from '../api.js';

const q = (token, topic) =>
  `?token=${encodeURIComponent(token)}${topic ? `&topic=${encodeURIComponent(topic)}` : ''}`;

export const newsletterApi = {
  subscribe: ({ email, topics = [], turnstileToken = '', hp = '' }) =>
    request('/newsletter/subscribe', { method: 'POST', body: JSON.stringify({ email, topics, turnstileToken, hp }) }),
  confirm: (token) => request(`/newsletter/confirm${q(token)}`),
  preferences: (token) => request(`/newsletter/preferences${q(token)}`),
  savePreferences: (token, topics) =>
    request(`/newsletter/preferences${q(token)}`, { method: 'PUT', body: JSON.stringify({ topics }) }),
  unsubscribe: (token, topic) => request(`/newsletter/unsubscribe${q(token, topic)}`, { method: 'POST' }),
  mine: () => request('/me/newsletters'),
  saveMine: (topics) => request('/me/newsletters', { method: 'PUT', body: JSON.stringify({ topics }) }),
};
