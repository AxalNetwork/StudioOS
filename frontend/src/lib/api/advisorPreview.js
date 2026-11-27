/** D8730 (#8730): the first questions of a previewed role's bank, as labelled examples, with no answers (`GET /api/advisor/preview-examples`). */
import { request } from '../api.js';

export const advisorPreviewApi = {
  examples: (shell, track = null) => {
    const qs = new URLSearchParams({ shell });
    if (track) qs.set('track', track);
    return request(`/advisor/preview-examples?${qs.toString()}`);
  },
};
