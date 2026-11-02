## Backends that are live with no consumer

Cheap wins — the work is a UI slice, not a build:

- **Send for Signature** — `esign.ts` is complete (envelopes, tokenised signing,
  forward, reject, audit) and `api.js` exposes `esignSend`/`esignList`/
  `esignDetail`/`esignDocumentUrl`. No page calls any of them. (Task #119.)
- **409A safe harbour** — `GET/POST /captable/409a/:projectId` + `/events`, four
  `api.js` methods, zero UI on the cap-table page.
- ~~**Company members**~~ — DONE. The members UI shipped 2026-08-29 (Wave 2)
  and the invitation flow behind it 2026-09-10 (Task #121); `POST /company/create`
  is the empty-state on-ramp. See the Company Settings row above.
- **Portfolio marks / KPI compliance** — `POST /positions/:uid/marks`,
  `POST /positions/:uid/distributions`, `GET /positions/kpi-compliance`.
- **Per-LP fund report** — `GET /funds/:id/lp-report/:lpId`, the Quarterly
  Report canvas's exact data source.
- **AI spend** — `aiRouter.ts` already meters per-user daily/monthly and per-org
  caps and per-task cost, surfaced only to admins. This is the data the eight
  rail canvases want user-facing.

