### Network directory reads, private overlays and reviewed publication (#7674)

No page or canvas is implemented here; the Network directory UI is a separate design handoff. All routes are
mounted under `/api/network/directory` (`routes/network_directory.ts`), over #7672's tables.

| Route | Purpose |
| --- | --- |
| `GET /entries?q=&kind=&cursor=&limit=` | Published, unwithdrawn entries, a true total and cursor pages; signed-in members |
| `GET /entries/:uid` | One published entry and its sourced associations to visible entries |
| `GET /entries/:uid/overlay` | The caller's own private note and saved mark on a published person |
| `PUT /entries/:uid/overlay` | Write the caller's own overlay; a support session is refused |
| `DELETE /entries/:uid/overlay` | Remove it |
| `GET /admin/entries?status=&kind=` | Entries by publication status with their readiness; Super Admin |
| `GET /admin/reviews?status=` | Review items and the source rows they name; Super Admin |
| `POST /admin/entries/:uid/publish` | Publish an organisation, behind the write bar; people are held (#7739) |
| `POST /admin/entries/:uid/suppress` | Hide an entry from members, behind the write bar |

No route reads `network_directory_private_sources`, applies an import plan, or creates an account, a relationship,
a notice or an outreach. See D7674.
