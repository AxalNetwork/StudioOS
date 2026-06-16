# Event Management System — Design Spec

> **One-line:** A full hostable/invitable event system with an **admin publish
> gate over everything public**, founder-driven personal + landing-page invites
> to Spin-Out demo days, **automatic free seats for official partners and
> invested LPs**, capacity caps with waitlists, QR check-in, and a **public
> event calendar** on the marketing site.

Authoritative design. Paired with:
- **Schema** — `cloudflare-worker/sql/migrations/109_events_core.sql`.
- **Build prompts** — `design/REPLIT_PROMPTS.md` (Phases E1–E4).

---

## 0. What exists vs. what this adds

The platform already has several *calendar-ish* surfaces — none of them is an
event system:

| Existing | What it is | Why it's not this |
|---|---|---|
| `calendar_events` (062) | External Google/MS/Calendly sync | Read-only mirror of a user's own calendar |
| `ic_meetings` | Investment-committee meetings | Internal, fixed attendee list, no RSVP/public |
| `mentor_bookings` / `partner_oh_slots` | 1:1 office-hours slots | Bookings, not events; no invites/capacity/public |
| `compliance_events` | Obligation calendar | Deadlines, not gatherings |
| `demo_requests` (054) | Marketing "request a demo" leads | A lead form, not an event |

**This system adds:** a first-class `events` record with **visibility +
status + an admin publish gate**, an **invitation** model (personal & comp),
a **registration roster** with **capacity caps + waitlists**, **QR check-in**,
and a **public calendar page**.

---

## 1. Core concepts

### Event
A hostable gathering: `type` (demo_day · pitch · webinar · workshop ·
networking · ama · launch · office_hours · custom), schedule + timezone,
`location_kind` (virtual · physical · hybrid), cover image, agenda, optional
`project_id` (demo-day cohort link), optional `price_cents` (default **free**),
and a `capacity` (NULL = unlimited).

### Visibility × Status — admin owns what goes public
This is the heart of the spec: **admin has full control over what goes public.**

| `visibility` | Listed on public calendar? | Who can see/register | Needs admin approval to publish? |
|---|---|---|---|
| `public` | **Yes** (once `admin_published=1`) | Anyone | **Yes** — `draft → pending_review → published` |
| `unlisted` | No | Anyone with the link | No (host self-publishes) |
| `private` | No | Invitees only | No (host self-publishes to invitees) |

```
 Founder/Partner creates ─▶ draft
        │                     │ wants it PUBLIC
        │                     ▼
        │              pending_review ──▶ (admin) published ──▶ shows on /events
        │  PRIVATE / UNLISTED
        └──────────────────────────────▶ published (to invitees / link only)
```

- A public listing **only** appears when `visibility='public' AND
  status='published' AND admin_published=1`.
- **Admin can publish, unpublish, feature, edit, cap, or cancel ANY event**,
  and every moderation action writes an `admin_audit_log` row
  (`report_type='events'`). Admins can also create official Axal public events
  directly (`host_user_id = NULL` ⇒ Axal-hosted).
- A founder can run a **private investor showcase** for their own demo day and
  self-publish it to their invitees **without** it ever touching the public
  calendar — admin still retains moderation.

---

## 2. Invitations

Two paths, plus two automatic comp paths.

### 2a. Personal invites (founder → people they know)
Host selects from their **network/connections** (co-founder connections,
matched investors/partners, prior attendees) **or** pastes emails, adds a
personal message, and sends. Each invite mints a unique `token` →
`/invite/:token` RSVP link, tracked through
`sent → opened → accepted/declined`. This is how a founder invites **the
investors, partners, and clients they know** to their Spin-Out demo day.

### 2b. Landing-page / public registration
For `public` or `unlisted` events, a public form at `/events/:slug` lets anyone
(or anyone with the link) register — subject to capacity & approval. A founder
can share that link directly to pull in clients/investors. Turnstile-gated like
the existing contact / demo-request forms. External registrants can be created
as `pending` users / waitlist (reuse `waitlist_audience`, 081).

### 2c. Official partners — exclusive free invites
Events can flag partner eligibility in `audience_rules_json`
(e.g. `{"partner_official": true, "comp": true}`). The route layer resolves
**verified/official partners** (`partners.kyb_status='verified'` /
official flag) and **auto-mints comp invitations** (`source='auto_partner'`,
`comp=1`) that waive any ticket price. They receive it in their inbox.

