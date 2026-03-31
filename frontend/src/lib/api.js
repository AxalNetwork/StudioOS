const BACKEND_URL = window.location.hostname === 'axal.vc'
  ? 'https://1162e933-32b6-4e52-9bfb-42fec8196216-00-36myluq91vtni.worf.replit.dev'
  : '';
const BASE = `${BACKEND_URL}/api`;

function getAuthHeaders() {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request(path, options = {}) {
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
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Request failed');
  }
  return res.json();
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

  listProjects: (status) => request(`/projects/${status ? `?status=${status}` : ''}`),
  getProject: (id) => request(`/projects/${id}`),
  createProject: (data) => request('/projects/', { method: 'POST', body: JSON.stringify(data) }),
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

  listPartners: () => request('/partners/'),
  createPartner: (data) => request('/partners/', { method: 'POST', body: JSON.stringify(data) }),
  recommendPartners: (sector) => request(`/partners/matchmaking/recommend${sector ? `?sector=${sector}` : ''}`),

  listInvestors: () => request('/capital/investors'),
  createInvestor: (data) => request('/capital/investors', { method: 'POST', body: JSON.stringify(data) }),
  getInvestor: (id) => request(`/capital/investors/${id}`),
  createCapitalCall: (data) => request('/capital/calls', { method: 'POST', body: JSON.stringify(data) }),
  listCapitalCalls: (status) => request(`/capital/calls${status ? `?status=${status}` : ''}`),
  payCapitalCall: (id) => request(`/capital/calls/${id}/pay`, { method: 'POST' }),
  portfolio: () => request('/capital/portfolio'),

  listTickets: (status) => request(`/tickets/${status ? `?status=${status}` : ''}`),
  createTicket: (data) => request('/tickets/', { method: 'POST', body: JSON.stringify(data) }),

  listDeals: (status) => request(`/deals/${status ? `?status=${status}` : ''}`),
  createDeal: (data) => request('/deals/', { method: 'POST', body: JSON.stringify(data) }),
  getDeal: (id) => request(`/deals/${id}`),
  updateDeal: (id, data) => request(`/deals/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  listUsers: (role) => request(`/users/${role ? `?role=${role}` : ''}`),
  createUser: (data) => request('/users/', { method: 'POST', body: JSON.stringify(data) }),

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

  adminListUsers: () => request('/admin/users'),
  adminImpersonate: (userId) => request(`/admin/impersonate/${userId}`, { method: 'POST' }),
  adminUpdateRole: (userId, role) => request(`/admin/users/${userId}/role?role=${role}`, { method: 'PATCH' }),
  adminToggleActive: (userId) => request(`/admin/users/${userId}/toggle-active`, { method: 'PATCH' }),

  privateProfile: () => request('/private-data/profile'),
  privateSignals: () => request('/private-data/market/private-signals'),
  privatePortfolioMetrics: () => request('/private-data/portfolio/metrics'),
  privateFounderData: (userId) => request(`/private-data/founder/${userId}`),
};
