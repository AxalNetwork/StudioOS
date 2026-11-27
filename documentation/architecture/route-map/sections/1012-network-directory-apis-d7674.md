### Network directory reads, private overlays and reviewed publication (#7674)

No page or canvas is implemented here; the Network directory UI is a separate design handoff. All routes are
mounted under `/api/network/directory` (`routes/network_directory.ts`), over #7672's tables.

| Route | Purpose |
| --- | --- |
| `GET /entries?q=&kind=&cursor=&limit=` | Published, unwithdrawn entries, a true total and cursor pages; signed-in members |
| `GET /entries/:uid` | One published entry and its sourced associations to visible entries; a merged-away uid answers its canonical entry; a person is a professional-only projection (D7674 part 4) |
| `GET /entries/:uid/overlay` | The caller's own private note and saved mark on a published person |
| `PUT /entries/:uid/overlay` | Write the caller's own overlay; a support session is refused |
| `DELETE /entries/:uid/overlay` | Remove it |
| `GET /admin/entries?status=&kind=` | Entries by publication status with their readiness; Super Admin |
| `GET /admin/reviews?status=` | Review items and the source rows they name; Super Admin |
| `POST /admin/entries/:uid/publish` | Publish an organisation or a person (professional projection only, D7674 part 4), behind the write bar |
| `POST /admin/entries/:uid/suppress` | Hide an entry from members, behind the write bar |
| `POST /admin/organisation-apply` | Apply a reviewed organisation-only upload: re-planned on the server, resumable batches, read back; Super Admin behind the write bar, not a support session (`services/networkDirectoryApply.ts`) |
| `POST /admin/people-apply` | Apply a reviewed people-only upload of professional fields (name, LinkedIn profile, geography, sectors, affiliations); contact fields refused and counted; same gate and machinery (`services/networkDirectoryPeopleApply.ts`) |
| `GET /admin/entries/:uid` | One entry's state, readiness, merges, redirects, source observations, review items with decisions and aliases; Super Admin (`services/networkDirectoryMerge.ts`) |
| `POST /admin/entries/:uid/merge` | Reviewed merge into a same-kind entry: archive and redirect, no evidence rewritten; behind the write bar, not a support session |
| `POST /admin/reviews/:reviewUid/decision` | Keep separate or dismiss a review item; it stays listed; behind the write bar, not a support session |
| `POST /admin/entries/:uid/aliases` | Add an organisation alias; a competing name is refused; behind the write bar, not a support session |
| `POST /admin/aliases/:aliasUid/withdraw` | Withdraw an alias, keeping its row; behind the write bar, not a support session |

No route reads a `network_directory_private_sources` cell, accepts SQL, publishes on apply, or creates an account, a
relationship, a notice or an outreach. See D7674 and its parts 2, 3 and 4.
