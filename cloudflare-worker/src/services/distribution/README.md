# Distribution reads

Venture-scoped reads for Grow › Distribution. The existing Grow router must check project access before invoking them. Campaign provenance comes from the existing campaign reader; no second campaign store is introduced.

| File | Purpose |
| --- | --- |
| `overview.ts` | D4485: monthly KPIs, active campaign spend and the ISO-week content plan, with explicit missing/unreadable states. |
| `sequences.ts` | D4493: outreach sequences: `dueSteps` (consent, suppression, quiet hours, stop on reply or opt-out, offered channels), the signed opt-out and the D1340 send gate. Nothing sends. |
