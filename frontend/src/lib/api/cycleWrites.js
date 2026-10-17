/**
 * D661 (#1474) — the writes behind the cycle pages' Add and Edit forms
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
    raise: {
      rescore: (projectId) => request(`/cycles/raise/readiness/rescore?${q(projectId)}`, { method: 'POST' }),
      narrativeVersion: (projectId, body) => request(`/cycles/raise/narrative-versions?${q(projectId)}`, { method: 'POST', body: JSON.stringify(body) }),
    },
    grow: {
      feedback: (projectId, body) => request('/cycles/grow/feedback', { method: 'POST', body: JSON.stringify({ ...body, project: projectId }) }),
      channel: (projectId, body) => request('/cycles/grow/channels', { method: 'POST', body: JSON.stringify({ ...body, project: projectId }) }),
      channelSpend: (projectId, uid, month, body) => request(`/cycles/grow/channels/${seg(uid)}/spend/${seg(month)}`, { method: 'PUT', body: JSON.stringify({ ...body, project: projectId }) }),
      partner: (projectId, body) => request('/cycles/grow/partners', { method: 'POST', body: JSON.stringify({ ...body, project: projectId }) }),
      partnerRevenue: (projectId, uid, month, body) => request(`/cycles/grow/partners/${seg(uid)}/revenue/${seg(month)}`, { method: 'PUT', body: JSON.stringify({ ...body, project: projectId }) }),
      market: (projectId, body) => request('/cycles/grow/markets', { method: 'POST', body: JSON.stringify({ ...body, project: projectId }) }),
      obligation: (projectId, body) => request('/cycles/grow/obligations', { method: 'POST', body: JSON.stringify({ ...body, project: projectId }) }),
      checklist: (projectId, key, done) => request(`/cycles/grow/checklist/${seg(key)}`, { method: 'PUT', body: JSON.stringify({ project: projectId, done: done === true }) }),
      // Edits: a PATCH changes only the fields it is sent.
      feedbackUpdate: (projectId, uid, body) => request(`/cycles/grow/feedback/${seg(uid)}`, { method: 'PATCH', body: JSON.stringify({ ...body, project: projectId }) }),
      channelUpdate: (projectId, uid, body) => request(`/cycles/grow/channels/${seg(uid)}`, { method: 'PATCH', body: JSON.stringify({ ...body, project: projectId }) }),
      partnerUpdate: (projectId, uid, body) => request(`/cycles/grow/partners/${seg(uid)}`, { method: 'PATCH', body: JSON.stringify({ ...body, project: projectId }) }),
      marketUpdate: (projectId, uid, body) => request(`/cycles/grow/markets/${seg(uid)}`, { method: 'PATCH', body: JSON.stringify({ ...body, project: projectId }) }),
      obligationUpdate: (projectId, id, body) => request(`/cycles/grow/obligations/${seg(id)}`, { method: 'PATCH', body: JSON.stringify({ ...body, project: projectId }) }),
    },
    build: {
      risk: (projectId, body) => request(`/cycles/build/risks?${q(projectId)}`, { method: 'POST', body: JSON.stringify(body) }),
      formationStep: (projectId, body) => request(`/cycles/build/formation-steps?${q(projectId)}`, { method: 'POST', body: JSON.stringify(body) }),
      formationStepUpdate: (projectId, id, body) => request(`/cycles/build/formation-steps/${seg(id)}?${q(projectId)}`, { method: 'PATCH', body: JSON.stringify(body) }),
      // A feature's must-have mark and due date (D662). The feature itself is
      // MVP scope's row: `mvpFeature` adds one, with the project in the path.
      feature: (projectId, id, body) => request(`/cycles/build/features/${seg(id)}?${q(projectId)}`, { method: 'PATCH', body: JSON.stringify(body) }),
      mvpFeature: (projectId, body) => request(`/progress/mvp-scope/${seg(projectId)}`, { method: 'POST', body: JSON.stringify(body) }),
      // D686 §5.3 (S18-B): a core system's connector. `{ integration_uid }`
      // for Bank, Accounting, Payroll and CRM, `{ provider_key }` for
      // Workspace, either null to unmap; `used_by` is free text.
      system: (projectId, kind, body) => request(`/cycles/build/systems/${seg(kind)}?${q(projectId)}`, { method: 'PUT', body: JSON.stringify(body) }),
      // Each kind's choices: the caller's own connections enabled for the
      // project's company whose category fits it.
      systemChoices: (projectId) => request(`/cycles/build/systems/choices?${q(projectId)}`),
    },
  };
}
