# services/advisor/banks — the question banks

One bank per persona, plus the shared fit banks. `../questionBank.ts` assembles
the right set for a caller.

| File | Persona |
| --- | --- |
| `newFounderSpinout.ts` | A founder entering the Spin-Out Lab. |
| `existingFounder.ts` | A founder already operating. |
| `investor.ts` | Investors and LPs. |
| `advisor.ts` | Advisors. |
| `operatingPartner.ts` | Operating partners. |
| `explorer.ts` | Pre-admission accounts. |
| `admin.ts` | Internal. |
| `fitShared.ts` | Shared fit-scoring questions. |
| `fit_founder.ts`, `fit_investor.ts`, `fit_partner.ts`, `fit_advisor.ts`, `fit_coach.ts` | Per-persona fit questions. |

## Rules

- **Ids are permanent.** An answer is stored against its question id; renaming
  one orphans every answer already given. New question, new id.
- **Every question that writes must name a real column** in `../writeRouter.ts`,
  or the answer is silently lost and the question comes back next session.
- Keep the wording free of regulated framing — no "advice",
  "recommendation" or "fiduciary" in what the assistant asks or says.
