### Influencer analytics (D4295, #4295, D4289 P6)

- **Worker, `routes/influencer_analytics.ts`** (self-mounting at `/api/influencer` and `/api/admin/influencers`):
  - `GET /api/influencer/me/analytics?from&to&channel&grain=week` → `{ as_of, range, visits, signups { total, series }, paid_members, revenue, commission { by_currency, series }, bonuses, funnel, channels, audience { by_plan_family, by_region, by_month_joined, retention, visit_to_paid_median_days }, line }`. An admitted influencer only (404 `not_an_influencer`).
  - `GET /api/admin/influencers/:uid/analytics` returns the same figures to an admin. Money (`commission`, `revenue`, `bonuses`) is the Super Admin's; any other admin reads `{ available: false, reason: 'hq_reads' }`.
  - 400 `invalid_range` (from after to, or over a year), `unsupported_grain` (not `week`), `invalid_channel`.
- **Values:** a group of 1 to 4 members is `{ fewer_than: 5 }`; a figure nothing stores yet is `{ available: false, reason: 'not_recorded', source }` (`handle_visits` from P2, `subscription_commissions` from P3); a failed read is `reason: 'unreadable'`.
- **Tables read:** `referrals`, `commissions`, `payout_commissions`, `payouts`, `member_subscription_amounts`, `users.country`. No migration.
- **Client:** none yet. P7 (#4296) draws the Overview and Audience tabs from this read.
