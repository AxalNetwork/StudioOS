# Event System — Design Spec

> Source of truth for the event build phases (Prompt 0 + E1–E4). The backend
> (E1) and frontend (E2/E3) and admin (E4) cite the section numbers in this
> document verbatim — **do not renumber sections**. Schema:
> `cloudflare-worker/sql/migrations/109_events_core.sql`. Reuses existing
> systems: notifications (`notifications_inbox` / `notification_outbox` via
> `services/notify.ts`), the Stripe PaymentIntent flow, `admin_audit_log`,
> partners / `limited_partners` / `investor_profiles` for comp eligibility, and
> Turnstile for anonymous writes.

---

## §1 Visibility, status & the publish gate

Three independent fields on `events` govern who can see an event:

| Field | Values | Meaning |
|---|---|---|
| `visibility` | `public` \| `unlisted` \| `private` | Who is *allowed* to discover it. |
| `status` | `draft` \| `pending_review` \| `published` \| `cancelled` | Lifecycle state. |
| `admin_published` | `0` \| `1` | The **admin gate** — only an admin can set this to 1. |

### 1.1 The publish gate

An event appears on the **public calendar** (`/events`, `GET /api/public/events`)
**only when all three hold**:

```
visibility = 'public' AND status = 'published' AND admin_published = 1
```

This is the single canonical predicate (indexed by `idx_events_public_feed`).
The public feed query MUST use exactly this; never surface `pending_review`,
`draft`, `cancelled`, `private`, or `unlisted` events.

### 1.2 Who can publish what

- **`private` / `unlisted`** events **self-publish**: the host sets
  `status='published'` directly; `admin_published` stays `0`. They never hit the
  public feed — reachable only by direct slug link (`unlisted`) or invitation
  token (`private`).
- **`public`** events go through **review**: a founder choosing "publish public"
  sets `status='pending_review'` (NOT published). An admin **approve**
  transitions to `status='published'` AND `admin_published=1`. Admin
  **reject** returns to `draft` (with a reason). This prevents an unvetted
  founder event from appearing on the public Axal calendar.
- **Official Axal events** created by an admin can be published + admin_published
  in one step.
- `cancelled` is terminal for visibility (hidden from the feed; existing
  registrants are notified, §6).

Every admin transition (approve/reject/publish/unpublish/feature/cancel/capacity
override) writes `admin_audit_log` with `report_type='events'`.

---

## §2 Invitations

`event_invitations` is one row per invited principal. Exactly one of
`invited_user_id` / `invited_email` identifies the recipient; `token` is the
opaque RSVP key used by the public `/invite/:token` routes.

- **`source`**: `manual` (host picked from network/connections or pasted
  emails), `auto_partner` / `auto_lp` (comp invites auto-minted by the audience
  engine, §7).
- **`comp`**: `1` = a free seat (skips payment, §4.4).
- **`status`**: `pending → accepted | declined`, or `revoked` by the host.
- **`personal_message`**: optional note shown in the invite + email.

### 2.1 Invite flows

