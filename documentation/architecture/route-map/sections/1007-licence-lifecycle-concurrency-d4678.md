### Licence lifecycle and administrator state under concurrency (D4678, #4678)

Every move of a licence is a compare-and-swap on `territory_licences.revision` (migration 202611071540), made by `services/licenceTransitions.ts`. A move states the status and revision it read, bumps the revision in the same statement, and is followed in the same batch only by statements that depend on it applying. Exactly one changed row is a success; anything else is a stale mutation.

| Route | Who | What changed |
| --- | --- | --- |
| `POST /api/admin/licences/:uid/activate`, `/suspend`, `/reinstate`, `/renew`, `/terminate` | Super Admin (terminate: write bar) | Each takes an optional `?expected_revision=N`. A stale request answers 409 `{ error: 'licence_changed', current_status, revision }` and changes nothing. `suspend` starts only from `active`. `activate` and `reinstate` both re-check the activation prerequisites, in the blocker list (409 `blocked`) and again in the UPDATE. `terminate` releases the territory in the same batch, only if the termination applied. |
| `PUT /api/admin/licences/:uid/territories`, `/seats`, `PATCH /terms` | Super Admin | Bump the revision, so an activation decided on the old one loses. Territory and seat writes do nothing to a licence terminated since they were read. |
| `POST /api/admin/licences/:uid/notices/:noticeUid/review` | Super Admin | An accepted last holder reinstates through the same move, with the same prerequisites. |
| `POST /api/admin/licences/:uid/admins` | Super Admin with a TOTP session and a recent step-up | A licence that is `terminated` answers 409 `licence_cannot_administer` and changes neither `users.role` nor `licence_admins`. The binding, the role and both audit rows are guarded by the same predicate inside the batch: the licence can still administer users, and the account is not bound to another licence. |
| `DELETE /api/admin/licences/:uid/admins/:userId` | Super Admin with a TOTP session and a recent step-up | The "not an admin" condition is in the DELETE itself. A promotion that won the race answers 409 `still_an_admin` and leaves the binding. |

`terminated` is terminal: no move starts from it, and a trigger refuses any UPDATE of a terminated row's status. A second trigger refuses a `licence_admins` insert or update on a terminated licence. The compliance sweep (`services/complianceLadder.ts`) bumps the revision when it suspends.
