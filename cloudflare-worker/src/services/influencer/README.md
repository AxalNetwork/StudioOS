# services/influencer — the Influencer program's Worker logic (D4289)

The Influencer program (#4289) is built in parts P1 to P9. This folder holds
the Worker rules the parts share, one file per part that needs one.

| File | What it does |
| --- | --- |
| `membership.ts` | `isInfluencer`: an admitted influencer is a `referral_partners` row in the `influencers` segment (D-b), written by P1 on admission. Every part reads it from here. |
| `payoutReadiness.ts` | D4294 (#4294, P5): when an influencer may request a payout. `payoutReadiness` (IN4's checklist: identity, tax form, the current terms, payout method, the $50 minimum in the terms' currency, once a month) and `payoutGate`, the named refusal `POST /api/network/payout/request` returns. `INFLUENCER_TERMS_VERSION` is the terms in force. |

**Rule for adding here.** A file is the rules of one part, pure or reading
D1 with bound SQL only. Routes stay in `../../routes/`. Nothing here logs a
member's figures, a file or a reason. Name the part and its decision in the
file's header and add its row above.
