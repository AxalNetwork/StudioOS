// D717 (#1782) decision 11: the entity and money map. Worker: routes/admin_fund_structure.ts.
import { request } from '../api.js';
export const fundStructureApi = { read: () => request('/admin/fund-structure') };
