// D1591 (#3858) — is a company or project address free, while the member types it.
// Worker: routes/slug_check.ts. Signed in; answers only, writes nothing.
//   GET /api/account/slug-check?kind=company|project&slug=…[&company=<uid>][&target=<uid | id>]
//     → { slug, available, reason: null|'slug_invalid'|'slug_reserved'|'slug_taken',
//         suggestion, path }; 404 not_found when `company` is not one of the caller's
// `company` scopes a project to that company (absent means standalone); `target`
// is the row being renamed, so its own slug reads as available.
import { request } from '../api.js';

export const slugsApi = {
  check: ({ kind, slug, company, target } = {}) => {
    const q = new URLSearchParams({ kind: String(kind || ''), slug: String(slug ?? '') });
    if (company) q.set('company', String(company));
    if (target != null && target !== '') q.set('target', String(target));
    return request(`/account/slug-check?${q}`);
  },
};
