import { createContext, useContext } from 'react';

/**
 * Provides the active view mode (role) for the current session, whether the
 * user is an admin, and whether impersonation is active.
 *
 * Kept in its own module so App.jsx only exports React components — mixing
 * component and non-component exports from the same file breaks Vite's Fast
 * Refresh and forces a full module invalidation on every HMR update.
 */
const ViewModeContext = createContext(null);

export const useViewMode = () => useContext(ViewModeContext);

export default ViewModeContext;
