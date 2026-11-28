| LP Investor Workspace | investor-LP | `/spinout-lab/investor-workspace` (existing) | `/spinout-lab/investor-workspace` → `SpinoutLabLpWorkspacePage`; `/lp-portal` and `/funds/lp-workspace` (retired D2319) redirect here (D372) | {backend} | UPGRADE | A native port of the canvas; D372 adds I5's My commitment (called / due / uncalled per fund, the calls, distributions, TVPI/DPI, view and sign LPA), Message the GP, and onboarding status read from records. Co-invest offers, allocation submit and Ask the report have no store and say so. LP-side Spin-Out Fund I surface: apply/allocation window, key terms, commitment process, capital calls issued, LP data room, IC signal, message the GP. **Axal VC Fund v2 and LP Workspace canvas landed 2026-11-14 (D6127, #6127), not built:** replaces this canvas; the first screen follows the standing `lpAccessState()` derives, a committed LP sees What is due, What to sign and What arrived first, calls open masked wire details, and documents are one shelf (boards VF-01 to VF-H). **Built so far (#6130):** part 1 split the page into section files with section links (D6130); part 2 builds the first screen by standing, VF-01 to VF-05, VF-15 and VF-16A, with What is due, What to sign (the booklet from `GET /api/fund-booklets/mine`) and What arrived (notices from `GET /api/fund-notices/mine`, statements and reports from the portal) first for a committed LP, and the sections ordered by standing (D6130-p2). Left: the combined documents shelf and the dated history (VF-08, VF-12, VF-17A/B/E), the call sheet (VF-07). |

backend:
- `admin_lp_applications.ts`
- `capital.ts`
- `fund_booklets.ts`
- `fund_notices.ts`
- `funds.ts`
- `lp_reports.ts`
- `messages.ts`
- `spinout_lab.ts`
