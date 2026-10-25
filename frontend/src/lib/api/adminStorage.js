// D1168: the HQ-only, step-up-protected metadata backfill. No file content.
import { request } from '../api.js';
export const adminStorageApi = {
  backfillSizes: (limit) => request('/admin/platform/storage/backfill-sizes', {
    method:'POST', body:JSON.stringify(limit === undefined ? {} : {limit}),
  }),
};
