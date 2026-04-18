const BASE = '/api';

function getAuthHeaders() {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request(path, options = {}) {
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders(), ...options.headers },
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
      const msg =
        (err && err.error && typeof err.error === 'object' && err.error.message) ||
        (typeof err.error === 'string' && err.error) ||
        err.detail ||
        err.message ||
        res.statusText ||
        'Request failed';
      throw new Error(msg);
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

  scoreStartup: (data) => request('/scoring/score', { method: 'POST', body: JSON.stringify(data) }),
  getScores: (projectId) => request(`/scoring/scores/${projectId}`),
  generateDealMemo: (projectId) => request(`/scoring/score/${projectId}/deal-memo`, { method: 'POST' }),
  getDealMemos: (projectId) => request(`/scoring/deal-memos/${projectId}`),
  scoringQueue: () => request('/scoring/queue'),

  listTemplates: () => request('/legal/templates'),
  getTemplateContent: (key) => request(`/legal/templates/${key}`),
  generateDocument: (data) => request('/legal/documents/generate', { method: 'POST', body: JSON.stringify(data) }),
  listDocuments: (projectId) => request(`/legal/documents${projectId ? `?project_id=${projectId}` : ''}`),
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

  askAdvisory: (data) => request('/advisory/ask', { method: 'POST', body: JSON.stringify(data) }),
  financialPlan: (data) => request('/advisory/financial-plan', { method: 'POST', body: JSON.stringify(data) }),
  runDiligence: (data) => request('/advisory/diligence', { method: 'POST', body: JSON.stringify(data) }),

  activityLog: (params) => request(`/activity/${params ? `?${new URLSearchParams(params)}` : ''}`),
  activitySummary: () => request('/activity/summary'),
  activitySyncGithub: () => request('/activity/sync-github', { method: 'POST' }),

  adminListUsers: () => request('/admin/users'),
  adminImpersonate: (userId) => request(`/admin/impersonate/${userId}`, { method: 'POST' }),
  adminUpdateRole: (userId, role) => request(`/admin/users/${userId}/role?role=${role}`, { method: 'PATCH' }),
  adminToggleActive: (userId) => request(`/admin/users/${userId}/toggle-active`, { method: 'PATCH' }),

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
  lpPortal: () => request('/legalcap/capital/lp-portal'),
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
};