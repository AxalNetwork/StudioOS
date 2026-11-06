### The Influencer program's public pages (D4297, #4297)

The public side of the program (IN7–IN10). No price, rate or bonus amount is typed: rates come from the tiers read, plan prices from the plans read, and bonus amounts are each influencer's terms'. The disclosure goes with every handle and offer.

| Address | What it draws | Worker routes |
| --- | --- | --- |
| `/@:handle`, `/@:handle/:channel` (P2's route) | IN7: the card, the featured offer, Join with the reference, the disclosure, four plans with prices; unknown, paused, moved and failed states | `GET /api/public/handle/:handle[/:channel]` (now with `offer`), `GET /api/public/plans-and-packs` |
| `/influencers` (public) | IN8: hero, how it works, the tiers, bonuses, benefits, rules, questions, Apply; the application sheet (IN9) and its states (IN9r) for a signed-in member | `GET /api/influencer/tiers`, `GET /api/influencer/me`, `POST /api/influencer/apply` |
| `/referrals` (card) | IN10: Apply, the application's state, or "Open your Influencer section" (`/influencer`, P7) | `GET /api/influencer/me`, `GET /api/influencer/tiers`, `POST /api/influencer/apply` |

Signed out, Apply goes to `/register?program=influencer&next=%2Finfluencers%3Fapply%3D1`, and the sheet opens on the way back.
