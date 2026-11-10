# Learning curriculum coverage (#4650, part 4)

**Date:** 2026-11-10.
**Commit:** written on `origin/main` at `a3829a2a`, with D4650 part 4.
**Scope:** how far the course catalogue covers the founder, investor, advisor and partner journeys.
**Status:** a dated snapshot of *how to read* the record, not of the record itself. Not maintained afterwards (see `documentation/audits/README.md`).

## The finding: coverage is unknown

No agent read the production catalogue for this audit. The owner chose this on 2026-11-10 (option C on #4650): part 4 ships as code only, and no agent reads production D1, not even the course titles.

So this file records **no figure for any journey**. Coverage is unknown until a Super Admin opens the record. Nothing here says that a journey has material, or that it has none.

## Where the record is

- **In the app:** the Learning studio (`/learning/studio`), under the content table, in the section "Curriculum coverage".
- **The route:** `GET /api/admin/learning/coverage`. It is for the Super Admin only, like every other studio route.
- **The code:** `cloudflare-worker/src/services/learningCoverage.ts`.

It is computed each time the record is opened, from the live catalogue. Nothing is stored, so it is never stale.

## What it reads

For each course in `learning_courses`, it reads:

- the title and slug;
- the status: draft, published or archived;
- the visibility: open, or program members only;
- part 2's audience (`audience_json`) and stage.

It reads no learner's progress, enrolment, plan, attempt or submission.

## How to read it

Each journey gets one of four states.

| State | What it means | What to do |
|---|---|---|
| **Published** | At least one published course, open to members, names this journey as its audience. | The journey has material. The stages of those courses are listed, and so is the number with no stage recorded. |
| **Not reachable** | Courses name the journey, but no member can reach any of them. Each one is a draft, archived, or for program members only, and the reason is shown beside it. | Publish a course, or open one to every member, if that is intended. |
| **Unknown** | No course names this journey, but some courses record no audience, so they may serve it. | Fill in "Who it is for" in each listed course's "About this course". |
| **Missing** | Every course records its audience, and none names this journey. | This is a real gap in the catalogue. |

### The rules that keep it honest

- **A course with no audience is never counted as missing material.** It makes every journey it could serve Unknown. The number of such courses is shown on each row and is never shown as 0 when there are some.
- **Unknown can outrank Not reachable.** A published, open course with no audience could be the journey's published material. So the journey reads Unknown, not Not reachable.
- **Before the audience column existed,** that is, before migration `202611071012`, every journey reads Unknown. A note says so.
- **A catalogue larger than one read** (5,000 courses) never calls a journey Missing, and a note says so.
- **A failed read is Unreadable,** with the line "This is not a claim that any journey has no material." It is never shown as an empty catalogue or as four Missing journeys.
- **An empty catalogue,** with no courses at all, says so in one sentence. Every journey then has no material.

## What this does not check

- **Standalone videos and readings, programs, webinars, exercises and exams.** None of them records an audience, so the record covers courses only. A journey served only by a standalone video reads by its courses.
- **Whether a course's content actually suits its stated audience.** The record trusts what the author filled in.
- **Any intended syllabus per journey.** No such list is stored. "Missing" means no course names the journey, not that a particular topic is absent.
