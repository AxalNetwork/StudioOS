### Influencer handles: `axal.vc/@handle`, channel links, visits and attribution (D4289 P2, #4291)

The rules live in `services/influencerHandles.ts` (handles, links, the public read, visits) and `services/referrals/handleAttribution.ts` (the reference, sign-up and checkout attribution, the fraud checks). The stores come from migration `202611031619_influencer_handles.sql`:
- `slug_history` kind `handle`, with `expires_at` and `taken_down`;
- `influencers.handle_changed_at` and `page_line`;
- `influencer_links`;
- `handle_visits`;
- `referral_attributions`, declared, with `source`, `handle`, `channel`, `status` and `refused_reason`;
- `influencer_referral_flags`.

| Route | Who | Answer |
| --- | --- | --- |
| `GET /api/public/handle/:handle` and `/:handle/:channel` (`routes/public_handle.ts`, self-mounted) | public | `{ state: 'live', handle, channel, name, photo, line, tier, tier_label, offer: null, disclosure, ref }`, `{ state: 'moved', handle, redirect }` for 12 months after a change, `{ state: 'unavailable' }` for a paused or ended influencer, or 404 `{ state: 'unknown' }`. A live read records one `handle_visits` row per handle, channel, day and `X-Axal-Visitor`, hashed with the day; no IP is stored. |
| `GET\|PUT /api/influencer/me/handle` `{ handle?, line? }` | the influencer | `{ handle, url, line, next_change_at, status }`. 400 `handle_invalid` or `handle_reserved` (reserved words, every top-level route word, the brand, look-alikes); 409 `handle_taken`, `handle_change_too_soon` (30 days, with `next_change_at`), `influencer_not_active`. |
| `GET\|POST /api/influencer/me/links` `{ channel, utm_campaign? }`, `DELETE /api/influencer/me/links/:uid` | the influencer | `{ handle, links: [{ uid, channel, utm_campaign, url }] }`; `201 { link }`; `204` (archived). 409 `channel_taken` or `links_full`. |
| `PATCH /api/admin/influencers/:uid` `{ handle_takedown: true, reason }` | HQ admin | P1's change route takes a takedown too. The handle is cleared and never redirects, and stays unclaimable for 12 months. 409 `no_handle`. |
| `GET /api/admin/influencers/flags?outcome=held\|refused\|cleared\|upheld\|all` | HQ admin | `{ flags: [{ uid, reason, outcome, handle, channel, influencer_uid, referred_user_id, … }] }` |
| `POST /api/admin/influencers/flags/:uid/decision` `{ decision: clear\|uphold, reason }` | HQ admin | `{ flag }`. Clearing a held sign-up makes its attribution active. 409 `flag_decided`. |

**Attribution:**
- **The cookie.** `/@handle` sets the first-touch cookie `axal_ref` to `h:<handle>[:<channel>]` (90 days). A `?ref=` code keeps 30 days.
- **Sign-up.** `/register` (body `ref_code` or the cookie), Google sign-up and magic-link sign-up attach it through `attachSignupReferral`. LinkedIn creates no accounts.
- **Checkout.** New plan subscriptions (`billing_checkout.ts`) carry `metadata[referrer_user_id]`, `metadata[referral_source]`, `metadata[handle]` and `metadata[channel]`, plus `metadata[referral_card_check] = on_payment` when the card is new.
- **Purchases.** `captureAndResolveAttribution` reads a handle cookie the same way.

**Link preview.** `/@*` is a `SOCIAL_CARD_GLOBS` and `run_worker_first` glob in both lists; it is not a route pattern. The card's description carries the disclosure.

**SPA.** The route module `frontend/src/routes/influencerHandle.jsx` answers `/:at` and `/:at/:channel` (React Router matches whole segments). It renders the 404 page for a segment without `@`.
