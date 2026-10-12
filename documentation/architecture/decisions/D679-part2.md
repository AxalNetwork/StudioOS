### Part 2: Programs & Events, Circles, Jobs, the application gate

Issue: #1553 (second half). Source: `design/canvases/integrated/Axal VC Website.dc.html`, views PROGRAMS & EVENTS, COMMUNITIES & CIRCLES, JOBS, JOB DETAIL and REGISTRATION GATE. S1 merges this file into `D679.md`.

#### What was built

Each page was rebuilt in its existing file. Each one renders in `SitePage` and opens with `NetworkSubNav`. The styles are in `frontend/src/pages/site/network2.css` (`ax-n2-*`). The owner's copy and the pure row helpers are in `frontend/src/lib/siteNetwork2.js`.

- **`/events` (`pages/events/PublicEventsPage.jsx`)** follows PROGRAMS & EVENTS:
  - "Calendar / Programs & Events", the lede, and the existing "Add to calendar" link to the `.ics` feed;
  - a Programs row with one card, the Spin-Out Lab's open cohort;
  - "Upcoming events" (or "Past events"), with the same filters as before (Upcoming/Past, search, type, format, from and to), then rows grouped by month.
  - Each row shows the day and month in the event's own zone (`events.timezone`), the title, a type chip, the summary, the format and place, the time with its zone named, the price or Free, and "Register" or "View details" linking to the event's page.
- **`/circles` (`pages/CirclesPage.jsx`)** follows COMMUNITIES & CIRCLES:
  - "Peer groups / Communities & Circles", the lede, and the page's existing "Join the network" and "Create a circle" entry points;
  - the existing filters (type pills, search, access, region);
  - two-column cards, each with the type icon, the name, "type · region", an access chip, the tagline, the member count, and Join or Request access.
- **`/jobs` (`pages/jobs/PublicJobsPage.jsx`)** follows JOBS:
  - "Portfolio hiring / Jobs" and the lede;
  - the employment-type pills, plus the existing search, level and remote filters;
  - rows with the company's initials, the title, "company · level", a type chip, the place, and "View role";
  - the "Hiring for a portfolio company? / Post a role →" band.
- **`/jobs/:slug` (`pages/jobs/PublicJobDetailPage.jsx`)** follows JOB DETAIL:
  - "← All roles";
  - the header: initials, type chip, posted date, h1, and "company · place";
  - the facts grid, the summary as the intro, and the description as sections;
  - the side card: "Apply for this role", "Apply now →" and the meta rows;
  - "Other roles at {company}".
- **The REGISTRATION GATE is a two-step sheet on the job page.** It opens from "Apply now", is a labelled modal dialog, closes on Escape or a click outside, keeps Tab inside, and gives focus back to the button.

#### The decisions

- **The gate keeps the existing order: the application first, the account second.**
  - The canvas registers first, then applies. The existing signup cannot be run safely from a sheet:
    - it has no password: `/register` emails a sign-in link, and the account cannot sign in until that link is opened;
    - it is Turnstile-gated;
    - the apply route is Turnstile-gated too, and a token is single-use, so one sheet would need two challenges.
  - So **step 1** is the existing public application: the same fields, the same Turnstile gate, and the same `jobsPublic.apply` call (`POST /api/public/jobs/:slug/apply`) as before. No account is needed.
  - **Step 2** confirms the application and hands over to the existing flow, as the page did before:
    - to `/register?email=…&intent=job-application`;
    - or to `/login?email=…` when the apply route says the address already has an account (`has_account`).
  - The application is linked to the account by email (`jobs.ts`'s `/my-applications` backfill).
  - The sheet never calls `/auth/*`. No auth, verification or Turnstile step is skipped or weakened.
  - **A signed-in member** has their name and email filled in. Step 2 points them to `/my/applications`, not to sign-in. The canvas's "a signed-in member skips step 1" cannot apply here, because step 1 is the application itself.
  - **The hand-off waits 6 seconds,** not the old 2.5, so step 2's next steps can be read. Closing the sheet cancels it.
  - Step 1 ends with the canvas's "Already have an account? Sign in", linking to `/login?next=/jobs/:slug`.
- **The Programs row reads the open cohort, as the landing page's cohort strip does:**
  - the cohort number and start date come from `openCohortCopy()`;
  - the duration is `COHORT_WEEKS * 7` days;
  - the places come from `useCohortPlaces()`, drawn only once read;
  - the CTA "Apply to Cohort N" goes to `/spinout-lab/apply`.
- **Each row reads its time in the event's zone,** and the month grouping uses that zone too. Before, the old page used the viewer's zone for both.
- **The job filters are the posting's `employment_type`** (Full-time, Part-time, Internship, Contract), the Worker's `EMPLOYMENT_TYPES`. The canvas's Engineering, Go-to-market and Operations name a field no posting has.
- **"Post a role →" goes to `/jobs/new`.** That is the guarded job editor, which the founder workspace's own "Post a role" opens. The old Jobs page had no link to post a role.
- **"Other roles at {company}"** is the public feed searched by the company's name and kept to the same `project_id`. If that read fails, the card is not drawn. A role with no company (an admin's firm role) gets no card.
- **A circle's Join and Request access go where they went before:** `/register?intent=circle&circle=…`.
- **The Turnstile site key is read as `import.meta.env && import.meta.env.VITE_TURNSTILE_SITE_KEY`,** as `lib/log.js` reads `DEV`. This lets the test import the page.

