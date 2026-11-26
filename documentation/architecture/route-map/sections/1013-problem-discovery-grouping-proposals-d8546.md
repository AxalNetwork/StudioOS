### Problem discovery grouping proposals (#8546, D8546)

Part of #6006. Backs the "Proposed grouping" card of the Validate v2 Discovery canvas (D5995, V17 and V29). No page and no client method yet: the card and the producer that proposes groupings stay on #6006. `routes/pain_grouping_proposals.ts` mounts at `/api/progress/pain-grouping-proposals`; venture writers only, a reader or partner is refused with no payload. There is no route that stores a proposal: `proposeGrouping` in `services/painGroupingProposals.ts` is the typed ingress for the later producer.

| Route | Purpose |
| --- | --- |
| `GET /:projectId` | The venture's pending proposals (`?status=all`), each member with its sources and whether that interview agreed to be quoted |
| `PATCH /:projectId/:id` | Edit a pending proposal's members, or its title when it proposes a new theme; the original stays as proposed |
| `POST /:projectId/:id/discard` | Discard; status only |
| `POST /:projectId/:id/accept` | Accept the whole set as one decision: the same alias write and activity row as `POST /api/progress/pain-groups/:projectId/assign-many`, or nothing |
