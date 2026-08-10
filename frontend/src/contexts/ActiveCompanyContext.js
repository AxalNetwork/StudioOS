import { createContext, useContext } from 'react';

/**
 * Holds the currently selected company for the authenticated session.
 * Provided by ProtectedLayout in App.jsx.
 *
 * Shape of `company`:
 *   { id, uid, company_name, stage, description, website, linkedin_url,
 *     logo_url, revenue_range, employee_count, current_products,
 *     expansion_goals, international_presence, my_role, is_primary_admin,
 *     members, member_count, viewer_is_member, created_at, updated_at }
 *   or null when the user has no company membership.
 *
 * `companies` is the full membership list (all companies the user belongs to).
 */
export const ActiveCompanyContext = createContext({
  company: null,
  setCompany: () => {},
  companies: [],
  setCompanies: () => {},
});

export function useActiveCompany() {
  return useContext(ActiveCompanyContext);
}
