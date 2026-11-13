import { createContext, useCallback, useContext } from 'react';

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

/** Refresh a company's details without changing the selection or membership metadata. */
export function mergeCompanyDetails(current, updated) {
  if (!current || !updated?.uid || current.uid !== updated.uid) return current;
  return { ...current, ...updated };
}

/** Company edits refresh both surfaces; only the switcher changes the selection. */
export function useUpdateCompanyDetails() {
  const { setCompany, setCompanies } = useActiveCompany();
  return useCallback((updated) => {
    setCompany(current => mergeCompanyDetails(current, updated));
    setCompanies(current => current.map(company => mergeCompanyDetails(company, updated)));
  }, [setCompany, setCompanies]);
}
