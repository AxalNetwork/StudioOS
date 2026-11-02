## The four profiles, totalled

| Profile | Zones | Actions | Exports | Links | Stated gaps |
| --- | ---: | ---: | ---: | ---: | ---: |
| Founder | 25 | 70 | 19 | 17 | 34 |
| Investor | 17 | 51 | 12 | 1 | 38 |
| Partner | 15 | 45 | 15 | 0 | 30 |
| Advisor | 10 | 30 | 10 | 1 | 19 |
| **Total** | **67** | **196** | **56** | **19** | **121** |

Seventy-five of the hundred and ninety-six run today. The other hundred and
twenty-one say so on the page, in a sentence, rather than as a button that does
nothing.

**Seven zones are excluded, each for a reason the guard checks exactly** (a
profile's `excluded` list is asserted against what its canvases specify, so an
exclusion cannot grow by accident):

| Zone | Why |
| --- | --- |
| `research/funds` (founder) | a card in `ResearchWorkspace`'s `ZONE_COPY`, not a body |
| `research/diligence`, `research/benchmarking` (investor) | the same |
| `research/client-prep` (partner, advisor) | the same |
| `expertise/visibility` (advisor) | a read-only zone since D1424 (D1597's read); its artboard's ops have no store |
| `network/organizations` (advisor) | a card: nothing links a person an advisor knows to an organisation |
| `network/organizations` (partner) | `NetworkPage` catches a slug it has no tab for (`unservedZone`) and suppresses every body (`unservedAlone`), so the route renders its own heading above a card stating the gap — there is nothing for a row to sit over |

**MARKETS, ASK AND COMPANIES ARE NOT ON THAT LIST, AND MUST NOT BE ADDED TO IT.**
Asked on 2026-09-08 to record the three as "blocked on a store", the check found
the opposite: all three sit inside `ResearchWorkspace`'s `LIVE_ZONES`, each
reads a real worker route over a real D1 table, and several guards already
enforce that. Measured against production the same day:

| Zone | Store | Rows on production |
| --- | --- | --- |
| Markets | `routes/signals.ts` → `signals`, `market_intel_rows` | 10 and **196,956** |
| Companies | `routes/competitors.ts` → `competitor_analyses` | **0** |
| Ask | `routes/research.ts` → `research_documents` | **0** |

So Companies and Ask are **empty, not unbuilt** — a different fact with a
different fix — and Markets is genuinely populated. `NoStoreYet` says "No store
behind this yet", and putting that over a live signals feed reading 197k rows
would be a false sentence on the page rather than merely a stale note in a doc.
`noStoreCopy.js` is the registry for zones with no store; an empty store does
not belong in it.

This is the third time this shape has come up, which is why it is written down
rather than just declined: an earlier version of this document said Ask and
Library "remain unbuilt" AFTER they shipped, and read as written would have sent
someone to rebuild a shipped feature in the wrong place. The lesson is the same
each time — check the store before recording the gap.

**What DOES read as a gap, and is a real one:**
`pages/founder/FounderResearchDesk.jsx` (the founder `/research` root) prints
"No stored market evidence is available" and "Source unavailable" over stores
that exist, and for Markets over one holding 197k rows. Those two strings
conflate three different states — the source failed, the store is empty, and
nothing matched — and only one of them can be true at a time. Task #107's batch
separates them; the zones themselves were never the problem.

**Two corrections to an earlier version of this section**, both made after
re-checking rather than re-reading. It said the partner organizations route
"lands on contacts" — it does not, and a partner has no contacts tab either; the
page already states that zone's gap itself. And it called investor Deals and
Fund "read-only shells" with no flow to link to, which conflated a read-only
screen with a missing capability for the two labels whose API exists. Both
errors came from stopping one step short in the same chain this pass is about,
and both made the product look worse than it is.

**`/research/*` is in no profile's pass, and is not an oversight.** The five
founder Research zones (and the investor, advisor and partner lists beside
them) — Ask, Markets, Companies, Funds, Library — route to
`workspaces/ResearchWorkspace.jsx`, which serves founder, investor, partner,
advisor and admin from one component. Their actions belong to a shared pass over
that surface, where one change reaches four profiles, rather than to a
founder-only pull request that would have to branch on role inside a file whose
whole point is that it does not.

**Two canvases specify no zone-header actions at all**, which is a gap in the
design rather than in the implementation, and is recorded here rather than
invented in code:

| Canvas | What is missing |
| --- | --- |
| `Pages · Partner Pipeline` | no `ops:` on any artboard — the zones have filters and tables and no header actions |
| `Advisor Detail · Practice` | same; the Practice zones draw a header with nothing in it |

Nothing was added to those pages. Inventing an action for a zone whose design
asks for none is how a header grows a button nobody specified and nothing backs
— the exact failure the rest of this pass exists to avoid. When those canvases
gain an `ops:` array, the zones can have it.

D647 (#1441): `/admin/contracts` is one desk for both admin shells, with five
tabs for admins and the Super Admin-only Document types tab. ContractsPage
exports the desk from `pages/admin/contracts/`; ContractRegistry keeps D622's
pending drafts and publish checks. No Admin Console shell is imported.
Validated agreement paging/sorting/filtering returns the full union total;
`recorded=true` uses actual send dates. Migration 434 supports the guided
published-template picker and preview/send version/body check. History and
signed-PDF endpoints expose safe projections and the exact PDF fingerprint.
The legacy Legal deep link redirects with a moved notice. Formation orders are
reached through the existing Spin-Out Lab page. Canvas reference: #1456 K1–K8.

D653 (#1465), reshaped by D686 (#1598): Raise’s Call for Capital header opens
`/raise/call`, the lightbox over the Raise page (D686 S02-A, #1596), and so does
the command palette's "Call for Capital" (founder, admin). The five-step
`RoundCallSheet` (The round, Materials, Audience, Preview, Send) is drawn in
the tall cycle lightbox around an `ActionSheet`, and reads
`GET /round-calls/availability` before anything else: while round calls are
not enabled it says "Coming soon. Round calls are not enabled." and makes no
other call. It also opens from a
draft's page ("Continue draft") and a closed call's ("Open a new call"); it
resumes the venture's newest draft rather than starting a second one, with its
counsel approval and recorded audience, and shows the open call instead when
there is one. A founder's sent call lives in
the Raise shell at `/raise/capital-relationships/calls/:uid` (`RaiseCallPage`, D1221; `/raise/calls/:uid` forwards there, D1227: responses with search,
filters and paging, the closed and paused banners, Extend the date and Close
the call); a founder opening `/round-calls/:uid` is sent there, while
investors and counsel keep `/round-calls/:uid`. A founder's draft opens there
too, in its Draft state, whose Continue draft opens the new-call sheet (D1224,
#3223, CLS4–CLS7); `/round-calls/:uid` sends a founder there for a draft as
well. D1225 (#3224) redrew the founder's call to CLS8–CLS11 and
CLS14: the state chip (Draft, Open, Awaiting counsel, Expired, Closed) and line,
the strip (Indicated of the target, recipients, opened, data room, questions
waiting, not told with "See who"), the funnel with its table, the responses
(investor, furthest response, amount indicated, last activity, on Axal), the
questions, Extend, Close and Answer each in an in-page dialog, one recipient in a
drawer with delivery, a co-founder's view from D1222's `can`, and an admin's
refusal card; amounts read Indicated, and a matching investor stays nameless.
D1226 (#3225) redrew the investor's view to CLS13
(`InvestorCallView`), under Deals ("Deals › Round calls › [company]", and the
investor sidebar's Deals row lights on `/round-calls`): the terms with "In plain
words", the frozen deck, the data room behind the NDA and the founder's grant,
"Indicate an amount" (Indicated, never committed) and "Ask a question". It names
the company (`company.name` on the investor's read) and no other investor.
Counsel's view is unchanged. `/round-calls?project_id=…` lists owned calls. With S19-A
(#1594, migration 456): The round takes the instrument's own structured terms
(a SAFE's cap, a note's cap and discount, equity's pre-money), seeded from the
context's `term_seeds`; the audience preview names sector, stage and cheque
range, or why no match can be made; Send's "Request counsel review" posts
`/round-calls/:uid/counsel-request` and then reads "Sent to Axal HQ for counsel
review on <date>"; HQ's `/hq/review?tab=counsel` lists `GET
/round-calls/counsel-queue`; and Capital relationships carries the Calls for
Capital history (`#calls`, `parts.calls`), Raise's live history tab.
Extensions pause responses until renewed approval; deck-content hashes cover mutable slides.
The Worker `round_calls.ts` mounts `/api/round-calls`: availability/context/list,
draft create/update, audience preview/update, send, responses, questions, manage
and counsel-approval.
Founder ownership and active company, verified investor recipient entitlement,
and HQ/Super Admin counsel review are enforced server-side. Production flag
ROUND_CALLS_ENABLED stays false. Deck versions and NDA/grant data-room materials
remain references. Share an update’s capital asks link to the latest open call;
network recipients see the ask text only. Eligible replies appear as native call
questions and atomic Raise pipeline entries; other update replies remain on the
source ask and appear in the founder’s question list with that source link.
D1222 (#3221, Calls for Capital part 1):
- `GET /round-calls/readiness?project_id` answers while the flag is off. It returns CLS1's seven items from the venture's own Raise records (round, deck, data room, use of funds, traction, close; terms are `null`, written in the call) and no investor data.
- The audience preview adds `not_on_axal`: the venture's prospects with no verified account, by name, flagged when chosen, with no email. A chosen prospect not on Axal is left out of the save and counted, never a failure; another venture's prospect is still refused (422 `prospect_not_found`).
- `not_delivered` is on each `parts.calls` item and in the call's `progress` (null for a draft).
- An accepted co-founder (`project_members`) may read the context, the list and a call, and may draft and answer questions; the call carries `relation` and `can`. The audience, counsel request, send, extend and close stay the owner's, checked again in each service.

