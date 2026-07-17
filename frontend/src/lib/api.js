import { reportError } from './log';

const BASE = '/api';

function getAuthHeaders() {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// T6 — read the JS-readable CSRF cookie and mirror it into the X-CSRF-Token
// header on mutating requests. The double-submit pattern proves the request
// originated from same-origin JS (a cross-site attacker on another origin
// cannot read the cookie). Returns {} when the cookie is absent — e.g. in
// dev (FastAPI doesn't set it) or before the user has logged in. The worker
// only enforces CSRF when an auth cookie is also present, so a missing
// header is harmless on Bearer-auth or unauth'd calls.
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
function getCsrfHeader(method) {
  if (!method || !MUTATING_METHODS.has(method.toUpperCase())) return {};
  if (typeof document === 'undefined') return {};
  const cookie = document.cookie || '';
  for (const part of cookie.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    if (trimmed.slice(0, eq) === 'studioos_csrf') {
      return { 'X-CSRF-Token': trimmed.slice(eq + 1) };
    }
  }
  return {};
}

// BLOCK-AUTH-03 — global step-up coordination. When the worker returns
// 403 {code:'step_up_required'}, request() calls requestStepUp(), which fans out
// a `studioos:step_up_required` event carrying a `done(ok)` callback. A globally
// mounted <StepUpModal> collects a fresh TOTP, POSTs /auth/step-up, then calls
// done(true) so the original request is retried once. Concurrent 403s share one
// in-flight prompt. If no modal is mounted (e.g. nothing listening), we fail
// fast via the synchronous `ack` flag so the request never hangs.
let _stepUpInFlight = null;
function requestStepUp(ttlMinutes) {
  if (_stepUpInFlight) return _stepUpInFlight;
  _stepUpInFlight = new Promise((resolve, reject) => {
    if (typeof window === 'undefined') { reject(new Error('step_up_unavailable')); return; }
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      _stepUpInFlight = null;
      if (ok) resolve(); else reject(new Error('step_up_cancelled'));
    };
    const detail = { ttlMinutes: ttlMinutes || 15, done, ack: false };
    window.dispatchEvent(new CustomEvent('studioos:step_up_required', { detail }));
    if (!detail.ack) done(false); // no modal listening — surface the original 403
  });
  return _stepUpInFlight;
}

// Task #8 — the catch-all 404 page marks itself as a no-auth-redirect surface
// while it is mounted (setSuppressAuthRedirect(true) on mount, false on
// unmount). A background 401 — e.g. SettingsProvider probing
// /api/settings/appearance on first paint — must NOT bounce a logged-OUT
// visitor who hit an UNKNOWN url to /login; they should see the 404 page.
// Deliberately scoped to the 404 surface only: the flag is false on every
// real page, so genuinely-expired sessions on protected pages still bounce.
let _suppressAuthRedirect = false;
export function setSuppressAuthRedirect(v) {
  _suppressAuthRedirect = !!v;
}

export async function request(path, options = {}) {
  try {
    // FormData uploads must NOT carry an explicit Content-Type — the browser
    // sets it (with the multipart boundary). Setting application/json here
    // would corrupt the request body.
    const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
    const csrfHeader = getCsrfHeader(options.method);
    const baseHeaders = isFormData
      ? { ...getAuthHeaders(), ...csrfHeader, ...options.headers }
      : { 'Content-Type': 'application/json', ...getAuthHeaders(), ...csrfHeader, ...options.headers };
    const res = await fetch(`${BASE}${path}`, {
      // T6 — `credentials: 'include'` makes the browser attach the
      // `studioos_auth` httpOnly cookie set by /api/auth/login. Same-origin
      // requests would send it anyway with `same-origin`, but `include` is
      // safer for any future cross-origin SPA host (e.g. previews) and is
      // the explicit default for cookie-auth APIs.
      credentials: 'include',
      headers: baseHeaders,
      ...options,
    });
    if (!res.ok) {
      // Public token-gated endpoints (partner onboarding, esign signing,
      // public profile reads) must never trigger an auth-redirect — a 401
      // here typically means the dev FastAPI backend lacks the worker-only
      // route, not "your session expired".
      const isPublicEndpoint = path.startsWith('/partner-onboard')
        || path.startsWith('/esign/sign')
        || path.startsWith('/public/')
        || path.startsWith('/decks/share/');
      if (res.status === 401 && !path.startsWith('/auth/') && !isPublicEndpoint) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        // Only force a /login redirect when we're on a protected page.
        // Public marketing/onboarding pages must stay reachable for
        // anonymous visitors AND for previously-signed-in users with a
        // now-expired session (otherwise axal.vc/ bounces them to
        // /login the moment useAuthSync probes /auth/me).
        const currentPath = window.location.pathname;
        const isPublicPath = currentPath === '/'
          || currentPath === '/login'
          || currentPath === '/register'
          || currentPath === '/verify-email'
          || currentPath === '/spinout-lab'
          // Audience product pages (For Founders / Investors & LPs / Service
          // Partners / Advisors) — public marketing surfaces. A background
          // settings/me 401 for an anonymous visitor must not bounce them to
          // /login (mirrors /spinout-lab above).
          || currentPath === '/for-founders'
          || currentPath === '/for-investors'
          || currentPath === '/for-service-partners'
          || currentPath === '/for-advisors'
          // Audience-specific marketing landing pages (/lp/founder,
          // /lp/investor, /lp/partner, /lp/customer-discovery,
          // /lp/spinout-demo-day). Public surfaces: a background
          // settings/me 401 for an anonymous visitor must not bounce
          // them to /login.
          || currentPath.startsWith('/lp/')
          || currentPath === '/directory'
          // Task #9 — Public Network layer: Circles (+ /communities redirect).
          // Public marketing surfaces: a background settings/me 401 for an
          // anonymous visitor must not bounce them to /login.
          || currentPath === '/circles'
          || currentPath === '/communities'
          || currentPath === '/roadmap'
          || currentPath === '/about'
          || currentPath === '/contact'
          // Task #5 — /articles is the public Articles hub (Browse tab is the
          // default, anonymous-visible surface). Keep it reachable for signed-
          // out visitors when a background fetch (settings/me) 401s. The
          // auth-only sub-routes (/articles/mine, /articles/draft,
          // /articles/edit/:id) are intentionally NOT listed so a genuine
          // session expiry there still bounces to /login.
          || currentPath === '/articles'
          || currentPath.startsWith('/pricing/')
          || currentPath.startsWith('/partner-onboarding/')
          || currentPath.startsWith('/partners/onboard')
          || currentPath.startsWith('/esign/')
          || currentPath.startsWith('/deck/share/')
          || currentPath.startsWith('/share/deck/')
          || currentPath.startsWith('/insights')
          || currentPath.startsWith('/settings/email/')
          // Task #5 — Public event surface (no auth)
          || currentPath === '/events'
          || currentPath.startsWith('/events/')
          // Public job board surface (no auth): /jobs (feed) and
          // /jobs/:slug (detail) must stay reachable for anonymous
          // visitors when a background settings/me 401 fires.
          || currentPath === '/jobs'
          || currentPath.startsWith('/jobs/')
          || currentPath.startsWith('/invite/');
        // `_suppressAuthRedirect` is set only while the catch-all 404 page is
        // mounted (an unknown URL), so a logged-out visitor there sees the 404
        // instead of being bounced to /login by this background 401.
        if (!isPublicPath && !_suppressAuthRedirect) {
          // Task #10 — capture the bounce BEFORE the hard navigation tears the
          // tab down. The reportError beacon uses keepalive so it still lands
          // even though we're about to leave the page; this is what makes a
          // silent "session expired → /login" redirect debuggable in prod.
          reportError('api:session-expired-redirect', new Error(`401 on ${path}; redirecting ${currentPath} → /login`));
          window.location.href = '/login';
        }
        throw new Error('Session expired');
      }
      const err = await res.json().catch(() => ({}));
      // Detail can be a structured dict (FastAPI) or a string. The Cloudflare
      // worker returns `error` as either a string or an object. Surface the
      // structured payload to callers via `error.data` so UI can render
      // things like a live cooldown countdown without regex-parsing the msg.
      const detailObj = (err && typeof err.detail === 'object') ? err.detail : null;
      const errorObj = (err && typeof err.error === 'object') ? err.error : null;
      const msg =
        (errorObj && errorObj.message) ||
        (typeof err.error === 'string' && err.error) ||
        (detailObj && detailObj.message) ||
        (typeof err.detail === 'string' && err.detail) ||
        err.message ||
        res.statusText ||
        'Request failed';
      const e = new Error(msg);
      e.status = res.status;
      e.data = detailObj || errorObj || err || null;
      // Task #16 — surface per-field validation errors (e.g. ProfileValidationError)
      // so form components can highlight the offending input.
      e.field = (err && err.field) || (detailObj && detailObj.field) || (errorObj && errorObj.field) || null;
      // Task #6 — when the worker returns 402 `{error:'tier_required'}`, fan
      // out a custom event so PaywallModal opens automatically. Anything that
      // catches the throw afterwards still gets the structured error object.
      if (res.status === 402 && typeof window !== 'undefined') {
        const tierPayload = (err && (err.required ? err : (err.error === 'tier_required' ? err : null))) || null;
        if (tierPayload && tierPayload.required) {
          try {
            // source: 'auto' tells PaywallModal this came from a background
            // 402 (likely a fetch fired on page load). PaywallModal gates
            // auto-fires to once per session so refreshing the page doesn't
            // keep re-opening the same upsell. Explicit user actions (sidebar
            // lock click, CTA buttons) use the default source and always show.
            window.dispatchEvent(new CustomEvent('studioos:tier_required', {
              detail: { required: tierPayload.required, message: tierPayload.message || '', source: 'auto' },
            }));
          } catch { /* noop */ }
        }
      }
      // BLOCK-AUTH-03 — step-up gate. Prompt for a fresh TOTP via the global
      // modal, then retry the ORIGINAL request once. `__steppedUp` guards
      // against an infinite loop; we never intercept the step-up call itself.
      if (
        res.status === 403 &&
        err && err.code === 'step_up_required' &&
        !options.__steppedUp &&
        !path.startsWith('/auth/step-up')
      ) {
        try {
          await requestStepUp(err.ttl_minutes);
        } catch {
          throw e; // user cancelled — surface the original 403
        }
        return request(path, { ...options, __steppedUp: true });
      }
      throw e;
    }
    const data = await res.json().catch(() => {
      throw new Error('Invalid response format from server');
    });
    return data;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(error.message || 'Network error');
  }
}

// Task #13 — analytics read helper. Auto-retries once on 5xx (transient
// worker cold-start / D1 hiccup) with a 1s backoff. Never retries 4xx —
// those are deterministic (auth, bad range, etc) and the caller should
// surface them. Network errors (no `status`) get one retry too.
async function _analyticsRead(path) {
  try {
    return await request(path);
  } catch (e) {
    const status = e?.status;
    const transient = !status || status >= 500;
    if (!transient) throw e;
    await new Promise(r => setTimeout(r, 1000));
    return await request(path);
  }
}

