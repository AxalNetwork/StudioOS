/**
 * D661 (#1474) — the writes behind the cycle pages' Add and Edit forms
 * (`pages/cycles/forms.js`), for the stores that have no page of their own
 * yet. A factory over `request`, so `cycles.js` binds it to the app's helper
 * and `cycle_adapters_d661.test.ts` binds it to the real Worker routes.
 *
 * Grow's routes take the venture in the body (`project`), Validate's, Build's
 * and Raise's in the query, as each route reads it. Each path and method is spelled out for the
 * drift check.
 */
const seg = (v) => encodeURIComponent(String(v));
const q = (projectId) => new URLSearchParams({ project: String(projectId) }).toString();
// D695 decision 16: a cycle and a module slug reach the URL only in their own charset.
const CYCLE_KEY = /^(validate|build|raise|grow)$/;
const MODULE_SLUG = /^[a-z0-9][a-z0-9-]*$/;

export function makeCycleWrites(request) {
  return {
    // D695 decision 16: one read of a module's form choices for every cycle
    // (`routes/cycle_records.ts`). `query` follows `project`, so a search box
    // sends `{ q }` on the same path; the route hands it to the module's spec.
    formOptions: (cycle, projectId, slug, query = {}) => {
      if (!CYCLE_KEY.test(String(cycle)) || !MODULE_SLUG.test(String(slug))) return Promise.reject(new Error('That module has no form choices.'));
      const params = new URLSearchParams({ project: String(projectId) });
      for (const [key, value] of Object.entries(query || {})) if (key !== 'project' && value != null) params.append(key, String(value));
      return request(`/cycles/${cycle}/modules/${slug}/form-options?${params}`);
    },
    // D695 (#1656, PR 2b): Validate's Adds and Edits, through #1692's routes
    // (`routes/cycle_validate.ts`), the venture in the query.
    validate: {
      theme: (projectId, body) => request(`/cycles/validate/themes?${q(projectId)}`, { method: 'POST', body: JSON.stringify(body) }),
      themeUpdate: (projectId, id, body) => request(`/cycles/validate/themes/${seg(id)}?${q(projectId)}`, { method: 'PATCH', body: JSON.stringify(body) }),
      segment: (projectId, body) => request(`/cycles/validate/segments?${q(projectId)}`, { method: 'POST', body: JSON.stringify(body) }),
      segmentUpdate: (projectId, id, body) => request(`/cycles/validate/segments/${seg(id)}?${q(projectId)}`, { method: 'PATCH', body: JSON.stringify(body) }),
      competitor: (projectId, body) => request(`/cycles/validate/competitors?${q(projectId)}`, { method: 'POST', body: JSON.stringify(body) }),
      competitorUpdate: (projectId, id, body) => request(`/cycles/validate/competitors/${seg(id)}?${q(projectId)}`, { method: 'PATCH', body: JSON.stringify(body) }),
      signal: (projectId, body) => request(`/cycles/validate/demand-signals?${q(projectId)}`, { method: 'POST', body: JSON.stringify(body) }),
      signalUpdate: (projectId, id, body) => request(`/cycles/validate/demand-signals/${seg(id)}?${q(projectId)}`, { method: 'PATCH', body: JSON.stringify(body) }),
      hypothesis: (projectId, body) => request(`/cycles/validate/hypotheses?${q(projectId)}`, { method: 'POST', body: JSON.stringify(body) }),
      hypothesisUpdate: (projectId, id, body) => request(`/cycles/validate/hypotheses/${seg(id)}?${q(projectId)}`, { method: 'PATCH', body: JSON.stringify(body) }),
    },
    // D695 (#1657, PR 2): Raise's Adds and Edits, through #1700's routes. The
    // venture goes in the query; the data room's routes take its uid in the
    // path, as `api.dataRoomUploadFile` and `dataRoomUpdateFile` call them.
    raise: {
      // #1652's caller sends no body, and Re-score sends `{ items, since }`.
      rescore: (projectId, body) => request(`/cycles/raise/readiness/rescore?${q(projectId)}`, { method: 'POST', ...(body ? { body: JSON.stringify(body) } : {}) }),
      narrativeVersion: (projectId, body) => request(`/cycles/raise/narrative-versions?${q(projectId)}`, { method: 'POST', body: JSON.stringify(body) }),
      narrativeVersionUpdate: (projectId, version, body) => request(`/cycles/raise/narrative-versions/${seg(version)}?${q(projectId)}`, { method: 'PATCH', body: JSON.stringify(body) }),
      deckLink: (projectId, body) => request(`/cycles/raise/deck-links?${q(projectId)}`, { method: 'POST', body: JSON.stringify(body) }),
      deckLinkUpdate: (projectId, id, body) => request(`/cycles/raise/deck-links/${seg(id)}?${q(projectId)}`, { method: 'PATCH', body: JSON.stringify(body) }),
      holder: (projectId, body) => request(`/cycles/raise/holders?${q(projectId)}`, { method: 'POST', body: JSON.stringify(body) }),
      holderUpdate: (projectId, id, body) => request(`/cycles/raise/holders/${seg(id)}?${q(projectId)}`, { method: 'PATCH', body: JSON.stringify(body) }),
      useOfFunds: (projectId, body) => request(`/cycles/raise/use-of-funds?${q(projectId)}`, { method: 'PUT', body: JSON.stringify(body) }),
      prospect: (projectId, body) => request(`/cycles/raise/prospects?${q(projectId)}`, { method: 'POST', body: JSON.stringify(body) }),
      prospectUpdate: (projectId, id, body) => request(`/cycles/raise/prospects/${seg(id)}?${q(projectId)}`, { method: 'PATCH', body: JSON.stringify(body) }),
      upload: (projectUid, body) => request(`/data-room/${seg(projectUid)}/files`, { method: 'POST', body: JSON.stringify(body) }),
      fileUpdate: (projectUid, uid, body) => request(`/data-room/${seg(projectUid)}/files/${seg(uid)}`, { method: 'PATCH', body: JSON.stringify(body) }),
    },
    grow: {
      feedback: (projectId, body) => request('/cycles/grow/feedback', { method: 'POST', body: JSON.stringify({ ...body, project: projectId }) }),
      channel: (projectId, body) => request('/cycles/grow/channels', { method: 'POST', body: JSON.stringify({ ...body, project: projectId }) }),
      channelSpend: (projectId, uid, month, body) => request(`/cycles/grow/channels/${seg(uid)}/spend/${seg(month)}`, { method: 'PUT', body: JSON.stringify({ ...body, project: projectId }) }),
      // D695 (#1657): Enter a KPI and Open a role, through #1697's routes.
      kpi: (projectId, body) => request('/cycles/grow/kpis', { method: 'POST', body: JSON.stringify({ ...body, project: projectId }) }),
      role: (projectId, body) => request('/cycles/grow/roles', { method: 'POST', body: JSON.stringify({ ...body, project: projectId }) }),
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
      roleUpdate: (projectId, id, body) => request(`/cycles/grow/roles/${seg(id)}`, { method: 'PATCH', body: JSON.stringify({ ...body, project: projectId }) }),
      obligationUpdate: (projectId, id, body) => request(`/cycles/grow/obligations/${seg(id)}`, { method: 'PATCH', body: JSON.stringify({ ...body, project: projectId }) }),
    },
    // D696 (#1658): a record's own action, as `cyclesApi.recordAction` sends it; a
    // FormData body (Upload proof) goes as it is.
    recordAction: (cycle, projectId, slug, id, key, body = {}) => {
      if (!CYCLE_KEY.test(String(cycle)) || !MODULE_SLUG.test(String(slug))) return Promise.reject(new Error('That module has no records.'));
      return request(`/cycles/${cycle}/modules/${slug}/records/${seg(id)}/actions/${seg(key)}?${q(projectId)}`, {
        method: 'POST', body: body instanceof FormData ? body : JSON.stringify(body),
      });
    },
    build: {
      // D695 (#1656, PR 3b): Build's canvas Adds and Edits, through #1695's routes (#1792).
      addFeature: (projectId, body) => request(`/cycles/build/features?${q(projectId)}`, { method: 'POST', body: JSON.stringify(body) }),
      addMustHave: (projectId, body) => request(`/cycles/build/must-haves?${q(projectId)}`, { method: 'POST', body: JSON.stringify(body) }),
      roadmapItem: (projectId, body) => request(`/cycles/build/roadmap?${q(projectId)}`, { method: 'POST', body: JSON.stringify(body) }),
      roadmapItemUpdate: (projectId, id, body) => request(`/cycles/build/roadmap/${seg(id)}?${q(projectId)}`, { method: 'PATCH', body: JSON.stringify(body) }),
      // The cap table's plan gate answers 402; the dialog shows it as its refusal (D651).
      founder: (projectId, body) => request(`/cycles/build/founders?${q(projectId)}`, { method: 'POST', body: JSON.stringify(body), inlinePaywall: true }),
      founderUpdate: (projectId, id, body) => request(`/cycles/build/founders/${seg(id)}?${q(projectId)}`, { method: 'PATCH', body: JSON.stringify(body), inlinePaywall: true }),
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
      // D782 (#2114): the founder's decision on an architecture note GitHub proposed.
      acceptDesignProposal: (projectId, id) => request(`/cycles/build/solution-design/proposals/${seg(id)}/accept?${q(projectId)}`, { method: 'POST' }),
      dismissDesignProposal: (projectId, id) => request(`/cycles/build/solution-design/proposals/${seg(id)}/dismiss?${q(projectId)}`, { method: 'POST' }),
    },
  };
}
