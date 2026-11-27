# frontend/src/pages/network — Network's shared directory

The pages that read the shared Network directory (`/api/network/directory`, D7674) through `networkDirectoryApi` (`../../lib/api/networkDirectory.js`), drawn inside the Network workspace shell (`../../workspaces/NetworkWorkspace.jsx`).

| Path | What it is |
|---|---|
| `NetworkPeoplePage.jsx` | D9025 (#9025): Network › People, the Discoverable scope's search with the server's total and cursor pages, and the Person Sheet at `/network/people/:uid`. |
| `NetworkOrganizationsDirectory.jsx` | D9071 (#9071): Network › Organizations' Shared directory scope, each organization with its distinct people by status, and the scope control. |
| `NetworkOrganizationPage.jsx` | D9071: one organization, people first (`/network/organizations/:uid`), with the Person Sheet in its context. |
| `directory/` | The pieces every directory page shares: the address model, the page read, the search box, total and pager, the Person Sheet and the viewer's private overlay. |

## The rules for adding here

- **Counts are the server's.** A total comes from the read's `total`; an unknown total reads "Counting…" or "Unavailable", never 0.
- **The private overlay is the viewer's alone.** Only `PersonOverlay.jsx` reads or writes it, and only the caller's own row; no list, count or other page shows it.
- **A listing is not a relationship.** Opening, saving or noting a person contacts nobody, and no page says otherwise.
