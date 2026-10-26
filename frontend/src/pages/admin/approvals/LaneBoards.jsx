import React from 'react';
import { useLocation } from 'react-router-dom';
import AdminBoardFrame from '../AdminBoardFrame';
import { RAIL_NOTE, boardOf } from './approvalsModel';
import ExpertBoard from './ExpertBoard';
import PitchBoard from './PitchBoard';
import TesterBoard from './TesterBoard';

/**
 * D1038 (#2390) — the three lane boards (APR4, APR6, APR8), at
 * /admin/approvals/product-testers, /co-marketing and /wellbeing-experts,
 * each tab a sub-path.
 *
 * D1046 (#2894), part 8: THEY DECIDE. Each board reads its store (parts 4 and
 * 5), opens one item at its own address (`/<board>/<id>`) as a drawer over
 * the board, and every decision opens a dialog that says what changes, who is
 * told and what is recorded. The Worker records each decision and tells the
 * person; a refusal carries a reason they see. Co-marketing's Review queue
 * and the /admin/wellbeing roster's toggles are retired into these boards.
 */

function Board() {
  const loc = useLocation();
  const found = boardOf(loc.pathname) || { board: 'product-testers', tab: 'waiting' };
  // An item opened from a tab's row keeps that tab under its drawer.
  const under = found.item ? boardOf(loc.state?.from) : null;
  const at = under && under.board === found.board && !under.item ? { ...found, tab: under.tab } : found;
  if (at.board === 'co-marketing') return <PitchBoard at={at} />;
  if (at.board === 'wellbeing-experts') return <ExpertBoard at={at} />;
  return <TesterBoard at={at} />;
}

export default function LaneBoards() {
  return (
    <AdminBoardFrame workspace="Approvals" note={RAIL_NOTE} data-testid="admin-board-approvals-lanes">
      <div className="pb-24 lg:pb-10"><Board /></div>
    </AdminBoardFrame>
  );
}
