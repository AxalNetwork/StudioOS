/** D6703 (#6703): HQ intake cases and immutable answer sets; new-company intake creates the venture through the existing project route first. */
import { request } from '../api.js';

export const formationCasesApi = {
  async createForNewCompany(projectInput) {
    const project = await request('/projects', { method: 'POST', body: JSON.stringify(projectInput) });
    try {
      const intake = await formationCasesApi.create({ project_id: project.id, intent: 'new_company' });
      return { ...intake, project };
    } catch (error) {
      // Retain the created subject so a retry resumes it instead of creating another venture.
      error.projectId = project.id;
      throw error;
    }
  },
  create: (subject) => request('/formation/cases', { method: 'POST', body: JSON.stringify(subject) }),
  get: (uid) => request(`/formation/cases/${encodeURIComponent(uid)}`),
  saveAnswers: (uid, answers, revision) => request(`/formation/cases/${encodeURIComponent(uid)}/answers`, {
    method: 'POST', body: JSON.stringify({ answers, revision }),
  }),
};
