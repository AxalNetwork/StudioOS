// D722 — "Continue with Google" through Google's own window on /login.
// Worker: routes/auth_google.ts. `config` says whether this deployment has
// switched the window on and which client to open it for (a pure read; the
// button never waits on it). `popup` hands the Worker the code Google's window
// returned, with that attempt's state; the answer is { token, user,
// new_signup }, as passkey sign-in's is.
import { request } from '../api.js';

export const googleSignInApi = {
  config: () => request('/auth/google/config'),
  // The Worker refuses this POST without the header. It is not in the CORS
  // allowHeaders, so no page on another origin can send it.
  popup: (body) => request('/auth/google/popup', {
    method: 'POST',
    headers: { 'X-Requested-With': 'XmlHttpRequest' },
    body: JSON.stringify(body),
  }),
};