### 2d. LPs who invested — auto invites
Likewise `{"lp_invested": true, "comp": true}` resolves **LPs with
`limited_partners.invested_amount > 0`** (and/or investors with committed
capital) and auto-mints comp invitations (`source='auto_lp'`). Investing LPs
get exclusive free access to eligible events.

> **Eligibility engine.** `audience_rules_json` is a small declarative rule set
> evaluated by `services/eventAudience.ts`. Supported principals: `role:*`,
> `partner_official`, `lp_invested`, `project_founder` (founders of a cohort),
> `connection_of_host`. Each rule can carry `comp: true` to grant a free seat.

---

## 3. Capacity caps & waitlists

- `events.capacity` (NULL = unlimited) caps **confirmed** seats.
- Registrations past the cap become `status='waitlisted'` with a
  `waitlist_position` (only when `waitlist_enabled=1`; otherwise registration is
  rejected as full).
- On a cancellation, the earliest waitlisted registrant **auto-promotes** to
  `confirmed` and is notified.
- `approval_required=1` makes every registrant land `pending` until the host
  approves (then `confirmed`, capacity permitting).
- Host/admin can override capacity and force-confirm.
- The seat math counts `confirmed` + `approved` + `attended`; the route returns
  `seats_taken / capacity / waitlist_count` for the UI.

---

## 4. Demo Day specifics

`type='demo_day'` events tie into the existing Spin-Out pipeline:

- Link the cohort via `events.project_id` / `event_agenda.project_id` (pitch
  slots per startup).
- Founders presenting get a **Demo Day Presenter** badge (gamification
  cross-link, `badge_catalog`).
- There can be **(a)** an Axal-wide **public** demo day (admin-hosted, promotes
  the platform) and **(b)** per-founder **private** investor showcases (founder
  invites their known investors/partners/clients).
- Attendee profiles can surface the player's **archetype card** (from the
  assessment system) so investors↔founders networking is warmer.

---

## 5. Check-in & attendance

- Every confirmed registration carries a `ticket_code` → rendered as a **QR**
  (the `qrcode` dep is already in `package.json`).
- Host opens a **check-in scanner** (device camera) at `/events/:id/manage` →
  `GET /api/events/:id/checkin/:code` flips the registration to `attended` and
  stamps `checked_in_at`.
- Attendance feeds engagement badges (**Networker** = 5 check-ins, **Founding
  Attendee** = early public-event attendee) and post-event follow-up.

---

## 6. Notifications

Reuse the notification stack — `notifications_inbox`, `notification_outbox`,
email (Gmail), push (VAPID), and the invite-reminder patterns already in the
repo (`046_invite_reminders`, `047_invite_joined_notified`):

- **Invite received** (in-app + email with the RSVP link + `.ics`).
- **Reminders** (T-24h / T-1h) via the cron drain on `notification_outbox`.
- **Waitlist promoted** ("a seat opened — you're in").
- **Event updated / cancelled.**
- **Post-event** follow-up (recording, "connect with attendees").

Every registration/invite can attach an **`.ics`** so it lands in the
attendee's real calendar.

---

## 7. Data model

Defined in migration **109_events_core.sql**. Tables:
`events` · `event_hosts` (co-hosts/speakers) · `event_agenda` (programme /
pitch slots) · `event_invitations` (personal + comp) · `event_registrations`
(roster, capacity, QR, `attended`). Full DDL + column docs in the migration.

> **Migration hygiene (GOTCHAS):** additive-only, `IF NOT EXISTS`; carry a lazy
> bootstrap `ensureEventsSchema()` so the routes self-heal before the migration
> is applied. No `ALTER TABLE users`. Reuse `admin_audit_log` for moderation
> rather than a new audit table.

---

## 8. API surface (worker-first)

All under `cloudflare-worker/src/routes/`. Every `api.js` method needs a
matching route (`npm run test:drift`).

### `routes/events_public.ts` (NO auth — public marketing surface)
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/public/events` | Published public events (calendar feed) + filters |
| GET | `/api/public/events/:slug` | Public event detail |
| POST | `/api/public/events/:slug/register` | Landing-page registration (Turnstile, capacity/approval aware) |
| GET | `/api/public/events.ics` | Public calendar ICS feed |
| GET | `/api/public/invite/:token` | Resolve a personal invite (event + RSVP) |
| POST | `/api/public/invite/:token/respond` | RSVP accept/decline (no login) |

### `routes/events.ts` (auth'd — host/founder/partner/attendee)
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/events` | My events (hosting) + events I'm invited/registered to |
| POST | `/api/events` | Create event |
| GET/PUT/DELETE | `/api/events/:id` | Read / edit / cancel |
| POST | `/api/events/:id/submit-for-review` | Request a public listing |
| POST | `/api/events/:id/invitations` | Send personal invites (network picker or emails) |
| GET | `/api/events/:id/registrations` | Host roster |
| POST | `/api/events/:id/registrations/:rid/(approve\|decline\|promote\|checkin)` | Manage seats |
| POST | `/api/events/:id/register` | Authed self-register (comp auto-applied if eligible) |
| GET | `/api/events/:id/eligibility` | Am I comp-eligible (partner_official / lp_invested)? |
| GET | `/api/events/:id/export` | CSV roster |
| GET | `/api/events/:id/event.ics` | This event's ICS |

