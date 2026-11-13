import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { MENTOR_PEOPLE_PATH, MOVED_ADVISOR_COHORTS } from './programsModel';

/**
 * D953 (#2371, D894's redirect rule) — /admin/advisor-cohorts was the
 * assignments console's address. Its work now lives on Mentor cohort access ›
 * People, so a bookmark lands there, keeps its query and hash and gains
 * `?moved=advisor-cohorts`: "Advisor cohort access is now Mentor cohort
 * access, under Programs." The redirect is not guarded: the page it lands on
 * is, by guard(['admin']).
 */
export default function AdvisorCohortsRedirect() {
  const loc = useLocation();
  const next = new URLSearchParams(loc.search);
  next.set('moved', MOVED_ADVISOR_COHORTS);
  return <Navigate to={{ pathname: MENTOR_PEOPLE_PATH, search: `?${next.toString()}`, hash: loc.hash }} replace />;
}
