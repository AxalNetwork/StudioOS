| Founder Studio | founder | `/studio` | `/studio` (Dashboard → `FounderStudioHome`) | {backend} | UPGRADE | **2026-10-06 (D564, #1168): built.** The owner on #974: no separate home, so `/studio` is the founder's one front door, and its body is this canvas. The 69dc42f3 card body is retired; Eadwyn (`StudioInterview`, D324) stays. Each zone reads its own store and fails on its own (`founderStudioModel.js`): header, summary strip, Do these next (lifecycle checklist order), Company progress (Lab weeks, deliverables and gate), Advisor questions, Activity (last 7 days), Module map (Active or Locked), founder profile (profiling completion, archetype under D594's lock, per-section confidence). Holding progress and What this adds up to have no store and say so; each action's unlocks, each activity's feeds and each module's percent are not drawn. The canvas is in `integrated/`. The sidebar's Home group label is gone for founder, investor and advisor. **2026-11-27 (D8729 part 2, #8729): the active venture first.** Built to `Studio Home Founder Page.dc.html` with the owner's option A on Q1 to Q3: the venture is the h1 on both widths (the phone's Eadwyn bar is no longer a heading), a Next card lists the placed modules' `card.next` in layout order with one primary task, Eadwyn follows (a collapsed row on the phone), task and tile links carry `?project_id=` and return to Studio with focus kept, the venture resolves address → switcher pick → only venture → ask, and first, unavailable, chooser and unreadable paths are separate. |

backend:
- `activity.ts`
- `advisor.ts`
- `best_fit.ts`
- `progress.ts`
- `projects.ts`
- `scoring.ts`
- `spinout_lab.ts`
