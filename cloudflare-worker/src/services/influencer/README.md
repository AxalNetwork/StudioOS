# services/influencer — the Influencer program's Worker logic (D4289)

The Influencer program (#4289) is built in parts P1 to P9. This folder holds
the Worker rules the parts share, one file per part that needs one.

| File | What it does |
| --- | --- |
| `membership.ts` | `isInfluencer`: an admitted influencer is a `referral_partners` row in the `influencers` segment (D-b), written by P1 on admission. Every part reads it from here. |
| `analytics.ts` | D4295 (#4295, P6): the influencer's figures for IN1, IN2, IN4 and IN5, and HQ's per-influencer totals. Totals only: a group of 1 to 4 members reads `{ fewer_than: 5 }`, and no referred member's name, email or id is selected into a reply. A figure whose store P2 or P3 adds reads `not_recorded` with that store's name; a failed read reads `unreadable`; never 0. Money is per currency and is the Super Admin's in HQ (`hq_reads` otherwise). `summaryLine` is IN1's Eadwyn line, restating the figures with their date. |

**Rule for adding here.** A file is the rules of one part, pure or reading
D1 with bound SQL only. Routes stay in `../../routes/`. Nothing here logs a
member's figures, a file or a reason. Name the part and its decision in the
file's header and add its row above.
