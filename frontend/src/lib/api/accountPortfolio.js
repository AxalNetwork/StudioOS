// D1415 — the Portfolio reads: the switcher (companies with their projects,
// standalone projects, seated projects elsewhere), which settings apply to a
// selection, and an address (/c/<company>/p/<project>, /p/<project>) resolved
// to its company and project. A project's slug is set here too; a company's
// is in companyLegal.js. Worker: routes/account_portfolio.ts and
// routes/project_lifecycle.ts.
import { request } from '../api.js';

export const accountPortfolioApi = {
  switcher: () => request('/account/switcher'),
  settingsScope: ({ company, project } = {}) => {
    const q = new URLSearchParams();
    if (company) q.set('company', company);
    if (project != null) q.set('project', String(project));
    return request(`/account/settings-scope?${q.toString()}`);
  },
  resolve: (path) => request(`/account/resolve?path=${encodeURIComponent(path)}`),
  setProjectSlug: (projectId, slug) => request(`/projects/${encodeURIComponent(projectId)}/slug`, {
    method: 'PUT',
    body: JSON.stringify({ slug }),
  }),
};
