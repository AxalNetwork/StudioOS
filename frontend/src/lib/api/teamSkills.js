// D1612 (#3952, part C of #3945) — the agent skill library. The Team page
// calls these through `pages/team/agentsAdapter.js`.
// Worker: routes/team_skills.ts (#3951), migration 757. Every route answers 404
// `team_agents_off` until TEAM_AGENTS_ENABLED is on.
//   GET  /api/teams/skills?company=&role=&category=&q=&sort=  → { roles, hq: [Skill], company: { uid, name, skills, can_write } | null, can_write_hq }
//   GET  /api/teams/skills/:uid                               → { skill: Skill & { skill_md }, versions, agents }
//   POST /api/teams/skills                                    { scope, company?, …fields } | { scope, company?, skill_md } → 201 { skill }
//   PATCH /api/teams/skills/:uid                              { …fields } | { status: 'retired' } → { skill }
//   POST /api/teams/skills/:uid/publish                       → { skill }
//   POST /api/teams/skills/:uid/assign                        { agents: [uid] } → { added, already, used_by }; 409 skill_not_attachable { refusals }
//   GET  /api/teams/agents/:uid/skills                        → { agent, skills, radar, can_manage }
//   PUT  /api/teams/agents/:uid/skills                        { skills: [uid | { uid, version }] } → the same; 409 skill_not_attachable { refusals }
import { request } from '../api.js';

const enc = encodeURIComponent;

export const teamSkillsApi = {
  skillLibrary: ({ company, role, category, q, sort } = {}) => {
    const p = new URLSearchParams();
    if (company) p.set('company', company);
    if (role) p.set('role', role);
    if (category) p.set('category', category);
    if (q) p.set('q', q);
    if (sort) p.set('sort', sort);
    const qs = p.toString();
    return request(`/teams/skills${qs ? `?${qs}` : ''}`);
  },
  skill: (uid) => request(`/teams/skills/${enc(uid)}`),
  createSkill: (body) => request('/teams/skills', { method: 'POST', body: JSON.stringify(body) }),
  updateSkill: (uid, patch) => request(`/teams/skills/${enc(uid)}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  publishSkill: (uid) => request(`/teams/skills/${enc(uid)}/publish`, { method: 'POST', body: '{}' }),
  assignSkill: (uid, agents) => request(`/teams/skills/${enc(uid)}/assign`, { method: 'POST', body: JSON.stringify({ agents }) }),
  agentSkills: (uid) => request(`/teams/agents/${enc(uid)}/skills`),
  setAgentSkills: (uid, skills) => request(`/teams/agents/${enc(uid)}/skills`, { method: 'PUT', body: JSON.stringify({ skills }) }),
};