### `routes/admin_events.ts` (admin — mount **before** `/api/admin`)
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/admin/events` | All events + the **pending-review queue** |
| POST | `/api/admin/events` | Create an official Axal public event |
| PUT | `/api/admin/events/:id` | Edit any event; set/override capacity |
| POST | `/api/admin/events/:id/(publish\|unpublish\|feature\|approve\|reject\|cancel)` | Full public-visibility control (+ `admin_audit_log`) |
| GET | `/api/admin/events/analytics` | Registrations, attendance, capacity utilisation, conversion |

> **Mount precedence:** register `/api/admin/events` **before** the catch-all
> `/api/admin` (same rule as telegram/x/news). The public router is mounted
> outside any auth/tier middleware (it serves anonymous traffic).

### Paid tickets (optional)
If `price_cents > 0`, reuse the embedded Stripe PaymentIntent flow with
`metadata.kind='event_ticket'`; fulfil in the `payment_intent.succeeded`
webhook (mark registration `confirmed`, stamp `payment_intent_id`). Comp invites
(partners/LPs/VIP) skip payment entirely. **Default is free** — paid is opt-in.

---

## 9. Public calendar & routing

`/events` (list/calendar) and `/events/:slug` (detail) are **public**. Per
`replit.md`, app-owned public pages are **apex-routed** and the SPA is the
public surface. Adding `/events` means adding **two** patterns (exact + `/*`)
to `[[env.production.routes]]` in `wrangler.toml` so Jekyll keeps the rest:

```
{ pattern = "axal.vc/events",   zone_name = "axal.vc" },
{ pattern = "axal.vc/events/*", zone_name = "axal.vc" },
```

(and `/invite/*` likewise for the RSVP link). **Routes only take effect on
`npm run deploy`** — flag this as an ops step in the PR. The public calendar
reads only `visibility='public' AND status='published' AND admin_published=1`.

---

## 10. Frontend

| Route | Component | Audience | Notes |
|---|---|---|---|
| `/events` | `PublicEventsPage` | Public | Calendar/list, filters, ICS, "Add to calendar", register CTA |
| `/events/:slug` | `EventDetailPage` | Public | Detail + register form (capacity/approval aware) |
| `/invite/:token` | `InviteRsvpPage` | Public | RSVP accept/decline, add-to-calendar |
| `/my/events` | `MyEventsPage` | Auth | Hosting + attending; tickets/QR |
| `/events/new`, `/events/:id/edit` | `EventEditorPage` | Host | Visibility, capacity, audience rules, submit-for-review |
| `/events/:id/manage` | `EventManagePage` | Host | Roster, approve/waitlist, **QR check-in scanner**, send invites |
| `/admin/events` | `AdminEventsPage` | Admin | Review queue, publish/feature/cancel, capacity override, analytics |

- **Invite modal** (`InvitePeopleModal`): pick from network/connections or
  paste emails + a personal message; shows comp badges for eligible
  partners/LPs.
- Reuse `useToast`, `useEscapeClose`, `PageExplainer`, `qrcode`. Add `dark:`
  variants on all new components.
- Add an **Events** entry to `sidebarConfig.js` per role, plus a public nav
  link on the landing page.
- Cross-link **demo-day** events from project / Spin-Out Lab pages.

---

## 11. Build phases

See `design/REPLIT_PROMPTS.md` Phases **E1–E4**:
- **E1** — apply 109; worker `routes/events.ts` + `events_public.ts` + `admin_events.ts`, `services/eventsSchema.ts`, `services/eventAudience.ts`; `api.js`; drift green.
- **E2** — host UX: create/edit/manage, invites, roster, QR check-in.
- **E3** — public surface: `/events` calendar + detail + RSVP; `wrangler.toml` apex routes; ICS.
- **E4** — admin moderation queue + analytics; comp-eligibility automation; reminders via outbox; (optional) paid tickets.
