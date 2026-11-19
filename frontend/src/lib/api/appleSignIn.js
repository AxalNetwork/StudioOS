// D6957 — "Continue with Apple". Worker: routes/auth_apple.ts. `config` says
// whether this deployment has Sign in with Apple configured (env only; /login
// shows the Apple button only when it answers configured). `startUrl` asks
// /start for Apple's authorization URL with { action, redirect, lane }; the
// page then navigates the whole tab there (Apple returns by form POST, never
// into a popup). `unlink` removes the linked Apple ID from Account → Security.
import { request } from '../api.js';

export const appleSignInApi = {
  config: () => request('/auth/apple/config'),
  startUrl: (params = {}) => {
    const qs = new URLSearchParams();
    if (params.action) qs.set('action', params.action);
    if (params.redirect) qs.set('redirect', params.redirect);
    if (params.lane) qs.set('lane', params.lane);
    const q = qs.toString();
    return request(`/auth/apple/start${q ? `?${q}` : ''}`, { headers: { accept: 'application/json' } });
  },
  unlink: () => request('/settings/connected-accounts/apple/unlink', { method: 'POST' }),
};
