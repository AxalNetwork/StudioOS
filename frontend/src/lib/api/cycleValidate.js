import { request } from '../api.js';

// D659 (#1472) — the Validate cycle's shared read and its manual writes,
// mounted by the Worker at `/api/cycles/validate`. Every call names the
// project with `?project=`; reads return #1469's Figure and Card shapes.
const q = (projectId) => `project=${encodeURIComponent(projectId)}`;

export const cycleValidateApi = {
  overview: (projectId) => request(`/cycles/validate/overview?${q(projectId)}`),
  module: (projectId, slug, { q: search = '', filter = '', sort = '', page = 1 } = {}) => {
    const params = new URLSearchParams({ project: String(projectId), q: search, filter, sort, page: String(page) });
    return request(`/cycles/validate/modules/${encodeURIComponent(slug)}?${params}`);
  },
  marketReadiness: (projectId) => request(`/cycles/validate/market-readiness?${q(projectId)}`),
  addSegment: (projectId, data) => request(`/cycles/validate/segments?${q(projectId)}`, { method: 'POST', body: JSON.stringify(data) }),
  setInterviewSegment: (projectId, interviewId, segmentId) => request(`/cycles/validate/interviews/${interviewId}/segment?${q(projectId)}`, { method: 'PUT', body: JSON.stringify({ segment_id: segmentId }) }),
  setInterviewStage: (projectId, interviewId, stage) => request(`/cycles/validate/interviews/${interviewId}/stage?${q(projectId)}`, { method: 'PUT', body: JSON.stringify({ stage }) }),
  addDemandSignal: (projectId, data) => request(`/cycles/validate/demand-signals?${q(projectId)}`, { method: 'POST', body: JSON.stringify(data) }),
  setDemandSignalStatus: (projectId, signalId, status) => request(`/cycles/validate/demand-signals/${signalId}/status?${q(projectId)}`, { method: 'PUT', body: JSON.stringify({ status }) }),
  setWaitlistTarget: (projectId, value) => request(`/cycles/validate/waitlist-target?${q(projectId)}`, { method: 'PUT', body: JSON.stringify({ value }) }),
  addCompetitorMention: (projectId, data) => request(`/cycles/validate/competitor-mentions?${q(projectId)}`, { method: 'POST', body: JSON.stringify(data) }),
  setMarketMark: (projectId, item, done) => request(`/cycles/validate/market-marks/${encodeURIComponent(item)}?${q(projectId)}`, { method: 'PUT', body: JSON.stringify({ done }) }),
  addMarketSource: (projectId, data) => request(`/cycles/validate/market-sources?${q(projectId)}`, { method: 'POST', body: JSON.stringify(data) }),
  removeMarketSource: (projectId, sourceId) => request(`/cycles/validate/market-sources/${sourceId}?${q(projectId)}`, { method: 'DELETE' }),
  setHypothesisPlan: (projectId, hypothesisId, data) => request(`/cycles/validate/hypotheses/${hypothesisId}/plan?${q(projectId)}`, { method: 'PUT', body: JSON.stringify(data) }),
  setEvidenceStrength: (projectId, linkId, strength) => request(`/cycles/validate/evidence-links/${linkId}/strength?${q(projectId)}`, { method: 'PUT', body: JSON.stringify({ strength }) }),
};
