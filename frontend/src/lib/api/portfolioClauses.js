// D6907 (#6907) — the clauses of an investor's own signed documents for one
// held company, by right type, for Eadwyn's proposal on Ownership & rights
// (PRM18 rail). Worker: routes/portfolio_clauses.ts (/api/portfolio-clauses).
// Returns clause text and location only; a document that cannot be read says so.
import { request } from '../api.js';

export const portfolioClausesApi = {
  // types: optional array of pro_rata | information_rights | board_seat | observer_seat | liquidation_preference | anti_dilution.
  get: (projectUid, { types } = {}) => {
    const q = Array.isArray(types) && types.length ? `?type=${encodeURIComponent(types.join(','))}` : '';
    return request(`/portfolio-clauses/${encodeURIComponent(projectUid)}${q}`);
  },
};
