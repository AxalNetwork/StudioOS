// D965 (#2798) — Refer & Earn's Rewards issued tile and Rewards card (PG9,
// `Programs Page.dc.html` ~415-417), mounted by the Overview in
// `ReferAndEarn.jsx`. Each block makes its own read and draws its own state:
//
//   - the tile counts the referrals at Reward issued, from part 4's exact
//     paged total (`status=reward_issued`, `limit=1`), and beside it the
//     perk credits the referral rules have paid, which only a Super Admin
//     reads (`paid`, D953 §2); an Admin reads "Not read here yet";
//   - the card draws each category's rules from `GET /api/refer-earn/admin/rewards`:
//     the credits and when, "Off" for a rule HQ switched off, and "Agreed
//     case by case" for strategic.
//
// Perk credits and introduction credits are never summed here. Every door is
// a literal `to`.
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { api } from '../../../lib/api';
import {
  CARD_FOOT, SETTLED_OFF_PLATFORM, paidFigure, rewardRows,
} from '../../../lib/referralRewards';
import { BlockFailed, Card, LINK, SUB, Skeleton, Tile, Unread } from './parts';
import { useRead } from './useProgramReads';
import { ALL_TIME, totalOf } from './programPagesModel';
import { isFailed, isReady } from './programsModel';

const nf = (n) => Number(n).toLocaleString('en-US');

/** The tile: an exact count, and the credits paid (a Super Admin's), never summed with anything. */
function issuedTile(issued, rewards) {
  const n = totalOf(issued);
  if (n === null) {
    return {
      key: 'rewards-issued', label: 'Rewards issued',
      state: isFailed(issued) || isReady(issued) ? 'unreadable' : 'loading',
      reason: 'Rewards issued could not be read. That is not the same as none.',
    };
  }
  const paid = paidFigure(rewards);
  const extra = [SETTLED_OFF_PLATFORM];
  if (paid.state === 'ready') extra.unshift(paid.text);
  if (paid.state === 'hq') extra.unshift(`Credits paid: ${paid.word}. ${paid.reason}`);
  if (paid.state === 'unreadable') extra.unshift('Credits paid could not be read. That is not the same as none.');
  if (paid.state === 'loading') extra.unshift('Credits paid: Reading…');
  return { key: 'rewards-issued', label: 'Rewards issued', state: 'ready', value: nf(n), sub: ALL_TIME, extra };
}

export function RewardsIssuedTile({ issued, rewards, onRetry }) {
  return <Tile t={issuedTile(issued, rewards)} onRetry={onRetry} />;
}

export function RewardsCard({ rewards, superAdmin, onRetry }) {
  const rows = isReady(rewards) ? rewardRows(rewards.data?.rules) : [];
  return (
    <Card title="Rewards" meta={superAdmin ? null : <span className="inline-flex items-center gap-1"><Lock size={11} aria-hidden="true" />Set by HQ</span>} testId="programs-refer-rewards">
      {rewards.status === 'loading' ? <Skeleton lines={3} /> : null}
      {isFailed(rewards) ? <BlockFailed what="The referral rewards" onRetry={onRetry} testId="programs-refer-rewards-unreadable" /> : null}
      {rows.length ? (
        <ul className="m-0 flex list-none flex-col p-0">
          {rows.map((r) => (
            <li key={r.key} className="flex flex-wrap items-baseline justify-between gap-2 border-t border-axal-hairline py-2 first:border-t-0 dark:border-gray-700" data-testid={`programs-refer-reward-${r.key}`}>
              <span className="text-[13px] font-semibold text-axal-ink dark:text-gray-100">{r.name}</span>
              <span className="flex flex-col items-end gap-0.5">
                {r.lines.map((l) => (l.reason
                  ? <Unread key={l.key} word={l.text} reason={l.reason} testId={`programs-refer-reward-${l.key}`} />
                  : <span key={l.key} className={l.tone === 'ink' ? 'font-mono text-[13px] font-semibold text-axal-ink dark:text-gray-100' : SUB} data-testid={`programs-refer-reward-${l.key}`}>{l.text}</span>))}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <span className="flex flex-wrap gap-3">
        <Link to="/admin/programs/perks" className={LINK} data-testid="programs-refer-rewards-perks">Open Perks</Link>
        {superAdmin ? <Link to="/admin/credit-rules" className={LINK} data-testid="programs-refer-rewards-edit">Edit in Credit rules</Link> : null}
      </span>
      {superAdmin ? null : <p className={`m-0 ${SUB}`} data-testid="programs-refer-rewards-foot">{CARD_FOOT}</p>}
    </Card>
  );
}

/** Both blocks' reads, each made alone, with one Try again that reads both again. */
export function useRewardReads() {
  const [tick, setTick] = useState(0);
  const issued = useRead('refer-rewards-issued', 'rewards-issued', tick, true,
    () => api.adminReferralSubmissions({ status: 'reward_issued', limit: 1, offset: 0 }));
  const rewards = useRead('refer-rewards', 'rewards', tick, true, () => api.adminReferralRewards());
  return { issued, rewards, reload: () => setTick((t) => t + 1) };
}
