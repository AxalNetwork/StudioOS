# pages/hq/eventSyndication — Event syndication (D1491, #3725)

HQ › Platform › Event syndication, from the owner's canvas
(`design/incoming/Event Syndication Page.dc.html`, boards SY0–SY8).

| File | What it is |
| --- | --- |
| `syndicationModel.js` | The module's words and rules, pure: the five channels and what each needs, the status chips, a row's status and sync line, the skip sentences, the log's words, "Not recorded" for an unimported count, the approve button's sentence, the editor's Syndicate to line, the tabs. Tested by `frontend/test/event_syndication_d1491.test.mjs`. |
| `EventSyndicationPage.jsx` | SY1 Channels, SY5 Activity and SY6 Settings at `/admin/platform/event-syndication`, `/log` and `/settings` (Super Admin, `hqOnly`). |

## Rules

- **Nothing here claims a post.** `SYNDICATION_SERVICE_READY` is false until the
  Worker core (D1490) is on `main`; every screen then says nothing is posted.
- **Every request needs a Worker route.** The screens read nothing until D1490's
  routes exist; wiring them is a follow-up of D1491, not a client written ahead.
- **Words live in the model.** Wiring the reads changes no copy.
