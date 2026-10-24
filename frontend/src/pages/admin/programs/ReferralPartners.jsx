import React from 'react';
import { Link } from 'react-router-dom';
import { Card, LINK, SUB } from './parts';
import { HQ_READS_COMMISSIONS } from './programsModel';

/**
 * D953 (#2371) — Referral partners (PG7), Overview. It draws no partner-deal
 * rows of its own: Partner invitations (D923) owns the invitation, the offer,
 * the agreement, the deal, its referral code and its redemptions, so this
 * page links D923's tabs. Commissions is `hqOnly`, so its door is the Super
 * Admin's. Every door is a literal `to="…"` for the reachability walk.
 */
export function PartnersOverview({ superAdmin }) {
  return (
    <Card title="Where partner deals live" testId="programs-partners-overview">
      <p className="m-0 text-[13.5px] leading-relaxed text-axal-ink dark:text-gray-100">Partner deals, their codes and the sign-ups with them are on Partner invitations.</p>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        <Link to="/admin/partner-invitations/deals" className={LINK}>Partner deals</Link>
        <Link to="/admin/partner-invitations/referrals" className={LINK}>Partner referrals</Link>
        {superAdmin ? <Link to="/admin/commissions" className={LINK} data-testid="programs-partners-commissions">Commissions and payouts</Link> : null}
      </div>
      {superAdmin ? null : <p className={`m-0 ${SUB}`} data-testid="programs-partners-hq">{HQ_READS_COMMISSIONS}</p>}
    </Card>
  );
}

/** The header's action: New invitation lives on Partner invitations. */
export function InvitePartner({ className }) {
  return <Link to="/admin/partner-invitations" className={className} data-testid="programs-partners-invite">Invite a partner</Link>;
}
