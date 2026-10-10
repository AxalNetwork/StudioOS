/**
 * D661 (#1474) — the writes behind the cycle pages' Add forms
 * (`pages/cycles/forms.js`), for the stores that have no page of their own
 * yet. A factory over `request`, so `cycles.js` binds it to the app's helper
 * and `cycle_adapters_d661.test.ts` binds it to the real Worker routes.
 *
 * Grow's routes take the venture in the body (`project`), Build's in the
 * query, as each route reads it. Each path and method is spelled out for the
 * drift check.
 */
const seg = (v) => encodeURIComponent(String(v));
const q = (projectId) => new URLSearchParams({ project: String(projectId) }).toString();

export function makeCycleWrites(request) {
  return {
    grow: {
      feedback: (projectId, body) => request('/cycles/grow/feedback', { method: 'POST', body: JSON.stringify({ ...body, project: projectId }) }),
      channel: (projectId, body) => request('/cycles/grow/channels', { method: 'POST', body: JSON.stringify({ ...body, project: projectId }) }),
      channelSpend: (projectId, uid, month, body) => request(`/cycles/grow/channels/${seg(uid)}/spend/${seg(month)}`, { method: 'PUT', body: JSON.stringify({ ...body, project: projectId }) }),
      partner: (projectId, body) => request('/cycles/grow/partners', { method: 'POST', body: JSON.stringify({ ...body, project: projectId }) }),
      partnerRevenue: (projectId, uid, month, body) => request(`/cycles/grow/partners/${seg(uid)}/revenue/${seg(month)}`, { method: 'PUT', body: JSON.stringify({ ...body, project: projectId }) }),
      market: (projectId, body) => request('/cycles/grow/markets', { method: 'POST', body: JSON.stringify({ ...body, project: projectId }) }),
      obligation: (projectId, body) => request('/cycles/grow/obligations', { method: 'POST', body: JSON.stringify({ ...body, project: projectId }) }),
      checklist: (projectId, key, done) => request(`/cycles/grow/checklist/${seg(key)}`, { method: 'PUT', body: JSON.stringify({ project: projectId, done: done === true }) }),
    },
    build: {
      risk: (projectId, body) => request(`/cycles/build/risks?${q(projectId)}`, { method: 'POST', body: JSON.stringify(body) }),
      formationStep: (projectId, body) => request(`/cycles/build/formation-steps?${q(projectId)}`, { method: 'POST', body: JSON.stringify(body) }),
    },
  };
}
