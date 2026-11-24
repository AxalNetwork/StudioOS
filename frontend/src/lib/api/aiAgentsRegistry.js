// D8080 (#8080) — HQ › AI agents › Roster › Registry: the agent registry synced from agents/<name>.agent.yml.
// Worker: routes/admin_ai_agents_roster.ts (/api/admin/ai-agents/registry), Super Admin only. Read-only.
// No sync yet answers { status: 'not_recorded' }; a platform agent's copies and drift are null ("Not recorded").
//   GET /admin/ai-agents/registry
import { request } from '../api.js';

export const aiAgentsRegistryApi = {
  registry: () => request('/admin/ai-agents/registry'),
};
