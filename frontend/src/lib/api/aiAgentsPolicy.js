// D8070 (#8070) — HQ › AI agents › Operations › Policies: the agent capability
// matrix. Worker: routes/admin_ai_agents_policy.ts (/api/admin/ai-agents/policy/capabilities),
// Super Admin only; every write takes a reason (1 to 200 characters) and is audited.
//   GET  /admin/ai-agents/policy/capabilities              { catalogue, policy: { enforced, ceiling } | null, agents: [{ uid, …, cells }] }
//   POST /admin/ai-agents/policy/capabilities/grant        { agent_uid, capabilities: [name | <domain>.*], reason }
//   POST /admin/ai-agents/policy/capabilities/revoke       { agent_uid, capability, reason }
//   PUT  /admin/ai-agents/policy/capabilities/ceiling      { capabilities: [..] | null, reason }
//   PUT  /admin/ai-agents/policy/capabilities/enforcement  { enforced, reason }
// Refusals carry `error`: capability_ungrantable (the five reserved names), capability_unknown,
// capability_not_offered, capability_unreadable, agent_not_found, not_granted, reason_required.
import { request } from '../api.js';

const BASE = '/admin/ai-agents/policy/capabilities';
const send = (path, method, body) => request(`${BASE}${path}`, { method, body: JSON.stringify(body) });

export const aiAgentsPolicyApi = {
  capabilities: () => request(BASE),
  grantCapabilities: (agentUid, capabilities, reason) => send('/grant', 'POST', { agent_uid: agentUid, capabilities, reason }),
  revokeCapability: (agentUid, capability, reason) => send('/revoke', 'POST', { agent_uid: agentUid, capability, reason }),
  setCapabilityCeiling: (capabilities, reason) => send('/ceiling', 'PUT', { capabilities, reason }),
  setCapabilityEnforcement: (enforced, reason) => send('/enforcement', 'PUT', { enforced, reason }),
};
