### Influencer program: applying, HQ's decisions and the membership (D4289 P1, #4290)

`routes/influencer.ts` is the member's side and is mounted at `/api/influencer`. `routes/admin_influencers.ts` is HQ's side and is mounted at `/api/admin/influencers`; it takes an HQ admin, and a branch is refused. Both are self-mounted. The rules are in `services/influencers.ts`. The stores come from migration `202611031502_influencer_program.sql`:
- `influencer_applications`;
- `influencers`;
- `influencer_events` (append-only);
- `influencer_tier_defaults`;
- the `influencers` segment on `referral_partners` and `referral_partner_terms`.

| Route | Who | Answer |
| --- | --- | --- |
| `POST /api/influencer/apply` `{ channels: [{ kind, url, audience? }], regions, topics, why, consent_version, consent: { disclosure, no_deal_promotion, no_self_referral } }` | any signed-in member, at HQ (409 `hq_program` on a branch) | `201 { application }`, or `200` when it answers HQ's question. 400s name the field (`channels_required`, `channel_invalid`, `audience_invalid`, `regions_required`, `topics_required`, `why_required`, `terms_version`, `terms_not_accepted`). 409s: `already_influencer`, `application_open` (with the open one), or `reapply_later` (with `reapply_after`, 90 days after a decline). |
| `GET /api/influencer/me` | the member | `{ membership: { uid, tier, tier_label, status, handle, admitted_at, investor_pro } \| null, application \| null, reapply_after, consent_version }` |
| `GET /api/influencer/tiers` | public | `{ tiers: [{ tier, label, percentage_bps, duration_invoices, currency }] }`, from the stored defaults; a rate nobody set is null. |
| `GET /api/admin/influencers/applications?status=applied\|more_requested\|admitted\|declined\|withdrawn\|open\|all&limit=` | HQ admin | `{ applications: [{ …, applicant: { user_id, name, role } }], counts: { applied, more_requested } }` |
| `POST /api/admin/influencers/applications/:uid/decision` `{ admit: tier } \| { decline: reason } \| { more: question }` | HQ admin | `{ application, membership, terms_uid? }`. Admitting makes the membership, the referral partner row (segment `influencers`; an existing partner keeps theirs), draft terms with an `influencer_subscription_invoice_paid` trigger at the tier's rate, and the Investor Pro grant. Each decision is audited and notified. 409 `application_decided` or `awaiting_applicant`; 400 `reason_required`. |
| `PATCH /api/admin/influencers/:uid` `{ tier?, status?: active\|paused\|ended, reason }` | HQ admin | `{ membership, events }`. Pausing or ending takes back the grant this program gave, and resuming gives it again. Audited and notified. 409 `influencer_ended`, `nothing_changed` or `influencer_changed`. |
| `GET /api/admin/influencers/tier-defaults` | HQ admin | `{ tiers }` |
| `PUT /api/admin/influencers/tier-defaults/:tier` `{ percentage_bps?, duration_invoices?, offer_budget_cents?, currency? }` | Super Admin, behind the write bar (403 `super_admin_required`) | `{ tier }`; null means "Not set". |

**Elsewhere:**
- `/api/auth/me` gains `influencer_active`.
- `POST /api/admin/referral-partners` and `PATCH /api/admin/referral-partners/:userId` refuse segment `influencers` with 400 `segment_by_application`.
- Terms may name the `influencer_subscription_invoice_paid` trigger, which P3 (#4292) fires.