- **Host invites** (auth'd, §8): `POST /api/events/:id/invitations` with either a
  list of network/connection user ids or pasted emails + an optional message.
  In-app recipients also get a `notifications_inbox` entry (§6); email recipients
  get an email with the `.ics` attached.
- **RSVP** (public, §8): `GET /api/public/invite/:token` returns the event +
  invite; `POST /api/public/invite/:token/respond` accepts/declines. Accepting
  creates an `event_registrations` row (comp/capacity/approval aware, §3/§4).
- Comp invites are auto-minted on publish (§7) and surface in the recipient's
  inbox.

---

## §3 Capacity & waitlist

Seat math lives in `services/eventCapacity.ts` (E1). A seat is held by an
`event_registrations` row in status `registered` or `confirmed` (and `attended`).

- **`capacity` NULL** = unlimited (no waitlist needed).
- **seats_taken** = count of registrations in {registered, confirmed, attended}.
- When `seats_taken >= capacity`:
  - if `waitlist_enabled=1` → the new registration is `waitlisted` with the next
    `waitlist_position` (monotonic per event);
  - else → registration is refused (full).
- **Auto-promotion**: when a seat frees (a cancel, or admin capacity increase),
  promote the lowest `waitlist_position` to `registered` (or `confirmed` if no
  approval / already comp), clear its `waitlist_position`, and notify the
  promoted attendee (§6). Promotion is transactional to avoid double-allocating
  the freed seat.
- **`approval_required=1`**: registrations land as `registered` (pending host
  action) and only become `confirmed` on host approve; a decline sets
  `declined`. Approval gating composes with capacity (an approved registrant
  still needs a free seat, else waitlists).

---

## §4 Registration, approval, check-in & tickets

### 4.1 Registration states (`event_registrations.status`)

`registered` (holds a seat / pending approval) → `confirmed` (approved &
seated) → `attended` (checked in). Side states: `waitlisted`, `cancelled`,
`declined`. `UNIQUE(event_id,user_id)` and `UNIQUE(event_id,email)` keep one
registration per principal (re-register = upsert/reactivate).

### 4.2 Approval

When `approval_required=1`, the host approves/declines from the roster
(EventManagePage, §10). Approve → `confirmed` (capacity permitting, else
`waitlisted`); decline → `declined`.

### 4.3 Check-in

Each seated registration has an `event_checkins` row carrying a unique `code`
(the QR payload). The host's QR scanner hits
`POST /api/events/:id/checkin/:code` → sets the registration `attended` and
stamps `checked_in_at` / `checked_in_by`. Re-scanning is idempotent.

### 4.4 Tickets (paid events — optional)

`price_cents > 0` means a paid ticket. Registration creates an embedded **Stripe
PaymentIntent** with `metadata.kind='event_ticket'`; the existing
`payment_intent.succeeded` webhook marks the registration `payment_status='paid'`
and `confirmed`. `price_cents=0` (default) is free. **Comp** invites/registrations
(`comp=1`, §7) skip payment entirely. `amount_cents` records what was charged.

---

## §5 Admin moderation & official events

Spec for Prompt E4 admin surface. `/api/admin/events` (`requireAdmin`), mounted
**BEFORE** the catch-all `/api/admin`.

- **Review queue**: list `status='pending_review'` public events; **approve**
  (→ published + admin_published=1) / **reject** (→ draft + reason).
- **Lifecycle**: publish/unpublish, **feature** (`featured=1`), **cancel**
  (notifies registrants, §6), **capacity override** (triggers waitlist
  promotion, §3).
- **Official events**: create Axal-hosted events (`host_user_id` NULL) and
  publish in one step.
- **Analytics** (recharts): registrations, attendance, capacity utilisation,
  conversion (views → registrations → attended) per event and across the
  calendar.
- Every mutating admin action writes `admin_audit_log` with
  `report_type='events'`.

---

## §6 Reminders & lifecycle notifications

All async messaging goes through the existing pipeline — `notify(env, args)`
(`services/notify.ts`) writing `notifications_inbox` (the bell) and queuing
`notification_outbox`, drained by the existing cron in `index.ts`
`scheduled()`. **Do not** build a parallel mailer.

Enqueue on:

- **Invite sent** → recipient inbox + email (with `.ics` attached).
- **T-24h** and **T-1h** reminders to confirmed/registered attendees.
- **Waitlist promotion** → the promoted attendee.
- **Approval / decline** → the registrant.
- **Cancellation** → all active registrants.

Reminders are idempotent per (event, user, kind) so a re-drained cron does not
double-send. `.ics` is generated for invites and the "Add to calendar" actions
(`GET /api/events/:id/event.ics`, `GET /api/public/events.ics`).

---

## §7 Comp eligibility engine

`services/eventAudience.ts` (E1) evaluates `events.audience_rules_json` to decide
who gets a **free seat**, then auto-mints comp `event_invitations` on publish.

### 7.1 `audience_rules_json`

A declarative rule set authored in the EventEditor "audience-rules builder"
(§10), e.g.:

```json
{
  "comp_official_partners": true,
  "comp_invested_lps": true,
  "comp_investors": false,
  "comp_host_connections": false,
  "comp_project_founders": false
}
```

### 7.2 Eligibility sources (canonical tables)

| Rule | Eligible principals | Source |
|---|---|---|
| `comp_official_partners` | partners with `status='active'` (official); KYB-verified via `corporate_profiles` when required | `partners` (+ `corporate_profiles`) |
| `comp_invested_lps` | limited partners with `invested_amount > 0` | `limited_partners` |
| `comp_investors` | users with an `investor_profiles` row (contributing to signals) | `investor_profiles` |
| `comp_project_founders` | founders of active projects | `projects` |
| `comp_host_connections` | the host's accepted connections | connections |

The engine returns the deduped set of comp-eligible principals and a helper
mints comp invitations (`source` = `auto_partner` / `auto_lp` / … , `comp=1`).
Comp registrations skip payment (§4.4) and surface in the recipient's inbox
(§6).

### 7.3 When it runs

On **publish** (E4 comp automation) and on demand from the host's "send invites"
flow. Re-running is idempotent (one invitation per (event, principal); the
`token` is stable per row, not regenerated).

---

## §8 API

### 8.1 Auth'd host/attendee (`/api/events`, `requireAuth`)

| Method & path | Purpose |
|---|---|
| `GET /` | The caller's events (hosting + attending). |
| `POST /` | Create an event (host). |
| `GET /:id` / `PATCH /:id` | Read / edit (host or admin). |
| `POST /:id/submit-review` | Founder "publish public" → `pending_review`. |
| `POST /:id/invitations` | Invite from network/connections or emails. |
| `GET /:id/roster` | Registrations + invitations (host). |
| `POST /:id/registrations/:rid/(approve\|decline\|promote)` | Roster management. |
| `POST /:id/register` | Register the caller (comp auto-applied via §7; capacity/approval aware). |
| `GET /:id/eligibility` | Whether the caller is comp-eligible + price. |
| `POST /:id/checkin/:code` | QR check-in → `attended`. |
| `GET /:id/event.ics` | Calendar file for this event. |
| `GET /:id/export` | CSV roster export (host). |

### 8.2 Public, no auth (`/api/public/events`) — mounted OUTSIDE auth/tier middleware

| Method & path | Purpose |
|---|---|
| `GET /api/public/events` | Published-public feed (the §1.1 predicate), filters. |
| `GET /api/public/events/:slug` | Public event detail. |
| `POST /api/public/events/:slug/register` | Register (Turnstile-gated; capacity/approval aware). |
| `GET /api/public/events.ics` | Calendar of public events. |
| `GET /api/public/invite/:token` | Invite + event for an RSVP link. |
| `POST /api/public/invite/:token/respond` | Accept / decline an invite (Turnstile-gated). |

Anonymous write routes (`/register`, `/respond`) are gated with **Turnstile**,
mirroring the contact form.

### 8.3 Admin (`/api/admin/events`, `requireAdmin`, mounted BEFORE `/api/admin`)

Review queue, official-event create, edit/override capacity,
publish/unpublish/feature/approve/reject/cancel (each → `admin_audit_log`
`report_type='events'`), analytics. See §5.

Every `frontend/src/lib/api.js` `events.*` method maps 1:1 to a route above
(drift guard).

---

## §9 Public surface

Spec for Prompt E3. Public, **no auth guard**. All components carry `dark:`
variants.

- **`/events` → PublicEventsPage**: calendar/list of published-public events
  (the §1.1 predicate), filters (type/date), "Add to calendar" (`.ics`), and a
  register CTA.
- **`/events/:slug` → EventDetailPage**: detail + registration form
  (capacity/approval aware; **Turnstile**).
- **`/invite/:token` → InviteRsvpPage**: accept/decline + add-to-calendar.
- Add an **"Events"** link to the public landing nav.

### 9.1 Routing (replit.md "Apex routing")

> **Superseded 2026-09-01.** The paragraph below was written when the apex
> was GitHub Pages/Jekyll with path-scoped Worker routes. Both hosts are
> whole-host Workers Custom Domains now: a new SPA route needs **no**
> `wrangler.toml` entry, and adding a path-scoped `axal.vc/…` route is the
> 2026-08-31 outage mechanism the guard tests refuse. Kept as history.

Add to `wrangler.toml` `[[env.production.routes]]` **BOTH** exact + `/*` patterns
for `axal.vc/events` and `axal.vc/invite` (and mirror in the **top-level**
`[[routes]]` block — the live deploy binds the top-level block) so the SPA, not
Jekyll, serves them. Routes only take effect on `npm run deploy` (an ops step;
note it in the PR). Verify the public feed excludes non-public/non-published
events.

---

## §10 Host / attendee surface

Spec for Prompt E2. Lazy routes in `App.jsx` + a `sidebarConfig.js` "Events"
entry. Reuse `qrcode`, `useToast`, `useEscapeClose`, `PageExplainer`; `dark:`
variants required.

- **`/my/events` → MyEventsPage**: hosting + attending tabs; tickets show a QR.
- **`/events/new` and `/events/:id/edit` → EventEditorPage**: title, type,
  schedule + timezone, `location_kind`, cover, capacity, waitlist,
  approval_required, visibility, and an **audience-rules builder** (toggle "free
  seats for official partners" / "for invested LPs" → `audience_rules_json`,
  §7). "Submit for review" when `visibility=public` (§1.2).
- **`/events/:id/manage` → EventManagePage**: roster
  (approve/decline/waitlist/promote), **send invites** (`InvitePeopleModal`:
  pick from network/connections OR paste emails + a personal message; show comp
  badges), and a **QR check-in scanner** (device camera →
  `/api/events/:id/checkin/:code`).

Acceptance (E2): a founder creates a private demo day, invites 3 people from
their network + 1 email, approves a registrant, and checks someone in by QR.
