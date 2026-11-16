// D5580 part 5 (#5580): the HQ WorkGraph page's one read — the latest advisory
// snapshot with its age. Super Admin only. Worker: routes/admin_workgraph.ts.
import { request } from '../api.js';

export const adminWorkgraphApi = {
  inFlight: () => request('/admin/workgraph/in-flight'),
};
