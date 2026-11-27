import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { MOVED_REFER_EARN, REFER_QUEUE_PATH } from './programsModel';

/**
 * D953 (#2371, D894's redirect rule) — /admin/refer-earn was Referral
 * review's address. Its work now lives on Refer & Earn › Queue, so a bookmark
 * lands there, keeps its query and hash and gains `?moved=refer-earn`:
 * "Referral review is now Refer & Earn, under Programs." The redirect is not
 * guarded: the page it lands on is, by guard(['admin']).
 */
export default function ReferEarnRedirect() {
  const loc = useLocation();
  const next = new URLSearchParams(loc.search);
  next.set('moved', MOVED_REFER_EARN);
  return <Navigate to={{ pathname: REFER_QUEUE_PATH, search: `?${next.toString()}`, hash: loc.hash }} replace />;
}
