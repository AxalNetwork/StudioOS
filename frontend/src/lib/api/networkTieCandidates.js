/** D6636: names-only shared-resource candidates for the existing consent-based tie request. */
import {request} from '../api.js';
export const networkTieCandidatesApi={list:(after=0)=>request(`/partnernet/relationships/candidates?after=${encodeURIComponent(after)}`)};
