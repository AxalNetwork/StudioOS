### Distribution Inbox (D4494, #4494; part of #3722)

`/grow/distribution/inbox` mounts `InboxTab.jsx` inside #4484's shell: scoped
reply threads, a personal unread read, the Needs-you row on Overview
(`InboxNeedsYou`) and a composer whose drafts come from
`DistributionAskIntent` (D4488, `kind: 'reply'`). Only the existing mail
confirmation/send flow (`mailApi`) ever sends; nothing here sends on its own.

| Route | Purpose |
| --- | --- |
| `GET /api/grow/inbox?project=&q=` | Scoped reply threads (`grow_inbox.ts`) |
| `GET /api/grow/inbox/unread-count?project=` | The caller's own personal unread count |
| `GET /api/grow/inbox/:contactUid?project=` | One thread's messages |
| `POST /api/grow/inbox/:contactUid/read` | Personal read receipt for given message keys |

Client: `frontend/src/lib/api/growInbox.js` (`growInboxApi`). Sending a reply
uses the existing mail API, never a route here.