#### What was dropped, and why

- **The Programs cards with no live source:**
  - "Advisor cohort intake": its review time, commitment and equity are invented;
  - "Fund I · LP onboarding": its target, minimum, committed and first close are invented. This card waits on D677's Fund I answer.
  - The old page's curated programme list (`PROGRAMS` in `data/network.js`) is invented too: office hours "every Tuesday · 10:00 PT", and so on. It is no longer drawn, and its audience, format and category filters go with it. `data/network.js` is untouched: `PROGRAMS`, `PROGRAM_CATEGORIES` and `AUDIENCES` now have no reader, for S1 to remove.
- **Fields the reads do not return:**
  - from a circle card: the cadence and the seats chip;
  - from a job: the stage, compensation, "reports to", start date, the "About {company}" paragraph, and the company figures (readiness score, interviews, revenue).
  - Circle cards also stop drawing tags, event and thread counts and the activity dot, which the canvas does not show. Search still covers tags.
- **Sentences the code cannot back:**
  - Events lede: "Everything here is scheduled around the 28-day program cycle." Members host events on any date.
  - Jobs band: "Listings reach the full partner network." Nothing distributes a listing.
  - Job side card: "An Axal VC account is required so your profile, skills, and prior applications travel with you." Also the lock line "Requires a free Axal VC account". Applying needs no account.
  - Gate step 1: "Register to apply" and its copy about a skills assessment and verified candidates. Also the password field and the terms box, since the sheet does not register anyone. The terms are accepted on `/register`.
  - Gate step 2:
    - "Account created" became "Application sent";
    - "You will hear back within five business days" is gone;
    - next step 02, "an intro call within five business days", is gone;
    - next step 03, "the optional skills assessment strengthens future applications", is gone: applicants are never read with assessment results.
  - Old circles page: "request access and a host will review" and "we'll let you know when one fits". No review and no notification exist.
  - Old jobs page: "new roles are posted regularly".
- **The old Circles hero figures** (circle, member and type counts) and the "how circles connect" cards are not in the canvas.

#### For the owner

- **The Circles lede is kept as the owner wrote it,** but the code does not model it:
  - circles store no cadence and no cap;
  - an admin can publish a `public` circle, which the page labels "Public".
  - It matches the landing page's line (D674). Cut it if it should be true of the code.
- **"Every listing is posted directly by the hiring founder"** holds for company roles: a non-admin must attach a project they own or co-found. Firm roles are posted by an admin, and every listing passes admin review first.

#### Guards

`frontend/test/network_events_jobs_d679.test.mjs` pins:
- the sub-nav opening each page;
- no canvas sample event, circle, job, company, person or programme fact in source, and no promise the code does not keep;
- every list being a live read;
- the Programs row being the Lab card alone, read from `openCohortCopy`, `useCohortPlaces` and `COHORT_WEEKS`;
- event dates in the event's zone;
- circle cards without cadence or seats;
- the job pills being the Worker's employment types;
- a job drawing only returned fields;
- the gate posting to `jobsPublic.apply` behind Turnstile, never calling `/auth/*`, and handing over to `/register`, `/login` or `/my/applications`.

The existing `public_events_feed`, `event_types_parity`, `honesty_sweep_d332` and `code_through_message_d258` tests stay green unchanged.