export const api = {
  // Task #19 — Best-Fit consultations + admin report.
  bookConsultation: (data) =>
    request('/consultations/book', { method: 'POST', body: JSON.stringify(data || {}) }),
  getMyConsultations: () => request('/consultations/me'),
  adminListConsultations: (status) =>
    request(`/admin/consultations${status ? `?status=${status}` : ''}`),
  adminUpdateConsultationStatus: (id, data) =>
    request(`/admin/consultations/${id}/status`, { method: 'POST', body: JSON.stringify(data || {}) }),
  adminGetBestFitReport: (userId) => request(`/admin/best-fit/${userId}`),
  register: (data) => request('/auth/register', { method: 'POST', body: JSON.stringify(data) }),
  login: (data) => request('/auth/login', { method: 'POST', body: JSON.stringify(data) }),
  // T6 — server-side logout: clears the httpOnly auth + CSRF cookies and
  // revokes the current user_sessions row. App.jsx calls this before wiping
  // localStorage so a stolen Bearer copy of the JWT can no longer be used.
  logout: () => request('/auth/logout', { method: 'POST' }),
  verifyTotp: (data) => request('/auth/verify-totp', { method: 'POST', body: JSON.stringify(data) }),
  checkVerifyEmail: (token) => request(`/auth/verify-email?token=${encodeURIComponent(token)}`),
  confirmVerifyEmail: (data) => request('/auth/confirm-verify-email', { method: 'POST', body: JSON.stringify(data) }),
  resendVerification: (data) => request('/auth/resend-verification', { method: 'POST', body: JSON.stringify(data) }),
  // Task #6 (IF) — onboarding checklist + product-tour state.
  getOnboardingChecklist: () => request('/onboarding/checklist'),
  completeOnboardingItem: (key) => request(`/onboarding/checklist/${encodeURIComponent(key)}/complete`, { method: 'POST' }),
  skipOnboardingItem: (key) => request(`/onboarding/checklist/${encodeURIComponent(key)}/skip`, { method: 'POST' }),
  resetOnboardingChecklist: () => request('/onboarding/checklist/reset', { method: 'POST' }),
  patchOnboardingMeta: (patch) => request('/onboarding/meta', { method: 'POST', body: JSON.stringify(patch || {}) }),
  setupTotp: (data) => request('/auth/setup-totp', { method: 'POST', body: JSON.stringify(data) }),
  // Task #6 — SMS 2FA (Google Cloud Identity Platform / Firebase Phone Auth).
  // Discovery is unauth (rate-limited per IP). All other endpoints follow the
  // same cookie-auth path as the rest of `api.*` and never echo the full
  // phone number — only the last 4 digits.
  authFactors: (email) => request(`/auth/factors?email=${encodeURIComponent(email)}`),
  smsStatus: () => request('/auth/sms/status'),
  smsStartEnrollment: (phone, country, recaptcha_token) =>
    request('/auth/sms/start-enrollment', { method: 'POST', body: JSON.stringify({ phone, country, recaptcha_token }) }),
  smsConfirmEnrollment: (session_info, code) =>
    request('/auth/sms/confirm-enrollment', { method: 'POST', body: JSON.stringify({ session_info, code }) }),
  smsDisable: () => request('/auth/sms/disable', { method: 'POST' }),
  smsStartChallenge: (email, recaptcha_token) =>
    request('/auth/sms/start-challenge', { method: 'POST', body: JSON.stringify({ email, recaptcha_token }) }),
  smsVerifyChallenge: (email, session_info, code) =>
    request('/auth/sms/verify-challenge', { method: 'POST', body: JSON.stringify({ email, session_info, code }) }),
  getMe: () => request('/auth/me'),
  // Task #51 — "Continue with Google" sign-in. /auth/google/start returns
  // {url} when called with Accept: application/json so the SPA can do a
  // top-level navigation (window.location.href = url). 503 means the
  // env vars GOOGLE_AUTH_CLIENT_ID/SECRET aren't set — the buttons hide.
  googleStartUrl: (params = {}) => {
    const qs = new URLSearchParams();
    if (params.action) qs.set('action', params.action);
    if (params.redirect) qs.set('redirect', params.redirect);
    const q = qs.toString();
    return request(`/auth/google/start${q ? `?${q}` : ''}`, { headers: { accept: 'application/json' } });
  },
  getConnectedAccounts: () => request('/settings/connected-accounts'),
  unlinkGoogle: () => request('/settings/connected-accounts/google/unlink', { method: 'POST' }),
  // BLOCK-AUTH-01 — passwordless magic-link sign-in. /start always returns the
  // same 202 (no account-existence leak); the link in the email hits the
  // worker's GET /magic/verify which sets cookies and 302s into the SPA.
  magicStart: (email) => request('/auth/magic/start', { method: 'POST', body: JSON.stringify({ email }) }),
  // BLOCK-AUTH-03 — step-up: re-assert a RECENT TOTP for the current session.
  stepUp: (totp_code) => request('/auth/step-up', { method: 'POST', body: JSON.stringify({ totp_code }) }),
  // NICE-AUTH-04 — sign out every active session (alias of revokeAllSessions).
  signOutEverywhere: () => request('/auth/sign-out-everywhere', { method: 'POST', body: JSON.stringify({}) }),
  // BLOCK-AUTH-02 — passkeys / WebAuthn. register-* require an authed session;
  // auth-* are the passwordless login path keyed by email.
  passkey: {
    registerOptions: () => request('/auth/passkey/register-options'),
    registerVerify: (attResp, label) =>
      request('/auth/passkey/register-verify', { method: 'POST', body: JSON.stringify({ response: attResp, label }) }),
    authOptions: (email) =>
      request('/auth/passkey/auth-options', { method: 'POST', body: JSON.stringify({ email }) }),
    authVerify: (email, assertionResp) =>
      request('/auth/passkey/auth-verify', { method: 'POST', body: JSON.stringify({ email, response: assertionResp }) }),
    list: () => request('/auth/passkey/list'),
    remove: (id) => request(`/auth/passkey/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  },
  // Task #7 (IG) — Cmd+K + Help widget + Customer chat.
  getRecentActivity: (limit = 20) => request(`/activity/recent?limit=${encodeURIComponent(limit)}`),
  getCustomerChatThread: () => request('/customer-chat/thread'),
  sendCustomerChat: (text) => request('/customer-chat/send', {
    method: 'POST',
    body: JSON.stringify({ text }),
  }),
  health: () => request('/health'),

  // Task #16 — Organizations directory (Network > Organizations). Real VC
  // funds / deep-tech investors served from the backend `organizations` table.
  listOrganizations: (params = {}) => {
    const q = new URLSearchParams();
    const set = (k, v) => { if (v != null && v !== '') q.set(k, String(v)); };
    set('q', params.q);
    set('type', params.type);
    set('region', params.region);
    set('source', params.source);
    set('page', params.page);
    set('page_size', params.page_size);
    const qs = q.toString();
    return request(`/organizations${qs ? `?${qs}` : ''}`);
  },
  getOrganizationFacets: () => request('/organizations/facets'),
  getOrganization: (uid) => request(`/organizations/${encodeURIComponent(uid)}`),

  // Task #15 — Page header explainers (server-synced dismiss list).
  getExplainersDismissed: () => request('/settings/explainers'),
  dismissExplainer: (page_key) => request('/settings/explainer-dismissed', { method: 'POST', body: JSON.stringify({ page_key }) }),
  restoreExplainer: (page_key) => request('/settings/explainer-restore', { method: 'POST', body: JSON.stringify({ page_key }) }),

  // Task #16 — Profile expansion (personal + corporate identity blocks).
  getPersonalProfile: () => request('/settings/profile/personal'),
  updatePersonalProfile: (patch) => request('/settings/profile/personal', { method: 'PUT', body: JSON.stringify(patch) }),
  getCorporateProfile: () => request('/settings/profile/corporate'),
  updateCorporateProfile: (patch) => request('/settings/profile/corporate', { method: 'PUT', body: JSON.stringify(patch) }),

  // AE-1 (Task #1) — tabbed Settings aliases. /identity merges
  // user_settings (timezone/locale/pronouns/profile_slug + display_name +
  // headline) with personal-profile fields (full_legal_name/DOB/
  // nationality). /details is the address+phone+tax slice of the personal
  // profile. /legal-entity is the corporate-profile alias.
  getIdentitySettings: () => request('/settings/profile/identity'),
  updateIdentitySettings: (patch) => request('/settings/profile/identity', { method: 'PUT', body: JSON.stringify(patch) }),
  getProfileDetails: () => request('/settings/profile/details'),
  updateProfileDetails: (patch) => request('/settings/profile/details', { method: 'PUT', body: JSON.stringify(patch) }),
  getLegalEntity: () => request('/settings/profile/legal-entity'),
  updateLegalEntity: (patch) => request('/settings/profile/legal-entity', { method: 'PUT', body: JSON.stringify(patch) }),

  stats: () => request('/dashboard/stats'),

  listProjects: (status) => request(`/projects${status ? `?status=${status}` : ''}`),
  getProject: (id) => request(`/projects/${id}`),
  createProject: (data) => request('/projects', { method: 'POST', body: JSON.stringify(data) }),
  updateProject: (id, data) => request(`/projects/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteProject: (id) => request(`/projects/${id}`, { method: 'DELETE' }),
  // Task #7 (AM) — Admin > Trash management for soft-deleted projects.
  adminListProjectTrash: () => request('/admin/projects/trash'),
  adminRestoreProject: (id) => request(`/admin/projects/${id}/restore`, { method: 'POST' }),
  adminHardDeleteProject: (id) => request(`/admin/projects/${id}/hard-delete`, { method: 'DELETE' }),
  advanceWeek: (id) => request(`/projects/${id}/advance-week`, { method: 'POST' }),

  // Task #1 — Spin-Out teams collaboration: project membership (co-founders +
  // advisors). Management (add/invite/remove/revoke) is owner + admin/partner
  // only and stage-gated server-side; the UI mirrors `can_manage` + `locked`.
  listProjectMembers: (id) => request(`/projects/${id}/members`),
  addProjectMember: (id, data) =>
    request(`/projects/${id}/members`, { method: 'POST', body: JSON.stringify(data || {}) }),
  createProjectInvitation: (id, data) =>
    request(`/projects/${id}/invitations`, { method: 'POST', body: JSON.stringify(data || {}) }),
  revokeProjectInvitation: (id, invId) =>
    request(`/projects/${id}/invitations/${invId}/revoke`, { method: 'POST' }),
  removeProjectMember: (id, userId) =>
    request(`/projects/${id}/members/${userId}`, { method: 'DELETE' }),
  acceptProjectInvitation: (token) =>
    request('/projects/invitations/accept', { method: 'POST', body: JSON.stringify({ token }) }),

  // Epic 5: scoreStartup honours `is_sandbox` (founder practice mode). The
  // server rejects any client-supplied `score`/`tier`/`score_breakdown`.
  scoreStartup: (data) => request('/scoring/score', { method: 'POST', body: JSON.stringify(data) }),
  getScores: (projectId, opts = {}) => request(`/scoring/scores/${projectId}${opts.includeSandbox ? '?include_sandbox=1' : ''}`),
  generateDealMemo: (projectId) => request(`/scoring/score/${projectId}/deal-memo`, { method: 'POST' }),
  getDealMemos: (projectId) => request(`/scoring/deal-memos/${projectId}`),
  scoringQueue: () => request('/scoring/queue'),
  // Admin sign-off queue for flagged / tampered snapshots.
  getScoreFlags: (status = 'flagged') => request(`/monitoring/score-flags?status=${encodeURIComponent(status)}`),
  reviewScoreFlag: (id, decision, notes) => request(`/monitoring/score-flags/${id}/review`, { method: 'POST', body: JSON.stringify({ decision, notes }) }),
  waiveScoreCooldown: (id) => request(`/monitoring/score-flags/${id}/waiver`, { method: 'POST' }),

  listTemplates: () => request('/legal/templates'),
  getTemplateContent: (key) => request(`/legal/templates/${key}`),
  generateDocument: (data) => request('/legal/documents/generate', { method: 'POST', body: JSON.stringify(data) }),
  listDocuments: (projectId) => request(`/legal/documents${projectId ? `?project_id=${projectId}` : ''}`),
  getDocument: (id) => request(`/legal/documents/${id}`),
  incorporateProject: (projectId) => request(`/legal/incorporate?project_id=${projectId}`, { method: 'POST' }),
  // Task #30 — Jurisdiction wizard
  legalJurisdictions: () => request('/legal/jurisdictions'),
  // Task #10 — live company-name availability check (Confirm step).
  legalNameCheck: (jurisdictionId, name) =>
    request(`/legal/name-check?jurisdiction_id=${encodeURIComponent(jurisdictionId)}&name=${encodeURIComponent(name)}`),
  // Task #11 — per-jurisdiction Stripe Checkout (replaces free wizard submit).
  legalIncorporateCheckout: (data) =>
    request('/legal/incorporate/checkout', { method: 'POST', body: JSON.stringify(data) }),
  // Task #6 — embedded-terminal incorporation order. Creates a one-time Stripe
  // Invoice whose PaymentIntent is confirmed in-app (no Checkout redirect) plus
  // a pending order row, and returns an optional annual Registered Agent
  // subscription offer. Body: { project_id, jurisdiction_id, company_name,
  // registered_agent_name?, registered_agent_address? } →
  //   { incorporation_id, client_secret, payment_intent_id, invoice_id,
  //     amount_cents, currency, registered_agent } | { dev:true, status:'paid', … }
  legalIncorporationOrder: (data) =>
    request('/legal/incorporation/order', { method: 'POST', body: JSON.stringify(data) }),
  legalIncorporateStatus: (id) =>
    request(`/legal/incorporate/status?id=${encodeURIComponent(id)}`),
  legalIncorporationOrders: () =>
    request('/legal/incorporate/orders'),
  // Legacy free wizard — still available for admin/back-compat (admin only).
  legalIncorporateWizard: (data) =>
    request('/legal/incorporate/wizard', { method: 'POST', body: JSON.stringify(data) }),
  // Task #31 — Co-founder agreement + 83(b) tracker
  legalCofounderAgreement: (data) =>
    request('/legal/cofounder-agreement', { method: 'POST', body: JSON.stringify(data) }),
  legal83bList: (projectId) =>
    request(`/legal/83b/trackers${projectId ? `?project_id=${projectId}` : ''}`),
  legal83bCreate: (data) =>
    request('/legal/83b/trackers', { method: 'POST', body: JSON.stringify(data) }),
  legal83bUpdate: (id, data) =>
    request(`/legal/83b/trackers/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  // Task #32 — Compliance calendar
  complianceList: (projectId, status) => {
    const q = new URLSearchParams();
    if (projectId) q.set('project_id', String(projectId));
    if (status) q.set('status', status);
    const qs = q.toString();
    return request(`/compliance/events${qs ? `?${qs}` : ''}`);
  },
  complianceCreate: (data) =>
    request('/compliance/events', { method: 'POST', body: JSON.stringify(data) }),
  complianceUpdate: (id, data) =>
    request(`/compliance/events/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  complianceDelete: (id) =>
    request(`/compliance/events/${id}`, { method: 'DELETE' }),

  // Task #40 — Founder wellbeing
  wellbeingMyCheckins: () => request('/wellbeing/checkins'),
  wellbeingSubmit: (data) =>
    request('/wellbeing/checkins', { method: 'POST', body: JSON.stringify(data) }),
  wellbeingAggregate: (days = 30) =>
    request(`/wellbeing/aggregate?days=${days}`),
  wellbeingResources: (params = {}) => {
    const q = new URLSearchParams();
    if (params.category) q.set('category', params.category);
    if (params.region) q.set('region', params.region);
    const qs = q.toString();
    return request(`/wellbeing/resources${qs ? `?${qs}` : ''}`);
  },
  wellbeingResourceCreate: (data) =>
    request('/wellbeing/resources', { method: 'POST', body: JSON.stringify(data) }),
  wellbeingResourceDelete: (id) =>
    request(`/wellbeing/resources/${id}`, { method: 'DELETE' }),
  // Task #8 (DI) — daily pulse + expert directory
  wellbeingDaily: (days = 30) => request(`/wellbeing/daily?days=${days}`),
  // Task #33 — canonical submit endpoint is /wellbeing/checkins; /daily is
  // kept as a backward-compat alias on the worker.
  wellbeingDailySubmit: (data) =>
    request('/wellbeing/checkins', { method: 'POST', body: JSON.stringify(data) }),
  wellbeingExpertCategories: () => request('/wellbeing/experts/categories'),
  wellbeingExperts: (params = {}) => {
    const q = new URLSearchParams();
    const set = (k, v) => { if (v != null && v !== '') q.set(k, String(v)); };
    set('category', params.category);
    set('language', params.language);
    set('modality', params.modality);
    set('price_max', params.price_max);
    set('q', params.q);
    set('limit', params.limit);
    set('tz', params.tz);
    set('budget_max', params.budget_max);
    (params.want_categories || []).forEach((v) => q.append('want_category', v));
    (params.want_languages || []).forEach((v) => q.append('want_language', v));
    (params.want_sectors || []).forEach((v) => q.append('want_sector', v));
    (params.want_modalities || []).forEach((v) => q.append('want_modality', v));
    const qs = q.toString();
    return request(`/wellbeing/experts${qs ? `?${qs}` : ''}`);
  },
  wellbeingExpertGet: (uid) => request(`/wellbeing/experts/${encodeURIComponent(uid)}`),
  wellbeingExpertSlots: (uid) => request(`/wellbeing/experts/${encodeURIComponent(uid)}/slots`),
  wellbeingExpertBook: (uid, data = {}) =>
    request(`/wellbeing/experts/${encodeURIComponent(uid)}/book`, {
      method: 'POST', body: JSON.stringify(data),
    }),
  wellbeingExpertRate: (uid, data) =>
    request(`/wellbeing/experts/${encodeURIComponent(uid)}/rate`, {
      method: 'POST', body: JSON.stringify(data),
    }),
  // Task #4 — expert self-service
  wellbeingExpertApply: (data) =>
    request('/wellbeing/experts/apply', { method: 'POST', body: JSON.stringify(data || {}) }),
  wellbeingExpertMe: () => request('/wellbeing/experts/me'),
  wellbeingExpertMeUpdate: (data) =>
    request('/wellbeing/experts/me', { method: 'PUT', body: JSON.stringify(data) }),
  wellbeingExpertMyServices: () => request('/wellbeing/experts/me/services'),
  wellbeingExpertServiceCreate: (data) =>
    request('/wellbeing/experts/me/services', { method: 'POST', body: JSON.stringify(data) }),
  wellbeingExpertServiceUpdate: (uid, data) =>
    request(`/wellbeing/experts/me/services/${encodeURIComponent(uid)}`, { method: 'PUT', body: JSON.stringify(data) }),
  wellbeingExpertServiceDelete: (uid) =>
    request(`/wellbeing/experts/me/services/${encodeURIComponent(uid)}`, { method: 'DELETE' }),
  wellbeingExpertMyAvailability: () => request('/wellbeing/experts/me/availability'),
  wellbeingExpertAvailabilityCreate: (data) =>
    request('/wellbeing/experts/me/availability', { method: 'POST', body: JSON.stringify(data) }),
  wellbeingExpertAvailabilityDelete: (uid) =>
    request(`/wellbeing/experts/me/availability/${encodeURIComponent(uid)}`, { method: 'DELETE' }),
  wellbeingExpertStripeConnect: () =>
    request('/wellbeing/experts/me/stripe/connect', { method: 'POST', body: '{}' }),
  wellbeingExpertStripeStatus: () => request('/wellbeing/experts/me/stripe/status'),
  wellbeingExpertMyBookings: () => request('/wellbeing/experts/me/bookings'),
  wellbeingExpertBookingPatch: (uid, data) =>
    request(`/wellbeing/experts/me/bookings/${encodeURIComponent(uid)}`, { method: 'PATCH', body: JSON.stringify(data) }),
  wellbeingMyBookings: () => request('/wellbeing/bookings/mine'),
  wellbeingAdminHide: (uid, hidden) =>
    request(`/wellbeing/admin/experts/${encodeURIComponent(uid)}/hide`, {
      method: 'POST', body: JSON.stringify({ hidden: !!hidden }),
    }),
  wellbeingAdminVerify: (uid, verified) =>
    request(`/wellbeing/admin/experts/${encodeURIComponent(uid)}/verify`, {
      method: 'POST', body: JSON.stringify({ verified: !!verified }),
    }),
  articlesByAuthor: (userId) =>
    request(`/articles/by-author/${encodeURIComponent(userId)}`),

  legal83bUploadReceipt: (id, file) => {
    const fd = new FormData();
    fd.append('file', file);
    return request(`/legal/83b/trackers/${id}/receipt`, { method: 'POST', body: fd });
  },
  spinoutProject: (projectId) => request(`/legal/spinout/${projectId}`, { method: 'POST' }),
  listEntities: () => request('/legal/entities'),

  // Task #9 (X-2) — Partner deal engine: admin invitations + deals.
  adminPartners: {
    listInvitations: (opts = {}) => {
      const q = new URLSearchParams();
      if (opts.status) q.set('status', opts.status);
      if (opts.email) q.set('email', opts.email);
      const qs = q.toString();
      return request(`/admin/partners/invitations${qs ? `?${qs}` : ''}`);
    },
    createInvitation: (data) =>
      request('/admin/partners/invitations', { method: 'POST', body: JSON.stringify(data) }),
    resendInvitation: (id) =>
      request(`/admin/partners/invitations/${id}/resend`, { method: 'POST' }),
    revokeInvitation: (id, reason) =>
      request(`/admin/partners/invitations/${id}/revoke`, { method: 'POST', body: JSON.stringify({ reason: reason || '' }) }),
    listDeals: (status = 'active') =>
      request(`/admin/partners/deals?status=${encodeURIComponent(status)}`),
    terminateDeal: (id, reason) =>
      request(`/admin/partners/deals/${id}/terminate`, { method: 'POST', body: JSON.stringify({ reason }) }),
    // Task #26 — operational counters
    listTopDeals: (opts = {}) => {
      const q = new URLSearchParams();
      if (opts.limit) q.set('limit', String(opts.limit));
      if (opts.status) q.set('status', opts.status);
      const qs = q.toString();
      return request(`/admin/partners/deals/top${qs ? `?${qs}` : ''}`);
    },
    dealRedemptions: (id) =>
      request(`/admin/partners/deals/${encodeURIComponent(id)}/redemptions`),
  },
  // Task #9 (X-2) — Public token-gated partner onboarding flow.
  partnerOnboard: {
    get: (token) => request(`/partner-onboard/${encodeURIComponent(token)}`),
    saveProfile: (token, profile) =>
      request(`/partner-onboard/${encodeURIComponent(token)}/profile`, { method: 'POST', body: JSON.stringify(profile) }),
    propose: (token) =>
      request(`/partner-onboard/${encodeURIComponent(token)}/propose`, { method: 'POST', body: JSON.stringify({}) }),
    select: (token, body) =>
      request(`/partner-onboard/${encodeURIComponent(token)}/select`, { method: 'POST', body: JSON.stringify(body) }),
    finalize: (token) =>
      request(`/partner-onboard/${encodeURIComponent(token)}/finalize`, { method: 'POST', body: JSON.stringify({}) }),
    status: (token) => request(`/partner-onboard/${encodeURIComponent(token)}/status`),
  },
  // Task #9 (X-2) — Authenticated partner deal portal.
  partnerPortal: {
    myDeal: () => request('/partner-portal/my-deal'),
    setAcceptingIntros: (value) => request('/partner-portal/accepting-intros', { method: 'PATCH', body: JSON.stringify({ accepting_intros: value }) }),
  },

  // Task #10 (AC-1) — Personal advisor (dashboard chatbot + write-router).
  // /explain returns an SSE stream and is consumed via fetch + ReadableStream
  // in the AC-3 chat UI; we expose a thin URL helper for that consumer
  // instead of wrapping it through request() (which buffers JSON).
  advisor: {
    start: () => request('/advisor/start', { method: 'POST', body: JSON.stringify({}) }),
    answer: (conversation_id, question_id, value, evidence) =>
      request('/advisor/answer', {
        method: 'POST',
        body: JSON.stringify(
          evidence != null && String(evidence).trim()
            ? { conversation_id, question_id, value, evidence: String(evidence).trim() }
            : { conversation_id, question_id, value },
        ),
      }),
    skip: (conversation_id, question_id) =>
      request('/advisor/skip', { method: 'POST', body: JSON.stringify({ conversation_id, question_id }) }),
    progress: () => request('/advisor/progress'),
    // Task #2 (AR) — pinned next-question fetch + canonical manifest.
    nextQuestion: (focus) =>
      request(`/advisor/next-question${focus ? `?focus=${encodeURIComponent(focus)}` : ''}`),
    // Task #2 (CC) — read-only ranked queue used by the right-rail
    // progress widget. Mirrors /turn output but never registers an
    // "asked" timestamp so the widget can re-poll freely.
    queue: (focus) =>
      request(`/advisor/queue${focus ? `?focus=${encodeURIComponent(focus)}` : ''}`),
    manifest: () => request('/advisor/manifest'),
    // Task #5 (AV) — Find & deep-link tool registry.
    tools: () => request('/advisor/tools'),
    tool: (name, args = {}) =>
      request('/advisor/tool', { method: 'POST', body: JSON.stringify({ name, args }) }),
    // LLM tool-binding entry point. The user types a free-form message;
    // the worker calls aiRouter.run('tool_call') to pick a tool, validates
    // the envelope, and dispatches via the same gated pipeline as `tool()`.
    toolAuto: (message) =>
      request('/advisor/tool/auto', { method: 'POST', body: JSON.stringify({ message }) }),
    conversation: (uid) => request(`/advisor/conversations/${encodeURIComponent(uid)}`),
    explainUrl: () => '/api/advisor/explain',
    // Task #3 (AS) — list field_sources rows for the current user,
    // optionally filtered to a single page_target. Used by
    // <AdvisorFilledBanner> + the per-field sparkle icons.
    sources: (page) =>
      request(`/advisor/sources${page ? `?page=${encodeURIComponent(page)}` : ''}`),
    // Task #13 — captured-answer list (saved + noop) for the right-rail
    // "Completed" bucket. Same scope/predicate as the header answered count,
    // so it includes free-form/reflection replies that never reach
    // field_sources (and thus were missing from /sources).
    answered: () => request('/advisor/answered'),
    // Voice-to-text for the composer mic. Posts a base64-encoded audio clip
    // + its mime type to the Workers AI Whisper endpoint; returns { text }.
    // The UI mic button that calls this is a separate task.
    transcribe: (audio, mime) =>
      request('/advisor/transcribe', {
        method: 'POST',
        body: JSON.stringify({ audio, mime }),
      }),
  },

  listPartners: () => request('/partners'),
  createPartner: (data) => request('/partners', { method: 'POST', body: JSON.stringify(data) }),
  recommendPartners: (sector) => request(`/partners/matchmaking/recommend${sector ? `?sector=${sector}` : ''}`),
  matchPartners: (intent) => request('/partners/match', { method: 'POST', body: JSON.stringify({ intent }) }),

  listInvestors: () => request('/capital/investors'),
  createInvestor: (data) => request('/capital/investors', { method: 'POST', body: JSON.stringify(data) }),
  getInvestor: (id) => request(`/capital/investors/${id}`),
  createCapitalCall: (data) => request('/capital/calls', { method: 'POST', body: JSON.stringify(data) }),
  listCapitalCalls: (status) => request(`/capital/calls${status ? `?status=${status}` : ''}`),
  payCapitalCall: (id) => request(`/capital/calls/${id}/pay`, { method: 'POST' }),
  portfolio: () => request('/capital/portfolio'),

  listTickets: (status) => request(`/tickets${status ? `?status=${status}` : ''}`),
  createTicket: (data) => request('/tickets', { method: 'POST', body: JSON.stringify(data) }),
  getTicket: (id) => request(`/tickets/${id}`),
  updateTicket: (id, data) => request(`/tickets/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  syncTickets: () => request('/tickets/sync', { method: 'POST' }),

  // Task #82 — `scope='mine'` narrows the funnel to deals the investor has a
  // relationship with (dealroom member / introduced / converted watchlist).
  listDeals: (status, scope) => {
    const q = new URLSearchParams();
    if (status) q.set('status', status);
    if (scope) q.set('scope', scope);
    const qs = q.toString();
    return request(`/deals${qs ? `?${qs}` : ''}`);
  },
  createDeal: (data) => request('/deals', { method: 'POST', body: JSON.stringify(data) }),
  getDeal: (id) => request(`/deals/${id}`),
  updateDeal: (id, data) => request(`/deals/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  // Task #82 — deal-room membership. join() is idempotent ({ok, already_member});
  // both may 402 with code:'quota_dealrooms_exhausted' (no `required` field, so
  // the global PaywallModal does NOT auto-open — callers surface it inline).
  dealroomJoin: (id) => request(`/deals/${id}/dealroom/join`, { method: 'POST' }),
  dealroomLeave: (id) => request(`/deals/${id}/dealroom/leave`, { method: 'DELETE' }),

  // Task #4 — Deal Flow: funnel aggregates, admin drafting, Deal Room
  // (documents / data room / commitments / activity) and investor invitations.
  dealFunnel: () => request('/deals/funnel'),
  draftDeal: (data) => request('/deals/draft', { method: 'POST', body: JSON.stringify(data) }),
  advanceDeal: (id) => request(`/deals/${id}/advance`, { method: 'POST' }),
  dealLeadPartners: () => request('/deals/lead-partners'),
  dealInvestorOptions: () => request('/deals/investors'),
  dealDocuments: (id) => request(`/deals/${id}/documents`),
  // Data-room zip is a file download. FastAPI (dev preview) authenticates via
  // the Bearer header only — a plain <a> click can't set that — so fetch the
  // blob with auth headers and trigger a client-side download.
  downloadDataRoom: async (id) => {
    const token = localStorage.getItem('token');
    const res = await fetch(`${BASE}/deals/${id}/data-room`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: 'include',
    });
    if (!res.ok) throw new Error('Failed to download data room');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `data-room-deal-${id}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
  dealCommitments: (id) => request(`/deals/${id}/commitments`),
  createCommitment: (id, data) => request(`/deals/${id}/commitments`, { method: 'POST', body: JSON.stringify(data) }),
  dealActivity: (id) => request(`/deals/${id}/activity`),
  dealInvitations: (id) => request(`/deals/${id}/invitations`),
  createDealInvitations: (id, data) => request(`/deals/${id}/invitations`, { method: 'POST', body: JSON.stringify(data) }),
  myDealInvitations: () => request('/deals/invitations/mine'),
  respondDealInvitation: (id, response) => request(`/deals/${id}/invitations/respond`, { method: 'POST', body: JSON.stringify({ response }) }),

  listUsers: (role) => request(`/users${role ? `?role=${role}` : ''}`),
  createUser: (data) => request('/users', { method: 'POST', body: JSON.stringify(data) }),

  matchPartnersLegacy: (data) => request('/partners/matchPartners', { method: 'POST', body: JSON.stringify(data) }),
  // Task #16 — investor matching for founders
  matchInvestors: (projectId) => request('/matches/investor-match', { method: 'POST', body: JSON.stringify({ project_id: projectId }) }),
  generateMemo: (data) => request('/scoring/generateMemo', { method: 'POST', body: JSON.stringify(data) }),
  capitalCall: (data) => request('/capital/capitalCall', { method: 'POST', body: JSON.stringify(data) }),

  founderSubmit: (data) => request('/projects/submit', { method: 'POST', body: JSON.stringify(data) }),

  marketPulse: () => request('/market-intel/market-pulse'),
  marketMacro: () => request('/market-intel/macro'),
  privateRounds: () => request('/market-intel/private-rounds'),
  studioBenchmarks: () => request('/market-intel/studio-benchmarks'),
  competitiveIntelligence: () => request('/market-intel/competitive-intelligence'),

  // Task #15 (AA-2) — Aggregator-backed Market Intel surfaces. The worker
  // returns 402 {error:'tier_required', required} on gated endpoints; the
  // shared request() helper auto-fires the studioos:tier_required event so
  // PaywallModal opens without per-call wiring. Free callers get only
  // {sector, composite} from /sector-compass; full-lens callers get the
  // dimensional breakdown.
  miSectorCompass: () => request('/market-intel/sector-compass'),
  miFounderLens: () => request('/market-intel/founder-lens'),
  miInvestorLens: () => request('/market-intel/investor-lens'),
  miGeography: () => request('/market-intel/geography'),
  miCitations: (sector, limit = 50) => {
    const q = new URLSearchParams();
    if (sector) q.set('sector', sector);
    if (limit) q.set('limit', String(limit));
    const qs = q.toString();
    return request(`/market-intel/citations${qs ? `?${qs}` : ''}`);
  },
  miSources: () => request('/market-intel/sources'),
  miWatchlistList: () => request('/market-intel/watchlist'),
  miWatchlistAdd: (sector, geo = 'global', cadence = 'weekly') =>
    request('/market-intel/watchlist', { method: 'POST', body: JSON.stringify({ sector, geo, cadence }) }),
  miWatchlistRemove: (id) =>
    request(`/market-intel/watchlist/${id}`, { method: 'DELETE' }),
  // Task #32 — pause/resume sector-digest emails without unpinning.
  // `until`: ISO string | 'indefinite' | null (null = resume).
  miWatchlistPause: (until) =>
    request('/market-intel/watchlist/pause', {
      method: 'POST',
      body: JSON.stringify({ until }),
    }),

  // Task #4 — Investor Signals + profiling chatbot
  getInvestorProfile: () => request('/investor-profile/me'),
  saveInvestorProfile: (data) => request('/investor-profile/me', { method: 'PUT', body: JSON.stringify(data) }),

  // Task #6 (AT-1) — Market Intelligence per-user contribution opt-out.
  // Backend purges the user's signals + embeddings within 24h via the
  // nightly reducer (or sooner if the queue runs first).
  miContributionOptoutGet: () => request('/market-intel/contribution-optout'),
  miContributionOptoutSet: (opt_out) => request('/market-intel/contribution-optout', {
    method: 'POST', body: JSON.stringify({ opt_out: !!opt_out }),
  }),

  // Task #1 (AT-2) — Read endpoints for the 8 new MI tabs. All return
  // `{ items: [...], k_min: 5 }` (or `{ matches, note?, k_min }` for fit
  // endpoints). Cells with n<5 are suppressed server-side; tabs surface
  // `<MIInsufficientData />` whenever items[] is empty or every cell is
  // suppressed.
  miSentiment: (weeks = 8) => request(`/market-intel/sentiment?weeks=${weeks}`),
  miTalc: (months = 6) => request(`/market-intel/talc?months=${months}`),
  miDemandSupply: (sector) => request(`/market-intel/demand-supply${sector ? `?sector=${encodeURIComponent(sector)}` : ''}`),
  miSectorHeat: (weeks = 8) => request(`/market-intel/sector-heat?weeks=${weeks}`),
  miSentimentGeo: (weeks = 4) => request(`/market-intel/sentiment-geo?weeks=${weeks}`),
  miCapitalVelocity: (months = 6) => request(`/market-intel/capital-velocity?months=${months}`),
  miPartnerPulse: () => request('/market-intel/partner-pulse'),
  miFitFounder: (projectId) => request(`/market-intel/fit/founder/${projectId}`),
  miFitInvestor: () => request('/market-intel/fit/investor/me'),
  miPlatformPersonas: () => request('/market-intel/platform-personas'),
  miPlatformPersonasExportUrl: (format = 'csv') =>
    `/api/market-intel/platform-personas/export?format=${encodeURIComponent(format)}`,

  optOutInvestorSignals: () => request('/investor-profile/me/opt-out', { method: 'POST' }),
  getInvestorSignals: () => request('/investor-signals/latest'),

  // Task #26 — Financial Model Builder
  getFinancialModel: (projectId) => request(`/financials/${projectId}`),
  saveFinancialModel: (projectId, assumptions) => request(`/financials/${projectId}`, { method: 'PUT', body: JSON.stringify({ assumptions }) }),
  recomputeFinancialModel: (projectId) => request(`/financials/${projectId}/recompute`, { method: 'POST' }),
  // Returns a promise so callers can await it and surface real errors in
  // their own UI instead of relying on alert(). The previous version
  // swallowed the backend's actual reason ("Project not found", "No
  // financial model saved yet", etc.) behind a generic "Export failed".
  downloadFinancialModelXlsx: async (projectId) => {
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/financials/${projectId}/export.xlsx`, {
      // T6 — credentials:'include' so the cookie auth path also works for
      // users who no longer have a Bearer token in localStorage.
      credentials: 'include',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      let detail = res.statusText || 'Export failed';
      try {
        const err = await res.json();
        detail = err?.detail || err?.error || detail;
      } catch {
        // Body wasn't JSON (e.g. plain text or empty) — keep statusText.
      }
      const e = new Error(detail);
      e.status = res.status;
      throw e;
    }
    const blob = await res.blob();
    const filename = (res.headers.get('Content-Disposition') || '').match(/filename="?([^"]+)"?/)?.[1] || 'financials.xlsx';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  // Task #28 — Discovery / Roadmap / Metrics
  listInterviews: (projectId) => request(`/progress/discovery/${projectId}`),
  createInterview: (projectId, data) => request(`/progress/discovery/${projectId}`, { method: 'POST', body: JSON.stringify(data) }),
  updateInterview: (id, data) => request(`/progress/discovery/interview/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteInterview: (id) => request(`/progress/discovery/interview/${id}`, { method: 'DELETE' }),
  // Task #5 — customer-audience waitlist signups + lightweight CRM layer inside
  // Customer Discovery (promote-to-interview, product-invitation email,
  // follow-up email). Customer-audience only; project-scoped server-side.
  listWaitlistCustomers: (projectId) => request(`/progress/discovery/${projectId}/waitlist`),
  promoteWaitlistCustomer: (projectId, signupId) =>
    request(`/progress/discovery/${projectId}/waitlist/${signupId}/promote`, { method: 'POST' }),
  inviteWaitlistCustomer: (projectId, signupId) =>
    request(`/progress/discovery/${projectId}/waitlist/${signupId}/invite`, { method: 'POST' }),
  followUpWaitlistCustomer: (projectId, signupId) =>
    request(`/progress/discovery/${projectId}/waitlist/${signupId}/follow-up`, { method: 'POST' }),
  // Task #29 — pain-group curation for the Spin-Out deck Slide 2.
  painGroups: (projectId) => request(`/progress/pain-groups/${projectId}`),
  assignPain: (projectId, body) => request(`/progress/pain-groups/${projectId}/assign`, { method: 'POST', body: JSON.stringify(body) }),
  renamePainGroup: (id, title) => request(`/progress/pain-groups/${id}`, { method: 'PATCH', body: JSON.stringify({ title }) }),
  deletePainGroup: (id) => request(`/progress/pain-groups/${id}`, { method: 'DELETE' }),
  listOkrs: (projectId) => request(`/progress/roadmap/${projectId}`),
  createOkr: (projectId, data) => request(`/progress/roadmap/${projectId}`, { method: 'POST', body: JSON.stringify(data) }),
  updateOkr: (id, data) => request(`/progress/roadmap/okr/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  moveOkr: (id, kanban_status, sort_order = 0) => request(`/progress/roadmap/okr/${id}/move`, { method: 'POST', body: JSON.stringify({ kanban_status, sort_order }) }),
  deleteOkr: (id) => request(`/progress/roadmap/okr/${id}`, { method: 'DELETE' }),
  listMetricsSnapshots: (projectId) => request(`/progress/metrics/${projectId}`),
  createMetricsSnapshot: (projectId, data) => request(`/progress/metrics/${projectId}`, { method: 'POST', body: JSON.stringify(data) }),
  deleteMetricsSnapshot: (id) => request(`/progress/metrics/${id}`, { method: 'DELETE' }),
  importMetricsFromStripe: (projectId) => request(`/progress/metrics/${projectId}/import-stripe`, { method: 'POST' }),
  getProgressSignals: (projectId) => request(`/progress/signals/${projectId}`),
  getLifecycle: (projectId) => request(`/progress/lifecycle/${projectId}`),
  updateLifecycle: (projectId, data) => request(`/progress/lifecycle/${projectId}`, { method: 'PUT', body: JSON.stringify(data) }),

  // Task #36 — Service Provider Marketplace
  listProviders: (params = {}) => request(`/marketplace/providers${Object.keys(params).length ? `?${new URLSearchParams(params)}` : ''}`),
  getProvider: (id) => request(`/marketplace/providers/${id}`),

  // Task #53 — Public partner directory (no auth required).
  publicListPartners: (params = {}) => {
    const q = Object.entries(params).filter(([_, v]) => v !== undefined && v !== null && v !== '');
    return request(`/public/partners${q.length ? `?${new URLSearchParams(q)}` : ''}`);
  },
  publicGetPartner: (slug) => request(`/public/p/${encodeURIComponent(slug)}`),
  // Task #3 — public Calendly booking URL lookup. Returns null on 404
  // (provider not connected or no booking_url configured).
  publicCalendlyBooking: (userId) =>
    request(`/integrations/public/calendly/${userId}`).catch((e) => {
      if (e?.status === 404) return null;
      throw e;
    }),
  // Task #55 — public profile page (/u/:handle), unauthenticated.
  publicGetUserByHandle: (handle) => request(`/public/u/${encodeURIComponent(handle)}`),
  // Task #66 — public, shareable startup profile (/startups/:handle → project uid).
  publicGetStartup: (handle) => request(`/public/startup/${encodeURIComponent(handle)}`),
  // Task #66 — follow graph (people + startups). entityType is 'user' | 'project'.
  follow: (entityType, entityId) =>
    request('/follows', { method: 'POST', body: JSON.stringify({ entity_type: entityType, entity_id: entityId }) }),
  unfollow: (entityType, entityId) =>
    request('/follows', { method: 'DELETE', body: JSON.stringify({ entity_type: entityType, entity_id: entityId }) }),
  followStatus: (entityType, entityId) =>
    request(`/follows/status?entity_type=${encodeURIComponent(entityType)}&entity_id=${encodeURIComponent(entityId)}`),
  followsMine: () => request('/follows/mine'),
  setPartnerFeatured: (partnerId, body) => request(`/marketplace/providers/${partnerId}/featured`, {
    method: 'POST', body: JSON.stringify(body),
  }),
  // Admin-managed Service Provider Directory approval (Task #53).
  // List = every partner with their current listed/featured flags;
  // toggle = flip either flag (featured without listed is auto-corrected
  // server-side to listed=false because the public route hides it anyway).
  adminListDirectoryPartners: (q = '') =>
    request(`/admin/partners/directory${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  adminSetPartnerDirectory: (partnerId, { listed, featured } = {}) =>
    request(`/admin/partners/${partnerId}/directory`, {
      method: 'POST',
      body: JSON.stringify({
        ...(typeof listed === 'boolean' ? { listed } : {}),
        ...(typeof featured === 'boolean' ? { featured } : {}),
      }),
    }),
  getMyProvider: () => request('/marketplace/providers/me'),
  updateMyProvider: (data) => request('/marketplace/providers/me', { method: 'PUT', body: JSON.stringify(data) }),
  setProviderKyb: (id, status) => request(`/marketplace/providers/${id}/kyb`, { method: 'POST', body: JSON.stringify({ status }) }),
  listProviderReviews: (id) => request(`/marketplace/providers/${id}/reviews`),
  createProviderReview: (id, data) => request(`/marketplace/providers/${id}/reviews`, { method: 'POST', body: JSON.stringify(data) }),
  marketplaceCategories: () => request('/marketplace/categories'),
  createInquiry: (partnerId, data) => request(`/marketplace/inquiries?partner_id=${partnerId}`, { method: 'POST', body: JSON.stringify(data) }),
  listInquiries: () => request('/marketplace/inquiries'),
  getInquiry: (id) => request(`/marketplace/inquiries/${id}`),
  postInquiryMessage: (id, body) => request(`/marketplace/inquiries/${id}/messages`, { method: 'POST', body: JSON.stringify({ body }) }),
  closeInquiry: (id) => request(`/marketplace/inquiries/${id}/close`, { method: 'POST' }),

  // Task #50 — Needs board + RFPs + Quotes
  listNeeds: (params = {}) => request(`/needs${Object.keys(params).length ? `?${new URLSearchParams(params)}` : ''}`),
  getNeed: (id) => request(`/needs/${id}`),
  createNeed: (data) => request('/needs', { method: 'POST', body: JSON.stringify(data) }),
  updateNeed: (id, data) => request(`/needs/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteNeed: (id) => request(`/needs/${id}`, { method: 'DELETE' }),
  upsertRfp: (needId, data) => request(`/needs/${needId}/rfp`, { method: 'POST', body: JSON.stringify(data) }),
  submitQuote: (needId, data) => request(`/needs/${needId}/quotes`, { method: 'POST', body: JSON.stringify(data) }),
  listQuotesForNeed: (needId) => request(`/needs/${needId}/quotes`),
  myQuotes: () => request('/quotes/me'),
  acceptQuote: (id) => request(`/quotes/${id}/accept`, { method: 'POST' }),
  rejectQuote: (id) => request(`/quotes/${id}/reject`, { method: 'POST' }),
  withdrawQuote: (id) => request(`/quotes/${id}/withdraw`, { method: 'POST' }),
  listEngagements: () => request('/engagements'),
  getEngagement: (id) => request(`/engagements/${id}`),
  startEngagement: (id) => request(`/engagements/${id}/start`, { method: 'POST' }),
  deliverEngagement: (id, data) => request(`/engagements/${id}/deliver`, { method: 'POST', body: JSON.stringify(data || {}) }),
  cancelEngagement: (id, data) => request(`/engagements/${id}/cancel`, { method: 'POST', body: JSON.stringify(data || {}) }),
  invoiceEngagement: (id) => request(`/engagements/${id}/invoice`, { method: 'POST' }),
  listEngagementReviews: (id) => request(`/engagements/${id}/reviews`),
  createEngagementReview: (id, data) => request(`/engagements/${id}/reviews`, { method: 'POST', body: JSON.stringify(data) }),

  // Task #51 — Service catalogue
  listServiceOfferings: (params = {}) => request(`/services/offerings${Object.keys(params).length ? `?${new URLSearchParams(params)}` : ''}`),
  getServiceOffering: (id) => request(`/services/offerings/${id}`),
  createServiceOffering: (data) => request('/services/offerings', { method: 'POST', body: JSON.stringify(data) }),
  updateServiceOffering: (id, data) => request(`/services/offerings/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteServiceOffering: (id) => request(`/services/offerings/${id}`, { method: 'DELETE' }),
  listPartnerOfferings: (partnerId) => request(`/services/partners/${partnerId}/offerings`),
  engageServiceOffering: (id, data) => request(`/services/offerings/${id}/engage`, { method: 'POST', body: JSON.stringify(data) }),

  // Task #51 — Stripe Connect onboarding (partner-only)
  getMyStripeStatus: () => request('/marketplace/providers/me/stripe'),
  startStripeOnboarding: () => request('/marketplace/providers/me/stripe/onboard', { method: 'POST' }),
  refreshStripeStatus: () => request('/marketplace/providers/me/stripe/refresh', { method: 'POST' }),

  // Task #52 — Demand heatmap + insight feed
  insightsHeatmap: (windowDays = 180) => request(`/insights/heatmap?window_days=${windowDays}`),
  insightsTrends: (months = 6) => request(`/insights/trends?months=${months}`),
  insightsFeed: (windowDays = 90) => request(`/insights/feed?window_days=${windowDays}`),
  insightsNewsletterStatus: () => request('/insights/newsletter'),
  insightsNewsletterSubscribe: () => request('/insights/newsletter/subscribe', { method: 'POST' }),
  insightsNewsletterUnsubscribe: () => request('/insights/newsletter/unsubscribe', { method: 'POST' }),
  insightsNewsletterPreview: () => request('/insights/newsletter/preview'),

  // Signals — founder decision engine over public-market evidence. Worker-only
  // (dev FastAPI has no /api/signals). Shared by Founder + Advisor modes;
  // `mode` only changes ordering + copy, never the underlying data.
  signals: {
    list: (params = {}) => {
      const qs = new URLSearchParams(
        Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''),
      ).toString();
      return request('/signals' + (qs ? `?${qs}` : ''));
    },
    get: (id, mode = 'founder') => request(`/signals/${encodeURIComponent(id)}?mode=${mode}`),
    filters: () => request('/signals/filters'),
    kpis: (mode = 'founder') => request(`/signals/kpis?mode=${mode}`),
    sources: () => request('/signals/sources'),
    meta: () => request('/signals/meta'),
    refresh: () => request('/signals/refresh', { method: 'POST' }),
  },

  askAdvisory: (data) => request('/advisory/ask', { method: 'POST', body: JSON.stringify(data) }),
  financialPlan: (data) => request('/advisory/financial-plan', { method: 'POST', body: JSON.stringify(data) }),
  runDiligence: (data) => request('/advisory/diligence', { method: 'POST', body: JSON.stringify(data) }),
  // Task #75 — Advisory Suite advisor directory (founder-scoped).
  advisorProfilesList: () => request('/advisory/advisors'),
  advisorProfileUpdate: (id, data) => request(`/advisory/advisors/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  advisorProfileAssign: (id, projectIds) => request(`/advisory/advisors/${id}/assignments`, { method: 'PUT', body: JSON.stringify({ project_ids: projectIds }) }),
  advisorProfileArchive: (id) => request(`/advisory/advisors/${id}/archive`, { method: 'POST' }),
  advisorProfileRestore: (id) => request(`/advisory/advisors/${id}/restore`, { method: 'POST' }),

  activityLog: (params) => request(`/activity${params ? `?${new URLSearchParams(params)}` : ''}`),
  activitySummary: () => request('/activity/summary'),
  activitySyncGithub: () => request('/activity/sync-github', { method: 'POST' }),

  adminListUsers: () => request('/admin/users'),
  adminListContracts: (params = {}) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== '' && v !== null)).toString();
    return request(`/admin/contracts${q ? `?${q}` : ''}`);
  },
  adminContractStats: () => request('/admin/contracts/stats'),
  adminContractTemplates: () => request('/admin/contracts/templates'),
  adminContractTemplateUsage: (docType, params = {}) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== '' && v !== null)).toString();
    return request(`/admin/contracts/templates/${encodeURIComponent(docType)}/usage${q ? `?${q}` : ''}`);
  },
  adminGetContract: (uid) => request(`/admin/contracts/${uid}`),
  adminResendContract: (uid) => request(`/admin/contracts/${uid}/resend`, { method: 'POST' }),
  // Task #9 — Promo Code admin CRUD. List is a plain admin read; create/toggle/
  // delete are money-adjacent so the server enforces TOTP + step-up (the global
  // `request` helper auto-handles the 403 `step_up_required` challenge).
  //   adminListPromos()           → { promos: [PromoView] }
  //   adminCreatePromo(body)      → { ok, promo_id, code }
  //   adminSetPromoActive(id, on) → { ok, promo_id, active }
  //   adminDeletePromo(id)        → { ok, promo_id }
  adminListPromos: () => request('/admin/promos'),
  adminCreatePromo: (body) =>
    request('/admin/promos', { method: 'POST', body: JSON.stringify(body || {}) }),
  adminSetPromoActive: (id, active) =>
    request(`/admin/promos/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ active }) }),
  adminDeletePromo: (id) =>
    request(`/admin/promos/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // Task #11 — admin billing: refunds (with per-product policy + referral
  // commission clawback), dispute evidence, and customer LTV. All step-up
  // gated server-side; the `request` helper auto-handles the step-up challenge.
  //   adminBillingRefund(body)               → { ok, refund, policy, clawback }
  //   adminBillingListDisputes(limit)        → { ok, disputes }
  //   adminBillingGetDispute(id)             → { ok, dispute }
  //   adminBillingSubmitEvidence(id, body)   → { ok, submitted, dispute }
  //   adminBillingLTV(userId)                → { ok, ltv, charges, subscriptions }
  adminBillingRefund: (body) =>
    request('/admin/billing/refund', { method: 'POST', body: JSON.stringify(body || {}) }),
  adminBillingListDisputes: (limit = 25) =>
    request(`/admin/billing/disputes?limit=${encodeURIComponent(limit)}`),
  adminBillingGetDispute: (id) =>
    request(`/admin/billing/disputes/${encodeURIComponent(id)}`),
  adminBillingSubmitEvidence: (id, body) =>
    request(`/admin/billing/disputes/${encodeURIComponent(id)}/evidence`, { method: 'POST', body: JSON.stringify(body || {}) }),
  adminBillingLTV: (userId) =>
    request(`/admin/billing/ltv?user_id=${encodeURIComponent(userId)}`),

  // Task #16 — Admin Stripe catalog CRUD + webhook/config management.
  //
  // Catalog:
  //   adminCatalogMode()                       → { mode: 'test'|'live'|'unconfigured' }
  //   adminCatalogList()                       → { products, mode }
  //   adminCatalogSync()                       → { ok, synced }
  //   adminCatalogCreateProduct(body)          → { ok, product }
  //   adminCatalogUpdateProduct(id, body)      → { ok }
  //   adminCatalogArchiveProduct(id)           → { ok }
  //   adminCatalogAddPrice(productId, body)    → { ok, price }
  //   adminCatalogArchivePrice(priceId)        → { ok }
  // Webhook:
  //   adminStripeListWebhooks()                → { endpoints, required_events, our_url }
  //   adminStripeRegisterWebhook()             → { ok, endpoint_id, url, secret_stored }
  //   adminStripeUpdateWebhookEvents(epId)     → { ok, endpoint_id, url }
  // Config (publishable key):
  //   adminStripeGetConfig()                   → { publishable_key, mode, configured }
  //   adminStripeSetConfig(pk)                 → { ok, mode }
  adminCatalogMode: () => request('/admin/catalog/mode'),
  adminCatalogList: () => request('/admin/catalog/products'),
  adminCatalogSync: () => request('/admin/catalog/sync', { method: 'POST', body: '{}' }),
  adminCatalogCreateProduct: (body) =>
    request('/admin/catalog/products', { method: 'POST', body: JSON.stringify(body || {}) }),
  adminCatalogUpdateProduct: (id, body) =>
    request(`/admin/catalog/products/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body || {}),
    }),
  adminCatalogArchiveProduct: (id) =>
    request(`/admin/catalog/products/${encodeURIComponent(id)}/archive`, {
      method: 'POST',
      body: '{}',
    }),
  adminCatalogAddPrice: (productId, body) =>
    request(`/admin/catalog/products/${encodeURIComponent(productId)}/prices`, {
      method: 'POST',
      body: JSON.stringify(body || {}),
    }),
  adminCatalogUpdatePrice: (priceId, body) =>
    request(`/admin/catalog/prices/${encodeURIComponent(priceId)}`, {
      method: 'PATCH',
      body: JSON.stringify(body || {}),
    }),
  adminCatalogArchivePrice: (priceId) =>
    request(`/admin/catalog/prices/${encodeURIComponent(priceId)}/archive`, {
      method: 'POST',
      body: '{}',
    }),
  adminStripeListWebhooks: () => request('/admin/stripe/webhook'),
  adminStripeRegisterWebhook: () =>
    request('/admin/stripe/webhook', {
      method: 'POST',
      body: JSON.stringify({ action: 'register' }),
    }),
  adminStripeUpdateWebhookEvents: (endpointId) =>
    request('/admin/stripe/webhook', {
      method: 'POST',
      body: JSON.stringify({ action: 'update', endpoint_id: endpointId }),
    }),
  adminStripeGetConfig: () => request('/admin/stripe/config'),
  adminStripeSetConfig: (publishableKey) =>
    request('/admin/stripe/config', {
      method: 'PUT',
      body: JSON.stringify({ publishable_key: publishableKey }),
    }),

  adminVoidContract: (uid) => request(`/admin/contracts/${uid}/void`, { method: 'POST' }),
  adminDownloadContractUrl: (uid) => `/api/admin/contracts/${uid}/download`,
  adminIssueContractShareLink: (uid, ttl_seconds = 300) =>
    request(`/admin/contracts/${uid}/download-url?ttl_seconds=${ttl_seconds}`, { method: 'POST' }),
  // Task #5 (Z) — Pairwise NDAs / Partner Deals tabs + Create-envelope wizard.
  adminListPairwiseNdas: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString();
    return request(`/admin/contracts/pairwise-ndas${qs ? `?${qs}` : ''}`);
  },
  adminListPartnerDeals: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString();
    return request(`/admin/contracts/partner-deals${qs ? `?${qs}` : ''}`);
  },
  adminListLegalTemplates: () => request('/admin/contracts/templates/legal'),
  // Task #8 — Worker-owned (D1) legal template store CRUD + versioning.
  adminTemplateStoreList: (category) => {
    const q = category ? `?category=${encodeURIComponent(category)}` : '';
    return request(`/admin/contracts/templates/store${q}`);
  },
  adminTemplateStoreGet: (slug) => request(`/admin/contracts/templates/store/${encodeURIComponent(slug)}`),
  adminTemplateStoreVersions: (slug) =>
    request(`/admin/contracts/templates/store/${encodeURIComponent(slug)}/versions`),
  adminTemplateStoreCreate: (payload) =>
    request('/admin/contracts/templates/store', { method: 'POST', body: JSON.stringify(payload) }),
  adminTemplateStoreUpdate: (slug, payload) =>
    request(`/admin/contracts/templates/store/${encodeURIComponent(slug)}`, { method: 'PUT', body: JSON.stringify(payload) }),
  adminTemplateStoreDelete: (slug) =>
    request(`/admin/contracts/templates/store/${encodeURIComponent(slug)}`, { method: 'DELETE' }),
  // Task #9 — IRS-style forms catalog + on-the-fly PDF preview/download.
  adminListForms: () => request('/admin/forms'),
  // Returns { blob, url } for the rendered form PDF. The caller owns the
  // object URL and must URL.revokeObjectURL(url) when done. `blank` renders a
  // true blank; otherwise the form is filled with sample placeholder values.
  adminFormPreviewBlob: async (id, { blank = false } = {}) => {
    const token = localStorage.getItem('token');
    const q = blank ? '?blank=1' : '';
    const res = await fetch(`/api/admin/forms/${encodeURIComponent(id)}/preview${q}`, {
      credentials: 'include',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      let detail = res.statusText || 'Preview failed';
      try { const err = await res.json(); detail = err?.error || err?.detail || detail; } catch { /* non-JSON */ }
      const e = new Error(detail);
      e.status = res.status;
      throw e;
    }
    const blob = await res.blob();
    const filename = (res.headers.get('Content-Disposition') || '').match(/filename="?([^"]+)"?/)?.[1] || `axal-form-${id}.pdf`;
    return { blob, url: URL.createObjectURL(blob), filename };
  },
  // Task #31 — per-template preview PDF blob (binary endpoint, not typed drift).
  adminTemplateStorePreviewPdfBlob: async (slug, { resolve = 'brackets' } = {}) => {
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/admin/contracts/templates/store/${encodeURIComponent(slug)}/preview.pdf?resolve=${resolve}`, {
      credentials: 'include',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      let detail = res.statusText || 'PDF generation failed';
      try { const err = await res.json(); detail = err?.error || err?.detail || detail; } catch { /* non-JSON */ }
      const e = new Error(detail);
      e.status = res.status;
      throw e;
    }
    const blob = await res.blob();
    const filename = (res.headers.get('Content-Disposition') || '').match(/filename="?([^"]+)"?/)?.[1] || `${slug}-preview.pdf`;
    return { blob, url: URL.createObjectURL(blob), filename };
  },
  adminSendEnvelope: (payload) =>
    request('/legal/esign/send', { method: 'POST', body: JSON.stringify(payload) }),
  // Task #14 — forward signed PDF to legal partner(s).
  adminForwardContract: (id, data) =>
    request(`/legal/esign/${id}/forward`, { method: 'POST', body: JSON.stringify(data) }),
  adminGetForwardLog: (id) =>
    request(`/legal/esign/${id}/forward`),
  // Task #14 — download signed PDF as blob (for iframe preview).
  // Uses the decrypt-aware eSign document endpoint so .enc files are
  // decrypted before reaching the iframe.
  adminDownloadEsignDocumentBlob: (id) => {
    const url = `/api/legal/esign/${id}/document`;
    const token = localStorage.getItem('token');
    return fetch(url, { headers: { Authorization: `Bearer ${token}` } }).then(r => {
      if (!r.ok) throw new Error('Download failed');
      return r.blob();
    });
  },
  adminVoidContractWithReason: (uid, reason) =>
    request(`/admin/contracts/${uid}/void`, { method: 'POST', body: JSON.stringify({ reason }) }),
  adminImpersonate: (userId) => request(`/admin/impersonate/${userId}`, { method: 'POST' }),
  // Task #7 — admin-managed OAuth client credentials per provider.
  adminListIntegrationKeys: () => request('/admin/integration-keys'),
  adminSetIntegrationKeys: (provider, client_id, client_secret) =>
    request(`/admin/integration-keys/${encodeURIComponent(provider)}`, {
      method: 'PUT',
      body: JSON.stringify({ client_id, client_secret }),
    }),
  adminDeleteIntegrationKeys: (provider) =>
    request(`/admin/integration-keys/${encodeURIComponent(provider)}`, { method: 'DELETE' }),
  // Task #3 — Rotate the secret in place (client_id stays the same).
  adminRotateIntegrationKeys: (provider, client_secret) =>
    request(`/admin/integration-keys/${encodeURIComponent(provider)}/rotate`, {
      method: 'POST',
      body: JSON.stringify({ client_secret }),
    }),
  // Task #3 — Dry-run a provider auth call to verify configured credentials.
  adminTestIntegrationKeys: (provider) =>
    request(`/admin/integration-keys/${encodeURIComponent(provider)}/test`, { method: 'POST' }),
  // GitHub ticket sync — admin config panel.
  adminGetGithubConfig: () => request('/admin/github'),
  adminSaveGithubConfig: (body) =>
    request('/admin/github', { method: 'PUT', body: JSON.stringify(body || {}) }),
  adminTestGithub: () => request('/admin/github/test', { method: 'POST' }),
  adminDeleteGithubConfig: () => request('/admin/github', { method: 'DELETE' }),
  adminUpdateRole: (userId, role) => request(`/admin/users/${userId}/role?role=${role}`, { method: 'PATCH' }),
  adminToggleActive: (userId) => request(`/admin/users/${userId}/toggle-active`, { method: 'PATCH' }),
  // Set per-user access level. `level` is 'limited' (browse-only, no signing
  // until KYC) or null (revoke). Full access is granted via kycAdminApprove.
  adminSetAccessLevel: (userId, level) =>
    request(`/admin/users/${userId}/access-level`, { method: 'PATCH', body: JSON.stringify({ level }) }),

  profilingChat: (data) => request('/profiling/chat', { method: 'POST', body: JSON.stringify(data) }),
  profilingSave: (data) => request('/profiling/save', { method: 'POST', body: JSON.stringify(data) }),
  adminListProfiles: () => request('/profiling/admin/list'),

  kycStatus: () => request('/kyc/status'),
  kycSubmit: (data) => request('/kyc/submit', { method: 'POST', body: JSON.stringify(data) }),
  kycAdminQueue: (status = 'pending') => request(`/kyc/admin/queue?status=${encodeURIComponent(status)}`),
  kycAdminGet: (userId) => request(`/kyc/admin/${userId}`),
  kycAdminApprove: (userId) => request(`/kyc/admin/${userId}/approve`, { method: 'PATCH' }),
  kycAdminReject: (userId, reason) => request(`/kyc/admin/${userId}/reject`, { method: 'PATCH', body: JSON.stringify({ reason }) }),
  adminGetProfile: (email) => request(`/profiling/admin/${encodeURIComponent(email)}`),
  adminVerifyProfile: (email, data) => request(`/profiling/admin/${encodeURIComponent(email)}/verify`, { method: 'POST', body: JSON.stringify(data) }),

  // ----- eSignature -----
  esignSend: (data) => request('/legal/esign/send', { method: 'POST', body: JSON.stringify(data) }),
  esignList: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/legal/esign${q ? `?${q}` : ''}`);
  },
  esignDetail: (id) => request(`/legal/esign/${id}`),
  esignDocumentUrl: (id) => `/api/legal/esign/${id}/document`,
  // Public (token-gated, no auth header) — uses raw fetch since the sign page
  // is reachable without a logged-in session.
  esignFetchByToken: async (token) => {
    const res = await fetch(`/api/legal/esign/sign/${encodeURIComponent(token)}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error || res.statusText || 'Failed to load signing envelope');
    }
    return await res.json();
  },
  esignSubmitSignature: async (token, payload) => {
    const res = await fetch(`/api/legal/esign/sign/${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error || res.statusText || 'Signing failed');
    }
    return await res.json();
  },
  esignReject: async (token, reason) => {
    const res = await fetch(`/api/legal/esign/sign/${encodeURIComponent(token)}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error || res.statusText || 'Could not decline');
    }
    return await res.json();
  },

  privateProfile: () => request('/private-data/profile'),
  privateSignals: () => request('/private-data/market/private-signals'),
  privatePortfolioMetrics: () => request('/private-data/portfolio/metrics'),
  privateFounderData: (userId) => request(`/private-data/founder/${userId}`),

  referralCode: () => request('/network/referral/code'),
  referralList: () => request('/network/referral/list'),
  commissionsMe: () => request('/network/commissions/me'),
  payoutsMe: () => request('/network/payouts/me'),
  payoutRequest: (data) => request('/network/payout/request', { method: 'POST', body: JSON.stringify(data) }),
  adminCommissions: () => request('/network/admin/commissions'),
  adminCommissionRules: () => request('/network/admin/commission-rules'),
  adminPayouts: () => request('/network/admin/payouts'),
  adminProcessPayout: (id, data) => request(`/network/admin/payouts/${id}/process`, { method: 'PATCH', body: JSON.stringify(data) }),

  // Task #9 — Refer & Earn payouts via Stripe Connect Express.
  referEarnConnectOnboard: () => request('/refer-earn/connect/onboard', { method: 'POST' }),
  referEarnConnectStatus: () => request('/refer-earn/connect/status'),
  referEarnConnectLoginLink: () => request('/refer-earn/connect/login-link', { method: 'POST' }),
  referEarnDashboard: () => request('/refer-earn/dashboard'),
  referEarnPayoutsMe: () => request('/refer-earn/payouts/me'),
  adminReferEarnPayouts: (status) =>
    request(`/refer-earn/admin/payouts${status ? `?status=${encodeURIComponent(status)}` : ''}`),
  adminReferEarnApprove: (id) => request(`/refer-earn/admin/payouts/${id}/approve`, { method: 'POST' }),
  adminReferEarnPay: (id) => request(`/refer-earn/admin/payouts/${id}/pay`, { method: 'POST' }),
  adminReferEarnRunApprovalEngine: () =>
    request('/refer-earn/admin/run-approval-engine', { method: 'POST' }),
  adminReferEarnTaxSummary: (year) =>
    request(`/refer-earn/admin/tax-summary${year ? `?year=${year}` : ''}`),
  adminReferEarnEvaluate: (id) => request(`/refer-earn/admin/payouts/${id}/evaluate`),

  adminUserProfile: (userId) => request(`/admin/users/${userId}/profile`),
  // Task #1 (DB) — dedicated transcript endpoints. The /profile call above
  // returns the first + most-recent advisor conversation inline; these are
  // the discoverable, per-conversation, audited entry-points for the
  // admin user-detail drawer's Onboarding + Ongoing tabs.
  adminUserOnboardingConversation: (userId) =>
    request(`/admin/users/${userId}/conversations/onboarding`),
  adminUserAdvisorConversations: (userId, opts = {}) => {
    const qs = new URLSearchParams();
    if (opts.q) qs.set('q', opts.q);
    if (opts.since) qs.set('since', opts.since);
    if (opts.until) qs.set('until', opts.until);
    if (opts.limit) qs.set('limit', String(opts.limit));
    const q = qs.toString();
    return request(`/admin/users/${userId}/conversations/advisor${q ? `?${q}` : ''}`);
  },
  // Returns the same payload as the JSON endpoint above but as a CSV
  // download URL (caller hits it via window.open / an <a download>).
  adminUserAdvisorConversationsCsvUrl: (userId, opts = {}) => {
    const qs = new URLSearchParams({ format: 'csv' });
    if (opts.q) qs.set('q', opts.q);
    if (opts.since) qs.set('since', opts.since);
    if (opts.until) qs.set('until', opts.until);
    return `/api/admin/users/${userId}/conversations/advisor?${qs.toString()}`;
  },
  adminUserAdvisorConversation: (userId, conversationId) =>
    request(`/admin/users/${userId}/conversations/advisor/${conversationId}`),
  // Task #34 — message-level transcript CSV export. POST per spec (the body
  // can include from/to/persona/model/conversation_id filters that would
  // be awkward to express as a GET URL). Returns the CSV blob; caller is
  // responsible for triggering the download.
  adminUserAdvisorTranscriptExport: async (userId, opts = {}) => {
    const res = await fetch(`/api/admin/users/${userId}/conversations/advisor/export`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
        ...getCsrfHeader('POST'),
      },
      credentials: 'include',
      body: JSON.stringify(opts || {}),
    });
    if (!res.ok) {
      let msg = `Export failed (${res.status})`;
      try { const j = await res.json(); if (j?.error) msg = j.error; } catch {}
      throw new Error(msg);
    }
    const blob = await res.blob();
    const filename =
      (res.headers.get('Content-Disposition') || '')
        .match(/filename="?([^"]+)"?/)?.[1] || `advisor-transcript-${userId}.csv`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
  adminUpdateNotes: (userId, admin_notes) => request(`/admin/users/${userId}/notes`, { method: 'POST', body: JSON.stringify({ admin_notes }) }),
  adminResendVerification: (userId) => request(`/admin/users/${userId}/resend-verification`, { method: 'POST' }),

  integrationsAvailable: () => request('/integrations/available'),
  // Crunchbase enrichment (Task #3, 2026-05-10) — growth tier, requires
  // an active Crunchbase integration on the calling user's account.
  crunchbaseSearch: (q, limit = 10) =>
    request(`/crunchbase/search?q=${encodeURIComponent(q)}&limit=${limit}`),
  crunchbaseApply: (projectId, payload) =>
    request(`/crunchbase/projects/${projectId}/apply`, { method: 'POST', body: JSON.stringify(payload) }),
  crunchbaseCompetitors: (projectId, limit = 10) =>
    request(`/crunchbase/projects/${projectId}/competitors?limit=${limit}`),

  integrationsList: () => request('/integrations'),
  integrationsConnect: (data) => request('/integrations/connect', { method: 'POST', body: JSON.stringify(data) }),
  integrationsDisconnect: (uid) => request(`/integrations/${encodeURIComponent(uid)}`, { method: 'DELETE' }),
  integrationsSync: (uid) => request(`/integrations/${encodeURIComponent(uid)}/sync`, { method: 'POST' }),
  integrationsPush: (uid, data) => request(`/integrations/${encodeURIComponent(uid)}/push`, { method: 'POST', body: JSON.stringify(data) }),
  integrationsLogs: (uid, params = {}) => {
    const q = new URLSearchParams(Object.entries(params).filter(([_, v]) => v != null && v !== '')).toString();
    return request(`/integrations/${encodeURIComponent(uid)}/logs${q ? `?${q}` : ''}`);
  },
  // Task #1 (Integrations Foundation) — waitlist / notify-me + OAuth helpers.
  integrationsWaitlist: () => request('/integrations/waitlist'),
  // POST /notify-me is the preferred public surface; /waitlist is the admin/list view.
  integrationsWaitlistJoin: (data) => request('/integrations/notify-me', { method: 'POST', body: JSON.stringify(data) }),
  integrationsWaitlistLeave: (provider) => request(`/integrations/notify-me/${encodeURIComponent(provider)}`, { method: 'DELETE' }),
  integrationsOauthStart: (provider, params = {}) => {
    const q = new URLSearchParams(Object.entries(params).filter(([_, v]) => v != null && v !== '')).toString();
    return request(`/integrations/oauth/${encodeURIComponent(provider)}/start${q ? `?${q}` : ''}`);
  },
  // Task #2 — HubSpot pipeline picker + arbitrary provider actions.
  integrationsAction: (uid, name, body) => request(
    `/integrations/${encodeURIComponent(uid)}/action/${encodeURIComponent(name)}`,
    body ? { method: 'POST', body: JSON.stringify(body) } : { method: 'GET' },
  ),
  integrationsPatchConfig: (uid, patch) => request(
    `/integrations/${encodeURIComponent(uid)}/config`,
    { method: 'PATCH', body: JSON.stringify(patch) },
  ),

  searchSemantic: (q, type, limit = 10, grouped = false) => {
    const params = new URLSearchParams({ q });
    if (type) params.set('type', type);
    if (limit) params.set('limit', String(limit));
    if (grouped) params.set('grouped', '1');
    return request(`/search?${params.toString()}`);
  },
  searchBackfill: (types) => request('/search/backfill', { method: 'POST', body: JSON.stringify({ types }) }),

  // Phase 0.2 / Task #23 — onboarding wizard progress.
  onboardingGetProgress: () => request('/onboarding/progress'),
  onboardingSaveProgress: (payload) => request('/onboarding/progress', { method: 'PUT', body: JSON.stringify(payload) }),
  onboardingComplete: (flow) => request('/onboarding/complete', { method: 'POST', body: JSON.stringify({ flow }) }),

  // Task #24 — Brand & landing page generator.
  brandLogo: (payload) => request('/brand/logo', { method: 'POST', body: JSON.stringify(payload) }),
  brandUploadLogo: (formData) => request('/brand/logo/upload', { method: 'POST', body: formData }),
  brandSuggestPalette: (payload) => request('/brand/palette/suggest', { method: 'POST', body: JSON.stringify(payload) }),
  brandSuggestTaglines: (payload) => request('/brand/tagline/suggest', { method: 'POST', body: JSON.stringify(payload) }),
  brandAutofillLanding: (payload) => request('/brand/landing/autofill', { method: 'POST', body: JSON.stringify(payload) }),
  brandGetLanding: (projectId) => request(`/brand/landing/by-project/${projectId}`),
  brandSaveLanding: (projectId, payload) => request(`/brand/landing/by-project/${projectId}`, { method: 'PUT', body: JSON.stringify(payload) }),
  brandPublishLanding: (projectId, published) => request(`/brand/landing/by-project/${projectId}/publish`, { method: 'POST', body: JSON.stringify({ published }) }),
  brandListWaitlist: (projectId, opts = {}) => {
    const q = new URLSearchParams();
    if (opts.audience) q.set('audience', opts.audience);
    const qs = q.toString();
    return request(`/brand/landing/by-project/${projectId}/waitlist${qs ? `?${qs}` : ''}`);
  },
  brandGetPreviewUrl: (projectId) => request(`/brand/landing/by-project/${projectId}/preview-url`),
  brandListTemplates: () => request('/brand/templates'),

  // Task #2 — branded multi-page sites & saved templates.
  brandGetSite: (projectId) => request(`/brand/site/by-project/${projectId}`),
  brandSetSiteSlug: (projectId, slug) => request(`/brand/site/by-project/${projectId}`, { method: 'PUT', body: JSON.stringify({ slug }) }),
  brandListPages: (projectId) => request(`/brand/landing/by-project/${projectId}/pages`),
  brandCreatePage: (projectId, payload) => request(`/brand/landing/by-project/${projectId}/pages`, { method: 'POST', body: JSON.stringify(payload) }),
  brandGetPage: (pageId) => request(`/brand/landing/pages/${pageId}`),
  brandUpdatePage: (pageId, payload) => request(`/brand/landing/pages/${pageId}`, { method: 'PUT', body: JSON.stringify(payload) }),
  brandDeletePage: (pageId) => request(`/brand/landing/pages/${pageId}`, { method: 'DELETE' }),
  brandPublishPage: (pageId, published) => request(`/brand/landing/pages/${pageId}/publish`, { method: 'POST', body: JSON.stringify({ published }) }),
  brandPagePreviewUrl: (pageId) => request(`/brand/landing/pages/${pageId}/preview-url`),
  brandListCustomTemplates: () => request('/brand/custom-templates'),
  brandSaveCustomTemplate: (name, fromPageId) => request('/brand/custom-templates', { method: 'POST', body: JSON.stringify({ name, from_page_id: fromPageId }) }),
  brandDeleteCustomTemplate: (id) => request(`/brand/custom-templates/${id}`, { method: 'DELETE' }),

  // Task #25 — Pitch deck builder.
  deckGenerate: (projectId) => request('/decks/generate', { method: 'POST', body: JSON.stringify({ project_id: projectId }) }),
  deckListVersions: (projectId) => request(`/decks/by-project/${projectId}`),
  deckGet: (id) => request(`/decks/${id}`),
  deckUpdate: (id, payload) => request(`/decks/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deckRestore: (id) => request(`/decks/${id}/restore`, { method: 'POST', body: JSON.stringify({}) }),
  deckShare: (id, payload) => request(`/decks/${id}/share`, { method: 'POST', body: JSON.stringify(payload || {}) }),
  deckShareRead: (token) => request(`/decks/share/${encodeURIComponent(token)}`),
  // Task #53 — viewer heartbeat for read-time tracking + founder engagement panel.
  deckShareHeartbeat: (token, viewId, seconds) => request(
    `/decks/share/${encodeURIComponent(token)}/heartbeat`,
    { method: 'POST', body: JSON.stringify({ view_id: viewId, seconds }) },
  ),
  deckEngagement: (id) => request(`/decks/${id}/engagement`),
  // Task #6 — share-link viewer onboarding + conversion endpoints.
  deckShareContext: (token) => request(`/decks/share/${encodeURIComponent(token)}/context`),
  deckShareSignup: (token, payload) => request(
    `/decks/share/${encodeURIComponent(token)}/signup`,
    { method: 'POST', body: JSON.stringify(payload || {}) },
  ),
  deckShareNda: (token, payload) => request(
    `/decks/share/${encodeURIComponent(token)}/nda`,
    { method: 'POST', body: JSON.stringify(payload || {}) },
  ),
  deckShareFeedback: (token, payload) => request(
    `/decks/share/${encodeURIComponent(token)}/feedback`,
    { method: 'POST', body: JSON.stringify(payload || {}) },
  ),
  deckShareDealPack: (token, payload) => request(
    `/decks/share/${encodeURIComponent(token)}/deal-pack`,
    { method: 'POST', body: JSON.stringify(payload || {}) },
  ),
  deckShareSignDealPack: (token, payload) => request(
    `/decks/share/${encodeURIComponent(token)}/deal-pack/sign`,
    { method: 'POST', body: JSON.stringify(payload || {}) },
  ),
  // Task #16 (DE) — Pitch Deck Builder rewrite.
  deckMethods: () => request('/decks/methods'),
  deckRecommend: (projectId) => request(`/decks/recommend?project_id=${projectId}`),
  deckApplyMethod: (projectId, methodId) =>
    request('/decks/apply-method', { method: 'POST', body: JSON.stringify({ project_id: projectId, method_id: methodId }) }),
  // Task #14 — re-runs autofill against the deck's existing method_id and
  // overwrites the current version's slides in place. Returns the deck
  // plus a per-slide `slide_confidence[]` array for the editor's confidence
  // rail. 409 `no_method_id` means the deck was created before the new
  // fielded editor; client should direct the user to /apply-method first.
  deckAutofill: (id) => request(`/decks/${id}/autofill`, { method: 'POST', body: '{}' }),
  // Task #10 — one-click positioning: pulls the project's team, traction and
  // updates, returns { one_liner, elevator_pitch, positioning_lines[],
  // sourced_from }. 503 `ai_unavailable` when no AI provider is configured
  // (dev FastAPI has no such route → shows an explicit error, never fake lines).
  deckPositioning: (projectId) => request('/decks/positioning', { method: 'POST', body: JSON.stringify({ project_id: projectId }) }),
  // Task #41 — assemble the NEW 10-slide Spin-Out deck DATA + NOTES + gaps[]
  // (the Worker remaps the live Lab data). The browser renders/downloads the
  // .pptx from this via frontend/src/decks/spinout/buildDeck.js. Returns
  // { data, notes, gaps, draft, program_day }.
  spinoutDeck: (projectId) => request(`/projects/${projectId}/spinout-deck`, { method: 'POST', body: '{}' }),
  // Task #42 — pre-flight readiness: same assembler/gaps as spinoutDeck but
  // returns ONLY { gaps, draft, program_day } (skips the heavy DATA + NOTES
  // payload) so the deck page can show what's still missing BEFORE export.
  spinoutDeckPreview: (projectId) => request(`/projects/${projectId}/spinout-deck?preview=1`, { method: 'POST', body: '{}' }),
  // Task #2 — server-side export, format ∈ {pdf, pptx}. PNG cover was
  // removed end-to-end (PDF + PPTX are both driven by Cloudflare Browser
  // Rendering against the live SPA print template).
  deckExport: (id, format) =>
    fetch(`${BASE}/decks/${id}/export`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
        ...getCsrfHeader('POST'),
      },
      body: JSON.stringify({ format }),
    }),
  // Task #2 — public, HMAC-token-gated deck payload consumed by the
  // headless Browser-Rendering session driving server-side exports.
  // No auth cookies/JWT are sent because the session has none; the
  // token signs {deck_id, exp} and is short-lived (3–5 min).
  deckPrintExportRead: (token) => request(`/decks/print-export/${encodeURIComponent(token)}`),
  deckGetBrand: () => request('/decks/brand'),
  deckSetWatermark: (url) => request('/decks/brand/watermark', { method: 'PUT', body: JSON.stringify({ watermark_url: url }) }),

  matchDealFlow: () => request('/matches/deal-flow'),
  matchCoInvest: () => request('/matches/co-invest'),
  matchReferralScores: () => request('/matches/referral-scores'),
  matchScore: (data) => request('/matches/score', { method: 'POST', body: JSON.stringify(data) }),
  matchAdminAll: () => request('/matches/admin/all'),

  studioOpsTemplates: () => request('/studioops/templates'),
  studioOpsWorkflows: (params = {}) => {
    const q = new URLSearchParams(Object.entries(params).filter(([_, v]) => v != null && v !== '')).toString();
    return request('/studioops/workflows' + (q ? '?' + q : ''));
  },
  studioOpsWorkflow: (id) => request(`/studioops/workflows/${id}`),
  studioOpsCreateWorkflow: (data) => request('/studioops/workflows', { method: 'POST', body: JSON.stringify(data) }),
  studioOpsUpdateWorkflow: (id, data) => request(`/studioops/workflows/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  studioOpsDeleteWorkflow: (id) => request(`/studioops/workflows/${id}`, { method: 'DELETE' }),
  studioOpsExecuteTemplate: (data) => request('/studioops/execute-template', { method: 'POST', body: JSON.stringify(data) }),
  studioOpsCreateTask: (data) => request('/studioops/tasks', { method: 'POST', body: JSON.stringify(data) }),
  studioOpsUpdateTask: (id, data) => request(`/studioops/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  studioOpsStrategicReview: (projectId) => request(`/studioops/strategic-review/${projectId}`),
  studioOpsAiAssist: (data) => request('/studioops/ai-assist', { method: 'POST', body: JSON.stringify(data) }),
  studioOpsAudit: () => request('/studioops/audit'),
  studioOpsStats: () => request('/studioops/stats'),

  networkFxEffects: () => request('/networkfx/effects'),
  networkFxCompounding: () => request('/networkfx/referrals/compounding'),
  networkFxSyndicates: (status) => request('/networkfx/syndicates' + (status ? `?status=${status}` : '')),
  networkFxSyndicate: (id) => request(`/networkfx/syndicates/${id}`),
  networkFxCreateSyndicate: (data) => request('/networkfx/syndicates', { method: 'POST', body: JSON.stringify(data) }),
  networkFxJoinSyndicate: (id, data) => request(`/networkfx/syndicates/${id}/join`, { method: 'POST', body: JSON.stringify(data) }),
  networkFxCloseSyndicate: (id) => request(`/networkfx/syndicates/${id}/close`, { method: 'POST', body: JSON.stringify({}) }),
  networkFxSyndicateRecs: (id) => request(`/networkfx/syndicates/${id}/recommendations`),
  networkFxMarketplaceMe: () => request('/networkfx/marketplace/me'),
  networkFxSaveMarketplace: (data) => request('/networkfx/marketplace/me', { method: 'PUT', body: JSON.stringify(data) }),
  networkFxMarketplaceSearch: (filters = {}) => {
    const q = new URLSearchParams(Object.entries(filters).filter(([_, v]) => v != null && v !== '')).toString();
    return request('/networkfx/marketplace/search' + (q ? '?' + q : ''));
  },
  networkFxRequestIntro: (data) => request('/networkfx/marketplace/request-intro', { method: 'POST', body: JSON.stringify(data) }),
  networkFxMarketplaceMatch: (data) => request('/networkfx/marketplace/match', { method: 'POST', body: JSON.stringify(data) }),

  getDashboard: (fresh = false) => request('/dashboard' + (fresh ? '?fresh=1' : '')),
  refreshDashboardScores: () => request('/dashboard/refresh-scores', { method: 'POST', body: JSON.stringify({}) }),
  // Task #81 — read-only investor deal lifecycle (funnel counts by stage).
  investorLifecycle: () => request('/dashboard/investor-lifecycle'),

  pipelineActive: () => request('/pipeline/active'),
  pipelineCreateProject: (data) => request('/pipeline/projects', { method: 'POST', body: JSON.stringify(data) }),
  pipelineAdvance: (id, stage) => request(`/pipeline/projects/${id}/advance`, { method: 'POST', body: JSON.stringify({ stage }) }),
  pipelineDealDetail: (id) => request(`/pipeline/projects/${id}/detail`),
  pipelineCreateTask: (data) => request('/pipeline/mvp-tasks', { method: 'POST', body: JSON.stringify(data) }),
  pipelineUpdateTask: (id, data) => request(`/pipeline/mvp-tasks/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  pipelineSnapshot: (data) => request('/pipeline/metrics/snapshot', { method: 'POST', body: JSON.stringify(data) }),
  pipelineTriggerReview: (deal_id) => request('/pipeline/decision-gate/review', { method: 'POST', body: JSON.stringify({ deal_id }) }),
  pipelineDecide: (gate_id, decision) => request('/pipeline/decision-gate/decide', { method: 'PATCH', body: JSON.stringify({ gate_id, decision }) }),

  partnerSummary: () => request('/partnernet/summary'),
  partnerRelationships: () => request('/partnernet/relationships'),
  createRelationship: (data) => request('/partnernet/relationships', { method: 'POST', body: JSON.stringify(data) }),
  updateRelationship: (id, data) => request(`/partnernet/relationships/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  relationshipEvents: (id) => request(`/partnernet/relationships/${id}/events`),
  activityLogs: (limit = 50, offset = 0, action = '') => request(`/partnernet/activity/logs?limit=${limit}&offset=${offset}${action ? `&action_type=${action}` : ''}`),
  logActivity: (data) => request('/partnernet/activity/log', { method: 'POST', body: JSON.stringify(data) }),
  partnerLeaderboard: () => request('/partnernet/leaderboard').catch(() => request('/partnernet/leaderboard/public')),

  legalGenerate: (data) => request('/legalcap/legal/generate', { method: 'POST', body: JSON.stringify(data) }),
  legalDocs: (dealId) => request(`/legalcap/legal/docs/${dealId}`),
  legalSign: (id) => request(`/legalcap/legal/docs/${id}/sign`, { method: 'PATCH', body: JSON.stringify({}) }),
  createCapitalCall: (data) => request('/legalcap/capital/call', { method: 'POST', body: JSON.stringify(data) }),
  capitalSend: (id) => request(`/legalcap/capital/call/${id}/send`, { method: 'PATCH', body: JSON.stringify({}) }),
  respondCapitalCall: (id, data) => request(`/legalcap/capital/call/${id}/respond`, { method: 'POST', body: JSON.stringify(data) }),
  lpPortal: () => request('/capital/lp-portal'),

  // ───── Pipeline community voting ─────
  getVotes: (dealId, includeComments = false) =>
    request(`/pipeline/votes/${dealId}${includeComments ? '?include_comments=true' : ''}`),
  castVote: (dealId, body) =>
    request(`/pipeline/vote/${dealId}`, { method: 'POST', body: JSON.stringify(body) }),
  voteLeaderboard: (limit = 10) => request(`/pipeline/votes/leaderboard?limit=${limit}`),
  capitalCalls: () => request('/legalcap/capital/calls').catch(() => []),
  diligenceReview: (data) => request('/legalcap/diligence/review', { method: 'POST', body: JSON.stringify(data) }),
  diligenceFor: (dealId) => request(`/legalcap/diligence/${dealId}`),
  complianceFor: (dealId) => request(`/legalcap/compliance/${dealId}`),
  subsidiaryFor: (dealId) => request(`/legalcap/subsidiaries/${dealId}`),
  spinout: (data) => request('/legalcap/subsidiary/spinout', { method: 'POST', body: JSON.stringify(data) }),

  spinoutExecute: (data) => request('/legalcap/spinout/execute', { method: 'POST', body: JSON.stringify(data) }),
  spinoutStatus: (dealId) => request(`/legalcap/spinout/status/${dealId}`),
  spinoutIpTransfer: (data) => request('/legalcap/spinout/ip-transfer', { method: 'POST', body: JSON.stringify(data) }),
  spinoutEquity: (data) => request('/legalcap/spinout/equity-allocate', { method: 'POST', body: JSON.stringify(data) }),
  spinoutAtlas: (data) => request('/legalcap/spinout/stripe-atlas', { method: 'POST', body: JSON.stringify(data) }),
  spinoutGoIndependent: (data) => request('/legalcap/spinout/go-independent', { method: 'POST', body: JSON.stringify(data) }),
  spinoutIterate: (data) => request('/legalcap/spinout/iterate', { method: 'POST', body: JSON.stringify(data) }),
  independentSubsidiaries: () => request('/legalcap/spinout/independent').catch(() => []),

  // ---------- Monitoring (admin) ----------
  monitoringMetrics: (minutes = 60) => request(`/monitoring/metrics?minutes=${minutes}`),
  monitoringRateLimits: (minutes = 60) => request(`/monitoring/rate-limits?minutes=${minutes}`),
  monitoringErrors: (limit = 50) => request(`/monitoring/errors?limit=${limit}`),
  monitoringAnomalies: () => request('/monitoring/anomalies'),
  monitoringThroughput: () => request('/monitoring/throughput'),
  monitoringCleanup: () => request('/monitoring/cleanup', { method: 'POST' }),
  // Task #1 (AX) — admin AI router usage rollup (per-day spend, fallback
  // rate, p50/p95 latency, top 10 most expensive users).
  monitoringAiUsage: (days = 7) => request(`/monitoring/ai-usage?days=${days}`),

  // ---------- Monitoring → Analytics (admin, Task #3 / Task #13) ----------
  // Task #13 — analytics reads auto-retry once on 5xx with a 1s backoff so
  // a transient D1 hiccup or worker cold-start doesn't surface as a red
  // error card. The retry is bounded to GET reads only (no side effects).
  analyticsOverview: (from, to, currency = '') =>
    _analyticsRead(`/monitoring/analytics/overview?from=${encodeURIComponent(from || '')}&to=${encodeURIComponent(to || '')}&currency=${encodeURIComponent(currency)}`),
  analyticsCurrencies: () => _analyticsRead('/monitoring/analytics/currencies'),
  analyticsCohorts: (metric = 'retention', granularity = 'week') =>
    _analyticsRead(`/monitoring/analytics/cohorts?metric=${metric}&granularity=${granularity}`),
  analyticsUsers: ({ role = '', tier = '', search = '', limit = 50, offset = 0 } = {}) =>
    _analyticsRead(`/monitoring/analytics/users?role=${encodeURIComponent(role)}&tier=${encodeURIComponent(tier)}&search=${encodeURIComponent(search)}&limit=${limit}&offset=${offset}`),
  analyticsUser: (id) => _analyticsRead(`/monitoring/analytics/user/${id}`),
  analyticsFinancial: (from, to, currency = '') =>
    _analyticsRead(`/monitoring/analytics/financial?from=${encodeURIComponent(from || '')}&to=${encodeURIComponent(to || '')}&currency=${encodeURIComponent(currency)}`),
  analyticsTechnical: (from, to) =>
    _analyticsRead(`/monitoring/analytics/technical?from=${encodeURIComponent(from || '')}&to=${encodeURIComponent(to || '')}`),
  analyticsManagement: (from, to, currency = '') =>
    _analyticsRead(`/monitoring/analytics/management?from=${encodeURIComponent(from || '')}&to=${encodeURIComponent(to || '')}&currency=${encodeURIComponent(currency)}`),
  analyticsBackfillSnapshots: (days = 7) =>
    request('/monitoring/analytics/snapshots/backfill', { method: 'POST', body: JSON.stringify({ days }) }),
  analyticsExport: (payload) =>
    request('/monitoring/analytics/export', { method: 'POST', body: JSON.stringify(payload) }),
  analyticsAudit: (limit = 25, action = 'analytics_export', opts = {}) => {
    const params = new URLSearchParams();
    params.set('limit', String(limit));
    params.set('action', action);
    if (opts.offset) params.set('offset', String(opts.offset));
    if (opts.plan_id) params.set('plan_id', opts.plan_id);
    if (opts.admin_user_id) params.set('admin_user_id', String(opts.admin_user_id));
    if (opts.admin_q) params.set('admin_q', opts.admin_q);
    if (opts.from) params.set('from', opts.from);
    if (opts.to) params.set('to', opts.to);
    return _analyticsRead(`/monitoring/analytics/audit?${params.toString()}`);
  },
  // Task #20 — Stream the Plan change history CSV for the active filters.
  // Returns a Blob + filename so the caller can trigger a download.
  analyticsAuditExportCsv: async (opts = {}) => {
    const params = new URLSearchParams();
    if (opts.plan_id) params.set('plan_id', opts.plan_id);
    if (opts.admin_user_id) params.set('admin_user_id', String(opts.admin_user_id));
    if (opts.admin_q) params.set('admin_q', opts.admin_q);
    if (opts.from) params.set('from', opts.from);
    if (opts.to) params.set('to', opts.to);
    const token = localStorage.getItem('token');
    const qs = params.toString();
    const res = await fetch(`/api/monitoring/analytics/audit/export.csv${qs ? `?${qs}` : ''}`, {
      credentials: 'include',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      let detail = res.statusText || 'Export failed';
      try { const e = await res.json(); detail = e?.detail || e?.error || detail; } catch {}
      const e = new Error(detail); e.status = res.status; throw e;
    }
    const blob = await res.blob();
    const filename = (res.headers.get('Content-Disposition') || '').match(/filename="?([^"]+)"?/)?.[1] || 'plan-change-history.csv';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  },
  analyticsListPlans: () => _analyticsRead('/monitoring/analytics/plans'),
  analyticsCreatePlan: (payload) =>
    request('/monitoring/analytics/plans', { method: 'POST', body: JSON.stringify(payload) }),
  analyticsUpdatePlan: (planId, patch) =>
    request(`/monitoring/analytics/plans/${encodeURIComponent(planId)}`, {
      method: 'PATCH', body: JSON.stringify(patch),
    }),
  analyticsDeletePlan: (planId) =>
    request(`/monitoring/analytics/plans/${encodeURIComponent(planId)}`, {
      method: 'DELETE',
    }),

  // ---------- Infrastructure (admin) ----------
  infraQueue: () => request('/infra/queue'),
  infraMetrics: (minutes = 60) => request(`/infra/metrics?minutes=${minutes}`),
  infraProcess: (batch = 10) => request(`/infra/process?batch=${batch}`, { method: 'POST' }),
  infraEnqueue: (job_type, payload, max_retries) =>
    request('/infra/enqueue', { method: 'POST', body: JSON.stringify({ job_type, payload, max_retries }) }),
  infraCleanup: () => request('/infra/cleanup', { method: 'POST' }),
  infraDLQ: (params = {}) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== '' && v !== null)).toString();
    return request(`/infra/dlq${q ? `?${q}` : ''}`);
  },
  infraRetryDLQ: (id, source) => request(`/infra/dlq/${encodeURIComponent(id)}/retry?source=${encodeURIComponent(source)}`, { method: 'POST' }),
  infraDeleteDLQ: (id, source) => request(`/infra/dlq/${encodeURIComponent(id)}?source=${encodeURIComponent(source)}`, { method: 'DELETE' }),
  infraCronHistory: (params = {}) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== '' && v !== null)).toString();
    return request(`/infra/cron-history${q ? `?${q}` : ''}`);
  },
  infraWSCheck: () => request('/infra/ws-check'),
  infraReembedMetrics: (hours = 24) => request(`/infra/reembed-metrics?hours=${hours}`),

  // ---------- Funds & LPs ----------
  fundsList: (status) => request(`/funds${status ? `?status=${status}` : ''}`),
  fundGet: (id) => request(`/funds/${id}`),
  fundCreate: (data) => request('/funds', { method: 'POST', body: JSON.stringify(data) }),
  fundUpdate: (id, data) => request(`/funds/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  fundLPs: (id) => request(`/funds/${id}/lps`),
  fundAddLP: (id, data) => request(`/funds/${id}/lps`, { method: 'POST', body: JSON.stringify(data) }),
  fundCapitalCall: (id, amount, note) =>
    request(`/funds/${id}/capital-call`, { method: 'POST', body: JSON.stringify({ amount, note }) }),

  // ---------- Liquidity / Secondary market ----------
  liquidityMarketplace: () => request('/liquidity/marketplace'),
  liquidityList: (data) => request('/liquidity/list', { method: 'POST', body: JSON.stringify(data) }),
  liquidityMatch: (listing_id) =>
    request('/liquidity/match', { method: 'POST', body: JSON.stringify({ listing_id }) }),
  liquidityListingMatches: (id) => request(`/liquidity/listings/${id}/matches`),
  liquidityExecuteExit: (data) =>
    request('/liquidity/execute-exit', { method: 'POST', body: JSON.stringify(data) }),
  liquidityMyPortfolio: () => request('/liquidity/my-portfolio'),
  liquidityEvents: () => request('/liquidity/events'),

  // ---------- VC Funds / LP Portal / Distributions ----------
  fundsList: (status) => request(`/funds${status ? `?status=${status}` : ''}`),
  fundsGet: (id) => request(`/funds/${id}`),
  fundsCreateV2: (data) => request('/funds', { method: 'POST', body: JSON.stringify(data) }),
  fundsRegenerateLpa: (id) => request(`/funds/${id}/regenerate-lpa`, { method: 'POST' }),
  fundsLpa: (id) => request(`/funds/${id}/lpa`),
  fundsCapitalCallV2: (id, amount_cents, note) =>
    request(`/funds/${id}/capital-call`, { method: 'POST', body: JSON.stringify({ amount_cents, note }) }),
  fundsLpsList: (id) => request(`/funds/${id}/lps`),
  fundsAddLpV2: (id, data) =>
    request(`/funds/${id}/lps`, { method: 'POST', body: JSON.stringify(data) }),
  fundsSignLpa: (lpId) =>
    request(`/funds/lps/${lpId}/sign-lpa`, { method: 'POST', body: JSON.stringify({}) }),
  fundsLpPortal: () => request('/funds/lp-portal'),
  fundsSyndication: () => request('/funds/syndication'),
  fundsDistributions: (fund_id) => request(`/funds/distributions?fund_id=${fund_id}`),
  fundsExecuteDistribution: (data) =>
    request('/funds/distributions/execute', { method: 'POST', body: JSON.stringify(data) }),
  fundsMarkDistributionPaid: (id) =>
    request(`/funds/distributions/${id}/mark-paid`, { method: 'POST', body: JSON.stringify({}) }),

  // ---------- Branded email (Gmail) ----------
  emailSendDeal: (data) => request('/email/send-deal', { method: 'POST', body: JSON.stringify(data) }),
  emailSendReferralInvites: (contacts, custom_message) =>
    request('/email/send-referral-invites', {
      method: 'POST',
      body: JSON.stringify({ contacts, custom_message }),
    }),
  // Task #4 — Sent invitations panel + per-row reminder action.
  emailInvites: () => request('/email/invites'),
  emailRemindInvite: (id) =>
    request(`/email/invites/${encodeURIComponent(id)}/remind`, { method: 'POST' }),

  // ---------- LinkedIn (Refer & Earn) ----------
  // Sign-in with LinkedIn (OIDC) attaches a verified identity to the
  // current user. The connections-CSV import is parsed in-browser and
  // never hits the worker.
  linkedinStatus: () => request('/linkedin/status'),
  linkedinOAuthStart: ({ return_to } = {}) =>
    request('/linkedin/oauth/start', { method: 'POST', body: JSON.stringify(return_to ? { return_to } : {}) }),
  linkedinDisconnect: () => request('/linkedin/disconnect', { method: 'POST', body: JSON.stringify({}) }),

  // Task #67 — Autopopulate profile from LinkedIn (connected account OR a
  // LinkedIn PDF export). preview() never writes; apply() persists the
  // user-reviewed proposal. source is 'account' | 'pdf'.
  linkedinImportPreview: ({ source, pdf_data_uri } = {}) =>
    request('/settings/profile/linkedin-import/preview', {
      method: 'POST',
      body: JSON.stringify(pdf_data_uri ? { source, pdf_data_uri } : { source }),
    }),
  linkedinImportApply: (proposal) =>
    request('/settings/profile/linkedin-import/apply', {
      method: 'POST',
      body: JSON.stringify(proposal || {}),
    }),

  // ---------- Settings (Epic 3) ----------
  getSettings: () => request('/settings'),
  updateSettings: (data) => request('/settings', { method: 'PATCH', body: JSON.stringify(data) }),
  // Task #66 — structured career background (experience / education / certifications / website).
  getProfileBackground: () => request('/settings/profile/background'),
  updateProfileBackground: (data) =>
    request('/settings/profile/background', { method: 'PUT', body: JSON.stringify(data) }),
  uploadHeadshot: (data_uri) => request('/settings/headshot', { method: 'POST', body: JSON.stringify({ data_uri }) }),
  requestEmailChange: (new_email) => request('/settings/email-change/request', { method: 'POST', body: JSON.stringify({ new_email }) }),
  confirmEmailChange: (token) => request('/settings/email-change/confirm', { method: 'POST', body: JSON.stringify({ token }) }),
  revokeEmailChange: (token) => request('/settings/email-change/revoke', { method: 'POST', body: JSON.stringify({ token }) }),
  repairTotp: (totp_code) => request('/settings/totp/repair', { method: 'POST', body: JSON.stringify({ totp_code }) }),
  // Task #11 — first-time OPTIONAL authenticator enrolment (two-phase).
  // start() proposes a secret (nothing persists server-side); confirm()
  // round-trips the secret + a live 6-digit code, persists the enrolment,
  // and upgrades the current session to full assurance in place.
  enrolTotpStart: () => request('/settings/totp/enrol/start', { method: 'POST', body: JSON.stringify({}) }),
  enrolTotpConfirm: (data) => request('/settings/totp/enrol/confirm', { method: 'POST', body: JSON.stringify(data) }),
  revokeAllSessions: () => request('/settings/sessions/revoke-all', { method: 'POST', body: JSON.stringify({}) }),
  requestAccountDeletion: () => request('/settings/account/delete-request', { method: 'POST', body: JSON.stringify({}) }),
  cancelAccountDeletion: () => request('/settings/account/delete-request/cancel', { method: 'POST', body: JSON.stringify({}) }),
  // The export endpoint streams a JSON file; we want the raw blob, not parsed JSON.
  exportMyData: async () => {
    const res = await fetch(`${BASE}/settings/data-export`, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Export failed');
    return await res.blob();
  },
  listSessions: () => request('/settings/sessions'),
  revokeSession: (id) => request(`/settings/sessions/${id}/revoke`, { method: 'POST', body: JSON.stringify({}) }),
  regenerateRecoveryCodes: (totp_code) =>
    request('/settings/totp/recovery-codes/regenerate', { method: 'POST', body: JSON.stringify({ totp_code }) }),
  // Task #20 — settings sub-routes (user_settings table).
  getProfileSettings: () => request('/settings/profile'),
  updateProfileSettings: (data) => request('/settings/profile', { method: 'PUT', body: JSON.stringify(data) }),
  getPrivacySettings: () => request('/settings/privacy'),
  updatePrivacySettings: (data) => request('/settings/privacy', { method: 'PUT', body: JSON.stringify(data) }),
  getAppearanceSettings: () => request('/settings/appearance'),
  updateAppearanceSettings: (data) => request('/settings/appearance', { method: 'PUT', body: JSON.stringify(data) }),
  getNotificationSettings: () => request('/settings/notifications'),
  updateNotificationSettings: (data) => request('/settings/notifications', { method: 'PUT', body: JSON.stringify(data) }),
  getSecuritySettings: () => request('/settings/security'),
  getIntegrationSettings: () => request('/settings/integrations'),
  getDeveloperSettings: () => request('/settings/developer'),
  updateDeveloperSettings: (data) => request('/settings/developer', { method: 'PUT', body: JSON.stringify(data) }),
  resyncDeveloperIndices: () => request('/settings/developer/resync-indices', { method: 'POST', body: JSON.stringify({}) }),
  listFounderInvites: () => request('/settings/founder/invites'),
  createFounderInvite: (data) =>
    request('/settings/founder/invites', { method: 'POST', body: JSON.stringify(data) }),
  revokeFounderInvite: (id) =>
    request(`/settings/founder/invites/${id}`, { method: 'DELETE' }),

  // Company Profiles (Growth & Expansion Track — Task 1)
  companyMe: () => request('/company/me'),
  getCompany: (uid) => request(`/company/${uid}`),
  listCompanies: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString();
    return request(`/companies${qs ? `?${qs}` : ''}`);
  },
  createCompany: (data) => request('/company/create', { method: 'POST', body: JSON.stringify(data) }),
  updateCompany: (uid, data) => request(`/company/${uid}`, { method: 'PATCH', body: JSON.stringify(data) }),
  addCompanyMember: (uid, data) => request(`/company/${uid}/members`, { method: 'POST', body: JSON.stringify(data) }),
  removeCompanyMember: (uid, userId) => request(`/company/${uid}/members/${userId}`, { method: 'DELETE' }),

  // ---------- Personas (Epic 1) ----------
  getPersonaTaxonomy: () => request('/personas/taxonomy'),
  getMyPersonas: () => request('/personas/me'),
  classifyPersona: (first_message) =>
    request('/personas/classify', { method: 'POST', body: JSON.stringify({ first_message }) }),
  answerPersona: (persona_id, key, value) =>
    request('/personas/answer', { method: 'POST', body: JSON.stringify({ persona_id, key, value }) }),
  finalizePersona: (persona_id, confidence, source = 'router', secondary_persona_id = null) =>
    request('/personas/finalize', {
      method: 'POST',
      body: JSON.stringify({ persona_id, confidence, source, secondary_persona_id }),
    }),
  listPersonasAdmin: () => request('/personas/admin/list'),
  retagPersonaAdmin: (user_id, persona_id) =>
    request(`/personas/admin/${user_id}/retag`, { method: 'POST', body: JSON.stringify({ persona_id }) }),

  // ---------- Cap-table simulator (Task #27) ----------
  simulateCapTable: (inputs) =>
    request('/captable/simulate', { method: 'POST', body: JSON.stringify({ inputs }) }),
  listCapTableScenarios: () => request('/captable/scenarios'),
  getCapTableByProject: (projectId) => request(`/captable/scenarios/by-project/${projectId}`),
  createCapTableVariant: (projectId, data) =>
    request(`/captable/scenarios/by-project/${projectId}/variants`, { method: 'POST', body: JSON.stringify(data) }),
  getCapTableCompare: (projectId) => request(`/captable/scenarios/by-project/${projectId}/compare`),
  getCapTableScenario: (uid) => request(`/captable/scenarios/${uid}`),
  createCapTableScenario: (data) =>
    request('/captable/scenarios', { method: 'POST', body: JSON.stringify(data) }),
  updateCapTableScenario: (uid, data) =>
    request(`/captable/scenarios/${uid}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteCapTableScenario: (uid) =>
    request(`/captable/scenarios/${uid}`, { method: 'DELETE' }),
  exportCapTableCsvUrl: (uid) => `/api/captable/scenarios/${uid}/export.csv`,
  // Task #5 — live cap table (Carta-synced + manually-promoted rows).
  liveCapTable: () => request('/captable/live'),

  // ---------- Task #6 — Founder subscription tier (FREE / GROWTH / STUDIO) ----------
  // 402 `tier_required` responses are auto-handled by `request` above (it
  // dispatches `studioos:tier_required` so PaywallModal opens). These helpers
  // are for explicit triggers from Settings → Billing and the modal itself.
  tierStatus: () => request('/billing/tier/status'),
  tierCheckout: (tier) =>
    request('/billing/tier/checkout', { method: 'POST', body: JSON.stringify({ tier }) }),
  tierPortal: () => request('/billing/tier/portal', { method: 'POST' }),

  // ---------- Persona (account-plan) billing — partner, advisor, … ----------
  // Generic subscription pipeline for every signed-in role that isn't a founder
  // or investor. planStatus returns the caller's current plan/trial/renewal;
  // planCheckout creates an incomplete subscription and returns a client_secret
  // the SPA confirms inline (no redirect), or a dev-upgrade url in keyless dev.
  planStatus: () => request('/billing/plan/status'),
  planCheckout: (interval) =>
    request('/billing/plan/checkout', { method: 'POST', body: JSON.stringify({ interval }) }),

  // ---------- Task #5 — In-app billing dashboard (replaces Stripe portal) ----------
  // `scope` is 'founder' (founder-tier customer) or 'investor' (investor
  // customer). Overview returns active subs, cards, upcoming + recent invoices.
  // Cancel/resume toggle cancel_at_period_end; swap previews proration then
  // confirms the plan change — all server-side via the Stripe REST wrapper.
  billingOverview: (scope) =>
    request(`/billing/overview${scope ? `?scope=${encodeURIComponent(scope)}` : ''}`),
  billingCancelSubscription: (subscription_id, scope) =>
    request('/billing/subscription/cancel', { method: 'POST', body: JSON.stringify({ subscription_id, scope }) }),
  billingResumeSubscription: (subscription_id, scope) =>
    request('/billing/subscription/resume', { method: 'POST', body: JSON.stringify({ subscription_id, scope }) }),
  billingSwapPreview: (subscription_id, price_id, scope) =>
    request('/billing/subscription/swap/preview', { method: 'POST', body: JSON.stringify({ subscription_id, price_id, scope }) }),
  billingSwapConfirm: (subscription_id, price_id, scope) =>
    request('/billing/subscription/swap/confirm', { method: 'POST', body: JSON.stringify({ subscription_id, price_id, scope }) }),
  // In-app payment-method management (scope-aware; step-up gated server-side).
  // setup-intent returns a SetupIntent client_secret the SPA confirms via Stripe
  // Elements `confirmSetup` so raw card data never touches our servers.
  billingPaymentMethodSetup: (scope) =>
    request('/billing/payment-method/setup-intent', { method: 'POST', body: JSON.stringify({ scope }) }),
  billingPaymentMethodDefault: (payment_method_id, scope) =>
    request('/billing/payment-method/default', { method: 'POST', body: JSON.stringify({ payment_method_id, scope }) }),
  billingPaymentMethodDetach: (payment_method_id, scope) =>
    request('/billing/payment-method/detach', { method: 'POST', body: JSON.stringify({ payment_method_id, scope }) }),

  // ---------- Task #4 — Axal-branded embedded checkout (Stripe Elements) ----------
  // Server creates a PaymentIntent / incomplete Subscription and hands back a
  // `client_secret`; the SPA confirms the card in-app via Stripe Elements so
  // the user never leaves for checkout.stripe.com. Shapes:
  //   { price_id, quantity?, nonce?, description? }  → price-driven (sub or one-time)
  //   { amount, currency?, quantity?, nonce?, description? } → ad-hoc one-time charge
  // Response: { kind:'subscription'|'payment', client_secret, ... }
  paymentIntent: (body) =>
    request('/payments/intent', { method: 'POST', body: JSON.stringify(body || {}) }),
  // Task #7 — à la carte feature unlock. Creates a one-time PaymentIntent for a
  // SKU with metadata.kind='alacarte'; on success the webhook grants the
  // feature_unlock the product's metadata.feature_key maps to. Body:
  //   { price_id, nonce? } → { kind:'payment', client_secret, payment_intent_id, ... }
  alacarteIntent: (body) =>
    request('/payments/alacarte/intent', { method: 'POST', body: JSON.stringify(body || {}) }),
  // The caller's active (non-expired) feature unlocks:
  //   → { unlocks: [{ feature_key, expires_at }] }
  alacarteUnlocks: () => request('/payments/alacarte/unlocks'),
  // Task #9 — preview a promo code against a catalog price. Server validates the
  // code against the product allow-list + usage limit and recomputes the
  // discount (never trusts a client amount). Body: { code, price_id }.
  // → { valid:true, code, percent_off, amount_off, currency, original_amount,
  //     discount_cents, discounted_amount, free } | { valid:false, reason }
  validatePromo: (body) =>
    request('/payments/promo/validate', { method: 'POST', body: JSON.stringify(body || {}) }),
  // Mirrored Stripe catalog (read). `kind` filters: subscription | incorporation
  // | session | alacarte. `audience` filters: founders | investors_lps |
  // service_partners | advisors | legal_services (a product may match more
  // than one; the filter is applied server-side against each product's
  // derived `categories`). Returns { products: [{ id, name, kind, categories,
  // prices: [...] }], audience_categories: [{ value, label }] }.
  catalogProducts: (kind, audience) => {
    const params = new URLSearchParams();
    if (kind) params.set('kind', kind);
    if (audience) params.set('audience', audience);
    const qs = params.toString();
    return request(`/catalog/products${qs ? `?${qs}` : ''}`);
  },

  // ---------- Products page — explorer promo (30-day license codes) ----------
  // The caller's issued one-time code (from completing the Explorer needs
  // bank in the Personal Advisor): → { promo: { code, license_label,
  // unlock_days, issued_at, expires_at, redeemed_at } | null }.
  productsPromo: () => request('/products/promo'),
  // Redeem it → { ok:true, confirmation: { code, license_label, unlock_days,
  // amount_cents:0, currency, redeemed_at, license_expires_at } }
  // | { ok:false, reason: 'not_found'|'already_redeemed'|'expired' } (400).
  productsRedeem: (code) =>
    request('/products/redeem', { method: 'POST', body: JSON.stringify({ code }) }),

  // ---------- One-time cart order (checkout) ----------
  // Runtime Stripe publishable key (mirror of stripe.js fetch — exposed here so
  // pages/components can reuse it via the api surface). → { publishable_key }.
  paymentsConfig: () => request('/payments/config'),
  // Create/refresh ONE combined PaymentIntent for a cart of one-time items.
  // Body: { items:[{price_id, quantity}], promo_code?, billing_country?, nonce? }
  // → { client_secret, payment_intent_id, order_ref, currency, subtotal,
  //     discount_cents, vat_cents, total, free, items:[...] }.
  createOrderIntent: (body) =>
    request('/orders/intent', { method: 'POST', body: JSON.stringify(body || {}) }),
  // Belt-and-suspenders fulfilment after Stripe confirmation.
  // Body: { payment_intent_id } → { order:<Order> } | 409 { error:'not_paid', status }.
  confirmOrder: (payment_intent_id) =>
    request('/orders/confirm', { method: 'POST', body: JSON.stringify({ payment_intent_id }) }),
  // Owner-only order fetch → { order:<Order> } | 404.
  getOrder: (orderRef) => request(`/orders/${encodeURIComponent(orderRef)}`),
  // Owner's orders, most recent first → { orders:[<Order>] }.
  myOrders: () => request('/orders/mine'),
  // Authenticated PDF invoice download (bearer-only fetch → Blob). NEVER use a
  // plain <a href> — the endpoint requires the Authorization header.
  orderInvoiceBlob: async (orderRef) => {
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/orders/${encodeURIComponent(orderRef)}/invoice`, {
      credentials: 'include',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      let detail = res.statusText || 'Invoice download failed';
      try { const err = await res.json(); detail = err?.error || err?.detail || detail; } catch { /* non-JSON */ }
      const e = new Error(detail);
      e.status = res.status;
      throw e;
    }
    const blob = await res.blob();
    const filename = (res.headers.get('Content-Disposition') || '').match(/filename="?([^"]+)"?/)?.[1] || `${orderRef}.pdf`;
    return { blob, url: URL.createObjectURL(blob), filename };
  },

  // ---------- Task #7 (W-2) — Investor paywall (3-tier: free / pro / inst) ----------
  // Mirrors `/api/billing/investor/*` + `/api/investor-seats/*` +
  // `/api/introductions/quota`. The 402 `{required, message, …}` shape from
  // the worker is auto-fanned into `studioos:tier_required` by the request
  // helper above, so PaywallModal opens automatically on quota exhaustion.
  investorBillingStatus: () => request('/billing/investor/status'),
  investorCheckout: (plan) =>
    request('/billing/investor/checkout', { method: 'POST', body: JSON.stringify({ plan }) }),
  investorPortal: () => request('/billing/investor/portal', { method: 'POST' }),
  listInvestorSeats: () => request('/investor-seats/'),
  inviteInvestorSeat: (email) =>
    request('/investor-seats/invite', { method: 'POST', body: JSON.stringify({ email }) }),
  acceptInvestorSeat: (token) =>
    request('/investor-seats/accept', { method: 'POST', body: JSON.stringify({ token }) }),
  revokeInvestorSeat: (id) =>
    request(`/investor-seats/${id}`, { method: 'DELETE' }),
  introductionsQuota: () => request('/introductions/quota'),
  listIntroductions: () => request('/introductions/'),
  // Task #82 — request a warm intro to a founder/project. Consumes the intro
  // quota; on exhaustion the worker returns 402 {code:'quota_intros_exhausted',
  // message, upgrade_to, checkout_path} WITHOUT a `required` field, so the
  // global PaywallModal does NOT auto-open — callers surface the limit inline.
  introductionsRequest: (data) =>
    request('/introductions/request', { method: 'POST', body: JSON.stringify(data || {}) }),

  // ---------- Network Introductions (all user types) ----------
  // Curated warm-intro propositions under Network › Introductions. Accepting
  // spends ONE introduction credit; the worker returns 402
  // {code:'intro_credits_exhausted', packs, buy_path} when the balance is
  // empty — callers surface the buy-more flow inline (no PaywallModal).
  introPropositions: ({ status, refresh } = {}) => {
    const qs = new URLSearchParams();
    if (status) qs.set('status', status);
    if (refresh) qs.set('refresh', '1');
    const q = qs.toString();
    return request(`/introductions/propositions${q ? `?${q}` : ''}`);
  },
  introAccept: (uid) =>
    request(`/introductions/propositions/${encodeURIComponent(uid)}/accept`, { method: 'POST' }),
  introDecline: (uid) =>
    request(`/introductions/propositions/${encodeURIComponent(uid)}/decline`, { method: 'POST' }),
  introCredits: () => request('/introductions/credits'),
  introCreditHistory: () => request('/introductions/credits/history'),
  introPacks: () => request('/introductions/packs'),
  // Mint the PaymentIntent for a credit pack (10 / 100 / 1000); the returned
  // client_secret feeds <AxalCheckout clientSecret={…}>. Fulfilment happens
  // via the Stripe webhook, idempotent on the intent id.
  introCreditsIntent: (pack, nonce) =>
    request('/payments/intro-credits/intent', {
      method: 'POST',
      body: JSON.stringify({ pack, nonce }),
    }),

  // ---------- Secure Introductions (Task #12) ----------
  // Privacy-preserving intro/matching flow. DISTINCT from the credits-based
  // /introductions/* system above — this hits /network-introductions/*.
  // Contact details are never returned by the server until both sides connect.
  networkIntros: {
    list: () => request('/network-introductions'),
    get: (id) => request(`/network-introductions/${id}`),
    create: (data) =>
      request('/network-introductions', { method: 'POST', body: JSON.stringify(data || {}) }),
    accept: (id) => request(`/network-introductions/${id}/accept`, { method: 'POST' }),
    decline: (id) => request(`/network-introductions/${id}/decline`, { method: 'POST' }),
    targets: (q) =>
      request(`/network-introductions/targets${q ? `?q=${encodeURIComponent(q)}` : ''}`),
    // Task #24 — people-only matchmaking (Discover). Ranked candidate feed +
    // per-plan connect-credit balance. `create` above spends a connect credit
    // and returns 402 {code:'connect_credits_exhausted', ...} when exhausted.
    candidates: (filters = {}) => {
      const qs = new URLSearchParams();
      Object.entries(filters).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '' && v !== 0) qs.set(k, v);
      });
      const s = qs.toString();
      return request(`/network-introductions/candidates${s ? `?${s}` : ''}`);
    },
    connectCredits: () => request('/network-introductions/connect-credits'),
    createInvestorProfile: (data) =>
      request('/network-introductions/investor-profiles', {
        method: 'POST',
        body: JSON.stringify(data || {}),
      }),
    messages: (id) => request(`/network-introductions/${id}/messages`),
    sendMessage: (id, body) =>
      request(`/network-introductions/${id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      }),
    // Public tokenized review link (off-platform recipient — no auth needed).
    invite: (token) => request(`/network-introductions/invite/${encodeURIComponent(token)}`),
    inviteAccept: (token) =>
      request(`/network-introductions/invite/${encodeURIComponent(token)}/accept`, { method: 'POST' }),
    inviteDecline: (token) =>
      request(`/network-introductions/invite/${encodeURIComponent(token)}/decline`, { method: 'POST' }),
  },

  // ---------- Trust layer (Task #58) ----------
  // Task #4 (Y-2) — Trust Center v2 endpoints. The legacy
  // /trust/summary, /trust/kyb/*, /trust/accreditation/*, /trust/nda/*
  // helpers below remain wired for backward compatibility — the new
  // page consumes both the obligation matrix (/trust/me) and the
  // legacy KYB/Accred/NDA helpers per role.
  trustMe: () => request('/trust/me'),
  trustAgreements: () => request('/trust/agreements'),
  trustIntroRequest: (founder_user_id) =>
    request('/trust/intro/request', { method: 'POST', body: JSON.stringify({ founder_user_id }) }),
  trustIntroStatus: (founder_user_id) =>
    request(`/trust/intro/status?founder=${encodeURIComponent(founder_user_id)}`),
  trustObligationStart: (key) =>
    request(`/trust/obligation/${encodeURIComponent(key)}/start`, { method: 'POST' }),
  trustSanctions: () => request('/trust/sanctions'),
  trustMySigningUrl: (envelope_uuid) =>
    request(`/trust/agreements/${encodeURIComponent(envelope_uuid)}/my_signing_url`),
  trustScore: (userId) => request(`/trust/score/${encodeURIComponent(userId)}`),
  // Task #40 — batch the per-row trust-score lookups on AdminPage / DealsPage
  // into a single request. Returns { scores: [{ user_id, score, missing[],
  // required_total }] } in the same order the ids were sent. Admin/partner/
  // investor only; founders should keep using `trustScore(userId)` for self.
  trustScoreBatch: (userIds) => request('/trust/score/batch', {
    method: 'POST',
    body: JSON.stringify({ user_ids: userIds }),
  }),
  trustMatrix: (role) => request(`/trust/matrix${role ? `?role=${encodeURIComponent(role)}` : ''}`),

  // Task AH — pairwise NDA management + sanctions screening.
  trustListPairwiseNdas: () => request('/trust/pairwise-ndas'),
  trustResendPairwiseNda: (id) =>
    request(`/trust/pairwise-ndas/${encodeURIComponent(id)}/resend`, { method: 'POST' }),
  trustVoidPairwiseNda: (id, reason) =>
    request(`/trust/pairwise-ndas/${encodeURIComponent(id)}/void`, {
      method: 'POST', body: JSON.stringify({ reason: reason || '' }),
    }),
  trustListSanctions: (params = {}) => {
    const qs = new URLSearchParams();
    if (params.user_id) qs.set('user_id', String(params.user_id));
    if (params.only_hits) qs.set('only_hits', 'true');
    if (params.limit) qs.set('limit', String(params.limit));
    const s = qs.toString();
    return request(`/trust/sanctions${s ? `?${s}` : ''}`);
  },
  trustScreenSanctions: (userId, payload = {}) =>
    request(`/trust/sanctions/screen/${encodeURIComponent(userId)}`, {
      method: 'POST', body: JSON.stringify(payload),
    }),

  getTrustSummary: () => request('/trust/summary'),
  getKybStatus: () => request('/trust/kyb/status'),
  startKyb: (payload) => request('/trust/kyb/start', { method: 'POST', body: JSON.stringify(payload) }),
  submitKyb: (payload) => request('/trust/kyb/submit', { method: 'POST', body: JSON.stringify(payload) }),
  getAccreditationStatus: () => request('/trust/accreditation/status'),
  uploadAccreditation: (basis, file) => {
    const fd = new FormData();
    fd.append('basis', basis);
    fd.append('file', file);
    return request('/trust/accreditation/upload', { method: 'POST', body: fd });
  },
  reviewAccreditation: (investorId, decision) =>
    request(`/trust/accreditation/${investorId}/review`, {
      method: 'POST', body: JSON.stringify({ decision }),
    }),
  getAccreditationBadge: (investorId) => request(`/trust/accreditation/badge/${investorId}`),
  getRequiredNdas: () => request('/trust/nda/required'),
  getNdaPreview: (role) => request(`/trust/nda/${role}/preview`),
  signNda: (role, signer_name) =>
    request('/trust/nda/sign', {
      method: 'POST',
      body: JSON.stringify({ role, signer_name, accepted: true }),
    }),
  getNdaStatus: () => request('/trust/nda/status'),

  // ---------- Founder risk (Task #41, admin/partner/investor only) ----------
  getFounderRiskByDeal: (dealId) => request(`/founder-risk/by-deal/${dealId}`),
  getFounderRiskByFounder: (founderId) => request(`/founder-risk/by-founder/${founderId}`),
  pullFounderRisk: (founderId) =>
    request(`/founder-risk/${founderId}/pull`, { method: 'POST' }),
  recomputeFounderRisk: (founderId) =>
    request(`/founder-risk/${founderId}/recompute`, { method: 'POST' }),

  // ---------- Venture risk (Task #10 — 10-layer rating system) ----------
  // Worker-only (D1); the dev FastAPI backend 404s on the whole prefix.
  // Reads gate to admin/partner/investor; analyst writes (override/recompute)
  // gate to admin/partner.
  ventureRiskMatrix: () => request('/venture-risk/matrix'),
  ventureRiskByProject: (projectId) => request(`/venture-risk/by-project/${projectId}`),
  ventureRiskRecompute: (projectId) =>
    request(`/venture-risk/${projectId}/recompute`, { method: 'POST' }),
  ventureRiskSetLayer: (projectId, layerKey, body) =>
    request(`/venture-risk/${projectId}/layers/${layerKey}`, { method: 'PUT', body: JSON.stringify(body || {}) }),
  ventureRiskClearLayer: (projectId, layerKey) =>
    request(`/venture-risk/${projectId}/layers/${layerKey}`, { method: 'DELETE' }),

  // ---------- Reference checks (Task #43, admin/investor only) ----------
  listReferences: (dealId) =>
    request(`/references${dealId != null ? `?deal_id=${dealId}` : ''}`),
  getReference: (id) => request(`/references/${id}`),
  createReference: (data) =>
    request('/references', { method: 'POST', body: JSON.stringify(data) }),
  updateReference: (id, data) =>
    request(`/references/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteReference: (id) => request(`/references/${id}`, { method: 'DELETE' }),
  captureReferenceConsent: (id, data) =>
    request(`/references/${id}/consent`, { method: 'POST', body: JSON.stringify(data) }),
  uploadReferenceRecording: (id, file) => {
    const fd = new FormData();
    fd.append('file', file);
    return request(`/references/${id}/recording`, { method: 'POST', body: fd });
  },
  getReferenceRecordingUrl: (id) => request(`/references/${id}/recording-url`),
  transcribeReference: (id) =>
    request(`/references/${id}/transcribe`, { method: 'POST' }),
  summarizeReference: (id) =>
    request(`/references/${id}/summarize`, { method: 'POST' }),

  // ---------- Advisor matching + office hours (Task #35) ----------
  listAdvisors: (opts = {}) => {
    const qs = new URLSearchParams();
    if (opts.specialty) qs.set('specialty', opts.specialty);
    if (opts.sector) qs.set('sector', opts.sector);
    if (opts.q) qs.set('q', opts.q);
    if (opts.free_only) qs.set('free_only', '1');
    if (opts.max_rate != null) qs.set('max_rate', opts.max_rate);
    if (opts.accepting_only === false) qs.set('accepting_only', 'false');
    const s = qs.toString();
    return request(`/advisors/${s ? `?${s}` : ''}`);
  },
  getAdvisor: (uid) => request(`/advisors/${uid}`),
  upsertMyAdvisor: (data) => request('/advisors/me', { method: 'POST', body: JSON.stringify(data) }),
  getMyAdvisor: () => request('/advisors/me'),
  listAdvisorSlots: (uid, upcomingOnly = true) =>
    request(`/advisors/${uid}/slots?upcoming_only=${upcomingOnly ? 'true' : 'false'}`),
  createAdvisorSlot: (data) => request('/advisors/me/slots', { method: 'POST', body: JSON.stringify(data) }),
  cancelAdvisorSlot: (slotId) => request(`/advisors/me/slots/${slotId}`, { method: 'DELETE' }),
  bookAdvisorSlot: (slotId, data) =>
    request(`/advisors/slots/${slotId}/book`, { method: 'POST', body: JSON.stringify(data) }),
  listMyAdvisorBookings: (status) =>
    request(`/advisors/me/bookings${status ? `?status=${status}` : ''}`),
  listMyMenteeBookings: (status) =>
    request(`/advisors/bookings/me${status ? `?status=${status}` : ''}`),
  confirmAdvisorBooking: (id) => request(`/advisors/bookings/${id}/confirm`, { method: 'POST' }),
  cancelAdvisorBooking: (id, reason) =>
    request(`/advisors/bookings/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }),
  completeAdvisorBooking: (id) => request(`/advisors/bookings/${id}/complete`, { method: 'POST' }),
  noShowAdvisorBooking: (id, reason) =>
    request(`/advisors/bookings/${id}/no-show`, { method: 'POST', body: JSON.stringify({ reason }) }),
  fileAdvisorReview: (bookingId, data) =>
    request(`/advisors/bookings/${bookingId}/review`, { method: 'POST', body: JSON.stringify(data) }),
  listBookingReviews: (bookingId) => request(`/advisors/bookings/${bookingId}/reviews`),

  // ---------- Unified calendar (Task #56) ----------
  listCalendarEvents: (opts = {}) => {
    const qs = new URLSearchParams();
    if (opts.from) qs.set('from', opts.from);
    if (opts.to) qs.set('to', opts.to);
    if (opts.kinds) qs.set('kinds', opts.kinds);
    const s = qs.toString();
    return request(`/calendar/events${s ? `?${s}` : ''}`);
  },
  calendarIcsUrl: () => `${BASE}/calendar/events.ics`,

  // IC meetings
  listIcMeetings: () => request('/calendar/ic-meetings'),
  createIcMeeting: (data) => request('/calendar/ic-meetings', { method: 'POST', body: JSON.stringify(data) }),
  rsvpIcMeeting: (id, rsvp) =>
    request(`/calendar/ic-meetings/${id}/rsvp?rsvp=${encodeURIComponent(rsvp)}`, { method: 'POST' }),
  cancelIcMeeting: (id, reason) =>
    request(`/calendar/ic-meetings/${id}${reason ? `?reason=${encodeURIComponent(reason)}` : ''}`, { method: 'DELETE' }),

  // Founder check-ins
  listCheckins: () => request('/calendar/founder-checkins'),
  createCheckin: (data) => request('/calendar/founder-checkins', { method: 'POST', body: JSON.stringify(data) }),
  cancelCheckin: (id) => request(`/calendar/founder-checkins/${id}`, { method: 'DELETE' }),

  // ---------- Partner office hours (Task #54) ----------
  createPartnerSlot: (data) =>
    request('/partner-office-hours/me/slots', { method: 'POST', body: JSON.stringify(data) }),
  listMyPartnerSlots: (upcomingOnly = true) =>
    request(`/partner-office-hours/me/slots?upcoming_only=${upcomingOnly ? 'true' : 'false'}`),
  listPartnerSlots: (partnerUid, upcomingOnly = true) =>
    request(`/partner-office-hours/partners/${partnerUid}/slots?upcoming_only=${upcomingOnly ? 'true' : 'false'}`),
  cancelPartnerSlot: (slotId) =>
    request(`/partner-office-hours/me/slots/${slotId}`, { method: 'DELETE' }),
  bookPartnerSlot: (slotId, data) =>
    request(`/partner-office-hours/slots/${slotId}/book`, { method: 'POST', body: JSON.stringify(data) }),
  listMyPartnerBookings: (status) =>
    request(`/partner-office-hours/me/bookings${status ? `?status=${status}` : ''}`),
  listMyPartnerRequests: (status) =>
    request(`/partner-office-hours/bookings/me${status ? `?status=${status}` : ''}`),
  confirmPartnerBooking: (id) =>
    request(`/partner-office-hours/bookings/${id}/confirm`, { method: 'POST' }),
  cancelPartnerBooking: (id, reason) =>
    request(`/partner-office-hours/bookings/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }),
  completePartnerBooking: (id) =>
    request(`/partner-office-hours/bookings/${id}/complete`, { method: 'POST' }),
  noShowPartnerBooking: (id, reason) =>
    request(`/partner-office-hours/bookings/${id}/no-show`, { method: 'POST', body: JSON.stringify({ reason }) }),

  // ---------- Co-marketing (Task #54) ----------
  submitCoMarketingPitch: (data) =>
    request('/comarketing/me/pitches', { method: 'POST', body: JSON.stringify(data) }),
  listMyCoMarketingPitches: (status) =>
    request(`/comarketing/me/pitches${status ? `?status=${status}` : ''}`),
  editCoMarketingPitch: (uid, data) =>
    request(`/comarketing/me/pitches/${uid}`, { method: 'PATCH', body: JSON.stringify(data) }),
  withdrawCoMarketingPitch: (uid) =>
    request(`/comarketing/me/pitches/${uid}/withdraw`, { method: 'POST' }),
  adminCoMarketingQueue: (status) =>
    request(`/comarketing/admin/queue${status ? `?status=${status}` : ''}`),
  approveCoMarketingPitch: (uid, notes) =>
    request(`/comarketing/admin/pitches/${uid}/approve`, { method: 'POST', body: JSON.stringify({ notes }) }),
  rejectCoMarketingPitch: (uid, notes) =>
    request(`/comarketing/admin/pitches/${uid}/reject`, { method: 'POST', body: JSON.stringify({ notes }) }),
  publishCoMarketingPitch: (uid, data) =>
    request(`/comarketing/admin/pitches/${uid}/publish`, { method: 'POST', body: JSON.stringify(data || {}) }),
  listPublishedCoMarketing: () => request('/comarketing/published'),
  trackCoMarketing: (data) =>
    request('/comarketing/track', { method: 'POST', body: JSON.stringify(data) }),
  listMyCoMarketingAttributions: (pitchUid) =>
    request(`/comarketing/me/attributions${pitchUid ? `?pitch_uid=${pitchUid}` : ''}`),

  // Google Calendar sync
  googleCalStatus: () => request('/calendar/google/status'),
  googleCalConnect: ({ return_to } = {}) =>
    request(`/calendar/google/connect${return_to ? `?return_to=${encodeURIComponent(return_to)}` : ''}`, { method: 'POST' }),
  googleCalDisconnect: () => request('/calendar/google', { method: 'DELETE' }),
  googleCalSync: () => request('/calendar/google/sync', { method: 'POST' }),

  // Microsoft 365 / Outlook Calendar sync
  microsoftCalStatus: () => request('/calendar/microsoft/status'),
  microsoftCalConnect: ({ return_to } = {}) =>
    request(`/calendar/microsoft/connect${return_to ? `?return_to=${encodeURIComponent(return_to)}` : ''}`, { method: 'POST' }),
  microsoftCalDisconnect: () => request('/calendar/microsoft', { method: 'DELETE' }),
  microsoftCalSync: () => request('/calendar/microsoft/sync', { method: 'POST' }),

  // Telegram channel join request — maps caller's role → canonical
  // channel; backend pings the studio Slack inbox so an admin can
  // issue the invite link manually (bots can't add users to invite-only
  // channels without prior interaction).
  telegramJoinChannels: () => request('/telegram/channels'),
  telegramJoinRequest: (data) =>
    request('/telegram/join-request', { method: 'POST', body: JSON.stringify(data || {}) }),

  // Task #52 — "Add to my external calendar" — pushes one already-booked
  // Axal session to whichever calendar(s) the caller has connected.
  pushOneToExternal: (kind, sourceId) =>
    request(`/calendar/push/${kind}/${sourceId}`, { method: 'POST' }),

  // Per-user Cal.com key (advisor-only)
  attachMyCalcomKey: (data) =>
    request('/calendar/me/calcom', { method: 'POST', body: JSON.stringify(data) }),

  // ---------- Co-founder matching (Task #38) ----------
  cofounderMe: () => request('/cofounder/me'),
  cofounderUpsertMe: (data) =>
    request('/cofounder/me', { method: 'PUT', body: JSON.stringify(data) }),
  cofounderUnlistMe: () => request('/cofounder/me', { method: 'DELETE' }),
  cofounderVocab: () => request('/cofounder/vocab'),
  cofounderBrowse: (opts = {}) => {
    const qs = new URLSearchParams();
    for (const k of ['q', 'skill', 'sector', 'commitment']) {
      if (opts[k]) qs.set(k, opts[k]);
    }
    if (opts.remote_only) qs.set('remote_only', 'true');
    if (opts.limit) qs.set('limit', String(opts.limit));
    const s = qs.toString();
    return request(`/cofounder/browse${s ? `?${s}` : ''}`);
  },
  cofounderExpressInterest: (data) =>
    request('/cofounder/interest', { method: 'POST', body: JSON.stringify(data) }),
  cofounderWithdrawInterest: (userUid) =>
    request(`/cofounder/interest/${userUid}`, { method: 'DELETE' }),
  cofounderListConnections: () => request('/cofounder/connections'),
  cofounderGetConnection: (uid) => request(`/cofounder/connections/${uid}`),
  cofounderGetMyNda: (uid) => request(`/cofounder/connections/${uid}/nda`),
  cofounderSignNda: (uid, data) =>
    request(`/cofounder/connections/${uid}/nda/sign`, {
      method: 'POST', body: JSON.stringify(data),
    }),
  cofounderCloseConnection: (uid, reason) =>
    request(`/cofounder/connections/${uid}${reason ? `?reason=${encodeURIComponent(reason)}` : ''}`,
            { method: 'DELETE' }),

  // ---------- Portfolio Health (Task #44) ----------
  portfolioHealthList: (opts = {}) => {
    const qs = new URLSearchParams();
    if (opts.badge) qs.set('badge', opts.badge);
    if (opts.interventionOnly) qs.set('intervention_only', 'true');
    const s = qs.toString();
    return request(`/portfolio/health${s ? `?${s}` : ''}`);
  },
  portfolioHealthGet: (projectUid, days) =>
    request(`/portfolio/health/${projectUid}${days ? `?history_days=${days}` : ''}`),
  portfolioHealthRecomputeAll: () =>
    request('/portfolio/health/recompute', { method: 'POST' }),
  portfolioHealthRecomputeOne: (projectUid) =>
    request(`/portfolio/health/recompute/${projectUid}`, { method: 'POST' }),

  // ---------- Partner Coverage Analytics (Task #18) ----------
  // Admin/partner-only portfolio-wide skill-gap heatmap. Optional fund scoping
  // via fund_id. Returns per-company 8-axis radar scores + portfolio aggregate.
  portfolioCoverage: (fundId) =>
    request(`/portfolio/coverage${fundId ? `?fund_id=${encodeURIComponent(fundId)}` : ''}`),

  // ---------- Watchlist + Decision Journal (Task #49) ----------
  watchlistList: (opts = {}) => {
    const qs = new URLSearchParams();
    if (opts.status) qs.set('status', opts.status);
    if (opts.owner) qs.set('owner', opts.owner);
    const s = qs.toString();
    return request(`/watchlist${s ? `?${s}` : ''}`);
  },
  watchlistCreate: (data) => request('/watchlist', { method: 'POST', body: JSON.stringify(data) }),
  watchlistGet: (uid) => request(`/watchlist/${uid}`),
  watchlistUpdate: (uid, data) => request(`/watchlist/${uid}`, { method: 'PUT', body: JSON.stringify(data) }),
  watchlistDelete: (uid) => request(`/watchlist/${uid}`, { method: 'DELETE' }),
  watchlistConvert: (uid, data = {}) =>
    request(`/watchlist/${uid}/convert`, { method: 'POST', body: JSON.stringify(data) }),

  journalList: (opts = {}) => {
    const qs = new URLSearchParams();
    for (const k of ['decision', 'outcome_status', 'project_uid', 'owner']) {
      if (opts[k]) qs.set(k, opts[k]);
    }
    const s = qs.toString();
    return request(`/journal${s ? `?${s}` : ''}`);
  },
  journalCreate: (data) => request('/journal', { method: 'POST', body: JSON.stringify(data) }),
  journalGet: (uid) => request(`/journal/${uid}`),
  journalUpdate: (uid, data) => request(`/journal/${uid}`, { method: 'PUT', body: JSON.stringify(data) }),
  journalRecordOutcome: (uid, data) =>
    request(`/journal/${uid}/outcome`, { method: 'POST', body: JSON.stringify(data) }),
  journalDelete: (uid) => request(`/journal/${uid}`, { method: 'DELETE' }),
  antiportfolio: (owner = 'me') => request(`/antiportfolio?owner=${encodeURIComponent(owner)}`),

  // ---------- IC Decisions (Commit) ----------
  icList: (opts = {}) => {
    const q = new URLSearchParams();
    if (opts.status) q.set('status', opts.status);
    if (opts.project_id != null && opts.project_id !== '') q.set('project_id', opts.project_id);
    const qs = q.toString();
    return request(`/ic${qs ? `?${qs}` : ''}`);
  },
  icCreate: (data) => request('/ic', { method: 'POST', body: JSON.stringify(data) }),
  icGet: (uid) => request(`/ic/${uid}`),
  icUpdate: (uid, data) => request(`/ic/${uid}`, { method: 'PUT', body: JSON.stringify(data) }),
  icVote: (uid, data) => request(`/ic/${uid}/vote`, { method: 'POST', body: JSON.stringify(data) }),

  // ---------- LP Reporting (Support) ----------
  lpReportsList: (opts = {}) => {
    const q = new URLSearchParams();
    if (opts.fund_id != null && opts.fund_id !== '') q.set('fund_id', opts.fund_id);
    const qs = q.toString();
    return request(`/lp-reports${qs ? `?${qs}` : ''}`);
  },
  lpReportCreate: (data) => request('/lp-reports', { method: 'POST', body: JSON.stringify(data) }),
  lpReportPublish: (uid) => request(`/lp-reports/${uid}/publish`, { method: 'POST' }),

  // ---------- Company Updates (Support) ----------
  portfolioUpdatesList: (opts = {}) => {
    const q = new URLSearchParams();
    if (opts.project_id != null && opts.project_id !== '') q.set('project_id', opts.project_id);
    if (opts.period) q.set('period', opts.period);
    const qs = q.toString();
    return request(`/portfolio-updates${qs ? `?${qs}` : ''}`);
  },
  portfolioUpdateCreate: (data) => request('/portfolio-updates', { method: 'POST', body: JSON.stringify(data) }),

  // ---------- Cap Table / Ownership (Support) ----------
  positionsList: () => request('/positions'),
  positionsByProject: (projectUid) => request(`/positions/${projectUid}`),
  positionCreate: (data) => request('/positions', { method: 'POST', body: JSON.stringify(data) }),

  // ---------- Contacts (inbound relationship hub) ----------
  contactsList: (opts = {}) => {
    const qs = new URLSearchParams();
    if (opts.audience) qs.set('audience', opts.audience);
    if (opts.status) qs.set('status', opts.status);
    if (opts.routed_to) qs.set('routed_to', opts.routed_to);
    const s = qs.toString();
    return request(`/contacts${s ? `?${s}` : ''}`);
  },
  contactGet: (uid) => request(`/contacts/${uid}`),
  contactCreate: (data) => request('/contacts', { method: 'POST', body: JSON.stringify(data) }),
  contactInvite: (data) => request('/contacts/invite', { method: 'POST', body: JSON.stringify(data) }),
  contactUpdate: (uid, data) => request(`/contacts/${uid}`, { method: 'PUT', body: JSON.stringify(data) }),
  contactReply: (uid, data) => request(`/contacts/${uid}/reply`, { method: 'POST', body: JSON.stringify(data) }),
  contactAddTask: (uid, data) => request(`/contacts/${uid}/tasks`, { method: 'POST', body: JSON.stringify(data) }),
  contactToggleTask: (uid, taskId) => request(`/contacts/${uid}/tasks/${taskId}/toggle`, { method: 'POST' }),
  contactPromote: (uid) => request(`/contacts/${uid}/promote`, { method: 'POST' }),
  raiseProspects: (projectId) => request(projectId ? `/contacts/raise-prospects?project_id=${projectId}` : '/contacts/raise-prospects'),
  raiseProspectUpdate: (id, data) => request(`/contacts/raise-prospects/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  raiseProspectGet: (id) => request(`/contacts/raise-prospects/${id}`),
  raiseProspectCreate: (data) => request('/contacts/raise-prospects', { method: 'POST', body: JSON.stringify(data) }),
  raiseProspectsImport: (data) => request('/contacts/raise-prospects/import', { method: 'POST', body: JSON.stringify(data) }),
  raiseRound: (projectId) => request(projectId ? `/contacts/raise-round?project_id=${projectId}` : '/contacts/raise-round'),
  raiseRoundSave: (data) => request('/contacts/raise-round', { method: 'PUT', body: JSON.stringify(data) }),
  raiseUpdates: (projectId) => request(projectId ? `/contacts/raise-updates?project_id=${projectId}` : '/contacts/raise-updates'),
  raiseUpdateCreate: (data) => request('/contacts/raise-updates', { method: 'POST', body: JSON.stringify(data) }),

  // ---------- Notifications (Phase 0.2) ----------
  listNotifications: (opts = {}) => {
    const qs = new URLSearchParams();
    if (opts.limit) qs.set('limit', opts.limit);
    if (opts.onlyUnread) qs.set('only_unread', '1');
    const q = qs.toString();
    return request(`/notifications${q ? `?${q}` : ''}`);
  },
  notificationsUnreadCount: () => request('/notifications/unread-count'),
  markNotificationsRead: (data) =>
    request('/notifications/mark-read', { method: 'POST', body: JSON.stringify(data) }),
  getNotificationPrefs: () => request('/notifications/prefs'),
  putNotificationPrefs: (prefs) =>
    request('/notifications/prefs', { method: 'PUT', body: JSON.stringify({ prefs }) }),

  // ---------- Web Push (Task #57) ----------
  pushVapidKey: () => request('/notifications/push/vapid-key'),
  pushSubscribe: (sub) =>
    request('/notifications/push/subscribe', { method: 'POST', body: JSON.stringify(sub) }),
  pushUnsubscribe: (data) =>
    request('/notifications/push/unsubscribe', { method: 'POST', body: JSON.stringify(data) }),
  pushSubscriptions: () => request('/notifications/push/subscriptions'),
  pushTest: () => request('/notifications/push/test', { method: 'POST' }),

  // Task #46 — Reserve allocation + waterfall simulator.
  fundSimReservesList: (fundId) => request(`/fund-sim/funds/${fundId}/reserves`),
  fundSimReservesReplace: (fundId, items) =>
    request(`/fund-sim/funds/${fundId}/reserves`, {
      method: 'PUT',
      body: JSON.stringify({ items }),
    }),
  fundSimReservesSimulate: (fundId, body) =>
    request(`/fund-sim/funds/${fundId}/reserves/simulate`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  fundSimWaterfall: (fundId, body) =>
    request(`/fund-sim/funds/${fundId}/waterfall/simulate`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  fundSimScenariosList: (fundId, kind) =>
    request(`/fund-sim/funds/${fundId}/scenarios${kind ? `?kind=${kind}` : ''}`),
  fundSimScenarioCreate: (fundId, body) =>
    request(`/fund-sim/funds/${fundId}/scenarios`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  fundSimScenarioGet: (uid) => request(`/fund-sim/scenarios/${uid}`),
  fundSimScenarioDelete: (uid) =>
    request(`/fund-sim/scenarios/${uid}`, { method: 'DELETE' }),
  // Reuse the existing /api/capital/funds endpoint for the fund picker —
  // it returns the canonical VCFund list with id/uid/name/total_commitment.
  capitalFundsList: () => request('/capital/funds'),

  // Task #8 (IH) — Data import + migration tools.
  importsList: () => request('/imports/'),
  importsQuota: () => request('/imports/quota'),
  importsGet: (id) => request(`/imports/${encodeURIComponent(id)}`),
  universalPreview: (csv, target) =>
    request('/imports/universal/preview', { method: 'POST', body: JSON.stringify({ csv, target }) }),
  universalCommit: (csv, target, mapping) =>
    request('/imports/universal/commit', { method: 'POST', body: JSON.stringify({ csv, target, mapping }) }),
  angellistPreview: (csv) =>
    request('/imports/angellist/preview', { method: 'POST', body: JSON.stringify({ csv }) }),
  angellistCommit: (csv) =>
    request('/imports/angellist/commit', { method: 'POST', body: JSON.stringify({ csv }) }),
  portfolioPreview: (csv) =>
    request('/imports/portfolio/preview', { method: 'POST', body: JSON.stringify({ csv }) }),
  portfolioCommit: (csv) =>
    request('/imports/portfolio/commit', { method: 'POST', body: JSON.stringify({ csv }) }),
  portfolioHoldings: () => request('/imports/portfolio/holdings'),
  cartaImport: (integrationId) =>
    request('/imports/carta', { method: 'POST', body: JSON.stringify({ integration_id: integrationId }) }),
  hubspotPipelines: () => request('/imports/hubspot/preview', { method: 'POST', body: JSON.stringify({}) }),
  hubspotImport: (pipelineId, stageMap) =>
    request('/imports/hubspot/commit', {
      method: 'POST',
      body: JSON.stringify({ pipeline_id: pipelineId, stage_map: stageMap }),
    }),
  affinityLists: () => request('/imports/affinity/preview', { method: 'POST', body: JSON.stringify({}) }),
  affinityImport: (listId, stageMap) =>
    request('/imports/affinity/commit', {
      method: 'POST',
      body: JSON.stringify({ list_id: listId, stage_map: stageMap }),
    }),
  deckImport: (file, projectId) => {
    const fd = new FormData();
    fd.append('file', file);
    if (projectId) fd.append('project_id', String(projectId));
    return request('/imports/deck', { method: 'POST', body: fd });
  },

  // Task #11 — User Skill Profile. Worker-only (dev FastAPI lacks /api/skills;
  // the page degrades to an error banner in dev). Paths are literal so the
  // API↔Worker drift checker can match them to the /api/skills mount.
  skills: {
    getTaxonomy: () => request('/skills/taxonomy'),
    getMySkills: () => request('/skills/me'),
    saveMySkills: (ratings) =>
      request('/skills/me', { method: 'PUT', body: JSON.stringify({ ratings }) }),
    endorse: (data) =>
      request('/skills/endorsements', { method: 'POST', body: JSON.stringify(data) }),
    getMyAggregate: () => request('/skills/me/aggregate'),
    getUserAggregate: (userId) => request(`/skills/users/${userId}/aggregate`),
  },

  // Task #12 — Personal-Values Assessment. Worker-only (dev FastAPI lacks /api/values).
  values: {
    getSurvey: () => request('/values/survey'),
    submit: (responses) =>
      request('/values/submit', { method: 'POST', body: JSON.stringify({ responses }) }),
    getMe: () => request('/values/me'),
  },

  // Task #13 — Radar / Spider-Graph Service. Worker-only (dev FastAPI lacks /api/radar).
  radar: {
    me: () => request('/radar/me'),
    team: (userIds) =>
      request('/radar/team', { method: 'POST', body: JSON.stringify({ user_ids: userIds }) }),
  },

  // Task #20 — Best-Fit cross-counterparty match summary (Worker-only).
  // Default (no detail) ALWAYS returns 200: counts + one anonymized teaser per
  // type for free callers, full ranked matches for studio/bypass roles.
  // detail:'full' from a non-unlocked caller 402s → PaywallModal (auto-handled
  // by `request` above). The UI gates the explicit "unlock" action via
  // openPaywall() instead of forcing that 402, so prefer the default call.
  matches: {
    summary: ({ detail } = {}) =>
      request(`/matches/summary${detail ? `?detail=${encodeURIComponent(detail)}` : ''}`),
  },

  // Task #20 — self Best-Fit (Worker-only). The caller's own per-persona Axal Fit
  // scorecard + 5 Axal behavioral values. Read-only; no matches/spin-out (those
  // stay gated via matches.summary / admin-only report).
  bestFit: {
    me: () => request('/best-fit/me'),
  },

  // Competitor Analysis — in-house crawl + Workers AI synthesis (no paid APIs).
  competitors: {
    analyze: (data) => request('/competitors/analyze', { method: 'POST', body: JSON.stringify(data || {}) }),
    list: () => request('/competitors'),
    get: (id) => request(`/competitors/${id}`),
    save: (id, patch) => request(`/competitors/${id}`, { method: 'PATCH', body: JSON.stringify(patch || {}) }),
    addCandidate: (id, data) => request(`/competitors/${id}/candidates`, { method: 'POST', body: JSON.stringify(data || {}) }),
    removeCandidate: (id, cid) => request(`/competitors/${id}/candidates/${cid}`, { method: 'DELETE' }),
    rerun: (id, data) => request(`/competitors/${id}/rerun`, { method: 'POST', body: JSON.stringify(data || {}) }),
    refresh: (id) => request(`/competitors/${id}/refresh`, { method: 'POST', body: JSON.stringify({}) }),
    remove: (id) => request(`/competitors/${id}`, { method: 'DELETE' }),
    fetchUrl: (url, refresh) => request('/competitors/fetch', { method: 'POST', body: JSON.stringify({ url, refresh: !!refresh }) }),
    exportUrl: (id, format) => `/api/competitors/${id}/export?format=${encodeURIComponent(format || 'json')}`,
  },

  // Pitch Deck Reviewer — Cloudflare document conversion + investor-style review.
  deckReviewer: {
    // FormData upload: request() detects FormData and omits the JSON Content-Type.
    upload: (formData) => request('/deck-reviewer/upload', { method: 'POST', body: formData }),
    paste: (data) => request('/deck-reviewer/paste', { method: 'POST', body: JSON.stringify(data || {}) }),
    list: () => request('/deck-reviewer'),
    get: (id) => request(`/deck-reviewer/${id}`),
    save: (id, patch) => request(`/deck-reviewer/${id}`, { method: 'PATCH', body: JSON.stringify(patch || {}) }),
    regenerate: (id) => request(`/deck-reviewer/${id}/regenerate`, { method: 'POST', body: JSON.stringify({}) }),
    purgeRaw: (id) => request(`/deck-reviewer/${id}/raw`, { method: 'DELETE' }),
    remove: (id) => request(`/deck-reviewer/${id}`, { method: 'DELETE' }),
    exportUrl: (id, format) => `/api/deck-reviewer/${id}/export?format=${encodeURIComponent(format || 'json')}`,
  },
};

// Task #3 — Due Diligence module. Admin/partner/investor/advisor only;
// founders are blocked at the worker level (any 403 surfaces directly).
export const dd = {
  catalog: () => request('/dd/catalog'),
  listCases: (params = {}) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString();
    return request(`/dd/cases${q ? `?${q}` : ''}`);
  },
  openCase: (data) => request('/dd/cases', { method: 'POST', body: JSON.stringify(data) }),
  getCase: (uid) => request(`/dd/cases/${uid}`),
  scan: (uid, connectors) => request(`/dd/cases/${uid}/scan`, { method: 'POST', body: JSON.stringify({ connectors }) }),
  assignSection: (uid, sectionId, userId) =>
    request(`/dd/cases/${uid}/sections/${sectionId}/assign`, { method: 'POST', body: JSON.stringify({ user_id: userId }) }),
  setVerdict: (uid, sectionId, verdict, reviewerNotes) =>
    request(`/dd/cases/${uid}/sections/${sectionId}/verdict`, {
      method: 'POST',
      body: JSON.stringify({ verdict, reviewer_notes: reviewerNotes }),
    }),
  experts: (sectionKey) => request(`/dd/experts${sectionKey ? `?section_key=${encodeURIComponent(sectionKey)}` : ''}`),
  recompute: (uid) => request(`/dd/cases/${uid}/recompute`, { method: 'POST' }),
  generateReport: (uid) => request(`/dd/cases/${uid}/report`, { method: 'POST' }),
  shareReport: (uid) => request(`/dd/cases/${uid}/report/share`, { method: 'POST' }),
  audit: (uid) => request(`/dd/cases/${uid}/audit`),
  acceptInvite: (uid, jti) => request(`/dd/cases/${uid}/reviewer-invite/${jti}`, { method: 'POST' }),
  uploadNda: (uid, sectionId, file) => {
    const fd = new FormData();
    fd.append('file', file);
    return request(`/dd/cases/${uid}/sections/${sectionId}/nda`, { method: 'POST', body: fd });
  },
};

// Task #2 (AU) — Admin Publication Exports.
export const publications = {
  list: (status) => request(`/admin/publications${status ? `?status=${encodeURIComponent(status)}` : ''}`),
  get: (id) => request(`/admin/publications/${id}`),
  draft: (payload) => request('/admin/publications/draft', { method: 'POST', body: JSON.stringify(payload) }),
  update: (id, patch) => request(`/admin/publications/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
  // Render returns the artifact bytes directly (PDF/CSV/PNG) with the
  // shareable 24h HMAC link in the `X-Download-URL` response header.
  // We trigger an immediate browser download via an object URL and
  // surface the shareable link to the caller for "copy share URL" UX.
  render: async (id, format) => {
    const res = await fetch(`/api/admin/publications/${id}/render`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ format }),
    });
    if (!res.ok) {
      let msg = res.statusText || `Render failed (${res.status})`;
      try { const j = await res.json(); msg = j.message || j.error || msg; } catch { /* not json */ }
      throw new Error(msg);
    }
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    // Trigger download with a server-derived filename so the user gets
    // the slug-based name (e.g. q2-sector-heat-brief.pdf), not a UUID.
    const cd = res.headers.get('content-disposition') || '';
    const m = /filename="?([^"]+)"?/i.exec(cd);
    const filename = m ? m[1] : `publication-${id}.${format}`;
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    return {
      format: res.headers.get('x-render-format') || format,
      filename,
      download_url: res.headers.get('x-download-url') || null,
      expires_in_seconds: parseInt(res.headers.get('x-download-expires-in') || '0', 10) || null,
      blob_size: blob.size,
    };
  },
  publish: (id) => request(`/admin/publications/${id}/publish`, { method: 'POST', body: JSON.stringify({}) }),
  // Public read uses /api/market-intel-public so it sits OUTSIDE the
  // /api/admin/* CF Access perimeter — anonymous visitors must be able
  // to load /insights/public/:slug without an Axal session.
  publicGet: (slug) => request(`/market-intel-public/publications/${slug}`),
  // Task #6 (ID) — Public index of published insights for /insights.
  publicList: () => request('/market-intel-public/publications'),
};

