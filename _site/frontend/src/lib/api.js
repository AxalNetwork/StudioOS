const BASE = '/api';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Request failed');
  }
  return res.json();
}

export const api = {
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
};
