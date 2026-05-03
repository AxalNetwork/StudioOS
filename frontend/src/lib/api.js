const BASE = '/api';

function getAuthHeaders() {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request(path, options = {}) {
  try {
    // FormData uploads must NOT carry an explicit Content-Type — the browser
    // sets it (with the multipart boundary). Setting application/json here
    // would corrupt the request body.
    const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
    const baseHeaders = isFormData
      ? { ...getAuthHeaders(), ...options.headers }
      : { 'Content-Type': 'application/json', ...getAuthHeaders(), ...options.headers };
    const res = await fetch(`${BASE}${path}`, {
      headers: baseHeaders,
      ...options,
    });
    if (!res.ok) {
      if (res.status === 401 && !path.startsWith('/auth/')) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/login';
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

export const api = {
  register: (data) => request('/auth/register', { method: 'POST', body: JSON.stringify(data) }),
  login: (data) => request('/auth/login', { method: 'POST', body: JSON.stringify(data) }),
  verifyTotp: (data) => request('/auth/verify-totp', { method: 'POST', body: JSON.stringify(data) }),
  checkVerifyEmail: (token) => request(`/auth/verify-email?token=${encodeURIComponent(token)}`),
  confirmVerifyEmail: (data) => request('/auth/confirm-verify-email', { method: 'POST', body: JSON.stringify(data) }),
  resendVerification: (data) => request('/auth/resend-verification', { method: 'POST', body: JSON.stringify(data) }),
  setupTotp: (data) => request('/auth/setup-totp', { method: 'POST', body: JSON.stringify(data) }),
  getMe: () => request('/auth/me'),
  health: () => request('/health'),
  stats: () => request('/dashboard/stats'),

  listProjects: (status) => request(`/projects${status ? `?status=${status}` : ''}`),
  getProject: (id) => request(`/projects/${id}`),
  createProject: (data) => request('/projects', { method: 'POST', body: JSON.stringify(data) }),
  updateProject: (id, data) => request(`/projects/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteProject: (id) => request(`/projects/${id}`, { method: 'DELETE' }),
  advanceWeek: (id) => request(`/projects/${id}/advance-week`, { method: 'POST' }),

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
  spinoutProject: (projectId) => request(`/legal/spinout/${projectId}`, { method: 'POST' }),
  listEntities: () => request('/legal/entities'),

  listPartners: () => request('/partners'),
  createPartner: (data) => request('/partners', { method: 'POST', body: JSON.stringify(data) }),
  recommendPartners: (sector) => request(`/partners/matchmaking/recommend${sector ? `?sector=${sector}` : ''}`),

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

  listDeals: (status) => request(`/deals${status ? `?status=${status}` : ''}`),
  createDeal: (data) => request('/deals', { method: 'POST', body: JSON.stringify(data) }),
  getDeal: (id) => request(`/deals/${id}`),
  updateDeal: (id, data) => request(`/deals/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  listUsers: (role) => request(`/users${role ? `?role=${role}` : ''}`),
  createUser: (data) => request('/users', { method: 'POST', body: JSON.stringify(data) }),

  matchPartners: (data) => request('/partners/matchPartners', { method: 'POST', body: JSON.stringify(data) }),
  generateMemo: (data) => request('/scoring/generateMemo', { method: 'POST', body: JSON.stringify(data) }),
  capitalCall: (data) => request('/capital/capitalCall', { method: 'POST', body: JSON.stringify(data) }),

  founderSubmit: (data) => request('/projects/submit', { method: 'POST', body: JSON.stringify(data) }),

  marketPulse: () => request('/market-intel/market-pulse'),
  marketMacro: () => request('/market-intel/macro'),
  privateRounds: () => request('/market-intel/private-rounds'),
  studioBenchmarks: () => request('/market-intel/studio-benchmarks'),
  competitiveIntelligence: () => request('/market-intel/competitive-intelligence'),

  // Task #26 — Financial Model Builder
  getFinancialModel: (projectId) => request(`/financials/${projectId}`),
  saveFinancialModel: (projectId, assumptions) => request(`/financials/${projectId}`, { method: 'PUT', body: JSON.stringify({ assumptions }) }),
  recomputeFinancialModel: (projectId) => request(`/financials/${projectId}/recompute`, { method: 'POST' }),
  downloadFinancialModelXlsx: (projectId) => {
    const token = localStorage.getItem('token');
    fetch(`/api/financials/${projectId}/export.xlsx`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((res) => {
        if (!res.ok) throw new Error('Export failed');
        return res.blob().then((blob) => ({ blob, filename: (res.headers.get('Content-Disposition') || '').match(/filename="?([^"]+)"?/)?.[1] || 'financials.xlsx' }));
      })
      .then(({ blob, filename }) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      })
      .catch((e) => alert(e.message));
  },

  // Task #28 — Discovery / Roadmap / Metrics
  listInterviews: (projectId) => request(`/progress/discovery/${projectId}`),
  createInterview: (projectId, data) => request(`/progress/discovery/${projectId}`, { method: 'POST', body: JSON.stringify(data) }),
  updateInterview: (id, data) => request(`/progress/discovery/interview/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteInterview: (id) => request(`/progress/discovery/interview/${id}`, { method: 'DELETE' }),
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

  // Task #36 — Service Provider Marketplace
  listProviders: (params = {}) => request(`/marketplace/providers${Object.keys(params).length ? `?${new URLSearchParams(params)}` : ''}`),
  getProvider: (id) => request(`/marketplace/providers/${id}`),

  // Task #53 — Public partner directory (no auth required).
  publicListPartners: (params = {}) => {
    const q = Object.entries(params).filter(([_, v]) => v !== undefined && v !== null && v !== '');
    return request(`/marketplace/public/partners${q.length ? `?${new URLSearchParams(q)}` : ''}`);
  },
  publicGetPartner: (slug) => request(`/marketplace/public/partners/${encodeURIComponent(slug)}`),
  setPartnerFeatured: (partnerId, body) => request(`/marketplace/providers/${partnerId}/featured`, {
    method: 'POST', body: JSON.stringify(body),
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

  askAdvisory: (data) => request('/advisory/ask', { method: 'POST', body: JSON.stringify(data) }),
  financialPlan: (data) => request('/advisory/financial-plan', { method: 'POST', body: JSON.stringify(data) }),
  runDiligence: (data) => request('/advisory/diligence', { method: 'POST', body: JSON.stringify(data) }),

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
  adminGetContract: (uid) => request(`/admin/contracts/${uid}`),
  adminResendContract: (uid) => request(`/admin/contracts/${uid}/resend`, { method: 'POST' }),
  adminVoidContract: (uid) => request(`/admin/contracts/${uid}/void`, { method: 'POST' }),
  adminDownloadContractUrl: (uid) => `/api/admin/contracts/${uid}/download`,
  adminIssueContractShareLink: (uid, ttl_seconds = 300) =>
    request(`/admin/contracts/${uid}/download-url?ttl_seconds=${ttl_seconds}`, { method: 'POST' }),
  adminImpersonate: (userId) => request(`/admin/impersonate/${userId}`, { method: 'POST' }),
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
  networkGraph: () => request('/network/graph'),
  adminCommissions: () => request('/network/admin/commissions'),
  adminCommissionRules: () => request('/network/admin/commission-rules'),
  adminPayouts: () => request('/network/admin/payouts'),
  adminProcessPayout: (id, data) => request(`/network/admin/payouts/${id}/process`, { method: 'PATCH', body: JSON.stringify(data) }),

  adminUserProfile: (userId) => request(`/admin/users/${userId}/profile`),
  adminUpdateNotes: (userId, admin_notes) => request(`/admin/users/${userId}/notes`, { method: 'POST', body: JSON.stringify({ admin_notes }) }),
  adminResendVerification: (userId) => request(`/admin/users/${userId}/resend-verification`, { method: 'POST' }),

  integrationsAvailable: () => request('/integrations/available'),
  integrationsList: () => request('/integrations'),
  integrationsConnect: (data) => request('/integrations/connect', { method: 'POST', body: JSON.stringify(data) }),
  integrationsDisconnect: (uid) => request(`/integrations/${encodeURIComponent(uid)}`, { method: 'DELETE' }),
  integrationsSync: (uid) => request(`/integrations/${encodeURIComponent(uid)}/sync`, { method: 'POST' }),
  integrationsPush: (uid, data) => request(`/integrations/${encodeURIComponent(uid)}/push`, { method: 'POST', body: JSON.stringify(data) }),
  integrationsLogs: (uid, params = {}) => {
    const q = new URLSearchParams(Object.entries(params).filter(([_, v]) => v != null && v !== '')).toString();
    return request(`/integrations/${encodeURIComponent(uid)}/logs${q ? `?${q}` : ''}`);
  },

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
  brandSuggest: (payload) => request('/brand/suggest', { method: 'POST', body: JSON.stringify(payload) }),
  brandLogo: (payload) => request('/brand/logo', { method: 'POST', body: JSON.stringify(payload) }),
  brandGetLanding: (projectId) => request(`/brand/landing/by-project/${projectId}`),
  brandSaveLanding: (projectId, payload) => request(`/brand/landing/by-project/${projectId}`, { method: 'PUT', body: JSON.stringify(payload) }),
  brandPublishLanding: (projectId, published) => request(`/brand/landing/by-project/${projectId}/publish`, { method: 'POST', body: JSON.stringify({ published }) }),
  brandListWaitlist: (projectId) => request(`/brand/landing/by-project/${projectId}/waitlist`),

  // Task #25 — Pitch deck builder.
  deckGenerate: (projectId) => request('/decks/generate', { method: 'POST', body: JSON.stringify({ project_id: projectId }) }),
  deckListVersions: (projectId) => request(`/decks/by-project/${projectId}`),
  deckGet: (id) => request(`/decks/${id}`),
  deckUpdate: (id, payload) => request(`/decks/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deckRestore: (id) => request(`/decks/${id}/restore`, { method: 'POST', body: JSON.stringify({}) }),
  deckShare: (id, payload) => request(`/decks/${id}/share`, { method: 'POST', body: JSON.stringify(payload || {}) }),
  deckShareRead: (token) => request(`/decks/share/${encodeURIComponent(token)}`),

  matchPreferences: () => request('/matches/preferences'),
  matchPreferencesSave: (data) => request('/matches/preferences', { method: 'PUT', body: JSON.stringify(data) }),
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

  // ---------- Infrastructure (admin) ----------
  infraQueue: () => request('/infra/queue'),
  infraMetrics: (minutes = 60) => request(`/infra/metrics?minutes=${minutes}`),
  infraProcess: (batch = 10) => request(`/infra/process?batch=${batch}`, { method: 'POST' }),
  infraEnqueue: (job_type, payload, max_retries) =>
    request('/infra/enqueue', { method: 'POST', body: JSON.stringify({ job_type, payload, max_retries }) }),
  infraDLQ: () => request('/infra/dlq'),
  infraCleanup: () => request('/infra/cleanup', { method: 'POST' }),

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

  // ---------- Settings (Epic 3) ----------
  getSettings: () => request('/settings'),
  updateSettings: (data) => request('/settings', { method: 'PATCH', body: JSON.stringify(data) }),
  uploadHeadshot: (data_uri) => request('/settings/headshot', { method: 'POST', body: JSON.stringify({ data_uri }) }),
  requestEmailChange: (new_email) => request('/settings/email-change/request', { method: 'POST', body: JSON.stringify({ new_email }) }),
  confirmEmailChange: (token) => request('/settings/email-change/confirm', { method: 'POST', body: JSON.stringify({ token }) }),
  revokeEmailChange: (token) => request('/settings/email-change/revoke', { method: 'POST', body: JSON.stringify({ token }) }),
  repairTotp: (totp_code) => request('/settings/totp/repair', { method: 'POST', body: JSON.stringify({ totp_code }) }),
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
  getCapTableScenario: (uid) => request(`/captable/scenarios/${uid}`),
  createCapTableScenario: (data) =>
    request('/captable/scenarios', { method: 'POST', body: JSON.stringify(data) }),
  updateCapTableScenario: (uid, data) =>
    request(`/captable/scenarios/${uid}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteCapTableScenario: (uid) =>
    request(`/captable/scenarios/${uid}`, { method: 'DELETE' }),
  exportCapTableCsvUrl: (uid) => `/api/captable/scenarios/${uid}/export.csv`,

  // ---------- Founder risk (Task #41, admin/partner/investor only) ----------
  getFounderRiskByDeal: (dealId) => request(`/founder-risk/by-deal/${dealId}`),
  getFounderRiskByFounder: (founderId) => request(`/founder-risk/by-founder/${founderId}`),
  pullFounderRisk: (founderId) =>
    request(`/founder-risk/${founderId}/pull`, { method: 'POST' }),
  recomputeFounderRisk: (founderId) =>
    request(`/founder-risk/${founderId}/recompute`, { method: 'POST' }),

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
};