// Task #10 (LD) — Admin team roster (Public /team page lives on axal.vc).
export const adminTeam = {
  list: () => request('/admin/team'),
  create: (payload) => request('/admin/team', { method: 'POST', body: JSON.stringify(payload) }),
  update: (id, patch) => request(`/admin/team/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
  remove: (id) => request(`/admin/team/${id}`, { method: 'DELETE' }),
  uploadPhoto: (id, dataUri) =>
    request(`/admin/team/${id}/photo`, { method: 'POST', body: JSON.stringify({ data_uri: dataUri }) }),
  reorder: (order) => request('/admin/team/reorder', { method: 'POST', body: JSON.stringify({ order }) }),
};

// Task #9 — Admin review queue for 'exploring' users (chat-onboarded,
// awaiting binding agreement + final role assignment).
export const adminExploring = {
  list: ({ limit = 100, offset = 0 } = {}) =>
    request(`/admin/exploring/users?limit=${limit}&offset=${offset}`),
  sendBinding: (userId, payload = {}) =>
    request(`/admin/exploring/users/${userId}/binding`, { method: 'POST', body: JSON.stringify(payload) }),
  assignRole: (userId, role) =>
    request(`/admin/exploring/users/${userId}/assign-role`, { method: 'POST', body: JSON.stringify({ role }) }),
};

// Task #1 — Admin advisor & partner network profiles (drives Spin-Out
// Demo Day deck's Advisors & Network slide).
export const adminNetworkProfiles = {
  list: () => request('/admin/network-profiles'),
  create: (payload) => request('/admin/network-profiles', { method: 'POST', body: JSON.stringify(payload) }),
  update: (id, patch) => request(`/admin/network-profiles/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
  remove: (id) => request(`/admin/network-profiles/${id}`, { method: 'DELETE' }),
  uploadPhoto: (id, dataUri) =>
    request(`/admin/network-profiles/${id}/photo`, { method: 'POST', body: JSON.stringify({ data_uri: dataUri }) }),
  reorder: (order) => request('/admin/network-profiles/reorder', { method: 'POST', body: JSON.stringify({ order }) }),
};

// Task #3 — Admin Telegram channels + posts + aggregator.
export const adminTelegram = {
  // Channels
  listChannels: () => request('/admin/telegram/channels'),
  createChannel: (payload) =>
    request('/admin/telegram/channels', { method: 'POST', body: JSON.stringify(payload) }),
  updateChannel: (id, patch) =>
    request(`/admin/telegram/channels/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
  removeChannel: (id) =>
    request(`/admin/telegram/channels/${id}`, { method: 'DELETE' }),
  testChannel: (id) =>
    request(`/admin/telegram/channels/${id}/test`, { method: 'POST', body: '{}' }),
  // Posts
  listPosts: ({ status, channel_id, limit = 50, offset = 0 } = {}) => {
    const qs = new URLSearchParams();
    if (status) qs.set('status', status);
    if (channel_id) qs.set('channel_id', String(channel_id));
    qs.set('limit', String(limit));
    qs.set('offset', String(offset));
    return request(`/admin/telegram/posts?${qs.toString()}`);
  },
  getPost: (id) => request(`/admin/telegram/posts/${id}`),
  createPost: (payload) =>
    request('/admin/telegram/posts', { method: 'POST', body: JSON.stringify(payload) }),
  updatePost: (id, patch) =>
    request(`/admin/telegram/posts/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
  removePost: (id) =>
    request(`/admin/telegram/posts/${id}`, { method: 'DELETE' }),
  uploadMedia: (id, dataUri) =>
    request(`/admin/telegram/posts/${id}/media`, {
      method: 'POST',
      body: JSON.stringify({ data_uri: dataUri }),
    }),
  lintPost: (id) =>
    request(`/admin/telegram/posts/${id}/lint`, { method: 'POST', body: '{}' }),
  sendPost: (id, { override_reason } = {}) =>
    request(`/admin/telegram/posts/${id}/send`, {
      method: 'POST',
      body: JSON.stringify(override_reason ? { override_reason } : {}),
    }),
  schedulePost: (id, scheduled_for) =>
    request(`/admin/telegram/posts/${id}/schedule`, {
      method: 'POST',
      body: JSON.stringify({ scheduled_for }),
    }),
  // Aggregator
  previewAggregator: ({ kind, period_days = 7 } = {}) => {
    const qs = new URLSearchParams();
    if (kind) qs.set('kind', kind);
    qs.set('period_days', String(period_days));
    return request(`/admin/telegram/aggregator/preview?${qs.toString()}`);
  },
  runAggregator: ({ period_days = 7 } = {}) =>
    request('/admin/telegram/aggregator/run', {
      method: 'POST',
      body: JSON.stringify({ period_days }),
    }),
};

// Task #4 — Admin X (Twitter) accounts + posts + aggregator.
export const adminX = {
  // Accounts
  listAccounts: () => request('/admin/x/accounts'),
  createAccount: (payload) =>
    request('/admin/x/accounts', { method: 'POST', body: JSON.stringify(payload) }),
  updateAccount: (id, patch) =>
    request(`/admin/x/accounts/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
  removeAccount: (id) => request(`/admin/x/accounts/${id}`, { method: 'DELETE' }),
  testAccount: (id) => request(`/admin/x/accounts/${id}/test`, { method: 'POST', body: '{}' }),
  oauthStart: (account_id) =>
    request(`/admin/x/oauth/start?account_id=${encodeURIComponent(account_id)}`),
  // Posts
  listPosts: ({ status, account_id, limit = 50, offset = 0 } = {}) => {
    const qs = new URLSearchParams();
    if (status) qs.set('status', status);
    if (account_id) qs.set('account_id', String(account_id));
    qs.set('limit', String(limit));
    qs.set('offset', String(offset));
    return request(`/admin/x/posts?${qs.toString()}`);
  },
  createPost: (payload) =>
    request('/admin/x/posts', { method: 'POST', body: JSON.stringify(payload) }),
  updatePost: (id, patch) =>
    request(`/admin/x/posts/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
  removePost: (id) => request(`/admin/x/posts/${id}`, { method: 'DELETE' }),
  addMedia: (id, data_uri, alt_text) =>
    request(`/admin/x/posts/${id}/media`, {
      method: 'POST',
      body: JSON.stringify(alt_text ? { data_uri, alt_text } : { data_uri }),
    }),
  generateAltText: (id, index = 0) =>
    request(`/admin/x/posts/${id}/alt-text`, {
      method: 'POST', body: JSON.stringify({ index }),
    }),
  lintPost: (id) => request(`/admin/x/posts/${id}/lint`, { method: 'POST', body: '{}' }),
  approvePost: (id) => request(`/admin/x/posts/${id}/approve`, { method: 'POST', body: '{}' }),
  sendPost: (id, { override_reason } = {}) =>
    request(`/admin/x/posts/${id}/send`, {
      method: 'POST',
      body: JSON.stringify(override_reason ? { override_reason } : {}),
    }),
  schedulePost: (id, scheduled_for) =>
    request(`/admin/x/posts/${id}/schedule`, {
      method: 'POST', body: JSON.stringify({ scheduled_for }),
    }),
  retractPost: (id, reason) =>
    request(`/admin/x/posts/${id}/retract`, {
      method: 'POST', body: JSON.stringify(reason ? { reason } : {}),
    }),
  // Aggregator
  previewAggregator: ({ kind, period_days = 7 } = {}) => {
    const qs = new URLSearchParams();
    if (kind) qs.set('kind', kind);
    qs.set('period_days', String(period_days));
    return request(`/admin/x/aggregator/preview?${qs.toString()}`);
  },
  runAggregator: ({ account_id, period_days = 7 }) =>
    request('/admin/x/aggregator/run', {
      method: 'POST',
      body: JSON.stringify({ account_id, period_days }),
    }),
};

// Task #2 — News (author + admin queue).
export const news = {
  // Public
  list: ({ limit = 20, offset = 0, sector, tag } = {}) => {
    const qs = new URLSearchParams();
    qs.set('limit', String(limit));
    qs.set('offset', String(offset));
    if (sector) qs.set('sector', sector);
    if (tag) qs.set('tag', tag);
    return request(`/news?${qs.toString()}`);
  },
  read: (slug) => request(`/news/${encodeURIComponent(slug)}`),
  // Author
  trustMe: () => request('/news/trust/me'),
  mine: () => request('/news/mine'),
  draft: (id) => request(`/news/draft/${id}`),
  createDraft: (payload) =>
    request('/news/draft', { method: 'POST', body: JSON.stringify(payload) }),
  updateDraft: (id, patch) =>
    request(`/news/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
  submit: (id) => request(`/news/${id}/submit`, { method: 'POST', body: '{}' }),
  retract: (id) => request(`/news/${id}/retract`, { method: 'POST', body: '{}' }),
  uploadCover: (id, dataUri) =>
    request(`/news/${id}/cover`, { method: 'POST', body: JSON.stringify({ data_uri: dataUri }) }),
};

export const adminNews = {
  queue: ({ status, limit = 50, offset = 0 } = {}) => {
    const qs = new URLSearchParams();
    if (status) qs.set('status', status);
    qs.set('limit', String(limit));
    qs.set('offset', String(offset));
    return request(`/admin/news/queue?${qs.toString()}`);
  },
  get: (id) => request(`/admin/news/${id}`),
  startReview: (id) => request(`/admin/news/${id}/start-review`, { method: 'POST', body: '{}' }),
  requestChanges: (id, reason) =>
    request(`/admin/news/${id}/request-changes`, { method: 'POST', body: JSON.stringify({ reason }) }),
  reject: (id, reason) =>
    request(`/admin/news/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }),
  approve: (id) => request(`/admin/news/${id}/approve`, { method: 'POST', body: '{}' }),
  publish: (id) => request(`/admin/news/${id}/publish`, { method: 'POST', body: '{}' }),
  unpublish: (id) => request(`/admin/news/${id}/unpublish`, { method: 'POST', body: '{}' }),
  addComment: (id, body, anchor) =>
    request(`/admin/news/${id}/comments`, { method: 'POST', body: JSON.stringify({ body, anchor }) }),
  resolveComment: (cid, resolved) =>
    request(`/admin/news/comments/${cid}`, { method: 'PUT', body: JSON.stringify({ resolved }) }),
  deleteComment: (cid) => request(`/admin/news/comments/${cid}`, { method: 'DELETE' }),
};

// Task #1 — Articles (author + admin queue). Mirrors `news` but uses
// the /api/articles surface (role filter, by-author endpoint, sectors).
export const articles = {
  // Public
  sectors: () => request('/articles/sectors'),
  list: ({ limit = 20, offset = 0, sector, tag, role, q, featured } = {}) => {
    const qs = new URLSearchParams();
    qs.set('limit', String(limit));
    qs.set('offset', String(offset));
    if (sector) qs.set('sector', sector);
    if (tag) qs.set('tag', tag);
    if (role) qs.set('role', role);
    if (q) qs.set('q', q);
    if (featured) qs.set('featured', '1');
    return request(`/articles?${qs.toString()}`);
  },
  byAuthor: (userId, { limit = 20, offset = 0 } = {}) => {
    const qs = new URLSearchParams();
    qs.set('limit', String(limit));
    qs.set('offset', String(offset));
    return request(`/articles/by-author/${userId}?${qs.toString()}`);
  },
  authorProfile: (userId) => request(`/public/authors/${userId}`),
  read: (slug) => request(`/articles/${encodeURIComponent(slug)}`),
  // Author
  trustMe: () => request('/articles/trust/me'),
  mine: () => request('/articles/mine'),
  draft: (id) => request(`/articles/draft/${id}`),
  createDraft: (payload) =>
    request('/articles/draft', { method: 'POST', body: JSON.stringify(payload) }),
  updateDraft: (id, patch) =>
    request(`/articles/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
  submit: (id) => request(`/articles/${id}/submit`, { method: 'POST', body: '{}' }),
  retract: (id) => request(`/articles/${id}/retract`, { method: 'POST', body: '{}' }),
  uploadCover: (id, dataUri) =>
    request(`/articles/${id}/cover`, { method: 'POST', body: JSON.stringify({ data_uri: dataUri }) }),
  uploadImage: (id, dataUri) =>
    request(`/articles/${id}/image`, { method: 'POST', body: JSON.stringify({ data_uri: dataUri }) }),
};

export const adminArticles = {
  queue: ({ status, limit = 50, offset = 0 } = {}) => {
    const qs = new URLSearchParams();
    if (status) qs.set('status', status);
    qs.set('limit', String(limit));
    qs.set('offset', String(offset));
    return request(`/admin/articles/queue?${qs.toString()}`);
  },
  get: (id) => request(`/admin/articles/${id}`),
  startReview: (id) => request(`/admin/articles/${id}/start-review`, { method: 'POST', body: '{}' }),
  requestChanges: (id, reason) =>
    request(`/admin/articles/${id}/request-changes`, { method: 'POST', body: JSON.stringify({ reason }) }),
  reject: (id, reason) =>
    request(`/admin/articles/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }),
  approve: (id) => request(`/admin/articles/${id}/approve`, { method: 'POST', body: '{}' }),
  publish: (id) => request(`/admin/articles/${id}/publish`, { method: 'POST', body: '{}' }),
  unpublish: (id) => request(`/admin/articles/${id}/unpublish`, { method: 'POST', body: '{}' }),
  addComment: (id, body, anchor) =>
    request(`/admin/articles/${id}/comments`, { method: 'POST', body: JSON.stringify({ body, anchor }) }),
  resolveComment: (cid, resolved) =>
    request(`/admin/articles/comments/${cid}`, { method: 'PUT', body: JSON.stringify({ resolved }) }),
  deleteComment: (cid) => request(`/admin/articles/comments/${cid}`, { method: 'DELETE' }),
};

// Spin-Out Lab — 4-week guided sprint for pre-incorporation founders.
// Namespaced separately from `api` to keep the surface small and obvious
// for the call sites that wire milestone completion in feature pages.
export const spinoutLab = {
  state: () => request('/spinout-lab/state'),
  start: () => request('/spinout-lab/start', { method: 'POST' }),
  complete: (milestone_key) =>
    request('/spinout-lab/milestone', {
      method: 'POST',
      body: JSON.stringify({ milestone_key }),
    }),
  exit: () => request('/spinout-lab/exit', { method: 'POST' }),
};

// Task #39 — Event engine. `events` covers the authenticated host/attendee
// surface (§8.1); `eventsPublic` the no-auth, Turnstile-gated public surface
// (§8.2); `adminEvents` the admin review queue (§8.3).
export const events = {
  // Caller's events (hosting + attending) + CRUD
  mine: () => request('/events'),
  get: (id) => request(`/events/${id}`),
  create: (payload) => request('/events', { method: 'POST', body: JSON.stringify(payload) }),
  update: (id, patch) => request(`/events/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  submitReview: (id) => request(`/events/${id}/submit-review`, { method: 'POST', body: '{}' }),
  // Registration (self)
  eligibility: (id) => request(`/events/${id}/eligibility`),
  register: (id, answers) =>
    request(`/events/${id}/register`, { method: 'POST', body: JSON.stringify({ answers }) }),
  cancelRegistration: (id) => request(`/events/${id}/registration`, { method: 'DELETE' }),
  // Host: invitations + roster + registration actions
  invite: (id, { user_ids, emails, message } = {}) =>
    request(`/events/${id}/invitations`, { method: 'POST', body: JSON.stringify({ user_ids, emails, message }) }),
  roster: (id) => request(`/events/${id}/roster`),
  approveRegistration: (id, rid) => request(`/events/${id}/registrations/${rid}/approve`, { method: 'POST', body: '{}' }),
  declineRegistration: (id, rid) => request(`/events/${id}/registrations/${rid}/decline`, { method: 'POST', body: '{}' }),
  promoteRegistration: (id, rid) => request(`/events/${id}/registrations/${rid}/promote`, { method: 'POST', body: '{}' }),
  checkin: (id, code) => request(`/events/${id}/checkin/${encodeURIComponent(code)}`, { method: 'POST', body: '{}' }),
  icsUrl: (id) => `/api/events/${id}/ics`,
  exportUrl: (id) => `/api/events/${id}/export`,
  // Agenda
  agenda: (id) => request(`/events/${id}/agenda`),
  addAgendaItem: (id, item) => request(`/events/${id}/agenda`, { method: 'POST', body: JSON.stringify(item) }),
  updateAgendaItem: (id, aid, patch) => request(`/events/${id}/agenda/${aid}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteAgendaItem: (id, aid) => request(`/events/${id}/agenda/${aid}`, { method: 'DELETE' }),
};

// Public (no-auth) event surface — feed, detail, register, invite response.
export const eventsPublic = {
  list: ({ limit = 20, offset = 0, type, from, to, q, past } = {}) => {
    const qs = new URLSearchParams();
    qs.set('limit', String(limit));
    qs.set('offset', String(offset));
    if (type) qs.set('type', type);
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    if (q) qs.set('q', q);
    if (past) qs.set('past', '1');
    return request(`/public/events?${qs.toString()}`);
  },
  read: (slug) => request(`/public/events/${encodeURIComponent(slug)}`),
  register: (slug, { name, email, turnstile_token, answers } = {}) =>
    request(`/public/events/${encodeURIComponent(slug)}/register`, {
      method: 'POST',
      body: JSON.stringify({ name, email, turnstile_token, answers }),
    }),
  invite: (token) => request(`/public/invite/${encodeURIComponent(token)}`),
  respondInvite: (token, { action, turnstile_token, name } = {}) =>
    request(`/public/invite/${encodeURIComponent(token)}/respond`, {
      method: 'POST',
      body: JSON.stringify({ action, turnstile_token, name }),
    }),
  icsUrl: (slug) => slug ? `/api/public/events/${encodeURIComponent(slug)}/ics` : '/api/public/events.ics',
};

// Admin event review queue (§8.3).
export const adminEvents = {
  list: ({ status, limit = 50, offset = 0 } = {}) => {
    const qs = new URLSearchParams();
    if (status) qs.set('status', status);
    qs.set('limit', String(limit));
    qs.set('offset', String(offset));
    return request(`/admin/events?${qs.toString()}`);
  },
  get: (id) => request(`/admin/events/${id}`),
  approve: (id) => request(`/admin/events/${id}/approve`, { method: 'POST', body: '{}' }),
  reject: (id, reason) => request(`/admin/events/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }),
  unpublish: (id) => request(`/admin/events/${id}/unpublish`, { method: 'POST', body: '{}' }),
  feature: (id, featured) => request(`/admin/events/${id}/feature`, { method: 'POST', body: JSON.stringify({ featured }) }),
  cancel: (id) => request(`/admin/events/${id}/cancel`, { method: 'POST', body: '{}' }),
  // capacity: null clears the cap (unlimited). Promotes the waitlist server-side.
  setCapacity: (id, capacity) =>
    request(`/admin/events/${id}/capacity`, { method: 'POST', body: JSON.stringify({ capacity }) }),
  analytics: () => request('/admin/events/analytics'),
};

// Task #68 — Job Board. `jobs` covers the authenticated founder surface (post
// roles, review-submit, applicant review); `jobsPublic` the no-auth,
// Turnstile-gated public surface (feed, detail, apply); `adminJobs` the admin
// review queue. Each path maps 1:1 to a /api/{jobs,public/jobs,admin/jobs}
// route on the worker (api-drift guard verifies the prefixes).
export const jobs = {
  // Founder's own postings + CRUD
  mine: () => request('/jobs'),
  get: (id) => request(`/jobs/${id}`),
  create: (payload) => request('/jobs', { method: 'POST', body: JSON.stringify(payload) }),
  update: (id, patch) => request(`/jobs/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  submitReview: (id) => request(`/jobs/${id}/submit-review`, { method: 'POST', body: '{}' }),
  close: (id) => request(`/jobs/${id}/close`, { method: 'POST', body: '{}' }),
  // Applicant review (founder/admin only — the sole PII surface)
  applications: (id) => request(`/jobs/${id}/applications`),
  // Mints a one-time signed resume download URL ({ url, expires_at }).
  resume: (id, appId) => request(`/jobs/${id}/applications/${appId}/resume`),
  // Caller's own applications across all postings.
  myApplications: () => request('/jobs/my-applications'),
};

// Public (no-auth) job surface — feed, detail, apply (Turnstile-gated).
export const jobsPublic = {
  list: ({ limit = 20, offset = 0, employment_type, seniority, remote, q } = {}) => {
    const qs = new URLSearchParams();
    qs.set('limit', String(limit));
    qs.set('offset', String(offset));
    if (employment_type) qs.set('employment_type', employment_type);
    if (seniority) qs.set('seniority', seniority);
    if (remote) qs.set('remote', '1');
    if (q) qs.set('q', q);
    return request(`/public/jobs?${qs.toString()}`);
  },
  read: (slug) => request(`/public/jobs/${encodeURIComponent(slug)}`),
  apply: (slug, payload) =>
    request(`/public/jobs/${encodeURIComponent(slug)}/apply`, {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    }),
};

// Admin job review queue.
export const adminJobs = {
  list: ({ status, limit = 50, offset = 0 } = {}) => {
    const qs = new URLSearchParams();
    if (status) qs.set('status', status);
    qs.set('limit', String(limit));
    qs.set('offset', String(offset));
    return request(`/admin/jobs?${qs.toString()}`);
  },
  get: (id) => request(`/admin/jobs/${id}`),
  approve: (id) => request(`/admin/jobs/${id}/approve`, { method: 'POST', body: '{}' }),
  reject: (id, reason) => request(`/admin/jobs/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }),
  unpublish: (id) => request(`/admin/jobs/${id}/unpublish`, { method: 'POST', body: '{}' }),
};

// Task #9 — Communities & Circles. `circlesPublic` is the no-auth public feed
// (published circles only); `adminCircles` the admin CRUD surface. Each path
// maps 1:1 to a /api/{public/circles,admin/circles} route on the worker
// (api-drift guard verifies the prefixes).
export const circlesPublic = {
  list: () => request('/public/circles'),
};

export const adminCircles = {
  list: ({ status } = {}) => {
    const qs = new URLSearchParams();
    if (status) qs.set('status', status);
    const suffix = qs.toString();
    return request(`/admin/circles${suffix ? `?${suffix}` : ''}`);
  },
  get: (id) => request(`/admin/circles/${id}`),
  create: (payload) => request('/admin/circles', { method: 'POST', body: JSON.stringify(payload) }),
  update: (id, patch) => request(`/admin/circles/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  publish: (id) => request(`/admin/circles/${id}/publish`, { method: 'POST', body: '{}' }),
  unpublish: (id) => request(`/admin/circles/${id}/unpublish`, { method: 'POST', body: '{}' }),
  feature: (id, featured) => request(`/admin/circles/${id}/feature`, { method: 'POST', body: JSON.stringify({ featured }) }),
  remove: (id) => request(`/admin/circles/${id}`, { method: 'DELETE' }),
};

// Assessment results — read-only client for archetype/skill display (Profile &
// Fit section, archetype badges). The gamified "Play & Discover" player surface
// was removed; only the results endpoints remain. Maps to /api/assessment on the
// worker (api-drift guard checks this prefix).
export const assessment = {
  myResults: () => request('/assessment/results/me'),
  results: (userId) => request(`/assessment/results/${userId}`),
};

// Task #3 — Assessment admin authoring + analytics (§3/§5/§7.2). Each method
// maps 1:1 to a /api/admin/assessment route on the worker (api-drift guard
// checks this prefix). All routes are requireAdmin on the worker. The dev
// FastAPI backend does NOT implement these, so this surface is worker-only —
// expect 404s in the dev preview.
export const adminAssessment = {
  // Games
  listGames: () => request('/admin/assessment/games'),
  createGame: (body) => request('/admin/assessment/games', { method: 'POST', body: JSON.stringify(body) }),
  getGame: (slug) => request(`/admin/assessment/games/${encodeURIComponent(slug)}`),
  updateGame: (slug, body) =>
    request(`/admin/assessment/games/${encodeURIComponent(slug)}`, { method: 'PUT', body: JSON.stringify(body) }),
  publishGame: (slug) =>
    request(`/admin/assessment/games/${encodeURIComponent(slug)}/publish`, { method: 'POST', body: '{}' }),
  archiveGame: (slug) =>
    request(`/admin/assessment/games/${encodeURIComponent(slug)}/archive`, { method: 'POST', body: '{}' }),
  versionGame: (slug) =>
    request(`/admin/assessment/games/${encodeURIComponent(slug)}/version`, { method: 'POST', body: '{}' }),

  // Chapters (PUT/DELETE keyed by id; create is scoped to a game slug).
  createChapter: (slug, body) =>
    request(`/admin/assessment/games/${encodeURIComponent(slug)}/chapters`, { method: 'POST', body: JSON.stringify(body) }),
  updateChapter: (id, body) =>
    request(`/admin/assessment/chapters/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteChapter: (id) => request(`/admin/assessment/chapters/${id}`, { method: 'DELETE' }),

  // Items (PUT/DELETE keyed by id; create is scoped to a game slug and needs
  // chapterId or chapterSlug). DELETE soft-deactivates if the item has answers.
  createItem: (slug, body) =>
    request(`/admin/assessment/games/${encodeURIComponent(slug)}/items`, { method: 'POST', body: JSON.stringify(body) }),
  updateItem: (id, body) =>
    request(`/admin/assessment/items/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteItem: (id) => request(`/admin/assessment/items/${id}`, { method: 'DELETE' }),

  // Archetypes (PUT/DELETE keyed by id; create scoped to a game slug).
  createArchetype: (slug, body) =>
    request(`/admin/assessment/games/${encodeURIComponent(slug)}/archetypes`, { method: 'POST', body: JSON.stringify(body) }),
  updateArchetype: (id, body) =>
    request(`/admin/assessment/archetypes/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteArchetype: (id) => request(`/admin/assessment/archetypes/${id}`, { method: 'DELETE' }),

  // Badges (global; PUT/DELETE keyed by slug).
  listBadges: () => request('/admin/assessment/badges'),
  createBadge: (body) => request('/admin/assessment/badges', { method: 'POST', body: JSON.stringify(body) }),
  updateBadge: (slug, body) =>
    request(`/admin/assessment/badges/${encodeURIComponent(slug)}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteBadge: (slug) => request(`/admin/assessment/badges/${encodeURIComponent(slug)}`, { method: 'DELETE' }),

  // Preview — scores a draft play-through in memory; persists NOTHING.
  preview: (slug, responses) =>
    request(`/admin/assessment/games/${encodeURIComponent(slug)}/preview`, {
      method: 'POST',
      body: JSON.stringify({ responses }),
    }),
  // Analytics — aggregate funnel/distribution/coverage for a game.
  analytics: (slug) => request(`/admin/assessment/games/${encodeURIComponent(slug)}/analytics`),
  // Admin re-score of a persisted session (optional surface).
  rescore: (sessionId) =>
    request(`/admin/assessment/sessions/${sessionId}/rescore`, { method: 'POST', body: '{}' }),
};