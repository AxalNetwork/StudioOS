### Calendar staff scopes: each item's owner, company, studio and link (C1, #4196, part of D4154)

`GET /api/calendar/events?scope=studio|all` (D1206, already mounted; `routes/calendar.ts` → `services/calendar.ts` `fetchCalendarScope`, facts in `services/calendar/scopeFacts.ts`). No new route, no migration.
- Each scoped item also carries `owner: { uid, name } | null` (the organiser, founder, booker, registrant, host, the prospect event's author or the deadline's owner; a name, never an email), `company: { uid, name } | null` (`projects.company_id` → `company_profiles`, through the deal for an IC meeting), `where` ("Northwind Labs › Build › Compliance", null without a company) and `open_href` (the item's page in its company, or null).
- `scope=all` adds `studio: { code: 'hq', name: 'HQ-held' }` to every row: that scope reads HQ's D1 alone, and remote studios stay Not read here yet.
- `can` stays all false and `href` null; a branch admin still gets 403 on `scope=all`. Companies are one batched lookup per read; a failed lookup leaves `company` and `where` null and the read still answers.
- Agent runs are not a calendar kind on main yet (#3957), so no staff-scope item has an agent owner.
